/**
 * lightList.ts — 輕量 session 列表 / 摘要（不做完整 work_timeline 解析）。
 *
 * 動機：getProject() 會完整解析專案內所有 session JSONL（大 session 數十 MB +
 * subagents），在 Electron main process 同步跑會整個卡死。多數使用場景
 * （定位檔案、解析「最新 session」、綁定下拉標籤）只需要檔名/時間/前幾行摘要。
 *
 * 對應 Python tools/sessions.py 的輕量 list_sessions / _claude_summary 精神：
 *   - listSessionFilesLight：只 readdir + stat（零內容解析）。
 *   - readSessionSummaryLight：只讀檔頭 64KB，掃前 ~80 筆 record 取
 *     started_at / 第一句 user 訊息 / aiTitle / custom-title。
 */

import * as fs from 'fs';
import * as nodePath from 'path';
import * as os from 'os';
import { findProjectFolder } from './discover';
import { consumeJsonObjects, readJsonl } from '../jsonl';

const SKIP_MATCHES = new Set(['not-found', 'parent-direct', 'parent-case-insensitive']);

export interface LightSession {
  session_id: string;
  file: string;
  mtimeMs: number;
}

/** 輕量列出專案 session 檔（id=檔名 stem、絕對路徑、mtime）。新→舊。零內容解析。 */
export function listSessionFilesLight(projectPath: string): LightSession[] {
  try {
    if (!projectPath) return [];
    const match = findProjectFolder(projectPath);
    if (SKIP_MATCHES.has(match.match)) return [];
    const folder = match.folder_path;
    if (!folder || !fs.existsSync(folder)) return [];
    const out: LightSession[] = [];
    for (const name of fs.readdirSync(folder)) {
      if (!name.endsWith('.jsonl')) continue;
      const file = nodePath.join(folder, name);
      let mtimeMs = 0;
      try {
        const st = fs.statSync(file);
        if (!st.isFile()) continue;
        mtimeMs = st.mtimeMs;
      } catch {
        continue;
      }
      out.push({ session_id: name.slice(0, -'.jsonl'.length), file, mtimeMs });
    }
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return out;
  } catch {
    return [];
  }
}

export interface LightSummary {
  startedAt: string | null;
  summary: string;
  title: string;
  customTitle: string;
}

const EMPTY_SUMMARY: LightSummary = { startedAt: null, summary: '', title: '', customTitle: '' };

function _extractUserText(content: unknown): string {
  if (typeof content === 'string') return content.replace(/\s+/g, ' ').trim();
  if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === 'object' && (b as Record<string, unknown>)['type'] === 'text') {
        const t = (b as Record<string, unknown>)['text'];
        if (typeof t === 'string') {
          const s = t.replace(/\s+/g, ' ').trim();
          if (s) return s;
        }
      }
    }
  }
  return '';
}

/** 檔頭摘要視窗（started_at / 第一句 / aiTitle 都在前面）。 */
const HEAD_WINDOW = 64 * 1024;
/** 檔尾視窗：custom-title（改名）是 append 到檔尾，檔頭掃描看不到。 */
const TAIL_WINDOW = 256 * 1024;

/**
 * 從檔尾視窗找最後一筆 custom-title。
 * 改名（本 app 的 writeSessionCustomTitle 與 claude 自身的 /rename）都是往 JSONL
 * 檔尾 append 記錄；只掃檔頭永遠看不到 → 改名「沒生效」。失敗回 ''。
 */
function readTailCustomTitle(file: string): string {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch {
    return '';
  }
  if (size <= HEAD_WINDOW) return ''; // 檔頭視窗已涵蓋全檔
  const start = Math.max(HEAD_WINDOW, size - TAIL_WINDOW);
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const len = size - start;
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, start);
      text = buf.subarray(0, n).toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
  // 視窗起點多半落在行中央 → 跳過殘行對齊到下一筆 record。
  const nl = text.indexOf('\n');
  if (nl < 0) return '';
  text = text.slice(nl + 1);

  const { objects } = consumeJsonObjects(text);
  let ct = '';
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    const rec = o as Record<string, unknown>;
    if (rec['type'] === 'custom-title') {
      const v = rec['customTitle'];
      if (typeof v === 'string' && v.trim()) ct = v.trim(); // 取最後一筆
    }
  }
  return ct;
}

