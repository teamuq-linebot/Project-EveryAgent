// ---------------------------------------------------------------------------
// subtaskOps.ts — subtasks aggregate 函式（純本地版）
//   已移除：舊遠端 upsert / 成員鏡像表操作
//            origin / platform_local_id / sync_enabled / dirty / pending_op / tombstone /
//            raw_json / version / remote_id
//   findMembersForMilestone 改回空陣列（純本地版不維護成員鏡像）
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3'
import type { MilestoneMemberRow, SubtaskRow } from '../taskTypes'

// ─────────────────────────── subtasks ───────────────────────────

export function getSubtaskRow(db: Database.Database, localId: string): SubtaskRow | null {
  const row = db.prepare('SELECT * FROM subtasks WHERE local_id = ?').get(localId) as
    | SubtaskRow
    | undefined
  return row ?? null
}

export function findMembersForMilestone(
  _db: Database.Database,
  _milestoneLocalId: string,
): MilestoneMemberRow[] {
  return []
}
