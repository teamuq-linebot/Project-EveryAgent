/**
 * Claude 來源聚合入口：getProject（合併 projects / local-agent / cowork 三來源）。
 * 忠實移植自 Python teamuq/worktime/sources/claude/index.py（行為一字不改）。
 * 依賴方向：index 引 core（jsonl）+ 本來源 paths / discover；為依賴鏈最上層。
 */

import { toEpochMs } from '../jsonl';
import { getTimestamp } from './parse';
import {
  CLAUDE_PROJECTS,
  CLAUDE_COWORK_SESSIONS,
  CLAUDE_LOCAL_AGENT_SESSIONS,
} from './paths';
import {
  findProjectFolder,
  listSessions,
  listCoworkSessions,
  listLocalAgentProjectSessions,
  listCoworkLinkedProjectSessions,
} from './discover';
import type { SessionDict } from './discover';
import type { ConversationMessage, ConvBlock } from '../../../shared/ipcContracts';

export interface ProjectResult {
  project_path: string;
  claude_projects_root: string;
  cowork_sessions_root: string;
  local_agent_sessions_root: string;
  naming_rule: string;
  folder_name: string;
  folder_path: string;
  match: string;
  sessions: SessionDict[];
  cowork_sessions?: unknown[];
  [key: string]: unknown;
}

/**
 * 回傳該專案所有 session 的工時解析結果（合併三來源）。
 *
 * 收集並合併：
 *   (1) 預設 ~/.claude/projects 直接命中的 sessions。
 *   (2) 每個 local-agent root（巢狀 .claude/projects）比對命中後的 sessions。
 *   (3) cowork metadata 連回 projects / local-agent 的真實 session。
 *
 * 去重：以 session 的 source（jsonl 檔絕對路徑）為唯一鍵。
 * 容錯：任一來源缺資料 / 壞檔 / 權限 → 略過、不崩；三來源全空 → 回空 sessions。
 *
 * 對應 Python get_project()。
 */
export function getProject(projectPath: string): ProjectResult {
  const match = findProjectFolder(projectPath);
  const payload: ProjectResult = {
    project_path: projectPath,
    claude_projects_root: CLAUDE_PROJECTS,
    cowork_sessions_root: CLAUDE_COWORK_SESSIONS,
    local_agent_sessions_root: CLAUDE_LOCAL_AGENT_SESSIONS,
    naming_rule:
      '非 A-Za-z0-9- 字元全轉連字號，不合併；找不到時做大小寫不敏感比對與 cwd 掃描。',
    ...match,
    sessions: [],
  };

  const merged: SessionDict[] = [];
  const seenSources = new Set<string>();

  function addSessions(sessions: SessionDict[] | undefined) {
    for (const sess of sessions ?? []) {
      const key = sess.source || sess.file;
      if (key && seenSources.has(key)) continue;
      if (key) seenSources.add(key);
      merged.push(sess);
    }
  }

  // (1) 預設 projects 直接命中
  if (
    match.match !== 'not-found' &&
    match.match !== 'parent-direct' &&
    match.match !== 'parent-case-insensitive'
  ) {
    try {
      const defaultSessions = listSessions(match.folder_path);
      addSessions(defaultSessions);
    } catch {
      // ignore errors
    }
  }

  // (2) local-agent 各 root
  try {
    for (const la of listLocalAgentProjectSessions(projectPath)) {
      addSessions(la.sessions);
    }
  } catch {
    // ignore
  }

  // (3) cowork：metadata 比對 + 連回真實 session
  try {
    const coworkSessions = listCoworkSessions(projectPath);
    payload['cowork_sessions'] = coworkSessions;
    for (const linked of listCoworkLinkedProjectSessions(projectPath, coworkSessions)) {
      addSessions(linked.sessions);
    }
  } catch {
    payload['cowork_sessions'] = [];
  }

  merged.sort((a, b) => (toEpochMs(a.started_at) ?? 0) - (toEpochMs(b.started_at) ?? 0));
  merged.reverse();
  payload.sessions = merged;
  return payload;
}

