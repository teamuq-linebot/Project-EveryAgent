import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  AGENT_REGISTRY_CHANNELS,
  AgentRegistrySetEnabledSchema,
  AgentRegistrySetStandardizedSchema,
  AgentRegistryItemDto,
  IpcResult,
} from "../../../shared/ipcContracts";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerAgentRegistryHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // agentRegistry:getAll — 回傳全部 agent_registry 列（Dto 陣列）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    AGENT_REGISTRY_CHANNELS.GET_ALL,
    (_event: IpcMainInvokeEvent): IpcResult<AgentRegistryItemDto[]> => {
      try {
        const rows = backend.agentTeams.getAgentRegistry();
        const dtos: AgentRegistryItemDto[] = rows.map((row) => ({
          agentId: row.agent_id,
          displayName: row.display_name,
          title: row.title,
          teamId: row.team_id,
          skillName: row.skill_name,
          remark: row.remark,
          enabled: row.enabled === 1,
          standardized: row.standardized === 1,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));
        return ok(dtos);
      } catch (e) {
        return err(e);
      }
    },
  );

  // --------------------------------------------------------------------------
  // agentRegistry:upsertFromScan — 先 scanAgentOrg 再批次 upsert
  // --------------------------------------------------------------------------

  ipcMain.handle(
    AGENT_REGISTRY_CHANNELS.UPSERT_FROM_SCAN,
    async (_event: IpcMainInvokeEvent): Promise<IpcResult<AgentRegistryItemDto[]>> => {
      try {
        const tree = await backend.agentTeams.scanAgentOrg();
        const dtos = await backend.agentTeams.upsertRegistryFromScan(tree);
        return ok(dtos);
      } catch (e) {
        return err(e);
      }
    },
  );

  // --------------------------------------------------------------------------
  // agentRegistry:setEnabled — 切換 enabled 旗標
  // --------------------------------------------------------------------------

  ipcMain.handle(
    AGENT_REGISTRY_CHANNELS.SET_ENABLED,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<boolean> => {
      try {
        const payload = AgentRegistrySetEnabledSchema.parse(raw);
        const changed = backend.agentTeams.setAgentRegistryEnabled(
          payload.agentId,
          payload.enabled,
        );
        return ok(changed);
      } catch (e) {
        return err(e);
      }
    },
  );

  // --------------------------------------------------------------------------
  // agentRegistry:setStandardized — 切換 standardized 旗標
  // --------------------------------------------------------------------------

  ipcMain.handle(
    AGENT_REGISTRY_CHANNELS.SET_STANDARDIZED,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<boolean> => {
      try {
        const payload = AgentRegistrySetStandardizedSchema.parse(raw);
        const changed = backend.agentTeams.setAgentRegistryStandardized(
          payload.agentId,
          payload.standardized,
        );
        return ok(changed);
      } catch (e) {
        return err(e);
      }
    },
  );
}
