import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  TEAM_REGISTRY_CHANNELS,
  RegisterTeamSchema,
  RegisterTeamResult,
  UnregisterTeamSchema,
  UnregisterTeamResult,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerTeamRegistryHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Team Registry handlers（團隊 claude skill 連結；team-registration-20260608）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    TEAM_REGISTRY_CHANNELS.REGISTER,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<RegisterTeamResult>> => {
      try {
        const payload = RegisterTeamSchema.parse(raw);
        return ok<RegisterTeamResult>(await backend.agentTeams.registerTeam(payload));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    TEAM_REGISTRY_CHANNELS.UNREGISTER,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<UnregisterTeamResult>> => {
      try {
        const payload = UnregisterTeamSchema.parse(raw);
        return ok<UnregisterTeamResult>(await backend.agentTeams.unregisterTeam(payload));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    TEAM_REGISTRY_CHANNELS.SYNC,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<RegisterTeamResult>> => {
      try {
        const payload = RegisterTeamSchema.parse(raw);
        return ok<RegisterTeamResult>(await backend.agentTeams.syncTeam(payload));
      } catch (e) {
        return err(e);
      }
    },
  );
}
