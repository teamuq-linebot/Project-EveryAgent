import { ipcMain, IpcMainInvokeEvent, shell } from "electron";
import * as fs from "fs";
import * as path from "path";
import {
  AGENT_ORG_CHANNELS,
  AgentOrgScanSchema,
  AgentOrgGetDetailSchema,
  AgentOrgGetRootSchema,
  AgentOrgSetRootSchema,
  AgentOrgSaveDraftSchema,
  AgentOrgGetDraftSchema,
  AgentOrgClearDraftSchema,
  AgentOrgBackupIntroSchema,
  AgentOrgOpenTeamFolderSchema,
  AgentOrgCreateEntrySkillSchema,
  AgentTeamCreateSpecSchema,
  AgentOrgListSourcesSchema,
  AgentOrgAddSourceSchema,
  AgentOrgRemoveSourceSchema,
  AgentOrgUpdateSourceSchema,
  ApplyGroupSourcePayloadSchema,
  AgentOrgTree,
  AgentDetailDto,
  AgentOrgRootInfo,
  AgentOrgDraftResult,
  AgentTeamCreateResult,
  AgentOrgCreateEntrySkillResult,
  ApplyGroupSourceResult,
  TeamSource,
  teamPathPart,
  IpcResult,
} from "../../../shared/ipcContracts";
import { z } from "zod";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

/** agentOrg:watchDraft — 開始監看指定 agent 草稿（teamId + agentName）。 */
const AgentOrgWatchDraftSchema = z.object({
  teamId: z.string().min(1),
  agentName: z.string().min(1),
});

/** agentOrg:unwatchDraft — 停止監看指定 agent 草稿（teamId + agentName）。 */
const AgentOrgUnwatchDraftSchema = z.object({
  teamId: z.string().min(1),
  agentName: z.string().min(1),
});

