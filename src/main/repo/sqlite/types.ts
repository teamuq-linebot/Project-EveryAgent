// ---------------------------------------------------------------------------
// punch_artifacts 列型別 / 輸入型別（§2.14d D31）
//   row 逐欄對齊 SCHEMA_PUNCH_ARTIFACTS；輸入 item 欄名對齊 parse.WorkArtifact /
//   punchCore.PunchArtifact（去 punch 關聯鍵 — 由 insert 參數帶 session_id+punch_uid）。
// ---------------------------------------------------------------------------

/** punch_artifacts 列（§2.2 SCHEMA_PUNCH_ARTIFACTS）。PK (punch_session_id,punch_uid,tool_use_id,hunk_index)。 */
export interface PunchArtifactRow {
  punch_session_id: string
  punch_uid: string
  tool_use_id: string
  hunk_index: number
  file_path: string
  /** 'Edit' | 'Write'。 */
  tool: string
  /** Write 才有：'create' | 'update'。 */
  op_type: string | null
  /** Edit hunk 精確起始行號（1-indexed）。 */
  old_start: number | null
  lines_added: number
  lines_removed: number
  /** Write 用：content 總行數（create=精確新增）。 */
  content_lines: number | null
  ts: string
}

/**
 * 單一 Edit/Write 操作（hunk 級）的寫入 item。欄名對齊 parse.WorkArtifact / punchCore.PunchArtifact，
 * 去掉 punch 關聯鍵（由 insertPunchArtifacts 參數統一帶 punch_session_id + punch_uid）。
 */
export interface PunchArtifactInputItem {
  tool_use_id: string
  hunk_index: number
  file_path: string
  /** 'Edit' | 'Write'。 */
  tool: string
  op_type?: string | null
  old_start?: number | null
  lines_added: number
  lines_removed: number
  content_lines?: number | null
  ts?: string | null
}

/** insertPunchArtifacts 輸入：punch 關聯鍵 + 一批 hunk 級 artifacts（§2.14d D31）。 */
export interface PunchArtifactInsertInput {
  /** punch_artifacts.punch_session_id（關聯 punches.session_id）。 */
  punch_session_id: string
  /** punch_artifacts.punch_uid（關聯 punches/subtasks 既有冪等鍵）。 */
  punch_uid: string
  artifacts: PunchArtifactInputItem[]
}
