// ---------------------------------------------------------------------------
// projectOps.ts — projects + project_folders aggregate 的 CRUD 函式（純本地版）
//   已移除：upsertProjectFromRemote / upsertProjectByName（pull 鏡像）
//            origin / platform_local_id / sync_enabled / dirty / pending_op / tombstone / raw_json
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3'
import type {
  ProjectCreateInput,
  ProjectFindFilter,
  ProjectRow,
  ProjectUpdateInput,
} from '../taskTypes'
import { genLocalId, nowIso } from './util'

// ─────────────────────────── projects ───────────────────────────

export function findAllProjects(db: Database.Database, filter?: ProjectFindFilter): ProjectRow[] {
  const where: string[] = []
  const args: unknown[] = []
  const search = filter?.search?.trim()
  if (search) {
    where.push('(name LIKE ? OR description LIKE ?)')
    const like = `%${search}%`
    args.push(like, like)
  }
  const sql =
    'SELECT * FROM projects' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY created_at DESC'
  return db.prepare(sql).all(...args) as ProjectRow[]
}

export function getProject(db: Database.Database, localId: string): ProjectRow | null {
  const row = db.prepare('SELECT * FROM projects WHERE local_id = ?').get(localId) as
    | ProjectRow
    | undefined
  return row ?? null
}

export function createProject(db: Database.Database, input: ProjectCreateInput): ProjectRow {
  const localId = genLocalId()
  const now = nowIso()
  db.prepare(
    'INSERT INTO projects (local_id, name, description, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?)',
  ).run(localId, input.name, input.description ?? null, now, now)
  return getProject(db, localId) as ProjectRow
}

export function updateProject(db: Database.Database, input: ProjectUpdateInput): ProjectRow {
  const existing = getProject(db, input.localId)
  if (!existing) throw new Error(`updateProject: project not found: ${input.localId}`)
  const sets: string[] = []
  const args: unknown[] = []
  if (input.name !== undefined) {
    sets.push('name = ?')
    args.push(input.name)
  }
  if (input.description !== undefined) {
    sets.push('description = ?')
    args.push(input.description)
  }
  sets.push('updated_at = ?')
  args.push(nowIso())
  args.push(input.localId)
  db.prepare('UPDATE projects SET ' + sets.join(', ') + ' WHERE local_id = ?').run(...args)
  return getProject(db, input.localId) as ProjectRow
}

export function deleteProject(db: Database.Database, localId: string): void {
  const row = getProject(db, localId)
  if (!row) return
  const tx = db.transaction((id: string) => {
    db.prepare('DELETE FROM milestones WHERE project_local_id = ?').run(id)
    db.prepare('DELETE FROM projects WHERE local_id = ?').run(id)
  })
  tx(localId)
}

// ─────────────────── project_folders ───────────────────

/** 正規化資料夾路徑：去除結尾的 / 或 \，確保 linkProjectFolder 與 findProjectsByFolder 比對一致。 */
function normalizeFolderPath(p: string): string {
  return p.replace(/[/\\]+$/, '')
}

export function linkProjectFolder(
  db: Database.Database,
  projectLocalId: string,
  folderPath: string,
): void {
  db.prepare(
    'INSERT OR IGNORE INTO project_folders (project_local_id, folder_path, created_at) ' +
      'VALUES (?, ?, ?)',
  ).run(projectLocalId, normalizeFolderPath(folderPath), nowIso())
}

export function unlinkProjectFolder(
  db: Database.Database,
  projectLocalId: string,
  folderPath: string,
): void {
  db.prepare(
    'DELETE FROM project_folders WHERE project_local_id = ? AND folder_path = ?',
  ).run(projectLocalId, folderPath)
}

export function findProjectsByFolder(db: Database.Database, folderPath: string): ProjectRow[] {
  return db
    .prepare(
      'SELECT p.* FROM projects p ' +
        'JOIN project_folders pf ON pf.project_local_id = p.local_id ' +
        'WHERE pf.folder_path = ?',
    )
    .all(normalizeFolderPath(folderPath)) as ProjectRow[]
}

export function findFoldersByProject(db: Database.Database, projectLocalId: string): string[] {
  const rows = db
    .prepare(
      'SELECT folder_path FROM project_folders WHERE project_local_id = ? ORDER BY created_at',
    )
    .all(projectLocalId) as Array<{ folder_path: string }>
  return rows.map((r) => r.folder_path)
}
