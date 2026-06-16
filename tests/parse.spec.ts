/**
 * parse.spec.ts — build_work_timeline 行為回歸測試。
 *
 * 1:1 對應 Python:
 *   tests/test_parse_patterns.py（14 case：T1×2 / T2×2 / T3×2 / T4×3 / T5×2 / T6×3）
 *   tests/test_parse_ask_split.py（Case 1~4，Case 5 端到端用到 _punch_core → 標 TODO 跳過）
 *
 * Oracle 等價佐證：fixture 輸入/期望值與 Python 測試完全相同，同樣的輸入若 TS 輸出不同
 * 即表示移植有偏差。
 */

import { describe, it, expect } from 'vitest';
import { buildWorkTimeline, ASK_WAIT_SPLIT_MS } from '../src/main/worktime/claude/parse';
import type { JsonlItem, SubagentInfo } from '../src/main/worktime/types';

// ---------------------------------------------------------------------------
// Fixture helpers（對應 Python test_parse_patterns.py 的 helper 函式）
// ---------------------------------------------------------------------------

/** 組 build_work_timeline 接受的 item 格式：{index, record} */
function _rec(index: number, record: Record<string, unknown>): JsonlItem {
  return { index, record, error: null };
}

/** 真實使用者訊息（type=user, 非 meta, 非 tool_result）*/
function _realUser(ts: string, text: string, promptSource?: string): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    type: 'user',
    timestamp: ts,
    message: {
      content: [{ type: 'text', text }],
    },
  };
  if (promptSource !== undefined) rec['promptSource'] = promptSource;
  return rec;
}

/** isMeta=True 的 user record（系統/技能注入）；可帶 timestamp 或不帶。*/
function _metaUser(ts?: string): Record<string, unknown> {
  const rec: Record<string, unknown> = {
    type: 'user',
    isMeta: true,
    message: {
      content: [{ type: 'text', text: '你是 xxx agent…' }],
    },
  };
  if (ts !== undefined) rec['timestamp'] = ts;
  return rec;
}

/** 帶 tool_result block 的 user record（工具回傳，不是使用者輸入）。*/
function _toolResultUser(ts: string, toolId: string): Record<string, unknown> {
  return {
    type: 'user',
    timestamp: ts,
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolId,
          content: 'ok',
        },
      ],
    },
  };
}

/** 純文字 assistant record（無 tool_use）。*/
function _assistantText(ts: string, req: string, text: string, stop = 'end_turn'): Record<string, unknown> {
  return {
    type: 'assistant',
    timestamp: ts,
    requestId: req,
    message: {
      content: [{ type: 'text', text }],
      stop_reason: stop,
      usage: {},
      model: 'claude-sonnet',
    },
  };
}

/** 帶 AskUserQuestion tool_use 的 assistant record。*/
function _assistantAsk(ts: string, toolId: string): Record<string, unknown> {
  return {
    type: 'assistant',
    timestamp: ts,
    requestId: `req-ask-${toolId}`,
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolId,
          name: 'AskUserQuestion',
          input: {
            questions: [{ header: '確認', question: '繼續嗎？' }],
          },
        },
      ],
      stop_reason: 'tool_use',
      usage: {},
      model: 'claude-sonnet',
    },
  };
}

/** 帶 Agent tool_use 的 assistant record（dispatch subagent）。*/
function _assistantDispatch(ts: string, toolId: string, desc = '子任務'): Record<string, unknown> {
  return {
    type: 'assistant',
    timestamp: ts,
    requestId: `req-dispatch-${toolId}`,
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolId,
          name: 'Agent',
          input: {
            description: desc,
            subagent_type: 'worker',
          },
        },
      ],
      stop_reason: 'tool_use',
      usage: {},
      model: 'claude-sonnet',
    },
  };
}

/** 中繼記錄（通常無 timestamp）；rtype 為 mode/permission-mode/ai-title/... 等。*/
function _relayRecord(rtype: string, ts?: string): Record<string, unknown> {
  const rec: Record<string, unknown> = { type: rtype };
  if (ts !== undefined) rec['timestamp'] = ts;
  return rec;
}

