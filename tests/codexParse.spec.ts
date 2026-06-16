/**
 * codexParse.spec.ts — codexRecordToConversationMessage 純函式映射測試。
 *
 * 涵蓋（= plan §4.2 映射表 + 批次 1 驗收）：
 *  - 逐型別斷言：user_message / agent_message / function_call / function_call_output /
 *    task_complete，以及各種 →null（task_started / token_count / developer / user /
 *    assistant mirror / reasoning / turn_context / session_meta / 未知）。
 *  - call_id 對應：function_call.id === function_call_output.tool_use_id。
 *  - 去重：user_message 與其 response_item/message 鏡像不雙出（鏡像 →null）。
 *  - 純函式決定性：同輸入多次呼叫得同輸出。
 *
 * fixture：合成最小 rollout（手刻、無 PII、無超長 base_instructions），record 形狀
 * 對齊本機真檔（已親驗）。
 */

import { describe, it, expect } from 'vitest'
import { codexRecordToConversationMessage } from '../src/main/worktime/codex/parse'

const TS = '2026-06-09T10:44:58.484Z'

// ---- record 建構子（對齊真檔形狀）----
function ev(payloadType: string, extra: Record<string, unknown> = {}, ts = TS) {
  return { timestamp: ts, type: 'event_msg', payload: { type: payloadType, ...extra } }
}
function ri(payloadType: string, extra: Record<string, unknown> = {}, ts = TS) {
  return { timestamp: ts, type: 'response_item', payload: { type: payloadType, ...extra } }
}

