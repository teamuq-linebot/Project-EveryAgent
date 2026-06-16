/**
 * dbOps.ts — ConversationStore 持久層讀寫（move-only，行為保留）。
 *
 * 從 conversationStore.ts 原樣搬出：
 *   - ensureDb         原 _ensureDb：開啟 / 回傳 better-sqlite3 連線（失敗 → null；冪等）。
 *   - loadFromDb       原 _loadFromDb：從 DB 載回某檔的段索引續傳狀態。
 *   - persist          原 _persist：持久化進度 + 段索引（transaction；失敗不阻斷）。
 *   - resetEntry       原 _reset：重置某檔（檔案被重寫）—— 清 DB + 回傳全新 MemEntry。
 *
 * 共用可變狀態以 DbState bag 傳入（原 class 的 _db / _dbBroken 欄位）；
 * mem Map 亦以參數傳入（原 class 的 _mem）。
 * 所有方法本體原樣搬移，不改任何邏輯、SQL 字面、數值常數、控制流。
 */

import * as fs from 'fs'
import * as path from 'path'
import Database from 'better-sqlite3'
import type { ConversationMessage } from '../../../shared/ipcContracts'
import { ensureConvCacheTables } from '../../repo/sqliteTaskRepository'
import { dbPath, retireLegacyConversationsDb } from './legacyDbMigration'
import { _isTypedUser, _isEndMessage, _segLabelOf } from './parseHelpers'

// ---------------------------------------------------------------------------
// 共用型別（與 conversationStore.ts 的私有介面逐字相同）
// ---------------------------------------------------------------------------

/** 段落增量維護的進行中狀態（對應 conv_segments 的可變欄位 + byte 起迄）。 */
export interface SegInProgress {
  seg_no: number
  start_seq: number
  end_seq: number
  start_ts: string
  end_ts: string
  label: string
  is_command: number
  msg_count: number
  start_pos: number
  end_pos: number
  head_kind: string
}

export interface MemEntry {
  consumedPos: number
  lastSize: number
  nextSeq: number
  messages: ConversationMessage[]
  /** 段落索引增量維護：目前正在累積中的段（尚未收尾）。null = 仍在前言。 */
  curSeg: SegInProgress | null
  /**
   * 純結尾驅動分段狀態機：是否「已見明確結尾」。
   * 初始 true（檔案開頭即視為結尾後，第一則訊息即開段 1）；
   * 遇 END 訊息 → 處理完設 true；endSeen===true 時下一則【任何】訊息開新段並設 false；
   * endSeen===false 時的任何訊息（含插隊 typed）併入當前段不裂段。
   * 此狀態須跨重啟續傳（持久化於 conv_state.end_seen）。
   */
  endSeen: boolean
  /** 段切片 LRU：key = `${start_pos}:${end_pos}` → 該範圍解析出的訊息（已濾 null）。 */
  segCache: Map<string, ConversationMessage[]>
}

/** 一則「會映射成 ConversationMessage」的訊息 + 其在 JSONL 的 byte 起迄。 */
export interface MsgWithSpan {
  msg: ConversationMessage
  startPos: number
  endPos: number
}

/**
 * 共用可變 DB 狀態 bag（原 ConversationStore._db / _dbBroken 欄位的可變容器）。
 * 以物件形式傳入，允許 ensureDb 修改 .db / .dbBroken 後呼叫端可見到變更。
 */
export interface DbState {
  db: Database.Database | null
  dbBroken: boolean
}

/** 段落索引一列（conv_segments 表的 TS 鏡像；含 byte 起迄）。
 *  原定義在 conversationStore.ts（公開 export）；移至此處避免 readOps→conversationStore 循環引用。
 *  conversationStore.ts 透過 re-export 維持原對外介面不變。 */
export interface SegmentRow {
  file: string
  seg_no: number
  start_seq: number
  end_seq: number
  start_ts: string
  end_ts: string
  label: string
  is_command: number
  msg_count: number
  /** 段首訊息行在 JSONL 的 UTF-8 byte 起始（含）。 */
  start_pos: number
  /** 段尾訊息行在 JSONL 的 UTF-8 byte 結尾（exclusive）。 */
  end_pos: number
  /** 開段訊息的語意型別（v12）：typed/command/notify/other。取代舊 label 前綴嗅探。 */
  head_kind: string
}

// ---------------------------------------------------------------------------
// ensureDb（原 _ensureDb）
// ---------------------------------------------------------------------------

/**
 * 開啟 / 回傳 better-sqlite3 連線。失敗 → null（state.dbBroken 設 true）。冪等。
 * 直接修改 state.db / state.dbBroken（原 this._db / this._dbBroken）。
 */
