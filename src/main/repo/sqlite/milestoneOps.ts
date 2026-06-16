// ---------------------------------------------------------------------------
// milestoneOps.ts — milestones aggregate 的 CRUD 函式（純本地版）
//   已移除：upsertMilestoneFromRemote / resolveMilestoneLocalId（pull 鏡像）
//            origin / platform_local_id / sync_enabled / dirty / pending_op / tombstone /
//            raw_json / version / public_id / remote_id
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3'
import type {
  MilestoneCreateInput,
  MilestoneFindFilter,
  MilestoneRow,
  MilestoneUpdateInput,
} from '../taskTypes'
import { genLocalId, nowIso } from './util'

// ─────────────────────────── milestones ───────────────────────────

export function findAllMilestones(
  db: Database.Database,
  filter?: MilestoneFindFilter,
): MilestoneRow[] {
  const where: string[] = []
  const args: unknown[] = []
  const projectLocalId = filter?.projectLocalId
  if (projectLocalId !== undefined && projectLocalId !== null) {
    where.push('project_local_id = ?')
    args.push(projectLocalId)
  }
  const sql =
    'SELECT * FROM milestones' +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY created_at DESC'
  return db.prepare(sql).all(...args) as MilestoneRow[]
}

export function getMilestone(db: Database.Database, localId: string): MilestoneRow | null {
  const row = db.prepare('SELECT * FROM milestones WHERE local_id = ?').get(localId) as
    | MilestoneRow
    | undefined
  return row ?? null
}

export function createMilestone(
  db: Database.Database,
  input: MilestoneCreateInput,
): MilestoneRow {
  const projectLocalId = input.projectLocalId ?? null
  const localId = genLocalId()
  const now = nowIso()
  db.prepare(
    'INSERT INTO milestones ' +
      '(local_id, project_local_id, name, description, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    localId,
    projectLocalId,
    input.name,
    input.description ?? null,
    now,
    now,
  )
  return getMilestone(db, localId) as MilestoneRow
}

export function updateMilestone(
  db: Database.Database,
  input: MilestoneUpdateInput,
): MilestoneRow {
  const existing = getMilestone(db, input.localId)
  if (!existing) throw new Error(`updateMilestone: milestone not found: ${input.localId}`)
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
  db.prepare('UPDATE milestones SET ' + sets.join(', ') + ' WHERE local_id = ?').run(...args)
  return getMilestone(db, input.localId) as MilestoneRow
}

export function deleteMilestone(db: Database.Database, localId: string): void {
  const row = getMilestone(db, localId)
  if (!row) return
  db.prepare('DELETE FROM milestones WHERE local_id = ?').run(localId)
}
