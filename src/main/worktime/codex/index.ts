/**
 * Codex 來源聚合入口：getCodexProject（依 cwd 命中**單一當前** rollout → 解析成 session 工時）。
 *
 * 與 claude getProject（worktime/claude/index.ts）簽名平行，回 `{ project_path, sessions }`，
 * 供 punchCore（collectPunchEventsCore）以相同邏輯算打卡。codex 啟動不指定 session id，
 * 故定檔靠 cwd 比對；**只取最新啟動的那一個 rollout**（= 當前 session），與對話面板的
 * findCodexRollout 定檔邏輯一致——避免把同 cwd 的歷史 session 全聚合成大量舊打卡。
 *
 * 選檔下界 sinceMs（= tab openedAtMs / 水位）：排掉本 tab 開啟前就結束的舊 rollout
 * （startedAtMs < sinceMs 且 mtimeMs < sinceMs → 非當前 session）。回合層級再由 punchCore
 * 的 afterSince(sinceMs) 濾掉 < sinceMs 的回合（resume 舊 session 時只打卡新回合）。
 *
 * leaf 模組：只 import 本來源 discover/workTimeline + 共享 jsonl util，不 import claude 來源。
 * 容錯為先：任一檔壞 / 讀失敗 → 略過該 session，不丟例外。
 */

import { readJsonl, toEpochMs } from '../jsonl';
import { listCodexRolloutsForCwd } from './discover';
import type { CodexRolloutMeta } from './discover';
import { buildCodexWorkTimeline } from './workTimeline';

/** 與 claude SessionDict 子集對齊（punchCore 只讀這些欄位 + work_timeline）。 */
export interface CodexSessionDict {
  session_id: string;
  source: string;
  file: string;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  last_assistant_output: string;
  work_timeline: Record<string, unknown>[];
}

export interface CodexProjectResult {
  project_path: string;
  sessions: CodexSessionDict[];
}

/**
 * 從 cwd 命中的 rollout 中選「當前 session」：startedAtMs 最大者，且須在 sinceMs 後仍活躍
 * （startedAtMs≥sinceMs 或 mtimeMs≥sinceMs）。對齊 discover.findCodexRollout 的選檔語意。
 */
function pickCurrentRollout(
  metas: CodexRolloutMeta[],
  sinceMs: number,
): CodexRolloutMeta | null {
  let best: CodexRolloutMeta | null = null;
  for (const m of metas) {
    if (m.startedAtMs < sinceMs && m.mtimeMs < sinceMs) continue;
    if (best === null || m.startedAtMs > best.startedAtMs) best = m;
  }
  return best;
}

/** 取 rows 中最早的 started_at（依 epoch；皆無則 null）。 */
function earliestStart(rows: Record<string, unknown>[]): string | null {
  let best: string | null = null;
  let bestMs = Number.POSITIVE_INFINITY;
  for (const r of rows) {
    const s = r['started_at'];
    const ms = toEpochMs(s);
    if (ms === null) continue;
    if (ms < bestMs) {
      bestMs = ms;
      best = typeof s === 'string' ? s : null;
    }
  }
  return best;
}

/** 取 main-ai rows 中最晚的 ended_at（依 epoch;皆無則 null）。 */
function latestMainAiEnd(rows: Record<string, unknown>[]): string | null {
  let best: string | null = null;
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    if (r['kind'] !== 'main-ai') continue;
    const e = r['ended_at'];
    const ms = toEpochMs(e);
    if (ms === null) continue;
    if (ms > bestMs) {
      bestMs = ms;
      best = typeof e === 'string' ? e : null;
    }
  }
  return best;
}

/** 取最後一筆 main-ai 的 last_output（時間序最後；皆無則 ''）。 */
function lastAssistantOutput(rows: Record<string, unknown>[]): string {
  let best = '';
  let bestMs = Number.NEGATIVE_INFINITY;
  for (const r of rows) {
    if (r['kind'] !== 'main-ai') continue;
    const out = String(r['last_output'] ?? '').trim();
    if (!out) continue;
    const ms = toEpochMs(r['started_at']) ?? 0;
    if (ms >= bestMs) {
      bestMs = ms;
      best = out;
    }
  }
  return best;
}

/**
 * 回某專案（cwd）**當前 codex session**（單一 rollout）的工時解析結果。
 * @param projectPath  專案路徑（= rollout session_meta.cwd 比對目標）
 * @param sinceMs      選檔 / 回合下界（= tab openedAtMs / 水位）；省略 → 0（取最新 rollout）
 * @param baseDir      測試注入（預設 ~/.codex/sessions）
 */
export function getCodexProject(
  projectPath: string,
  sinceMs = 0,
  baseDir?: string,
): CodexProjectResult {
  const meta = pickCurrentRollout(listCodexRolloutsForCwd(projectPath, baseDir), sinceMs);
  if (!meta) return { project_path: projectPath, sessions: [] };

  let records: Record<string, unknown>[];
  try {
    records = readJsonl(meta.file).map((i) => i.record);
  } catch {
    return { project_path: projectPath, sessions: [] };
  }
  const workTimeline = buildCodexWorkTimeline(records);
  const startedAt = earliestStart(workTimeline);
  const endedAt = latestMainAiEnd(workTimeline);
  const durationMs =
    startedAt !== null && endedAt !== null
      ? (toEpochMs(endedAt) ?? 0) - (toEpochMs(startedAt) ?? 0)
      : null;

  return {
    project_path: projectPath,
    sessions: [
      {
        session_id: meta.id,
        source: meta.file,
        file: meta.file,
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: durationMs !== null && durationMs >= 0 ? durationMs : null,
        last_assistant_output: lastAssistantOutput(workTimeline),
        work_timeline: workTimeline,
      },
    ],
  };
}
