/**
 * sqliteTaskRepository.spec.ts — SqliteTaskRepository 純本地版單元測試
 *
 * 純本地版：已移除雲端同步欄位（origin / remote_id / platform_local_id / sync_enabled /
 *   dirty / pending_op / tombstone / raw_json / assignee_id / assignee_user_id / version）。
 * 已移除方法：upsertTaskFromRemote / upsertFromFindAllTasks / clearRemoteByPlatform /
 *   countRemoteByPlatform / realignInstancesBaseUrl / backfillRemoteMirrorSyncEnabled /
 *   instanceMeta / isAccountInstance / resolveOperationsPlatformId / accountInstanceLocalId /
 *   platforms table / milestone_members table。
 *
 * 保留測試：
 *   findAllTasks（R1/R5/R6）— 空表、statuses 過濾、search 過濾
 *   createTask（CT1-CT3）— 基本建立、FK milestone、回讀
 *   updateTaskStatus（RU1）— 純本地 status 更新（無 dirty/pending_op）
 *   project_folders（PF1-PF8）— 專案↔資料夾多對多關聯
 *   createTask project_local_id（PL1-PL2）
 */

import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import {
  SqliteTaskRepository,
  ensureSchema,
} from '../src/main/repo/sqliteTaskRepository'
import type { TaskRow } from '../src/main/repo/taskTypes'

// ---------------------------------------------------------------------------
// 輔助：建隔離 in-memory DB
// ---------------------------------------------------------------------------

function makeRepo(): { repo: SqliteTaskRepository; db: Database.Database } {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  ensureSchema(db)
  return { repo: new SqliteTaskRepository(db), db }
}

function insertTask(
  db: Database.Database,
  overrides: Partial<TaskRow> & { local_id: string; name: string },
): void {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO tasks (local_id, milestone_local_id, name, status, description, ' +
      'priority, start_date, end_date, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    overrides.local_id,
    overrides.milestone_local_id ?? null,
    overrides.name,
    overrides.status ?? null,
    overrides.description ?? null,
    overrides.priority ?? null,
    overrides.start_date ?? null,
    overrides.end_date ?? null,
    overrides.created_at ?? now,
    overrides.updated_at ?? null,
  )
}

