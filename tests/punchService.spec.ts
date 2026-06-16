/**
 * punchService.spec.ts — PunchService 單元測試（vitest）。
 *
 * 1:1 移植自 Python:
 *   tests/test_punch_service.py（~22 case，含 oracle 對拍）
 *
 * Oracle 等價佐證：同一批 events 餵 oracle（搬移前邏輯 inline 重現）與
 * PunchService（移植後）→ action dict 逐一相同。
 */

import { describe, it, expect } from 'vitest';
import {
  PunchService,
  PunchAction,
  ceilHours2dp,
  makePunchAction,
  actionAsDict,
} from '../src/main/services/punchService';
import {
  PunchBuilderMixin,
  MAIN_PUNCH_KEY,
  MAIN_PUNCH_NAME,
  truncate,
  PUNCH_NAME_MAX_LEN,
  PUNCH_DESC_FRAGMENT_MAX,
} from '../src/main/services/punchBuilder';

// ---------------------------------------------------------------------------
// Helpers（對應 Python _ev / _ev2 / _FakeBuilder）
// ---------------------------------------------------------------------------

class FakeBuilder extends PunchBuilderMixin {
  constructor(sessionId = 'abcdef0123456789') {
    super(sessionId);
  }
}

function _ev(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    punch_uid: '',
    event_key: '',
    tool_use_id: '',
    is_complete: true,
    duration_hours: 0.5,
    punch_name: 'sub',
    description: '做事',
    output_json_title: null,
    output_json_description: null,
    model: 'claude',
    tokens: 0,
    started_at: '2026-06-01T10:00:00.000Z',
    ended_at: '2026-06-01T10:30:00.000Z',
  };
  return { ...base, ...overrides };
}

function _ev2(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    punch_uid: 'tp-uid-1',
    kind: 'subagent',
    is_complete: true,
    duration_hours: 0.5,
    punch_name: 'agentX',
    output_json_title: null,
    output_json_description: null,
    last_output: null,
    input_prompt: '',
    started_at: '2026-06-02T10:00:00.000Z',
    ended_at: '2026-06-02T10:30:00.000Z',
  };
  return { ...base, ...overrides };
}

function _ev_complete(uid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    punch_uid: uid,
    kind: 'subagent',
    is_complete: true,
    duration_hours: 0.5,
    punch_name: 'agentX',
    output_json_title: null,
    output_json_description: null,
    last_output: null,
    input_prompt: '',
    started_at: '2026-06-02T10:00:00.000Z',
    ended_at: '2026-06-02T10:30:00.000Z',
  };
  return { ...base, ...overrides };
}

// ---------------------------------------------------------------------------
// Oracle（搬移前 _punch_completed_subagents 決策片段 inline 重現）
// ---------------------------------------------------------------------------

function _ceil_hours_oracle(raw: number): number {
  // Python: float(Decimal(str(raw)).quantize(Decimal("0.01"), ROUND_CEILING))
  return ceilHours2dp(raw);
}

