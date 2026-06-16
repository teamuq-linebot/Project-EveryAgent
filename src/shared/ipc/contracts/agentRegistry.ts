import { z } from "zod";

// ---------------------------------------------------------------------------
// agentRegistry contracts（agent_registry 表 IPC 四件套；B5 第 2/3 批）
// ---------------------------------------------------------------------------

export const AGENT_REGISTRY_CHANNELS = {
  /** 回傳全部 agent_registry 列（Dto 陣列）。 */
  GET_ALL: "agentRegistry:getAll",
  /** 先 scanAgentOrg 再 upsertRegistryFromScan（冪等批次更新）。 */
  UPSERT_FROM_SCAN: "agentRegistry:upsertFromScan",
  /** 切換單一 agent 的 enabled 旗標。 */
  SET_ENABLED: "agentRegistry:setEnabled",
  /** 切換單一 agent 的 standardized 旗標（清除待優化徽章）。 */
  SET_STANDARDIZED: "agentRegistry:setStandardized",
} as const;

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

/** agentRegistry:setEnabled 請求 payload。 */
export const AgentRegistrySetEnabledSchema = z.object({
  agentId: z.string().min(1),
  enabled: z.boolean(),
});
export type AgentRegistrySetEnabledPayload = z.infer<
  typeof AgentRegistrySetEnabledSchema
>;

/** agentRegistry:setStandardized 請求 payload。 */
export const AgentRegistrySetStandardizedSchema = z.object({
  agentId: z.string().min(1),
  standardized: z.boolean(),
});
export type AgentRegistrySetStandardizedPayload = z.infer<
  typeof AgentRegistrySetStandardizedSchema
>;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

/**
 * renderer 側使用的 AgentRegistry 資料傳輸物件（對應 AgentRegistryRow）。
 * enabled 統一以 boolean 表示（DB INTEGER 在此轉換）。
 */
export interface AgentRegistryItemDto {
  agentId: string;
  displayName: string | null;
  title: string | null;
  teamId: string | null;
  skillName: string | null;
  remark: string | null;
  enabled: boolean;
  /** 是否已規格化（true=已規格化 / false=待優化）。快速建立的團隊預設 false。 */
  standardized: boolean;
  createdAt: string;
  updatedAt: string;
}
