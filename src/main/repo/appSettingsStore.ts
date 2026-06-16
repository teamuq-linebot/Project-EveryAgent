/**
 * appSettingsStore.ts — DB-backed 非機密設定 key-value（teamuq.db `app_settings` 表）。
 *
 * plan_v1 §2.2（app_settings：key-value JSON，取代 qwen.json 非機密部分）/ §2.13 step5 /
 * §5（LLM 設定改存 app_settings(key='llm') + secrets('llm:*:api_key')）/ G6（讀取端換源）。
 *
 * 僅存非機密設定（明文 JSON）；敏感值不要寫入此表。
 * 連線預設用 repo 的 openTeamuqDb()（吃 TEAMUQ_HOME，與遷移/其他 store 同一檔、同一 schema）；
 * 測試可注入既開的 Database 隔離。
 *
 * 讀容錯：缺鍵 / 壞 JSON / 例外 → 回 null（不拋；呼叫端視為「未設定」走預設）。
 * 寫採 upsert（ON CONFLICT 更新），與 migrateToSingleDb.migrateSettings 寫入語意一致。
 */

import Database from 'better-sqlite3'

import { openTeamuqDb } from './sqliteTaskRepository'

interface AppSettingRow {
  value_json: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * DB-backed 非機密設定存放（app_settings 表）。
 *
 * 用法：
 *   const store = new AppSettingsStore()
 *   const llm = store.getJson('llm')          // { base_url, model } | null
 *   store.setJson('llm', { base_url, model }) // upsert（不含 api_key，機密進 secrets）
 *
 * 測試：new AppSettingsStore({ db: openedTestDb })。
 */
export class AppSettingsStore {
  private readonly _db: Database.Database
  private readonly _ownsDb: boolean

  constructor(opts?: { db?: Database.Database }) {
    if (opts?.db) {
      this._db = opts.db
      this._ownsDb = false
    } else {
      this._db = openTeamuqDb()
      this._ownsDb = true
    }
  }

  /**
   * 取一筆設定解析為物件。缺鍵 / 壞 JSON / 非物件 / 例外 → null。
   */
  getJson(key: string): Record<string, unknown> | null {
    let row: AppSettingRow | undefined
    try {
      row = this._db
        .prepare('SELECT value_json FROM app_settings WHERE key = ?')
        .get(key) as AppSettingRow | undefined
    } catch (err) {
      console.error('[AppSettingsStore] getJson failed:', errMsg(err))
      return null
    }
    if (!row) return null
    try {
      const parsed: unknown = JSON.parse(row.value_json)
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }

  /**
   * 寫一筆設定（upsert）。value 序列化為 JSON 存 value_json。失敗只記錄不拋。
   */
  setJson(key: string, value: Record<string, unknown>): void {
    const now = nowIso()
    try {
      this._db
        .prepare(
          'INSERT INTO app_settings(key, value_json, updated_at) VALUES(?, ?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
        )
        .run(key, JSON.stringify(value), now)
    } catch (err) {
      console.error('[AppSettingsStore] setJson failed:', errMsg(err))
    }
  }

  /** 關閉自有連線（注入的連線不關，由呼叫端管理）。 */
  close(): void {
    if (!this._ownsDb) return
    try {
      this._db.close()
    } catch {
      /* ignore */
    }
  }
}