/** 取 rows 中各 kind 出現次數。*/
function _counts(rows: ReturnType<typeof buildWorkTimeline>): Record<string, number> {
  const c: Record<string, number> = {};
  for (const r of rows) {
    c[r.kind] = (c[r.kind] ?? 0) + 1;
  }
  return c;
}

/** 取 rows 中特定 kind 的 round 值清單（依序）。*/
function _roundsOf(rows: ReturnType<typeof buildWorkTimeline>, kind: string): number[] {
  return rows
    .filter((r) => r.kind === kind && r.round !== undefined)
    .map((r) => r.round as number);
}

/** ask test 用：取 main-ai 的 round 清單。*/
function _roundsOfMainAi(rows: ReturnType<typeof buildWorkTimeline>): number[] {
  return _roundsOf(rows, 'main-ai');
}

// ===========================================================================
// T1 — tool_result(type=user) 不切輪、不產生 main-user row
// ===========================================================================

describe('T1 — tool_result user 不切輪', () => {
  it('T1a: tool_result user 不遞增 round_no，也不產生 main-user row', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '請幫我做 X')),
      _rec(1, _assistantText('2026-06-03T10:00:05.000Z', 'reqA', '好的')),
      _rec(2, _toolResultUser('2026-06-03T10:00:10.000Z', 'tool_aaa')),
      _rec(3, _toolResultUser('2026-06-03T10:00:11.000Z', 'tool_bbb')),
      _rec(4, _toolResultUser('2026-06-03T10:00:12.000Z', 'tool_ccc')),
      _rec(5, _assistantText('2026-06-03T10:00:20.000Z', 'reqB', '完成')),
    ];
    const rows = buildWorkTimeline(records, []);

    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    const mainAiRows = rows.filter((r) => r.kind === 'main-ai');

    expect(mainUserRows.length).toBe(1);
    expect(mainAiRows.every((r) => r.round === 1)).toBe(true);
    expect(mainUserRows.length).toBe(1); // round boundary 只遞增 1 次
  });

  it('T1b: 21 筆 tool_result user + 1 筆真 user → 只有 1 輪', () => {
    const TOOL_IDS = Array.from({ length: 21 }, (_, i) => `tool_${String(i).padStart(3, '0')}`);
    const records: JsonlItem[] = [_rec(0, _realUser('2026-06-03T10:00:00.000Z', '開始'))];
    for (let i = 0; i < TOOL_IDS.length; i++) {
      const tid = TOOL_IDS[i];
      const idx = i + 1;
      const mm = String(Math.floor(idx / 60)).padStart(2, '0');
      const ss = String(idx % 60).padStart(2, '0');
      records.push(_rec(idx, _toolResultUser(`2026-06-03T10:${mm}:${ss}.000Z`, tid)));
    }
    records.push(_rec(TOOL_IDS.length + 1, _assistantText('2026-06-03T10:30:00.000Z', 'reqFinal', '完成')));

    const rows = buildWorkTimeline(records, []);
    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    expect(mainUserRows.length).toBe(1);
  });
});

// ===========================================================================
// T2 — 無 timestamp 中繼記錄跳過
// ===========================================================================

