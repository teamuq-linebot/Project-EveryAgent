/**
 * Codex rollout records → work_timeline rows（純函式）。
 *
 * 把 ~/.codex/sessions 的 rollout JSONL（已 readJsonl 成 record 陣列）依「回合」切段，
 * 產出與 claude buildWorkTimeline **同契約**的 work_timeline rows，供 punchCore
 * （collectPunchEventsCore）以相同邏輯算打卡事件。
 *
 * 與 claude 的差異：codex 無 subagent（無 Task/Agent 工具），故只產 main-user / main-ai：
 *   - 每回合一筆 main-user（input_prompt = 使用者訊息）＋一筆 main-ai（agent_manager 打卡來源）。
 *   - main-ai 帶 stop:'end_turn'（task_complete 收尾時）→ punchCore isEndTurn() 判定完成。
 *   - request_id = `codex-turn-<round>`（穩定 → punch_uid `main|<sessionId>|<request_id>` 跨掃描去重）。
 *
 * 回合邊界（依本機真檔 rollout 型別）：
 *   - event_msg/task_started  → 開新回合（round+1）；生成起始時戳。
 *   - event_msg/user_message  → 該回合使用者輸入文字 + 時戳。**真檔順序為 task_started 先、
 *       user_message 後**，故優先回填「當前已開但 userText 仍空」的回合；若 user_message 先到
 *       （無當前回合）則暫存給下一個 task_started（兩種順序皆相容）。
 *   - event_msg/agent_message → 該回合最後 assistant 輸出（last wins）。
 *   - event_msg/task_complete → 收尾本回合（ended_at = 時戳；duration_ms = payload.duration_ms）。
 *   - 無 task_complete 收尾的回合（中斷 / 進行中）→ ended_at = null → 開卡（未完成）。
 *
 * leaf 模組：只 import shared 型別，不 import claude 來源（codex/claude 互不耦合）。
 * 純函式：同輸入同輸出、無外部狀態（store 會 byte 切片重讀同段，須與初解一致）。
 */

/** 安全取頂層 timestamp（ISO 字串）；非字串回 undefined。 */
function topTimestamp(rec: Record<string, unknown>): string | undefined {
  const ts = rec['timestamp'];
  return typeof ts === 'string' && ts ? ts : undefined;
}

/** 安全取 payload 物件；非物件回 {}。 */
function payloadOf(rec: Record<string, unknown>): Record<string, unknown> {
  const p = rec['payload'];
  return p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {};
}

/** 累積中的回合狀態。 */
interface CodexTurn {
  round: number;
  /** 觸發回合的 user 訊息時戳（無則退回 task_started 時戳）。 */
  userTs: string | undefined;
  /** 生成起始時戳（task_started 時戳；無則退回 userTs）。 */
  genStartedAt: string | undefined;
  /** 使用者輸入文字（input_prompt）。 */
  userText: string;
  /** 最後一筆 agent_message 文字（last wins）。 */
  lastOutput: string;
  /** 收尾時戳（task_complete）；未收尾 → null（開卡）。 */
  endedAt: string | null;
  /** task_complete.duration_ms；缺 / 非數值 → null。 */
  durationMs: number | null;
}

/** 回合 → main-user + main-ai 兩筆 work_timeline rows。 */
function emitTurn(turn: CodexTurn, rows: Record<string, unknown>[]): void {
  const userStart = turn.userTs ?? turn.genStartedAt ?? null;
  const genStart = turn.genStartedAt ?? turn.userTs ?? null;

  rows.push({
    kind: 'main-user',
    started_at: userStart,
    ended_at: userStart,
    duration_ms: null,
    title: '使用者訊息',
    detail: '',
    source: 'main',
    round: turn.round,
    input_prompt: turn.userText,
  });

  rows.push({
    kind: 'main-ai',
    started_at: genStart,
    ended_at: turn.endedAt,
    duration_ms: turn.durationMs,
    title: 'Codex 回合',
    stop: turn.endedAt ? 'end_turn' : null,
    detail: turn.endedAt ? 'stop: end_turn' : '',
    source: 'main',
    request_id: `codex-turn-${turn.round}`,
    round: turn.round,
    last_output: turn.lastOutput,
  });
}

/**
 * rollout records → work_timeline rows（main-user / main-ai 交錯，依回合序）。
 * @param records readJsonl 後的 record 物件陣列（每筆 {type, payload, timestamp}）。
 */
export function buildCodexWorkTimeline(
  records: ReadonlyArray<Record<string, unknown>>,
): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  let round = 0;
  let pendingUser: { text: string; ts: string | undefined } | null = null;
  let current: CodexTurn | null = null;

  for (const rec of records) {
    if (!rec || typeof rec !== 'object') continue;
    if (rec['type'] !== 'event_msg') continue;
    const payload = payloadOf(rec);
    const pType = payload['type'];
    const ts = topTimestamp(rec);

    if (pType === 'user_message') {
      const m = payload['message'];
      if (typeof m === 'string' && m) {
        // 真檔順序：task_started 先開回合、user_message 後到 → 回填當前回合（userText 仍空）。
        if (current && !current.userText) {
          current.userText = m;
          current.userTs = ts;
        } else {
          // user_message 先於 task_started（相容舊假設）→ 暫存給下一回合。
          pendingUser = { text: m, ts };
        }
      }
      continue;
    }

    if (pType === 'task_started') {
      // 前一回合若未經 task_complete 收尾（中斷）→ 以開卡狀態先送出。
      if (current) emitTurn(current, rows);
      round += 1;
      current = {
        round,
        userTs: pendingUser?.ts ?? ts,
        genStartedAt: ts,
        userText: pendingUser?.text ?? '',
        lastOutput: '',
        endedAt: null,
        durationMs: null,
      };
      pendingUser = null;
      continue;
    }

    if (pType === 'agent_message') {
      const m = payload['message'];
      if (current && typeof m === 'string' && m) current.lastOutput = m;
      continue;
    }

    if (pType === 'task_complete') {
      if (current) {
        current.endedAt = ts ?? null;
        const dur = Number(payload['duration_ms']);
        current.durationMs = Number.isFinite(dur) ? dur : null;
        emitTurn(current, rows);
        current = null;
      }
      continue;
    }
  }

  // 收尾：仍開著的回合（進行中 / 末段無 task_complete）→ 開卡送出。
  if (current) emitTurn(current, rows);

  return rows;
}
