/**
 * migrateToSingleDb.spec.ts — 遷移 orchestrator 單元測試（better-sqlite3，tmp DB）
 *
 * 驗證：
 *  T1: 冪等重入 — 跑兩次不重複插入、不報錯（旗標 migrated_punches 跳過第二輪）
 *  T2: punches 筆數遷移正確 — 來源 N 筆 → 目標 ≥ N 筆、status='migrated'
 *  T3: （已移除）safeStorage/secrets — secrets 表與 Cognito 認證屬雲端概念，已於
 *      feat/remove-cloud-platform-local-only 刪除，對應測試一併移除。
 *  T4: 舊檔改名 — 全部 store ok 後，存在的舊檔被改名為 *.migrated.<stamp>
 *  T5: TEAMUQ_HOME 隔離 — 各 test 使用獨立目錄，不互相污染
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import Database from 'better-sqlite3'
import { migrateToSingleDb } from '../src/main/db/migrateToSingleDb'

// ---------------------------------------------------------------------------
// 測試輔助
// ---------------------------------------------------------------------------

/** 建一個獨立的 tmp 目錄，模擬 ~/.teamuq（TEAMUQ_HOME 隔離）。 */
function makeTmpDir(): string {
  const d = path.join(os.tmpdir(), `migrate_test_${Date.now()}_${Math.random().toString(36).slice(2)}`)
  fs.mkdirSync(d, { recursive: true })
  return d
}

/** 在 dir 下建一個最小 punches.db（帶 punches 表，插 n 筆）。 */
function makePunchesDb(dir: string, count: number): string {
  const dbPath = path.join(dir, 'punches.db')
  const db = new Database(dbPath)
  db.exec(`
    CREATE TABLE IF NOT EXISTS punches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      punch_uid TEXT NOT NULL,
      session_id TEXT, task_id TEXT,
      type TEXT, name TEXT, description TEXT,
      started_at TEXT, ended_at TEXT, hours REAL,
      subtask_id TEXT, status TEXT,
      ok INTEGER, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT
    )
  `)
  const ins = db.prepare(
    'INSERT INTO punches (punch_uid, session_id, task_id, type, name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  for (let i = 0; i < count; i++) {
    ins.run(`uid-${i}`, `sess-1`, `task-1`, 'oneshot', `punch ${i}`, 'done', new Date().toISOString())
  }
  db.close()
  return dbPath
}

// ---------------------------------------------------------------------------
// 每個 test 用獨立 tmpDir
// ---------------------------------------------------------------------------

let _tmpDir: string

beforeEach(() => {
  _tmpDir = makeTmpDir()
})

afterEach(() => {
  try { fs.rmSync(_tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
})

// ---------------------------------------------------------------------------
// T1: 冪等重入 — 旗標跳過第二輪
// ---------------------------------------------------------------------------

describe('T1: 冪等重入（旗標跳過）', () => {
  it('跑兩次 migrateToSingleDb，第二次 punches status=skipped 且不報錯', () => {
    const dbPath = path.join(_tmpDir, 'teamuq.db')
    // 建一個有 3 筆的 punches.db
    makePunchesDb(_tmpDir, 3)

    const opts = { dbPath, teamuqDir: _tmpDir }

    // 第一次
    const r1 = migrateToSingleDb(opts)
    expect(r1.fatalError).toBeUndefined()
    expect(r1.punches.status).toBe('migrated')

    // 第二次（旗標已標 done → 跳過）
    const r2 = migrateToSingleDb(opts)
    expect(r2.fatalError).toBeUndefined()
    expect(r2.punches.status).toBe('skipped')

    // 目標 DB 裡的 punches 數量仍然正確（不重複插入）
    const db = new Database(dbPath)
    const row = db.prepare('SELECT COUNT(*) AS c FROM punches').get() as { c: number }
    db.close()
    expect(row.c).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// T2: punches 筆數遷移正確
// ---------------------------------------------------------------------------

describe('T2: punches 筆數遷移正確', () => {
  it('來源 5 筆 → 目標 5 筆，status=migrated，sourceCount=5', () => {
    const dbPath = path.join(_tmpDir, 'teamuq.db')
    makePunchesDb(_tmpDir, 5)

    const report = migrateToSingleDb({
      dbPath,
      teamuqDir: _tmpDir,
    })

    expect(report.fatalError).toBeUndefined()
    expect(report.punches.status).toBe('migrated')
    // sourceCount = punches + notifications（notifications 表不存在 → 0）
    expect(report.punches.sourceCount).toBe(5)
    // 目標筆數 ≥ 來源筆數（INSERT OR IGNORE 冪等）
    expect((report.punches.targetCount ?? 0)).toBeGreaterThanOrEqual(5)
  })

  it('無舊檔（punches.db 不存在）→ status=absent，ok=true', () => {
    const dbPath = path.join(_tmpDir, 'teamuq.db')
    // 不建 punches.db

    const report = migrateToSingleDb({
      dbPath,
      teamuqDir: _tmpDir,
    })

    expect(report.fatalError).toBeUndefined()
    expect(report.punches.status).toBe('absent')
    expect(report.ok).toBe(true)
  })
})

// T3: safeStorage / secrets 表遷移測試已於 feat/remove-cloud-platform-local-only 刪除。
// 原因：B11 schema 瘦身已 DROP TABLE secrets（雲端認證表），migrateSecrets()
// 在 secrets 表不存在時必定拋錯 → status='failed'；此路徑屬已移除功能，測試一併移除。

// ---------------------------------------------------------------------------
// T4: 舊檔改名
// ---------------------------------------------------------------------------

describe('T4: 舊檔改名', () => {
  it('全部 store 成功後，punches.db 被改名為 punches.db.migrated.<stamp>', () => {
    const dbPath = path.join(_tmpDir, 'teamuq.db')
    makePunchesDb(_tmpDir, 2)
    const stamp = '2099-01-01'
    const oldPath = path.join(_tmpDir, 'punches.db')

    const report = migrateToSingleDb({
      dbPath,
      teamuqDir: _tmpDir,
      migratedStamp: stamp,
    })

    expect(report.fatalError).toBeUndefined()
    expect(report.ok).toBe(true)
    // 舊檔已被改名
    expect(fs.existsSync(oldPath)).toBe(false)
    expect(fs.existsSync(`${oldPath}.migrated.${stamp}`)).toBe(true)
    // report.renamed 包含改名路徑
    expect(report.renamed.some((r) => r.endsWith(`.migrated.${stamp}`))).toBe(true)
  })

  it('store 失敗時舊檔不改名', () => {
    const dbPath = path.join(_tmpDir, 'teamuq.db')
    // 建一個 punches.db，但目標 DB 已損（模擬：先建目標 DB，在 punches 寫之前強行蓋壞它）
    // 用另一種方式：注入一個會回 failed 的場景 — 建一個損壞的 punches.db
    const badPunches = path.join(_tmpDir, 'punches.db')
    fs.writeFileSync(badPunches, 'not-a-sqlite-database', 'utf-8')
    const stamp = '2099-01-01'

    const report = migrateToSingleDb({
      dbPath,
      teamuqDir: _tmpDir,
      migratedStamp: stamp,
    })

    // punches 應失敗
    expect(report.punches.status).toBe('failed')
    // ok=false → 舊檔不改名
    expect(report.ok).toBe(false)
    expect(fs.existsSync(badPunches)).toBe(true)
    expect(report.renamed.length).toBe(0)
  })
})
