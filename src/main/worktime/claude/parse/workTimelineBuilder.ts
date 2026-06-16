/**
 * parse/workTimelineBuilder.ts — buildWorkTimeline 組裝組（主目標）。
 *
 * 行為保留（move-only）：自原 parse.ts 原樣搬出，兩遍掃描/round 遞增時機/ask-split/dispatch/
 * orphan/完成訊號/last_output 回填/per-round artifacts 回填/collapse+filter+sort 全部一字未改。
 */

import { toEpochMs, dateDiffMs } from '../../jsonl';
import { emptyTokenUsage } from '../../tokens';
import { collapseMainAiRows } from '../../timestats';
import type { WorkRow, JsonlItem, SubagentInfo, TokenStats } from '../../types';
import { ASK_WAIT_SPLIT_MS, getTimestamp, findToolResultTimestamp, assistantTextOf, userTextOf } from './shared';
import { usageToTokenStats } from './tokenCost';
import type { WorkArtifact } from './artifactExtractor';
import { collectEditArtifactsForRecord } from './artifactExtractor';

// ---------------------------------------------------------------------------
// subagent 配對（對應 Python match_subagent）
// ---------------------------------------------------------------------------

interface DispatchCall {
  timestamp: string;
  tool_use_id: string;
  description: string;
  agent_type: string;
  model: string;
}

