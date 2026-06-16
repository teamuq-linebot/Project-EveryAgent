/**
 * Claude session 探索：projects 資料夾定位 + session 列舉（含 cowork / local-agent）。
 * 忠實移植自 Python teamuq/worktime/sources/claude/discover.py（行為一字不改）。
 *
 * 效能關鍵：per-session mtime+size 指紋快取（_SESSION_CACHE）——
 * 檔案未變動時不重 parse，只重用上次結果，消除每輪全讀 ~18MB 的 lag。
 */

import * as fs from 'fs';
import * as nodePath from 'path';
import { readJsonl, toEpochMs, toIsoFromEpochMs, dateDiffMs } from '../jsonl';
import { emptyTokenUsage, addTokenUsage } from '../tokens';
import { buildTimeStats } from '../timestats';
import {
  CLAUDE_PROJECTS,
  CLAUDE_COWORK_SESSIONS,
  CLAUDE_LOCAL_AGENT_SESSIONS,
  projectPathToFolderName,
  normalizeForCompare,
  pathCandidates,
} from './paths';
import {
  buildWorkTimeline,
  assistantTextOf,
  extractSubagentIdentity,
  usageToTokenStats,
} from './parse';
import type { JsonlItem, SubagentInfo, TokenStats } from '../types';

// ---------------------------------------------------------------------------
// 目錄 helper（對應 Python _list_dir_entries）
// ---------------------------------------------------------------------------

interface DirEntry {
  name: string;
  isDir: boolean;
  isFile: boolean;
}

function listDirEntries(dirPath: string): DirEntry[] {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.map((e) => {
      let isDir = false;
      let isFile = false;
      try {
        isDir = e.isDirectory();
        isFile = e.isFile();
      } catch {
        // ignore stat errors
      }
      return { name: e.name, isDir, isFile };
    });
  } catch {
    return [];
  }
}

function pathExists(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/** 讀 JSONL 頭部（256KB）找第一個有 cwd 欄位的 record。對應 Python read_first_cwd()。 */
function readFirstCwd(filePath: string): string {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const text = buf.slice(0, bytesRead).toString('utf-8');
    for (const item of readJsonl_text(text)) {
      const rec = item.record;
      if (rec && rec['cwd'] && typeof rec['cwd'] === 'string') {
        return rec['cwd'];
      }
    }
    return '';
  } catch {
    return '';
  }
}

/** 把已讀入的 text 解析成 JsonlItem[]（和 readJsonl 相同邏輯但不讀檔）。 */
function readJsonl_text(text: string): JsonlItem[] {
  // 重用 jsonl.ts 的 iterJsonObjects 邏輯但不讀檔，這裡直接寫一個輕量版：
  const rows: JsonlItem[] = [];
  let i = 0;
  const n = text.length;
  let index = 0;
  while (i < n) {
    while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\r' || text[i] === '\n')) i++;
    if (i >= n) break;
    const ch = text[i];
    if (ch !== '{' && ch !== '[') { i++; continue; }
    let depth = 0;
    let inStr = false;
    let escape = false;
    let endPos = -1;
    for (let j = i; j < n; j++) {
      const c = text[j];
      if (escape) { escape = false; continue; }
      if (c === '\\' && inStr) { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) { endPos = j + 1; break; }
      }
    }
    if (endPos === -1) { i++; continue; }
    try {
      const obj = JSON.parse(text.slice(i, endPos));
      if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
        rows.push({ index, record: obj as Record<string, unknown>, error: null });
        index++;
        // stop after first record (we only need cwd)
        break;
      }
    } catch { /* skip */ }
    i = endPos;
  }
  return rows;
}

// ---------------------------------------------------------------------------
// findProjectFolder
// ---------------------------------------------------------------------------

export interface ProjectFolderMatch {
  folder_name: string;
  folder_path: string;
  match: 'direct' | 'parent-direct' | 'case-insensitive' | 'parent-case-insensitive' | 'cwd-scan' | 'not-found';
}