export function registerAgentOrgHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // AgentOrg handlers（AI 團隊掃描；agent-teams-view-impl-20260607）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    AGENT_ORG_CHANNELS.SCAN,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<AgentOrgTree>> => {
      try {
        AgentOrgScanSchema.parse(raw ?? {});
        return ok<AgentOrgTree>(await backend.agentTeams.scanAgentOrg());
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.GET_DETAIL,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<AgentDetailDto | null>> => {
      try {
        const payload = AgentOrgGetDetailSchema.parse(raw);
        return ok<AgentDetailDto | null>(
          (await backend.agentTeams.getAgentOrgDetail(payload)) as AgentDetailDto | null,
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.GET_ROOT,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<AgentOrgRootInfo> => {
      try {
        AgentOrgGetRootSchema.parse(raw ?? {});
        return ok<AgentOrgRootInfo>(backend.agentTeams.getAgentOrgRoot());
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.SET_ROOT,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<void>> => {
      try {
        const payload = AgentOrgSetRootSchema.parse(raw);
        await backend.agentTeams.setAgentOrgRoot(payload.path);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  // --------------------------------------------------------------------------
  // Introduction 草稿 — draft→diff→apply 後端鏈（agentteams-edit-flow §4、§6.1）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    AGENT_ORG_CHANNELS.SAVE_DRAFT,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<void>> => {
      try {
        const payload = AgentOrgSaveDraftSchema.parse(raw);
        await backend.agentTeams.saveIntroductionDraft(payload);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.GET_DRAFT,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<AgentOrgDraftResult>> => {
      try {
        const payload = AgentOrgGetDraftSchema.parse(raw);
        return ok<AgentOrgDraftResult>(
          await backend.agentTeams.getIntroductionDraft(payload),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.CLEAR_DRAFT,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<void>> => {
      try {
        const payload = AgentOrgClearDraftSchema.parse(raw);
        await backend.agentTeams.clearIntroductionDraft(payload);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.BACKUP_INTRO,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<void>> => {
      try {
        const payload = AgentOrgBackupIntroSchema.parse(raw);
        await backend.agentTeams.backupIntroduction(
          payload.teamId,
          payload.agentName,
        );
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.CREATE_TEAM_FROM_SPEC,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<AgentTeamCreateResult>> => {
      try {
        const spec = AgentTeamCreateSpecSchema.parse(raw);
        return ok<AgentTeamCreateResult>(
          await backend.agentTeams.createTeamFromSpec(spec),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.CREATE_ENTRY_SKILL,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<AgentOrgCreateEntrySkillResult>> => {
      try {
        const payload = AgentOrgCreateEntrySkillSchema.parse(raw);
        return ok<AgentOrgCreateEntrySkillResult>(
          await backend.agentTeams.createEntrySkill(payload),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.OPEN_TEAM_FOLDER,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<null>> => {
      try {
        const payload = AgentOrgOpenTeamFolderSchema.parse(raw);
        // <agents 根> 結尾即 ...\agents；團隊資料夾 = <該團隊來源根>/<團隊路徑段>
        // 多來源：來源根用該團隊所屬來源（複合鍵歸屬 resolveTeamSourceRoot）；
        // 路徑段用 teamPathPart 去掉 `sourceId::` 前綴（非預設來源團隊 id 為 sourceId::teamId）。
        // 單一 default 來源 + 裸 teamId 時 resolveTeamSourceRoot===getAgentOrgRoot().path、
        // teamPathPart 原樣回傳，行為與單根時代逐字一致。teamId 可能含 '/' 子團隊，path.join 正規化分隔符。
        const folder = path.join(
          backend.agentTeams.resolveTeamSourceRoot(payload.teamId),
          teamPathPart(payload.teamId),
        );
        if (!fs.existsSync(folder)) {
          return err("找不到這個團隊的資料夾：" + folder);
        }
        // shell.openPath 成功回空字串、失敗回錯誤訊息字串。
        const openErr = await shell.openPath(folder);
        if (openErr) {
          return err("開啟資料夾失敗：" + openErr);
        }
        return ok<null>(null);
      } catch (e) {
        return err(e);
      }
    },
  );

  // --------------------------------------------------------------------------
  // 多來源團隊 — 來源清單管理 handlers（docs/multi-source-teams.md Phase 2）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    AGENT_ORG_CHANNELS.LIST_SOURCES,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<TeamSource[]> => {
      try {
        AgentOrgListSourcesSchema.parse(raw ?? {});
        return ok<TeamSource[]>(backend.agentTeams.listSources());
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.ADD_SOURCE,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<TeamSource[]>> => {
      try {
        const payload = AgentOrgAddSourceSchema.parse(raw);
        return ok<TeamSource[]>(await backend.agentTeams.addSource(payload));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.REMOVE_SOURCE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<TeamSource[]> => {
      try {
        const payload = AgentOrgRemoveSourceSchema.parse(raw);
        return ok<TeamSource[]>(backend.agentTeams.removeSource(payload.id));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.UPDATE_SOURCE,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<TeamSource[]>> => {
      try {
        const payload = AgentOrgUpdateSourceSchema.parse(raw);
        return ok<TeamSource[]>(await backend.agentTeams.updateSource(payload));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    AGENT_ORG_CHANNELS.APPLY_GROUP_SOURCE,
    async (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): Promise<IpcResult<ApplyGroupSourceResult>> => {
      try {
        const payload = ApplyGroupSourcePayloadSchema.parse(raw);
        return ok<ApplyGroupSourceResult>(
          await backend.agentTeams.applyGroupSource(payload),
        );
      } catch (e) {
        return err(e);
      }
    },
  );

  // --------------------------------------------------------------------------
  // fs.watch 草稿監看 handlers（agentteams-edit-flow §4.4 — AI 共編推播）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    "agentOrg:watchDraft",
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<void> => {
      try {
        const payload = AgentOrgWatchDraftSchema.parse(raw);
        backend.watchAgentDraft(payload.teamId, payload.agentName);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    "agentOrg:unwatchDraft",
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<void> => {
      try {
        const payload = AgentOrgUnwatchDraftSchema.parse(raw);
        backend.unwatchAgentDraft(payload.teamId, payload.agentName);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );
}
