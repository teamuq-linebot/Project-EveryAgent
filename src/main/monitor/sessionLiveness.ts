/**
 * sessionLiveness.ts — Claude Code session 存活偵測
 *
 * 資料來源契約：
 *   Claude Code 在 ~/.claude/sessions/ 下為每個 PID 維護一個心跳 JSON 檔案，
 *   格式為 { pid, sessionId, status, updatedAt, ... }。
 *   本模組掃描這些檔案，依 updatedAt 時效判斷 session 是否仍在線。
 *
 * 設計原則：
 *   - 解析失敗 / 目錄不存在 → 回空集合，絕不 throw。
 *   - 2-5 秒記憶體 cache 防止高頻 fs 掃描（預設 3000 ms）。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { findProjectFolder } from '../worktime/claude/discover';

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

/** 預設：5 分鐘內有心跳更新視為 live。 */
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/** 記憶體 cache TTL（ms）：3 秒，防止高頻 fs 掃描。 */
const CACHE_TTL_MS = 3000;

/**
 * sessions 心跳檔的「新鮮度」門檻（ms）。
 * 進程死掉後殘留的舊 PID 檔（updatedAt 很舊）不該被當成現役狀態來源，
 * 因此 status 映射只採信 updatedAt 在此窗口內的檔（缺 updatedAt 仍採信，
 * 對應 session-monitor.html 不檢查時效的寬鬆行為）。
 */
const STATUS_FRESH_MS = 5 * 60 * 1000;

/**
 * JSONL fallback：距最後事件 ≤ 此值（ms）視為 running，否則 idle。
 * 對齊 SessionRunStateMachine.RUN_FRESH_SECONDS（90s）。
 *
 * 90s（而非舊 30s）：agent 工作流常有 >30s 不寫 JSONL 的空檔（thinking / 等 subagent
 * 寫檔 / buffer 未 flush / tool call 間隔），30s 太短會把這些空檔誤判成「完成」翻綠，
 * 再因新輸出翻回 running，造成綠↔藍振盪。拉到 90s 大幅降低誤判。
 */
const JSONL_FRESH_MS = 90 * 1000;

/** JSONL fallback：只讀檔尾這麼多 bytes（避免大 session 全檔解析）。 */
const JSONL_TAIL_BYTES = 256 * 1024;

/**
 * Claude Code session run-state（對齊 session-monitor.html statusLabel 分類）：
 *   running   = busy / running
 *   waiting   = waiting / paused（等待使用者決定，UI 橘色）
 *   completed = idle / ready / 無新鮮活動（對話已完成、CLI 待命，UI 綠色點）
 *   idle      = 監測剛啟動、尚無任何活動（中性，非「完成」）
 *   none      = 無從判斷（檔不存在且 JSONL 也讀不到）
 */
export type SessionRunState = 'none' | 'idle' | 'running' | 'waiting' | 'completed';

// ---------------------------------------------------------------------------
// Cache（模組層單例，避免高頻 fs 掃描）
// ---------------------------------------------------------------------------

interface SessionCache {
  ids: Set<string>;
  fetchedAt: number;
  maxAgeMs: number;
}

let _cache: SessionCache | null = null;

// ---------------------------------------------------------------------------
// 核心掃描邏輯
// ---------------------------------------------------------------------------

/**
 * 掃描 ~/.claude/sessions/*.json，回傳 updatedAt 在 maxAgeMs 內的 sessionId 集合。
 * cache TTL = CACHE_TTL_MS，避免高頻 fs 呼叫。
 * 解析失敗或目錄不存在 → 回空集合（防禦，絕不 throw）。
 */
export function getLiveSessionIds(maxAgeMs = DEFAULT_MAX_AGE_MS): Set<string> {
  const now = Date.now();

  // cache 命中（同 maxAgeMs 且未過期）
  if (
    _cache !== null &&
    _cache.maxAgeMs === maxAgeMs &&
    now - _cache.fetchedAt < CACHE_TTL_MS
  ) {
    return _cache.ids;
  }

  const ids = new Set<string>();

  try {
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');

    let entries: string[];
    try {
      entries = fs.readdirSync(sessionsDir);
    } catch {
      // 目錄不存在 → 靜默回空
      _cache = { ids, fetchedAt: now, maxAgeMs };
      return ids;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const fullPath = path.join(sessionsDir, entry);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const obj = JSON.parse(raw) as Record<string, unknown>;
        const sessionId = typeof obj['sessionId'] === 'string' ? obj['sessionId'] : null;
        const updatedAt = obj['updatedAt'];
        if (!sessionId) continue;

        // updatedAt 解析：接受 ISO string 或 epoch number
        let updatedMs: number | null = null;
        if (typeof updatedAt === 'number') {
          updatedMs = updatedAt;
        } else if (typeof updatedAt === 'string') {
          const ms = Date.parse(updatedAt);
          if (!isNaN(ms)) updatedMs = ms;
        }

        if (updatedMs === null) continue;
        if (now - updatedMs <= maxAgeMs) {
          ids.add(sessionId);
        }
      } catch {
        // 單一檔案解析失敗 → 略過，繼續掃描
      }
    }
  } catch {
    // 任何未預期錯誤 → 靜默回空，絕不 throw
  }

  _cache = { ids, fetchedAt: now, maxAgeMs };
  return ids;
}

