// ---------------------------------------------------------------------------
// taskOps.ts — tasks aggregate 的 CRUD 函式（純本地版）
//   已移除：upsertTaskFromRemote / resolveTaskLocalId（pull 鏡像）
//            origin / platform_local_id / sync_enabled / dirty / pending_op / tombstone /
//            raw_json / assignee_id / assignee_user_id
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3'
import type {
  TaskCreateInput,
  TaskFindFilter,
  TaskRow,
} from '../taskTypes'
import { genLocalId, nowIso } from './util'

// ─────────────────────────── tasks ───────────────────────────

export function findAllTasks(db: Database.Database, filter?: TaskFindFilter): TaskRow[] {
  const where: string[] = []
  const args: unknown[] = []

  const statuses = filter?.statuses
  if (statuses) {
    const arr = Array.isArray(statuses) ? statuses : [statuses]
    if (arr.length === 1) {
      where.push('status = ?')
      args.push(arr[0])
    } else if (arr.length > 1) {
      where.push('status IN (' + arr.map(() => '?').join(', ') + ')')
      args.push(...arr)
    }
  }

  const search = filter?.search?.trim()
  if (search) {
    where.push('(name LIKE ? OR description LIKE ?)')
    const like = `%${search}%`
    args.push(like, like)
  }

  let sql =
    'SELECT * FROM tasks' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY created_at DESC'

  if (filter?.limit != null) {
    sql += ' LIMIT ?'
    args.push(filter.limit)
  }
  if (filter?.offset != null) {
    sql += ' OFFSET ?'
    args.push(filter.offset)
  }

  return db.prepare(sql).all(...args) as TaskRow[]
}

export function getTask(db: Database.Database, localId: string): TaskRow | null {
  const row = db.prepare('SELECT * FROM tasks WHERE local_id = ?').get(localId) as
    | TaskRow
    | undefined
  return row ?? null
}

export function createTask(db: Database.Database, input: TaskCreateInput): TaskRow {
  const localId = genLocalId()
  const now = nowIso()
  db.prepare(
    'INSERT INTO tasks ' +
      '(local_id, milestone_local_id, project_local_id, name, status, description, ' +
      ' created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    localId,
    input.milestoneLocalId ?? null,
    input.projectLocalId ?? null,
    input.name,
    input.status ?? 'PENDING',
    input.description ?? null,
    now,
    now,
  )
  return getTask(db, localId) as TaskRow
}

export function updateTaskStatus(
  db: Database.Database,
  localId: string,
  status: string,
): TaskRow | null {
  const row = getTask(db, localId)
  if (!row) return null

  const now = nowIso()
  db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE local_id = ?').run(
    status,
    now,
    row.local_id,
  )
  return getTask(db, row.local_id)
}
