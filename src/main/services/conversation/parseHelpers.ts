/**
 * parseHelpers.ts — conversationStore 的內部解析 helper（純函式，無狀態）。
 *
 * 從 conversationStore.ts 原樣搬出（move-only，行為保留）：
 *   - 段界判斷（end-driven；需與 renderer helpers.tsx 的 isTypedUser/isEndMessage/segLabelOf 同步）。
 *   - 帶 byte span 的增量 JSON 物件消費（_consumeJsonObjectsWithSpans + SpanItem）。
 *
 * 這些函式皆為 module-private（前綴 _），原本只被 ConversationStore 內部使用；
 * 抽到 sibling 後由 facade（conversationStore.ts）import 回去委派，對外介面不變。
 */

import type { ConversationMessage } from '../../../shared/ipcContracts'

// ---------------------------------------------------------------------------
// 段界判斷（end-driven；需與 renderer helpers.tsx 的 isTypedUser/isEndMessage/segLabelOf 同步）
// ---------------------------------------------------------------------------

export function _extractCommandName(text: string): string {
  const match = text.match(/<command-name>([\s\S]*?)<\/command-name>/)
  return match ? match[1].trim() : ''
}

/**
 * 判斷一則訊息是否為「typed 使用者輸入」（end-driven 分段的開段候選）。
 * （需與 renderer helpers.tsx 的 isTypedUser 同步。）
 *
 * 註：舊規則曾用 `!_isInterrupt(blocks)` 文字比對排除「[Request interrupted」。
 * end-driven 下不需要——中斷記錄現在由 parser（B1）標為 source==='interrupt'，
 * 不會是 'typed'/'command'，本函式天然不收；且 interrupt 反而是 END 訊息（見 _isEndMessage）。
 */
export function _isTypedUser(m: ConversationMessage): boolean {
  return m.role === 'user' && (m.source === 'typed' || m.source === 'command')
}

/**
 * 判斷一則訊息是否為「明確結尾」（end-driven 分段的 END 訊息）。
 * （需與 renderer helpers.tsx 的 isEndMessage 同步。）
 *
 * END 條件（任一成立；多標無害，synthetic 注入對的第二元素含入不必排除）：
 *   - role==='system' && turnDuration（turn 結束分隔線）
 *   - source==='interrupt'（Esc 中斷記錄）
 *   - stopReason==='stop_sequence'（assistant 靜默結束）
 */
export function _isEndMessage(m: ConversationMessage): boolean {
  return (
    (m.role === 'system' && m.turnDuration != null) ||
    m.source === 'interrupt' ||
    m.stopReason === 'stop_sequence'
  )
}

/**
 * 取段落標籤、是否 command 及開段訊息的語意型別（需與 renderer helpers.tsx 的 segLabelOf 同步）。
 *
 * v13 起，開段訊息只會是 typed 或 command（_isTypedUser 限定），故 head_kind 實際只出現這兩值。
 * head_kind 欄位定義（typed/command/notify/other）保留，作為型別說明；notify/other 分支已移除
 * （notify 不再開段，故不會到此；other 同）。
 */
export function _segLabelOf(m: ConversationMessage): { label: string; is_command: number; head_kind: string } {
  const text = m.blocks.find((b) => b.kind === 'text')?.text ?? ''
  if (m.source === 'command') {
    const cmd = _extractCommandName(text)
    return { label: cmd || '(command)', is_command: 1, head_kind: 'command' }
  }
  // typed 使用者輸入預覽 ~30 字（v13：只有 typed/command 可到此，其他訊息不開段）
  const t = text.replace(/\s+/g, ' ').trim()
  const label = t.length > 30 ? t.slice(0, 30) + '…' : t
  return { label: label || '(typed)', is_command: 0, head_kind: 'typed' }
}

// ---------------------------------------------------------------------------
// 帶 byte span 的增量 JSON 物件消費（conv_messages 已刪，改以 byte 範圍重讀，
// 故解析時必須一併取得每筆 record 的 byte 起迄）。
// 與 jsonl.ts consumeJsonObjects 同一套括號深度掃描（字串/跳脫感知、多行縮排），
// 差別只在額外回報每個物件在 chunk 內的「char 起迄」。jsonl.ts 不提供 span，
// 且本檔約束只動 conversationStore.ts，故在此實作 span 變體，不改 jsonl.ts。
// ---------------------------------------------------------------------------

export interface SpanItem {
  value: unknown
  /** 物件在傳入 text 內的 char 起始（含）。 */
  startChar: number
  /** 物件在傳入 text 內的 char 結尾（exclusive）。 */
  endChar: number
}

export function _consumeJsonObjectsWithSpans(text: string): { items: SpanItem[]; rest: string } {
  const items: SpanItem[] = []
  const n = text.length
  let i = 0
  while (i < n) {
    if (text[i] !== '{') {
      i++
      continue
    }
    // 括號深度掃描找物件結束（字串/跳脫感知）
    let depth = 0
    let inStr = false
    let escape = false
    let endPos = -1
    for (let j = i; j < n; j++) {
      const c = text[j]
      if (escape) {
        escape = false
        continue
      }
      if (c === '\\' && inStr) {
        escape = true
        continue
      }
      if (c === '"') {
        inStr = !inStr
        continue
      }
      if (inStr) continue
      // JSONL 頂層必為物件，外層 while 已跳過非 '{' 起始字元，故 '['/']' 分支永不觸發。
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          endPos = j + 1
          break
        }
      }
    }
    if (endPos === -1) {
      // 未閉合（寫入中）→ 殘段留待下次（含可能被切斷的多位元組字元）
      return { items, rest: text.slice(i) }
    }
    try {
      items.push({ value: JSON.parse(text.slice(i, endPos)), startChar: i, endChar: endPos })
      i = endPos
    } catch {
      // 壞片段：跳過此 '{' 繼續（與 jsonl.ts consumeJsonObjects 容錯一致）
      i++
    }
  }
  return { items, rest: '' }
}
