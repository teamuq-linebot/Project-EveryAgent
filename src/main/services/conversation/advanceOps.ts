/**
 * advanceOps.ts — ConversationStore 增量解析核心（move-only，行為保留）。
 *
 * 從 conversationStore.ts 原樣搬出：
 *   - advance   原 _advance：讀 [consumedPos, size) 新 bytes → 解析帶 span 的 record →
 *               映射 ConversationMessage（保留 byte span）→ 推進 nextSeq / persist 段索引。
 *               回傳本輪新增的訊息（含 span），供記憶體視窗 append。
 *
 * 所有方法本體原樣搬移，不改任何邏輯、常數、控制流。
 */

import * as fs from 'fs'
import type { ConversationMessage } from '../../../shared/ipcContracts'
import { _consumeJsonObjectsWithSpans } from './parseHelpers'
import { persist, type MemEntry, type MsgWithSpan, type DbState } from './dbOps'

/** 逐筆 record → ConversationMessage 的解析器簽名（與 conversationStore.ts 相同）。 */
type RecordParser = (rec: Record<string, unknown>) => ConversationMessage | null

const MEM_KEEP = 600 // 記憶體保留上限（超過砍到 450）—— 與 conversationStore.ts 相同常數

// ---------------------------------------------------------------------------
// advance（原 _advance）
// ---------------------------------------------------------------------------

/**
 * 增量解析核心：讀 [consumedPos, size) 新 bytes → 解析帶 span 的 record →
 * 映射 ConversationMessage（保留 byte span）→ 推進 nextSeq / persist 段索引。
 * 回傳本輪新增的訊息（含 span），供記憶體視窗 append。
 */
export function advance(
  file: string,
  entry: MemEntry,
  size: number,
  parser: RecordParser,
  state: DbState,
): MsgWithSpan[] {
  if (size <= entry.consumedPos) return []
  const base = entry.consumedPos
  let text = ''
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const len = size - base
      const buf = Buffer.alloc(len)
      const n = fs.readSync(fd, buf, 0, len, base)
      text = buf.subarray(0, n).toString('utf-8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return []
  }

  const { items, rest } = _consumeJsonObjectsWithSpans(text)
  // 進度推進到「最後一筆完整 record 結束」：已消費前綴的 byte 長
  // （前綴必為合法字元；分裂的多位元組字元只會出現在 rest 內，不影響）。
  const consumedStr = text.slice(0, text.length - rest.length)
  entry.consumedPos = base + Buffer.byteLength(consumedStr, 'utf-8')

  const newMessages: MsgWithSpan[] = []
  for (const it of items) {
    const o = it.value
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue
    const m = parser(o as Record<string, unknown>)
    if (!m) continue
    // chunk 內 char 起迄 → 全檔 byte 起迄（base + 前綴 byte 長）。
    const startPos = base + Buffer.byteLength(text.slice(0, it.startChar), 'utf-8')
    const endPos = base + Buffer.byteLength(text.slice(0, it.endChar), 'utf-8')
    newMessages.push({ msg: m, startPos, endPos })
  }

  entry.nextSeq += newMessages.length
  if (newMessages.length > 0) {
    entry.messages.push(...newMessages.map((x) => x.msg))
    if (entry.messages.length > MEM_KEEP) entry.messages = entry.messages.slice(-450)
  }
  persist(file, entry, newMessages, state)
  return newMessages
}