function _oracle_decide_subagents(
  subagent_events: Record<string, unknown>[],
  builder: FakeBuilder,
  task_id: unknown,
  assignee_id: unknown,
  punched_event_keys: Set<string>,
  punch_in_flight_keys: Set<string>,
): Record<string, unknown>[] {
  const actions: Record<string, unknown>[] = [];
  const seen_this_round = new Set<string>();
  for (const ev of subagent_events) {
    const ekey = String(ev['punch_uid'] || '') || String(ev['event_key'] || '');
    if (!ekey || punched_event_keys.has(ekey) || punch_in_flight_keys.has(ekey) || seen_this_round.has(ekey)) {
      continue;
    }
    if (!ev['is_complete']) continue;
    seen_this_round.add(ekey);
    punch_in_flight_keys.add(ekey);
    const punch_name = String(ev['punch_name'] || '');
    const description = String(ev['description'] || '').trim();
    const out_title = String(ev['output_json_title'] || '').trim();
    const out_desc = String(ev['output_json_description'] || '').trim();
    const model = String(ev['model'] || '').trim();
    const tokens = ev['tokens'] || 0;
    const raw = parseFloat(String(ev['duration_hours'] || 0.0)) || 0.0;
    const hours = _ceil_hours_oracle(raw);
    const start_time = ev['started_at'] ?? null;
    const end_time = ev['ended_at'] ?? null;
    actions.push({
      punch_key: ekey,
      kind: 'subagent',
      event_key: ekey,
      punch_name,
      subtask_name: out_title || builder._subagent_subtask_name(punch_name, description),
      description: out_desc || builder._build_subagent_description(description, model, tokens, hours),
      task_id,
      assignee_id,
      category_name: punch_name,
      start_time,
      end_time,
      duration: hours,
    });
  }
  return actions;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('PunchService', () => {

  // -------------------------------------------------------------------------
  // bug 1：punch_uid 穩定去重
  // -------------------------------------------------------------------------

  it('test_punch_uid_stable_dedup_only_punches_once', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();

    const ev1 = _ev({ punch_uid: 'agent-uid-1', tool_use_id: '' });
    const actions1 = svc.decide_subagents([ev1], b, { task_id: 'T1', assignee_id: 7 });
    expect(actions1).toHaveLength(1);
    expect(actions1[0].punch_key).toBe('agent-uid-1');
    svc.mark_done(actions1[0].punch_key, true);

    const ev2 = _ev({ punch_uid: 'agent-uid-1', tool_use_id: 'toolu_now_has_value' });
    const actions2 = svc.decide_subagents([ev2], b, { task_id: 'T1', assignee_id: 7 });
    expect(actions2).toEqual([]);
  });

  it('test_dedup_key_falls_back_to_event_key', () => {
    expect(PunchService.event_dedup_key({ punch_uid: '', event_key: 'ek' })).toBe('ek');
    expect(PunchService.event_dedup_key({ punch_uid: 'uid', event_key: 'ek' })).toBe('uid');
    expect(PunchService.event_dedup_key({})).toBe('');
  });

  // -------------------------------------------------------------------------
  // bug 2：in-flight 樂觀鎖
  // -------------------------------------------------------------------------

  it('test_in_flight_optimistic_lock_blocks_repeat_before_done', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev({ punch_uid: 'uid-A' });

    const a1 = svc.decide_subagents([ev], b, { task_id: 'T1', assignee_id: 1 });
    expect(a1).toHaveLength(1);
    expect(svc.in_flight_keys.has('uid-A')).toBe(true);
    expect(svc.punched_keys.has('uid-A')).toBe(false);

    const a2 = svc.decide_subagents([ev], b, { task_id: 'T1', assignee_id: 1 });
    expect(a2).toEqual([]);
  });

  it('test_same_round_seen_dedup', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const running = _ev({ punch_uid: 'uid-B', is_complete: false });
    const done = _ev({ punch_uid: 'uid-B', is_complete: true });
    const actions = svc.decide_subagents([running, done], b, { task_id: 'T1', assignee_id: 1 });
    expect(actions).toHaveLength(1);
    expect(actions[0].punch_key).toBe('uid-B');
  });

  // -------------------------------------------------------------------------
  // bug 3：mark_done
  // -------------------------------------------------------------------------

  it('test_mark_done_failure_allows_retry', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev({ punch_uid: 'uid-C' });

    const a1 = svc.decide_subagents([ev], b, { task_id: 'T1', assignee_id: 1 });
    expect(a1).toHaveLength(1);
    svc.mark_done('uid-C', false);
    expect(svc.in_flight_keys.has('uid-C')).toBe(false);
    expect(svc.punched_keys.has('uid-C')).toBe(false);
    expect(svc.errors.get('uid-C')).toBe(true);

    const a2 = svc.decide_subagents([ev], b, { task_id: 'T1', assignee_id: 1 });
    expect(a2).toHaveLength(1);
    expect(a2[0].punch_key).toBe('uid-C');
  });

  it('test_mark_done_success_blocks_repunch', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev({ punch_uid: 'uid-D' });

    svc.decide_subagents([ev], b, { task_id: 'T1', assignee_id: 1 });
    svc.mark_done('uid-D', true);
    expect(svc.punched_keys.has('uid-D')).toBe(true);
    expect(svc.in_flight_keys.has('uid-D')).toBe(false);
    expect(svc.errors.has('uid-D')).toBe(false);

    const a2 = svc.decide_subagents([ev], b, { task_id: 'T1', assignee_id: 1 });
    expect(a2).toEqual([]);
  });

  it('test_mark_done_none_key_is_noop', () => {
    const svc = new PunchService();
    svc.mark_done(null, true);
    svc.mark_done(null, false);
    expect(svc.punched_keys.size).toBe(0);
    expect(svc.errors.size).toBe(0);
  });

  // -------------------------------------------------------------------------
  // bug 4：is_complete=False → 不打卡
  // -------------------------------------------------------------------------

  it('test_incomplete_event_not_punched', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const running = _ev({ punch_uid: 'uid-E', is_complete: false });
    const actions = svc.decide_subagents([running], b, { task_id: 'T1', assignee_id: 1 });
    expect(actions).toEqual([]);
    expect(svc.in_flight_keys.has('uid-E')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // bug 5：ceil 進位
  // -------------------------------------------------------------------------

  it('test_ceil_hours_rounding', () => {
    expect(ceilHours2dp(0.0142)).toBe(0.02);
    expect(ceilHours2dp(0.02)).toBe(0.02);     // 不可因浮點誤差變 0.03
    expect(ceilHours2dp(0.0001)).toBe(0.01);
    expect(ceilHours2dp(0.0)).toBe(0.0);
    expect(ceilHours2dp(null)).toBe(0.0);
    expect(ceilHours2dp(1.0)).toBe(1.0);
  });

  it('test_decide_applies_ceil_to_action_duration', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev({ punch_uid: 'uid-F', duration_hours: 0.0142 });
    const actions = svc.decide_subagents([ev], b, { task_id: 'T1', assignee_id: 1 });
    expect(actions).toHaveLength(1);
    expect(actions[0].duration).toBe(0.02);
  });

  // -------------------------------------------------------------------------
  // bug 6：main — main_punched 只打一次
  // -------------------------------------------------------------------------

  it('test_main_punches_once', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const main_state = {
      duration_hours: 1.2345,
      started_at: '2026-06-01T09:00:00.000Z',
      ended_at: '2026-06-01T10:00:00.000Z',
      output_json_title: null,
      output_json_description: null,
    };
    const a1 = svc.decide_main(main_state, b, { task_id: 'T1', assignee_id: 3 });
    expect(a1).not.toBeNull();
    expect(a1!.punch_key).toBe(MAIN_PUNCH_KEY);
    expect(a1!.kind).toBe('main');
    expect(a1!.punch_name).toBe(MAIN_PUNCH_NAME);
    expect(a1!.duration).toBe(Math.round(1.2345 * 10000) / 10000);
    expect(svc.main_punched).toBe(true);

    const a2 = svc.decide_main(main_state, b, { task_id: 'T1', assignee_id: 3 });
    expect(a2).toBeNull();
  });

  it('test_main_zero_hours_not_punched', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const a = svc.decide_main({ duration_hours: 0.0 }, b, { task_id: 'T1', assignee_id: 3 });
    expect(a).toBeNull();
    expect(svc.main_punched).toBe(false);
  });

  it('test_main_start_end_fallback_to_now', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const a = svc.decide_main({ duration_hours: 0.5 }, b, { task_id: 'T1', assignee_id: 3 });
    expect(a).not.toBeNull();
    expect(String(a!.start_time).endsWith('Z')).toBe(true);
    expect(String(a!.end_time).endsWith('Z')).toBe(true);
  });

  it('test_main_output_json_overrides_title_and_desc', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const a = svc.decide_main(
      { duration_hours: 0.5, output_json_title: '白話標題', output_json_description: '白話描述' },
      b,
      { task_id: 'T1', assignee_id: 3 }
    );
    expect(a!.subtask_name).toBe('白話標題');
    expect(a!.description).toBe('白話描述');
  });

  // -------------------------------------------------------------------------
  // action 欄位完整性
  // -------------------------------------------------------------------------

  it('test_action_as_dict_contract', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev({ punch_uid: 'uid-G' });
    const a = svc.decide_subagents([ev], b, { task_id: 'T9', assignee_id: 42 })[0];
    const d = actionAsDict(a);
    const expectedKeys = new Set([
      'punch_key', 'kind', 'event_key', 'punch_name', 'subtask_name',
      'description', 'task_id', 'assignee_id', 'category_name',
      'start_time', 'end_time', 'duration',
    ]);
    expect(new Set(Object.keys(d))).toEqual(expectedKeys);
    expect(d['kind']).toBe('subagent');
    expect(d['task_id']).toBe('T9');
    expect(d['assignee_id']).toBe(42);
    expect(d['category_name']).toBe('sub'); // category_name == punch_name（非常數）
    expect(d['event_key']).toBe('uid-G');
  });

  it('test_subagent_output_json_overrides', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev({ punch_uid: 'uid-H', output_json_title: 'OT', output_json_description: 'OD' });
    const a = svc.decide_subagents([ev], b, { task_id: 'T1', assignee_id: 1 })[0];
    expect(a.subtask_name).toBe('OT');
    expect(a.description).toBe('OD');
  });

  // -------------------------------------------------------------------------
  // Oracle 對拍
  // -------------------------------------------------------------------------

  it('test_oracle_equivalence_subagents', () => {
    const events = [
      _ev({ punch_uid: 'u1', duration_hours: 0.0142, punch_name: 'agentA', description: '處理 A' }),
      _ev({ punch_uid: 'u2', duration_hours: 0.02, punch_name: 'agentB', output_json_title: 'B標題', output_json_description: 'B描述' }),
      _ev({ punch_uid: 'u3', is_complete: false }),
      _ev({ punch_uid: 'u1', duration_hours: 0.5 }),
      _ev({ punch_uid: '', event_key: '', is_complete: true }),
      _ev({ punch_uid: '', event_key: 'ek4', duration_hours: 0.3, punch_name: 'agentD' }),
    ];
    const b1 = new FakeBuilder('sessABCD1234');
    const b2 = new FakeBuilder('sessABCD1234');

    const oracle = _oracle_decide_subagents(
      events, b1, 'TX', 99, new Set(), new Set()
    );

    const svc = new PunchService();
    const got = svc.decide_subagents(events, b2, { task_id: 'TX', assignee_id: 99 }).map(actionAsDict);

    expect(got).toEqual(oracle);
    // in_flight 標記與 oracle 一致（u1/u2/ek4 三個被排）
    expect(svc.in_flight_keys).toEqual(new Set(['u1', 'u2', 'ek4']));
  });

  it('test_oracle_equivalence_with_prior_punched', () => {
    const events = [
      _ev({ punch_uid: 'p1', duration_hours: 0.1 }),
      _ev({ punch_uid: 'f1', duration_hours: 0.1 }),
      _ev({ punch_uid: 'n1', duration_hours: 0.1 }),
    ];
    const b1 = new FakeBuilder();
    const b2 = new FakeBuilder();

    const oracle = _oracle_decide_subagents(
      events, b1, 'TX', 5, new Set(['p1']), new Set(['f1'])
    );

    const svc = new PunchService();
    svc.punched_keys.add('p1');
    svc.in_flight_keys.add('f1');
    const got = svc.decide_subagents(events, b2, { task_id: 'TX', assignee_id: 5 }).map(actionAsDict);

    expect(got).toEqual(oracle);
    expect(got).toHaveLength(1);
    expect(got[0]['punch_key']).toBe('n1');
  });

  // -------------------------------------------------------------------------
  // decide_two_phase：description_is_fallback + llm_source_text 旗標驗證
  // -------------------------------------------------------------------------

  it('test_two_phase_a_has_output_json_description_not_fallback', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev2({ output_json_description: '精彩完成摘要', last_output: '原始輸出文字' });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(a.description).toBe('精彩完成摘要');
    expect(a.description_is_fallback).toBe(false);
    expect(a.llm_source_text).toBe('原始輸出文字');
  });

  it('test_two_phase_b_no_output_json_but_has_last_output_is_fallback', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev2({ output_json_description: null, last_output: 'agent 最後輸出的原文' });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(a.description_is_fallback).toBe(true);
    expect(a.llm_source_text).toBe('agent 最後輸出的原文');
    expect(a.description).toBe('agent 最後輸出的原文');
  });

  it('test_two_phase_c_both_empty_uses_builder_fallback_is_fallback', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev2({ output_json_description: null, last_output: null, duration_hours: 0.5 });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(a.description_is_fallback).toBe(true);
    expect(a.llm_source_text).toBe('');
    const expected_desc = b._build_main_description(0.5);
    expect(a.description).toBe(expected_desc);
  });

  // -------------------------------------------------------------------------
  // decide_two_phase 退避閘
  // -------------------------------------------------------------------------

  it('test_backoff_skip_within_window', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    svc.mark_token_defer('u1', 100.0, 60.0);
    const ev = _ev_complete('u1');
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b, now: 130.0,
    });
    expect(actions).toEqual([]);
  });

  it('test_backoff_skip_expired_window', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    svc.mark_token_defer('u1', 100.0, 60.0);
    const ev = _ev_complete('u1');
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b, now: 161.0,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].punch_uid).toBe('u1');
  });

  it('test_backoff_now_default_zero_no_defer_equiv_existing', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev_complete('u1');
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
      // now 不傳，預設 0
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].punch_uid).toBe('u1');
  });

  it('test_two_phase_open_key_punches_end_not_create', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    svc.open_keys.set('u1', 'subtask-999');
    const ev = _ev_complete('u1');
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(a.phase).toBe('end');
    expect(a.subtask_id).toBe('subtask-999');
    expect(a.punch_uid).toBe('u1');
  });

  // -------------------------------------------------------------------------
  // 補償配對（B-T1 … B-T9）— decide_two_phase open_anchors 機制
  // -------------------------------------------------------------------------

  it('B-T1: 命中補打 — type + started_at 嚴格相等，排 end action，punch_uid=舊uid，absorbed_uid=新uid', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T10:00:00.000Z';
    // preload 灌入 anchor
    svc.preload(new Set(), null, new Map([
      ['old-uid', { uid: 'old-uid', subtask_id: 'loc:x', name: 'agent_manager', started_at: T0, type: 'agent_manager' }],
    ]));
    const ev = _ev_complete('new-uid', { punch_name: 'agent_manager', started_at: T0, ended_at: '2026-06-01T11:00:00.000Z' });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions).toHaveLength(1);
    const a = actions[0];
    // 補償配對成功：排 end action
    expect(a.phase).toBe('end');
    expect(a.punch_uid).toBe('old-uid');          // punch_uid 用舊 uid
    expect(a.subtask_id).toBe('loc:x');            // subtask_id 承自 anchor
    expect(a.absorbed_uid).toBe('new-uid');         // 吸收新 uid
    // 不產生 oneshot
    expect(actions.filter(x => x.phase === 'oneshot')).toHaveLength(0);
  });

  it('B-T2: started_at 不等 → oneshot（type 相符但時間不符，配對失敗）', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T10:00:00.000Z';
    const T1 = '2026-06-01T11:00:00.000Z';  // 不同時間
    svc.preload(new Set(), null, new Map([
      ['old-uid', { subtask_id: 'loc:y', name: 'agent_manager', started_at: T0, type: 'agent_manager' }],
    ]));
    const ev = _ev_complete('new-uid', { punch_name: 'agent_manager', started_at: T1 });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].phase).toBe('oneshot');
    expect(actions[0].punch_uid).toBe('new-uid');
  });

  it('B-T3: type 不同 → oneshot（started_at 相符但 type 不符，配對失敗）', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T10:00:00.000Z';
    svc.preload(new Set(), null, new Map([
      ['old-uid', { subtask_id: 'loc:z', name: 'agent_manager', started_at: T0, type: 'agent_manager' }],
    ]));
    // 完成事件的 punch_name（即 base_name）不同
    const ev = _ev_complete('new-uid', { punch_name: 'agent_developer', started_at: T0 });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].phase).toBe('oneshot');
  });

  it('B-T4: 兩 anchor 同 type 同時間且 name 都不中 → oneshot（歧義安全）', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T10:00:00.000Z';
    // 兩個 anchor：type/started_at 相同，name 各不同
    svc.preload(new Set(), null, new Map([
      ['old-A', { subtask_id: 'loc:a', name: 'anchor_name_A', started_at: T0, type: 'agent_manager' }],
      ['old-B', { subtask_id: 'loc:b', name: 'anchor_name_B', started_at: T0, type: 'agent_manager' }],
    ]));
    // 完成事件的 name（output_json_title fallback → punch_name）≠ anchor A 也 ≠ anchor B
    const ev = _ev_complete('new-uid', { punch_name: 'agent_manager', started_at: T0 });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    // 兩個候選且 name 都不中（0 exact match）→ 歧義 → oneshot
    expect(actions).toHaveLength(1);
    expect(actions[0].phase).toBe('oneshot');
  });

  it('B-T5: name tie-break 收斂 → 補打（兩 anchor 同 type/started_at，但 name 只有一個與完成事件一致）', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T10:00:00.000Z';
    svc.preload(new Set(), null, new Map([
      ['old-A', { subtask_id: 'loc:a-tb', name: 'anchor_name_A', started_at: T0, type: 'agent_manager' }],
      ['old-B', { subtask_id: 'loc:b-tb', name: 'target_name', started_at: T0, type: 'agent_manager' }],
    ]));
    // 完成事件 output_json_title 帶 'target_name'（即 name_fallback='target_name'）
    const ev = _ev_complete('new-uid', {
      punch_name: 'agent_manager',
      output_json_title: 'target_name',
      started_at: T0,
    });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(a.phase).toBe('end');
    expect(a.punch_uid).toBe('old-B');       // tie-break 選中 old-B
    expect(a.subtask_id).toBe('loc:b-tb');
    expect(a.absorbed_uid).toBe('new-uid');
  });

  it('B-T6: 未完成事件不補（is_complete=false → start action，不嘗試補償配對）', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T10:00:00.000Z';
    svc.preload(new Set(), null, new Map([
      ['old-uid', { subtask_id: 'loc:w', name: 'agent_manager', started_at: T0, type: 'agent_manager' }],
    ]));
    // is_complete=false → 進行中事件
    const ev = { punch_uid: 'new-uid', kind: 'subagent', is_complete: false,
      duration_hours: 0.0, punch_name: 'agent_manager', output_json_title: null,
      output_json_description: null, last_output: null, input_prompt: '',
      started_at: T0, ended_at: null };
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].phase).toBe('start');    // 進行中 → start，非 end
    expect(actions[0].punch_uid).toBe('new-uid');
  });

  it('B-T7: 新 uid 已在 punched_keys → 跳過不補', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T10:00:00.000Z';
    svc.preload(new Set(['new-uid']), null, new Map([
      ['old-uid', { subtask_id: 'loc:v', name: 'agent_manager', started_at: T0, type: 'agent_manager' }],
    ]));
    const ev = _ev_complete('new-uid', { punch_name: 'agent_manager', started_at: T0 });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    // new-uid 已在 punched_keys → 整個事件跳過
    expect(actions).toHaveLength(0);
  });

  it('B-T8: subagent 路（type="agent_xxx"）補打成功', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T12:00:00.000Z';
    svc.preload(new Set(), null, new Map([
      ['old-sub', { subtask_id: 'loc:sub', name: 'agent_developer', started_at: T0, type: 'agent_developer' }],
    ]));
    const ev = _ev_complete('new-sub', { punch_name: 'agent_developer', started_at: T0 });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T2', assignee_id: 2, session_id: 'sess2', builder: b,
    });
    expect(actions).toHaveLength(1);
    const a = actions[0];
    expect(a.phase).toBe('end');
    expect(a.punch_uid).toBe('old-sub');
    expect(a.subtask_id).toBe('loc:sub');
    expect(a.absorbed_uid).toBe('new-sub');
  });

  it('B-T9: 無 anchor 時完成事件行為與原版一致（oneshot 回歸）', () => {
    // 不 preload 任何 anchor，確認 decide_two_phase 退化為原版 oneshot 行為
    const svc = new PunchService();
    const b = new FakeBuilder();
    const ev = _ev_complete('no-anchor-uid', { punch_name: 'agent_manager', started_at: '2026-06-01T10:00:00.000Z' });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].phase).toBe('oneshot');
    expect(actions[0].punch_uid).toBe('no-anchor-uid');
  });

  // -------------------------------------------------------------------------
  // F-Z1 回滾案例（B-T1c / B-T1d）
  // -------------------------------------------------------------------------

  it('B-T1c: settle 失敗回滾 — mark_absorption_failed 還原 anchor/consumed/in_flight；再餵同事件可重試', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T10:00:00.000Z';
    // 預載 anchor
    svc.preload(new Set(), null, new Map([
      ['old-uid-z1', { uid: 'old-uid-z1', subtask_id: 'loc:z1', name: 'agent_manager', started_at: T0, type: 'agent_manager' }],
    ]));

    // 第一次：補償配對成功，排出 end action
    const ev = _ev_complete('new-uid-z1', { punch_name: 'agent_manager', started_at: T0, ended_at: '2026-06-01T11:00:00.000Z' });
    const actions1 = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions1).toHaveLength(1);
    expect(actions1[0].phase).toBe('end');
    expect(actions1[0].punch_uid).toBe('old-uid-z1');
    expect(actions1[0].absorbed_uid).toBe('new-uid-z1');

    // 此時 pending_absorptions 有記錄、anchor 已刪、consumed 有 old-uid-z1
    expect(svc.pending_absorptions.has('new-uid-z1')).toBe(true);
    expect(svc.open_anchors.has('old-uid-z1')).toBe(false);
    expect(svc.consumed_open_uids.has('old-uid-z1')).toBe(true);
    expect(svc.in_flight_keys.has('new-uid-z1')).toBe(true);

    // 模擬 settle 失敗：呼叫 mark_absorption_failed
    svc.mark_absorption_failed('new-uid-z1');

    // 回滾驗證
    expect(svc.open_anchors.has('old-uid-z1')).toBe(true);           // anchor 還原
    expect(svc.consumed_open_uids.has('old-uid-z1')).toBe(false);    // consumed 清除
    expect(svc.in_flight_keys.has('new-uid-z1')).toBe(false);        // in_flight 清除
    expect(svc.pending_absorptions.has('new-uid-z1')).toBe(false);   // pending 清除

    // 重試路徑：再餵一次同完成事件，應再次命中補償配對
    const actions2 = svc.decide_two_phase([ev], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions2).toHaveLength(1);
    expect(actions2[0].phase).toBe('end');
    expect(actions2[0].punch_uid).toBe('old-uid-z1');   // 重試仍命中舊 uid
    expect(actions2[0].absorbed_uid).toBe('new-uid-z1');
  });

  it('B-T1d: mark_done(new_uid, true) 清 pending — 之後 mark_absorption_failed(new_uid) 為 no-op，anchor 不被誤還原', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T12:00:00.000Z';
    svc.preload(new Set(), null, new Map([
      ['old-uid-z2', { uid: 'old-uid-z2', subtask_id: 'loc:z2', name: 'agent_tester', started_at: T0, type: 'agent_tester' }],
    ]));

    // 補償配對成功
    const ev = _ev_complete('new-uid-z2', { punch_name: 'agent_tester', started_at: T0 });
    const actions = svc.decide_two_phase([ev], [], {
      task_id: 'T2', assignee_id: 2, session_id: 'sess2', builder: b,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0].phase).toBe('end');
    expect(svc.pending_absorptions.has('new-uid-z2')).toBe(true);

    // settle 成功：mark_done(new_uid, true) 清 pending_absorptions
    svc.mark_done('new-uid-z2', true);
    expect(svc.pending_absorptions.has('new-uid-z2')).toBe(false);   // pending 已清

    // 之後呼叫 mark_absorption_failed(new_uid) 應為 no-op
    // 確認：open_anchors 中不應因此出現 old-uid-z2（已被 delete 且 settle 成功，不應回頭）
    const anchorsBefore = new Map(svc.open_anchors);  // 快照
    svc.mark_absorption_failed('new-uid-z2');  // no-op
    // anchor 不被誤還原（open_anchors 沒有 old-uid-z2）
    expect(svc.open_anchors.has('old-uid-z2')).toBe(false);
    // consumed 不被誤清（成功後 consumed 仍含 old-uid-z2 為保護層，不清）
    // 主要斷言：open_anchors 未改變
    expect(svc.open_anchors).toEqual(anchorsBefore);
  });

  it('B-T1b: consumed — 同一 anchor 不被兩個完成事件各補一次（第二個→ oneshot）', () => {
    const svc = new PunchService();
    const b = new FakeBuilder();
    const T0 = '2026-06-01T10:00:00.000Z';
    svc.preload(new Set(), null, new Map([
      ['old-uid-once', { subtask_id: 'loc:once', name: 'agent_manager', started_at: T0, type: 'agent_manager' }],
    ]));

    // 第一個完成事件：命中 anchor → end action（consumed）
    const ev1 = _ev_complete('new-uid-1', { punch_name: 'agent_manager', started_at: T0, ended_at: '2026-06-01T11:00:00.000Z' });
    const actions1 = svc.decide_two_phase([ev1], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions1).toHaveLength(1);
    expect(actions1[0].phase).toBe('end');
    expect(actions1[0].punch_uid).toBe('old-uid-once');

    // 模擬 mark_done 成功（實際流程中補打成功後呼叫 mark_done）
    svc.mark_done('old-uid-once', true);

    // 第二個完成事件：anchor 已被 consumed → oneshot
    const ev2 = _ev_complete('new-uid-2', { punch_name: 'agent_manager', started_at: T0, ended_at: '2026-06-01T11:00:00.000Z' });
    const actions2 = svc.decide_two_phase([ev2], [], {
      task_id: 'T1', assignee_id: 1, session_id: 'sess1', builder: b,
    });
    expect(actions2).toHaveLength(1);
    expect(actions2[0].phase).toBe('oneshot');
    expect(actions2[0].punch_uid).toBe('new-uid-2');
  });

});