export function ensureDb(state: DbState): Database.Database | null {
  if (state.dbBroken) return null
  if (state.db) return state.db
  try {
    // D25：先退役舊獨立 conversations.db（首開時改名 .migrated；冪等容錯）。
    retireLegacyConversationsDb()

    const p = dbPath()
    fs.mkdirSync(path.dirname(p), { recursive: true })
    const db = new Database(p)
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000') // 同程序多連線同檔（repo + conv store）：等鎖不立即失敗。
    // D25：建 conv cache 3 表 + 版本守門委派 repo（DDL/守門/scoped-drop 單一來源）。
    //   - 版本鍵走 schema_meta.parser_version（**不碰 user_version** —— 那是主 schema 的）。
    //   - 版本不符時**只 DROP conv_state/conv_messages/conv_segments**，絕不波及 teamuq.db 其他表。
    //   - conv_messages（v6 已刪）含入 DROP 範圍防舊版殘留；conv_state/conv_segments 以新 schema 重建。
    ensureConvCacheTables(db)
    state.db = db
    return db
  } catch {
    state.dbBroken = true
    return null
  }
}

// ---------------------------------------------------------------------------
// loadFromDb（原 _loadFromDb）
// ---------------------------------------------------------------------------

/**
 * 從 DB 載回某檔的段索引續傳狀態（consumed_pos / next_seq + 最後一段 SegInProgress）。
 * 不載任何訊息內容（v6 不存內容）；記憶體訊息視窗交由 getByFile 整檔重掃填充。
 * 無記錄 → null。
 */
