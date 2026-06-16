/**
 * Codex rollout 檔探索：依 cwd + 啟動時戳定位 ~/.codex/sessions 下的 rollout-*.jsonl。
 *
 * 動機：codex 啟動指令是裸 `codex`，啟動時不指定 session id，故檔名（rollout uuid）事前
 * 未知 → 定檔點每次呼叫都要 re-discover（依 cwd 比對 + openedAtMs 下界）。
 *
 * 純 Node fs（os / path / fs）。leaf 模組：不 import claude 來源（codex/claude 互不耦合）；
 * cwd 正規化在本檔自帶（plan D-NORM）。禁用 inline shell 迴圈，純 Node 遍歷。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as nodePath from 'path';

/** ~/.codex/sessions（codex 固定用 ~/.codex；測試以 baseDir 注入）。 */
export const CODEX_SESSIONS_ROOT: string = nodePath.join(os.homedir(), '.codex', 'sessions');

export interface CodexRolloutMeta {
  /** 絕對路徑 */
  file: string;
  /** rollout uuid（session_meta.payload.id） */
  id: string;
  /** session_meta.payload.cwd（codex 工作目錄） */
  cwd: string;
  /** session_meta.payload.timestamp（內層 ISO）→ epoch ms；缺則用檔 mtimeMs */
  startedAtMs: number;
  /** 檔 mtime（epoch ms） */
  mtimeMs: number;
}

/** 起始檔頭視窗 64KB（session_meta 因 base_instructions 可能很長）。 */
const HEAD_WINDOW = 64 * 1024;
/** 檔頭視窗擴讀上限（避免異常檔吃爆記憶體）。 */
const MAX_HEAD_WINDOW = 4 * 1024 * 1024;

/**
 * cwd 比對正規化：斜線統一成 \、去尾斜線、轉小寫。
 * 對齊 claude/paths.normalizeForCompare 的中性語意，但本檔自帶以保持 codex leaf 獨立。
 * 涵蓋斜線方向、尾斜線、大小寫、`C:` vs `c:`（小寫化）。
 */
function normalizeForCompare(value: string): string {
  let v = value.replace(/[\\/]+/g, '\\');
  v = v.replace(/\\+$/, '');
  return v.toLowerCase();
}

/** 安全 listdir（容錯回 []）。 */
function safeReaddir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

/** 安全 stat mtimeMs（容錯回 null）。 */
function safeMtimeMs(filePath: string): number | null {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile()) return null;
    return st.mtimeMs;
  } catch {
    return null;
  }
}

/**
 * 讀檔第一行（讀到第一個 `\n`）。起始視窗 64KB；若視窗內無換行則迴圈擴讀，
 * 直到讀到換行、讀到 EOF（回全部已讀）、或超過上限為止。讀失敗回 null。
 */
function readFirstLine(filePath: string): string | null {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return null;
  }
  try {
    let windowSize = HEAD_WINDOW;
    while (true) {
      const buf = Buffer.alloc(windowSize);
      let bytesRead = 0;
      try {
        bytesRead = fs.readSync(fd, buf, 0, windowSize, 0);
      } catch {
        return null;
      }
      const text = buf.subarray(0, bytesRead).toString('utf-8');
      const nl = text.indexOf('\n');
      if (nl >= 0) return text.slice(0, nl);
      // 視窗已讀到 EOF（讀回少於請求量）→ 第一行就是全部內容（無結尾換行）。
      if (bytesRead < windowSize) return text;
      // 視窗滿且無換行 → 擴讀。
      if (windowSize >= MAX_HEAD_WINDOW) return text;
      windowSize = Math.min(windowSize * 2, MAX_HEAD_WINDOW);
    }
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // ignore close errors
    }
  }
}

/** ISO 字串 → epoch ms；非字串 / 無法解析回 null。 */
function isoToEpochMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * 讀一個 rollout 檔的第一行 session_meta，組 CodexRolloutMeta。
 * 第一行非 session_meta / 壞 JSON / 讀失敗 → null（呼叫端略過）。
 */
