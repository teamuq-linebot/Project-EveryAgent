import React, { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { getXtermTheme, FONT_MONO } from '../../theme'
import type { PtyDataPayload } from '../../../shared/ipcContracts'

interface Props {
  /** PTY id — 以 sessionId 作為 ptyId（全域唯一） */
  sessionId: string
  /** 工作目錄（里程碑的 projectPath） */
  projectPath?: string
  /** 工具 hint（claude / codex / custom），用於 cwd 識別 */
  tool?: string
  /** 終端啟動後一次性注入的指令（如 `claude --resume <uuid>`）；null/空=不注入 */
  launchCommand?: string | null
  /** PTY 就緒（且 launchCommand 已注入）後觸發；供上層 flush 排隊中的輸入 */
  onReady?: () => void
}

type Status = 'connecting' | 'running' | 'killed' | 'error'

/**
 * TerminalPanel — xterm.js 終端，接特定 session 的 PTY。
 *
 * 以 sessionId 作為 ptyId；mount 時 spawn PTY（cwd = projectPath）；
 * unmount 時 kill PTY + dispose xterm。
 */
export default function TerminalPanel({
  sessionId,
  projectPath,
  launchCommand,
  onReady,
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [status, setStatus] = useState<Status>('connecting')
  const [errorMsg, setErrorMsg] = useState<string>('')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 終端固定深色主題：嵌入的全螢幕 TUI（codex/claude）自帶深色 UI，
    // 隨 app 淺色主題切換會讓對比極低幾乎看不到，故鎖定 'dark'。
    const term = new Terminal({
      theme: getXtermTheme('dark'),
      fontFamily: FONT_MONO,
      fontSize: 14,
      lineHeight: 1.4,
      cursorBlink: true,
      allowTransparency: false,
      scrollback: 5000,
      // PTY 終端不可做 EOL 轉換：把裸 \n 轉成 \r\n 會破壞 TUI 自管的游標定位
      // （版面左移/文字重疊殘影）。
      convertEol: false,
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)

    termRef.current = term
    fitRef.current = fitAddon

    // 安全 fit：容器隱藏（display:none）或尚未佈局時為 0 尺寸，此時 fitAddon.fit()
    // 會讀到 undefined 的 renderService.dimensions 而拋 TypeError，且在 ResizeObserver
    // callback 內同步改尺寸會造成「ResizeObserver loop」洪水。故：先擋 0 尺寸 + try/catch，
    // 並用 requestAnimationFrame 把 fit 推到下一幀，打斷同步迴圈。
    let rafId = 0
    const safeFit = (): void => {
      const el = containerRef.current
      if (!el || el.offsetWidth === 0 || el.offsetHeight === 0) return
      try {
        fitAddon.fit()
        const { cols, rows } = term
        if (cols > 0 && rows > 0) window.tuq.pty.resize(sessionId, cols, rows)
      } catch {
        // xterm renderService 尚未就緒 → 略過本次（下次 resize 會再試）
      }
    }
    const scheduleFit = (): void => {
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(safeFit)
    }
    scheduleFit()

    // 使用者輸入 → 送 PTY
    const inputDispose = term.onData((data: string) => {
      window.tuq.pty.write(sessionId, data)
    })

    // copy-on-select：選取非空時自動複製到剪貼簿
    const selectionDispose = term.onSelectionChange(() => {
      const sel = term.getSelection()
      if (sel) window.tuq.clipboard.writeText(sel)
    })

    // 快捷鍵：Ctrl+Shift+C 複製、Ctrl+Shift+V 貼上（Ctrl+C 照舊送 PTY）
    term.attachCustomKeyEventHandler((e: KeyboardEvent): boolean => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyC' && e.type === 'keydown') {
        const sel = term.getSelection()
        if (sel) window.tuq.clipboard.writeText(sel)
        return false
      }
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyV' && e.type === 'keydown') {
        window.tuq.clipboard.readText().then((res) => {
          if (res.ok) window.tuq.pty.write(sessionId, res.data.text)
        })
        return false
      }
      return true
    })

    // 右鍵選單：有選取→複製；無選取→貼上
    const handleContextMenu = (e: MouseEvent): void => {
      e.preventDefault()
      const sel = term.getSelection()
      if (sel) {
        window.tuq.clipboard.writeText(sel)
      } else {
        window.tuq.clipboard.readText().then((res) => {
          if (res.ok) window.tuq.pty.write(sessionId, res.data.text)
        })
      }
    }
    container.addEventListener('contextmenu', handleContextMenu)

    // PTY 輸出 → 寫 xterm（只接自己的 sessionId）
    const unsubData = window.tuq.onPtyData((payload: PtyDataPayload) => {
      if (payload.id !== sessionId) return
      term.write(payload.data)
    })

    // spawn PTY
    // disposed：effect 已 cleanup（StrictMode 雙重 mount / 真卸載）後才 resolve 的
    // spawn 不得再注入啟動指令 —— 否則 dev 下 StrictMode 的第一次 mount 的 .then
    // 會與第二次 mount 各注入一次，`claude --resume` 重複執行兩次。
    let disposed = false
    let injectTimer: ReturnType<typeof setTimeout> | null = null
    const { cols, rows } = term
    window.tuq.pty
      .spawn({ id: sessionId, cwd: projectPath, cols, rows })
      .then((result) => {
        if (disposed) return
        if (result.ok) {
          setStatus('running')
          // 一次性注入工具啟動指令（給 shell 一點時間起提示字元，對應 Qt 120ms）。
          // PTY「就緒」訊號放在注入之後 —— 否則上層 flush 的輸入會被打進
          // `claude --resume` 啟動前的裸 shell。無 launchCommand 則 spawn 完即就緒。
          //
          // 注意：不在此自動注入 initialPrompt。團隊對話跳監測任務的初始任務改為「預填到
          // 對話輸入框、由使用者按 Enter 送出」（見 SessionTab/ConversationPanel 的 initialDraft）。
          // 送出走 SessionTab.writeAndSubmit 的兩段寫入（text → 150ms → \r），繞開 codex TUI
          // 對「prompt+\r 一包寫入」會少送一個 Enter（時序競態，時好時壞）的問題。
          if (launchCommand) {
            injectTimer = setTimeout(() => {
              window.tuq.pty.write(sessionId, launchCommand + '\r')
              onReady?.()
            }, 300)
          } else {
            onReady?.()
          }
        } else {
          setStatus('error')
          setErrorMsg((result as { ok: false; error: string }).error)
        }
      })
      .catch((e: unknown) => {
        if (disposed) return
        setStatus('error')
        setErrorMsg(e instanceof Error ? e.message : String(e))
      })

    // ResizeObserver → 經 rAF 安全 fit + resize PTY（rAF 打斷同步迴圈）
    const ro = new ResizeObserver(() => {
      scheduleFit()
    })
    ro.observe(container)

    return () => {
      disposed = true
      if (injectTimer) clearTimeout(injectTimer)
      cancelAnimationFrame(rafId)
      ro.disconnect()
      inputDispose.dispose()
      selectionDispose.dispose()
      container.removeEventListener('contextmenu', handleContextMenu)
      unsubData()
      window.tuq.pty.kill(sessionId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
      setStatus('killed')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const statusLabel: Record<Status, string> = {
    connecting: '正在啟動…',
    running: '運行中',
    killed: '已關閉',
    error: `錯誤：${errorMsg}`,
  }

  return (
    <div className="terminal-panel" style={{ height: '100%' }}>
      <div className="terminal-panel__header">
        <span className="terminal-panel__header-title">
          {projectPath ?? '終端機'}
        </span>
        <span
          className="terminal-panel__status"
          style={{ color: status === 'error' ? 'var(--error)' : undefined }}
        >
          {statusLabel[status]}
        </span>
      </div>
      <div
        ref={containerRef}
        className="terminal-panel__body"
        style={{ flex: 1, minHeight: 0 }}
      />
    </div>
  )
}
