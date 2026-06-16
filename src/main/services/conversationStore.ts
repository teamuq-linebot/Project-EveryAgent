/**
 * conversationStore.ts — session 對話的增量解析 + SQLite「純索引」快取。
 *
 * 動機（使用者需求 v6 重構）：v5 把整份對話（每則訊息 JSON）複製進 conv_messages，
 * 「記錄太細」。改成 **DB 只存索引、訊息內容一律回原始 JSONL 讀**：
 *   - conv_messages 整張刪除。
 *   - conv_segments 加 start_pos / end_pos（該段第一/最後一則「訊息行」在 JSONL 的
 *     UTF-8 byte 起迄；end_pos = 最後一則訊息行結尾的 byte）。段內夾雜的非訊息行
 *     （recordToConversationMessage 回 null）涵蓋在範圍內無妨，重讀時自然濾掉。
 *   - 要訊息內容時：照段索引的 byte 範圍 fs.read 檔案切片 → 逐行解析 → 映射
 *     ConversationMessage，再依 seq 精確切出所需區間。
 *
 * 設計：
 *   - 進度只存「consumedPos」= 最後一筆**完整** record 結束的 byte 位置 →
 *     可跨重啟續傳（不需 decoder 內部狀態）。每輪只讀 [consumedPos, size) 新 bytes，
 *     未閉合殘段（claude 寫入中）下輪自然重讀。
 *   - 段落索引 conv_segments：解析時同 transaction 維護，每段一列（含 byte 起迄）；
 *     支援 getSegments() / getMessagesRange() / getWindow() 懶載入 API。
 *   - 記憶體只留尾端視窗（get/getByFile 的相容路徑）；不再持久化任何訊息內容，
 *     **重啟後首次呼叫 get/getByFile 會重建記憶體尾端視窗**：段索引本身跨重啟續傳
 *     （consumed_pos / next_seq / curSeg 從 DB 載回，不需重建），但記憶體 messages 空，
 *     故以段索引 byte 切片讀回 [nextSeq−MEM_KEEP, nextSeq) 重填視窗（只讀、不改 DB）。
 *     subagent transcript 檔小，重建成本可接受，換取「DB 不存內容、體積小」。
 *   - 記憶體段落 LRU：解析過的段切片（byte 範圍 → ConversationMessage[]）留小快取
 *     （最多 SEG_CACHE_MAX 段），避免 UI 反覆展開同段時重複 fs.read + 解析。
 *   - DB 開失敗 → 純記憶體模式（get/getByFile 行為不變；段 API 回空）。
 *   - 檔案變小（被重寫）→ 重置該檔（DB + 記憶體 + 段快取）。
 *
 * D25（rev11 用戶拍板）：對話 cache 3 表由獨立 `conversations.db` **併入 `~/.teamuq/teamuq.db`**。
 *   - 自開連線（WAL；同程序多連線同檔 OK，沿用 TEAMUQ_HOME override）。
 *   - 建表 + 版本守門委派 repo 的 `ensureConvCacheTables`（DDL/守門/scoped-drop 單一來源）：
 *     版本鍵改用 `schema_meta.parser_version`（**不碰 PRAGMA user_version** — 那是主 schema 的）；
 *     版本不符時**只 DROP conv_state/conv_messages/conv_segments 三表**重建，絕不波及其他 16 表。
 *   - 舊 `conversations.db`（連 -wal/-shm）首開時改名 `.migrated.<日期>`（資料不遷移，
 *     cache 可重建、JSONL 是事實來源、首讀自動重掃；改名失敗容錯：記 log 繼續，下次再試）。
 *
 * byte 對齊（多位元組 / 殘行）：
 *   - 所有 *_pos 一律以 UTF-8 byte 計（Buffer.byteLength），非字元數。
 *   - JSONL 一行一筆 record；增量讀只讀 [consumedPos, size)，未閉合殘段（含可能被
 *     切斷的多位元組字元）落在 consumeJsonObjects 的 rest，下輪重讀，不會推進
 *     consumedPos，故分裂字元永不進入已索引範圍（沿用 v5 殘行精神）。
 *   - 段切片重讀以 byte 範圍開檔讀取，範圍兩端都對齊到完整 record 邊界（start_pos =
 *     某 record 起始 '{' 的 byte；end_pos = 某 record 結尾 '}' 後一個 byte），中間不可能
 *     落在多位元組字元中間，解碼安全。
 *
 * DB：~/.teamuq/teamuq.db（D25 併入；吃 TEAMUQ_HOME 隔離，與其他 config 一致）。
 *
 * 持久層 / 增量解析 / 讀取查詢已抽出到 services/conversation/ 子模組：
 *   - dbOps.ts        ensureDb / loadFromDb / persist / resetEntry
 *   - advanceOps.ts   advance（增量解析核心）
 *   - readOps.ts      readSlice / querySegments / queryMessagesRange / queryRawLines / queryWindow
 * ConversationStore class 保留全部公開方法簽名，改為 thin delegation（原介面不變）。
 */

