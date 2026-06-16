/**
 * cliBackendService.ts — AI CLI 後端偵測 / 登入深驗 / 安裝＋登入計畫產生
 *
 * 純 child_process / fs / os / path 邏輯，不碰 DB（better-sqlite3 / PunchLedger / repository），
 * 以保持可獨立單測。所有匯出函式全面容錯（catch → 安全預設，永不 throw）。
 *
 * ⚠️ 專案 memory（agent-teams-view-impl-notes）：禁 lazy require / 動態 import。
 *    所有 import 一律頂層；絕不在函式內 require() / await import()（esbuild 不打包 → runtime 缺模組）。
 */

import * as cp from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import { CLI_DESCRIPTORS } from '../../shared/cliRegistry'
import type { CliDescriptor, CliId, CliPlatform } from '../../shared/cliRegistry'
import type {
  CliStatusDto,
  CliVerifyResult,
  CliPlanDto,
  CliLoginState,
  CliLoginSignature,
} from '../../shared/ipcContracts'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** 目前平台：win32→'win'、darwin→'mac'、其餘→'linux'。 */
export function currentPlatform(): CliPlatform {
  if (process.platform === 'win32') return 'win'
  if (process.platform === 'darwin') return 'mac'
  return 'linux'
}

/** home 解析：與 repo / secretStore 同慣例（TEAMUQ_HOME 可覆寫測試）。 */
function homeDir(): string {
  return process.env['TEAMUQ_HOME'] || os.homedir()
}

/**
 * 展開路徑 placeholder：
 *   - `~`          → TEAMUQ_HOME || os.homedir()
 *   - `%LOCALAPPDATA%` / `%APPDATA%` / `%USERPROFILE%` → 對應 env（缺則視為空字串）
 * 回正規化路徑（path.normalize）。
 */
export function expandPath(p: string): string {
  try {
    let out = p
    if (out.startsWith('~')) {
      out = homeDir() + out.slice(1)
    }
    out = out
      .replace(/%LOCALAPPDATA%/gi, process.env['LOCALAPPDATA'] || '')
      .replace(/%APPDATA%/gi, process.env['APPDATA'] || '')
      .replace(/%USERPROFILE%/gi, process.env['USERPROFILE'] || '')
    return path.normalize(out)
  } catch {
    return p
  }
}

/**
 * 解析執行檔絕對路徑：
 *   1. 先用 `where <bin>`(win) / `command -v <bin>`(unix，需 shell) 取 stdout 第一行（exit 0 才採用）。
 *   2. 找不到則逐一 `fs.existsSync(expandPath(knownPaths[platform][i]))`，回第一個存在者。
 *   3. 都無 → null。
 * 各探測設 5s timeout；任何例外回退下一步，最終回 null。
 */
export function resolveBinPath(desc: CliDescriptor): string | null {
  const platform = currentPlatform()

  // 1) PATH 探測（where / command -v）
  try {
    let out = ''
    if (platform === 'win') {
      const r = cp.execFileSync('where', [desc.bin], {
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf8',
      })
      out = String(r)
    } else {
      const r = cp.execFileSync('command', ['-v', desc.bin], {
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf8',
        shell: '/bin/sh',
      })
      out = String(r)
    }
    const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    if (platform === 'win') {
      // `where` 可能回多行（如 codex / codex.cmd / codex.ps1）。
      // 偏好結尾為 .exe / .cmd 的可執行路徑（extensionless shim / .ps1 無法被 execFile 直跑）。
      const exec = lines.find((l) => /\.(exe|cmd)$/i.test(l))
      if (exec) return exec
    }
    const first = lines[0]
    if (first) return first
  } catch {
    // 找不到 / 非 0 exit / spawn 失敗 → 退到 knownPaths
  }

  // 2) knownPaths fallback
  try {
    const candidates = desc.knownPaths[platform] || []
    for (const c of candidates) {
      try {
        const abs = expandPath(c)
        if (fs.existsSync(abs)) return abs
      } catch {
        // 單筆候選展開/檢查失敗 → 試下一筆
      }
    }
  } catch {
    // knownPaths 結構異常 → 視為無
  }

  return null
}