/** 安全 JSON.stringify（容錯，回空字串）。 */
function _safeJson(v: unknown): string {
  try {
    return JSON.stringify(v ?? {}, null, 2);
  } catch {
    return '';
  }
}

/** tool_result block 的 content → 文字（content 可為字串或 [{text}] 陣列）。 */
function _toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === 'object' ? String((c as Record<string, unknown>)['text'] ?? '') : ''))
      .join('');
  }
  return '';
}

/** 把一則 message 的 content 拆成顯示區塊（對應 viewer 的 block 分類）。 */
function _extractBlocks(content: unknown): ConvBlock[] {
  const out: ConvBlock[] = [];
  if (typeof content === 'string') {
    const t = content.trim();
    if (t) out.push({ kind: 'text', text: t });
    return out;
  }
  if (!Array.isArray(content)) return out;
  for (const b of content) {
    if (!b || typeof b !== 'object') continue;
    const block = b as Record<string, unknown>;
    const bt = block['type'];
    if (bt === 'text' && typeof block['text'] === 'string') {
      const t = block['text'].trim();
      if (t) out.push({ kind: 'text', text: t });
    } else if (bt === 'thinking') {
      out.push({ kind: 'thinking', text: String(block['thinking'] ?? '') });
    } else if (bt === 'tool_use') {
      const toolBlock: ConvBlock = { kind: 'tool_use', name: String(block['name'] ?? 'tool'), text: _safeJson(block['input']) };
      // 保留原始 block id，供呼叫端比對 subagent meta.json 的 toolUseId。
      if (typeof block['id'] === 'string') toolBlock.id = block['id'];
      out.push(toolBlock);
    } else if (bt === 'tool_result') {
      const trBlock: ConvBlock = { kind: 'tool_result', text: _toolResultText(block['content']) };
      // 保留對應的 tool_use block id，供 app.html 的 `for:` 標示用。
      if (typeof block['tool_use_id'] === 'string') trBlock.tool_use_id = block['tool_use_id'];
      out.push(trBlock);
    }
  }
  return out;
}

/** user 訊息來源徽章（對應 viewer getUserSource：tool_result / meta / command / typed / interrupt / notify）。
 *  interrupt 判斷優先：研究（special-records-research-20260604）確認頂層 interruptedMessageId
 *  是 Esc 中斷記錄最可靠識別符，原 promptSource fallback 會誤將其分類為 typed。
 *  notify：promptSource==='system' 為 harness 注入的背景任務完成通知
 *  （依據：findings.md idx=38 實樣 promptSource=system <task-notification>）。
 *  notify 位置在 interrupt 判斷後、既有 fallback 前，不被誤判為 typed 而開新段。 */
function _userSource(
  rec: Record<string, unknown>,
  content: unknown,
): 'typed' | 'command' | 'tool_result' | 'meta' | 'interrupt' | 'notify' {
  if (Array.isArray(content) && content.some((b) => b && (b as Record<string, unknown>)['type'] === 'tool_result')) {
    return 'tool_result';
  }
  if (rec['isMeta'] === true) return 'meta';
  // interrupt record：頂層有 interruptedMessageId（string）→ Esc 中斷，優先於 promptSource fallback
  if (typeof rec['interruptedMessageId'] === 'string') return 'interrupt';
  // notify record：promptSource==='system' → harness 注入通知（如背景任務完成），不開新段
  if (rec['promptSource'] === 'system') return 'notify';
  let full = '';
  if (typeof content === 'string') full = content;
  else if (Array.isArray(content)) {
    for (const b of content) {
      if (b && (b as Record<string, unknown>)['type'] === 'text' && typeof (b as Record<string, unknown>)['text'] === 'string') {
        full += (b as Record<string, unknown>)['text'] as string;
      }
    }
  }
  if (full.includes('<command-name>') || full.includes('<command-message>')) return 'command';
  return 'typed';
}

/** 單筆 record → 對話訊息（非 user/assistant/system-turn_duration 或無可顯示內容 → null）。
 *  供 conversationStore（增量 + SQLite 持久化）逐筆轉換。 */