import * as fs from 'fs'
import type { ConversationMessage } from '../../shared/ipcContracts'
import { listSessionFilesLight } from '../worktime/claude/lightList'
import { recordToConversationMessage } from '../worktime/claude/index'
import { codexRecordToConversationMessage } from '../worktime/codex/parse'
// 持久層（_loadFromDb / _reset）
import { loadFromDb, resetEntry, type DbState, type MemEntry, type SegmentRow } from './conversation/dbOps'
// 增量解析核心（_advance）
import { advance } from './conversation/advanceOps'
// 讀取 / 查詢層（_readSlice / getSegments / getMessagesRange / getRawLines / getWindow DB 部分）
import { querySegments, queryMessagesRange, queryRawLines, queryWindow } from './conversation/readOps'

// ---------------------------------------------------------------------------
// Barrel / re-export：原 conversationStore.ts 對外（含潛在）公開的符號一律從本檔
// re-export，維持既有 import path 不變（consumer / 測試零改動）。
// ---------------------------------------------------------------------------
export type { SpanItem } from './conversation/parseHelpers'
export {
  _extractCommandName,
  _isTypedUser,
  _isEndMessage,
  _segLabelOf,
  _consumeJsonObjectsWithSpans,
} from './conversation/parseHelpers'
export {
  dbPath,
  legacyConversationsDbPath,
  todayStamp,
  retireLegacyConversationsDb,
} from './conversation/legacyDbMigration'
export { SEG_CACHE_MAX, cacheKey, segCacheGet, segCacheSet } from './conversation/segmentCache'

/** 逐筆 record → ConversationMessage 的解析器簽名（claude / codex 平行）。 */
type RecordParser = (rec: Record<string, unknown>) => ConversationMessage | null

/** 支援的 CLI 解析器標識（file-based API 用以分流；預設 claude，向後相容）。 */
export type ConvCliId = 'claude' | 'codex'

const RETURN_LIMIT = 300 // 回傳上限
const MEM_KEEP = 600 // 記憶體保留上限（超過砍到 450）
// SEG_CACHE_MAX（段切片記憶體 LRU 上限／每檔）已搬到 conversation/segmentCache.ts，import 回用。

/**
 * Parser 版本說明：recordToConversationMessage 的解析邏輯或 conv_* schema 每次有破壞性變更時 +1。
 * D25 起 **單一來源 = repo 的 CONV_PARSER_VERSION**（存 schema_meta.parser_version，**不碰**
 * PRAGMA user_version —— 那屬主 schema）。守門/scoped-drop 由 ensureConvCacheTables 統一處理；
 * 不符時只 DROP conv_* 三表重建（強制重掃索引）。本檔不再持有版號常數，避免兩處分叉。
 *   目前版本：14（v13 分段規格 + 依 tool 分流 parser：claude / codex per-file 解析）。
 *   開段條件：endSeen===true 且 _isTypedUser(m)（typed/command）。
 *   前言恢復：第一個開段訊息之前的記錄不入 conv_segments（endSeen=true 但非 typed 視為前言）。
 */

