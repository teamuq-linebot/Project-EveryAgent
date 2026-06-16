import * as pty from 'node-pty'
import type { IPty } from 'node-pty'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Terminal } from '@xterm/headless'
import { WebContents } from 'electron'
import { PTY_CHANNELS, PtyDataPayload, PtyExitPayload } from '../../shared/ipcContracts'
import { PtyPromptWatcher, type MenuOption } from './promptDetector'

function defaultShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC ?? 'cmd.exe'
  }
  return process.env.SHELL ?? '/bin/bash'
}

/**
 * 解析一個「保證存在且正規化」的工作目錄，防 node-pty/ConPTY 因無效 cwd 拋
 * 「Cannot create process, error code: 267」（ERROR_DIRECTORY）。
 *
 * 踩過的雷：
 *   - opts.cwd 為空字串 ''：`?? ` 不會 fallback（只擋 null/undefined）→ 原樣傳入 → 267。
 *   - opts.cwd 指向不存在/已刪除的資料夾 → 267。
 *   - Windows 上 process.env.HOME 可能被 Git-Bash/MSYS 設成 `/c/Users/...` 之類
 *     ConPTY 無法解析的 POSIX 路徑 → 267；故 win32 優先用 USERPROFILE，不盲信 HOME。
 *
 * 逐一試候選，回傳第一個「path.resolve 正規化後 statSync 為目錄」者；全失敗退 process.cwd()。
 */
export function resolveCwd(requested?: string): string {
  const candidates: (string | undefined)[] = [
    requested,
    process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME,
    process.env.USERPROFILE,
    os.homedir(),
    process.cwd(),
  ]
  for (const c of candidates) {
    if (!c || !c.trim()) continue
    try {
      // path.resolve 正規化斜線與去尾斜線（ConPTY 對 `/` 與尾斜線敏感）。
      const resolved = path.resolve(c)
      if (fs.statSync(resolved).isDirectory()) return resolved
    } catch {
      // 不存在 / 無法 stat → 試下一個候選
    }
  }
  return process.cwd()
}

/**
 * 讀無頭終端機目前可見螢幕為純文字（含正確空白）。
 * claude TUI 以游標絕對定位排版（如 \x1b[15G），把這份 byte stream 餵給真正的終端機網格
 * 還原後，translateToString 得到的才是「畫面上看到的」文字——選單選項才能被正確解析。
 */
function renderScreen(term: Terminal): string {
  const buf = term.buffer.active
  const lines: string[] = []
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.baseY + y)
    lines.push(line ? line.translateToString(true) : '')
  }
  return lines.join('\n')
}

interface PtyEntry {
  pty: IPty
  /** 無頭終端機（供互動提示偵測還原螢幕用）；非偵測路徑為 null。 */
  term: Terminal | null
  dispose: () => void
}

/**
 * PTY prompt-state 變化回呼（由 Backend 注入）。
 *   id      — PtyManager.spawn 時傳入的 pty id（通常等於 sessionId）
 *   state   — 'waiting'=偵測到互動提示靜止；'active'=新資料恢復；'error'=CLI 錯誤或早夭
 *   reason  — waiting/error 時的命中規則名稱或描述
 */
export type PromptStateCallback = (
  id: string,
  state: 'waiting' | 'active' | 'error',
  reason?: string,
  options?: MenuOption[],
  prompt?: string,
) => void

/** spawn 後多少毫秒內退出（exitCode≠0）視為早夭 */
const EARLY_EXIT_MS = 15_000

export class PtyManager {
  private readonly _ptys = new Map<string, PtyEntry>()
  /** 互動提示偵測回呼（建構時選擇性注入；null=不偵測）。 */
  private readonly _onPromptStateChange: PromptStateCallback | null

  constructor(opts: { onPromptStateChange?: PromptStateCallback } = {}) {
    this._onPromptStateChange = opts.onPromptStateChange ?? null
  }