export function loadFromDb(file: string, state: DbState): MemEntry | null {
  const db = ensureDb(state)
  if (!db) return null
  try {
    const s = db
      .prepare('SELECT consumed_pos, next_seq, end_seen FROM conv_state WHERE file = ?')
      .get(file) as { consumed_pos: number; next_seq: number; end_seen: number } | undefined
    if (!s) return null
    // 載回最後一段，恢復增量段索引維護狀態（跨重啟續傳）
    const lastSeg = db
      .prepare(
        'SELECT seg_no, start_seq, end_seq, start_ts, end_ts, label, is_command, msg_count, start_pos, end_pos, head_kind' +
          ' FROM conv_segments WHERE file = ? ORDER BY seg_no DESC LIMIT 1',
      )
      .get(file) as
      | {
          seg_no: number
          start_seq: number
          end_seq: number
          start_ts: string
          end_ts: string
          label: string
          is_command: number
          msg_count: number
          start_pos: number
          end_pos: number
          head_kind: string
        }
      | undefined
    const curSeg: SegInProgress | null = lastSeg
      ? {
          seg_no: lastSeg.seg_no,
          start_seq: lastSeg.start_seq,
          end_seq: lastSeg.end_seq,
          start_ts: lastSeg.start_ts,
          end_ts: lastSeg.end_ts,
          label: lastSeg.label,
          is_command: lastSeg.is_command,
          head_kind: lastSeg.head_kind ?? 'other',
          msg_count: lastSeg.msg_count,
          start_pos: lastSeg.start_pos,
          end_pos: lastSeg.end_pos,
        }
      : null
    return {
      consumedPos: s.consumed_pos,
      lastSize: -1,
      nextSeq: s.next_seq,
      messages: [],
      curSeg,
      // 還原 end-driven 狀態機旗標（跨重啟續傳）：DB 整數 → boolean。
      endSeen: s.end_seen !== 0,
      segCache: new Map(),
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// persist（原 _persist）
// ---------------------------------------------------------------------------

/**
 * 持久化進度 + 段落索引（transaction；失敗不阻斷）。不再寫任何訊息內容（純索引）。
 *
 * 段索引增量維護狀態機（結尾為主 + 僅用戶發話開段；v13 最終規格；需與 renderer helpers.tsx buildSegments 同步）：
 *   開段條件 = entry.endSeen === true && _isTypedUser(m)（typed/command）。滿足 →
 *     ①【新段】先收尾上一段（如有），再 INSERT 新段（seg_no = prev+1；start_seq = seq；
 *            start_pos = 該訊息行 byte 起；label/is_command 由 _segLabelOf 定稿），並設 endSeen = false。
 *   不開段（endSeen===false 的任何訊息，含插隊 typed；或 endSeen===true 但非 _isTypedUser 如 notify/assistant）→
 *     ②【續段/前言】若有 curSeg → UPDATE 當前段 end_seq/end_ts/msg_count/end_pos 推進；
 *                  若無 curSeg（尚在前言）→ 不寫表（前言訊息不入 conv_segments，v10 行為恢復）。
 *   END 訊息（isEndMessage：system+turnDuration / interrupt / stop_sequence）本身屬「當前段段尾」，
 *     先照②併入當前段，**處理完該訊息後**設 endSeen = true（下一則 typed/command 才開新段）。
 *   ③ 跨重啟：loadFromDb 把最後一段 SegInProgress 載回 entry.curSeg、end_seen 載回 entry.endSeen，
 *            新 append 的訊息直接銜接，狀態機與冷啟動完全一致。
 *   前言：第一個開段訊息（_isTypedUser）之前的記錄不入 conv_segments（curSeg = null 期間）。
 *
 * end_seen 與 consumed_pos / next_seq 同一 transaction 寫回 conv_state（原子；跨重啟續傳）。
 */
export function persist(
  file: string,
  entry: MemEntry,
  newMessages: MsgWithSpan[],
  state: DbState,
): void {
  const db = ensureDb(state)
  if (!db) return
  try {
    const upState = db.prepare(
      'INSERT INTO conv_state (file, consumed_pos, next_seq, end_seen) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(file) DO UPDATE SET consumed_pos = excluded.consumed_pos, ' +
        'next_seq = excluded.next_seq, end_seen = excluded.end_seen',
    )
    const upsertSeg = db.prepare(
      'INSERT INTO conv_segments (file, seg_no, start_seq, end_seq, start_ts, end_ts, label, is_command, msg_count, start_pos, end_pos, head_kind)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)' +
        ' ON CONFLICT(file, seg_no) DO UPDATE SET' +
        '   end_seq = excluded.end_seq,' +
        '   end_ts = excluded.end_ts,' +
        '   label = excluded.label,' +
        '   is_command = excluded.is_command,' +
        '   msg_count = excluded.msg_count,' +
        '   end_pos = excluded.end_pos',
    )

    const writeSeg = (s: SegInProgress): void => {
      upsertSeg.run(
        file, s.seg_no, s.start_seq, s.end_seq, s.start_ts, s.end_ts,
        s.label, s.is_command, s.msg_count, s.start_pos, s.end_pos, s.head_kind,
      )
    }

    const tx = db.transaction(() => {
      // entry.nextSeq 已在 advance 中 += newMessages.length（本批已含），故 -length 還原本批起點。
      let seq = entry.nextSeq - newMessages.length // 本批第一則的 seq
      for (const { msg: m, startPos, endPos } of newMessages) {
        const ts = m.timestamp ?? ''

        if (entry.endSeen && _isTypedUser(m)) {
          // ①【新段】已見結尾 + 用戶發話（typed/command）→ 開新段。先收尾上一段（如有）。
          if (entry.curSeg !== null) writeSeg(entry.curSeg)
          const { label, is_command, head_kind } = _segLabelOf(m)
          const newSegNo = entry.curSeg !== null ? entry.curSeg.seg_no + 1 : 1
          entry.curSeg = {
            seg_no: newSegNo,
            start_seq: seq,
            end_seq: seq,
            start_ts: ts,
            end_ts: ts,
            label,
            is_command,
            head_kind,
            msg_count: 1,
            start_pos: startPos,
            end_pos: endPos,
          }
          writeSeg(entry.curSeg)
          entry.endSeen = false // 開新段後，需再見一次 END 才允許下次開段
        } else if (entry.curSeg !== null) {
          // ②【續段】推進 end_seq / end_ts / msg_count / end_pos。
          //   涵蓋：插隊 typed（endSeen===false 的 typed）、END 訊息（屬段尾）、
          //          非 typed 訊息（notify/assistant 等，endSeen=true 但不開段）。
          entry.curSeg.end_seq = seq
          if (ts) entry.curSeg.end_ts = ts
          entry.curSeg.msg_count += 1
          entry.curSeg.end_pos = endPos
          writeSeg(entry.curSeg)
        }
        // 前言（curSeg = null 且未開段）：不寫段索引（v13 恢復 v10 前言行為）

        // END 訊息本身已併入當前段（段尾）；處理完後設 endSeen，下一則 typed 才開新段。
        if (_isEndMessage(m)) entry.endSeen = true

        seq++
      }

      upState.run(file, entry.consumedPos, entry.nextSeq, entry.endSeen ? 1 : 0)
    })
    tx()
  } catch {
    // 持久化失敗不阻斷（記憶體照常）
  }
}

// ---------------------------------------------------------------------------
// resetEntry（原 _reset）
// ---------------------------------------------------------------------------

/**
 * 重置某檔（檔案被重寫/截斷）。清 DB + 回傳全新 MemEntry，並寫入 mem Map。
 */
export function resetEntry(
  file: string,
  mem: Map<string, MemEntry>,
  state: DbState,
): MemEntry {
  const fresh: MemEntry = {
    consumedPos: 0,
    lastSize: -1,
    nextSeq: 0,
    messages: [],
    curSeg: null,
    endSeen: true, // 檔案開頭即視為「結尾後」：第一則 typed/command 直接開段（前言前無前言）
    segCache: new Map(),
  }
  mem.set(file, fresh)
  const db = ensureDb(state)
  if (db) {
    try {
      db.prepare('DELETE FROM conv_state WHERE file = ?').run(file)
      db.prepare('DELETE FROM conv_segments WHERE file = ?').run(file)
    } catch {
      // ignore
    }
  }
  return fresh
}
