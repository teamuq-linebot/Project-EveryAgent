/**
 * 打卡規則：work_timeline row → 打卡名稱 / 事件穩定 key。
 * 忠實移植自 Python teamuq/worktime/sources/claude/punch_rules.py。
 * leaf 模組：不 import 本來源其他模組。
 */

/**
 * work_timeline row → 打卡名稱。
 *
 * - main-ai / main-dispatch → "agent_manager"
 * - subagent → "agent_" + agent_name（空白 fallback agent_type，再不行 "unknown"）
 * - 其他（main-user / ask）→ null（不打卡）
 *
 * 對應 Python punch_name_for_row()。
 */
export function punchNameForRow(row: Record<string, unknown>): string | null {
  const kind = row['kind'];
  if (kind === 'main-ai' || kind === 'main-dispatch') {
    return 'agent_manager';
  }
  if (kind === 'subagent') {
    const name =
      ((row['agent_name'] as string | undefined) ?? '').trim() ||
      ((row['agent_type'] as string | undefined) ?? '').trim() ||
      'unknown';
    return 'agent_' + name;
  }
  return null;
}

/**
 * 事件穩定 key：用穩定欄位組出可重現字串，供重掃去重。
 * 對應 Python event_key()。
 */
export function eventKey(sessionId: unknown, row: Record<string, unknown>): string {
  const parts = [
    String(sessionId ?? ''),
    String(row['source'] ?? ''),
    String(row['request_id'] ?? ''),
    String(row['tool_use_id'] ?? ''),
    String(row['started_at'] ?? ''),
    String(row['kind'] ?? ''),
    String(row['agent_name'] ?? ''),
  ];
  return parts.join('|');
}