function readRolloutMeta(filePath: string): CodexRolloutMeta | null {
  const mtimeMs = safeMtimeMs(filePath);
  if (mtimeMs === null) return null;
  const firstLine = readFirstLine(filePath);
  if (!firstLine || !firstLine.trim()) return null;
  let rec: Record<string, unknown>;
  try {
    const parsed = JSON.parse(firstLine.trim()) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    rec = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (rec['type'] !== 'session_meta') return null;
  const payload = rec['payload'];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const id = typeof p['id'] === 'string' ? (p['id'] as string) : '';
  const cwd = typeof p['cwd'] === 'string' ? (p['cwd'] as string) : '';
  const startedAtMs = isoToEpochMs(p['timestamp']) ?? mtimeMs;
  return { file: filePath, id, cwd, startedAtMs, mtimeMs };
}

/**
 * 遍歷 <base>/<YYYY>/<MM>/<DD>/rollout-*.jsonl，回所有 meta（讀每檔第一行 session_meta）。
 * 依 mtime 新→舊排序。壞檔 / 第一行非 session_meta / 讀失敗 → 略過（不丟例外）。
 * @param baseDir 測試注入（預設 CODEX_SESSIONS_ROOT）
 */
export function listCodexRollouts(baseDir?: string): CodexRolloutMeta[] {
  const root = baseDir ?? CODEX_SESSIONS_ROOT;
  const out: CodexRolloutMeta[] = [];
  for (const year of safeReaddir(root)) {
    const yearDir = nodePath.join(root, year);
    for (const month of safeReaddir(yearDir)) {
      const monthDir = nodePath.join(yearDir, month);
      for (const day of safeReaddir(monthDir)) {
        const dayDir = nodePath.join(monthDir, day);
        for (const name of safeReaddir(dayDir)) {
          if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue;
          const meta = readRolloutMeta(nodePath.join(dayDir, name));
          if (meta) out.push(meta);
        }
      }
    }
  }
  out.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return out;
}

/**
 * 列出 cwd 正規化相等於 projectPath 的所有 rollout meta（依 mtime 新→舊）。
 * 供 codex getProject 聚合用（同 cwd 可能有多個 session）；cwd 比對複用本檔 normalizeForCompare。
 * projectPath 空 → []。
 */
export function listCodexRolloutsForCwd(
  projectPath: string,
  baseDir?: string,
): CodexRolloutMeta[] {
  if (!projectPath) return [];
  const target = normalizeForCompare(projectPath);
  return listCodexRollouts(baseDir).filter(
    (m) => m.cwd && normalizeForCompare(m.cwd) === target,
  );
}

/**
 * 為某 session 定檔：cwd 正規化相等且（startedAtMs≥sinceMs 或 mtimeMs≥sinceMs）的最新 rollout。
 * - cwd 比對用本檔 normalizeForCompare（斜線 / 尾斜線 / 大小寫天然處理）。
 * - sinceMs = SessionEntry.openedAtMs（排掉本 tab 開啟前的舊 rollout）。
 * - 多檔命中（同 cwd 多 session）→ 取 startedAtMs 最大者（最新啟動）。
 * @returns 命中檔絕對路徑；無 → null
 */
export function findCodexRollout(
  projectPath: string,
  sinceMs: number,
  baseDir?: string,
): string | null {
  return findCodexRolloutInWindow(projectPath, sinceMs, null, undefined, baseDir)
}

/**
 * 為並行 Codex sessions 定檔：與 findCodexRollout 相同，但可提供 beforeMs 上界與排除清單。
 * 同 cwd 同時開多條 agentConv 時，較早那條若尚未定檔，不能在較晚那條啟動後又抓到
 * 「最新」rollout；用 openedAtMs 的相鄰窗口把每條 session 限在自己的啟動區間。
 */
export function findCodexRolloutInWindow(
  projectPath: string,
  sinceMs: number,
  beforeMs: number | null = null,
  excludeFiles?: Set<string>,
  baseDir?: string,
): string | null {
  if (!projectPath) return null;
  const target = normalizeForCompare(projectPath);
  let best: CodexRolloutMeta | null = null;
  for (const meta of listCodexRollouts(baseDir)) {
    if (excludeFiles?.has(meta.file)) continue;
    if (!meta.cwd || normalizeForCompare(meta.cwd) !== target) continue;
    if (meta.startedAtMs < sinceMs && meta.mtimeMs < sinceMs) continue;
    if (beforeMs !== null && (meta.startedAtMs >= beforeMs || meta.mtimeMs >= beforeMs)) continue;
    if (best === null || meta.startedAtMs > best.startedAtMs) best = meta;
  }
  return best ? best.file : null;
}
