import { ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";
import {
  AGENT_ORG_CHANNELS,
  AgentOrgTree,
  AgentDetailDto,
  AgentOrgGetDetailPayload,
  AgentOrgRootInfo,
  AgentOrgSaveDraftPayload,
  AgentOrgGetDraftPayload,
  AgentOrgClearDraftPayload,
  AgentOrgBackupIntroPayload,
  AgentOrgDraftResult,
  AgentOrgDraftUpdatedPayload,
  AgentTeamCreateSpecInput,
  AgentTeamCreateResult,
  AgentOrgCreateEntrySkillPayload,
  AgentOrgCreateEntrySkillResult,
  AgentOrgAddSourcePayload,
  AgentOrgUpdateSourcePayload,
  ApplyGroupSourcePayload,
  ApplyGroupSourceResult,
  TeamSource,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.agentOrg — AI 團隊掃描（agent-teams-view-impl-20260607）
// ---------------------------------------------------------------------------

export const agentOrg = {
  /** 掃描 AgentOrg 目錄回傳完整團隊樹（rootPath 由 main 端從 app_settings 或常數取）。 */
  scan(): Promise<IpcResult<AgentOrgTree>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.SCAN, {});
  },
  /** 取得單一 agent 詳細資料（含 workflow.yaml 原文 + soul.md 前 40 行）。 */
  getDetail(
    payload: AgentOrgGetDetailPayload,
  ): Promise<IpcResult<AgentDetailDto | null>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.GET_DETAIL, payload);
  },
  /** 取得目前生效的 AgentOrg 根目錄路徑（含 isCustom + defaultPath）。 */
  getRoot(): Promise<IpcResult<AgentOrgRootInfo>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.GET_ROOT, {});
  },
  /** 設定 AgentOrg 根目錄路徑（儲存前驗證路徑存在；空字串 = 清除自訂回 fallback）。 */
  setRoot(newPath: string): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.SET_ROOT, { path: newPath });
  },
  /** 儲存 introduction 草稿（main 端寫 introduction.draft.{hostname}.json）。 */
  saveDraft(payload: AgentOrgSaveDraftPayload): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.SAVE_DRAFT, payload);
  },
  /** 讀取本機草稿（含上游衝突偵測 conflict）。 */
  getDraft(
    payload: AgentOrgGetDraftPayload,
  ): Promise<IpcResult<AgentOrgDraftResult>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.GET_DRAFT, payload);
  },
  /** 刪除本機草稿檔（套用成功後清除；不存在視為成功）。 */
  clearDraft(payload: AgentOrgClearDraftPayload): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.CLEAR_DRAFT, payload);
  },
  /**
   * 套用前備份 introduction.json → introduction.backup.json（非阻塞保險；失敗不擋套用）。
   */
  backupIntroduction(
    payload: AgentOrgBackupIntroPayload,
  ): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.BACKUP_INTRO, payload);
  },
  /** 從結構化 spec 建立 AI 團隊、寫 registry DB，並同步 Claude/Codex/AGY skill。 */
  createTeamFromSpec(
    spec: AgentTeamCreateSpecInput,
  ): Promise<IpcResult<AgentTeamCreateResult>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.CREATE_TEAM_FROM_SPEC, spec);
  },
  /** 用檔案總管開啟某團隊在 AgentOrg 的資料夾（<agents 根>/<teamId>）。 */
  openTeamFolder(teamId: string): Promise<IpcResult<null>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.OPEN_TEAM_FOLDER, { teamId });
  },
  /**
   * 為「有團隊、無入口 skill」的團隊建立可攜入口 SKILL.md（寫到該團隊所屬來源的 .claude/skills）。
   * 不覆寫既有；skillName 省略時 main 端用 `tuq-<teamId 末段>`。
   */
  createEntrySkill(
    payload: AgentOrgCreateEntrySkillPayload,
  ): Promise<IpcResult<AgentOrgCreateEntrySkillResult>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.CREATE_ENTRY_SKILL, payload);
  },
  /** 列出目前所有團隊來源（含 fallback 合成的 default 來源）。 */
  listSources(): Promise<IpcResult<TeamSource[]>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.LIST_SOURCES, {});
  },
  /** 新增團隊來源（main 端驗證 path 存在後 append、自動產 id）；回傳更新後清單。 */
  addSource(payload: AgentOrgAddSourcePayload): Promise<IpcResult<TeamSource[]>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.ADD_SOURCE, payload);
  },
  /** 移除指定來源（不可移除最後一個）；回傳更新後清單。 */
  removeSource(id: string): Promise<IpcResult<TeamSource[]>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.REMOVE_SOURCE, { id });
  },
  /** 修改既有來源的 label / path（改 path 會驗證存在）；回傳更新後清單。 */
  updateSource(
    payload: AgentOrgUpdateSourcePayload,
  ): Promise<IpcResult<TeamSource[]>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.UPDATE_SOURCE, payload);
  },
  /** 開始 fs.watch 監看指定 agent 草稿檔（存草稿後呼叫）。 */
  watchDraft(payload: { teamId: string; agentName: string }): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.WATCH_DRAFT, payload);
  },
  /** 停止 fs.watch 監看（component unmount 時呼叫）。 */
  unwatchDraft(payload: { teamId: string; agentName: string }): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.UNWATCH_DRAFT, payload);
  },
  /** 把群組現有所有團隊實體搬移到指定來源資料夾，重建三平台 skill、改寫系統鍵。 */
  applyGroupSource(payload: ApplyGroupSourcePayload): Promise<IpcResult<ApplyGroupSourceResult>> {
    return ipcRenderer.invoke(AGENT_ORG_CHANNELS.APPLY_GROUP_SOURCE, payload);
  },
  /**
   * 訂閱 agentOrg:draftUpdated push（fs.watch 偵測到草稿變動後由 main 推播）。
   * 回傳 unsubscribe 函式；呼叫後移除 listener（React useEffect cleanup 用）。
   * draft = null 表示本次 JSON 壞掉，UI 應保留上一個有效版本。
   */
  onDraftUpdated(
    handler: (payload: AgentOrgDraftUpdatedPayload) => void,
  ): () => void {
    const listener = (
      _: IpcRendererEvent,
      payload: AgentOrgDraftUpdatedPayload,
    ) => handler(payload);
    ipcRenderer.on(AGENT_ORG_CHANNELS.DRAFT_UPDATED, listener);
    return () => ipcRenderer.off(AGENT_ORG_CHANNELS.DRAFT_UPDATED, listener);
  },
};
