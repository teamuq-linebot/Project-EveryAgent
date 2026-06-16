/**
 * worktime 核心型別定義。
 * 對應 Python worktime dict 欄位名（snake_case 一字不差）。
 */

/** token 使用量統計，對應 Python empty_token_usage() 結構。 */
export interface TokenStats {
  input: number;
  output: number;
  cache_creation: number;
  cache_creation_5m: number;
  cache_creation_1h: number;
  cache_read: number;
  total: number;
  message_count: number;
  cost_usd: number;
  priced_token_count: number;
}

/**
 * work_timeline 一列，對應 build_work_timeline 產出的 row dict。
 * 欄位名與 Python 版完全相同（snake_case）。
 * Index signature 允許動態欄位存取（called_at / request_id 等跨 kind 欄位）。
 */
export interface WorkRow {
  [key: string]: unknown;
  kind: 'main-user' | 'main-ai' | 'main-dispatch' | 'subagent' | 'ask';
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  title: string;
  detail: string;
  source: string;

  // kind=main-user / main-ai / main-dispatch
  round?: number;
  input_prompt?: string;

  // kind=main-ai
  stop?: string | null;
  request_id?: string;
  last_output?: string;
  token_usage?: TokenStats;

  // kind=main-dispatch
  called_at?: string | null;
  tool_use_id?: string;
  request_id_dispatch?: string; // same as request_id for dispatch

  // kind=subagent
  agent_type?: string;
  agent_name?: string;
  agent_declared_name?: string;
  agent_display_name?: string;
  agent_title?: string;
  agent_path?: string;
  agent_id?: string;
  attribution_skill?: string;
  model?: string;

  // kind=ask
  answered_at?: string | null;
  split_round?: boolean;
}

/** read_jsonl 返回的一列結構。 */
export interface JsonlItem {
  index: number;
  record: Record<string, unknown>;
  error: null;
}

/** subagent session 摘要（由 parse_session_file / discover 產出）。 */
export interface SubagentInfo {
  source: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_ms?: number | null;
  agent_type?: string;
  agent_title?: string;
  agent_declared_name?: string;
  agent_display_name?: string;
  attribution_agent?: string;
  attribution_skill?: string;
  agent_path?: string;
  agent_id?: string;
  model?: string;
  token_usage?: TokenStats;
  description?: string;
  tool_use_id?: string;
  last_assistant_output?: string;
  first_user_input?: string;
}
