/**
 * readOps.ts — ConversationStore 讀取 / 查詢層（move-only，行為保留）。
 *
 * 從 conversationStore.ts 原樣搬出：
 *   - readSlice         原 _readSlice：讀某 byte 範圍的訊息切片（fs.read → 解析 → LRU 快取）。
 *   - querySegments     原 getSegments：取段落索引（直接查 DB；不觸發增量解析）。
 *   - queryMessagesRange 原 getMessagesRange：依 seq 範圍查詢訊息（純索引 + byte 切片）。
 *   - queryRawLines     原 getRawLines：依 seq 範圍取原始 JSONL 行（Raw 模式按需取）。
 *   - queryWindow       原 getWindow（只含 DB 查詢 + getMessagesRange 部分）：
 *                       讀取 conv_state、計算 startSeq、推進 ui_read_seq。
 *                       由 ConversationStore.getWindow 呼叫，getByFile 已在 class 層先跑。
 *
 * 所有函式本體原樣搬移，不改任何邏輯、SQL 字面、數值常數、控制流。
 */

import * as fs from 'fs'
import type { ConversationMessage } from '../../../shared/ipcContracts'
import { _consumeJsonObjectsWithSpans } from './parseHelpers'
import { cacheKey, segCacheGet, segCacheSet } from './segmentCache'
import { ensureDb, type MemEntry, type DbState, type SegmentRow } from './dbOps'

/** 逐筆 record → ConversationMessage 的解析器簽名（與 conversationStore.ts 相同）。 */
type RecordParser = (rec: Record<string, unknown>) => ConversationMessage | null

const RETURN_LIMIT = 300 // 回傳上限 —— 與 conversationStore.ts 相同常數

// ---------------------------------------------------------------------------
// readSlice（原 _readSlice）
// ---------------------------------------------------------------------------

/**
 * 讀某 byte 範圍 [startPos, endPos) 的訊息切片（fs.read → 逐行解析 → 濾 null）。
 * 帶記憶體段 LRU（key = 範圍）：命中直接回；未命中讀檔解析後存入並淘汰最舊。
 * 讀失敗 / DB 無關 → []。
 */
