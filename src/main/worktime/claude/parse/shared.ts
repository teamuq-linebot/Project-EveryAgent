/**
 * parse/shared.ts — Claude session 解析的共用 leaf helper + 常數 + subagent 身分識別。
 *
 * 行為保留（move-only）：自原 parse.ts 原樣搬出，邏輯/regex/控制流一字未改。
 * 這裡集中放「被多個 sibling 模組共用」的低階純函式與常數，避免 facade 與 sibling
 * 互相 import 造成的循環相依。
 */

import type { JsonlItem } from '../../types';

// ---------------------------------------------------------------------------
// 常數
// ---------------------------------------------------------------------------

/**
 * AskUserQuestion 等待切段門檻（毫秒）。
 * 主對話等使用者回答 ask > 此值時，把「回答之後」的主對話活動歸入新一輪。
 * 對應 Python ASK_WAIT_SPLIT_MS = 30_000。
 */
export const ASK_WAIT_SPLIT_MS = 30_000;

// ---------------------------------------------------------------------------
// Regex（忠實對應 Python regex，逐一確認 JS 等價）
// ---------------------------------------------------------------------------

// Python: re.compile(r"你是[\s\S]{0,80}?\*\*([^*]+)\*\*")
// JS: /你是[\s\S]{0,80}?\*\*([^*]+)\*\*/  — [\s\S] 取代 Python re.S 跨行 .
const _RE_DECLARED = /你是[\s\S]{0,80}?\*\*([^*]+)\*\*/;