/**
 * 輕量摘要：讀檔頭 64KB（started_at / 第一句 / aiTitle）+ 檔尾視窗（custom-title）。
 * 對應 Python _claude_summary（started_at / summary / aiTitle / custom-title）。
 */
export function readSessionSummaryLight(file: string): LightSummary {
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(HEAD_WINDOW);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      text = buf.subarray(0, n).toString('utf-8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { ...EMPTY_SUMMARY };
  }

  const { objects } = consumeJsonObjects(text);
  let startedAt: string | null = null;
  let summary = '';
  let title = '';
  let customTitle = '';
  let count = 0;
  for (const o of objects) {
    if (count++ > 80) break;
    if (!o || typeof o !== 'object') continue;
    const rec = o as Record<string, unknown>;
    const msg = rec['message'];
    const ts =
      (rec['timestamp'] as string | undefined) ??
      (msg && typeof msg === 'object'
        ? ((msg as Record<string, unknown>)['timestamp'] as string | undefined)
        : undefined);
    if (typeof ts === 'string' && ts && (startedAt === null || ts < startedAt)) startedAt = ts;
    if (rec['type'] === 'custom-title') {
      const ct = rec['customTitle'];
      if (typeof ct === 'string' && ct.trim()) customTitle = ct.trim(); // 取最後一筆（持續覆寫）
    }
    if (!title && (rec['type'] === 'ai-title' || 'aiTitle' in rec)) {
      const ai = rec['aiTitle'];
      if (typeof ai === 'string' && ai.trim()) title = ai.trim();
    }
    if (!summary && rec['type'] === 'user' && !rec['isMeta']) {
      const content =
        (msg && typeof msg === 'object'
          ? (msg as Record<string, unknown>)['content']
          : undefined) ?? rec['content'];
      const t = _extractUserText(content);
      if (t) summary = t.slice(0, 200);
    }
    if (summary && title && customTitle) break;
  }
  // 檔尾的 custom-title（改名 append 在檔尾）優先於檔頭掃到的舊值。
  const tailCt = readTailCustomTitle(file);
  if (tailCt) customTitle = tailCt;
  return { startedAt, summary, title, customTitle };
}

/**
 * 全域反查含有指定 session JSONL 的專案路徑。
 *
 * slug 反解有資訊損失（大小寫、特殊字元都被摺疊），因此命中後讀 JSONL 內 cwd 欄位
 * 而非嘗試解 slug，以取得精確的原始路徑。
 *
 * @param sessionId  目標 session uuid（不含 .jsonl 副檔名）
 * @param baseDir    ~/.claude/projects 可注入（測試用）；預設 os.homedir()/.claude/projects
 * @returns          JSONL 內第一筆有效 cwd；找不到或發生錯誤回 null
 */
