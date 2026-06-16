import { ipcRenderer } from "electron";
import {
  MILESTONE_CHANNELS,
  MilestonesFindAllPayload,
  MilestoneCreatePayload,
  MilestoneUpdatePayload,
  MilestoneMembersResult,
  MilestonesFindAllResult,
  MilestoneDto,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.milestones — 本地里程碑 CRUD（Phase 6.5）
// ---------------------------------------------------------------------------

export const milestones = {
  findAll(
    payload?: MilestonesFindAllPayload,
  ): Promise<IpcResult<MilestonesFindAllResult>> {
    return ipcRenderer.invoke(MILESTONE_CHANNELS.FIND_ALL, payload ?? {});
  },
  create(payload: MilestoneCreatePayload): Promise<IpcResult<MilestoneDto>> {
    return ipcRenderer.invoke(MILESTONE_CHANNELS.CREATE, payload);
  },
  update(payload: MilestoneUpdatePayload): Promise<IpcResult<MilestoneDto>> {
    return ipcRenderer.invoke(MILESTONE_CHANNELS.UPDATE, payload);
  },
  delete(localId: string): Promise<IpcResult> {
    return ipcRenderer.invoke(MILESTONE_CHANNELS.DELETE, { localId });
  },
  findMembers(
    milestoneLocalId: string,
  ): Promise<IpcResult<MilestoneMembersResult>> {
    return ipcRenderer.invoke(MILESTONE_CHANNELS.FIND_MEMBERS, {
      milestoneLocalId,
    });
  },
};
