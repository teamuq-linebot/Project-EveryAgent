/**
 * Codex 打卡規則：work_timeline row → 打卡名稱 / 事件穩定 key。
 * 與 claude/punchRules.ts 平行，但獨立檔（codex/claude 互不 import 的 leaf 規則）。
 *
 * codex 無 subagent：work_timeline 只有 main-user / main-ai，故 punchName 只需處理 main-ai。
 * （punchCore 對 main 回合直接用 MAIN_PUNCH_NAME；本函式僅在核心需注入時提供，主要被 subagent
 *   分支呼叫——codex 無 subagent row，實質不觸發，但仍給合法實作保持核心契約完整。）
 */

/**
 * work_timeline row → 打卡名稱。
 * - main-ai / main-dispatch → "agent_manager"
 * - 其他（main-user）→ null（不打卡）
 */
export function punchNameForRow(row: Record<string, unknown>): string | null {
  const kind = row['kind'];
  if (kind === 'main-ai' || kind === 'main-dispatch') {
    return 'agent_manager';
  }
  return null;
}

/** 事件穩定 key：用穩定欄位組出可重現字串，供重掃去重。 */
export function eventKey(sessionId: unknown, row: Record<string, unknown>): string {
  const parts = [
    String(sessionId ?? ''),
    String(row['source'] ?? ''),
    String(row['request_id'] ?? ''),
    String(row['started_at'] ?? ''),
    String(row['kind'] ?? ''),
    String(row['round'] ?? ''),
  ];
  return parts.join('|');
}
