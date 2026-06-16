/// <reference types="vite/client" />

import type {
  PtySpawnPayload,
  PtyDataPayload,
  PtyExitPayload,
  IpcResult,
  TasksFindAllPayload,
  TasksUpdatePayload,
  TasksCreatePayload,
  TaskDto,
  SessionOpenPayload,
  MonitorStartPayload,
  MonitorRenderPayload,
  MonitorStatusPayload,
  CardRunStatePayload,
  CardWorkflowProgressPayload,
  SessionInfo,
  BindSessionItem,
  ConversationMessage,
  SessionProjectResult,
  SkillItem,
  ConfigSetMilestonePayload,
  SubagentConversationResult,
  ConversationWindowResult,
  SegmentListResult,
  RawLinesResult,
  ConversationMessage,
  ProjectsFindAllPayload,
  ProjectCreatePayload,
  ProjectUpdatePayload,
  ProjectsByFolderPayload,
  ProjectsByFolderResult,
  ProjectsFoldersByProjectPayload,
  ProjectsFoldersByProjectResult,
  MilestonesFindAllPayload,
  MilestoneCreatePayload,
  MilestoneUpdatePayload,
  ProjectsFindAllResult,
  MilestonesFindAllResult,
  MilestoneMembersResult,
  ProjectDto,
  MilestoneDto,
  AdminWorkspaceInfo,
  AdminScope,
  PromptAlertPayload,
  SettingsSetPayload,
  CliId,
  CliStatusDto,
  CliVerifyResult,
  CliPlanDto,
  CliLoginSignature,
  CliOnboardingStateDto,
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
  TeamSource,
  AgentConvOpenPayload,
  AgentConvMessagesPayload,
  AgentConvRawPayload,
  AgentConvPromptStatePayload,
  AgentConvSessionDto,
  RegisterTeamPayload,
  RegisterTeamResult,
  UnregisterTeamPayload,
  UnregisterTeamResult,
  AgentRegistryItemDto,
  AgentRegistrySetEnabledPayload,
  AgentRegistrySetStandardizedPayload,
  ApplyGroupSourcePayload,
  ApplyGroupSourceResult,
} from '../shared/ipcContracts'

interface TuqPtyBridge {
  spawn(payload: PtySpawnPayload): Promise<IpcResult>
  write(id: string, data: string): Promise<IpcResult>
  resize(id: string, cols: number, rows: number): Promise<IpcResult>
  kill(id: string): Promise<IpcResult>
}

interface TuqTasksBridge {
  findAll(payload?: TasksFindAllPayload): Promise<IpcResult>
  update(payload: TasksUpdatePayload): Promise<IpcResult>
  create(payload: TasksCreatePayload): Promise<IpcResult<TaskDto>>
}

interface TuqSessionBridge {
  open(payload: SessionOpenPayload): Promise<IpcResult<SessionInfo>>
  close(sessionId: string): Promise<IpcResult>
  /** 列出 main 端實際存在的所有 session（含 headless 恢復的）；renderer 啟動 hydrate tab 用。 */
  listActive(): Promise<IpcResult<SessionInfo[]>>
  listSessions(sessionId: string): Promise<IpcResult<BindSessionItem[]>>
  rename(sessionId: string, customTitle: string): Promise<IpcResult<{ ok: boolean }>>
  getConversation(sessionId: string): Promise<IpcResult<ConversationMessage[]>>
  setProject(
    sessionId: string,
    projectPath: string,
    tool?: string,
  ): Promise<IpcResult<SessionProjectResult>>
  listSkills(sessionId: string): Promise<IpcResult<SkillItem[]>>
  getSubagentConversation(sessionId: string, toolUseId: string): Promise<IpcResult<SubagentConversationResult>>
  getWorkflowAgentConversation(sessionId: string, runId: string, agentId: string): Promise<IpcResult<SubagentConversationResult>>
  getConversationWindow(sessionId: string): Promise<IpcResult<ConversationWindowResult>>
  getSegments(sessionId: string): Promise<IpcResult<SegmentListResult>>
  getSegmentMessages(sessionId: string, startSeq: number, endSeq: number): Promise<IpcResult<{ ok: boolean; messages: ConversationMessage[] }>>
  getRawLines(sessionId: string, startSeq: number, endSeq: number): Promise<IpcResult<RawLinesResult>>
}

