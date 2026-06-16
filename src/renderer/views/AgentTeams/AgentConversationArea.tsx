/**
 * AgentConversationArea.tsx — AgentTeams 多對話右欄 shell
 *
 * 包覆 AgentConversationPane 的薄殼，將 AgentConversation hook 資料透傳給 Pane。
 *   - 外層 at-conv-shell：flex row，Pane flex:1。
 *   - 餵 active 的資料給 Pane；sendInput / selectOption 作用於當前對話；
 *     onClose 關當前條；onRestart 以相同 label+prompt 重開一條新對話。
 *   - conversations.length === 0 時，本元件由父層（AgentTeamsView）不渲染（右欄消失）。
 *     此處以 active 防呆：理論上有對話必有 active，但加 active && 守住。
 *   - termExpanded / onToggleTerm 由 AgentTeamsView 提升傳入，此元件做 prop drilling。
 *
 * 純展示薄殼：不持有 hook，全部由 props 注入。
 * 本元件完全不 import session 模組。
 * agentteams-shared-conv-20260611 §step-3
 */
import React from "react";
import type { AgentTeamCreateSpecInput } from "../../../shared/ipcContracts";
import type { AgentConversation } from "../../hooks/useAgentConversation";
import { AgentConversationPane } from "./AgentConversationPane";


interface Props {
  conv: AgentConversation;
  onRestart: (label: string, prompt: string, cliId?: string) => void;
  /** 繼續對話（claude --resume）：以既有 conversationId 續接同一 session、保留 context。 */
  onResume?: (conversationId: string) => void;
  onTeamCreated?: () => void;
  /** 終端抽屜是否展開（由 AgentTeamsView 提升管理，prop drilling）。 */
  termExpanded: boolean;
  /** 翻轉終端抽屜展開狀態（由 AgentTeamsView 管理）。 */
  onToggleTerm: () => void;
  /**
   * 偵測到的建隊 spec 變化時回拋（含 null）；透傳自 Pane。
   * 第二參數 conversationId = 來源對話 id，供上層綁定預覽卡來源（F2 跨對話失配修復）。
   * 供上層（AgentTeamsView）在群組內就地長出即時預覽卡。
   * agent-teams-live-preview-card-20260613 批 1。
   */
  onCreateSpecChange?: (spec: AgentTeamCreateSpecInput | null, conversationId: string) => void;
  /** 偵測到規格化完成 marker 時回拋 teamId；透傳自 Pane。供上層清「待優化」徽章。Batch 2b。 */
  onStandardizedDetected?: (teamId: string) => void;
  /**
   * 偵測到的建隊 spec 之 teamId 已存在於目前 teams → 隱藏 Pane 底部「偵測到建隊 spec」in-pane 列。
   * agentteams-stale-detection-row-20260613。
   */
  specAlreadyCreated?: boolean;
  /**
   * 送出結構化選擇題卡片（AskUserQuestion）回應；透傳自 Pane。
   * 通常由父層傳入 conv.submitAsk。agentteams-ask-card（批 4）。
   */
  onSubmitAsk?: AgentConversation["submitAsk"];
}

export function AgentConversationArea({ conv, onRestart, onResume, onTeamCreated, termExpanded, onToggleTerm, onCreateSpecChange, onStandardizedDetected, specAlreadyCreated, onSubmitAsk }: Props): React.JSX.Element {
  const active = conv.active;

  return (
    <div className="at-conv-shell">

      {/* 當前對話面板 */}
      {active && (
        <AgentConversationPane
          conversationId={active.conversationId}
          label={active.label}
          cwd={active.cwd}
          pending={active.pending}
          done={active.done}
          busy={active.busy}
          promptOptions={active.promptOptions}
          cliId={active.cliId}
          initialSkill={active.initialSkill}
          onSendInput={conv.sendInput}
          onClose={() => conv.close(active.conversationId)}
          onSelectOption={conv.selectOption}
          onRestart={() => onRestart(active.label, active.prompt, active.cliId)}
          onResume={onResume}
          onTeamCreated={onTeamCreated}
          termExpanded={termExpanded}
          onToggleTerm={onToggleTerm}
          onCreateSpecChange={onCreateSpecChange}
          onStandardizedDetected={onStandardizedDetected}
          specAlreadyCreated={specAlreadyCreated}
          onSubmitAsk={onSubmitAsk ?? conv.submitAsk}
        />
      )}
    </div>
  );
}