/**
 * 取 CLI 版本字串：回 trim 後第一行；任何錯誤回 null。
 *
 * 平台差異（Windows 真機證據）：
 *   - Windows 上 bin 常是 .cmd / extensionless npm shim（如 codex.cmd、agy）；
 *     直接 `execFile(bin)` 不經 shell 會 spawn 失敗（EINVAL / ENOENT），版本取不到 → null。
 *     故 Windows 改用 `{ shell: true }`：node 會經 cmd.exe 跑，.cmd/shim 才能正確解析；
 *     此時 bin 與含空白的引數需自行用雙引號包住（含空白路徑也安全）。
 *   - unix 維持 `execFile(bin, args)` 直跑（最快、無 shell 注入面）。
 */
export function getVersion(bin: string, args: string[]): string | null {
  try {
    let out: string
    if (currentPlatform() === 'win') {
      // shell:true 下整列當命令字串解析 → bin 與引數各自加引號避免空白被拆。
      const quoted = [`"${bin}"`, ...args.map((a) => `"${a}"`)]
      const r = cp.execFileSync(quoted[0], quoted.slice(1), {
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf8',
        shell: true,
      })
      out = String(r)
    } else {
      const r = cp.execFileSync(bin, args, {
        timeout: 5000,
        windowsHide: true,
        encoding: 'utf8',
      })
      out = String(r)
    }
    const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0]
    return first || null
  } catch {
    return null
  }
}

/** 依 id 取 descriptor（找不到回 undefined）。 */
function descById(id: CliId): CliDescriptor | undefined {
  return CLI_DESCRIPTORS.find((d) => d.id === id)
}

/**
 * 解析「尊重 env override 的 credential 檔絕對路徑」（段一偵測與段二深驗共用，根除不對稱）。
 *
 * 各 CLI 的 env override：
 *   - claude：`CLAUDE_CONFIG_DIR` → `<dir>/.credentials.json`
 *   - codex： `CODEX_HOME`        → `<dir>/auth.json`
 *   - 其他（antigravity）：無 env override。
 *
 * 有對應 env 時回 `[<override 後的絕對路徑>]`；否則回 registry `credentialFiles[platform]`
 * 經 expandPath 展開後的路徑陣列（mac claude 為 []，維持 keyring/Keychain 語意不變）。
 * 任何例外 → 回退 registry 展開結果或 []。
 */
export function credentialPathsFor(desc: CliDescriptor): string[] {
  const platform = currentPlatform()
  try {
    if (desc.id === 'claude') {
      const dir = process.env['CLAUDE_CONFIG_DIR']
      if (dir) return [path.join(dir, '.credentials.json')]
    } else if (desc.id === 'codex') {
      const dir = process.env['CODEX_HOME']
      if (dir) return [path.join(dir, 'auth.json')]
    }
    const fromRegistry = desc.credentialFiles[platform] || []
    return fromRegistry.map((f) => expandPath(f))
  } catch {
    return []
  }
}

/** 段一 login 探測（無 credentialFiles 時）的 detail 文案。 */
function noFileDetail(id: CliId, platform: CliPlatform): string {
  // antigravity 現已有 credentialFiles（~/.gemini/oauth_creds.json），正常不會走到這；
  // 僅在 home 解析失敗等極端情況 fallback 用。
  if (id === 'antigravity') {
    return '找不到 ~/.gemini/oauth_creds.json，請用一鍵登入後重新偵測'
  }
  if (id === 'claude' && platform === 'mac') {
    return 'macOS 憑證存 Keychain，無法由檔案判定'
  }
  return '此 CLI 在本平台無法由檔案判定登入狀態，請用一鍵登入後重新偵測'
}

/** macOS Keychain 中 Claude Code 憑證的 service 名稱（實測：security -s 此名命中）。 */
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials'