interface TuqMonitorBridge {
  start(payload: MonitorStartPayload): Promise<IpcResult<{ started: boolean }>>
  stop(sessionId: string): Promise<IpcResult>
  rebind(
    sessionId: string,
    claudeSessionId: string | null,
  ): Promise<IpcResult<{ ok: boolean; claudeSessionId: string | null; launchCommand: string | null }>>
}

interface TuqPunchesBridge {
  listForTask(taskId: string): Promise<IpcResult>
}

interface MilestoneEntryResult {
  project_path: string | null
  tool: string
  custom_command: string | null
}

interface TuqConfigBridge {
  getMilestone(milestoneId: string): Promise<IpcResult<MilestoneEntryResult | null>>
  setMilestone(payload: ConfigSetMilestonePayload): Promise<IpcResult<MilestoneEntryResult>>
}

interface TuqSettingsBridge {
  get(key: string): Promise<IpcResult<Record<string, unknown> | null>>
  set(payload: SettingsSetPayload): Promise<IpcResult>
  getDataDir(): Promise<IpcResult<string>>
  openLogsFolder(): Promise<IpcResult<null>>
}

interface TuqDialogBridge {
  openDirectory(): Promise<IpcResult<string | null>>
}

interface TuqClipboardBridge {
  writeText(text: string): Promise<IpcResult>
  readText(): Promise<IpcResult<{ text: string }>>
}

interface TuqAdminBridge {
  getWorkspace(scope: AdminScope): Promise<IpcResult<AdminWorkspaceInfo>>
}

interface TuqProjectsBridge {
  findAll(payload?: ProjectsFindAllPayload): Promise<IpcResult<ProjectsFindAllResult>>
  create(payload: ProjectCreatePayload): Promise<IpcResult<ProjectDto>>
  update(payload: ProjectUpdatePayload): Promise<IpcResult<ProjectDto>>
  delete(localId: string): Promise<IpcResult>
  byFolder(payload: ProjectsByFolderPayload): Promise<IpcResult<ProjectsByFolderResult>>
  foldersByProject(
    payload: ProjectsFoldersByProjectPayload,
  ): Promise<IpcResult<ProjectsFoldersByProjectResult>>
}

interface TuqMilestonesBridge {
  findAll(payload?: MilestonesFindAllPayload): Promise<IpcResult<MilestonesFindAllResult>>
  create(payload: MilestoneCreatePayload): Promise<IpcResult<MilestoneDto>>
  update(payload: MilestoneUpdatePayload): Promise<IpcResult<MilestoneDto>>
  delete(localId: string): Promise<IpcResult>
  findMembers(milestoneLocalId: string): Promise<IpcResult<MilestoneMembersResult>>
}

interface TuqCliBackendBridge {
  detect(): Promise<IpcResult<CliStatusDto[]>>
  verifyLogin(id: CliId): Promise<IpcResult<CliVerifyResult>>
  getInstallPlan(id: CliId): Promise<IpcResult<CliPlanDto>>
  getLoginPlan(id: CliId): Promise<IpcResult<CliPlanDto>>
  /** 登入憑證簽章（憑證檔 mtime / keychain 存在性）；登入面板輪詢用，簽章變動＝剛完成登入。 */
  loginSignature(id: CliId): Promise<IpcResult<CliLoginSignature>>
  /** 首啟 onboarding：讀 'cli_onboarding' 旗標 + detectAll 算出缺漏的 CLI。 */
  getOnboardingState(): Promise<IpcResult<CliOnboardingStateDto>>
  /** 永久關閉 onboarding 提示（寫 'cli_onboarding' = { dismissed: true }）。 */
  dismissOnboarding(): Promise<IpcResult<void>>
}

interface TuqAgentConvBridge {
  open(payload: AgentConvOpenPayload): Promise<IpcResult<{ conversationId: string }>>
  sendInput(conversationId: string, text: string): Promise<IpcResult>
  resize(conversationId: string, cols: number, rows: number): Promise<IpcResult>
  close(conversationId: string): Promise<IpcResult>
  hide(conversationId: string): Promise<IpcResult>
  getBuffer(conversationId: string): Promise<IpcResult<{ buffer: string }>>
  listSessions(): Promise<IpcResult<AgentConvSessionDto[]>>
  getConversationWindow(conversationId: string): Promise<IpcResult<ConversationWindowResult>>
  getSegments(conversationId: string): Promise<IpcResult<SegmentListResult>>
  getSegmentMessages(conversationId: string, startSeq: number, endSeq: number): Promise<IpcResult<{ ok: boolean; messages: ConversationMessage[] }>>
}