describe('T2 — 中繼記錄跳過', () => {
  it('T2a: mode/permission-mode/ai-title/custom-title/last-prompt/file-history-snapshot/attachment 不產生 row', () => {
    const relayTypes = [
      'mode',
      'permission-mode',
      'ai-title',
      'custom-title',
      'last-prompt',
      'file-history-snapshot',
      'attachment',
    ];
    const records: JsonlItem[] = [_rec(0, _realUser('2026-06-03T10:00:00.000Z', '開始'))];
    for (let i = 0; i < relayTypes.length; i++) {
      records.push(_rec(i + 1, _relayRecord(relayTypes[i]))); // 無 timestamp
    }
    records.push(
      _rec(relayTypes.length + 1, _assistantText('2026-06-03T10:00:30.000Z', 'reqA', '回應')),
    );

    const rows = buildWorkTimeline(records, []);

    const kinds = new Set(rows.map((r) => r.kind));
    const unexpected = [...kinds].filter((k) => k !== 'main-user' && k !== 'main-ai');
    expect(unexpected).toHaveLength(0);

    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    expect(mainUserRows.length).toBe(1);

    const mainAiRows = rows.filter((r) => r.kind === 'main-ai');
    expect(mainAiRows.every((r) => r.round === 1)).toBe(true);
  });

  it('T2b: 帶 timestamp 的 mode 記錄（罕見）仍被跳過', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '開始')),
      _rec(1, _relayRecord('mode', '2026-06-03T10:00:05.000Z')), // 帶 timestamp
      _rec(2, _assistantText('2026-06-03T10:00:10.000Z', 'reqA', '回應')),
    ];
    const rows = buildWorkTimeline(records, []);
    const kinds = new Set(rows.map((r) => r.kind));
    expect(kinds.has('mode' as never)).toBe(false);
    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    expect(mainUserRows.length).toBe(1);
  });
});

// ===========================================================================
// T3 — resume 區塊不干擾
// ===========================================================================

describe('T3 — resume 區塊不干擾', () => {
  it('T3a: custom-title→ai-title→mode→permission-mode 夾在兩個 user 間，不切輪', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '第一輪訊息')),
      _rec(1, _assistantText('2026-06-03T10:00:10.000Z', 'reqA', '第一輪回應')),
      _rec(2, _relayRecord('custom-title')),
      _rec(3, _relayRecord('ai-title')),
      _rec(4, _relayRecord('mode')),
      _rec(5, _relayRecord('permission-mode')),
      _rec(6, _realUser('2026-06-03T10:01:00.000Z', '第二輪訊息')),
      _rec(7, _assistantText('2026-06-03T10:01:10.000Z', 'reqB', '第二輪回應')),
    ];
    const rows = buildWorkTimeline(records, []);

    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    const mainAiRounds = _roundsOf(rows, 'main-ai');

    expect(mainUserRows.length).toBe(2);
    expect(mainAiRounds).toEqual([1, 2]);

    const kinds = new Set(rows.map((r) => r.kind));
    const unexpected = [...kinds].filter((k) => k !== 'main-user' && k !== 'main-ai');
    expect(unexpected).toHaveLength(0);
  });

  it('T3b: 兩個 resume 群分別夾在三個真 user 訊息之間，round 應只遞增 3 次', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '輪1')),
      _rec(1, _assistantText('2026-06-03T10:00:05.000Z', 'reqA', '回1')),
      _rec(2, _relayRecord('custom-title')),
      _rec(3, _relayRecord('mode')),
      _rec(4, _realUser('2026-06-03T10:01:00.000Z', '輪2')),
      _rec(5, _assistantText('2026-06-03T10:01:05.000Z', 'reqB', '回2')),
      _rec(6, _relayRecord('ai-title')),
      _rec(7, _relayRecord('permission-mode')),
      _rec(8, _realUser('2026-06-03T10:02:00.000Z', '輪3')),
      _rec(9, _assistantText('2026-06-03T10:02:05.000Z', 'reqC', '回3')),
    ];
    const rows = buildWorkTimeline(records, []);
    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    const mainAiRounds = _roundsOf(rows, 'main-ai');

    expect(mainUserRows.length).toBe(3);
    expect(mainAiRounds).toEqual([1, 2, 3]);
  });
});

// ===========================================================================
// T4 — 多輪 user[text] 正確遞增 round
// ===========================================================================