export function readSlice(
  file: string,
  startPos: number,
  endPos: number,
  parser: RecordParser,
  mem: Map<string, MemEntry>,
): ConversationMessage[] {
  if (endPos <= startPos) return []
  let entry = mem.get(file)
  const key = cacheKey(startPos, endPos)
  if (entry) {
    const hit = segCacheGet(entry.segCache, key)
    if (hit) return hit
  }

  let text = ''
  try {
    const fd = fs.openSync(file, 'r')
    try {
      const len = endPos - startPos
      const buf = Buffer.alloc(len)
      const n = fs.readSync(fd, buf, 0, len, startPos)
      text = buf.subarray(0, n).toString('utf-8')
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return []
  }

  const { items } = _consumeJsonObjectsWithSpans(text)
  const msgs: ConversationMessage[] = []
  for (const it of items) {
    const o = it.value
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue
    const m = parser(o as Record<string, unknown>)
    if (m) msgs.push(m)
  }

  // 存入段 LRU（淘汰最舊）
  if (!entry) {
    // 記憶體尚無此檔 entry（純查段、未先走 getByFile）：建一個只放 segCache 的最小 entry。
    entry = { consumedPos: 0, lastSize: -1, nextSeq: 0, messages: [], curSeg: null, endSeen: true, segCache: new Map() }
    mem.set(file, entry)
  }
  segCacheSet(entry.segCache, key, msgs)
  return msgs
}

// ---------------------------------------------------------------------------
// querySegments（原 getSegments）
// ---------------------------------------------------------------------------

/**
 * 取某檔的段落索引（直接查 DB；不觸發增量解析）。
 * totalCount = next_seq（DB 中紀錄的訊息總數）。
 * DB 不可用 → { segments: [], totalCount: 0 }。
 */
export function querySegments(
  file: string,
  state: DbState,
): { segments: SegmentRow[]; totalCount: number } {
  const db = ensureDb(state)
  if (!db) return { segments: [], totalCount: 0 }
  try {
    const segs = db
      .prepare(
        'SELECT file, seg_no, start_seq, end_seq, start_ts, end_ts, label, is_command, msg_count, start_pos, end_pos, head_kind' +
          ' FROM conv_segments WHERE file = ? ORDER BY seg_no ASC',
      )
      .all(file) as SegmentRow[]
    const s = db
      .prepare('SELECT next_seq FROM conv_state WHERE file = ?')
      .get(file) as { next_seq: number } | undefined
    return { segments: segs, totalCount: s?.next_seq ?? 0 }
  } catch {
    return { segments: [], totalCount: 0 }
  }
}

// ---------------------------------------------------------------------------
// queryMessagesRange（原 getMessagesRange）
// ---------------------------------------------------------------------------

/**
 * 依 seq 範圍查詢訊息（含端點）。
 *
 * 實作（純索引）：用 conv_segments 找涵蓋 [startSeq, endSeq] 的段 → 讀各段 byte 切片 →
 * 解析 → 依 seq 精確切出。前言（startSeq < 首段 start_seq）不在表內：從 byte 0 讀到
 * 首段 start_pos（無段時讀到檔尾），補進前言訊息再切。每段第 i 則非 null 訊息對應
 * seq = 段 start_seq + i（recordToConversationMessage 決定性，重讀與初解一致）。
 * DB 不可用 → []。
 *
 * @param cliId 解析器分流（預設 'claude'，向後相容）。codex 檔務必傳 'codex'。
 */
export function queryMessagesRange(
  file: string,
  startSeq: number,
  endSeq: number,
  parser: RecordParser,
  state: DbState,
  mem: Map<string, MemEntry>,
): ConversationMessage[] {
  const db = ensureDb(state)
  if (!db) return []
  if (endSeq < startSeq) return []
  try {
    const segs = db
      .prepare(
        'SELECT seg_no, start_seq, end_seq, start_pos, end_pos FROM conv_segments WHERE file = ? ORDER BY seg_no ASC',
      )
      .all(file) as { seg_no: number; start_seq: number; end_seq: number; start_pos: number; end_pos: number }[]

    const out: { seq: number; msg: ConversationMessage }[] = []

    // 前言：seq 0 .. (首段 start_seq - 1)。從 byte 0 讀到首段 start_pos（無段→讀整檔）。
    const firstSegStart = segs.length > 0 ? segs[0].start_seq : Infinity
    if (startSeq < firstSegStart) {
      const preEnd = segs.length > 0 ? segs[0].start_pos : Number.MAX_SAFE_INTEGER
      const fileEnd = (() => {
        try {
          return fs.statSync(file).size
        } catch {
          // 容錯：statSync 失敗（如檔案已刪）→ 回 0，避免 Math.min(MAX_SAFE_INTEGER, 0)
          // 之外的 Number.MAX_SAFE_INTEGER 傳入 readSlice 觸發 Buffer.alloc RangeError。
          return 0
        }
      })()
      if (fileEnd === 0) return []
      const preludeMsgs = readSlice(file, 0, Math.min(preEnd, fileEnd), parser, mem)
      for (let i = 0; i < preludeMsgs.length; i++) out.push({ seq: i, msg: preludeMsgs[i] })
    }

    // 各段：seq = 段 start_seq + i。只讀與 [startSeq, endSeq] 有交集的段。
    for (const s of segs) {
      if (s.end_seq < startSeq || s.start_seq > endSeq) continue
      const segMsgs = readSlice(file, s.start_pos, s.end_pos, parser, mem)
      for (let i = 0; i < segMsgs.length; i++) out.push({ seq: s.start_seq + i, msg: segMsgs[i] })
    }

    return out
      .filter((x) => x.seq >= startSeq && x.seq <= endSeq)
      .sort((a, b) => a.seq - b.seq)
      .map((x) => x.msg)
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// queryRawLines（原 getRawLines）
// ---------------------------------------------------------------------------

/**
 * 讀某 seq 範圍對應的原始 JSONL 行（Raw 模式按需取）。
 *
 * 實作：與 getMessagesRange 相同的 byte 定位邏輯，但直接回傳原始字串而非解析結果。
 * cap：最多 RAW_LINE_CAP 行或 RAW_BYTE_CAP bytes，超出截斷並標 truncated=true。
 * 容錯：讀失敗 / DB 不可用 → { lines: [], truncated: false }。
 */
export function queryRawLines(
  file: string,
  startSeq: number,
  endSeq: number,
  state: DbState,
): { lines: string[]; truncated: boolean } {
  const RAW_LINE_CAP = 500
  const RAW_BYTE_CAP = 2 * 1024 * 1024 // 2 MB

  const db = ensureDb(state)
  if (!db) return { lines: [], truncated: false }
  if (endSeq < startSeq) return { lines: [], truncated: false }

  try {
    const segs = db
      .prepare(
        'SELECT seg_no, start_seq, end_seq, start_pos, end_pos FROM conv_segments WHERE file = ? ORDER BY seg_no ASC',
      )
      .all(file) as { seg_no: number; start_seq: number; end_seq: number; start_pos: number; end_pos: number }[]

    // 算出涵蓋 [startSeq, endSeq] 的 byte 範圍（對齊段界）
    const firstSegStart = segs.length > 0 ? segs[0].start_seq : Infinity
    let byteStart = 0 // 前言從 0 開始
    let byteEnd = 0

    if (startSeq < firstSegStart && segs.length > 0) {
      // 前言範圍起點為 0，終點為首段 start_pos
      byteEnd = segs[0].start_pos
    } else if (startSeq < firstSegStart) {
      // 無段：整檔
      try { byteEnd = fs.statSync(file).size } catch { return { lines: [], truncated: false } }
    }

    // 擴展 byteEnd 包含有交集的段
    for (const s of segs) {
      if (s.end_seq < startSeq || s.start_seq > endSeq) continue
      if (byteEnd === 0 && startSeq >= firstSegStart) byteStart = s.start_pos
      else if (byteStart === 0 || s.start_pos < byteStart) byteStart = s.start_pos
      if (s.end_pos > byteEnd) byteEnd = s.end_pos
    }

    if (byteEnd <= byteStart) return { lines: [], truncated: false }

    // 讀取 byte 範圍
    let text = ''
    try {
      const len = Math.min(byteEnd - byteStart, RAW_BYTE_CAP)
      const buf = Buffer.alloc(len)
      const fd = fs.openSync(file, 'r')
      try {
        const n = fs.readSync(fd, buf, 0, len, byteStart)
        text = buf.subarray(0, n).toString('utf-8')
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return { lines: [], truncated: false }
    }

    const byteTruncated = (byteEnd - byteStart) > RAW_BYTE_CAP

    // 切行、過濾非空非注釋行（每行應為一個完整 JSON object）
    const rawLines = text.split('\n').filter((l) => l.trim().startsWith('{'))

    const truncated = byteTruncated || rawLines.length > RAW_LINE_CAP
    const lines = rawLines.slice(0, RAW_LINE_CAP)
    return { lines, truncated }
  } catch {
    return { lines: [], truncated: false }
  }
}

// ---------------------------------------------------------------------------
// queryWindow（原 getWindow 的 DB 查詢 + ui_read_seq 推進部分）
// ---------------------------------------------------------------------------

/**
 * getWindow 的 DB 查詢部分：讀 conv_state、計算 startSeq、取訊息切片、推進 ui_read_seq。
 * 由 ConversationStore.getWindow 呼叫（呼叫前已先跑 getByFile 觸發增量解析）。
 * DB 不可用 → { messages: [], startSeq: 0, totalCount: 0 }。
 */
export function queryWindow(
  file: string,
  parser: RecordParser,
  state: DbState,
  mem: Map<string, MemEntry>,
): { messages: ConversationMessage[]; startSeq: number; totalCount: number } {
  const db = ensureDb(state)
  if (!db) return { messages: [], startSeq: 0, totalCount: 0 }
  try {
    const s = db
      .prepare('SELECT next_seq, ui_read_seq FROM conv_state WHERE file = ?')
      .get(file) as { next_seq: number; ui_read_seq: number } | undefined
    if (!s) return { messages: [], startSeq: 0, totalCount: 0 }

    const { next_seq, ui_read_seq } = s
    const size = Math.max(RETURN_LIMIT, next_seq - ui_read_seq)
    const startSeq = Math.max(0, next_seq - size)

    const messages = next_seq > 0
      ? queryMessagesRange(file, startSeq, next_seq - 1, parser, state, mem)
      : []

    // 推進 ui_read_seq → next_seq
    db.prepare('UPDATE conv_state SET ui_read_seq = ? WHERE file = ?').run(next_seq, file)

    return { messages, startSeq, totalCount: next_seq }
  } catch {
    return { messages: [], startSeq: 0, totalCount: 0 }
  }
}