describe('codexRecordToConversationMessage — 映射表', () => {
  it('event_msg/user_message → user/typed + text', () => {
    const m = codexRecordToConversationMessage(ev('user_message', { message: '23' }))
    expect(m).not.toBeNull()
    expect(m!.role).toBe('user')
    expect(m!.source).toBe('typed')
    expect(m!.timestamp).toBe(TS)
    expect(m!.blocks).toEqual([{ kind: 'text', text: '23' }])
  })

  it('event_msg/user_message 空訊息 → null', () => {
    expect(codexRecordToConversationMessage(ev('user_message', { message: '' }))).toBeNull()
    expect(codexRecordToConversationMessage(ev('user_message', {}))).toBeNull()
  })

  it('event_msg/agent_message → assistant + text（phase 不影響）', () => {
    const m = codexRecordToConversationMessage(
      ev('agent_message', { message: '收到。', phase: 'final_answer' }),
    )
    expect(m).not.toBeNull()
    expect(m!.role).toBe('assistant')
    expect(m!.source).toBeUndefined()
    expect(m!.blocks).toEqual([{ kind: 'text', text: '收到。' }])
    // commentary phase 也顯示
    const m2 = codexRecordToConversationMessage(
      ev('agent_message', { message: 'thinking aloud', phase: 'commentary' }),
    )
    expect(m2!.blocks).toEqual([{ kind: 'text', text: 'thinking aloud' }])
  })

  it('event_msg/agent_message 空訊息 → null', () => {
    expect(codexRecordToConversationMessage(ev('agent_message', { message: '' }))).toBeNull()
  })

  it('event_msg/task_complete 帶 duration_ms → system + turnDuration(durationMs=該值)', () => {
    const m = codexRecordToConversationMessage(
      ev('task_complete', { turn_id: 't1', duration_ms: 10588, last_agent_message: '收到。' }),
    )
    expect(m).not.toBeNull()
    expect(m!.role).toBe('system')
    expect(m!.blocks).toEqual([])
    // duration_ms 真實可靠（真檔驗證值 10588）→ 取自 record 本身填入
    expect(m!.turnDuration).toEqual({ durationMs: 10588 })
    expect(m!.timestamp).toBe(TS)
  })

  it('event_msg/task_complete 無 duration_ms → durationMs=0（分段仍觸發）', () => {
    const m = codexRecordToConversationMessage(ev('task_complete', { turn_id: 't1' }))
    expect(m).not.toBeNull()
    expect(m!.role).toBe('system')
    expect(m!.turnDuration).toEqual({ durationMs: 0 })
    // 非數值 duration_ms 也 fallback 0（不崩）
    const m2 = codexRecordToConversationMessage(
      ev('task_complete', { turn_id: 't1', duration_ms: 'not-a-number' }),
    )
    expect(m2!.turnDuration).toEqual({ durationMs: 0 })
  })

  it('event_msg/task_started → null', () => {
    expect(
      codexRecordToConversationMessage(ev('task_started', { turn_id: 't1', started_at: 1781001893 })),
    ).toBeNull()
  })

  it('event_msg/token_count → null（本批不附 usage）', () => {
    expect(
      codexRecordToConversationMessage(
        ev('token_count', { info: { total_token_usage: { total_tokens: 15977 } } }),
      ),
    ).toBeNull()
    // info 為 null 也不崩
    expect(codexRecordToConversationMessage(ev('token_count', { info: null }))).toBeNull()
  })

  it('response_item/function_call → assistant + tool_use(name/arguments/id=call_id)', () => {
    const args = JSON.stringify({ command: 'ls', timeout_ms: 10000 })
    const m = codexRecordToConversationMessage(
      ri('function_call', { name: 'shell_command', arguments: args, call_id: 'call_ABC' }),
    )
    expect(m).not.toBeNull()
    expect(m!.role).toBe('assistant')
    expect(m!.blocks).toHaveLength(1)
    const blk = m!.blocks[0]
    expect(blk.kind).toBe('tool_use')
    expect(blk.name).toBe('shell_command')
    expect(blk.text).toBe(args)
    expect(blk.id).toBe('call_ABC')
  })

  it('response_item/function_call 無 name → null', () => {
    expect(codexRecordToConversationMessage(ri('function_call', { call_id: 'x' }))).toBeNull()
  })

  it('response_item/function_call_output → assistant/tool_result + tool_use_id=call_id', () => {
    const m = codexRecordToConversationMessage(
      ri('function_call_output', { call_id: 'call_ABC', output: 'Exit code: 0\nOK' }),
    )
    expect(m).not.toBeNull()
    expect(m!.role).toBe('assistant')
    expect(m!.source).toBe('tool_result')
    expect(m!.blocks).toHaveLength(1)
    const blk = m!.blocks[0]
    expect(blk.kind).toBe('tool_result')
    expect(blk.text).toBe('Exit code: 0\nOK')
    expect(blk.tool_use_id).toBe('call_ABC')
  })

  it('response_item/function_call_output 無 call_id → null', () => {
    expect(codexRecordToConversationMessage(ri('function_call_output', { output: 'x' }))).toBeNull()
  })

  it('response_item/message role=developer → null（注入雜訊）', () => {
    expect(
      codexRecordToConversationMessage(
        ri('message', { role: 'developer', content: [{ type: 'input_text', text: '<permissions>' }] }),
      ),
    ).toBeNull()
  })

  it('response_item/message role=user → null（去重，文字由 event_msg 提供）', () => {
    expect(
      codexRecordToConversationMessage(
        ri('message', { role: 'user', content: [{ type: 'input_text', text: '23' }] }),
      ),
    ).toBeNull()
  })

  it('response_item/message role=assistant → null（去重，文字由 event_msg 提供）', () => {
    expect(
      codexRecordToConversationMessage(
        ri('message', {
          role: 'assistant',
          content: [{ type: 'output_text', text: '收到。' }],
          phase: 'final_answer',
        }),
      ),
    ).toBeNull()
  })

  it('response_item/reasoning → null（encrypted_content 無明文）', () => {
    expect(
      codexRecordToConversationMessage(ri('reasoning', { summary: [], encrypted_content: 'gAAA...' })),
    ).toBeNull()
  })

  it('response_item/turn_context → null', () => {
    expect(codexRecordToConversationMessage(ri('turn_context', { turn_id: 't1', cwd: 'C:\\x' }))).toBeNull()
  })

  it('session_meta → null', () => {
    expect(
      codexRecordToConversationMessage({
        timestamp: TS,
        type: 'session_meta',
        payload: { id: 'abc', cwd: 'C:\\x', timestamp: TS },
      }),
    ).toBeNull()
  })

  it('未知 / 畸形 record → null（不丟）', () => {
    expect(codexRecordToConversationMessage({ type: 'whatever', payload: {} })).toBeNull()
    expect(codexRecordToConversationMessage({})).toBeNull()
    expect(codexRecordToConversationMessage({ type: 'event_msg' })).toBeNull() // 無 payload
    expect(codexRecordToConversationMessage({ type: 'event_msg', payload: 'not-obj' })).toBeNull()
  })

  it('無 timestamp → timestamp undefined（不崩）', () => {
    const m = codexRecordToConversationMessage({
      type: 'event_msg',
      payload: { type: 'user_message', message: 'hi' },
    })
    expect(m!.timestamp).toBeUndefined()
    expect(m!.blocks).toEqual([{ kind: 'text', text: 'hi' }])
  })
})