describe('T4 — 多輪 user 訊息', () => {
  it('T4a: 三個真 user 訊息 → round_no 從 1 遞增到 3，各輪 main-ai 帶正確的 round', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '輪1')),
      _rec(1, _assistantText('2026-06-03T10:00:10.000Z', 'reqA', '回1')),
      _rec(2, _realUser('2026-06-03T10:01:00.000Z', '輪2')),
      _rec(3, _assistantText('2026-06-03T10:01:10.000Z', 'reqB', '回2')),
      _rec(4, _realUser('2026-06-03T10:02:00.000Z', '輪3')),
      _rec(5, _assistantText('2026-06-03T10:02:10.000Z', 'reqC', '回3')),
    ];
    const rows = buildWorkTimeline(records, []);

    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    const mainAiRounds = _roundsOf(rows, 'main-ai');

    expect(mainUserRows.length).toBe(3);
    expect(mainAiRounds).toEqual([1, 2, 3]);
  });

  it('T4b: 第一個真 user 訊息後，round_no 應從 0 → 1（非 0）', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '輪1')),
      _rec(1, _assistantText('2026-06-03T10:00:10.000Z', 'reqA', '回1')),
    ];
    const rows = buildWorkTimeline(records, []);
    const mainAiRounds = _roundsOf(rows, 'main-ai');
    expect(mainAiRounds).toEqual([1]);
  });

  it('T4c: tool_result user records 夾在兩輪真 user 訊息間 → round_no 仍只因真 user 訊息遞增', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '輪1')),
      _rec(1, _assistantText('2026-06-03T10:00:05.000Z', 'reqA', '中間')),
      _rec(2, _toolResultUser('2026-06-03T10:00:10.000Z', 'tid_x')),
      _rec(3, _toolResultUser('2026-06-03T10:00:11.000Z', 'tid_y')),
      _rec(4, _realUser('2026-06-03T10:01:00.000Z', '輪2')),
      _rec(5, _assistantText('2026-06-03T10:01:10.000Z', 'reqB', '回2')),
    ];
    const rows = buildWorkTimeline(records, []);
    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    const mainAiRounds = _roundsOf(rows, 'main-ai');

    expect(mainUserRows.length).toBe(2);
    expect(mainAiRounds).toEqual([1, 2]);
  });
});

// ===========================================================================
// T5 — dispatch(Agent)+ask 混合
// ===========================================================================

describe('T5 — dispatch(Agent)+ask 混合', () => {
  it('T5a: 一輪內 dispatch(Agent) 後又 ask — ask 事件正常產生，Agent dispatch 不誤切輪', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '做任務')),
      _rec(1, _assistantDispatch('2026-06-03T10:00:05.000Z', 'dispatch_001', '子任務A')),
      _rec(2, _toolResultUser('2026-06-03T10:00:20.000Z', 'dispatch_001')),
      _rec(3, _assistantAsk('2026-06-03T10:00:25.000Z', 'ask_001')),
      _rec(4, _toolResultUser('2026-06-03T10:00:30.000Z', 'ask_001')), // +5s
      _rec(5, _assistantText('2026-06-03T10:00:35.000Z', 'reqFinal', '完成', 'end_turn')),
    ];
    const rows = buildWorkTimeline(records, []);

    const dispatchRows = rows.filter((r) => r.kind === 'main-dispatch');
    const askRows = rows.filter((r) => r.kind === 'ask');
    const mainAiRows = rows.filter((r) => r.kind === 'main-ai');
    const mainUserRows = rows.filter((r) => r.kind === 'main-user');

    expect(dispatchRows.length).toBeGreaterThanOrEqual(1);
    expect(askRows.length).toBe(1);
    expect(askRows[0].split_round).toBe(false); // 5s < 30s

    const endTurnRows = mainAiRows.filter((r) => r.stop === 'end_turn');
    expect(endTurnRows.length).toBeGreaterThan(0);
    expect(endTurnRows.every((r) => r.round === 1)).toBe(true);

    expect(mainUserRows.length).toBe(1);
  });

  it('T5b: dispatch(Agent) + ask（等待 > 30s）→ ask 後切輪，end_turn 在新輪', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '做任務')),
      _rec(1, _assistantDispatch('2026-06-03T10:00:05.000Z', 'dispatch_002', '子任務B')),
      _rec(2, _toolResultUser('2026-06-03T10:00:20.000Z', 'dispatch_002')),
      _rec(3, _assistantAsk('2026-06-03T10:00:25.000Z', 'ask_002')),
      _rec(4, _toolResultUser('2026-06-03T10:01:05.000Z', 'ask_002')), // +40s
      _rec(5, _assistantText('2026-06-03T10:01:10.000Z', 'reqFinal', '完成', 'end_turn')),
    ];
    const rows = buildWorkTimeline(records, []);

    const askRows = rows.filter((r) => r.kind === 'ask');
    expect(askRows.length).toBe(1);
    expect(askRows[0].split_round).toBe(true);

    const mainAiRows = rows.filter((r) => r.kind === 'main-ai');
    const endTurnRows = mainAiRows.filter((r) => r.stop === 'end_turn');
    expect(endTurnRows.length).toBeGreaterThan(0);
    for (const r of endTurnRows) {
      expect((r.round ?? 0) > 1).toBe(true);
    }
  });
});

