import React from 'react'
import type { ConversationMessage, ConvBlock } from '../../../../shared/ipcContracts'

/** 讓深層 SubagentGroup 取得 sessionId，避免 prop drilling。 */
export const SessionIdContext = React.createContext('')

/**
 * 收合態 subagent 總量 Context。
 * key = tool_use_id（tool_result block 的 tool_use_id 欄位）
 * value = 對應的 subagentStats（totalTokens / input / output / durationMs）。
 * 由 ConversationPanel 掃所有已載入訊息的 blocks 建立 map，以 Provider 向下傳遞。
 * SubagentGroup 用自己的 toolUseId 查此 map，在收合態顯示 token 總量。
 */
export const DispatchStatsContext = React.createContext<
  Map<string, NonNullable<ConvBlock['subagentStats']>>
>(new Map())

/** text block 截斷長度（對應 viewer MAX_CONTENT_LEN 精神，側欄窄故取小值）。 */
export const TEXT_TRUNC = 1500

/** subagent 派遣工具名（對應 viewer detectDispatches 判斷規則）。 */
export const SUBAGENT_TOOL_NAMES = new Set(['Task', 'Agent'])

/** AskUserQuestion 工具名（問答卡偵測用）。 */
export const ASK_TOOL_NAME = 'AskUserQuestion'

/**
 * Ask 問答答案 Context。
 * key = tool_use_id（AskUserQuestion tool_use block 的 id）；
 * value = 解析後的「題=答」對應表（題文 → 使用者答案）。
 * 由 ConversationPanel 掃 pool 內 tool_result block 建立，Provider 向下傳遞；
 * Ask 問答卡用自己的 tool_use_id 查此 map，在對應選項標 ✓。
 */
export const AskAnswersContext = React.createContext<Map<string, Record<string, string>>>(new Map())

/**
 * AskUserQuestion 回答 callback Context。
 * 由 ConversationPanel 接收 SessionTab 傳入的 onAnswerAsk prop 後，以 Provider 向下傳遞；
 * AskCard 取用後在使用者點選選項時呼叫，送出 (toolUseId, 1-based 選項序號, 選項文字)。
 * 預設 no-op，未提供時靜默。
 */
export const AskAnswerCallbackContext = React.createContext<
  (toolUseId: string, optionIndex: number, label: string) => void
>(() => {})

/**
 * 依 agentId 字串雜湊出 0–359 的色相值，讓不同 subagent 有穩定不同的顏色。
 * 出處：參考 app.html agentHue（約 2426–2433 行）。
 * 避開 210–240（與主題 accent 藍撞色）：raw < 210 直接用；210–299 → 250–339。
 */
export function agentHue(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) & 0x7fffffff
  }
  const raw = h % 300
  return raw < 210 ? raw : raw + 40
}

/** 時間 → HH:MM:SS（當地時區）。 */
export function fmtTime(ts?: string): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

/** 壓空白 + 截斷預覽（對應 viewer preview）。 */
export function previewOf(text: string, maxLen = 30): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > maxLen ? t.slice(0, maxLen) + '…' : t
}

/** 毫秒 → 人讀時長（對應 viewer fmtDurationMs）。 */
export function fmtDurationMs(ms: number): string {
  if (!isFinite(ms) || ms < 0) return '—'
  if (ms < 1000) return Math.round(ms) + 'ms'
  const s = ms / 1000
  if (s < 60) return s.toFixed(1) + 's'
  const totalSec = Math.round(s)
  const m = Math.floor(totalSec / 60)
  const rem = totalSec % 60
  if (m < 60) return `${m}m${String(rem).padStart(2, '0')}s`
  const h = Math.floor(m / 60)
  return `${h}h${String(m % 60).padStart(2, '0')}m`
}