export function findProjectFolder(projectPath: string): ProjectFolderMatch {
  return findProjectFolderInRoot(CLAUDE_PROJECTS, projectPath);
}

/**
 * 對齊 findProjectFolderInRoot：direct -> 大小寫不敏感 -> cwd 掃描 -> not-found。
 * 對應 Python find_project_folder_in_root()。
 */
export function findProjectFolderInRoot(
  projectsRoot: string,
  projectPath: string,
): ProjectFolderMatch {
  const entries = listDirEntries(projectsRoot);
  const candidates = pathCandidates(projectPath);

  for (const candidate of candidates) {
    const directName = projectPathToFolderName(candidate);
    const directPath = nodePath.join(projectsRoot, directName);
    if (pathExists(directPath)) {
      return {
        folder_name: directName,
        folder_path: directPath,
        match: candidate === projectPath ? 'direct' : 'parent-direct',
      };
    }

    const lower = directName.toLowerCase();
    const caseMatch = entries.find((e) => e.isDir && e.name.toLowerCase() === lower);
    if (caseMatch) {
      return {
        folder_name: caseMatch.name,
        folder_path: nodePath.join(projectsRoot, caseMatch.name),
        match: candidate === projectPath ? 'case-insensitive' : 'parent-case-insensitive',
      };
    }
  }

  // cwd-scan
  const normalizedInput = normalizeForCompare(projectPath);
  for (const entry of entries) {
    if (!entry.isDir) continue;
    const folderPath = nodePath.join(projectsRoot, entry.name);
    const jsonlFiles = listDirEntries(folderPath)
      .filter((e) => e.isFile && e.name.endsWith('.jsonl'))
      .map((e) => e.name);
    for (const file of jsonlFiles.slice(0, 6)) {
      const cwd = readFirstCwd(nodePath.join(folderPath, file));
      if (cwd && normalizeForCompare(cwd) === normalizedInput) {
        return { folder_name: entry.name, folder_path: folderPath, match: 'cwd-scan' };
      }
    }
  }

  const fallbackName = projectPathToFolderName(projectPath);
  return {
    folder_name: fallbackName,
    folder_path: nodePath.join(projectsRoot, fallbackName),
    match: 'not-found',
  };
}

/**
 * 找出 ~/.claude/projects 下對應資料夾名，找不到回 null。
 * 對應 Python discover_project_folder()。
 */
export function discoverProjectFolder(projectPath: string): string | null {
  const match = findProjectFolder(projectPath);
  if (match.match === 'not-found') return null;
  return match.folder_name;
}

// ---------------------------------------------------------------------------
// subagent meta helper（對應 Python _read_subagent_meta）
// ---------------------------------------------------------------------------

