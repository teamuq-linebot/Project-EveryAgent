// ---------------------------------------------------------------------------
// punchLocalFirstOps.ts — 打卡 local-first（createLocalSubtask / settleLocalSubtask /
//   recordLocalOneshot）跨 subtasks+punches 的 transaction 函式（純本地版）
//   已移除：origin / platform_local_id / sync_enabled / dirty / pending_op / tombstone /
//            raw_json；tasks 查詢去 OR remote_id；genLocSubtaskId 改用 UUID。
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3'
import type {
  LocalCreateSubtaskInput,
  LocalOneshotInput,
  LocalSettleSubtaskInput,
} from '../../monitor/punchExecutor'
import { genLocalId, nowIso, toStrOrNull } from './util'

// ─────────────────────────── createLocalSubtask ───────────────────────────

export function createLocalSubtask(
  db: Database.Database,
  input: LocalCreateSubtaskInput,
): { localId: string } {
  const now = nowIso()
  const locId = genLocalId()
  const taskLocalId = toStrOrNull(input.task_local_id)
  if (!taskLocalId) {
    throw new Error('createLocalSubtask: task_local_id is required (FK→tasks.local_id)')
  }
  const sessionId = String(input.session_id ?? '')
  const startTime = toStrOrNull(input.start_time)

  let resultLocalId = locId
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT subtask_id FROM punches WHERE task_id IS ? AND punch_uid = ? LIMIT 1')
      .get(taskLocalId, String(input.punch_uid)) as { subtask_id: string | null } | undefined
    if (existing?.subtask_id) {
      resultLocalId = existing.subtask_id
      return
    }

    // §dup-fix（防呆）：同 punch_uid 已被「其他任務」物化（跨任務重複）。
    const foreign = db
      .prepare(
        'SELECT subtask_id FROM punches WHERE punch_uid = ? AND task_id IS NOT ? AND subtask_id IS NOT NULL LIMIT 1',
      )
      .get(String(input.punch_uid), taskLocalId) as { subtask_id: string | null } | undefined
    if (foreign?.subtask_id) {
      resultLocalId = foreign.subtask_id
      return  // 早退：punch 已歸屬別任務，本任務不重複物化
    }

    const parent = db
      .prepare('SELECT local_id FROM tasks WHERE local_id = ?')
      .get(taskLocalId) as { local_id: string } | undefined
    const subtaskTaskLocalId = parent?.local_id ?? taskLocalId

    db.prepare(
      'INSERT INTO subtasks ' +
        '(local_id, task_local_id, name, description, start_time, end_time, duration, ' +
        ' assignee_id, category_id, is_settled, created_at, updated_at) ' +
        'VALUES (?, ?, ?, NULL, ?, NULL, NULL, ?, NULL, 0, ?, ?)',
    ).run(
      locId,
      subtaskTaskLocalId,
      input.name,
      startTime,
      toStrOrNull(input.assignee_id),
      now,
      now,
    )

    db.prepare(
      'INSERT INTO punches ' +
        '(punch_uid, session_id, task_id, type, name, started_at, ' +
        ' subtask_id, cli, status, created_at, updated_at) ' +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?) " +
        'ON CONFLICT(task_id, punch_uid) WHERE task_id IS NOT NULL DO NOTHING',
    ).run(
      String(input.punch_uid),
      toStrOrNull(input.session_id),
      taskLocalId,
      input.type ?? null,
      input.name,
      startTime,
      locId,
      input.cli ?? null,
      now,
      now,
    )
  })
  tx()
  return { localId: resultLocalId }
}

// ─────────────────────────── settleLocalSubtask ───────────────────────────

