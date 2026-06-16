import { ipcRenderer } from "electron";
import {
  CONFIG_CHANNELS,
  ConfigSetMilestonePayload,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.config — milestone 設定讀寫
// ---------------------------------------------------------------------------

/** Milestone entry shape returned from config:getMilestone */
interface MilestoneEntryResult {
  project_path: string | null;
  tool: string;
  custom_command: string | null;
}

export const config = {
  getMilestone(
    milestoneId: string,
  ): Promise<IpcResult<MilestoneEntryResult | null>> {
    return ipcRenderer.invoke(CONFIG_CHANNELS.GET_MILESTONE, { milestoneId });
  },
  setMilestone(
    payload: ConfigSetMilestonePayload,
  ): Promise<IpcResult<MilestoneEntryResult>> {
    return ipcRenderer.invoke(CONFIG_CHANNELS.SET_MILESTONE, payload);
  },
};