/**
 * macOS 專用：用 `security find-generic-password -s "<service>"` 探 Claude 登入狀態。
 *
 * 僅查項目是否存在，**不加 -w**（不讀密文）→ 只列屬性、不觸發 Keychain 授權視窗：
 *   - exit 0                       → 項目存在 → logged_in
 *   - 非 0 退出（查無此項）          → logged_out
 *   - spawn 失敗 / timeout（error） → unknown
 * 非 macOS 一律回 unknown（呼叫端應自行守 platform==='mac' 才呼叫）。
 */
export function probeClaudeKeychain(): { state: CliLoginState; detail: string } {
  if (process.platform !== 'darwin') {
    return { state: 'unknown', detail: '非 macOS，無 Keychain 探測' }
  }
  try {
    const result = cp.spawnSync(
      'security',
      ['find-generic-password', '-s', CLAUDE_KEYCHAIN_SERVICE],
      { timeout: 5000, encoding: 'utf-8', windowsHide: true },
    )
    if (result.error) {
      return { state: 'unknown', detail: `Keychain 探測失敗：${result.error.message}` }
    }
    if (result.status === 0) {
      return { state: 'logged_in', detail: 'macOS Keychain 存在 Claude 憑證' }
    }
    return { state: 'logged_out', detail: 'macOS Keychain 查無 Claude 憑證，視為未登入' }
  } catch (e) {
    return { state: 'unknown', detail: e instanceof Error ? e.message : String(e) }
  }
}

// ---------------------------------------------------------------------------
// export 函式（全面容錯）
// ---------------------------------------------------------------------------

/**
 * 偵測全部 CLI 狀態（段一）。
 * 逐筆 descriptor：解析路徑 / 版本 / 段一 login（credential 檔存在探測）。
 * 任何單筆例外退安全預設（installed=false、loginState='unknown'），不影響其他筆。
 */
