import type Database from 'better-sqlite3';
import { openTeamuqDb } from '../repo/sqliteTaskRepository';

export interface AgentConvSessionRecord {
  conversationId: string;
  label: string;
  kind: string | null;
  teamId: string | null;
  agentName: string | null;
  cliId: 'claude' | 'codex' | 'antigravity';
  cwd: string;
  initialPrompt: string | null;
  skillName: string | null;
  externalSessionId: string | null;
  jsonlFile: string | null;
  status: 'running' | 'done' | 'closed';
  createdAt: string;
  updatedAt: string;
}

export interface AgentConvSessionOpenInput {
  conversationId: string;
  label: string;
  cliId: string;
  cwd: string;
  initialPrompt: string | null;
  skillName?: string | null;
}

interface AgentConvSessionRow {
  conversation_id: string;
  label: string;
  kind: string | null;
  team_id: string | null;
  agent_name: string | null;
  cli_id: string;
  cwd: string;
  initial_prompt: string | null;
  skill_name: string | null;
  external_session_id: string | null;
  jsonl_file: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export class AgentConvSessionStore {
  private readonly _db: Database.Database;

  constructor(db?: Database.Database) {
    this._db = db ?? openTeamuqDb();
  }

  upsertOpen(input: AgentConvSessionOpenInput): void {
    const now = new Date().toISOString();
    const parsed = parsePromptTarget(input.initialPrompt);
    this._db.prepare(
      `INSERT INTO agent_conv_sessions (
        conversation_id, label, kind, team_id, agent_name, cli_id, cwd,
        initial_prompt, skill_name, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        label = excluded.label,
        kind = excluded.kind,
        team_id = excluded.team_id,
        agent_name = excluded.agent_name,
        cli_id = excluded.cli_id,
        cwd = excluded.cwd,
        initial_prompt = excluded.initial_prompt,
        skill_name = excluded.skill_name,
        status = 'running',
        updated_at = excluded.updated_at`,
    ).run(
      input.conversationId,
      input.label,
      parsed.kind,
      parsed.teamId,
      parsed.agentName,
      normalizeCliId(input.cliId),
      input.cwd,
      input.initialPrompt,
      input.skillName ?? parsed.skillName,
      now,
      now,
    );
  }

  updateJsonlFile(conversationId: string, jsonlFile: string, externalSessionId: string | null = null): void {
    this._db.prepare(
      `UPDATE agent_conv_sessions
       SET jsonl_file = ?,
           external_session_id = COALESCE(?, external_session_id),
           updated_at = ?
       WHERE conversation_id = ?`,
    ).run(jsonlFile, externalSessionId, new Date().toISOString(), conversationId);
  }

  updateStatus(conversationId: string, status: AgentConvSessionRecord['status']): void {
    this._db.prepare(
      `UPDATE agent_conv_sessions
       SET status = ?, updated_at = ?
       WHERE conversation_id = ?`,
    ).run(status, new Date().toISOString(), conversationId);
  }

  get(conversationId: string): AgentConvSessionRecord | null {
    const row = this._db.prepare(
      'SELECT * FROM agent_conv_sessions WHERE conversation_id = ?',
    ).get(conversationId) as AgentConvSessionRow | undefined;
    return row ? rowToRecord(row) : null;
  }

  listRecent(limit = 20): AgentConvSessionRecord[] {
    // 排除 status='closed'：使用者按 X（hide）或手動關閉進行中對話時標為 closed，
    // 代表「永久從清單移除」（一次性對話語意），重啟後不再顯示。'running'/'done' 仍列出。
    const rows = this._db.prepare(
      `SELECT * FROM agent_conv_sessions
       WHERE status != 'closed'
       ORDER BY updated_at DESC
       LIMIT ?`,
    ).all(limit) as AgentConvSessionRow[];
    return rows.map(rowToRecord);
  }
}

function rowToRecord(row: AgentConvSessionRow): AgentConvSessionRecord {
  return {
    conversationId: row.conversation_id,
    label: row.label,
    kind: row.kind,
    teamId: row.team_id,
    agentName: row.agent_name,
    cliId: normalizeCliId(row.cli_id),
    cwd: row.cwd,
    initialPrompt: row.initial_prompt,
    skillName: row.skill_name,
    externalSessionId: row.external_session_id,
    jsonlFile: row.jsonl_file,
    status: normalizeStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeCliId(value: string): AgentConvSessionRecord['cliId'] {
  return value === 'codex' || value === 'antigravity' ? value : 'claude';
}

function normalizeStatus(value: string): AgentConvSessionRecord['status'] {
  return value === 'running' || value === 'done' ? value : 'closed';
}

function parsePromptTarget(prompt: string | null): {
  skillName: string | null;
  kind: string | null;
  teamId: string | null;
  agentName: string | null;
} {
  if (!prompt) return { skillName: null, kind: null, teamId: null, agentName: null };
  const match = prompt.trim().match(/^[/$]([^\s]+)\s+(audit|review)\s+([^\s]+)/);
  if (!match) return { skillName: null, kind: null, teamId: null, agentName: null };
  const [, skillName, kind, target] = match;
  const [teamId, agentName] = target.split('/', 2);
  return {
    skillName,
    kind,
    teamId: teamId || null,
    agentName: agentName || null,
  };
}
