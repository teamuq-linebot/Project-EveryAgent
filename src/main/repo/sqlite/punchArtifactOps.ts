// ---------------------------------------------------------------------------
// punchArtifactOps.ts — punch_artifacts 寫入 + 讀取
//   機械式 move-only：原本體原樣搬，把 this.db 改成 db 參數。
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3'
import type { PunchArtifactInsertInput, PunchArtifactRow } from './types'
import { nowIso, toStrOrNull } from './util'

export function insertPunchArtifacts(
  db: Database.Database,
  input: PunchArtifactInsertInput,
): number {
  const sessionId = toStrOrNull(input.punch_session_id)
  const punchUid = toStrOrNull(input.punch_uid)
  if (!sessionId) {
    throw new Error('insertPunchArtifacts: punch_session_id is required')
  }
  if (!punchUid) {
    throw new Error('insertPunchArtifacts: punch_uid is required')
  }
  const arts = Array.isArray(input.artifacts) ? input.artifacts : []
  if (arts.length === 0) return 0

  const now = nowIso()
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO punch_artifacts ' +
      '(punch_session_id, punch_uid, tool_use_id, hunk_index, file_path, tool, op_type, ' +
      ' old_start, lines_added, lines_removed, content_lines, ts) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const tx = db.transaction(() => {
    let inserted = 0
    for (const a of arts) {
      const toolUseId = toStrOrNull(a.tool_use_id)
      if (!toolUseId) continue
      const tool = toStrOrNull(a.tool)
      if (!tool) continue
      const filePath = a.file_path ?? ''
      const hunkIndex = Number.isFinite(a.hunk_index) ? Math.trunc(a.hunk_index) : 0
      const info = stmt.run(
        sessionId,
        punchUid,
        toolUseId,
        hunkIndex,
        filePath,
        tool,
        toStrOrNull(a.op_type),
        a.old_start == null || !Number.isFinite(a.old_start) ? null : Math.trunc(a.old_start),
        Number.isFinite(a.lines_added) ? Math.trunc(a.lines_added) : 0,
        Number.isFinite(a.lines_removed) ? Math.trunc(a.lines_removed) : 0,
        a.content_lines == null || !Number.isFinite(a.content_lines)
          ? null
          : Math.trunc(a.content_lines),
        toStrOrNull(a.ts) ?? now,
      )
      inserted += info.changes
    }
    return inserted
  })
  return tx() as number
}

export function findPunchArtifacts(
  db: Database.Database,
  punchSessionId: string,
  punchUid: string,
): PunchArtifactRow[] {
  return db
    .prepare(
      'SELECT * FROM punch_artifacts WHERE punch_session_id = ? AND punch_uid = ? ' +
        'ORDER BY file_path, tool_use_id, hunk_index',
    )
    .all(punchSessionId, punchUid) as PunchArtifactRow[]
}
