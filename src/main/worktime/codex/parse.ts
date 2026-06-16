/**
 * Codex rollout record → ConversationMessage（逐筆純函式映射）。
 *
 * 與 claude 的 recordToConversationMessage（worktime/claude/index.ts）簽名平行，
 * 供 conversationStore 依 tool 分流逐筆呼叫。store 會 byte 切片重讀同一段，故本函式
 * 必須是**純函式**（同輸入同輸出、無外部狀態），保證重讀結果與初解一致。
 *
 * 映射依據：本機真檔 ~/.codex/sessions/<Y>/<M>/<D>/rollout-*.jsonl（已親驗各 record 型別）。
 * leaf 模組：只 import shared 型別，不 import claude 來源（codex/claude 互不耦合）。
 */

import type { ConversationMessage, ConvBlock } from '../../../shared/ipcContracts';

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

/**
 * 單筆 codex rollout record → ConversationMessage（無可顯示內容 / 應過濾 → null）。
 *
 * 映射表（= plan §4.2）：
 *  - event_msg/user_message（message 非空）   → user/typed + text
 *  - event_msg/agent_message（message 非空）  → assistant + text（phase 不影響）
 *  - event_msg/task_complete                  → system + turnDuration（durationMs=payload.duration_ms||0）
 *  - event_msg/task_started | token_count     → null
 *  - response_item/function_call（有 name）    → assistant + tool_use（name/arguments/call_id）
 *  - response_item/function_call_output（有 call_id） → assistant/tool_result + tool_result
 *  - response_item/message（developer/user/assistant） → null（注入雜訊 / 去重）
 *  - response_item/reasoning                  → null（encrypted_content 無明文）
 *  - response_item/turn_context | session_meta | 其他 → null
 */
export function codexRecordToConversationMessage(
  rec: Record<string, unknown>,
): ConversationMessage | null {
  if (!rec || typeof rec !== 'object') return null;
  const type = rec['type'];
  const payload = payloadOf(rec);
  const timestamp = topTimestamp(rec);

  if (type === 'event_msg') {
    const pType = payload['type'];
    if (pType === 'user_message') {
      const message = payload['message'];
      if (typeof message !== 'string' || !message) return null;
      return {
        role: 'user',
        source: 'typed',
        timestamp,
        blocks: [{ kind: 'text', text: message }],
      };
    }
    if (pType === 'agent_message') {
      const message = payload['message'];
      if (typeof message !== 'string' || !message) return null;
      // phase（commentary / final_answer）不影響 block；皆顯示為 assistant 文字。
      return {
        role: 'assistant',
        timestamp,
        blocks: [{ kind: 'text', text: message }],
      };
    }
    if (pType === 'task_complete') {
      // END 訊息：觸發 store 分段收尾 + UI turn 分隔線。
      // 分段正確性只靠「這是 turnDuration 型訊息」，不靠數值；但實樣 task_complete 的
      // payload.duration_ms 確實可靠（真檔驗證），故取自 record 本身填入（仍純函式、無歧義）。
      // 缺 / 非數值 → 0。
      const durationMs = Number(payload['duration_ms']) || 0;
      return {
        role: 'system',
        timestamp,
        blocks: [],
        turnDuration: { durationMs },
      };
    }
    // task_started（無顯示內容）/ token_count（本批不附 usage，D-USAGE）→ 不成卡。
    return null;
  }

  if (type === 'response_item') {
    const pType = payload['type'];
    if (pType === 'function_call') {
      const name = payload['name'];
      if (typeof name !== 'string' || !name) return null;
      const block: ConvBlock = {
        kind: 'tool_use',
        name,
        text: typeof payload['arguments'] === 'string' ? payload['arguments'] : '',
      };
      if (typeof payload['call_id'] === 'string') block.id = payload['call_id'];
      return {
        role: 'assistant',
        timestamp,
        blocks: [block],
      };
    }
    if (pType === 'function_call_output') {
      const callId = payload['call_id'];
      if (typeof callId !== 'string' || !callId) return null;
      const block: ConvBlock = {
        kind: 'tool_result',
        text: typeof payload['output'] === 'string' ? payload['output'] : '',
        tool_use_id: callId,
      };
      return {
        role: 'assistant',
        source: 'tool_result',
        timestamp,
        blocks: [block],
      };
    }
    // message（developer 注入 / user / assistant 鏡像）：一律過濾。
    //  - developer：權限/skills/plugins 注入雜訊。
    //  - user / assistant：文字已由 event_msg/{user_message,agent_message} 提供，
    //    保留會雙出重複卡片 → 去重（plan §5「單一來源」原則）。
    // reasoning：只有 encrypted_content 無明文 → 不產 thinking 卡（D-THINK）。
    // turn_context：turn 中繼資料，無顯示內容。
    return null;
  }

  // session_meta（discover 用，不成卡）/ 其他無法判讀 → null。
  return null;
}
