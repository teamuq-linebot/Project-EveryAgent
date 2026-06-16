/**
 * ClaudeWorktimeSource — IWorktimeSource 的真實實作（Claude JSONL 掃檔層）。
 * 供 MonitorController 注入使用。
 *
 * 對應 Python worktime.aggregate.collect_punch_events。
 *
 * 效能：完整解析在大 session 下要數秒，故掃描跑在 worker_thread（scanWorker.ts，
 * 對應 Qt 的背景 QThread 設計），main process 只收結果；worker 建立失敗或中途
 * 掛掉則退回同步路徑（行為不變，只是會卡）。
 */

import { Worker } from 'worker_threads';
import * as path from 'path';
import * as fs from 'fs';
import { collectPunchEvents } from './aggregate';
import { collectCodexPunchEvents } from './codex/aggregate';
import type { IWorktimeSource, PunchEvents } from '../monitor/types';

function emptyEvents(): PunchEvents {
  return {
    subagent_events: [],
    main: { duration_hours: 0, started_at: null, ended_at: null, event_count: 0 },
    main_events: [],
  };
}

interface ScanResponse {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export class ClaudeWorktimeSource implements IWorktimeSource {
  private _worker: Worker | null = null;
  private _workerBroken = false;
  private _nextId = 1;
  private readonly _pending = new Map<number, (r: PunchEvents) => void>();

  /** 取（或建）掃描 worker；建立失敗 → null（退回同步路徑）。 */
  private _ensureWorker(): Worker | null {
    if (this._workerBroken) return null;
    if (this._worker) return this._worker;
    try {
      // electron-vite 把 scanWorker.ts 打包成與本檔同目錄的 scanWorker.js（見 electron.vite.config）
      const workerPath = path.join(__dirname, 'scanWorker.js');
      if (!fs.existsSync(workerPath)) {
        // 無 bundle（vitest 直接跑 source）→ 走同步路徑
        this._workerBroken = true;
        return null;
      }
      const w = new Worker(workerPath);
      w.on('message', (msg: ScanResponse) => {
        const resolve = this._pending.get(msg.id);
        if (!resolve) return;
        this._pending.delete(msg.id);
        resolve(msg.ok && msg.result ? (msg.result as PunchEvents) : emptyEvents());
      });
      w.on('error', () => {
        // worker 掛了：在途請求回空結構，之後退回同步路徑
        this._workerBroken = true;
        for (const resolve of this._pending.values()) resolve(emptyEvents());
        this._pending.clear();
        this._worker = null;
      });
      w.unref();
      this._worker = w;
      return w;
    } catch {
      this._workerBroken = true;
      return null;
    }
  }

  /**
   * 收集打卡事件（worker_thread 非同步；worker 不可用時退回同步）。
   *
   * @param projectPath  project 路徑
   * @param sinceMs      基準時間戳（epoch ms）
   * @param sessionIds   被監測的 session id 集合
   */
  async collectPunchEvents(
    projectPath: string,
    sinceMs: number,
    sessionIds: Set<string>,
    tool = 'claude',
  ): Promise<PunchEvents> {
    const worker = this._ensureWorker();
    if (worker) {
      return new Promise<PunchEvents>((resolve) => {
        const id = this._nextId++;
        this._pending.set(id, resolve);
        try {
          worker.postMessage({ id, projectPath, sinceMs, sessionIds: [...sessionIds], tool });
        } catch {
          this._pending.delete(id);
          resolve(this._collectSync(projectPath, sinceMs, sessionIds, tool));
        }
      });
    }
    return this._collectSync(projectPath, sinceMs, sessionIds, tool);
  }

  private _collectSync(
    projectPath: string,
    sinceMs: number,
    sessionIds: Set<string>,
    tool: string,
  ): PunchEvents {
    try {
      const events =
        tool === 'codex'
          ? collectCodexPunchEvents(projectPath, sinceMs, sessionIds)
          : collectPunchEvents(projectPath, sinceMs, sessionIds);
      return events as unknown as PunchEvents;
    } catch {
      return emptyEvents();
    }
  }
}