// ===========================================================================
// T6 — promptSource 文件化 pattern
// ===========================================================================

describe('T6 — promptSource 非必要欄位', () => {
  it('T6a: 真實 user 訊息帶 promptSource="typed" 仍正確計入一輪', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '打字輸入', 'typed')),
      _rec(1, _assistantText('2026-06-03T10:00:10.000Z', 'reqA', '回應')),
    ];
    const rows = buildWorkTimeline(records, []);
    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    expect(mainUserRows.length).toBe(1);
  });

  it('T6b: 真實 user 訊息沒有 promptSource 欄位，仍正確計入一輪', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '沒有 promptSource 的輸入')),
      _rec(1, _assistantText('2026-06-03T10:00:10.000Z', 'reqA', '回應')),
    ];
    const rows = buildWorkTimeline(records, []);
    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    expect(mainUserRows.length).toBe(1);
  });

  it('T6c: 混合有/無 promptSource 的真 user 訊息 — 都計入 round，總數正確', () => {
    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '輪1，有 promptSource', 'typed')),
      _rec(1, _assistantText('2026-06-03T10:00:10.000Z', 'reqA', '回1')),
      _rec(2, _realUser('2026-06-03T10:01:00.000Z', '輪2，無 promptSource')),
      _rec(3, _assistantText('2026-06-03T10:01:10.000Z', 'reqB', '回2')),
      _rec(4, _realUser('2026-06-03T10:02:00.000Z', '輪3，有 promptSource', 'typed')),
      _rec(5, _assistantText('2026-06-03T10:02:10.000Z', 'reqC', '回3')),
    ];
    const rows = buildWorkTimeline(records, []);
    const mainUserRows = rows.filter((r) => r.kind === 'main-user');
    const mainAiRounds = _roundsOf(rows, 'main-ai');

    expect(mainUserRows.length).toBe(3);
    expect(mainAiRounds).toEqual([1, 2, 3]);
  });
});

// ===========================================================================
// Ask split cases（對應 test_parse_ask_split.py Case 1~4）
// ===========================================================================

