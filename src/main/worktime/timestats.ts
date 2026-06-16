/**
 * 工時統計工具：collapseMainAiRows + unionDurationMs。
 * 忠實移植自 Python teamuq/worktime/timestats.py。
 */

import { toEpochMs, dateDiffMs } from './jsonl';
import { addTokenUsage, emptyTokenUsage } from './tokens';
import type { WorkRow, TokenStats } from './types';

/**
 * 合併重疊區間，回傳總覆蓋毫秒數。
 * 對應 Python union_duration_ms()：排序 [start,end] 區間、合併重疊、回總覆蓋 ms。
 * rows 只需有 started_at / ended_at 欄位（Record<string, unknown> 即可）。
 */
export function unionDurationMs(rows: ReadonlyArray<Record<string, unknown>>): number {
  const intervals: [number, number][] = [];
  for (const row of rows) {
    const start = toEpochMs(row['started_at']);
    const end = toEpochMs(row['ended_at']);
    if (start === null || end === null) continue;
    if (!isFinite(start) || !isFinite(end)) continue;
    if (end > start) {
      intervals.push([start, end]);
    }
  }
  intervals.sort((a, b) => a[0] - b[0]);
  if (intervals.length === 0) return 0;

  const merged: [number, number][] = [];
  for (const [start, end] of intervals) {
    if (merged.length === 0 || start > merged[merged.length - 1][1]) {
      merged.push([start, end]);
    } else if (end > merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = end;
    }
  }
  return merged.reduce((sum, [s, e]) => sum + (e - s), 0);
}

/**
 * 將同一 request_id 連續的 main-ai / main-dispatch 合併。
 * 對應 Python collapse_main_ai_rows()。
 */
// ---------------------------------------------------------------------------
// buildTimeStats（對應 Python build_time_stats）
// ---------------------------------------------------------------------------

function _isFiniteNum(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

export interface TimeStats {
  elapsed_ms: number | null;
  effective_work_ms: number;
  summed_work_ms: number;
  overlap_ms: number;
  main_ai_ms: number;
  main_dispatch_ms: number;
  subagent_ms: number;
  ask_wait_ms: number;
  token_usage: TokenStats;
  idle_or_other_ms: number | null;
  main_user_count: number;
  main_ai_count: number;
  main_dispatch_count: number;
  subagent_count: number;
  ask_count: number;
}

/**
 * 計算 session 工時統計。
 * session 需含 work_timeline（list）、started_at、ended_at。
 * 對應 Python build_time_stats()。
 */
export function buildTimeStats(session: Record<string, unknown>): TimeStats {
  const timeline = (Array.isArray(session['work_timeline']) ? session['work_timeline'] : []) as Array<Record<string, unknown>>;

  function sumKind(kind: string): number {
    return timeline
      .filter((r) => r['kind'] === kind && _isFiniteNum(r['duration_ms']))
      .reduce((acc, r) => acc + (r['duration_ms'] as number), 0);
  }

  const subagentMs = sumKind('subagent');
  const askWaitMs = sumKind('ask');
  const mainAiMs = sumKind('main-ai');
  const mainDispatchMs = sumKind('main-dispatch');

  const startedAt = session['started_at'];
  const endedAt = session['ended_at'];
  const elapsedMs =
    startedAt && endedAt ? dateDiffMs(startedAt as string, endedAt as string) : null;

  const summedWorkMs = mainAiMs + mainDispatchMs + subagentMs;
  const effectiveWorkMs = unionDurationMs(
    timeline.filter(
      (r) =>
        (r['kind'] === 'main-ai' || r['kind'] === 'main-dispatch' || r['kind'] === 'subagent') &&
        _isFiniteNum(r['duration_ms']),
    ),
  );

  let tokenUsage = emptyTokenUsage();
  for (const row of timeline) {
    if (row['kind'] !== 'main-user') {
      tokenUsage = addTokenUsage(tokenUsage, row['token_usage'] as TokenStats | null);
    }
  }

  const elapsedFinite = _isFiniteNum(elapsedMs);
  return {
    elapsed_ms: elapsedMs,
    effective_work_ms: effectiveWorkMs,
    summed_work_ms: summedWorkMs,
    overlap_ms: Math.max(0, summedWorkMs - effectiveWorkMs),
    main_ai_ms: mainAiMs,
    main_dispatch_ms: mainDispatchMs,
    subagent_ms: subagentMs,
    ask_wait_ms: askWaitMs,
    token_usage: tokenUsage,
    idle_or_other_ms: elapsedFinite
      ? Math.max(0, (elapsedMs as number) - effectiveWorkMs - askWaitMs)
      : null,
    main_user_count: timeline.filter((r) => r['kind'] === 'main-user').length,
    main_ai_count: timeline.filter((r) => r['kind'] === 'main-ai').length,
    main_dispatch_count: timeline.filter((r) => r['kind'] === 'main-dispatch').length,
    subagent_count: timeline.filter((r) => r['kind'] === 'subagent').length,
    ask_count: timeline.filter((r) => r['kind'] === 'ask').length,
  };
}

// ---------------------------------------------------------------------------

export function collapseMainAiRows(rows: WorkRow[]): WorkRow[] {
  function sortKey(row: WorkRow): number {
    const key = toEpochMs((row as Record<string, unknown>)['called_at'] ?? row.started_at);
    return key !== null ? key : 0;
  }

  const sorted = rows
    .filter((r) => r.started_at != null)
    .slice()
    .sort((a, b) => sortKey(a) - sortKey(b));

  const collapsed: WorkRow[] = [];

  for (const row of sorted) {
    const previous = collapsed.length > 0 ? collapsed[collapsed.length - 1] : null;
    const rowReqId = (row as Record<string, unknown>)['request_id'] as string | undefined;
    const prevReqId = previous
      ? ((previous as Record<string, unknown>)['request_id'] as string | undefined)
      : undefined;

    if (
      (row.kind === 'main-ai' || row.kind === 'main-dispatch') &&
      previous !== null &&
      (previous.kind === 'main-ai' || previous.kind === 'main-dispatch') &&
      previous.kind === row.kind &&
      rowReqId &&
      rowReqId === prevReqId
    ) {
      previous.ended_at = row.ended_at ?? row.started_at;
      previous.duration_ms = dateDiffMs(previous.started_at, previous.ended_at);
      if (row.detail) {
        previous.detail = row.detail;
      }
      // token_usage 合併：total 不同時才加
      const prevTu = previous.token_usage;
      const rowTu = row.token_usage;
      if ((prevTu?.total ?? 0) !== (rowTu?.total ?? 0)) {
        previous.token_usage = addTokenUsage(prevTu, rowTu);
      }
      continue;
    }

    collapsed.push(row);
  }

  return collapsed;
}
