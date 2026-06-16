/**
 * promptDetector.ts — PTY 互動提示偵測（純函式，零 I/O，可單元測試）
 *
 * 職責：
 *   - stripAnsi(s): 去除 ANSI escape codes，保留正文
 *   - detectInteractivePrompt(tailText): 判斷尾段文字是否含互動選單特徵
 *   - extractMenuOptions(stripped): 從 PTY 尾段解析數字選單選項
 *   - PtyPromptWatcher: 持續接收 PTY chunk，靜止逾時後偵測並回呼 onWaiting/onActive
 */

// ---------------------------------------------------------------------------
// ANSI 去除
// ---------------------------------------------------------------------------

/** CSI 序列：ESC [ 後接數字/符號，結尾字母 */
const RE_CSI = /\x1b\[[0-9;?]*[A-Za-z]/g

/** OSC 序列：ESC ] ... BEL 或 ESC \ */
const RE_OSC = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g

/** 其他常見 escape：ESC 後接單一字元（非 [ ]） */
const RE_OTHER_ESCAPE = /\x1b[^[\]]/g

/**
 * 去除 ANSI/VT escape codes，保留可見文字。
 * 保守：只去有把握的 CSI、OSC、單字元 escape；未知結構整串保留，不丟正文。
 */
export function stripAnsi(s: string): string {
  return s
    .replace(RE_CSI, '')
    .replace(RE_OSC, '')
    .replace(RE_OTHER_ESCAPE, '')
}

// ---------------------------------------------------------------------------
// CLI 錯誤特徵規則（早夭 / 參數錯 / 路徑不存在等）
// ---------------------------------------------------------------------------

interface ErrorPatternRule {
  name: string
  re: RegExp
}

/**
 * CLI 輸出的錯誤特徵（大小寫不敏感）。
 * 命中任一條 → PTY 進入 error 狀態。
 */
export const ERROR_PATTERNS: ErrorPatternRule[] = [
  { name: 'no_conversation_found', re: /no conversation found/i },
  // 行首錨定（multiline）：只認「整行以 error: 開頭」的 CLI 錯誤行，避免把對話正文
  // 中段的 "...an error: ..." 誤判。仍受啟動視窗（見 PtyPromptWatcher）保護。
  { name: 'error_colon',           re: /^\s*error:/im },
  { name: 'enoent',                re: /ENOENT/i },
  { name: 'not_recognized',        re: /not recognized as.*command/i },
  { name: 'cannot_find_path',      re: /cannot find path/i },
  { name: 'usage_claude',          re: /usage: claude/i },
]

/**
 * 對 PTY 輸出尾段（已去 ANSI）進行 CLI 錯誤特徵比對。
 * @returns { error: true, reason } 命中時；{ error: false } 未命中
 */
export function detectCliError(
  tailText: string,
): { error: boolean; reason?: string } {
  for (const { name, re } of ERROR_PATTERNS) {
    if (re.test(tailText)) {
      return { error: true, reason: name }
    }
  }
  return { error: false }
}

// ---------------------------------------------------------------------------
// 互動提示特徵規則
// ---------------------------------------------------------------------------

interface PatternRule {
  name: string
  re: RegExp
}

const PROMPT_PATTERNS: PatternRule[] = [
  { name: 'menu_digit',      re: /[❯›]\s*\d+\./u },
  { name: 'yn_prompt',       re: /\(y\/n\)/i },
  { name: 'do_you_trust',    re: /do you trust/i },
  { name: 'resume_summary',  re: /resume from summary/i },
  { name: 'dont_ask_again',  re: /don't ask me again/i },
  { name: 'press_enter',     re: /press enter/i },
  { name: 'continue_q',      re: /continue\?/i },
]

/**
 * 對 PTY 輸出靜止後的尾段純文字（已去 ANSI）進行特徵比對。
 * @param tailText 已去除 ANSI 的尾段文字（建議 2000 chars 以內）
 * @returns { waiting: true, reason } 命中時；{ waiting: false } 未命中
 */
export function detectInteractivePrompt(
  tailText: string,
): { waiting: boolean; reason?: string } {
  for (const { name, re } of PROMPT_PATTERNS) {
    if (re.test(tailText)) {
      return { waiting: true, reason: name }
    }
  }
  return { waiting: false }
}

// ---------------------------------------------------------------------------
// 啟動/上手畫面（benign）—— 開 CLI 必經，非「對話中可由面板回答」的互動
// ---------------------------------------------------------------------------

/**
 * claude 啟動/上手畫面特徵：信任資料夾、安全檢查、歡迎、權限上手等。
 * 這些畫面雖含 `❯ 1.` 之類選單特徵，但屬一次性開場流程（應在終端機處理），
 * 不該在對話欄當成選單/錯誤卡彈出 → 命中則跳過 waiting/error 偵測。
 */
// 注意：claude TUI 以游標定位排版，去 ANSI 後字詞間的空白會消失（"trust this folder"
// → "trustthisfolder"）。故比對前先把所有空白移除，pattern 也寫成無空白形式。
const BENIGN_STARTUP_PATTERNS: RegExp[] = [
  /trustthisfolder/i,
  /doyoutrustthefiles/i,
  /quicksafetycheck/i,
  /isthisaprojectyou/i,
  /bypasspermissions/i,
  /welcometoclaude/i,
]

/** 尾段純文字是否為 claude 開場/上手畫面（去空白後命中任一條即是）。 */
export function isBenignStartupPrompt(stripped: string): boolean {
  const flat = stripped.replace(/\s+/g, '')
  return BENIGN_STARTUP_PATTERNS.some((re) => re.test(flat))
}

// ---------------------------------------------------------------------------
// Menu option extraction
// ---------------------------------------------------------------------------

/** 單一選單選項（value=數字字串, label=顯示文字） */
export interface MenuOption {
  value: string
  label: string
}

/**
 * 比對 "❯ 1. label" / "1. label" / "1) label"。
 * 行首容忍外框雜訊：box-drawing 字元（U+2500–U+257F，如 │ ╭ ─）、ASCII 直線 `|`、
 * 替代游標 `>` 與空白 —— claude CLI 的選單/權限提示是「帶外框的方塊」，每列形如
 * `│ ❯ 1. Yes        │`。舊版只容忍行首空白，導致框線版完全掃不到選項（→ 對話欄
 * 顯示等待卡卻無按鈕，使用者只能進終端機選）。
 */
const RE_MENU_LINE = /^[\s─-╿|>›]*(?:[❯›]\s*)?(\d{1,2})[.)]\s+(\S.{0,79})/u

/** 去除標籤尾端的外框字（框線、直線）與空白，避免抓進 `│` 與填充空白。 */
const RE_TRAILING_BOX = /[\s─-╿|]+$/u

/**
 * 從去 ANSI 後的 PTY 尾段解析數字選單選項。
 * - 逐行掃；同號碼取最後出現者（TUI 重繪殘影取最新）
 * - ≥2 個不同號碼才回傳（避免誤判單行數字）；上限 6 個
 * - label 去頭尾外框/空白並截至 80 字
 */
export function extractMenuOptions(stripped: string): MenuOption[] {
  const byValue = new Map<string, string>()
  for (const line of stripped.split('\n')) {
    const m = RE_MENU_LINE.exec(line)
    if (m) {
      // 去尾框 → 收合連續空白（TUI 雙欄排版的大間距）為單一空白 → 截 80 字。
      const label = m[2].replace(RE_TRAILING_BOX, '').replace(/\s{2,}/g, ' ').slice(0, 80)
      byValue.set(m[1], label)
    }
  }
  if (byValue.size < 2) return []
  return [...byValue.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(0, 6)
    .map(([value, label]) => ({ value, label }))
}

/** 去行首/行尾外框字（框線、直線、游標符）與空白。 */
const RE_LEADING_BOX = /^[\s─-╿|>❯›]+/u

/**
 * 從還原後的螢幕文字抽出「問題/標題」——即第一個選單選項上方、緊鄰的數行說明文字。
 * 用於在對話欄把 CLI 正在問什麼一併顯示（例：「Select model」「Do you want to proceed?」），
 * 否則只有選項按鈕會看不懂在選什麼。
 *
 * 規則：找到第一個選單選項行 → 往上收集非空、非分隔線、非選項的行（去頭尾外框），
 * 遇空白行/分隔線即停（視為區塊邊界）；最多 maxLines 行；回正序合併。
 */
export function extractPromptText(stripped: string, maxLines = 3): string {
  const lines = stripped.split('\n')
  let firstOpt = -1
  for (let i = 0; i < lines.length; i++) {
    if (RE_MENU_LINE.test(lines[i])) {
      firstOpt = i
      break
    }
  }
  if (firstOpt <= 0) return ''
  let i = firstOpt - 1
  // 先跳過「選項與問題之間的空白行」（claude 選單常隔 1 行空白）；最多跳 2 行，避免越界亂抓。
  let skipped = 0
  while (i >= 0 && skipped < 2 && lines[i].trim() === '') {
    i--
    skipped++
  }
  // 往上收集問題行（去外框後非空），遇空白行/分隔線即停（區塊邊界）。
  const collected: string[] = []
  for (; i >= 0 && collected.length < maxLines; i--) {
    if (RE_MENU_LINE.test(lines[i])) continue // 跳過其他選項殘留
    const cleaned = lines[i].replace(RE_LEADING_BOX, '').replace(RE_TRAILING_BOX, '').replace(/\s{2,}/g, ' ').trim()
    if (!cleaned) break // 空白/分隔線 → 區塊邊界，停止
    collected.push(cleaned.slice(0, 200))
  }
  return collected.reverse().join('\n')
}

// ---------------------------------------------------------------------------
// PtyPromptWatcher
// ---------------------------------------------------------------------------

export interface PtyPromptWatcherOptions {
  /** 靜止逾時（ms）；預設 1500 */
  idleMs?: number
  /**
   * 尾段 rolling buffer 最大字元數；預設 8000。
   * TUI 游標重繪（如 claude ask 選單移動）會重複追加選取區塊，
   * 窗口太小會把較早渲染的選項擠出，導致 extractMenuOptions 掃不到。
   * 8000 約可容納多輪重繪而不丟失最初渲染的選項。
   */
  bufferSize?: number
  /** 注入 setTimeout（測試用）；預設 globalThis.setTimeout */
  setTimeout?: typeof globalThis.setTimeout
  /** 注入 clearTimeout（測試用）；預設 globalThis.clearTimeout */
  clearTimeout?: typeof globalThis.clearTimeout
  /**
   * 錯誤特徵偵測的「啟動視窗」（ms）；預設 15000（與 ptyManager EARLY_EXIT_MS 一致）。
   * CLI 啟動/早夭錯誤都在開場數秒內出現；逾此視窗 → 不再比對 ERROR_PATTERNS，
   * 避免正常互動對話中（輸出常含 error:/ENOENT 等字）被持續誤判成 CLI 錯誤。
   * waiting（選單/提示）偵測不受此限，全程有效。
   */
  errorWindowMs?: number
  /**
   * 啟動暖機（ms）；預設 0（不暖機），由 ptyManager 於正式環境設為 5000。
   * spawn 後此段時間內不偵測任何 waiting/error——claude 開場會渲染 banner、信任資料夾畫面、
   * MCP 連線訊息等大量過場內容，易把這些過場誤判成選單/錯誤而在對話欄彈卡。暖機過後這些
   * 靜態畫面已不再有新資料、不會再觸發 idle 偵測，故等於把開場雜訊整段濾掉；真正對話中
   * 出現的選單仍照常偵測。
   */
  warmupMs?: number
  /** 注入時鐘（測試用）；預設 () => Date.now()。供啟動視窗 / 暖機計時。 */
  now?: () => number
  /**
   * 將原始 rolling buffer 轉成可偵測的純文字；預設 stripAnsi。
   * 正式環境由 ptyManager 注入「以無頭終端機還原螢幕」的版本——claude TUI 以游標絕對定位
   * 排版（如 \x1b[15G），單純 stripAnsi 會丟失字詞間空白，導致選單選項解析失敗（對話欄
   * 跳不出可點選項）；改以終端機網格還原，可得到含正確空白的可見文字。
   */
  render?: (raw: string) => string
}

/**
 * 持續接收 PTY chunk，偵測互動提示與 CLI 錯誤。
 *
 * 邏輯：
 *   - 每次 onData → 加入 rolling buffer → 取消並重設 idle timer
 *   - 若目前狀態為 waiting 或 error → 呼叫 onActive() 並重置旗標
 *   - idle timer 到期 → 對 buffer 尾段去 ANSI：
 *     1. 先比對 ERROR_PATTERNS → 命中 → 呼叫 onError(reason)，記錄旗標
 *     2. 再比對 PROMPT_PATTERNS → 命中 → 呼叫 onWaiting(reason)，記錄旗標
 *   - dispose() → 清 timer，防止洩漏
 */
export class PtyPromptWatcher {
  private readonly _idleMs: number
  private readonly _bufferSize: number
  private readonly _setTimeout: typeof globalThis.setTimeout
  private readonly _clearTimeout: typeof globalThis.clearTimeout
  private readonly _errorWindowMs: number
  private readonly _warmupMs: number
  private readonly _now: () => number
  private readonly _startedAt: number
  private readonly _render: (raw: string) => string

  private _buffer = ''
  private _timer: ReturnType<typeof globalThis.setTimeout> | null = null
  private _isWaiting = false
  private _isError = false
  private _disposed = false

  constructor(
    private readonly _onWaiting: (reason: string, options?: MenuOption[], prompt?: string) => void,
    private readonly _onActive: () => void,
    opts: PtyPromptWatcherOptions = {},
    private readonly _onError?: (reason: string) => void,
  ) {
    this._idleMs = opts.idleMs ?? 1500
    this._bufferSize = opts.bufferSize ?? 8000
    this._setTimeout = opts.setTimeout ?? globalThis.setTimeout
    this._clearTimeout = opts.clearTimeout ?? globalThis.clearTimeout
    this._errorWindowMs = opts.errorWindowMs ?? 15_000
    this._warmupMs = opts.warmupMs ?? 0
    this._now = opts.now ?? (() => Date.now())
    this._startedAt = this._now()
    this._render = opts.render ?? stripAnsi
  }

  /** 餵入新 PTY 資料 chunk */
  onData(chunk: string): void {
    if (this._disposed) return

    // 若目前處於 waiting 或 error 狀態，「帶可見內容」的新資料才視為活動 → 恢復 active。
    // 純控制序列（游標閃爍/隱顯等，去 ANSI 後無可見字元）不解除——否則靜態提示畫面下
    // 每次閃爍都 active→idle→waiting 來回翻轉，對話欄的卡片就會反覆閃現（「一直顯示」）。
    if (this._isWaiting || this._isError) {
      if (stripAnsi(chunk).trim().length > 0) {
        this._isWaiting = false
        this._isError = false
        this._onActive()
      }
    }

    // 更新 rolling buffer（保留尾段 _bufferSize chars）
    this._buffer += chunk
    if (this._buffer.length > this._bufferSize) {
      this._buffer = this._buffer.slice(-this._bufferSize)
    }

    // 重設 idle timer
    if (this._timer !== null) {
      this._clearTimeout(this._timer)
    }
    this._timer = this._setTimeout(() => {
      this._onIdle()
    }, this._idleMs)
  }

  private _onIdle(): void {
    if (this._disposed || this._isWaiting || this._isError) return
    const elapsed = this._now() - this._startedAt
    // 啟動暖機：開場 banner / 信任畫面 / MCP 連線等過場一律不偵測（見 warmupMs 註解）。
    if (elapsed < this._warmupMs) return
    const stripped = this._render(this._buffer)
    // 啟動/上手畫面（信任資料夾等）即使暖機後仍殘留在 buffer，也不彈卡（時序無關的保險）。
    if (isBenignStartupPrompt(stripped)) return
    // 先查 error，再查 waiting（error 優先）。但 error 偵測僅在啟動視窗內有效——
    // 逾窗後 CLI 已正常互動，輸出常含 error:/ENOENT 等字樣（討論錯誤、貼 log），
    // 持續比對會把對話內容誤判成 CLI 錯誤而「一直報錯」。
    if (elapsed < this._errorWindowMs) {
      const errResult = detectCliError(stripped)
      if (errResult.error) {
        this._isError = true
        this._onError?.(errResult.reason ?? 'unknown')
        return
      }
    }
    const result = detectInteractivePrompt(stripped)
    if (result.waiting) {
      this._isWaiting = true
      const options = extractMenuOptions(stripped)
      const prompt = extractPromptText(stripped)
      this._onWaiting(
        result.reason ?? 'unknown',
        options.length > 0 ? options : undefined,
        prompt || undefined,
      )
    }
  }

  /** 釋放資源（kill/killAll 時呼叫，防 timer 洩漏） */
  dispose(): void {
    this._disposed = true
    if (this._timer !== null) {
      this._clearTimeout(this._timer)
      this._timer = null
    }
  }
}
