/**
 * scanWorker.ts — 監測掃描 worker_thread 入口。
 *
 * collectPunchEvents（完整 JSONL 解析）在大 session（數十 MB + subagents）下要數秒；
 * 放 Electron main process 同步跑會卡死整個 app。對應 Qt 版的背景 QThread 設計：
 * 解析在此 worker 執行，main process 只收純資料結果。
 */

import { parentPort } from 'worker_threads';
import { collectPunchEvents } from './aggregate';
import { collectCodexPunchEvents } from './codex/aggregate';

interface ScanRequest {
  id: number;
  projectPath: string;
  sinceMs: number;
  sessionIds: string[];
  /** 'claude' | 'codex'；省略 → 'claude'。決定掃哪個來源。 */
  tool?: string;
}

parentPort?.on('message', (msg: ScanRequest) => {
  const { id, projectPath, sinceMs, sessionIds, tool } = msg;
  try {
    const ids = new Set(sessionIds);
    const result =
      tool === 'codex'
        ? collectCodexPunchEvents(projectPath, sinceMs, ids)
        : collectPunchEvents(projectPath, sinceMs, ids);
    parentPort?.postMessage({ id, ok: true, result });
  } catch (e) {
    parentPort?.postMessage({ id, ok: false, error: String(e) });
  }
});