/**
 * 判斷指定 sessionId 是否仍在線（委派 getLiveSessionIds，享用 cache）。
 */
export function isSessionLive(sessionId: string): boolean {
  return getLiveSessionIds().has(sessionId);
}

// ---------------------------------------------------------------------------
// run-state 偵測（sessions 心跳 status 為主 + JSONL fallback）
//
// 用戶定案策略（逐字）：
//   「依照 ~/.claude/sessions 為主，如果這邊的 status 不存在的話，
//     那就監測他的 ~/.claude/projects/<專案>/<uuid>.jsonl，看主對話和 subagent 對話。」
// 參考 session-monitor.html 的 statusLabel() 分類邏輯。
// ---------------------------------------------------------------------------

/** 取 epoch ms（接受 number 或 ISO string）；無法解析 → null。 */
function parseEpochMs(value: unknown): number | null {
  if (typeof value === 'number') return value > 0 ? value : null;
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return isNaN(ms) ? null : ms;
  }
  return null;
}

/**
 * 把 sessions 心跳檔的 status 欄映射成 run-state。
 * 對齊 session-monitor.html statusLabel()：
 *   busy / running    → running
 *   waiting / paused  → waiting
 *   idle / ready      → completed（CLI 待命＝上一輪對話已完成，UI 綠色點）
 *   其他 / 缺欄        → null（交給 caller 走 fallback）
 */
export function mapSessionStatus(status: unknown): SessionRunState | null {
  if (status == null || String(status) === '') return null;
  const s = String(status).toLowerCase();
  if (s === 'busy' || s === 'running') return 'running';
  if (s === 'waiting' || s === 'paused') return 'waiting';
  if (s === 'idle' || s === 'ready') return 'completed';
  return null;
}

/**
 * 掃 ~/.claude/sessions/*.json，找 sessionId 相符且 updatedAt 最新的檔，回傳其 status 映射。
 * 同 sessionId 多檔（殘留舊 PID）→ 取 updatedAt 最新者；該檔太舊（過 STATUS_FRESH_MS）→ 視為
 *   殘檔不採信，回 null（交給 fallback）。缺 status 欄或映射不出 → null。
 * 目錄/檔不存在、壞 JSON → 靜默回 null。
 */
export function getSessionStatusRunState(sessionId: string): SessionRunState | null {
  if (!sessionId) return null;
  const now = Date.now();
  try {
    const sessionsDir = path.join(os.homedir(), '.claude', 'sessions');
    let entries: string[];
    try {
      entries = fs.readdirSync(sessionsDir);
    } catch {
      return null; // 目錄不存在
    }

    let bestUpdatedMs = -1;
    let bestStatus: unknown = undefined;
    let bestHasUpdated = false;

    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, entry), 'utf8');
        const obj = JSON.parse(raw) as Record<string, unknown>;
        if (obj['sessionId'] !== sessionId) continue;
        const updatedMs = parseEpochMs(obj['updatedAt']);
        // 同 sessionId 多檔取 updatedAt 最新；無 updatedAt 視為較舊（-1），但仍可在無更新檔時採用。
        const cmp = updatedMs ?? -1;
        if (cmp > bestUpdatedMs) {
          bestUpdatedMs = cmp;
          bestStatus = obj['status'];
          bestHasUpdated = updatedMs !== null;
        }
      } catch {
        // 單檔壞 → 略過
      }
    }

    if (bestStatus === undefined && bestUpdatedMs < 0) return null; // 無相符檔

    // 殘檔守門：有 updatedAt 但已過新鮮窗 → 不採信（進程多半已死）。
    if (bestHasUpdated && now - bestUpdatedMs > STATUS_FRESH_MS) return null;

    return mapSessionStatus(bestStatus);
  } catch {
    return null; // 任何未預期錯誤 → 靜默 fallback
  }
}

