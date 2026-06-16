/**
 * legacyDbMigration.ts — conv cache DB 路徑解析 + 舊獨立 conversations.db 退場。
 *
 * 從 conversationStore.ts 原樣搬出（move-only，行為保留）：
 *   - dbPath()                       D25：cache 併入 teamuq.db（沿用 repo 的 teamuqDbPath）。
 *   - legacyConversationsDbPath()    舊獨立 conversations.db 路徑（D25 退役）。
 *   - todayStamp()                   YYYY-MM-DD 改名後綴。
 *   - retireLegacyConversationsDb()  退役舊檔（改名 .migrated；冪等容錯）。
 *
 * 這些原本皆為 module-private 自由函式，只被 ConversationStore 內部呼叫；
 * 抽到 sibling 後由 facade（conversationStore.ts）import 回去委派，對外介面不變。
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { teamuqDbPath } from '../../repo/sqliteTaskRepository'

/** D25：cache 併入 teamuq.db。沿用 repo 的 teamuqDbPath（吃 TEAMUQ_HOME，與主 DB 同檔）。 */
export function dbPath(): string {
  return teamuqDbPath()
}

/** 舊獨立 conversations.db 路徑（D25 退役；首開 teamuq.db 時改名 .migrated）。 */
export function legacyConversationsDbPath(): string {
  const home = process.env['TEAMUQ_HOME'] || os.homedir()
  return path.join(home, '.teamuq', 'conversations.db')
}

/** YYYY-MM-DD 改名後綴（對齊 migrateToSingleDb.todayStamp 慣例）。 */
export function todayStamp(): string {
  const d = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

/**
 * 退役舊 conversations.db（連 -wal/-shm）：改名 `*.migrated.<日期>`（D25 §A.4）。
 * 資料不遷移（cache 可重建、JSONL 是事實來源、首讀自動重掃）。
 * 容錯：任一檔改名失敗（如被佔用）記 log 繼續，不阻斷 —— 主檔（.db）未改名則下次再試。
 * 已不存在 → no-op（冪等）。
 */
export function retireLegacyConversationsDb(): void {
  const base = legacyConversationsDbPath()
  const stamp = todayStamp()
  for (const suffix of ['', '-wal', '-shm']) {
    const src = base + suffix
    try {
      if (!fs.existsSync(src)) continue
      fs.renameSync(src, `${src}.migrated.${stamp}`)
    } catch (err) {
      // 改名失敗（佔用/權限）：記 log 繼續，不阻斷 conv cache 開啟（下次啟動再試）。
      console.warn(`[convStore] retire legacy conversations.db failed: ${src}:`, err)
    }
  }
}
