/**
 * punchCore.spec.ts — collectPunchEventsCore 端到端行為回歸測試。
 *
 * 對應 Python tests/test_parse_ask_split.py Case 5（端到端）。
 * Oracle 等價佐證：fixture 與 Python 完全相同，同樣輸入若 TS 輸出不同即移植有偏差。
 */

import { describe, it, expect } from 'vitest';
import { collectPunchEventsCore, MAIN_PUNCH_NAME } from '../src/main/worktime/punchCore';
import { buildWorkTimeline } from '../src/main/worktime/claude/parse';
import { toEpochMs } from '../src/main/worktime/jsonl';
import { unionDurationMs } from '../src/main/worktime/timestats';
import { punchNameForRow, eventKey } from '../src/main/worktime/claude/punchRules';
import type { JsonlItem } from '../src/main/worktime/types';

// ---------------------------------------------------------------------------
// Fixture helpers（對應 Python test_parse_ask_split.py）
// ---------------------------------------------------------------------------

function _rec(index: number, record: Record<string, unknown>): JsonlItem {
  return { index, record, error: null };
}

function _realUser(ts: string, text: string): Record<string, unknown> {
  return {
    type: 'user',
    timestamp: ts,
    message: { content: [{ type: 'text', text }] },
  };
}

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
          input: { questions: [{ header: '確認一下', question: '要繼續嗎？' }] },
        },
      ],
      stop_reason: 'tool_use',
      usage: {},
      model: 'claude-sonnet',
    },
  };
}

function _toolResultUser(ts: string, toolId: string): Record<string, unknown> {
  return {
    type: 'user',
    timestamp: ts,
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolId, content: '繼續' }],
    },
  };
}

// ---------------------------------------------------------------------------
// unionDurationMs 單元測試
// ---------------------------------------------------------------------------

