/**
 * 跨 session 的打卡聚合 helper（打卡監測迴圈用）。
 * 忠實移植自 Python teamuq/worktime/aggregate.py。
 *
 * collectPunchEvents(projectPath, sinceMs, sessionIds)
 *   = 包 collectPunchEventsCore + getProject + punchNameForRow + eventKey。
 *
 * 全程容錯：缺資料 / 解析失敗回空結構，絕不丟例外。
 */

import { getProject } from './claude/index';
import { punchNameForRow, eventKey } from './claude/punchRules';
import { collectPunchEventsCore } from './punchCore';
import type { PunchEventsResult } from './punchCore';

export type { PunchEventsResult };

/** 空結構（全程容錯 fallback）。 */
const EMPTY: PunchEventsResult = {
  subagent_events: [],
  main: {
    duration_hours: 0.0,
    started_at: null,
    ended_at: null,
    event_count: 0,
    description: '',
    output_json_title: null,
    output_json_description: null,
  },
  main_events: [],
};

/**
 * 掃 project 所有 session 的 work_timeline，整理成可即時打卡的結構。
 *
 * @param projectPath  project 路徑
 * @param sinceMs      僅取 started_at >= sinceMs 的事件（null 不過濾）
 * @param sessionIds   僅取集合內的 session（null 不過濾；空集合 → 回空結構）
 *
 * 對應 Python collect_punch_events()。
 */
export function collectPunchEvents(
  projectPath: string,
  sinceMs: number | null = null,
  sessionIds: Set<string> | string[] | null = null,
): PunchEventsResult {
  try {
    return collectPunchEventsCore(
      (path: unknown) => getProject(path as string),
      punchNameForRow,
      eventKey,
      projectPath,
      sinceMs,
      sessionIds,
    );
  } catch {
    return EMPTY;
  }
}