interface TuqAgentOrgBridge {
  /** 掃描 AgentOrg 目錄回傳完整團隊樹（rootPath 由 main 端從 app_settings 或常數取）。 */
  scan(): Promise<IpcResult<AgentOrgTree>>
  /** 取得單一 agent 詳細資料（含 workflow.yaml 原文 + soul.md 前 40 行）。 */
  getDetail(payload: AgentOrgGetDetailPayload): Promise<IpcResult<AgentDetailDto | null>>
  /** 取得目前生效的 AgentOrg 根目錄路徑（含 isCustom + defaultPath）。 */
  getRoot(): Promise<IpcResult<AgentOrgRootInfo>>
  /** 設定 AgentOrg 根目錄路徑（儲存前驗證路徑存在；空字串 = 清除自訂回 fallback）。 */
  setRoot(newPath: string): Promise<IpcResult<void>>
  /** 儲存 introduction 草稿（main 端寫 introduction.draft.{hostname}.json）。 */
  saveDraft(payload: AgentOrgSaveDraftPayload): Promise<IpcResult<void>>
  /** 讀取本機草稿（含上游衝突偵測 conflict）。 */
  getDraft(payload: AgentOrgGetDraftPayload): Promise<IpcResult<AgentOrgDraftResult>>
  /** 刪除本機草稿檔（套用成功後清除；不存在視為成功）。 */
  clearDraft(payload: AgentOrgClearDraftPayload): Promise<IpcResult<void>>
  /**
   * 套用前備份 introduction.json → introduction.backup.json（非阻塞保險；失敗不擋套用）。
   */
  backupIntroduction(payload: AgentOrgBackupIntroPayload): Promise<IpcResult<void>>
  /** 從結構化 spec 建立 AI 團隊、寫 registry DB，並同步 Claude/Codex/AGY skill。 */
  createTeamFromSpec(spec: AgentTeamCreateSpecInput): Promise<IpcResult<AgentTeamCreateResult>>
  /** 用檔案總管開啟某團隊在 AgentOrg 的資料夾（<agents 根>/<teamId>）。 */
  openTeamFolder(teamId: string): Promise<IpcResult<null>>
  /**
   * 為「有團隊、無入口 skill」的團隊建立可攜入口 SKILL.md（寫到該團隊所屬來源的 .claude/skills）。
   * 不覆寫既有；skillName 省略時 main 端用 `tuq-<teamId 末段>`。
   */
  createEntrySkill(
    payload: AgentOrgCreateEntrySkillPayload,
  ): Promise<IpcResult<AgentOrgCreateEntrySkillResult>>
  /** 列出目前所有團隊來源（含 fallback 合成的 default 來源）。 */
  listSources(): Promise<IpcResult<TeamSource[]>>
  /** 新增團隊來源（main 端驗證 path 存在後 append、自動產 id）；回傳更新後清單。 */
  addSource(payload: AgentOrgAddSourcePayload): Promise<IpcResult<TeamSource[]>>
  /** 移除指定來源（不可移除最後一個）；回傳更新後清單。 */
  removeSource(id: string): Promise<IpcResult<TeamSource[]>>
  /** 修改既有來源的 label / path（改 path 會驗證存在）；回傳更新後清單。 */
  updateSource(payload: AgentOrgUpdateSourcePayload): Promise<IpcResult<TeamSource[]>>
  /** 開始 fs.watch 監看指定 agent 草稿檔。 */
  watchDraft(payload: { teamId: string; agentName: string }): Promise<IpcResult<void>>
  /** 停止 fs.watch 監看。 */
  unwatchDraft(payload: { teamId: string; agentName: string }): Promise<IpcResult<void>>
  /**
   * 訂閱 agentOrg:draftUpdated push（fs.watch 偵測到草稿變動後由 main 推播）。
   * 回傳 unsubscribe 函式；呼叫後移除 listener（React useEffect cleanup 用）。
   * draft = null 表示本次 JSON 壞掉，UI 應保留上一個有效版本。
   */
  onDraftUpdated(handler: (payload: AgentOrgDraftUpdatedPayload) => void): () => void
  /** 把群組現有所有團隊實體搬移到指定來源資料夾，重建三平台 skill、改寫系統鍵。 */
  applyGroupSource(payload: ApplyGroupSourcePayload): Promise<IpcResult<ApplyGroupSourceResult>>
}