function insertProject(
  db: Database.Database,
  o: { local_id: string },
): void {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO projects (local_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(o.local_id, o.local_id, now, now)
}

function insertMilestone(
  db: Database.Database,
  o: { local_id: string },
): void {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO milestones (local_id, name, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(o.local_id, o.local_id, now, now)
}

// ---------------------------------------------------------------------------
// Tests — findAllTasks
// ---------------------------------------------------------------------------

describe('SqliteTaskRepository.findAllTasks', () => {
  let repo: SqliteTaskRepository
  let db: Database.Database

  beforeEach(() => {
    ;({ repo, db } = makeRepo())
  })

  it('R1: 空表 → 回空陣列', () => {
    const rows = repo.findAllTasks()
    expect(rows).toEqual([])
  })

  it('R5: statuses 單值過濾', () => {
    insertTask(db, { local_id: 'task-todo', name: '待辦', status: 'TODO' })
    insertTask(db, { local_id: 'task-done', name: '完成', status: 'DONE' })
    const rows = repo.findAllTasks({ statuses: 'TODO' })
    expect(rows.length).toBe(1)
    expect(rows[0].local_id).toBe('task-todo')
  })

  it('R6: search 過濾 — name LIKE', () => {
    insertTask(db, { local_id: 'task-a', name: '前端重構' })
    insertTask(db, { local_id: 'task-b', name: '後端修復' })
    const rows = repo.findAllTasks({ search: '前端' })
    expect(rows.length).toBe(1)
    expect(rows[0].local_id).toBe('task-a')
  })

  it('R-all: 多筆任務全部回傳', () => {
    insertTask(db, { local_id: 'task-1', name: '任務A' })
    insertTask(db, { local_id: 'task-2', name: '任務B' })
    const rows = repo.findAllTasks()
    expect(rows.length).toBe(2)
    const ids = rows.map((r) => r.local_id)
    expect(ids).toContain('task-1')
    expect(ids).toContain('task-2')
  })
})

// ---------------------------------------------------------------------------
// Tests — updateTaskStatus（純本地）
// ---------------------------------------------------------------------------

describe('SqliteTaskRepository.updateTaskStatus（純本地）', () => {
  let repo: SqliteTaskRepository
  let db: Database.Database

  beforeEach(() => {
    ;({ repo, db } = makeRepo())
  })

  it('RU1: 純本地任務改 status → status 變更、updated_at 已寫', () => {
    insertTask(db, { local_id: 'loc-1', name: '本地任務', status: 'TODO' })
    const out = repo.updateTaskStatus('loc-1', 'IN_PROGRESS')
    expect(out?.status).toBe('IN_PROGRESS')
    expect(repo.getTask('loc-1')?.status).toBe('IN_PROGRESS')
    expect(repo.getTask('loc-1')?.updated_at).toBeTruthy()
  })

  it('RU5: 找不到 task → 回 null（不拋）', () => {
    expect(repo.updateTaskStatus('nope', 'DONE')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests — createTask
// ---------------------------------------------------------------------------

describe('SqliteTaskRepository.createTask（本地新建任務）', () => {
  let repo: SqliteTaskRepository
  let db: Database.Database

  beforeEach(() => {
    ;({ repo, db } = makeRepo())
  })

  it('CT1: 基本建立 — name/status/created_at 正確寫入', () => {
    insertMilestone(db, { local_id: 'ms-1' })
    const row = repo.createTask({
      name: '測試任務',
      milestoneLocalId: 'ms-1',
      description: '說明文字',
    })
    expect(row.name).toBe('測試任務')
    expect(row.description).toBe('說明文字')
    expect(row.milestone_local_id).toBe('ms-1')
    expect(row.status).toBe('PENDING')
    expect(row.created_at).toBeTruthy()
    expect(row.updated_at).toBeTruthy()
    expect(row.local_id).toBeTruthy()
    // DB 真值同步
    const fromDb = repo.getTask(row.local_id)
    expect(fromDb?.name).toBe('測試任務')
  })

  it('CT3: milestone FK — 帶 milestoneLocalId，回讀 task.milestone_local_id 正確', () => {
    insertMilestone(db, { local_id: 'ms-fk' })
    const row = repo.createTask({ name: 'FK 任務', milestoneLocalId: 'ms-fk' })
    expect(row.milestone_local_id).toBe('ms-fk')
    expect(repo.getTask(row.local_id)?.milestone_local_id).toBe('ms-fk')
  })
})

// ---------------------------------------------------------------------------
// project_folders — 專案↔資料夾多對多關聯
// ---------------------------------------------------------------------------

describe('SqliteTaskRepository project_folders（專案↔資料夾多對多）', () => {
  let repo: SqliteTaskRepository
  let db: Database.Database

  beforeEach(() => {
    ;({ repo, db } = makeRepo())
  })

  it('PF1: link 後 byFolder / byProject 雙向反查命中', () => {
    insertProject(db, { local_id: 'proj-1' })
    repo.linkProjectFolder('proj-1', 'C:\\work\\repo-a')

    const byFolder = repo.findProjectsByFolder('C:\\work\\repo-a')
    expect(byFolder.length).toBe(1)
    expect(byFolder[0].local_id).toBe('proj-1')

    const byProject = repo.findFoldersByProject('proj-1')
    expect(byProject).toEqual(['C:\\work\\repo-a'])
  })

  it('PF2: 多對多 — 一資料夾↔多 project、一 project↔多資料夾', () => {
    insertProject(db, { local_id: 'proj-a' })
    insertProject(db, { local_id: 'proj-b' })
    repo.linkProjectFolder('proj-a', 'C:\\shared')
    repo.linkProjectFolder('proj-b', 'C:\\shared')
    repo.linkProjectFolder('proj-a', 'C:\\extra')

    const projects = repo.findProjectsByFolder('C:\\shared').map((p) => p.local_id).sort()
    expect(projects).toEqual(['proj-a', 'proj-b'])

    const folders = repo.findFoldersByProject('proj-a')
    expect(folders.sort()).toEqual(['C:\\extra', 'C:\\shared'])
  })

  it('PF3: link 冪等（重複 link 同 (project, folder) → 不重複）', () => {
    insertProject(db, { local_id: 'proj-1' })
    repo.linkProjectFolder('proj-1', 'C:\\work')
    repo.linkProjectFolder('proj-1', 'C:\\work')
    const count = (
      db.prepare('SELECT COUNT(*) AS c FROM project_folders').get() as { c: number }
    ).c
    expect(count).toBe(1)
    expect(repo.findFoldersByProject('proj-1')).toEqual(['C:\\work'])
  })

  it('PF4: unlink 只解除指定 (project, folder)，其他關聯保留', () => {
    insertProject(db, { local_id: 'proj-1' })
    repo.linkProjectFolder('proj-1', 'C:\\a')
    repo.linkProjectFolder('proj-1', 'C:\\b')
    repo.unlinkProjectFolder('proj-1', 'C:\\a')
    expect(repo.findFoldersByProject('proj-1')).toEqual(['C:\\b'])
    expect(repo.findProjectsByFolder('C:\\a')).toEqual([])
  })

  it('PF8: 無關聯 → byFolder / byProject 回空陣列', () => {
    expect(repo.findProjectsByFolder('C:\\nope')).toEqual([])
    expect(repo.findFoldersByProject('proj-nope')).toEqual([])
  })

  it('PF7: byProject 依 created_at 排序', () => {
    insertProject(db, { local_id: 'proj-1' })
    db.prepare(
      'INSERT INTO project_folders (project_local_id, folder_path, created_at) VALUES (?, ?, ?)',
    ).run('proj-1', 'C:\\second', '2026-06-08T00:00:02.000Z')
    db.prepare(
      'INSERT INTO project_folders (project_local_id, folder_path, created_at) VALUES (?, ?, ?)',
    ).run('proj-1', 'C:\\first', '2026-06-08T00:00:01.000Z')
    expect(repo.findFoldersByProject('proj-1')).toEqual(['C:\\first', 'C:\\second'])
  })
})

// ---------------------------------------------------------------------------
// createTask project_local_id — 團隊對話 session：建 task 連 project
// ---------------------------------------------------------------------------

describe('SqliteTaskRepository.createTask project_local_id（task↔project）', () => {
  let repo: SqliteTaskRepository
  let db: Database.Database

  beforeEach(() => {
    ;({ repo, db } = makeRepo())
  })

  it('PL1: createTask 帶 projectLocalId → 寫入並回讀', () => {
    insertProject(db, { local_id: 'proj-x' })
    const row = repo.createTask({ name: '團隊任務', projectLocalId: 'proj-x' })
    expect(row.project_local_id).toBe('proj-x')
    expect(repo.getTask(row.local_id)?.project_local_id).toBe('proj-x')
  })

  it('PL2: createTask 不帶 projectLocalId → project_local_id 為 null', () => {
    const row = repo.createTask({ name: '無 project 任務' })
    expect(row.project_local_id).toBeNull()
  })
})