export function settleLocalSubtask(
  db: Database.Database,
  input: LocalSettleSubtaskInput,
): void {
  const localId = String(input.local_id ?? '')
  if (!localId) {
    throw new Error('settleLocalSubtask: local_id is required (start 階段回傳的暫鍵)')
  }
  const now = nowIso()
  const endTime = toStrOrNull(input.end_time)
  const duration = Number.isFinite(input.duration) ? input.duration : null
  const description = input.description ?? null
  const punchTaskId = input.task_id ?? null

  const tx = db.transaction(() => {
    // §F-PP-3b：解析呼叫任務 UUID（task_id），subtask UPDATE 限定「本任務所有」。
    const parentT = punchTaskId
      ? (db
          .prepare('SELECT local_id FROM tasks WHERE local_id = ?')
          .get(punchTaskId) as { local_id: string } | undefined)
      : undefined
    const callerTaskLocalId = parentT?.local_id ?? punchTaskId // 可能為 null（無 task_id）

    // 1. 補 subtask end/duration/description；is_settled=1。
    const info = callerTaskLocalId
      ? db
          .prepare(
            'UPDATE subtasks SET ' +
              'end_time = ?, duration = ?, description = ?, is_settled = 1, ' +
              'updated_at = ? ' +
              'WHERE local_id = ? AND task_local_id IS ?',
          )
          .run(endTime, duration, description, now, localId, callerTaskLocalId)
      : db
          .prepare(
            'UPDATE subtasks SET ' +
              'end_time = ?, duration = ?, description = ?, is_settled = 1, ' +
              'updated_at = ? ' +
              'WHERE local_id = ?',
          )
          .run(endTime, duration, description, now, localId)
    if (info.changes === 0) {
      const exists = db
        .prepare('SELECT 1 FROM subtasks WHERE local_id = ? LIMIT 1')
        .get(localId)
      if (!exists) throw new Error(`settleLocalSubtask: subtask not found: ${localId}`)
      return // foreign-owned：本任務不 settle 別任務 subtask
    }

    // 2. 帳本 punchOut；§F-PP-3：WHERE 加 task_id IS ? 限定。
    db.prepare(
      'UPDATE punches SET ended_at = ?, hours = ?, description = ?, ' +
        "ok = ?, error = ?, status = 'done', updated_at = ? " +
        'WHERE task_id IS ? AND punch_uid = ?',
    ).run(endTime, duration, description, 1, null, now, punchTaskId, String(input.punch_uid))
  })
  tx()
}

// ─────────────────────────── recordLocalOneshot ───────────────────────────

export function recordLocalOneshot(
  db: Database.Database,
  input: LocalOneshotInput,
): { localId: string } {
  const now = nowIso()
  const locId = genLocalId()
  const taskLocalId = toStrOrNull(input.task_local_id)
  if (!taskLocalId) {
    throw new Error('recordLocalOneshot: task_local_id is required (FK→tasks.local_id)')
  }
  const sessionId = String(input.session_id ?? '')
  const startTime = toStrOrNull(input.start_time)
  const endTime = toStrOrNull(input.end_time)
  const duration = Number.isFinite(input.duration) ? input.duration : null
  const description = input.description ?? null

  let resultLocalId = locId
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT subtask_id FROM punches WHERE task_id IS ? AND punch_uid = ? LIMIT 1')
      .get(taskLocalId, String(input.punch_uid)) as { subtask_id: string | null } | undefined
    if (existing?.subtask_id) {
      resultLocalId = existing.subtask_id
      return
    }

    // §dup-fix（防呆）：同 punch_uid 已被「其他任務」物化。
    const foreign = db
      .prepare(
        'SELECT subtask_id FROM punches WHERE punch_uid = ? AND task_id IS NOT ? AND subtask_id IS NOT NULL LIMIT 1',
      )
      .get(String(input.punch_uid), taskLocalId) as { subtask_id: string | null } | undefined
    if (foreign?.subtask_id) {
      resultLocalId = foreign.subtask_id
      return  // 早退：punch 已歸屬別任務，本任務不重複物化
    }

    const parent = db
      .prepare('SELECT local_id FROM tasks WHERE local_id = ?')
      .get(taskLocalId) as { local_id: string } | undefined
    const subtaskTaskLocalId = parent?.local_id ?? taskLocalId

    db.prepare(
      'INSERT INTO subtasks ' +
        '(local_id, task_local_id, name, description, start_time, end_time, duration, ' +
        ' assignee_id, category_id, is_settled, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)',
    ).run(
      locId,
      subtaskTaskLocalId,
      input.name,
      description,
      startTime,
      endTime,
      duration,
      toStrOrNull(input.assignee_id),
      now,
      now,
    )

    db.prepare(
      'INSERT INTO punches ' +
        '(punch_uid, session_id, task_id, type, name, description, ' +
        ' started_at, ended_at, hours, subtask_id, cli, ' +
        " status, ok, error, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', 1, NULL, ?, ?) " +
        'ON CONFLICT(task_id, punch_uid) WHERE task_id IS NOT NULL DO UPDATE SET ' +
        '  task_id=excluded.task_id, type=excluded.type, ' +
        '  name=excluded.name, description=excluded.description, ' +
        '  started_at=excluded.started_at, ended_at=excluded.ended_at, ' +
        '  hours=excluded.hours, subtask_id=excluded.subtask_id, ' +
        '  cli=COALESCE(excluded.cli, cli), ' +
        "  status='done', ok=1, error=NULL, " +
        '  updated_at=excluded.updated_at',
    ).run(
      String(input.punch_uid),
      sessionId || null,
      taskLocalId,
      input.type ?? null,
      input.name,
      description,
      startTime,
      endTime,
      duration,
      locId,
      input.cli ?? null,
      now,
      now,
    )
  })
  tx()
  return { localId: resultLocalId }
}