export function findSessionHome(sessionId: string, baseDir?: string): string | null {
  const root = baseDir ?? nodePath.join(os.homedir(), '.claude', 'projects');
  try {
    let dirs: string[];
    try {
      dirs = fs.readdirSync(root);
    } catch {
      return null;
    }
    for (const dirName of dirs) {
      const candidate = nodePath.join(root, dirName, sessionId + '.jsonl');
      try {
        if (!fs.existsSync(candidate)) continue;
      } catch {
        continue;
      }
      // 命中 — 讀檔頭最多 50 行找第一筆有效 cwd
      try {
        const fd = fs.openSync(candidate, 'r');
        let text = '';
        try {
          const buf = Buffer.alloc(16 * 1024);
          const n = fs.readSync(fd, buf, 0, buf.length, 0);
          text = buf.subarray(0, n).toString('utf-8');
        } finally {
          fs.closeSync(fd);
        }
        const lines = text.split('\n');
        let parsed = 0;
        for (const line of lines) {
          if (parsed >= 50) break;
          const trimmed = line.trim();
          if (!trimmed) continue;
          parsed++;
          let rec: Record<string, unknown>;
          try {
            rec = JSON.parse(trimmed) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (rec && typeof rec === 'object') {
            const cwd = rec['cwd'];
            if (typeof cwd === 'string' && cwd.trim()) {
              const c = cwd.trim();
              // 記錄的 cwd 可能指向已刪除的資料夾（如暫存夾）。回傳一個不存在的路徑對
              // resume 無用：claude 會在 fallback cwd 找不到此 session 而炸「No conversation
              // found」。故只回「仍存在的目錄」；不存在視同未命中 → caller 改走 new_id 開新對話。
              try {
                if (fs.statSync(c).isDirectory()) return c;
              } catch {
                // 路徑已不存在 → 不回傳此 cwd（繼續掃，最終回 null）
              }
            }
          }
        }
      } catch {
        // 讀檔失敗跳下一個目錄
      }
    }
  } catch {
    // 任何外層失敗回 null
  }
  return null;
}

/** 人看標籤：custom_title > aiTitle > 第一句；過長截斷（對應 session_display_label）。 */
export function sessionDisplayLabel(s: LightSummary, maxLen = 40): string {
  const label = (s.customTitle || s.title || s.summary || '').trim() || '(無摘要)';
  return label.length > maxLen ? label.slice(0, maxLen).trimEnd() + '…' : label;
}

/** resolveSubagentTranscript 的回傳結構。 */
export interface SubagentTranscriptInfo {
  /** subagent JSONL 絕對路徑（agent-<agentId>.jsonl） */
  file: string;
  /** agentId（meta 檔名 stem 去掉 "agent-" 前綴後的部分） */
  agentId: string;
  /** meta.json 的 agentType（無則 null） */
  agentType: string | null;
  /** meta.json 的 description（無則 null） */
  description: string | null;
}

/** 一個 subagents/ 目錄下掃到的 meta（含其對應 .jsonl 路徑與排序鍵）。 */
interface SubagentMetaEntry {
  /** "agent-<agentId>" */
  stem: string;
  /** agentId（stem 去掉 "agent-" 前綴） */
  agentId: string;
  /** 對應 .jsonl 絕對路徑 */
  jsonlFile: string;
  /** 對應 .jsonl 是否存在（孤兒 meta = false） */
  jsonlExists: boolean;
  /** meta.json 的 toolUseId（舊版 Claude Code 缺此欄 → null） */
  toolUseId: string | null;
  /** meta.json 的 agentType（無則 null） */
  agentType: string | null;
  /** meta.json 的 description（無則 null） */
  description: string | null;
  /** 檔案建立時間（無法取得 → Infinity，排序時沉底） */
  mtimeMs: number;
}

/** 父對話某筆 Agent tool_use 的精簡資訊（依出現順序保存）。 */
interface ParentAgentToolUse {
  id: string;
  description: string | null;
  subagentType: string | null;
}

function _toEntryInfo(e: SubagentMetaEntry): SubagentTranscriptInfo {
  return {
    file: e.jsonlFile,
    agentId: e.agentId,
    agentType: e.agentType,
    description: e.description,
  };
}

/**
 * 掃描 subagents/ 目錄，把每個 agent-*.meta.json 解析成 SubagentMetaEntry。
 * 任何單檔壞掉跳過；目錄讀不到回 []。
 */
function _scanSubagentMetas(subagentsDir: string): SubagentMetaEntry[] {
  let names: string[];
  try {
    names = fs.readdirSync(subagentsDir);
  } catch {
    return [];
  }
  const out: SubagentMetaEntry[] = [];
  for (const name of names) {
    if (!name.startsWith('agent-') || !name.endsWith('.meta.json')) continue;
    const metaFile = nodePath.join(subagentsDir, name);
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(fs.readFileSync(metaFile, 'utf-8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const stem = name.slice(0, -'.meta.json'.length); // "agent-<agentId>"
    const jsonlFile = nodePath.join(subagentsDir, stem + '.jsonl');
    let jsonlExists = false;
    let mtimeMs = Infinity;
    try {
      const st = fs.statSync(jsonlFile);
      jsonlExists = st.isFile();
      // 用 .jsonl 的建立時間排序（birthtime 不可靠時退回 mtime）。
      mtimeMs = isFinite(st.birthtimeMs) && st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs;
    } catch {
      jsonlExists = false;
    }
    out.push({
      stem,
      agentId: stem.slice('agent-'.length),
      jsonlFile,
      jsonlExists,
      toolUseId: typeof meta['toolUseId'] === 'string' ? (meta['toolUseId'] as string) : null,
      agentType: typeof meta['agentType'] === 'string' ? (meta['agentType'] as string) : null,
      description: typeof meta['description'] === 'string' ? (meta['description'] as string) : null,
      mtimeMs,
    });
  }
  return out;
}

/**
 * 從父對話 JSONL 依出現順序取出所有 Agent（子代理派遣）tool_use。
 * 父檔位置：<folder>/<convId>.jsonl；讀不到回 []。
 * 只認 name === 'Agent' / 'Task' 的 tool_use block（攜帶 description / subagent_type）。
 */
function _readParentAgentToolUses(folder: string, convId: string): ParentAgentToolUse[] {
  const parentFile = nodePath.join(folder, convId + '.jsonl');
  const rows = readJsonl(parentFile);
  const out: ParentAgentToolUse[] = [];
  for (const row of rows) {
    const rec = row.record;
    const msg = rec['message'];
    if (!msg || typeof msg !== 'object') continue;
    const content = (msg as Record<string, unknown>)['content'];
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      const block = b as Record<string, unknown>;
      if (block['type'] !== 'tool_use') continue;
      const name = block['name'];
      if (name !== 'Agent' && name !== 'Task') continue;
      const id = block['id'];
      if (typeof id !== 'string' || !id) continue;
      const input = (block['input'] as Record<string, unknown> | undefined) ?? {};
      out.push({
        id,
        description: typeof input['description'] === 'string' ? (input['description'] as string) : null,
        subagentType:
          typeof input['subagent_type'] === 'string' ? (input['subagent_type'] as string) : null,
      });
    }
  }
  return out;
}

/**
 * 舊版 Claude Code（≤2.1.142）meta.json 缺 toolUseId 時的備援配對。
 *
 * 前提：呼叫端已確認 metas 全數缺 toolUseId（精確比對 100% miss）。
 *   (a) description / agentType 對比：用父對話該 toolUseId 的 Agent tool_use 的
 *       description / subagent_type，去 metas 找唯一相符者。
 *   (b) positional：父檔第 N 個 Agent tool_use ↔ subagents 目錄第 N 個 meta
 *       （依 .jsonl 建立時間排序）。
 * 任一步驟唯一命中且 .jsonl 存在即回傳；否則 null。
 */
function _resolveSubagentFallback(
  folder: string,
  convId: string,
  toolUseId: string,
  metas: SubagentMetaEntry[],
): SubagentTranscriptInfo | null {
  const parentAgents = _readParentAgentToolUses(folder, convId);
  if (parentAgents.length === 0) return null;

  const targetIdx = parentAgents.findIndex((a) => a.id === toolUseId);
  if (targetIdx < 0) return null; // 此 toolUseId 不是父檔的 Agent 派遣 → 無從配對
  const target = parentAgents[targetIdx];

  const usable = metas.filter((m) => m.jsonlExists);
  if (usable.length === 0) return null;

  // (a) description（+ agentType）唯一相符。
  if (target.description) {
    const byDesc = usable.filter((m) => {
      if (m.description !== target.description) return false;
      // agentType 若雙方都有則一併要求相符，提高唯一性；任一缺則只看 description。
      if (m.agentType && target.subagentType) return m.agentType === target.subagentType;
      return true;
    });
    if (byDesc.length === 1) return _toEntryInfo(byDesc[0]);
  }

  // (b) positional：僅在「絕對無歧義」時採用——父檔只有 1 個 Agent 派遣
  //     且只有 1 個可用 meta，此時 targetIdx 必為 0、唯一候選即正解。
  //
  //     為何不用 sorted[targetIdx] 對多候選硬配：targetIdx 是「父檔發派順序」的
  //     索引，sorted 是「.jsonl birthtime/mtime 排序」的索引；兩者只有在
  //     「子對話建立順序 == 父檔發派順序」時才一致。同一 assistant turn 並行派
  //     多個 Agent/Task（AgentTeams 建隊常見）時 birthtime 是 race，
  //     sorted[targetIdx] 會指到錯誤子代理 → 使用者點子對話卡 A 卻看到子代理 B
  //     的 transcript（靜默誤配）。故 >1 候選一律放棄，寧缺勿錯。
  if (parentAgents.length === 1 && usable.length === 1) {
    // tie-break 在此其實多餘（單一候選），但保留排序習慣與穩定語意一致。
    const sorted = [...usable].sort(
      (a, b) => a.mtimeMs - b.mtimeMs || a.agentId.localeCompare(b.agentId),
    );
    return _toEntryInfo(sorted[0]);
  }

  return null;
}

/**
 * 依 toolUseId 定位對應的 subagent transcript 檔。
 *
 * 路徑規則（researcher 已驗證）：
 *   <projectFolder>/<convId>/subagents/agent-<agentId>.meta.json
 *   <projectFolder>/<convId>/subagents/agent-<agentId>.jsonl
 *   meta.json 內 toolUseId 欄即主檔 assistant message 裡 tool_use block 的 id。
 *
 * 流程：
 *   1. findProjectFolder(projectPath) 取得專案資料夾。
 *   2. 掃 <folder>/<convId>/subagents/ 目錄下所有 agent-*.meta.json。
 *   3. 新版（meta 有 toolUseId）：精確比對 toolUseId，命中且 .jsonl 存在 → 回傳。
 *   4. 舊版（≤2.1.142，meta 全缺 toolUseId）：精確比對必 miss，改走備援配對
 *      （_resolveSubagentFallback：description/agentType → positional）。
 *   5. 全程容錯（任何例外 → null）。
 *
 * @param projectPath 專案根目錄（傳給 findProjectFolder 用）
 * @param convId      主 session uuid（同 JSONL 檔名 stem）
 * @param toolUseId   要比對的 tool_use block id（如 "toolu_..."）
 * @returns 命中時回傳 SubagentTranscriptInfo；找不到或發生錯誤回 null
 */
export function resolveSubagentTranscript(
  projectPath: string,
  convId: string,
  toolUseId: string,
): SubagentTranscriptInfo | null {
  try {
    if (!projectPath || !convId || !toolUseId) return null;
    const match = findProjectFolder(projectPath);
    if (SKIP_MATCHES.has(match.match)) return null;
    const folder = match.folder_path;
    if (!folder || !fs.existsSync(folder)) return null;

    const subagentsDir = nodePath.join(folder, convId, 'subagents');
    if (!fs.existsSync(subagentsDir)) return null;

    const metas = _scanSubagentMetas(subagentsDir);
    if (metas.length === 0) return null;

    // 新版精確路徑：meta.toolUseId === toolUseId 且 .jsonl 存在。
    for (const m of metas) {
      if (m.toolUseId === toolUseId && m.jsonlExists) return _toEntryInfo(m);
    }

    // 備援只在「所有 meta 都缺 toolUseId」時啟動（不影響新版正常路徑）。
    // 有任一 meta 帶 toolUseId 卻仍 miss → 視為真的找不到，不亂猜。
    const allMissingToolUseId = metas.every((m) => m.toolUseId === null);
    if (allMissingToolUseId) {
      return _resolveSubagentFallback(folder, convId, toolUseId, metas);
    }

    return null;
  } catch {
    return null;
  }
}