/** 段落索引一列（conv_segments 表的 TS 鏡像；含 byte 起迄）。
 *  型別定義移至 conversation/dbOps.ts（避免 readOps 循環引用）；此處 re-export 維持原對外介面。 */
export type { SegmentRow } from './conversation/dbOps'

export class ConversationStore {
  /** 共用可變 DB 狀態 bag（傳給 dbOps 函式；原 _db / _dbBroken 欄位）。 */
  private readonly _dbState: DbState = { db: null, dbBroken: false }
  private readonly _mem = new Map<string, MemEntry>()

  /**
   * 依 tool 分流 record→message 解析器。codex 檔永遠走 codex parser、claude 檔永遠走 claude
   * parser（cliId 由「檔來源」決定，backend 呼 codex 檔時顯式傳 'codex'）。
   * P0 正確性：同一檔的 byte 增量索引必須永遠用同一 parser，否則 seq 對不上、重讀結果不一致。
   */
  private readonly _parsers: Record<ConvCliId, RecordParser> = {
    claude: recordToConversationMessage,
    codex: codexRecordToConversationMessage,
  }

  /** 取對應 cliId 的解析器（未知 → 預設 claude，向後相容）。 */
  private _parserOf(cliId: ConvCliId): RecordParser {
    return this._parsers[cliId] ?? this._parsers.claude
  }

  /** 從 DB 載回某檔的段索引續傳狀態（consumed_pos / next_seq + 最後一段 SegInProgress）。
   *  不載任何訊息內容（v6 不存內容）；記憶體訊息視窗交由 getByFile 整檔重掃填充。
   *  無記錄 → null。 */
  private _loadFromDb(file: string): MemEntry | null {
    return loadFromDb(file, this._dbState)
  }

  /** 重置某檔（檔案被重寫/截斷）。 */
  private _reset(file: string): MemEntry {
    return resetEntry(file, this._mem, this._dbState)
  }

  // -------------------------------------------------------------------------
  // 增量解析核心：讀 [consumedPos, size) 新 bytes → 解析帶 span 的 record →
  // 映射 ConversationMessage（保留 byte span）→ 推進 nextSeq / persist 段索引。
  // 回傳本輪新增的訊息（含 span），供記憶體視窗 append。
  // -------------------------------------------------------------------------
  private _advance(file: string, entry: MemEntry, size: number, parser: RecordParser): Array<{ msg: ConversationMessage; startPos: number; endPos: number }> {
    return advance(file, entry, size, parser, this._dbState)
  }

  /**
   * 取某 claude session 的對話（增量；段索引跨重啟由 SQLite 續傳）。
   * claudeSessionId = 真 uuid（JSONL 檔名）；projectPath = 專案路徑。
   * 找不到 / 讀失敗 → []，全程容錯。
   */
  get(claudeSessionId: string, projectPath: string): ConversationMessage[] {
    if (!claudeSessionId || !projectPath) return []
    const file = listSessionFilesLight(projectPath).find(
      (s) => s.session_id === claudeSessionId,
    )?.file
    if (!file) return []
    return this.getByFile(file)
  }