// Python: re.compile(r"agents[\\/]+([^`\"'\r\n]+?)[\\/]+agent\.yaml", re.I)
// JS: /agents[\/\\]+([^`"'\r\n]+?)[\/\\]+agent\.yaml/i
const _RE_YAML_PATH = /agents[/\\]+([^`"'\r\n]+?)[/\\]+agent\.yaml/i;

// Python: re.compile(r"^agent:\s*[\"']?([^\"'\r\n]+)[\"']?", re.M)
// JS: /^agent:\s*["']?([^"'\r\n]+)["']?/m  — re.M 對應 JS /m flag
const _RE_YAML_AGENT = /^agent:\s*["']?([^"'\r\n]+)["']?/m;

// Python: re.compile(r"^display_name:\s*[\"']?([^\"'\r\n]+)[\"']?", re.M)
const _RE_YAML_DISPLAY = /^display_name:\s*["']?([^"'\r\n]+)["']?/m;

// Python: re.compile(r"^title:\s*[\"']?([^\"'\r\n]+)[\"']?", re.M)
const _RE_YAML_TITLE = /^title:\s*["']?([^"'\r\n]+)["']?/m;

// ---------------------------------------------------------------------------
// 通用 helper
// ---------------------------------------------------------------------------

/** 取 record 的 timestamp（對應 Python get_timestamp）。 */
export function getTimestamp(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const rec = record as Record<string, unknown>;
  const ts = rec['timestamp'];
  if (typeof ts === 'string' && ts) return ts;
  const msg = rec['message'];
  if (msg && typeof msg === 'object') {
    const msgTs = (msg as Record<string, unknown>)['timestamp'];
    if (typeof msgTs === 'string' && msgTs) return msgTs;
  }
  return null;
}

/** 取 record 的 message.content 內 type=tool_result 的所有 block（對應 Python _text_blocks）。 */
export function _textBlocks(record: unknown): string[] {
  if (!record || typeof record !== 'object') return [];
  const rec = record as Record<string, unknown>;
  const msg = rec['message'];
  if (!msg || typeof msg !== 'object') return [];
  const content = (msg as Record<string, unknown>)['content'];
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  const out: string[] = [];
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue;
    const c = (block as Record<string, unknown>)['content'];
    if (typeof c === 'string' && c) out.push(c);
  }
  return out;
}

/**
 * 找 tool_use_id 對應的 tool_result timestamp。
 * 對應 Python find_tool_result_timestamp()。
 */
export function findToolResultTimestamp(
  records: JsonlItem[],
  toolUseId: string | null | undefined,
  afterIndex: number,
): string | null {
  if (!toolUseId) return null;
  for (const item of records) {
    if ((item.index ?? -1) <= afterIndex) continue;
    const record = item.record;
    const msg = record['message'];
    const content = msg && typeof msg === 'object' ? (msg as Record<string, unknown>)['content'] : null;
    if (!Array.isArray(content)) continue;
    const matched = content.some(
      (block) =>
        typeof block === 'object' &&
        block !== null &&
        (block as Record<string, unknown>)['type'] === 'tool_result' &&
        (block as Record<string, unknown>)['tool_use_id'] === toolUseId,
    );
    if (matched) {
      return getTimestamp(record);
    }
  }
  return null;
}

/**
 * 取單筆 assistant record 的純文字（對應 Python assistant_text_of）。
 * assistant 的文字在 content 內 type=="text" 的 block 的 "text" 欄。
 */
export function assistantTextOf(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const rec = record as Record<string, unknown>;
  if (rec['type'] !== 'assistant') return '';
  const msg = rec['message'];
  if (!msg || typeof msg !== 'object') return '';
  const content = (msg as Record<string, unknown>)['content'];
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const b of content) {
    if (typeof b !== 'object' || b === null) continue;
    const bRec = b as Record<string, unknown>;
    if (bRec['type'] === 'text' && typeof bRec['text'] === 'string') {
      texts.push(bRec['text']);
    }
  }
  return texts.filter(Boolean).join('\n').trim();
}

/**
 * 取單筆 user record 的純文字（對應 Python user_text_of）。
 * user 的輸入文字可能是 content 直接字串，或 content list 內 type=="text" 的 block。
 * 忽略 tool_result block（那是工具回傳非使用者輸入）。
 */
export function userTextOf(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const rec = record as Record<string, unknown>;
  if (rec['type'] !== 'user') return '';
  const msg = rec['message'];
  if (!msg || typeof msg !== 'object') return '';
  const content = (msg as Record<string, unknown>)['content'];
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  const texts: string[] = [];
  for (const b of content) {
    if (typeof b !== 'object' || b === null) continue;
    const bRec = b as Record<string, unknown>;
    if (bRec['type'] === 'text' && typeof bRec['text'] === 'string') {
      texts.push(bRec['text'] as string);
    }
  }
  return texts.filter(Boolean).join('\n').trim();
}

// ---------------------------------------------------------------------------
// subagent 身分識別（對應 Python extract_subagent_identity）
// ---------------------------------------------------------------------------

export interface SubagentIdentity {
  agent_id: string;
  attribution_agent: string;
  attribution_skill: string;
  model: string;
  agent_declared_name: string;
  agent_display_name: string;
  agent_title: string;
  agent_path: string;
}

export function extractSubagentIdentity(records: JsonlItem[]): SubagentIdentity {
  const identity: SubagentIdentity = {
    agent_id: '',
    attribution_agent: '',
    attribution_skill: '',
    model: '',
    agent_declared_name: '',
    agent_display_name: '',
    agent_title: '',
    agent_path: '',
  };

  for (const item of records) {
    const record = item.record;
    if (!identity.agent_id && record['agentId']) {
      identity.agent_id = String(record['agentId']);
    }
    if (!identity.attribution_agent && record['attributionAgent']) {
      identity.attribution_agent = String(record['attributionAgent']);
    }
    if (!identity.attribution_skill && record['attributionSkill']) {
      identity.attribution_skill = String(record['attributionSkill']);
    }
    const msg = record['message'];
    if (!identity.model && msg && typeof msg === 'object' && (msg as Record<string, unknown>)['model']) {
      identity.model = String((msg as Record<string, unknown>)['model']);
    }
    for (const text of _textBlocks(record)) {
      if (!identity.agent_declared_name) {
        const m = _RE_DECLARED.exec(text);
        if (m) identity.agent_declared_name = m[1].trim();
      }
      if (!identity.agent_path) {
        const m = _RE_YAML_PATH.exec(text);
        if (m) identity.agent_path = m[1].replace(/[/\\]+/g, '/').trim();
      }
      if (!identity.agent_declared_name) {
        const m = _RE_YAML_AGENT.exec(text);
        if (m) identity.agent_declared_name = m[1].trim();
      }
      if (!identity.agent_display_name) {
        const m = _RE_YAML_DISPLAY.exec(text);
        if (m) identity.agent_display_name = m[1].trim();
      }
      if (!identity.agent_title) {
        const m = _RE_YAML_TITLE.exec(text);
        if (m) identity.agent_title = m[1].trim();
      }
    }
  }
  return identity;
}