function matchSubagent(
  call: DispatchCall,
  subagents: SubagentInfo[],
  usedSubagents: Set<string>,
): SubagentInfo | null {
  const normalizedDesc = (call.description || '').trim().toLowerCase();
  const normalizedType = (call.agent_type || '').trim().toLowerCase();

  // 精確比對 description+agentType
  for (const agent of subagents) {
    if (agent.source && usedSubagents.has(agent.source)) continue;
    if (
      (agent.description || '').trim().toLowerCase() === normalizedDesc &&
      (agent.agent_type || '').trim().toLowerCase() === normalizedType
    ) {
      return agent;
    }
  }

  // 時間鄰近（±120s）
  const callTime = toEpochMs(call.timestamp);
  for (const agent of subagents) {
    if (agent.source && usedSubagents.has(agent.source)) continue;
    const startTime = toEpochMs(agent.started_at);
    if (callTime !== null && startTime !== null && Math.abs(startTime - callTime) < 120000) {
      return agent;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// build_work_timeline（主目標，對應 Python build_work_timeline）
// ---------------------------------------------------------------------------

/**
 * 對齊 Python build_work_timeline。
 *
 * round_no 遞增時機：
 * 1. 遇到真實 user 訊息（非 meta、非 tool_result）→ round_no += 1（輪界）。
 * 2. ask 等待 > ASK_WAIT_SPLIT_MS（30s）→ round_no += 1（切段）。
 */
export function buildWorkTimeline(mainRecords: JsonlItem[], subagents: SubagentInfo[]): WorkRow[] {
  const usedSubagents = new Set<string>();
  const usedDispatchUsageRequestIds = new Set<string>();
  const rows: WorkRow[] = [];
  let lastReadyAt: string | null = null;
  let roundNo = 0;
  // §2.14d D31：per-round 累積的 Edit/Write artifacts（Edit/Write 的 assistant record 本身
  //   不產 row [其他 tool_use → skip]，故按 round 收集 → 收尾回填到該 round 的 main 列，
  //   讓 punchCore 依 round 分桶時能聚合進工作段）。tool_use_id 去重防同一 hunk 重覆收。
  const roundArtifacts = new Map<number, WorkArtifact[]>();
  const seenArtifactKeys = new Set<string>();

  // =========================================================================
  // 第一遍：收主 session 所有 tool_result 的 tool_use_id（完成訊號）
  // 對應 Python: tool_result_ids = set()（第 348-360 行）
  // =========================================================================
  const toolResultIds = new Set<string>();
  for (const item of mainRecords) {
    const rec = item.record;
    if (!rec) continue;
    const msg = rec['message'];
    const content = msg && typeof msg === 'object' ? (msg as Record<string, unknown>)['content'] : null;
    if (Array.isArray(content)) {
      for (const b of content) {
        if (typeof b === 'object' && b !== null) {
          const block = b as Record<string, unknown>;
          if (block['type'] === 'tool_result') {
            const tid = block['tool_use_id'];
            if (typeof tid === 'string' && tid) toolResultIds.add(tid);
          }
        }
      }
    }
  }

  // =========================================================================
  // 第二遍：建 rows
  // =========================================================================
  for (const item of mainRecords) {
    const record = item.record;
    const timestamp = getTimestamp(record);
    if (!record || !timestamp) continue;

    const msg = record['message'];
    const msgObj = msg && typeof msg === 'object' ? (msg as Record<string, unknown>) : {};
    const rawContent = msgObj['content'];
    const content: unknown[] = Array.isArray(rawContent) ? rawContent : [];

    // has_tool_result：content 是否含 type=tool_result block
    const hasToolResult = content.some(
      (b) => typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'tool_result',
    );
    const rtype = record['type'];

    // ------------------------------------------------------------------
    // 真實 user 訊息（非 meta、非 tool_result）→ round 邊界
    // 對應 Python line 373-388
    // ------------------------------------------------------------------
    if (rtype === 'user' && !record['isMeta'] && !hasToolResult) {
      lastReadyAt = timestamp;
      roundNo += 1;
      rows.push({
        kind: 'main-user',
        started_at: timestamp,
        ended_at: timestamp,
        duration_ms: null,
        title: '使用者訊息',
        detail: [record['entrypoint'], record['gitBranch']].filter(Boolean).join(' · '),
        source: 'main',
        round: roundNo,
        input_prompt: userTextOf(record),
      });
      continue;
    }

    // tool_result user → 更新 lastReadyAt，不產生 row
    // 對應 Python line 389-391
    if (rtype === 'user' && hasToolResult) {
      lastReadyAt = timestamp;
      continue;
    }

    // 非 assistant 的其他 record 跳過（中繼記錄等）
    // 對應 Python line 393-394
    if (rtype !== 'assistant') continue;

    // ------------------------------------------------------------------
    // §2.14d D31：先收本 assistant turn 的 Edit/Write artifacts（不論本 record
    //   走 ask/dispatch/other/main-ai 哪個分支，Edit/Write tool_use 都在此 content 內）。
    //   按 roundNo 累積；tool_use_id+hunk 去重；收尾回填到該 round 的 main 列。
    // ------------------------------------------------------------------
    for (const art of collectEditArtifactsForRecord(mainRecords, content, item.index)) {
      const dedupeKey = `${art.tool_use_id}|${art.hunk_index}`;
      if (seenArtifactKeys.has(dedupeKey)) continue;
      seenArtifactKeys.add(dedupeKey);
      const bucket = roundArtifacts.get(roundNo);
      if (bucket) bucket.push(art);
      else roundArtifacts.set(roundNo, [art]);
    }

    // ------------------------------------------------------------------
    // assistant：分類 tool_use
    // ------------------------------------------------------------------
    const agentTools = content.filter(
      (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as Record<string, unknown>)['type'] === 'tool_use' &&
        ((b as Record<string, unknown>)['name'] === 'Agent' || (b as Record<string, unknown>)['name'] === 'Task'),
    ) as Array<Record<string, unknown>>;

    const askTools = content.filter(
      (b) =>
        typeof b === 'object' &&
        b !== null &&
        (b as Record<string, unknown>)['type'] === 'tool_use' &&
        (b as Record<string, unknown>)['name'] === 'AskUserQuestion',
    ) as Array<Record<string, unknown>>;

    // ------------------------------------------------------------------
    // ask 分支（對應 Python line 399-424）
    // ------------------------------------------------------------------
    if (askTools.length > 0) {
      let splitAfter = false;

      for (const tool of askTools) {
        const inp = tool['input'] && typeof tool['input'] === 'object' ? (tool['input'] as Record<string, unknown>) : {};
        const questions = Array.isArray(inp['questions']) ? (inp['questions'] as unknown[]) : [];
        const question = questions.length > 0 && typeof questions[0] === 'object' && questions[0] !== null
          ? (questions[0] as Record<string, unknown>)
          : {};
        const toolId = typeof tool['id'] === 'string' ? tool['id'] : '';
        const answeredAt = findToolResultTimestamp(mainRecords, toolId, item.index);
        const askWaitMs = answeredAt ? dateDiffMs(timestamp, answeredAt) : null;

        if (askWaitMs !== null && askWaitMs > ASK_WAIT_SPLIT_MS) {
          splitAfter = true;
        }

        rows.push({
          kind: 'ask',
          started_at: timestamp,
          ended_at: answeredAt,
          answered_at: answeredAt,
          duration_ms: askWaitMs,
          split_round: askWaitMs !== null && askWaitMs > ASK_WAIT_SPLIT_MS,
          title: `Ask：${(question['header'] as string) || (question['question'] as string) || '使用者確認'}`,
          detail: `${questions.length || 1} 個問題 · ${answeredAt ? '已回答' : '尚未看到回答'} · ${toolId}`,
          source: 'main',
          tool_use_id: toolId,
          token_usage: usageToTokenStats(msgObj['usage'], String(msgObj['model'] || '')),
        } as WorkRow);
      }

      if (splitAfter) {
        roundNo += 1;
      }
      continue;
    }

    // ------------------------------------------------------------------
    // Agent/Task dispatch 分支（對應 Python line 426-498）
    // ------------------------------------------------------------------
    if (agentTools.length > 0) {
      const requestId = typeof record['requestId'] === 'string' ? record['requestId'] : '';

      let dispatchTokenUsage: TokenStats;
      if (requestId && usedDispatchUsageRequestIds.has(requestId)) {
        dispatchTokenUsage = emptyTokenUsage();
      } else {
        dispatchTokenUsage = usageToTokenStats(msgObj['usage'], String(msgObj['model'] || ''));
      }
      if (requestId) usedDispatchUsageRequestIds.add(requestId);

      const calls: DispatchCall[] = [];
      for (const tool of agentTools) {
        const inp = tool['input'] && typeof tool['input'] === 'object' ? (tool['input'] as Record<string, unknown>) : {};
        calls.push({
          timestamp,
          tool_use_id: typeof tool['id'] === 'string' ? tool['id'] : '',
          description: typeof inp['description'] === 'string' ? inp['description'] : '',
          agent_type: typeof inp['subagent_type'] === 'string' ? inp['subagent_type'] : (typeof inp['agentType'] === 'string' ? inp['agentType'] : ''),
          model: typeof inp['model'] === 'string' ? inp['model'] : '',
        });
      }

      rows.push({
        kind: 'main-dispatch',
        started_at: lastReadyAt ?? timestamp,
        ended_at: timestamp,
        called_at: timestamp,
        duration_ms: lastReadyAt ? dateDiffMs(lastReadyAt, timestamp) : null,
        title:
          calls.length === 1
            ? `呼叫 Sub-agent：${calls[0].description || '未命名任務'}`
            : `呼叫 ${calls.length} 個 Sub-agent`,
        detail: calls
          .map((c) => [c.agent_type, c.description, c.tool_use_id].filter(Boolean).join(' · '))
          .join(' | '),
        source: 'main',
        tool_use_id: calls.map((c) => c.tool_use_id).filter(Boolean).join(','),
        request_id: requestId,
        round: roundNo,
        token_usage: dispatchTokenUsage,
      } as WorkRow);

      for (const call of calls) {
        const subagent = matchSubagent(call, subagents, usedSubagents);
        if (subagent?.source) usedSubagents.add(subagent.source);

        const agentName =
          (subagent?.agent_title) ||
          (subagent?.agent_declared_name) ||
          (subagent?.agent_display_name) ||
          (subagent?.attribution_agent) ||
          (subagent?.agent_type) ||
          call.agent_type ||
          '';

        rows.push({
          kind: 'subagent',
          started_at: subagent?.started_at ?? timestamp,
          ended_at: subagent?.ended_at ?? null,
          called_at: timestamp,
          duration_ms: subagent?.duration_ms ?? null,
          agent_type: subagent?.agent_type || call.agent_type || '',
          agent_name: agentName,
          agent_declared_name: subagent?.agent_declared_name || '',
          agent_display_name: subagent?.agent_display_name || '',
          agent_title: subagent?.agent_title || '',
          agent_path: subagent?.agent_path || '',
          agent_id: subagent?.agent_id || '',
          attribution_skill: subagent?.attribution_skill || '',
          model: subagent?.model || '',
          token_usage: subagent?.token_usage || emptyTokenUsage(),
          title: `Sub-agent：${call.description || (subagent?.description) || '未命名任務'}`,
          detail: [subagent?.agent_type || call.agent_type, subagent?.source].filter(Boolean).join(' · '),
          source: subagent?.source || 'main',
          tool_use_id: subagent?.tool_use_id || call.tool_use_id,
          last_output: subagent?.last_assistant_output || '',
          input_prompt: subagent?.first_user_input || '',
        } as WorkRow);
      }

      lastReadyAt = null;
      continue;
    }

    // ------------------------------------------------------------------
    // 其他 tool_use（非 Agent/Task/AskUserQuestion）→ 跳過
    // 對應 Python line 501-505
    // ------------------------------------------------------------------
    const hasOtherToolUse = content.some(
      (b) => typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'tool_use',
    );
    if (hasOtherToolUse) continue;
    if (msgObj['stop_reason'] === 'tool_use') continue;

    // ------------------------------------------------------------------
    // main-ai row（對應 Python line 507-525）
    // ------------------------------------------------------------------
    rows.push({
      kind: 'main-ai',
      started_at: lastReadyAt ?? timestamp,
      ended_at: timestamp,
      duration_ms: lastReadyAt ? dateDiffMs(lastReadyAt, timestamp) : null,
      title: 'Claude 回合',
      stop: (msgObj['stop_reason'] as string | null) ?? null,
      detail: msgObj['stop_reason']
        ? `stop: ${msgObj['stop_reason']}`
        : (typeof record['requestId'] === 'string' ? record['requestId'] : ''),
      source: 'main',
      request_id: typeof record['requestId'] === 'string' ? record['requestId'] : '',
      round: roundNo,
      token_usage: usageToTokenStats(msgObj['usage'], String(msgObj['model'] || '')),
      last_output: assistantTextOf(record),
    } as WorkRow);

    lastReadyAt = null;
  }

  // =========================================================================
  // orphan subagents（對應 Python line 527-562）
  // =========================================================================
  for (const subagent of subagents) {
    if (subagent.source && usedSubagents.has(subagent.source)) continue;

    const agentName =
      subagent.agent_title ||
      subagent.agent_declared_name ||
      subagent.agent_display_name ||
      subagent.attribution_agent ||
      subagent.agent_type ||
      '';

    rows.push({
      kind: 'subagent',
      started_at: subagent.started_at ?? null,
      ended_at: subagent.ended_at ?? null,
      called_at: subagent.started_at ?? null,
      duration_ms: subagent.duration_ms ?? null,
      agent_type: subagent.agent_type || '',
      agent_name: agentName,
      agent_declared_name: subagent.agent_declared_name || '',
      agent_display_name: subagent.agent_display_name || '',
      agent_title: subagent.agent_title || '',
      agent_path: subagent.agent_path || '',
      agent_id: subagent.agent_id || '',
      attribution_skill: subagent.attribution_skill || '',
      model: subagent.model || '',
      token_usage: subagent.token_usage || emptyTokenUsage(),
      title: `Sub-agent：${subagent.description || '未對應主呼叫'}`,
      detail: [subagent.agent_type, subagent.source].filter(Boolean).join(' · '),
      source: subagent.source,
      tool_use_id: subagent.tool_use_id || '',
      input_prompt: subagent.first_user_input || '',
    } as WorkRow);
  }

  // =========================================================================
  // 完成訊號：執行中的 subagent（toolUseId 不在 toolResultIds）→ ended_at = null
  // 對應 Python line 564-570
  // =========================================================================
  for (const row of rows) {
    if (row.kind === 'subagent') {
      const tid = (row.tool_use_id || '').trim();
      if (tid && !toolResultIds.has(tid)) {
        row.ended_at = null;
      }
    }
  }

  // =========================================================================
  // last_output 回填（對應 Python line 572-588）
  // 同一 request_id 內最後一筆非空 last_output → 回寫到該 request_id 的每筆 main-ai row
  // =========================================================================
  const lastOutByReq = new Map<string, string>();
  for (const row of rows) {
    if (row.kind === 'main-ai') {
      const req = (row as WorkRow & { request_id?: string }).request_id || '';
      const text = (row.last_output || '').trim();
      if (req && text) lastOutByReq.set(req, row.last_output as string);
    }
  }
  for (const row of rows) {
    if (row.kind === 'main-ai') {
      const req = (row as WorkRow & { request_id?: string }).request_id || '';
      if (req && lastOutByReq.has(req)) {
        row.last_output = lastOutByReq.get(req);
      }
    }
  }

  // =========================================================================
  // §2.14d D31：per-round Edit/Write artifacts 回填。
  //   把該 round 累積的 artifacts 掛到該 round **第一筆** main-ai/main-dispatch row 的
  //   `edit_artifacts`。掛第一筆是為避免 collapseMainAiRows 把帶 artifacts 的後續同 reqId
  //   row 併走丟欄（collapse 只保留首列、把後列併入首列）→ 首列恆存活，artifacts 不漏。
  //   punchCore 依 round 分桶時掃該桶各 row 的 edit_artifacts 聚合（每 round 僅首列帶值，
  //   天然去重）。subagent 自己的 Edit/Write 走其獨立 transcript 的 buildWorkTimeline，
  //   surfacing 在 subagent timeline（本批不另繞）。
  // =========================================================================
  const roundFirstMain = new Map<number, WorkRow>();
  for (const row of rows) {
    if (row.kind === 'main-ai' || row.kind === 'main-dispatch') {
      const rnd = (row as WorkRow & { round?: number }).round;
      if (typeof rnd === 'number' && !roundFirstMain.has(rnd)) {
        roundFirstMain.set(rnd, row);
      }
    }
  }
  for (const [rnd, arts] of roundArtifacts) {
    if (arts.length === 0) continue;
    const target = roundFirstMain.get(rnd);
    if (target) {
      (target as WorkRow & { edit_artifacts?: WorkArtifact[] }).edit_artifacts = arts;
    }
  }

  // =========================================================================
  // collapse + 過濾 + 排序（對應 Python line 590-593）
  // =========================================================================
  let collapsed = collapseMainAiRows(rows);
  collapsed = collapsed.filter((r) => r.started_at != null);
  collapsed.sort((a, b) => {
    const aMs = toEpochMs((a as Record<string, unknown>)['called_at'] ?? a.started_at) ?? 0;
    const bMs = toEpochMs((b as Record<string, unknown>)['called_at'] ?? b.started_at) ?? 0;
    return aMs - bMs;
  });

  return collapsed;
}
