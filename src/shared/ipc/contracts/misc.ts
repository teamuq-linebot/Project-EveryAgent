import { z } from "zod";

export const CARD_CHANNELS = {
  RUN_STATE: "card:runState",
  WORKFLOW_PROGRESS: "card:workflowProgress",
} as const;

export const ALERT_CHANNELS = {
  PROMPT_ALERT: "alert:promptState",
} as const;

/** PTY 偵測到等待輸入/CLI 錯誤時主動推播（toast + 系統通知用） */
export interface PromptAlertPayload {
  sessionId: string;
  taskId: string;
  /** resolved = 偵測狀態解除，renderer 據此移除該 session 的 toast */
  state: "waiting" | "error" | "resolved";
  reason: string;
  /** waiting 時從 PTY 尾段解析的可選項，renderer 渲染為按鈕；無選項或非 waiting 時省略 */
  options?: { value: string; label: string }[];
  /** waiting 時 CLI 正在問的問題/標題（選項上方文字），renderer 顯示讓使用者看懂在選什麼 */
  prompt?: string;
}

export const DIALOG_CHANNELS = {
  OPEN_DIRECTORY: "dialog:openDirectory",
} as const;

export const CLIPBOARD_CHANNELS = {
  WRITE_TEXT: "clipboard:writeText",
  READ_TEXT: "clipboard:readText",
} as const;

/** 應用設定 key-value（app_settings；取代 qwen.json 非機密部分，Phase 4.0d / 9）。 */
export const SETTINGS_CHANNELS = {
  GET: "settings:get",
  SET: "settings:set",
  /** 解析後的資料目錄（~/.teamuq）絕對路徑，唯讀（設定頁「進階」顯示用）。 */
  GET_DATA_DIR: "settings:getDataDir",
  /** 用檔案總管開啟記錄檔（main.log）所在資料夾（設定頁「進階」除錯用）。 */
  OPEN_LOGS_FOLDER: "settings:openLogsFolder",
} as const;

/**
 * 管理工作區 / 管理 session（plan §12 U6 / Part A；rev15 用戶拍板 2026-06-05）。
 * **平台設定頁與專案管理頁各自一個固定管理 session**（cwd 同為 ~/.teamuq，但 taskId 不同
 * → 各自綁定持久、各自重開 resume 自己的對話）。renderer 經此帶 scope 取得 ~/.teamuq 絕對
 * 路徑 + 該 scope 固定 taskId + tab 顯示名，再以既有 session:open 開啟。
 */
export const ADMIN_CHANNELS = {
  GET_WORKSPACE: "admin:getWorkspace",
} as const;

/** 管理 session scope：'platform'（平台設定）/ 'project'（專案管理）。 */
export type AdminScope = "platform" | "project";

/** admin:getWorkspace 回傳：該 scope 管理 session 的固定 cwd / 固定 taskId / tab 顯示名。 */
export interface AdminWorkspaceInfo {
  /** ~/.teamuq 絕對路徑（管理 session 的 cwd / projectPath）。 */
  path: string;
  /** 該 scope 的固定管理 session taskId（如 '__teamuq-admin-platform__'）。 */
  taskId: string;
  /** tab 顯示名（如「管理：平台設定」/「管理：專案」）。 */
  label: string;
  /** 回傳所屬 scope（呼叫端可校驗）。 */
  scope: AdminScope;
}

// -- settings（app_settings key-value，§2.2）--

export const SettingsGetSchema = z.object({
  key: z.string().min(1),
});
export type SettingsGetPayload = z.infer<typeof SettingsGetSchema>;

export const SettingsSetSchema = z.object({
  key: z.string().min(1),
  /** 非機密 JSON 字串；api_key 等機密不走此 channel（進 secrets，§2.2 註）。 */
  valueJson: z.string(),
});
export type SettingsSetPayload = z.infer<typeof SettingsSetSchema>;

// -- clipboard（renderer sandbox 限制，必須走 IPC）--

export const ClipboardWriteTextSchema = z.object({
  text: z.string(),
});
export type ClipboardWriteTextPayload = z.infer<
  typeof ClipboardWriteTextSchema
>;

/** card:runState payload pushed from main → renderer. */
export interface CardRunStatePayload {
  taskId: string;
  /** waiting = 等待使用者決定（UI 橘色）；error = CLI 錯誤或早夭（UI 紅色）；completed = 對話完成、CLI 待命（UI 綠色點）。 */
  state: "none" | "idle" | "running" | "waiting" | "error" | "completed";
}

/** Workflow 進度卡：單一 agent 一行（取自 wf_*.json 的 workflowProgress[type=workflow_agent]）。 */
export interface WorkflowAgentEntry {
  index: number;
  label: string;
  phaseTitle: string;
  phaseIndex: number;
  /** queued / running / done / error …（原樣帶回，renderer 自行映射圖示） */
  state: string;
  /** 子代理識別碼（對應 agent-<agentId>.jsonl）；展開載入完整逐字稿用。 */
  agentId?: string;
  model?: string;
  lastToolName?: string;
  lastToolSummary?: string;
  promptPreview?: string;
  resultPreview?: string;
  tokens?: number;
  toolCalls?: number;
  durationMs?: number;
}

/** Workflow 進度卡：單一 run 摘要（取自一個 wf_*.json）。 */
export interface WorkflowRunSummary {
  runId: string;
  workflowName: string;
  /** running / completed …（原樣帶回） */
  status: string;
  startTime?: number;
  durationMs?: number;
  agentCount?: number;
  totalTokens?: number;
  totalToolCalls?: number;
  phases: { title: string; detail?: string }[];
  agents: WorkflowAgentEntry[];
}

/** card:workflowProgress payload pushed from main → renderer（依 taskId 路由）。 */
export interface CardWorkflowProgressPayload {
  taskId: string;
  sessionId: string;
  /** 該 session 目前所有 workflow run（running 優先、其餘新到舊）。空陣列＝清掉卡片。 */
  workflows: WorkflowRunSummary[];
}

/** 綁定下拉的一個 session 項（對應 Qt monitor_view.BindItem）。 */
export interface BindSessionItem {
  /** claude session uuid */
  id: string;
  /** 人看得懂的標籤（時間 / 摘要 / 短碼） */
  label: string;
  /** 完整摘要（tooltip） */
  tooltip: string;
  /** 是否被別任務監測中（禁選） */
  busy: boolean;
  /** 是否為本 session 目前監測對象 */
  current: boolean;
}