describe('unionDurationMs', () => {
  it('空陣列回 0', () => {
    expect(unionDurationMs([])).toBe(0);
  });

  it('單一區間', () => {
    expect(
      unionDurationMs([{ started_at: '2026-06-01T10:00:00.000Z', ended_at: '2026-06-01T10:00:10.000Z' }]),
    ).toBe(10_000);
  });

  it('不重疊兩區間', () => {
    expect(
      unionDurationMs([
        { started_at: '2026-06-01T10:00:00.000Z', ended_at: '2026-06-01T10:00:10.000Z' },
        { started_at: '2026-06-01T10:00:20.000Z', ended_at: '2026-06-01T10:00:30.000Z' },
      ]),
    ).toBe(20_000);
  });

  it('重疊兩區間合併', () => {
    expect(
      unionDurationMs([
        { started_at: '2026-06-01T10:00:00.000Z', ended_at: '2026-06-01T10:00:15.000Z' },
        { started_at: '2026-06-01T10:00:10.000Z', ended_at: '2026-06-01T10:00:25.000Z' },
      ]),
    ).toBe(25_000);
  });

  it('缺 started_at / ended_at 的列略過', () => {
    expect(
      unionDurationMs([
        { started_at: '2026-06-01T10:00:00.000Z' /* no ended_at */ },
        { started_at: '2026-06-01T10:00:00.000Z', ended_at: '2026-06-01T10:00:05.000Z' },
      ]),
    ).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// punchNameForRow 單元測試
// ---------------------------------------------------------------------------

describe('punchNameForRow', () => {
  it('main-ai → "agent_manager"', () => {
    expect(punchNameForRow({ kind: 'main-ai' })).toBe('agent_manager');
  });

  it('main-dispatch → "agent_manager"', () => {
    expect(punchNameForRow({ kind: 'main-dispatch' })).toBe('agent_manager');
  });

  it('subagent 帶 agent_name → "agent_<name>"', () => {
    expect(punchNameForRow({ kind: 'subagent', agent_name: 'developer' })).toBe('agent_developer');
  });

  it('subagent 無 agent_name → fallback agent_type', () => {
    expect(punchNameForRow({ kind: 'subagent', agent_type: 'worker' })).toBe('agent_worker');
  });

  it('subagent 無 name/type → "agent_unknown"', () => {
    expect(punchNameForRow({ kind: 'subagent' })).toBe('agent_unknown');
  });

  it('main-user → null', () => {
    expect(punchNameForRow({ kind: 'main-user' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// eventKey 單元測試
// ---------------------------------------------------------------------------

describe('eventKey', () => {
  it('組合欄位順序正確', () => {
    const row = {
      kind: 'main-ai',
      source: 'src',
      request_id: 'r1',
      tool_use_id: 't1',
      started_at: '2026-06-01T10:00:00.000Z',
      agent_name: '',
    };
    expect(eventKey('s1', row)).toBe('s1|src|r1|t1|2026-06-01T10:00:00.000Z|main-ai|');
  });

  it('缺欄位用空字串', () => {
    expect(eventKey(null, {})).toBe('||||||');
  });
});

// ---------------------------------------------------------------------------
// collectPunchEventsCore 空輸入
// ---------------------------------------------------------------------------

describe('collectPunchEventsCore 空結構', () => {
  it('getProject 丟例外 → 回空結構', () => {
    const result = collectPunchEventsCore(
      () => { throw new Error('fail'); },
      punchNameForRow,
      eventKey,
      'dummy',
      null,
      null,
    );
    expect(result.subagent_events).toHaveLength(0);
    expect(result.main_events).toHaveLength(0);
    expect(result.main.duration_hours).toBe(0);
  });

  it('getProject 回非物件 → 回空結構', () => {
    const result = collectPunchEventsCore(() => null, punchNameForRow, eventKey, 'dummy', null, null);
    expect(result.subagent_events).toHaveLength(0);
    expect(result.main_events).toHaveLength(0);
  });

  it('sessions 非陣列 → 回空結構', () => {
    const result = collectPunchEventsCore(
      () => ({ sessions: 'bad' }),
      punchNameForRow,
      eventKey,
      'dummy',
      null,
      null,
    );
    expect(result.main_events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 5：端到端 collectPunchEventsCore → main_events 兩桶
// 1:1 對應 Python test_parse_ask_split.py::test_split_round_main_events_two_buckets
// ---------------------------------------------------------------------------

describe('Case 5 — end-to-end: ask split → 2 main_events (two rounds)', () => {
  // 與 Python Case 1/Case 5 完全相同的 records
  const records: JsonlItem[] = [
    _rec(0, _realUser('2026-06-01T10:00:00.000Z', '開始')),
    _rec(1, _assistantText('2026-06-01T10:00:05.000Z', 'reqA', 'before')),
    _rec(2, _assistantAsk('2026-06-01T10:00:10.000Z', 'tool1')),
    _rec(3, _toolResultUser('2026-06-01T10:00:45.000Z', 'tool1')),
    _rec(4, _assistantText('2026-06-01T10:00:50.000Z', 'reqB', 'after')),
  ];

  const rows = buildWorkTimeline(records, []);

  it('build_work_timeline 產生 2 個 main-ai rows（before round=1, after round=2）', () => {
    const mainAiRows = rows.filter((r) => r.kind === 'main-ai');
    expect(mainAiRows).toHaveLength(2);
    expect(mainAiRows[0].round).toBe(1);
    expect(mainAiRows[1].round).toBe(2);
  });

  it('兩個 main-ai rows 有不同的 request_id（collapse 不應跨 round 合併）', () => {
    const mainAiRows = rows.filter((r) => r.kind === 'main-ai');
    expect(mainAiRows[0].request_id).not.toBe(mainAiRows[1].request_id);
  });

  it('collectPunchEventsCore 應產生 2 筆 main_events（兩輪各一）', () => {
    function fakeGetProject(_path: unknown) {
      return {
        sessions: [
          {
            session_id: 's1',
            work_timeline: rows,
            started_at: '2026-06-01T10:00:00.000Z',
            last_assistant_output: '',
          },
        ],
      };
    }

    function nameFn(row: Record<string, unknown>): string | null {
      if (row['kind'] === 'main-ai' || row['kind'] === 'main-dispatch') return 'agent_manager';
      return null;
    }

    function ekeyFn(sid: unknown, row: Record<string, unknown>): string {
      return `${sid}:${row['round']}`;
    }

    const result = collectPunchEventsCore(fakeGetProject, nameFn, ekeyFn, 'p', null, null);
    const mainEvents = result.main_events;

    expect(mainEvents.length).toBe(2);
  });

  it('第一筆 main_event punch_uid 以 "main|s1|" 開頭（round=1, reqA）', () => {
    function fakeGetProject(_path: unknown) {
      return {
        sessions: [
          {
            session_id: 's1',
            work_timeline: rows,
            started_at: '2026-06-01T10:00:00.000Z',
            last_assistant_output: '',
          },
        ],
      };
    }

    function nameFn(row: Record<string, unknown>): string | null {
      if (row['kind'] === 'main-ai' || row['kind'] === 'main-dispatch') return 'agent_manager';
      return null;
    }

    function ekeyFn(sid: unknown, row: Record<string, unknown>): string {
      return `${sid}:${row['round']}`;
    }

    const result = collectPunchEventsCore(fakeGetProject, nameFn, ekeyFn, 'p', null, null);
    const mainEvents = result.main_events;

    expect(mainEvents[0].punch_uid).toMatch(/^main\|s1\|/);
    expect(mainEvents[0].punch_name).toBe(MAIN_PUNCH_NAME);
  });

  it('兩筆 main_events 的 punch_uid 不同', () => {
    function fakeGetProject(_path: unknown) {
      return {
        sessions: [
          {
            session_id: 's1',
            work_timeline: rows,
            started_at: '2026-06-01T10:00:00.000Z',
            last_assistant_output: '',
          },
        ],
      };
    }

    function nameFn(row: Record<string, unknown>): string | null {
      if (row['kind'] === 'main-ai' || row['kind'] === 'main-dispatch') return 'agent_manager';
      return null;
    }

    function ekeyFn(sid: unknown, row: Record<string, unknown>): string {
      return `${sid}:${row['round']}`;
    }

    const result = collectPunchEventsCore(fakeGetProject, nameFn, ekeyFn, 'p', null, null);
    const mainEvents = result.main_events;

    expect(mainEvents[0].punch_uid).not.toBe(mainEvents[1].punch_uid);
  });

  it('第二筆 main_event started_at 在 tool_result(10:00:45) 到 after(10:00:50) 之間', () => {
    function fakeGetProject(_path: unknown) {
      return {
        sessions: [
          {
            session_id: 's1',
            work_timeline: rows,
            started_at: '2026-06-01T10:00:00.000Z',
            last_assistant_output: '',
          },
        ],
      };
    }

    function nameFn(row: Record<string, unknown>): string | null {
      if (row['kind'] === 'main-ai' || row['kind'] === 'main-dispatch') return 'agent_manager';
      return null;
    }

    function ekeyFn(sid: unknown, row: Record<string, unknown>): string {
      return `${sid}:${row['round']}`;
    }

    const result = collectPunchEventsCore(fakeGetProject, nameFn, ekeyFn, 'p', null, null);
    const mainEvents = result.main_events;
    const secondEv = mainEvents[1];

    const secondStartMs = toEpochMs(secondEv.started_at);
    const toolResultMs = toEpochMs('2026-06-01T10:00:45.000Z');
    const afterMs = toEpochMs('2026-06-01T10:00:50.000Z');

    expect(secondStartMs).not.toBeNull();
    expect(toolResultMs).not.toBeNull();
    expect(afterMs).not.toBeNull();
    // started_at 在 tool_result 到 after 之間（含兩端）
    expect(secondStartMs!).toBeGreaterThanOrEqual(toolResultMs!);
    expect(secondStartMs!).toBeLessThanOrEqual(afterMs!);
  });
});

// ---------------------------------------------------------------------------
// subagent_events 測試
// ---------------------------------------------------------------------------

describe('subagent_events — source-first punch_uid', () => {
  it('有 source 時 punch_uid = source', () => {
    function fakeGetProject(_path: unknown) {
      return {
        sessions: [
          {
            session_id: 's1',
            work_timeline: [
              {
                kind: 'subagent',
                source: 'agent-abc.jsonl',
                agent_id: 'abc',
                tool_use_id: 'toolu_xxx',
                started_at: '2026-06-01T10:00:00.000Z',
                ended_at: '2026-06-01T10:00:30.000Z',
                duration_ms: 30_000,
                agent_name: 'developer',
              },
            ],
            started_at: '2026-06-01T10:00:00.000Z',
            last_assistant_output: '',
          },
        ],
      };
    }

    const result = collectPunchEventsCore(
      fakeGetProject,
      punchNameForRow,
      eventKey,
      'p',
      null,
      null,
    );
    expect(result.subagent_events).toHaveLength(1);
    expect(result.subagent_events[0].punch_uid).toBe('agent-abc.jsonl');
  });

  it('無 source 時 punch_uid 退回 agent_id', () => {
    function fakeGetProject(_path: unknown) {
      return {
        sessions: [
          {
            session_id: 's1',
            work_timeline: [
              {
                kind: 'subagent',
                source: '',
                agent_id: 'abc123',
                tool_use_id: 'toolu_xxx',
                started_at: '2026-06-01T10:00:00.000Z',
                ended_at: '2026-06-01T10:00:30.000Z',
                duration_ms: 30_000,
                agent_name: 'developer',
              },
            ],
            started_at: '2026-06-01T10:00:00.000Z',
            last_assistant_output: '',
          },
        ],
      };
    }

    const result = collectPunchEventsCore(
      fakeGetProject,
      punchNameForRow,
      eventKey,
      'p',
      null,
      null,
    );
    expect(result.subagent_events).toHaveLength(1);
    expect(result.subagent_events[0].punch_uid).toBe('abc123');
  });

  it('subagent is_complete=true 當有 ended_at 且 duration>0', () => {
    function fakeGetProject(_path: unknown) {
      return {
        sessions: [
          {
            session_id: 's1',
            work_timeline: [
              {
                kind: 'subagent',
                source: 'agent-x.jsonl',
                started_at: '2026-06-01T10:00:00.000Z',
                ended_at: '2026-06-01T10:00:30.000Z',
                duration_ms: 30_000,
                agent_name: 'worker',
              },
            ],
            started_at: '2026-06-01T10:00:00.000Z',
            last_assistant_output: '',
          },
        ],
      };
    }

    const result = collectPunchEventsCore(
      fakeGetProject,
      punchNameForRow,
      eventKey,
      'p',
      null,
      null,
    );
    expect(result.subagent_events[0].is_complete).toBe(true);
    expect(result.subagent_events[0].duration_hours).toBeGreaterThan(0);
  });

  it('subagent is_complete=false 當 ended_at=null', () => {
    function fakeGetProject(_path: unknown) {
      return {
        sessions: [
          {
            session_id: 's1',
            work_timeline: [
              {
                kind: 'subagent',
                source: 'agent-y.jsonl',
                started_at: '2026-06-01T10:00:00.000Z',
                ended_at: null,
                duration_ms: 30_000,
                agent_name: 'worker',
              },
            ],
            started_at: '2026-06-01T10:00:00.000Z',
            last_assistant_output: '',
          },
        ],
      };
    }

    const result = collectPunchEventsCore(
      fakeGetProject,
      punchNameForRow,
      eventKey,
      'p',
      null,
      null,
    );
    expect(result.subagent_events[0].is_complete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// main_events — per-round 欄位正確性
// ---------------------------------------------------------------------------

describe('main_events — per-round 欄位正確性', () => {
  it('單輪對話產生 1 筆 main_event，is_complete=true（有 end_turn）', () => {
    const timeline = [
      {
        kind: 'main-user',
        started_at: '2026-06-01T10:00:00.000Z',
        ended_at: '2026-06-01T10:00:00.000Z',
        title: '使用者',
        detail: '',
        source: 'main',
        round: 1,
      },
      {
        kind: 'main-ai',
        started_at: '2026-06-01T10:00:00.000Z',
        ended_at: '2026-06-01T10:00:10.000Z',
        duration_ms: 10_000,
        title: 'Claude 回合',
        detail: 'stop: end_turn',
        source: 'main',
        stop: 'end_turn',
        round: 1,
        request_id: 'req1',
        last_output: 'done',
      },
    ];

    function fakeGetProject(_path: unknown) {
      return {
        sessions: [
          {
            session_id: 's1',
            work_timeline: timeline,
            started_at: '2026-06-01T10:00:00.000Z',
            last_assistant_output: '',
          },
        ],
      };
    }

    const result = collectPunchEventsCore(
      fakeGetProject,
      punchNameForRow,
      eventKey,
      'p',
      null,
      null,
    );
    expect(result.main_events).toHaveLength(1);
    expect(result.main_events[0].is_complete).toBe(true);
    expect(result.main_events[0].punch_name).toBe(MAIN_PUNCH_NAME);
    expect(result.main_events[0].round).toBe(1);
    expect(result.main_events[0].punch_uid).toMatch(/^main\|s1\|req1$/);
  });

  it('無 end_turn 的輪 → is_complete=false', () => {
    const timeline = [
      {
        kind: 'main-ai',
        started_at: '2026-06-01T10:00:00.000Z',
        ended_at: null,
        duration_ms: null,
        title: 'Claude 回合',
        detail: '',
        source: 'main',
        stop: null,
        round: 1,
        request_id: 'req1',
      },
    ];

    function fakeGetProject(_path: unknown) {
      return {
        sessions: [
          {
            session_id: 's1',
            work_timeline: timeline,
            started_at: '2026-06-01T10:00:00.000Z',
            last_assistant_output: '',
          },
        ],
      };
    }

    const result = collectPunchEventsCore(
      fakeGetProject,
      punchNameForRow,
      eventKey,
      'p',
      null,
      null,
    );
    expect(result.main_events[0].is_complete).toBe(false);
  });

  it('session_ids 過濾：傳入空陣列 → 空結果', () => {
    const timeline = [
      {
        kind: 'main-ai',
        started_at: '2026-06-01T10:00:00.000Z',
        ended_at: '2026-06-01T10:00:10.000Z',
        duration_ms: 10_000,
        title: '',
        detail: 'stop: end_turn',
        source: 'main',
        stop: 'end_turn',
        round: 1,
        request_id: 'req1',
      },
    ];

    function fakeGetProject(_path: unknown) {
      return {
        sessions: [{ session_id: 's1', work_timeline: timeline, started_at: '2026-06-01T10:00:00.000Z' }],
      };
    }

    const result = collectPunchEventsCore(
      fakeGetProject,
      punchNameForRow,
      eventKey,
      'p',
      null,
      [],  // empty → 全過濾
    );
    expect(result.main_events).toHaveLength(0);
    expect(result.main.event_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// F1 回歸測試：lastSessionId 在 per-session 迴圈頂端就更新（對齊 Python）
//
// 情境：兩個 session（SESS_A 有 main-ai 列、SESS_B 只有 subagent 列在後迭代）。
// Python 語意：session_id 在迴圈最頂端賦值，所以 main_events 的 punch_uid 裡的
// session_id 段等於「迴圈最後被迭代到的 session」的 id（= SESS_B）。
// 修前 TS：lastSessionId 只在 main-ai/main-dispatch 分支更新 → 停在 SESS_A
//         → punch_uid = 'main|SESS_A|round-1'（與 Python 不符）。
// 修後 TS：lastSessionId = sessionId 移到 per-session 迴圈頂端 → SESS_B 覆蓋
//         → punch_uid = 'main|SESS_B|round-1'（與 Python 一致）。
// ---------------------------------------------------------------------------

describe('F1 — roundPunchUid session_id 對齊 Python（迴圈頂端更新）', () => {
  it('最後一個 session 只有 subagent，roundPunchUid session_id 仍為最後 session（SESS_B）', () => {
    const timelineA = [
      {
        kind: 'main-ai',
        started_at: '2026-06-01T10:00:00.000Z',
        ended_at: '2026-06-01T10:00:10.000Z',
        duration_ms: 10_000,
        stop: 'end_turn',
        // 故意不給 request_id，讓 punch_uid 走 round-key fallback
        round: 1,
      },
    ];
    const timelineB = [
      {
        kind: 'subagent',
        source: 'agent-b.jsonl',
        started_at: '2026-06-01T10:01:00.000Z',
        ended_at: '2026-06-01T10:01:30.000Z',
        duration_ms: 30_000,
        agent_name: 'worker',
      },
    ];

    function fakeGetProject(_path) {
      return {
        sessions: [
          { session_id: 'SESS_A', work_timeline: timelineA, started_at: '2026-06-01T10:00:00.000Z', last_assistant_output: '' },
          { session_id: 'SESS_B', work_timeline: timelineB, started_at: '2026-06-01T10:01:00.000Z', last_assistant_output: '' },
        ],
      };
    }

    const result = collectPunchEventsCore(fakeGetProject, punchNameForRow, eventKey, 'p', null, null);

    expect(result.main_events).toHaveLength(1);
    // Python 語意：session_id 在 per-session 迴圈頂端更新 → 最後迭代 SESS_B
    // → punch_uid = 'main|SESS_B|round-1'（非修前的 'main|SESS_A|round-1'）
    expect(result.main_events[0].punch_uid).toBe('main|SESS_B|round-1');
  });
});
