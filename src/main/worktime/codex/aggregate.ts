/**
 * Codex 打卡聚合：getCodexProject + codex punchRules 餵入 source-agnostic 的 collectPunchEventsCore。
 * 與 worktime/aggregate.ts（claude）平行；MonitorController 依 tool 選此來源。
 *
 * sessionIds 語意：codex 啟動不指定 session id（檔名 uuid 事前未知），故監測端傳**空集**，
 * 本層把「空集 / null」一律視為「不依 id 過濾」——定檔已由 getCodexProject 的 cwd 比對完成，
 * 回合範圍再由 sinceMs（= tab openedAtMs / 水位）濾掉開啟前的舊回合。
 *
 * 全程容錯：缺資料 / 解析失敗回空結構，絕不丟例外。
 */

import { getCodexProject } from './index';
import { punchNameForRow, eventKey } from './punchRules';
import { collectPunchEventsCore } from '../punchCore';
import type { PunchEventsResult } from '../punchCore';

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

/** 空集 / null → null（不過濾）；否則原樣傳給核心。 */
function normalizeIds(
  sessionIds: Set<string> | string[] | null | undefined,
): Set<string> | string[] | null {
  if (sessionIds == null) return null;
  const size = Array.isArray(sessionIds) ? sessionIds.length : sessionIds.size;
  return size > 0 ? sessionIds : null;
}

/**
 * 掃 codex project（cwd）所有 rollout 的 work_timeline，整理成可即時打卡的結構。
 * @param projectPath  專案路徑（= rollout cwd 比對目標）
 * @param sinceMs      僅取 started_at >= sinceMs 的回合（null 不過濾）
 * @param sessionIds   空集 / null → 不過濾（codex 定檔靠 cwd）
 * @param baseDir      測試注入（預設 ~/.codex/sessions）
 */
export function collectCodexPunchEvents(
  projectPath: string,
  sinceMs: number | null = null,
  sessionIds: Set<string> | string[] | null = null,
  baseDir?: string,
): PunchEventsResult {
  try {
    return collectPunchEventsCore(
      // sinceMs 同時用於：選當前 rollout（排掉歷史 session）＋ 回合層級 afterSince 過濾。
      (path: unknown) => getCodexProject(path as string, sinceMs ?? 0, baseDir),
      punchNameForRow,
      eventKey,
      projectPath,
      sinceMs,
      normalizeIds(sessionIds),
    );
  } catch {
    return EMPTY;
  }
}