describe('codexRecordToConversationMessage — call_id 對應 + 去重 + 決定性', () => {
  it('function_call.id 與 function_call_output.tool_use_id 對得上', () => {
    const callId = 'call_JGOd51GpqhVyHwOATBIg3KTn'
    const callM = codexRecordToConversationMessage(
      ri('function_call', { name: 'shell_command', arguments: '{}', call_id: callId }),
    )
    const outM = codexRecordToConversationMessage(
      ri('function_call_output', { call_id: callId, output: 'done' }),
    )
    expect(callM!.blocks[0].id).toBe(callId)
    expect(outM!.blocks[0].tool_use_id).toBe(callId)
    expect(callM!.blocks[0].id).toBe(outM!.blocks[0].tool_use_id)
  })

  it('去重：合成 rollout 逐行映射 → 文字只出現一次（user_message 與其鏡像不雙出）', () => {
    // 模擬真檔交錯順序：session_meta → task_started → developer → user(mirror) →
    // turn_context → user_message → agent_message → assistant(mirror) → token_count →
    // task_complete → function_call → function_call_output
    const lines = [
      { timestamp: TS, type: 'session_meta', payload: { id: 'a', cwd: 'C:\\x', timestamp: TS } },
      ev('task_started', { turn_id: 't1' }),
      ri('message', { role: 'developer', content: [{ type: 'input_text', text: '<perms>' }] }),
      ri('message', { role: 'user', content: [{ type: 'input_text', text: '23' }] }),
      ri('turn_context', { turn_id: 't1' }),
      ev('user_message', { message: '23' }),
      ev('agent_message', { message: '收到。', phase: 'final_answer' }),
      ri('message', { role: 'assistant', content: [{ type: 'output_text', text: '收到。' }] }),
      ev('token_count', { info: null }),
      ev('task_complete', { turn_id: 't1', duration_ms: 100 }),
      ri('function_call', { name: 'shell_command', arguments: '{"command":"ls"}', call_id: 'c1' }),
      ri('function_call_output', { call_id: 'c1', output: 'ok' }),
    ]
    const msgs = lines
      .map((r) => codexRecordToConversationMessage(r as Record<string, unknown>))
      .filter((m): m is NonNullable<typeof m> => m !== null)

    // 文字卡：user '23'（一次）、assistant '收到。'（一次）—— 鏡像被過濾
    const userTexts = msgs.filter((m) => m.role === 'user').flatMap((m) => m.blocks).filter((b) => b.kind === 'text')
    expect(userTexts.map((b) => b.text)).toEqual(['23'])
    const asstTexts = msgs
      .filter((m) => m.role === 'assistant')
      .flatMap((m) => m.blocks)
      .filter((b) => b.kind === 'text')
    expect(asstTexts.map((b) => b.text)).toEqual(['收到。'])

    // tool_use + tool_result 各一、call_id 對得上
    const toolUse = msgs.flatMap((m) => m.blocks).filter((b) => b.kind === 'tool_use')
    const toolRes = msgs.flatMap((m) => m.blocks).filter((b) => b.kind === 'tool_result')
    expect(toolUse).toHaveLength(1)
    expect(toolRes).toHaveLength(1)
    expect(toolUse[0].id).toBe(toolRes[0].tool_use_id)

    // 一筆 system/turnDuration（task_complete；duration_ms=100 → 取自 record）
    const sys = msgs.filter((m) => m.role === 'system')
    expect(sys).toHaveLength(1)
    expect(sys[0].turnDuration).toEqual({ durationMs: 100 })

    // 卡片數 > 0；總計 user(1)+assistant text(1)+tool_use(1)+tool_result(1)+system(1) = 5
    expect(msgs.length).toBe(5)
  })

  it('純函式決定性：同輸入多次呼叫得相同輸出', () => {
    const rec = ev('user_message', { message: 'hello' })
    const a = codexRecordToConversationMessage(rec)
    const b = codexRecordToConversationMessage(rec)
    expect(a).toEqual(b)
    // 不修改輸入物件
    expect(rec).toEqual(ev('user_message', { message: 'hello' }))
  })
})