export function recordToConversationMessage(
  rec: Record<string, unknown>,
): ConversationMessage | null {
  const type = rec['type'];
  // system/turn_duration：映射為 role==='system' 的分隔線訊息
  if (type === 'system' && rec['subtype'] === 'turn_duration') {
    const td: ConversationMessage['turnDuration'] = {
      durationMs: typeof rec['durationMs'] === 'number' ? rec['durationMs'] as number : 0,
    };
    if (typeof rec['messageCount'] === 'number') td.messageCount = rec['messageCount'] as number;
    return {
      role: 'system',
      timestamp: getTimestamp(rec) ?? undefined,
      blocks: [],
      turnDuration: td,
    };
  }
  if (type !== 'user' && type !== 'assistant') return null;
  const msg = (rec['message'] ?? {}) as Record<string, unknown>;
  const content = msg['content'] ?? rec['content'];
  const blocks = _extractBlocks(content);
  if (blocks.length === 0) return null;
  let role = type as 'user' | 'assistant';
  let source: ConversationMessage['source'];
  if (role === 'user') {
    source = _userSource(rec, content);
    // tool_result / meta 在 JSONL 裡 role=user 只是技術格式 —— 它們是 AI 工作流的一部分
    // （AI 叫工具、結果回給 AI；meta 是系統中繼訊息），顯示上歸 AI 側。
    if (source === 'tool_result' || source === 'meta') role = 'assistant';
  }
  const message: ConversationMessage = {
    role,
    timestamp: getTimestamp(rec) ?? undefined,
    blocks,
  };
  if (source) message.source = source;
  // 若 record 頂層有 toolUseResult（含 agentId），將 token 統計注入 tool_result block 的 subagentStats。
  // toolUseResult 為 subagent 完成回報結構，status=completed 時才含 token 欄位。
  const tur = rec['toolUseResult'] as Record<string, unknown> | undefined;
  if (tur && typeof tur === 'object' && typeof tur['agentId'] === 'string') {
    for (const blk of blocks) {
      if (blk.kind !== 'tool_result') continue;
      const stats: ConvBlock['subagentStats'] = {};
      if (typeof tur['totalTokens'] === 'number') stats.totalTokens = tur['totalTokens'] as number;
      if (typeof tur['totalDurationMs'] === 'number') stats.durationMs = tur['totalDurationMs'] as number;
      const u = tur['usage'] as Record<string, unknown> | undefined;
      if (u && typeof u === 'object') {
        if (typeof u['input_tokens'] === 'number') stats.input = u['input_tokens'] as number;
        if (typeof u['output_tokens'] === 'number') stats.output = u['output_tokens'] as number;
      }
      // 至少有一個數值欄位才附加
      if (Object.keys(stats).length > 0) blk.subagentStats = stats;
    }
  }
  // 解析 assistant record 的 token 用量（數值欄位存在且為 number 才填）
  if (type === 'assistant') {
    const u = msg['usage'] as Record<string, unknown> | undefined;
    if (u && typeof u === 'object') {
      const inp = u['input_tokens'];
      const out = u['output_tokens'];
      if (typeof inp === 'number' && typeof out === 'number') {
        const usage: ConversationMessage['usage'] = { input: inp, output: out };
        if (typeof u['cache_read_input_tokens'] === 'number') usage.cacheRead = u['cache_read_input_tokens'] as number;
        if (typeof u['cache_creation_input_tokens'] === 'number') usage.cacheCreate = u['cache_creation_input_tokens'] as number;
        message.usage = usage;
      }
    }
    // stop_reason → stopReason（'stop_sequence' = 靜默結束，結尾偵測用）
    if (typeof msg['stop_reason'] === 'string') message.stopReason = msg['stop_reason'] as string;
    // model === '<synthetic>' → synthetic = true（關窗重連時系統注入的「No response requested.」）
    if (msg['model'] === '<synthetic>') message.synthetic = true;
  }
  return message;
}

// 增量讀取 + SQLite 持久化已搬到 services/conversationStore.ts（ConversationStore），
// 本檔只保留純轉換（recordToConversationMessage 及其 helpers）。