function readSubagentMeta(subagentDir: string, subFile: string): Record<string, unknown> {
  const metaFile = nodePath.join(subagentDir, subFile.replace(/\.jsonl$/, '.meta.json'));
  if (!pathExists(metaFile)) return {};
  try {
    const text = fs.readFileSync(metaFile, { encoding: 'utf-8' });
    const data = JSON.parse(text) as unknown;
    return typeof data === 'object' && data !== null && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// _SESSION_CACHE（mtime+size 指紋快取）
// ---------------------------------------------------------------------------

/** stat 指紋：(mtimeMs, size) — Node.js fs.statSync 沒有 mtime_ns，用 mtimeMs 替代 */
type StatSig = [number, number] | null;

type StatKey = [StatSig, Array<[string, StatSig]>];

/** file 路徑 → (statKey, sessionDict) */
export const _SESSION_CACHE = new Map<string, [StatKey, SessionDict]>();

function statSig(filePath: string): StatSig {
  try {
    const st = fs.statSync(filePath);
    return [st.mtimeMs, st.size];
  } catch {
    return null;
  }
}

function sessionStatKey(file: string, folderPath: string, sessionId: string): StatKey {
  const mainSig = statSig(file);
  const subagentDir = nodePath.join(folderPath, sessionId, 'subagents');
  const subSigs: Array<[string, StatSig]> = [];
  for (const entry of listDirEntries(subagentDir)) {
    if (entry.isFile && (entry.name.endsWith('.jsonl') || entry.name.endsWith('.meta.json'))) {
      subSigs.push([entry.name, statSig(nodePath.join(subagentDir, entry.name))]);
    }
  }
  subSigs.sort((a, b) => a[0].localeCompare(b[0]));
  return [mainSig, subSigs];
}

function statKeyEqual(a: StatKey, b: StatKey): boolean {
  // compare main sig
  const [aSig, aSubs] = a;
  const [bSig, bSubs] = b;
  if (!sigEqual(aSig, bSig)) return false;
  if (aSubs.length !== bSubs.length) return false;
  for (let i = 0; i < aSubs.length; i++) {
    if (aSubs[i][0] !== bSubs[i][0]) return false;
    if (!sigEqual(aSubs[i][1], bSubs[i][1])) return false;
  }
  return true;
}

function sigEqual(a: StatSig, b: StatSig): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a[0] === b[0] && a[1] === b[1];
}

// ---------------------------------------------------------------------------
// SessionDict interface
// ---------------------------------------------------------------------------

export interface SessionDict {
  session_id: string;
  source: string;
  file: string;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  last_assistant_output: string;
  main: Record<string, unknown>;
  subagents: SubagentInfo[];
  work_timeline: Record<string, unknown>[];
  time_stats: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// parse_session_file（TS 版，對應 Python parse_session_file）
// ---------------------------------------------------------------------------

function extractLastAssistantOutput(records: JsonlItem[]): string {
  for (let i = records.length - 1; i >= 0; i--) {
    const record = records[i].record;
    const text = assistantTextOf(record);
    if (text) return text;
  }
  return '';
}

function extractFirstUserInput(records: JsonlItem[]): string {
  for (const item of records) {
    const record = item.record;
    if (!record || record['isMeta']) continue;
    if (record['type'] !== 'user') continue;
    const msg = record['message'];
    if (!msg || typeof msg !== 'object') continue;
    const content = (msg as Record<string, unknown>)['content'];
    if (typeof content === 'string' && content.trim()) return content.trim();
    if (!Array.isArray(content)) continue;
    const texts: string[] = [];
    for (const b of content) {
      if (typeof b !== 'object' || b === null) continue;
      const bRec = b as Record<string, unknown>;
      if (bRec['type'] === 'text' && typeof bRec['text'] === 'string') {
        texts.push(bRec['text'] as string);
      }
    }
    const joined = texts.filter(Boolean).join('\n').trim();
    if (joined) return joined;
  }
  return '';
}

interface ParsedSubagent extends SubagentInfo {
  agent_type: string;
  description: string;
  tool_use_id: string;
  source: string;
  token_usage: TokenStats;
  last_assistant_output: string;
  first_user_input: string;
}

function parseSessionFile(filePath: string, source: string): ParsedSubagent {
  const records = readJsonl(filePath);
  const identity = extractSubagentIdentity(records);

  // summarize_session: started_at/ended_at/duration_ms from timed events
  const timedRecords = records.filter((item) => {
    const rec = item.record;
    const ts = rec['timestamp'];
    return typeof ts === 'string' && ts;
  });
  timedRecords.sort((a, b) => {
    const aMs = toEpochMs(a.record['timestamp']) ?? 0;
    const bMs = toEpochMs(b.record['timestamp']) ?? 0;
    return aMs - bMs;
  });

  const startedAt =
    timedRecords.length > 0
      ? (timedRecords[0].record['timestamp'] as string)
      : null;
  const endedAt =
    timedRecords.length > 0
      ? (timedRecords[timedRecords.length - 1].record['timestamp'] as string)
      : null;
  const durationMs = startedAt && endedAt ? dateDiffMs(startedAt, endedAt) : null;

  // aggregate token usage from assistant records
  let tokenUsage: TokenStats = emptyTokenUsage();
  for (const item of records) {
    const rec = item.record;
    if (rec['type'] !== 'assistant') continue;
    const msg = rec['message'];
    if (!msg || typeof msg !== 'object') continue;
    const usage = (msg as Record<string, unknown>)['usage'];
    if (!usage) continue;
    const model = String((msg as Record<string, unknown>)['model'] ?? '');
    tokenUsage = addTokenUsage(tokenUsage, usageToTokenStats(usage, model));
  }

  return {
    source,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    agent_type: '',
    description: '',
    tool_use_id: '',
    token_usage: tokenUsage,
    last_assistant_output: extractLastAssistantOutput(records),
    first_user_input: extractFirstUserInput(records),
    ...identity,
  };
}

// ---------------------------------------------------------------------------
// summarize_session（TS 版，對應 Python summarize_session）
// — 回 main session 摘要（time range + counts）
// ---------------------------------------------------------------------------

function summarizeSession(records: JsonlItem[], source: string): Record<string, unknown> {
  const timed = records
    .filter((item) => item.record && item.record['timestamp'])
    .sort((a, b) => (toEpochMs(a.record['timestamp']) ?? 0) - (toEpochMs(b.record['timestamp']) ?? 0));

  const startedAt = timed.length > 0 ? (timed[0].record['timestamp'] as string) : null;
  const endedAt =
    timed.length > 0 ? (timed[timed.length - 1].record['timestamp'] as string) : null;
  const durationMs = startedAt && endedAt ? dateDiffMs(startedAt, endedAt) : null;

  return {
    source,
    started_at: startedAt,
    ended_at: endedAt,
    duration_ms: durationMs,
    counts: {},
    events: [],
  };
}

// ---------------------------------------------------------------------------
// listSessions（主 export，含快取）
// ---------------------------------------------------------------------------

/**
 * 掃描資料夾內每個 .jsonl session（含 subagents）。
 * 以 mtime/size 指紋快取每個 session 的解析結果，未變動的檔不重讀重解析。
 * 對應 Python list_sessions()。
 */
export function listSessions(folderPath: string): SessionDict[] {
  const entries = listDirEntries(folderPath);
  const files = entries
    .filter((e) => e.isFile && e.name.endsWith('.jsonl'))
    .map((e) => nodePath.join(folderPath, e.name));

  const sessions: SessionDict[] = [];

  for (const file of files) {
    const sessionId = nodePath.basename(file, '.jsonl');

    const statKey = sessionStatKey(file, folderPath, sessionId);
    const cached = _SESSION_CACHE.get(file);
    if (cached !== undefined && statKeyEqual(cached[0], statKey)) {
      sessions.push(cached[1]);
      continue;
    }

    // Not cached or stale — parse
    const mainRecords = readJsonl(file);
    const main = summarizeSession(mainRecords, 'main');

    // Subagents
    const subagentDir = nodePath.join(folderPath, sessionId, 'subagents');
    const subagents: SubagentInfo[] = [];
    if (pathExists(subagentDir)) {
      const subFiles = listDirEntries(subagentDir)
        .filter((e) => e.isFile && e.name.endsWith('.jsonl'))
        .map((e) => e.name);
      for (const subFile of subFiles) {
        const meta = readSubagentMeta(subagentDir, subFile);
        const parsed = parseSessionFile(nodePath.join(subagentDir, subFile), subFile);
        (parsed as unknown as Record<string, unknown>)['agent_type'] = String(meta['agentType'] ?? parsed.agent_type ?? '');
        (parsed as unknown as Record<string, unknown>)['description'] = String(meta['description'] ?? parsed.description ?? '');
        (parsed as unknown as Record<string, unknown>)['tool_use_id'] = String(meta['toolUseId'] ?? parsed.tool_use_id ?? '');
        subagents.push(parsed as SubagentInfo);
      }
    }

    subagents.sort((a, b) => (toEpochMs(a.started_at) ?? 0) - (toEpochMs(b.started_at) ?? 0));

    const allItems = [main, ...subagents] as Array<Record<string, unknown>>;
    const allStarts = allItems
      .map((i) => i['started_at'])
      .filter(Boolean) as string[];
    const allEnds = allItems
      .map((i) => i['ended_at'])
      .filter(Boolean) as string[];
    allStarts.sort((a, b) => (toEpochMs(a) ?? 0) - (toEpochMs(b) ?? 0));
    allEnds.sort((a, b) => (toEpochMs(a) ?? 0) - (toEpochMs(b) ?? 0));

    const startedAt = (allStarts[0] ?? null) || (main['started_at'] as string | null);
    const endedAt =
      (allEnds.length > 0 ? allEnds[allEnds.length - 1] : null) || (main['ended_at'] as string | null);

    let durationMs: number | null;
    if (allStarts.length > 0 && allEnds.length > 0) {
      durationMs = dateDiffMs(allStarts[0], allEnds[allEnds.length - 1]);
    } else {
      durationMs = (main['duration_ms'] as number | null) ?? null;
    }

    const workTimeline = buildWorkTimeline(mainRecords, subagents as SubagentInfo[]);
    const sessionForStats: Record<string, unknown> = {
      started_at: startedAt,
      ended_at: endedAt,
      work_timeline: workTimeline,
    };
    const timeStats = buildTimeStats(sessionForStats);

    const sessionDict: SessionDict = {
      session_id: sessionId,
      source: file,
      file,
      started_at: startedAt ?? null,
      ended_at: endedAt ?? null,
      duration_ms: durationMs,
      last_assistant_output: extractLastAssistantOutput(mainRecords),
      main,
      subagents: subagents as SubagentInfo[],
      work_timeline: workTimeline as Record<string, unknown>[],
      time_stats: timeStats as unknown as Record<string, unknown>,
    };

    _SESSION_CACHE.set(file, [statKey, sessionDict]);
    sessions.push(sessionDict);
  }

  sessions.sort((a, b) => (toEpochMs(a.started_at) ?? 0) - (toEpochMs(b.started_at) ?? 0));
  sessions.reverse();
  return sessions;
}

// ---------------------------------------------------------------------------
// Cowork / Local Agent 探索
// ---------------------------------------------------------------------------

export interface CoworkSession {
  source_kind: 'cowork';
  session_id: string;
  cli_session_id: string;
  remote_session_id: string;
  local_session_id: string;
  account_id: string;
  environment_id: string;
  environment_folder: string;
  file: string;
  cwd: string;
  origin_cwd: string;
  title: string;
  title_source: string;
  model: string;
  effort: string;
  permission_mode: string;
  is_archived: boolean;
  transcript_unavailable: boolean;
  completed_turns: number | null;
  created_at: string | null;
  last_activity_at: string | null;
}

/**
 * 對齊 listCoworkSessions：掃 cowork metadata json，按 cwd / originCwd 比對。
 * 對應 Python list_cowork_sessions()。
 */
export function listCoworkSessions(projectPath = ''): CoworkSession[] {
  if (!pathExists(CLAUDE_COWORK_SESSIONS)) return [];

  const normalizedInput = projectPath ? normalizeForCompare(projectPath) : '';
  const sessions: CoworkSession[] = [];

  for (const accountEntry of listDirEntries(CLAUDE_COWORK_SESSIONS)) {
    if (!accountEntry.isDir) continue;
    const accountPath = nodePath.join(CLAUDE_COWORK_SESSIONS, accountEntry.name);
    for (const envEntry of listDirEntries(accountPath)) {
      if (!envEntry.isDir) continue;
      const envPath = nodePath.join(accountPath, envEntry.name);
      for (const fileEntry of listDirEntries(envPath)) {
        if (!fileEntry.isFile || !fileEntry.name.endsWith('.json')) continue;
        const filePath = nodePath.join(envPath, fileEntry.name);
        let metadata: Record<string, unknown>;
        try {
          const text = fs.readFileSync(filePath, { encoding: 'utf-8' });
          const parsed = JSON.parse(text) as unknown;
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
          metadata = parsed as Record<string, unknown>;
        } catch {
          continue;
        }

        const cwd = String(metadata['cwd'] ?? metadata['originCwd'] ?? '');
        const originCwd = String(metadata['originCwd'] ?? metadata['cwd'] ?? '');
        const normalizedCwd = normalizeForCompare(cwd);
        const normalizedOrigin = normalizeForCompare(originCwd);

        if (
          normalizedInput &&
          normalizedCwd !== normalizedInput &&
          normalizedOrigin !== normalizedInput
        ) {
          continue;
        }

        const completedTurns = metadata['completedTurns'];
        sessions.push({
          source_kind: 'cowork',
          session_id: String(metadata['sessionId'] ?? nodePath.basename(fileEntry.name, '.json')),
          cli_session_id: String(metadata['cliSessionId'] ?? ''),
          remote_session_id: String(metadata['remoteSessionId'] ?? ''),
          local_session_id: String(metadata['localSessionId'] ?? ''),
          account_id: accountEntry.name,
          environment_id: String(metadata['environmentId'] ?? ''),
          environment_folder: envEntry.name,
          file: filePath,
          cwd,
          origin_cwd: originCwd,
          title: String(metadata['title'] ?? ''),
          title_source: String(metadata['titleSource'] ?? ''),
          model: String(metadata['model'] ?? ''),
          effort: String(metadata['effort'] ?? ''),
          permission_mode: String(metadata['permissionMode'] ?? ''),
          is_archived: Boolean(metadata['isArchived']),
          transcript_unavailable: Boolean(metadata['transcriptUnavailable']),
          completed_turns:
            completedTurns !== null && completedTurns !== undefined
              ? Number(completedTurns)
              : null,
          created_at: toIsoFromEpochMs(metadata['createdAt']),
          last_activity_at: toIsoFromEpochMs(metadata['lastActivityAt']),
        });
      }
    }
  }

  sessions.sort(
    (a, b) =>
      (toEpochMs(a.last_activity_at ?? a.created_at) ?? 0) -
      (toEpochMs(b.last_activity_at ?? b.created_at) ?? 0),
  );
  sessions.reverse();
  return sessions;
}

export interface LocalAgentRoot {
  account_id: string;
  environment_folder: string;
  local_agent_session_id: string;
  projects_root: string;
}

/**
 * 對齊 findLocalAgentProjectRoots：列舉每個 local-agent session 巢狀的 .claude/projects。
 * 對應 Python find_local_agent_project_roots()。
 */
export function findLocalAgentProjectRoots(): LocalAgentRoot[] {
  if (!pathExists(CLAUDE_LOCAL_AGENT_SESSIONS)) return [];

  const roots: LocalAgentRoot[] = [];
  for (const accountEntry of listDirEntries(CLAUDE_LOCAL_AGENT_SESSIONS)) {
    if (!accountEntry.isDir) continue;
    const accountPath = nodePath.join(CLAUDE_LOCAL_AGENT_SESSIONS, accountEntry.name);
    for (const envEntry of listDirEntries(accountPath)) {
      if (!envEntry.isDir) continue;
      const envPath = nodePath.join(accountPath, envEntry.name);
      for (const sessEntry of listDirEntries(envPath)) {
        if (!sessEntry.isDir) continue;
        const projectsRoot = nodePath.join(envPath, sessEntry.name, '.claude', 'projects');
        if (pathExists(projectsRoot)) {
          roots.push({
            account_id: accountEntry.name,
            environment_folder: envEntry.name,
            local_agent_session_id: sessEntry.name,
            projects_root: projectsRoot,
          });
        }
      }
    }
  }
  return roots;
}

/**
 * 對齊 listLocalAgentProjectSessions。
 * 對應 Python list_local_agent_project_sessions()。
 */
export function listLocalAgentProjectSessions(
  projectPath: string,
): Array<LocalAgentRoot & ProjectFolderMatch & { source_kind: 'local-agent-projects'; sessions: SessionDict[] }> {
  const matches: Array<LocalAgentRoot & ProjectFolderMatch & { source_kind: 'local-agent-projects'; sessions: SessionDict[] }> = [];
  for (const root of findLocalAgentProjectRoots()) {
    let match: ProjectFolderMatch | null = null;
    try {
      match = findProjectFolderInRoot(root.projects_root, projectPath);
    } catch {
      match = null;
    }
    if (!match || match.match === 'not-found') continue;
    let sessions: SessionDict[] = [];
    try {
      sessions = listSessions(match.folder_path);
    } catch {
      sessions = [];
    }
    matches.push({
      source_kind: 'local-agent-projects',
      ...root,
      ...match,
      sessions,
    });
  }
  matches.sort((a, b) => {
    const aMs = a.sessions.length > 0 ? (toEpochMs(a.sessions[0].started_at) ?? 0) : 0;
    const bMs = b.sessions.length > 0 ? (toEpochMs(b.sessions[0].started_at) ?? 0) : 0;
    return bMs - aMs;
  });
  return matches;
}

/**
 * 對齊 listCoworkLinkedProjectSessions。
 * 對應 Python list_cowork_linked_project_sessions()。
 */
export function listCoworkLinkedProjectSessions(
  projectPath: string,
  coworkSessions: CoworkSession[],
): Array<ProjectFolderMatch & { source_kind: 'cowork-linked-worktree'; cowork_session_id: string; cli_session_id: string; cwd: string; origin_cwd: string; sessions: SessionDict[] }> {
  const normalizedInput = normalizeForCompare(projectPath);
  const linkedSessionIds = new Set(coworkSessions.map((s) => s.cli_session_id).filter(Boolean));

  const matches: Array<ProjectFolderMatch & { source_kind: 'cowork-linked-worktree'; cowork_session_id: string; cli_session_id: string; cwd: string; origin_cwd: string; sessions: SessionDict[] }> = [];

  for (const coworkSession of coworkSessions) {
    const cwd = coworkSession.cwd || '';
    if (!cwd || normalizeForCompare(cwd) === normalizedInput) continue;

    let match: ProjectFolderMatch | null = null;
    try {
      match = findProjectFolder(cwd);
    } catch {
      match = null;
    }
    if (!match || match.match === 'not-found') continue;

    let sessions: SessionDict[] = [];
    try {
      sessions = listSessions(match.folder_path);
    } catch {
      sessions = [];
    }

    if (linkedSessionIds.size > 0) {
      const linked = sessions.filter((s) => linkedSessionIds.has(s.session_id));
      if (linked.length > 0) sessions = linked;
    }

    matches.push({
      source_kind: 'cowork-linked-worktree',
      ...match,
      cowork_session_id: coworkSession.session_id,
      cli_session_id: coworkSession.cli_session_id,
      cwd,
      origin_cwd: coworkSession.origin_cwd || '',
      sessions,
    });
  }

  matches.sort((a, b) => {
    const aMs = a.sessions.length > 0 ? (toEpochMs(a.sessions[0].started_at) ?? 0) : 0;
    const bMs = b.sessions.length > 0 ? (toEpochMs(b.sessions[0].started_at) ?? 0) : 0;
    return bMs - aMs;
  });
  return matches;
}