/** 緊湊數字格式（≥1000 → 1 位小數 k；側欄窄，與 app.html numFmt 差異：app.html 用 toLocaleString 全數字，本實作縮短）。 */
export function numCompact(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

export interface SegItem {
  m: ConversationMessage
  key: number
}

/**
 * 將段落內的 SegItem 列表依連續 assistant/meta 訊息分組。
 *
 * 規則：
 *   - META 卡（source==='meta'）視為 run 成員，不打斷連續 AI 計數。
 *   - 含 subagent 派遣 block 的 assistant 卡強制 single，讓子對話群組頂層可見；
 *     此類卡前後的其他 assistant 卡各自成獨立 run（派遣卡切斷 run）。
 *   - 連續 ≥2 張 run 成員卡 → `{ kind: 'run'; items }` 群組。
 *   - 單張 run 成員卡或任何 user 卡 → `{ kind: 'single'; item }` 保持平鋪。
 *
 * 用途：SegmentGroup body 與 ConversationPanel preamble 共用，
 * 讓同一個 run（AI 連續回應）視覺上被 AiRunGroup 收攏。
 */
/** 結尾分隔線四型（決定 label 與配色 token）。 */
export type EndDividerKind = 'turn' | 'interrupt' | 'reconnect' | 'silent'

/** synthetic 重連配對的 meta user 內文特徵（此 user 抑制不顯示，與 synthetic 合併為一條 🚪）。 */
const RECONNECT_META_TEXT = 'Continue from where you left off.'
/** 真 assistant stop_sequence「靜默完成」的特徵內文（卡抑制，只渲染 silent 分隔線）。 */
const SILENT_STOP_TEXT = 'No response requested.'

/** 取訊息第一個 text block 內文（trim）。 */
function firstText(m: ConversationMessage): string {
  return (m.blocks.find((b) => b.kind === 'text')?.text ?? '').trim()
}

/**
 * 判定一則訊息應產生哪一型結尾分隔線（無則 null）。
 *   - system + turnDuration → 'turn'
 *   - source==='interrupt' → 'interrupt'
 *   - synthetic assistant → 'reconnect'
 *   - 真 assistant（!synthetic）stopReason==='stop_sequence' 且內文恰為「No response requested.」→ 'silent'
 * 註：有實質內容的 stop_sequence assistant（卡照常 + 卡後 silent）由 cardThenSilent() 另判，不在此回傳。
 */
export function endDividerKindOf(m: ConversationMessage): EndDividerKind | null {
  if (m.role === 'system' && m.turnDuration != null) return 'turn'
  if (m.source === 'interrupt') return 'interrupt'
  if (m.role === 'assistant' && m.synthetic === true) return 'reconnect'
  if (
    m.role === 'assistant' &&
    !m.synthetic &&
    m.stopReason === 'stop_sequence' &&
    firstText(m) === SILENT_STOP_TEXT
  ) {
    return 'silent'
  }
  return null
}

/** 是否為「卡照常顯示 + 卡後補 silent 分隔線」的 stop_sequence assistant（有實質內容）。 */
export function cardThenSilent(m: ConversationMessage): boolean {
  return (
    m.role === 'assistant' &&
    !m.synthetic &&
    m.stopReason === 'stop_sequence' &&
    firstText(m) !== SILENT_STOP_TEXT &&
    endDividerKindOf(m) == null
  )
}

/** 是否為 synthetic 重連配對、應抑制的 meta user（內文含 Continue from where you left off.）。 */
function isReconnectMeta(m: ConversationMessage): boolean {
  return m.source === 'meta' && firstText(m).includes(RECONNECT_META_TEXT)
}

/**
 * 是否為可渲染的 AskUserQuestion 問答卡。
 * 條件：assistant 含 name==='AskUserQuestion'、有 id 的 tool_use block，
 *       且其 input 能 JSON.parse 出非空 questions[]（否則退回現行 collapsible 卡，§B.4 容錯）。
 */
export function isAskQuestion(m: ConversationMessage): boolean {
  if (m.role !== 'assistant') return false
  const b = m.blocks.find((x) => x.kind === 'tool_use' && x.name === ASK_TOOL_NAME && !!x.id)
  if (!b) return false
  try {
    const parsed = JSON.parse(b.text) as { questions?: unknown[] }
    return Array.isArray(parsed.questions) && parsed.questions.length > 0
  } catch {
    return false
  }
}

/**
 * 是否為「已被 Ask 問答卡配對吸收」而應整則抑制的 tool_result 答案訊息。
 * 條件：訊息僅含 tool_result block 且全部以「Your questions have been answered:」開頭，
 *       且其 tool_use_id 命中 askIds（pool 中存在對應的 Ask 問答 tool_use）。
 */
export function isAskAnswerOnly(m: ConversationMessage, askIds: Set<string>): boolean {
  if (m.blocks.length === 0) return false
  return m.blocks.every(
    (b) =>
      b.kind === 'tool_result' &&
      !!b.tool_use_id &&
      askIds.has(b.tool_use_id) &&
      b.text.startsWith('Your questions have been answered:'),
  )
}

/**
 * 解析 AskUserQuestion 答案 tool_result 內文成「題 → 答」map。
 * 格式（research §1-b）：Your questions have been answered: "題"="答", "題"="答". You can now...
 * 以 regex 抓所有 "…"="…" 對；解析不到回空物件（容錯）。
 */
export function parseAskAnswers(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  // 非貪婪抓引號內題文與答文（題與答之間以 = 連接）
  const re = /"([^"]*)"\s*=\s*"([^"]*)"/g
  let mt: RegExpExecArray | null
  while ((mt = re.exec(content)) !== null) {
    out[mt[1]] = mt[2]
  }
  return out
}

/** 從訊息列表蒐集所有 AskUserQuestion tool_use 的 id 集合（答案抑制判定用）。 */
export function collectAskIds(items: SegItem[]): Set<string> {
  const ids = new Set<string>()
  for (const { m } of items) {
    for (const b of m.blocks) {
      if (b.kind === 'tool_use' && b.name === ASK_TOOL_NAME && b.id) ids.add(b.id)
    }
  }
  return ids
}

/**
 * 結尾分隔線元件（取代舊 TurnDivider，支援四型）。
 * - turn：⏱ 時長 · N 則（muted，沿用舊 turn-divider 樣式）
 * - interrupt：⛔ 使用者中斷（警示色 --error 系）
 * - reconnect：🚪 連線恢復（muted）
 * - silent：⏹ 回合結束（最淡）
 * 相鄰多條合併時，labels 多段以 · 串接（由 buildRenderSeq 預先合併）。
 * 細橫線左右延伸 + 中央小字、走 token、不可點。
 */
export function EndDivider({
  kind,
  labels,
}: {
  /** 主導型別（決定配色；合併時取第一條的型別）。 */
  kind: EndDividerKind
  /** 一或多段 label（合併相鄰分隔線）。 */
  labels: string[]
}): React.JSX.Element {
  return (
    <div className={`end-divider end-divider--${kind}`}>
      <span className="end-divider__label">{labels.join(' · ')}</span>
    </div>
  )
}

/** 由 (kind, message) 算出該分隔線的 label 文字。 */
export function endDividerLabel(kind: EndDividerKind, m: ConversationMessage): string {
  switch (kind) {
    case 'turn': {
      const { durationMs, messageCount } = m.turnDuration ?? { durationMs: 0 }
      return messageCount != null
        ? `⏱ ${fmtDurationMs(durationMs)} · ${messageCount} 則`
        : `⏱ ${fmtDurationMs(durationMs)}`
    }
    case 'interrupt':
      return '⛔ 使用者中斷'
    case 'reconnect':
      return '🚪 連線恢復'
    case 'silent':
      return '⏹ 回合結束'
  }
}

/**
 * 向後相容：舊呼叫點 <TurnDivider m={m} /> 改走 EndDivider。
 * 僅處理 system/turnDuration（turn 型）；其餘回 null。
 */
export function TurnDivider({ m }: { m: ConversationMessage }): React.JSX.Element | null {
  if (!m.turnDuration) return null
  return <EndDivider kind="turn" labels={[endDividerLabel('turn', m)]} />
}

/** buildRenderSeq 產出的渲染項：卡 / AI run 群組 / 結尾分隔線 / Ask 問答卡。 */
export type RenderEntry =
  | { kind: 'card'; item: SegItem }
  | { kind: 'run'; items: SegItem[] }
  | { kind: 'divider'; dKind: EndDividerKind; labels: string[]; key: number }
  | { kind: 'ask'; item: SegItem }

/**
 * 把段內 SegItem 列表轉成最終渲染序列，集中處理：
 *   1. 訊息 → 結尾分隔線判定（turn/interrupt/reconnect/silent），對應卡抑制；
 *   2. synthetic 重連配對的 meta user 抑制（與 reconnect 合一）；
 *   3. Ask 問答卡獨立（不進 run）、其答案 tool_result 訊息整則抑制；
 *   4. 連續 AI 卡群組化（沿用 groupAssistantRuns 語意，但本函式自行判定切斷）；
 *   5. 相鄰結尾分隔線合併成一條（labels 串接、型別取第一條）。
 *
 * askIds：pool 中所有 Ask 問答 tool_use 的 id 集合（供答案訊息抑制判定）。
 */
export function buildRenderSeq(items: SegItem[], askIds: Set<string>): RenderEntry[] {
  // 步驟 A：先壓成 (card-like | divider) 線性序列（含 run 切斷、卡/分隔線判定、抑制）。
  type Lin =
    | { t: 'item'; item: SegItem; runnable: boolean }
    | { t: 'divider'; dKind: EndDividerKind; label: string; key: number }
  const lin: Lin[] = []

  for (const it of items) {
    const m = it.m

    // 抑制：synthetic 重連配對的 meta user（併入 🚪）
    if (isReconnectMeta(m)) continue
    // 抑制：Ask 答案 tool_result 訊息（已配對給 Ask 卡）
    if (isAskAnswerOnly(m, askIds)) continue

    const dKind = endDividerKindOf(m)
    if (dKind) {
      // interrupt/turn/reconnect/silent → 分隔線；對應卡抑制（不渲染成 user/assistant 卡）
      lin.push({ t: 'divider', dKind, label: endDividerLabel(dKind, m), key: it.key })
      continue
    }

    // Ask 問答卡：獨立（不進 run，比照派遣卡）
    if (isAskQuestion(m)) {
      lin.push({ t: 'item', item: it, runnable: false })
      continue
    }

    // 含派遣 block 的 assistant 卡：強制 single（不進 run）
    const hasDispatch = m.blocks.some(
      (b) => b.kind === 'tool_use' && SUBAGENT_TOOL_NAMES.has(b.name ?? '') && b.id,
    )
    // run 成員：真 assistant（非 synthetic）、meta user 或 notify（通知訊息摺進 AI run 群組）；
    // notify = promptSource=system 的 harness 注入訊息（背景任務完成通知），不單獨顯示；派遣卡與 Ask 卡除外
    const runnable = (m.role === 'assistant' || m.source === 'meta' || m.source === 'notify') && !hasDispatch
    lin.push({ t: 'item', item: it, runnable })

    // 有實質內容的 stop_sequence assistant：卡照常 + 卡後補 silent 分隔線
    if (cardThenSilent(m)) {
      lin.push({ t: 'divider', dKind: 'silent', label: endDividerLabel('silent', m), key: it.key })
    }
  }

  // 步驟 B：壓相鄰 divider + 連續 runnable item 群組化 → RenderEntry[]
  const out: RenderEntry[] = []
  let runBuf: SegItem[] = []
  const flushRun = () => {
    if (runBuf.length >= 2) out.push({ kind: 'run', items: runBuf })
    else if (runBuf.length === 1) out.push({ kind: 'card', item: runBuf[0] })
    runBuf = []
  }

  for (const node of lin) {
    if (node.t === 'divider') {
      flushRun()
      const prev = out[out.length - 1]
      if (prev && prev.kind === 'divider') {
        // 相鄰分隔線合併：labels 串接；型別維持第一條（主導配色）
        prev.labels.push(node.label)
      } else {
        out.push({ kind: 'divider', dKind: node.dKind, labels: [node.label], key: node.key })
      }
    } else if (node.runnable) {
      runBuf.push(node.item)
    } else {
      flushRun()
      // Ask 問答卡 vs 一般單卡
      out.push(isAskQuestion(node.item.m) ? { kind: 'ask', item: node.item } : { kind: 'card', item: node.item })
    }
  }
  flushRun()

  return out
}

export function groupAssistantRuns(
  items: SegItem[],
): Array<{ kind: 'single'; item: SegItem } | { kind: 'run'; items: SegItem[] }> {
  const result: Array<{ kind: 'single'; item: SegItem } | { kind: 'run'; items: SegItem[] }> = []
  let runBuf: SegItem[] = []

  // 緩衝區滿足條件時 flush 到 result
  const flushRun = () => {
    if (runBuf.length >= 2) {
      result.push({ kind: 'run', items: runBuf })
    } else if (runBuf.length === 1) {
      result.push({ kind: 'single', item: runBuf[0] })
    }
    runBuf = []
  }

  // 判斷是否含 subagent 派遣 block（Task/Agent tool_use 且有 id）
  // 此類卡需強制 single，讓 SubagentGroup 在頂層顯示，不被 AiRunGroup 吸收
  const hasDispatch = (item: SegItem): boolean =>
    item.m.blocks.some(
      (b) => b.kind === 'tool_use' && SUBAGENT_TOOL_NAMES.has(b.name ?? '') && b.id,
    )

  for (const item of items) {
    // system 卡（turn_duration 分隔線）：天然落在 turn 尾端；flush 前段緩衝，以 single 輸出。
    // 渲染層會把 role==='system' && turnDuration != null 的 single 改畫 TurnDivider。
    if (item.m.role === 'system') {
      flushRun()
      result.push({ kind: 'single', item })
    // META 卡（source==='meta'）：視為 run 成員，不打斷連續 AI
    // assistant 卡但含派遣 block：強制 single，先 flush 前面緩衝再直接 push
    } else if (item.m.role === 'assistant' || item.m.source === 'meta') {
      if (item.m.role === 'assistant' && hasDispatch(item)) {
        // 派遣卡切斷 run：flush 前段 → single 派遣卡 → 後續重新起算
        flushRun()
        result.push({ kind: 'single', item })
      } else {
        runBuf.push(item)
      }
    } else {
      // user 卡：先把前面的緩衝 flush，再 push 當前
      flushRun()
      result.push({ kind: 'single', item })
    }
  }
  // 尾端殘留
  flushRun()

  return result
}
export interface Seg {
  kind: 'preamble' | 'segment'
  n: number
  label: string
  isCommand: boolean
  /** 開段訊息語意型別（v12）：取代舊 label.startsWith('🔔') 嗅探；legacy 路徑由 buildSegments 填入。 */
  headKind: 'typed' | 'command' | 'notify' | 'other'
  durationText: string
  items: SegItem[]
}

export function isInterrupt(m: ConversationMessage): boolean {
  const t = m.blocks.find((b) => b.kind === 'text')?.text ?? ''
  return t.includes('[Request interrupted')
}

export function extractCommandName(text: string): string {
  const match = text.match(/<command-name>([\s\S]*?)<\/command-name>/)
  return match ? match[1].trim() : ''
}

/**
 * 是否為「typed 使用者輸入」（end-driven 分段的開段候選）。
 * 需與 store conversationStore.ts 的 _isTypedUser 同步。
 * （中斷記錄由 parser 標 source==='interrupt'，不會是 typed/command，故不需 isInterrupt 排除。）
 */
export function isTypedUser(m: ConversationMessage): boolean {
  return m.role === 'user' && (m.source === 'typed' || m.source === 'command')
}

/**
 * 是否為「明確結尾」（end-driven 分段的 END 訊息）。
 * 需與 store conversationStore.ts 的 _isEndMessage 同步。
 * 任一成立（多標無害）：system+turnDuration / source==='interrupt' / stopReason==='stop_sequence'。
 */
export function isEndMessage(m: ConversationMessage): boolean {
  return (
    (m.role === 'system' && m.turnDuration != null) ||
    m.source === 'interrupt' ||
    m.stopReason === 'stop_sequence'
  )
}

/**
 * 取段落標籤與語意型別（需與 store conversationStore.ts 的 _segLabelOf 同步）。
 *
 * v13 起，開段訊息只會是 typed 或 command（_isTypedUser 限定），故 headKind 實際只出現這兩值。
 * headKind 欄位（typed/command/notify/other）保留，作為型別說明；notify/other 分支已移除。
 */
export function segLabelOf(m: ConversationMessage): { label: string; isCommand: boolean; headKind: Seg['headKind'] } {
  const text = m.blocks.find((b) => b.kind === 'text')?.text ?? ''
  if (m.source === 'command') {
    return { label: extractCommandName(text) || '(command)', isCommand: true, headKind: 'command' }
  }
  // typed 使用者輸入預覽 ~30 字（v13：只有 typed/command 可到此）
  return { label: previewOf(text, 30) || '(typed)', isCommand: false, headKind: 'typed' }
}

/**
 * 前端推段（從平鋪 messages 推出段落結構）。
 *
 * **雙路徑說明**：新路徑（段落索引）由後端 conv_segments 表提供段骨架，
 * 不再用本函式。但 stale-preload 退回舊路徑（新 IPC 未掛載 → 用 getConversation
 * 拿尾端 300）時，仍需本函式在前端推段平鋪。故保留。
 *
 * **v13 最終規格（需與 store conversationStore.ts _persist 狀態機同步）**：
 * 開段條件：endSeen===true && isTypedUser(m)（typed/command）。
 *   - endSeen 初始 true；
 *   - endSeen===true 但非 isTypedUser（notify/assistant 等）→ 前言或續段，不開新段；
 *   - endSeen===false 時任何訊息（含插隊 typed）併入當前段不裂段；
 *   - isEndMessage(m)（段尾）→ 處理完後設 endSeen=true。
 * 前言：第一個開段訊息（isTypedUser）之前的記錄歸 preamble（kind==='preamble'）。
 * 註：此處只切到尾端 300（stale-preload），endSeen 不需跨重啟（store 端才需要持久化）。
 */
export function buildSegments(messages: ConversationMessage[]): Seg[] {
  const segs: Seg[] = []
  let cur: Seg | null = null
  let n = 0
  let endSeen = true
  messages.forEach((m, i) => {
    if (endSeen && isTypedUser(m)) {
      // 開段條件：已見結尾 + 用戶發話（typed/command）
      n++
      const { label, isCommand, headKind } = segLabelOf(m)
      cur = { kind: 'segment', n, label, isCommand, headKind, durationText: '', items: [] }
      segs.push(cur)
      endSeen = false
    }
    if (!cur) {
      // 前言：尚未見到第一個 typed/command 開段前的訊息（notify/assistant 等）
      let pre = segs[segs.length - 1]
      if (!pre || pre.kind !== 'preamble') {
        pre = { kind: 'preamble', n: 0, label: '', isCommand: false, headKind: 'other', durationText: '', items: [] }
        segs.push(pre)
      }
      pre.items.push({ m, key: i })
    } else {
      cur.items.push({ m, key: i })
    }
    // END 訊息已併入當前段（段尾）；處理完後設 endSeen，下一則 typed/command 才開新段。
    if (isEndMessage(m)) endSeen = true
  })
  // 時長 = 段首尾 timestamp 差（標 ~；viewer 用 turn_duration.durationMs，本流以時間差近似）
  for (const s of segs) {
    if (s.kind !== 'segment' || s.items.length < 2) continue
    const t0 = s.items[0].m.timestamp
    const t1 = s.items[s.items.length - 1].m.timestamp
    if (t0 && t1) {
      const d = Date.parse(t1) - Date.parse(t0)
      if (isFinite(d) && d >= 0) s.durationText = '⏱ ~' + fmtDurationMs(d)
    }
  }
  return segs
}