  spawn(
    id: string,
    opts: {
      shell?: string
      cwd?: string
      env?: Record<string, string>
      cols: number
      rows: number
    },
    // 可空（§5）：互動 session 由 router 傳 event.sender 推資料給 renderer；
    // ClaudeCliProvider 等 main-process 內部用途傳 null（無 renderer），onData 不推送。
    webContents: WebContents | null
  ): void {
    if (this._ptys.has(id)) {
      this.kill(id)
    }

    const shell = opts.shell ?? defaultShell()
    // COLORTERM=truecolor 讓嵌入的 TUI（codex/claude）走全彩，避免色彩降級導致
    // 對比過低。呼叫端 opts.env 仍可覆寫。
    const env = {
      ...process.env,
      COLORTERM: 'truecolor',
      ...(opts.env ?? {}),
    } as Record<string, string>

    // cwd 一律經 resolveCwd 驗證 + 正規化 + 回退（防 error 267；見 resolveCwd 註解）。
    const cwd = resolveCwd(opts.cwd)
    if (opts.cwd && opts.cwd.trim() && opts.cwd !== cwd) {
      // 要求的 cwd 無效（空/不存在/POSIX 風格路徑）→ 已回退；記錄供診斷（落 main.log）。
      console.warn(
        `[pty] 要求的 cwd 無效，改用 fallback：requested=${JSON.stringify(opts.cwd)} → ${cwd}`,
      )
    }

    const p = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd,
      env,
    })

    // 建立互動提示偵測 watcher（無論 webContents 是否為 null 皆偵測，包含 ClaudeCliProvider 路徑）
    const cb = this._onPromptStateChange
    // 無頭終端機：與偵測 watcher 同生命週期；用於把 PTY 輸出還原成可見螢幕（含正確空白），
    // 讓選單選項能被正確解析（claude TUI 以游標定位排版，純 stripAnsi 會丟空白）。
    const term = cb
      ? new Terminal({ cols: opts.cols, rows: opts.rows, allowProposedApi: true, scrollback: 200 })
      : null
    const watcher = cb
      ? new PtyPromptWatcher(
          (reason, options, prompt) => cb(id, 'waiting', reason, options, prompt),
          () => cb(id, 'active'),
          {
            // warmupMs：略過 claude 開場過場（banner / 信任畫面 / MCP 連線）避免誤彈卡。
            warmupMs: 5_000,
            // render：以無頭終端機還原螢幕（取代預設 stripAnsi），保留字詞間空白。
            render: () => (term ? renderScreen(term) : ''),
          },
          (reason) => cb(id, 'error', reason),
        )
      : null

    const spawnedAt = Date.now()

    const dataListener = p.onData((data: string) => {
      // 先餵無頭終端機（更新螢幕狀態），再交給 watcher 排程 idle 偵測
      term?.write(data)
      // 偵測先於 renderer 推送，確保 webContents=null 的路徑也能被偵測
      watcher?.onData(data)
      // webContents 為 null（main-process 內部用途）則不推送給 renderer。
      if (!webContents || webContents.isDestroyed()) return
      const payload: PtyDataPayload = { id, data }
      webContents.send(PTY_CHANNELS.DATA, payload)
    })

    // PTY 子行程結束處理：
    //   (1) 早夭偵測：spawn 後 EARLY_EXIT_MS 內以非零 exitCode 退出視為 CLI 錯誤（既有行為）。
    //   (2) 結束通知：對所有結束（含正常 exitCode=0）推 PTY_CHANNELS.EXIT 給 renderer，
    //       供消費端（CliBackendSection）觀察「指令跑完→shell exit→pty 結束」以自動收合面板。
    //       session 終端機（TerminalPanel）不訂閱此 channel，故不受影響。
    const exitListener = p.onExit(({ exitCode }) => {
      const elapsed = Date.now() - spawnedAt
      if (cb && elapsed < EARLY_EXIT_MS && exitCode !== 0) {
        cb(id, 'error', `early-exit code=${exitCode}`)
      }
      if (webContents && !webContents.isDestroyed()) {
        const payload: PtyExitPayload = { id, exitCode }
        webContents.send(PTY_CHANNELS.EXIT, payload)
      }
    })

    const entry: PtyEntry = {
      pty: p,
      term,
      dispose: () => {
        watcher?.dispose()
        dataListener.dispose()
        exitListener.dispose()
        try {
          term?.dispose()
        } catch {
          // ignore
        }
        try {
          p.kill()
        } catch {
          // already dead
        }
      },
    }
    this._ptys.set(id, entry)
  }

  write(id: string, data: string): void {
    this._ptys.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this._ptys.get(id)
    if (!entry) return
    entry.pty.resize(cols, rows)
    // 無頭終端機同步尺寸，否則螢幕還原的換行/欄位會與真實終端不一致。
    try {
      entry.term?.resize(cols, rows)
    } catch {
      // ignore
    }
  }

  kill(id: string): void {
    const entry = this._ptys.get(id)
    if (entry) {
      entry.dispose()
      this._ptys.delete(id)
    }
  }

  killAll(): void {
    for (const id of [...this._ptys.keys()]) {
      this.kill(id)
    }
  }
}
