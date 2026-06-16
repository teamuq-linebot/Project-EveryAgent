import { ipcRenderer } from "electron";
import {
  TEAM_REGISTRY_CHANNELS,
  RegisterTeamPayload,
  RegisterTeamResult,
  UnregisterTeamPayload,
  UnregisterTeamResult,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.teamRegistry — 團隊 claude skill 連結（team-registration-20260608）
// ---------------------------------------------------------------------------

export const teamRegistry = {
  /** 把 team 入口 skill junction 連結到 ~/.claude/skills（claude 平台）。 */
  register(payload: RegisterTeamPayload): Promise<IpcResult<RegisterTeamResult>> {
    return ipcRenderer.invoke(TEAM_REGISTRY_CHANNELS.REGISTER, payload);
  },
  /** 移除已連結的 skill junction 與/或 codex 產生物。 */
  unregister(payload: UnregisterTeamPayload): Promise<IpcResult<UnregisterTeamResult>> {
    return ipcRenderer.invoke(TEAM_REGISTRY_CHANNELS.UNREGISTER, payload);
  },
  /** 同步/更新 team 入口 skill（重跑 register 冪等邏輯；預設兩平台都同步）。 */
  sync(payload: RegisterTeamPayload): Promise<IpcResult<RegisterTeamResult>> {
    return ipcRenderer.invoke(TEAM_REGISTRY_CHANNELS.SYNC, payload);
  },
};