describe('Ask split — AskUserQuestion 等待切段', () => {
  it('Case 1: ask 等待 > 30s → round 切段，split_round=True，duration_ms=35000', () => {
    const records = [
      _rec(0, _realUser('2026-06-01T10:00:00.000Z', '開始')),
      _rec(1, _assistantText('2026-06-01T10:00:05.000Z', 'reqA', 'before')),
      _rec(2, _assistantAsk('2026-06-01T10:00:10.000Z', 'tool1')),
      _rec(3, _toolResultUser('2026-06-01T10:00:45.000Z', 'tool1')),
      _rec(4, _assistantText('2026-06-01T10:00:50.000Z', 'reqB', 'after')),
    ];
    const rows = buildWorkTimeline(records, []);
    const rounds = _roundsOfMainAi(rows);
    expect(rounds).toEqual([1, 2]);

    const askRows = rows.filter((r) => r.kind === 'ask');
    expect(askRows.length).toBe(1);
    expect(askRows[0].split_round).toBe(true);
    expect(askRows[0].duration_ms).toBe(35000);
  });

  it('Case 2: ask 等待 ≤ 30s → 不切段，before/after 同一輪', () => {
    const records = [
      _rec(0, _realUser('2026-06-01T10:00:00.000Z', '開始')),
      _rec(1, _assistantText('2026-06-01T10:00:05.000Z', 'reqA', 'before')),
      _rec(2, _assistantAsk('2026-06-01T10:00:10.000Z', 'tool1')),
      _rec(3, _toolResultUser('2026-06-01T10:00:23.000Z', 'tool1')),
      _rec(4, _assistantText('2026-06-01T10:00:28.000Z', 'reqB', 'after')),
    ];
    const rows = buildWorkTimeline(records, []);
    const rounds = _roundsOfMainAi(rows);
    expect(rounds).toEqual([1, 1]);

    const askRows = rows.filter((r) => r.kind === 'ask');
    expect(askRows.length).toBe(1);
    expect(askRows[0].split_round).toBe(false);
    expect(askRows[0].duration_ms).toBe(13000);
  });

  it('Case 3: ask 未回答 → answered_at=null，duration_ms=null，split_round=false', () => {
    const records = [
      _rec(0, _realUser('2026-06-01T10:00:00.000Z', '開始')),
      _rec(1, _assistantText('2026-06-01T10:00:05.000Z', 'reqA', 'before')),
      _rec(2, _assistantAsk('2026-06-01T10:00:10.000Z', 'tool_no_answer')),
    ];
    const rows = buildWorkTimeline(records, []);

    const askRows = rows.filter((r) => r.kind === 'ask');
    expect(askRows.length).toBe(1);
    expect(askRows[0].answered_at).toBeNull();
    expect(askRows[0].duration_ms).toBeNull();
    expect(askRows[0].split_round).toBe(false);

    const rounds = _roundsOfMainAi(rows);
    expect(rounds).toEqual([1]);
  });

  it('Case 4: 同一輪內兩個 ask，第一個切（+40s），第二個不切（+10s）', () => {
    const records = [
      _rec(0, _realUser('2026-06-01T10:00:00.000Z', '開始')),
      _rec(1, _assistantText('2026-06-01T10:00:05.000Z', 'reqA', 'a')),
      _rec(2, _assistantAsk('2026-06-01T10:00:10.000Z', 'ask_tool1')),
      _rec(3, _toolResultUser('2026-06-01T10:00:50.000Z', 'ask_tool1')), // +40s
      _rec(4, _assistantText('2026-06-01T10:01:00.000Z', 'reqB', 'b')),
      _rec(5, _assistantAsk('2026-06-01T10:01:05.000Z', 'ask_tool2')),
      _rec(6, _toolResultUser('2026-06-01T10:01:15.000Z', 'ask_tool2')), // +10s
      _rec(7, _assistantText('2026-06-01T10:01:20.000Z', 'reqC', 'c')),
    ];
    const rows = buildWorkTimeline(records, []);
    const rounds = _roundsOfMainAi(rows);
    expect(rounds).toEqual([1, 2, 2]);

    const askRows = rows.filter((r) => r.kind === 'ask');
    expect(askRows.length).toBe(2);
    expect(askRows[0].split_round).toBe(true);
    expect(askRows[1].split_round).toBe(false);
  });

  // Case 5 端到端（collect_punch_events_core）依賴 _punch_core → TODO 留到下一刀
});

// ===========================================================================
// 完成訊號測試（subagent ended_at 清除）
// ===========================================================================

