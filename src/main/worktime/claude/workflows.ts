/**
 * Workflow 進度讀取：掃描某 session 的 workflows 資料夾，把每個 run 的 wf_*.json
 * 拆成監測卡片用的精簡摘要（phases + agents）。
 *
 * 真相檔位置（與 subagents 同層）：
 *   <projectFolder>/<sessionId>/workflows/wf_<id>.json
 *
 * 該檔在 run 期間即時更新，故由 MonitorController 既有 2 秒掃描迴圈輪詢即可，
 * 不需另開 fs.watch。容錯為先：壞檔 / 半寫入 / 缺欄位一律跳過或補空。
 */

import * as fs from 'fs';
import * as nodePath from 'path';
import type {
  WorkflowRunSummary,
  WorkflowAgentEntry,
} from '../../../shared/ipcContracts';
import { findProjectFolder } from './discover';

/** workflowProgress[] 內的原始 entry（只取我們在意的欄位，其餘忽略）。 */
interface RawProgressEntry {
  type?: string;
  index?: number;
  label?: string;
  phaseTitle?: string;
  phaseIndex?: number;
  state?: string;
  agentId?: string;
  model?: string;
  lastToolName?: string;
  lastToolSummary?: string;
  promptPreview?: string;
  resultPreview?: string;
  tokens?: number;
  toolCalls?: number;
  durationMs?: number;
}

interface RawWorkflowFile {
  runId?: string;
  workflowName?: string;
  name?: string;
  status?: string;
  startTime?: number;
  durationMs?: number;
  agentCount?: number;
  totalTokens?: number;
  totalToolCalls?: number;
  phases?: { title?: string; detail?: string }[];
  workflowProgress?: RawProgressEntry[];
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) ? v : undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** 把一個 wf_*.json 的解析結果映射成 WorkflowRunSummary；缺關鍵欄位回 null。 */
function toSummary(raw: RawWorkflowFile, fallbackRunId: string): WorkflowRunSummary | null {
  const runId = asString(raw.runId) ?? fallbackRunId;
  if (!runId) return null;

  const phases = Array.isArray(raw.phases)
    ? raw.phases.map((p) => ({
        title: asString(p?.title) ?? '',
        detail: asString(p?.detail),
      }))
    : [];

  const agents: WorkflowAgentEntry[] = Array.isArray(raw.workflowProgress)
    ? raw.workflowProgress
        .filter((e) => e?.type === 'workflow_agent')
        .map((e) => ({
          index: asNumber(e.index) ?? 0,
          label: asString(e.label) ?? '(agent)',
          phaseTitle: asString(e.phaseTitle) ?? '',
          phaseIndex: asNumber(e.phaseIndex) ?? 0,
          state: asString(e.state) ?? 'queued',
          agentId: asString(e.agentId),
          model: asString(e.model),
          lastToolName: asString(e.lastToolName),
          lastToolSummary: asString(e.lastToolSummary),
          promptPreview: asString(e.promptPreview),
          resultPreview: asString(e.resultPreview),
          tokens: asNumber(e.tokens),
          toolCalls: asNumber(e.toolCalls),
          durationMs: asNumber(e.durationMs),
        }))
    : [];

  return {
    runId,
    workflowName: asString(raw.workflowName) ?? asString(raw.name) ?? runId,
    status: asString(raw.status) ?? 'unknown',
    startTime: asNumber(raw.startTime),
    durationMs: asNumber(raw.durationMs),
    agentCount: asNumber(raw.agentCount),
    totalTokens: asNumber(raw.totalTokens),
    totalToolCalls: asNumber(raw.totalToolCalls),
    phases,
    agents,
  };
}

/**
 * 讀某 session 的所有 workflow run 摘要。
 * 排序：running 優先，其餘依 startTime 新到舊（無 startTime 沉底）。
 */
export function readSessionWorkflows(
  folderPath: string,
  sessionId: string,
): WorkflowRunSummary[] {
  const dir = nodePath.join(folderPath, sessionId, 'workflows');
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return []; // 沒有 workflows 資料夾＝此 session 沒跑過 workflow
  }

  const summaries: WorkflowRunSummary[] = [];
  for (const name of names) {
    if (!name.startsWith('wf_') || !name.endsWith('.json')) continue;
    const file = nodePath.join(dir, name);
    let raw: RawWorkflowFile;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8')) as RawWorkflowFile;
    } catch {
      continue; // 壞檔 / 半寫入：跳過，下輪掃描再試
    }
    const summary = toSummary(raw, name.replace(/\.json$/, ''));
    if (summary) summaries.push(summary);
  }

  summaries.sort((a, b) => {
    const ar = a.status === 'running' ? 0 : 1;
    const br = b.status === 'running' ? 0 : 1;
    if (ar !== br) return ar - br;
    return (b.startTime ?? 0) - (a.startTime ?? 0);
  });
  return summaries;
}

/** resolveWorkflowAgentTranscript 的回傳結構。 */
export interface WorkflowAgentTranscriptInfo {
  /** agent JSONL 絕對路徑（agent-<agentId>.jsonl） */
  file: string;
  /** agentId（原樣帶回） */
  agentId: string;
  /** meta.json 的 agentType（無則 null） */
  agentType: string | null;
}

/**
 * 依 (projectPath, convId=claudeSessionId, runId, agentId) 定位 workflow 子代理逐字稿。
 *
 * 路徑規則（已驗證）：
 *   <projectFolder>/<convId>/subagents/workflows/<runId>/agent-<agentId>.jsonl
 *   <projectFolder>/<convId>/subagents/workflows/<runId>/agent-<agentId>.meta.json（agentType）
 *
 * 與 lightList.resolveSubagentTranscript 同精神，但 workflow agent 直接以 agentId 命名，
 * 不必掃 meta 比對 toolUseId。找不到 / 讀不到一律回 null（容錯）。
 */
export function resolveWorkflowAgentTranscript(
  projectPath: string,
  convId: string,
  runId: string,
  agentId: string,
): WorkflowAgentTranscriptInfo | null {
  try {
    if (!projectPath || !convId || !runId || !agentId) return null;
    const match = findProjectFolder(projectPath);
    const folder = match.folder_path;
    if (!folder || !fs.existsSync(folder)) return null;

    const dir = nodePath.join(folder, convId, 'subagents', 'workflows', runId);
    const file = nodePath.join(dir, `agent-${agentId}.jsonl`);
    if (!fs.existsSync(file)) return null;

    let agentType: string | null = null;
    try {
      const meta = JSON.parse(
        fs.readFileSync(nodePath.join(dir, `agent-${agentId}.meta.json`), 'utf8'),
      ) as Record<string, unknown>;
      if (typeof meta['agentType'] === 'string') agentType = meta['agentType'];
    } catch {
      /* meta 缺失 / 壞檔 → agentType 留 null */
    }

    return { file, agentId, agentType };
  } catch {
    return null;
  }
}

/**
 * 進度節流簽名：只在 run 數 / 狀態 / 各 agent 狀態 / tokens 變動時才推 IPC，
 * 避免每 2 秒掃描都洗版 renderer。
 */
export function workflowsSignature(workflows: WorkflowRunSummary[]): string {
  return workflows
    .map(
      (w) =>
        `${w.runId}:${w.status}:${w.totalTokens ?? 0}:` +
        w.agents.map((a) => `${a.index}=${a.state}/${a.tokens ?? 0}`).join(','),
    )
    .join('|');
}