interface TuqTeamRegistryBridge {
  /** 把 team 入口 skill junction 連結到 ~/.claude/skills（claude 平台）。 */
  register(payload: RegisterTeamPayload): Promise<IpcResult<RegisterTeamResult>>
  /** 移除已連結的 skill junction 與/或 codex 產生物。 */
  unregister(payload: UnregisterTeamPayload): Promise<IpcResult<UnregisterTeamResult>>
  /** 同步/更新 team 入口 skill（重跑 register 冪等邏輯；預設兩平台都同步）。 */
  sync(payload: RegisterTeamPayload): Promise<IpcResult<RegisterTeamResult>>
}

interface TuqAgentRegistryBridge {
  /** 回傳全部 agent_registry 列。 */
  getAll(): Promise<IpcResult<AgentRegistryItemDto[]>>
  /** 先 scanAgentOrg 再 upsertRegistryFromScan（冪等批次更新）。 */
  upsertFromScan(): Promise<IpcResult<AgentRegistryItemDto[]>>
  /** 切換單一 agent 的 enabled 旗標。 */
  setEnabled(payload: AgentRegistrySetEnabledPayload): Promise<IpcResult<boolean>>
  /** 切換單一 agent 的 standardized 旗標（清除待優化徽章）。 */
  setStandardized(payload: AgentRegistrySetStandardizedPayload): Promise<IpcResult<boolean>>
}

interface TuqBridge {
  pty: TuqPtyBridge
  tasks: TuqTasksBridge
  session: TuqSessionBridge
  monitor: TuqMonitorBridge
  punches: TuqPunchesBridge
  config: TuqConfigBridge
  settings: TuqSettingsBridge
  projects: TuqProjectsBridge
  milestones: TuqMilestonesBridge
  dialog: TuqDialogBridge
  clipboard: TuqClipboardBridge
  admin: TuqAdminBridge
  cliBackend: TuqCliBackendBridge
  agentOrg: TuqAgentOrgBridge
  teamRegistry: TuqTeamRegistryBridge
  agentRegistry: TuqAgentRegistryBridge
  agentConv: TuqAgentConvBridge
  onPtyData(cb: (payload: PtyDataPayload) => void): () => void
  /** PTY 子行程結束（含正常結束）時 main 推播 → CliBackendSection 自動收合面板用。 */
  onPtyExit(cb: (payload: PtyExitPayload) => void): () => void
  onMonitorRender(cb: (payload: MonitorRenderPayload) => void): () => void
  onMonitorStatus(cb: (payload: MonitorStatusPayload) => void): () => void
  onCardRunState(cb: (payload: CardRunStatePayload) => void): () => void
  /** session 內 workflow 進度更新時 main 推播 → 對話框上方進度卡用（依 taskId 路由）。 */
  onCardWorkflowProgress(
    cb: (payload: CardWorkflowProgressPayload) => void,
  ): () => void
  /** PTY 偵測到等待輸入/CLI 錯誤時，main 推播 → renderer toast 用。 */
  onPromptAlert(cb: (payload: PromptAlertPayload) => void): () => void
  /** 訂閱 agentConv:messages push（tail JSONL 出的全量卡片訊息）。回傳 unsubscribe。 */
  onAgentConvMessages(cb: (payload: AgentConvMessagesPayload) => void): () => void
  /** 訂閱 agentConv:raw push（PTY 原始輸出，含 ANSI）。回傳 unsubscribe。 */
  onAgentConvRaw(cb: (payload: AgentConvRawPayload) => void): () => void
  /** 訂閱 agentConv:promptState push（PTY 互動提問偵測；options 非 null=等待選擇，null=解除）。回傳 unsubscribe。 */
  onAgentConvPromptState(cb: (payload: AgentConvPromptStatePayload) => void): () => void
}

declare global {
  interface Window {
    tuq: TuqBridge
  }
}
