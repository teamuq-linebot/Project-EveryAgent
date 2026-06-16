import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  MILESTONE_CHANNELS,
  MilestonesFindAllSchema,
  MilestoneCreateSchema,
  MilestoneUpdateSchema,
  MilestoneDeleteSchema,
  MilestoneFindMembersSchema,
  MilestonesFindAllResult,
  MilestoneDto,
  MilestoneMembersResult,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerMilestoneHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Milestone handlers（本地里程碑 CRUD；Phase 6.5，§2.6 / §4c）
  // 注意：與既有 CONFIG_CHANNELS（milestone 專案路徑/工具設定）正交 —— 此處是「實體」CRUD。
  // --------------------------------------------------------------------------

  ipcMain.handle(
    MILESTONE_CHANNELS.FIND_ALL,
    (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): IpcResult<MilestonesFindAllResult> => {
      try {
        const payload = MilestonesFindAllSchema.parse(raw ?? {});
        return ok<MilestonesFindAllResult>(
          backend.projects.findAllMilestones({
            projectLocalId: payload?.projectLocalId ?? null,
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    MILESTONE_CHANNELS.CREATE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<MilestoneDto> => {
      try {
        const payload = MilestoneCreateSchema.parse(raw);
        return ok<MilestoneDto>(
          backend.projects.createMilestone({
            name: payload.name,
            projectLocalId: payload.projectLocalId ?? null,
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    MILESTONE_CHANNELS.UPDATE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<MilestoneDto> => {
      try {
        const payload = MilestoneUpdateSchema.parse(raw);
        return ok<MilestoneDto>(
          backend.projects.updateMilestone({
            localId: payload.localId,
            name: payload.name,
          }),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    MILESTONE_CHANNELS.DELETE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const payload = MilestoneDeleteSchema.parse(raw);
        backend.projects.deleteMilestone(payload.localId);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    MILESTONE_CHANNELS.FIND_MEMBERS,
    (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): IpcResult<MilestoneMembersResult> => {
      try {
        const payload = MilestoneFindMembersSchema.parse(raw);
        return ok<MilestoneMembersResult>(
          backend.projects.findMilestoneMembers(payload.milestoneLocalId),
        );
      } catch (e) {
        return err(e);
      }
    },
  );
}
