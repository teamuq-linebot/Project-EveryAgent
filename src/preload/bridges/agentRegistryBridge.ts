import { ipcRenderer } from "electron";
import {
  AGENT_REGISTRY_CHANNELS,
  AgentRegistrySetEnabledPayload,
  AgentRegistrySetStandardizedPayload,
  AgentRegistryItemDto,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.agentRegistry — agent_registry IPC bridge（agentteams-ab-20260611）
// ---------------------------------------------------------------------------

export const agentRegistry = {
  /** 回傳全部 agent_registry 列（Dto 陣列）。 */
  getAll(): Promise<IpcResult<AgentRegistryItemDto[]>> {
    return ipcRenderer.invoke(AGENT_REGISTRY_CHANNELS.GET_ALL);
  },
  /**
   * 先 scanAgentOrg 再批次 upsert agent_registry（冪等；回傳本次更新後的全部 Dto）。
   */
  upsertFromScan(): Promise<IpcResult<AgentRegistryItemDto[]>> {
    return ipcRenderer.invoke(AGENT_REGISTRY_CHANNELS.UPSERT_FROM_SCAN);
  },
  /** 切換單一 agent 的 enabled 旗標（回傳 true=值有變動）。 */
  setEnabled(
    payload: AgentRegistrySetEnabledPayload,
  ): Promise<IpcResult<boolean>> {
    return ipcRenderer.invoke(AGENT_REGISTRY_CHANNELS.SET_ENABLED, payload);
  },
  /** 切換單一 agent 的 standardized 旗標（回傳 true=值有變動）。 */
  setStandardized(
    payload: AgentRegistrySetStandardizedPayload,
  ): Promise<IpcResult<boolean>> {
    return ipcRenderer.invoke(
      AGENT_REGISTRY_CHANNELS.SET_STANDARDIZED,
      payload,
    );
  },
};