export async function detectAll(): Promise<CliStatusDto[]> {
  const platform = currentPlatform()
  const results: CliStatusDto[] = []

  for (const desc of CLI_DESCRIPTORS) {
    try {
      const binPath = resolveBinPath(desc)
      const installed = binPath != null
      const version = installed ? getVersion(binPath || desc.bin, desc.versionArgs) : null

      let loginState: CliLoginState = 'unknown'
      let loginProbe: CliStatusDto['loginProbe'] = 'none'
      let detail: string | undefined

      // 尊重 env override（CLAUDE_CONFIG_DIR / CODEX_HOME）；與 verifyLogin 段二共用同一解析。
      const credFiles = credentialPathsFor(desc)

      if (credFiles.length === 0) {
        // keyring 型 / 本平台無檔 → 無法由檔案判定
        if (desc.id === 'claude' && platform === 'mac') {
          // macOS Claude 憑證存 Keychain → 改用 security 存在性探測（不讀密文）
          const kc = probeClaudeKeychain()
          loginState = kc.state
          loginProbe = kc.state === 'unknown' ? 'none' : 'keychain'
          detail = kc.detail
        } else {
          loginProbe = 'none'
          loginState = 'unknown'
          detail = noFileDetail(desc.id, platform)
        }
      } else {
        const anyExists = credFiles.some((f) => {
          try {
            return fs.existsSync(f)
          } catch {
            return false
          }
        })
        loginProbe = 'file'
        loginState = anyExists ? 'logged_in' : 'logged_out'
      }

      // 未安裝 → login 不可信，統一退 unknown/none（detail 維持上面已算出的文案）
      if (!installed) {
        loginState = 'unknown'
        loginProbe = 'none'
      }

      results.push({
        id: desc.id,
        name: desc.name,
        bin: desc.bin,
        installed,
        version,
        path: binPath,
        loginState,
        loginProbe,
        ...(detail !== undefined ? { detail } : {}),
      })
    } catch (e) {
      // 單筆全敗 → 安全預設列
      results.push({
        id: desc.id,
        name: desc.name,
        bin: desc.bin,
        installed: false,
        version: null,
        path: null,
        loginState: 'unknown',
        loginProbe: 'none',
        detail: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return results
}

/**
 * 段二深驗（分支處理）。
 *   - claude：讀 `<CLAUDE_CONFIG_DIR || ~/.claude>/.credentials.json` 判 expires_at/expiresAt（ms epoch）。
 *             credential 路徑由 credentialPathsFor 統一解析，與 detectAll 段一對稱。
 *   - codex：用 spawnSync 跑 `codex login status`（Windows shell:true 以支援 .cmd shim）；
 *            result.status===0=已登入；非零退出=未登入；result.error（spawn 失敗/timeout）=unknown。
 *   - antigravity：keyring 型，直接回 unknown。
 * 任何例外 → unknown + 例外訊息。
 */
export async function verifyLogin(id: CliId): Promise<CliVerifyResult> {
  try {
    const platform = currentPlatform()

    if (id === 'claude') {
      const desc = descById('claude')
      // 與 detectAll 段一共用 credentialPathsFor：尊重 CLAUDE_CONFIG_DIR override。
      // mac 無 override 時回 []（Keychain），fallback 至傳統 ~/.claude 路徑以維持原檔案深驗能力。
      const credPaths = desc ? credentialPathsFor(desc) : []
      const credPath = credPaths[0] || path.join(homeDir(), '.claude', '.credentials.json')
      if (!fs.existsSync(credPath)) {
        if (platform === 'mac') {
          // 無檔（Keychain 型）→ 用 security 存在性探測取代「無法判定」
          const kc = probeClaudeKeychain()
          return { id, loginState: kc.state, detail: kc.detail }
        }
        return { id, loginState: 'logged_out', detail: '未找到 .credentials.json，視為未登入' }
      }
      const raw = fs.readFileSync(credPath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const expires = findExpiresAt(parsed)
      if (typeof expires === 'number' && expires < Date.now()) {
        return { id, loginState: 'logged_out', detail: 'token 已過期' }
      }
      return { id, loginState: 'logged_in', detail: 'credential 檔存在且 token 未過期' }
    }

    if (id === 'codex') {
      const desc = descById('codex')
      const bin = (desc ? resolveBinPath(desc) : null) || (desc ? desc.bin : 'codex')
      // Windows 上 bin 常是 .cmd npm shim；execFile 不經 shell 會 spawn 失敗 → 永遠落 catch。
      // 改用 spawnSync 較好分辨「非零退出」(status 為數字) vs「spawn 失敗」(result.error)：
      //   - shell:true 時整列當命令字串解析 → bin 與各 arg 各自加引號避免空白被拆（與 getVersion 同風格）。
      const useShell = process.platform === 'win32'
      const args = ['login', 'status']
      const result = useShell
        ? cp.spawnSync(`"${bin}"`, args.map((a) => `"${a}"`), {
            timeout: 10000,
            windowsHide: true,
            encoding: 'utf-8',
            shell: true,
          })
        : cp.spawnSync(bin, args, {
            timeout: 10000,
            windowsHide: true,
            encoding: 'utf-8',
          })

      // result.error：spawn 失敗（ENOENT）/ timeout（ETIMEDOUT）等 → 無法判定。
      if (result.error) {
        return {
          id,
          loginState: 'unknown',
          detail: `無法執行 codex login status：${result.error.message || String(result.error)}`,
        }
      }
      // exit 0 → 已登入；非零退出（status 為其他數字）→ 未登入。
      if (result.status === 0) {
        return { id, loginState: 'logged_in', detail: 'codex login status 回報已登入' }
      }
      if (typeof result.status === 'number') {
        return { id, loginState: 'logged_out', detail: 'codex login status 回報未登入' }
      }
      // status 非數字（如被信號終止 result.signal 非 null）→ 無法判定。
      return {
        id,
        loginState: 'unknown',
        detail: `codex login status 未正常結束${result.signal ? `（signal: ${result.signal}）` : ''}`,
      }
    }

    if (id === 'antigravity') {
      // agy 憑證寫在 ~/.gemini/oauth_creds.json。關鍵：判斷依據是 refresh_token，不是 access token 的
      // expiry_date —— access token 短命（約 1h）常顯示過期，agy 會用 refresh_token 自動續期，
      // 故「有 refresh_token」即視為仍登入；access 過期不代表登出。
      const desc = descById('antigravity')
      const credPaths = desc ? credentialPathsFor(desc) : []
      const credPath = credPaths[0] || path.join(homeDir(), '.gemini', 'oauth_creds.json')
      if (!fs.existsSync(credPath)) {
        return { id, loginState: 'logged_out', detail: '未找到 ~/.gemini/oauth_creds.json，視為未登入' }
      }
      const raw = fs.readFileSync(credPath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const hasRefresh =
        typeof parsed['refresh_token'] === 'string' && (parsed['refresh_token'] as string).length > 0
      // 帶上 active 帳號（若可讀）讓 detail 更具體。
      let who = ''
      try {
        const acc = JSON.parse(
          fs.readFileSync(path.join(path.dirname(credPath), 'google_accounts.json'), 'utf8'),
        ) as { active?: string }
        if (acc.active) who = `（${acc.active}）`
      } catch {
        /* google_accounts.json 不存在/壞檔 → 略過帳號顯示 */
      }
      if (hasRefresh) {
        return { id, loginState: 'logged_in', detail: `refresh_token 存在，可自動續期${who}` }
      }
      // 無 refresh_token：退而檢查 access token 是否還沒過期。
      const expires = findExpiresAt(parsed)
      if (typeof expires === 'number' && expires < Date.now()) {
        return { id, loginState: 'logged_out', detail: 'token 已過期且無 refresh_token，請重新登入' }
      }
      return { id, loginState: 'logged_in', detail: `credential 檔存在${who}` }
    }

    // 不認得的 id（理論上不會到；型別已窄化）
    return { id, loginState: 'unknown', detail: '未知的 CLI id' }
  } catch (e) {
    return { id, loginState: 'unknown', detail: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 登入「憑證簽章」（供登入面板輪詢偵測剛完成登入；cli-login-autoclose）。
 *
 * 動機：codex login 跑完會 return（完成標記 `; exit` 即能自動關面板），但 claude / agy 是互動式
 * TUI，登入完成後 TUI 仍開著 → 標記不會印出 → 面板不會關。故 renderer 在登入面板開著時輪詢本函式，
 * 比對 sig 是否變動（且 loggedIn）來判定「憑證剛被寫入＝登入完成」，再主動 kill pty 收面板。
 *
 * 刻意**只 fs.stat**（不跑 `codex login status` 等子行程）：
 *   - 輕量、可高頻輪詢（2s）；
 *   - 不與正在跑的互動式 login 子行程衝突。
 *
 * sig 來源：
 *   - 檔型（claude win/linux、codex、agy）：對每個存在的 credentialFile 取 `mtimeMs`，
 *     串成 `<path>:<mtimeMs>|…`。檔被重寫（登入/續期）→ mtime 變 → sig 變。
 *   - mac claude（Keychain，無檔）：用 probeClaudeKeychain 存在性 → 'kc:1'（已登入）/'kc:0'（未登入）。
 *     侷限：Keychain 無 mtime，無法偵測「已登入後再重新登入」的續期；首次登入（kc:0→kc:1）仍可偵測。
 * 任何例外 → { loggedIn:false, sig:'' }（安全預設，輪詢端不會誤關）。
 */
export async function loginSignature(id: CliId): Promise<CliLoginSignature> {
  try {
    const desc = descById(id)
    if (!desc) return { id, loggedIn: false, sig: '' }
    const platform = currentPlatform()
    const files = credentialPathsFor(desc)

    if (files.length === 0) {
      // 無檔：mac claude 走 Keychain 存在性；其餘 keyring 型無法判定。
      if (desc.id === 'claude' && platform === 'mac') {
        const loggedIn = probeClaudeKeychain().state === 'logged_in'
        return { id, loggedIn, sig: loggedIn ? 'kc:1' : 'kc:0' }
      }
      return { id, loggedIn: false, sig: '' }
    }

    let loggedIn = false
    const parts: string[] = []
    for (const f of files) {
      try {
        const st = fs.statSync(f)
        loggedIn = true
        parts.push(`${f}:${st.mtimeMs}`)
      } catch {
        // 檔不存在 → 略過（尚未登入）
      }
    }
    return { id, loggedIn, sig: parts.join('|') }
  } catch {
    return { id, loggedIn: false, sig: '' }
  }
}

/** 從 credential JSON 找 expires_at / expiresAt / expiry_date（ms epoch 數字）；可能巢狀於子物件。 */
function findExpiresAt(obj: Record<string, unknown>): number | undefined {
  // expiry_date：agy（Gemini OAuth）憑證的過期欄位（ms epoch）。
  for (const key of ['expires_at', 'expiresAt', 'expiry_date']) {
    const v = obj[key]
    if (typeof v === 'number') return v
  }
  // 容錯：claude 的 credential 可能巢狀（如 { claudeAiOauth: { expiresAt } }）
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const nested = findExpiresAt(val as Record<string, unknown>)
      if (typeof nested === 'number') return nested
    }
  }
  return undefined
}

/**
 * 安裝計畫：desc.install[platform] 當 command（無則 '' + note「此平台無安裝指令」）。
 * shell：win→'powershell'、其餘→'bash'。cwd=home。interactive=false。note 帶 desc.install.note。
 */
export async function getInstallPlan(id: CliId): Promise<CliPlanDto> {
  const platform = currentPlatform()
  const shell: CliPlanDto['shell'] = platform === 'win' ? 'powershell' : 'bash'
  const cwd = homeDir()

  try {
    const desc = descById(id)
    if (!desc) {
      return { id, command: '', shell, cwd, interactive: false, note: '找不到此 CLI 描述子' }
    }
    const command = desc.install[platform] || ''
    const note = command ? desc.install.note : '此平台無安裝指令'
    return {
      id,
      command,
      shell,
      cwd,
      interactive: false,
      ...(note !== undefined ? { note } : {}),
    }
  } catch (e) {
    return {
      id,
      command: '',
      shell,
      cwd,
      interactive: false,
      note: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * 登入計畫：
 *   - 預設 command=desc.login.command（裸 bin 開頭，如 'codex login' / 'agy'）。
 *   - 若能解析出絕對路徑（resolveBinPath 非 null），把開頭的 bin token 換成「絕對路徑呼叫」，
 *     讓剛安裝、尚未進 PATH 的 CLI（典型 agy）免重啟 App 即可登入：
 *       win(powershell)：`& "<resolved>"` + 其餘部分（例 'codex login' → `& "C:\...\codex.exe" login`）
 *       非 win(bash)：    `"<resolved>"`  + 其餘部分
 *   - resolved 為 null（未安裝）→ 維持原裸指令 fallback。
 *   - 不在登入前串接安裝/更新指令：claude/codex 原生安裝器自身會在背景自動更新，
 *     每次登入重跑 irm|iex / curl|sh 會重新下載、又慢又吵，故只跑純登入指令。
 * shell：win→'powershell'、其餘→'bash'。cwd=home。interactive=true。note=desc.login.note。
 */
export async function getLoginPlan(id: CliId): Promise<CliPlanDto> {
  const platform = currentPlatform()
  const shell: CliPlanDto['shell'] = platform === 'win' ? 'powershell' : 'bash'
  const cwd = homeDir()

  try {
    const desc = descById(id)
    if (!desc) {
      return { id, command: '', shell, cwd, interactive: true, note: '找不到此 CLI 描述子' }
    }

    let command = desc.login.command
    try {
      const resolved = resolveBinPath(desc)
      if (resolved) {
        // desc.login.command 都以 desc.bin 開頭：去掉開頭 bin token，保留其餘（如 ' login'）。
        const rest = command.slice(desc.bin.length)
        command = platform === 'win' ? `& "${resolved}"${rest}` : `"${resolved}"${rest}`
      }
    } catch {
      // 解析絕對路徑失敗 → 保留原裸指令 fallback
    }

    // 原生安裝器自身會背景自動更新，登入不再串接安裝/更新指令 → note 回歸純登入說明。
    const note = desc.login.note

    return {
      id,
      command,
      shell,
      cwd,
      interactive: true,
      ...(note !== undefined ? { note } : {}),
    }
  } catch (e) {
    return {
      id,
      command: '',
      shell,
      cwd,
      interactive: true,
      note: e instanceof Error ? e.message : String(e),
    }
  }
}
