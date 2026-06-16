/**
 * useAgentConvSegments.ts — AgentTeams 對話段落計算 hook（renderer-only，zero IPC/zero DB）
 *
 * signature: useAgentConvSegments(messages: ConversationMessage[]): Seg[]
 *
 * 內部呼叫 buildSegments(messages) 並以 useMemo 包裹，避免每 render 重算。
 * 直接複用 conversation/claude/helpers.tsx 的 buildSegments（stale-preload legacy 路徑）。
 *
 * agentteams-shared-conv-20260611 step-1
 */
import { useMemo } from "react";
import type { ConversationMessage } from "../../../shared/ipcContracts";
import { buildSegments } from "../conversation/claude/helpers";

export type { Seg, SegItem } from "../conversation/claude/helpers";

/**
 * 從 ConversationMessage[] 計算段落結構（Seg[]），並 memoize。
 * messages 陣列參照不變時不重算。
 */
export function useAgentConvSegments(messages: ConversationMessage[]) {
  return useMemo(() => buildSegments(messages), [messages]);
}