/**
 * JSONL fallback：掃被監測 session 的主對話 + subagent JSONL 檔尾，推斷 run-state。
 *   - 尾端有「未回答的 AskUserQuestion」（assistant 發了 AskUserQuestion tool_use，
 *     後續沒有對應的 tool_result）→ waiting。
 *   - 否則最後事件 ≤ JSONL_FRESH_MS → running。
 *   - 否則 idle。
 *   - 全無可讀 JSONL → null（caller 再退回事件式判斷）。
 *
 * 只讀檔尾 JSONL_TAIL_BYTES，逐行 JSON.parse（容錯：壞行略過）。
 */
export function getJsonlFallbackRunState(
  projectPath: string,
  sessionIds: Set<string> | string[],
): SessionRunState | null {
  const ids = Array.isArray(sessionIds) ? sessionIds : Array.from(sessionIds);
  if (!projectPath || ids.length === 0) return null;

  let folderPath: string;
  try {
    const match = findProjectFolder(projectPath);
    if (match.match === 'not-found') return null;
    folderPath = match.folder_path;
  } catch {
    return null;
  }

  let sawAny = false;
  let waiting = false;
  let latestMs: number | null = null;

  for (const sid of ids) {
    // 主對話：<folder>/<sid>.jsonl；subagent：<folder>/<sid>/subagents/*.jsonl
    const mainFile = path.join(folderPath, `${sid}.jsonl`);
    const subagentsDir = path.join(folderPath, sid, 'subagents');
    const files: string[] = [mainFile];
    try {
      for (const e of fs.readdirSync(subagentsDir)) {
        if (e.endsWith('.jsonl')) files.push(path.join(subagentsDir, e));
      }
    } catch {
      // 無 subagents 目錄 → 只看主對話
    }

    for (const file of files) {
      const res = scanJsonlTail(file);
      if (res === null) continue;
      sawAny = true;
      if (res.unansweredAsk) waiting = true;
      if (res.latestMs !== null && (latestMs === null || res.latestMs > latestMs)) {
        latestMs = res.latestMs;
      }
    }
  }

  if (!sawAny) return null;
  if (waiting) return 'waiting';
  if (latestMs !== null && Date.now() - latestMs <= JSONL_FRESH_MS) return 'running';
  // 有過活動但已靜止逾 JSONL_FRESH_MS → 視為「對話已完成」（UI 綠色點）。
  return 'completed';
}

/**
 * 讀單一 JSONL 檔尾，回傳「是否有未回答 ask」與「最後事件時間」。
 * 檔不存在 / 讀不到 → null。
 */
function scanJsonlTail(file: string): { unansweredAsk: boolean; latestMs: number | null } | null {
  let text: string;
  let truncated = false;
  try {
    const stat = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      const start = Math.max(0, stat.size - JSONL_TAIL_BYTES);
      truncated = start > 0; // 從檔中間截斷 → 第一行多半半截
      const len = stat.size - start;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, start);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }

  const lines = text.split('\n');
  // 只有從檔中間截斷時才丟第一行（半截壞 JSON）；讀整檔時不可丟（會誤刪第一筆資料）。
  if (truncated && lines.length > 1) lines.shift();

  // 收集本窗口內：發出的 AskUserQuestion tool_use id、看到的 tool_result id、最後 timestamp。
  const askIds = new Set<string>();
  const answeredIds = new Set<string>();
  let latestMs: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue; // 壞行略過
    }

    const tsMs = parseEpochMs(rec['timestamp']);
    if (tsMs !== null && (latestMs === null || tsMs > latestMs)) latestMs = tsMs;

    const msg = rec['message'];
    const content =
      msg && typeof msg === 'object' ? (msg as Record<string, unknown>)['content'] : undefined;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as Record<string, unknown>;
      // assistant 發出 AskUserQuestion
      if (b['type'] === 'tool_use' && b['name'] === 'AskUserQuestion' && typeof b['id'] === 'string') {
        askIds.add(b['id']);
      }
      // user / tool 回傳 tool_result（回答了某個 tool_use）
      if (b['type'] === 'tool_result' && typeof b['tool_use_id'] === 'string') {
        answeredIds.add(b['tool_use_id']);
      }
    }
  }

  let unansweredAsk = false;
  for (const id of askIds) {
    if (!answeredIds.has(id)) {
      unansweredAsk = true;
      break;
    }
  }

  return { unansweredAsk, latestMs };
}