describe('完成訊號 — subagent ended_at 清除', () => {
  it('toolUseId 不在主 session tool_result 集合的 subagent → ended_at=null', () => {
    // 主 session 有 tool_result for dispatch_A，但沒有 dispatch_B
    const subagents: SubagentInfo[] = [
      {
        source: 'agent-A.jsonl',
        started_at: '2026-06-03T10:00:10.000Z',
        ended_at: '2026-06-03T10:00:30.000Z',
        duration_ms: 20000,
        tool_use_id: 'dispatch_A',
      },
      {
        source: 'agent-B.jsonl',
        started_at: '2026-06-03T10:00:15.000Z',
        ended_at: '2026-06-03T10:00:40.000Z',
        duration_ms: 25000,
        tool_use_id: 'dispatch_B', // B 沒有 tool_result → 執行中
      },
    ];

    const records = [
      _rec(0, _realUser('2026-06-03T10:00:00.000Z', '開始')),
      // dispatch_A 和 dispatch_B
      _rec(1, {
        type: 'assistant',
        timestamp: '2026-06-03T10:00:05.000Z',
        requestId: 'req1',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'dispatch_A',
              name: 'Agent',
              input: { description: '任務A', subagent_type: 'worker' },
            },
            {
              type: 'tool_use',
              id: 'dispatch_B',
              name: 'Agent',
              input: { description: '任務B', subagent_type: 'worker' },
            },
          ],
          stop_reason: 'tool_use',
          usage: {},
          model: 'claude-sonnet',
        },
      }),
      // 只有 dispatch_A 的 tool_result（B 還在執行）
      _rec(2, {
        type: 'user',
        timestamp: '2026-06-03T10:00:35.000Z',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'dispatch_A',
              content: 'done',
            },
          ],
        },
      }),
    ];

    const rows = buildWorkTimeline(records, subagents);
    const subagentRows = rows.filter((r) => r.kind === 'subagent');

    const rowA = subagentRows.find((r) => r.tool_use_id === 'dispatch_A');
    const rowB = subagentRows.find((r) => r.tool_use_id === 'dispatch_B');

    // A 有 tool_result → ended_at 保留
    expect(rowA).toBeDefined();
    expect(rowA?.ended_at).not.toBeNull();

    // B 沒有 tool_result → ended_at 清為 null（執行中）
    expect(rowB).toBeDefined();
    expect(rowB?.ended_at).toBeNull();
  });
});

// ===========================================================================
// ASK_WAIT_SPLIT_MS 常數確認
// ===========================================================================

it('ASK_WAIT_SPLIT_MS 應為 30000ms', () => {
  expect(ASK_WAIT_SPLIT_MS).toBe(30_000);
});

// ---------------------------------------------------------------------------
// F4 回歸測試：toEpochMs 對無時區 ISO 字串視為 UTC（對齊 Python fromisoformat 語意）
// ---------------------------------------------------------------------------

import { toEpochMs } from '../src/main/worktime/jsonl';

describe('F4 — toEpochMs 無時區 ISO 視為 UTC', () => {
  it('無時區字串與帶 Z 字串解析結果相同（UTC）', () => {
    const withZ = toEpochMs('2026-06-01T10:00:00.000Z');
    const withoutZ = toEpochMs('2026-06-01T10:00:00.000');
    expect(withZ).not.toBeNull();
    expect(withoutZ).not.toBeNull();
    expect(withoutZ).toBe(withZ);
  });

  it('帶 Z 字串不會重複加 Z（正常解析）', () => {
    const ms = toEpochMs('2026-06-01T10:00:00.000Z');
    expect(ms).not.toBeNull();
    // 2026-06-01T10:00:00.000Z UTC
    expect(ms).toBe(new Date('2026-06-01T10:00:00.000Z').getTime());
  });

  it('帶 +09:00 offset 字串正確解析', () => {
    const ms = toEpochMs('2026-06-01T19:00:00.000+09:00');
    const msZ = toEpochMs('2026-06-01T10:00:00.000Z');
    expect(ms).not.toBeNull();
    expect(ms).toBe(msZ); // UTC 等價
  });

  it('無時區無毫秒字串視為 UTC', () => {
    const withZ = toEpochMs('2026-06-01T10:00:00Z');
    const withoutZ = toEpochMs('2026-06-01T10:00:00');
    expect(withoutZ).toBe(withZ);
  });
});