  /**
   * 依絕對檔案路徑取對話（增量；段索引跨重啟由 SQLite 續傳）。
   *
   * 供呼叫端直接傳入已知的 JSONL 路徑使用——例如透過
   * resolveSubagentTranscript() 解析出 subagent transcript 路徑後丟進來，
   * 不需再走 listSessionFilesLight 掃描。行為與 get() 完全相同。
   *
   * v6 取捨：DB 不存訊息內容，故記憶體尾端視窗不能像 v5 從 conv_messages 載回。
   * 冷啟動 / 重啟後本檔首次進來時：_loadFromDb 載回續傳點（consumedPos / nextSeq /
   * curSeg / 段索引已是最新事實），entry.messages 為空。改以**段索引 byte 切片**重建
   * 尾端視窗——讀 [max(0, nextSeq−MEM_KEEP), nextSeq) 的訊息（getMessagesRange 內部走
   * byte read，命中段快取），填回 entry.messages。此重建**不重寫**任何 DB 狀態 /
   * 段索引（只讀），續傳點不動；之後新增 bytes 照 _advance 正常增量。
   * subagent 檔小，視窗重建成本可接受。找不到 / 讀失敗 → []。
   *
   * @param cliId 解析器分流（預設 'claude'，向後相容）。codex 檔務必傳 'codex'。
   */
  getByFile(file: string, cliId: ConvCliId = 'claude'): ConversationMessage[] {
    if (!file) return []
    const parser = this._parserOf(cliId)

    let st: fs.Stats
    try {
      st = fs.statSync(file)
    } catch {
      return []
    }

    let entry = this._mem.get(file)
    if (!entry) {
      const loaded = this._loadFromDb(file)
      entry = loaded ?? {
        consumedPos: 0,
        lastSize: -1,
        nextSeq: 0,
        messages: [],
        curSeg: null,
        endSeen: true, // 全新檔（無 DB 記錄）：開頭即「結尾後」，第一則 typed/command 開段1
        segCache: new Map(),
      }
      this._mem.set(file, entry)
      // 重啟後首讀且續傳點 > 0：以段索引 byte 切片重建記憶體尾端視窗（只讀，不寫 DB）。
      if (loaded && entry.nextSeq > 0) {
        const from = Math.max(0, entry.nextSeq - MEM_KEEP)
        entry.messages = this.getMessagesRange(file, from, entry.nextSeq - 1, cliId)
      }
    }
    if (st.size < entry.consumedPos) entry = this._reset(file) // 檔案被重寫
    if (st.size === entry.lastSize) return entry.messages.slice(-RETURN_LIMIT) // 沒變動

    this._advance(file, entry, st.size, parser)
    entry.lastSize = st.size
    return entry.messages.slice(-RETURN_LIMIT)
  }

  /**
   * 取某檔的段落索引（直接查 DB；不觸發增量解析）。
   * totalCount = next_seq（DB 中紀錄的訊息總數）。
   * DB 不可用 → { segments: [], totalCount: 0 }。
   */
  getSegments(file: string): { segments: SegmentRow[]; totalCount: number } {
    return querySegments(file, this._dbState)
  }

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
  getMessagesRange(file: string, startSeq: number, endSeq: number, cliId: ConvCliId = 'claude'): ConversationMessage[] {
    return queryMessagesRange(file, startSeq, endSeq, this._parserOf(cliId), this._dbState, this._mem)
  }

  /**
   * 讀某 seq 範圍對應的原始 JSONL 行（Raw 模式按需取）。
   *
   * 實作：與 getMessagesRange 相同的 byte 定位邏輯，但直接回傳原始字串而非解析結果。
   * cap：最多 RAW_LINE_CAP 行或 RAW_BYTE_CAP bytes，超出截斷並標 truncated=true。
   * 容錯：讀失敗 / DB 不可用 → { lines: [], truncated: false }。
   */
  getRawLines(file: string, startSeq: number, endSeq: number): { lines: string[]; truncated: boolean } {
    return queryRawLines(file, startSeq, endSeq, this._dbState)
  }

  /**
   * 動態初始窗口：先走增量解析推進進度，再依讀取水位決定回傳範圍。
   *   size = max(300, next_seq − ui_read_seq)
   *   startSeq = max(0, next_seq − size)
   * 回 [startSeq, next_seq)，並將 ui_read_seq 推到 next_seq。
   *
   * 實作（純索引）：算出 startSeq 後走 getMessagesRange(file, startSeq, next_seq - 1)
   * 取得對齊後的訊息切片（涵蓋段 / 前言皆已在 getMessagesRange 內處理；多讀的 seq
   * 已被精確切除）。
   *
   * @param cliId 解析器分流（預設 'claude'，向後相容）。codex 檔務必傳 'codex'。
   */
  getWindow(file: string, cliId: ConvCliId = 'claude'): { messages: ConversationMessage[]; startSeq: number; totalCount: number } {
    // 先走增量解析（觸發 persist / seg 維護）
    this.getByFile(file, cliId)
    return queryWindow(file, this._parserOf(cliId), this._dbState, this._mem)
  }
}
