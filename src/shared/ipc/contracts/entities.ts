import { z } from "zod";

/** 專案本地 CRUD（Phase 4c；四實體之 project）。 */
export const PROJECT_CHANNELS = {
  FIND_ALL: "projects:findAll",
  CREATE: "projects:create",
  UPDATE: "projects:update",
  DELETE: "projects:delete",
  /** 依資料夾反查關聯的 projects（團隊對話 session 彈窗主用，多對多）。 */
  BY_FOLDER: "projects:byFolder",
  /** 列某 project 關聯的資料夾路徑（多對多反查）。 */
  FOLDERS_BY_PROJECT: "projects:foldersByProject",
} as const;

/** 里程碑本地 CRUD（Phase 4c；四實體之 milestone）。 */
export const MILESTONE_CHANNELS = {
  FIND_ALL: "milestones:findAll",
  CREATE: "milestones:create",
  UPDATE: "milestones:update",
  DELETE: "milestones:delete",
  /** 列出某 milestone 的成員（U2 團隊成員顯示；唯讀鏡像）。 */
  FIND_MEMBERS: "milestones:findMembers",
} as const;

/** 子任務本地 CRUD / upsert（Phase 4d；四實體之 subtask）。 */
export const SUBTASK_CHANNELS = {
  FIND_FOR_TASK: "subtasks:findForTask",
  UPSERT: "subtasks:upsert",
  DELETE: "subtasks:delete",
} as const;

/**
 * AI 對話區 → 專案 / 里程碑草稿產生（專案管理頁，§2.10 / D22 安全閘，對齊 platformConfig:draft）。
 *
 * D22 硬約束同 platformConfig：AI **只產草稿**（專案名 + 里程碑樹）→ 人工 preview → apply 僅
 * 灌入左側「新增專案 / 里程碑」表單，**不直寫 DB**（人工按既有 projects:create / milestones:create
 * 才寫）、**不打目標 API**、**不碰機密**。後端走既有 LlmProvider 產文字 → 解析結構；LLM 不可用時退
 * 本地啟發式 parser（regex 抽專案名 / 里程碑數）。
 */
export const PROJECT_CONFIG_CHANNELS = {
  DRAFT: "projectConfig:draft",
} as const;

// -- projects（Phase 4c）--

export const ProjectsFindAllSchema = z
  .object({
    search: z.string().nullish(),
    mineOnly: z.boolean().optional(),
  })
  .optional();
export type ProjectsFindAllPayload = z.infer<typeof ProjectsFindAllSchema>;

export const ProjectCreateSchema = z.object({
  name: z.string().min(1),
  platformLocalId: z.string().nullish(),
  syncEnabled: z.boolean().optional(),
});
export type ProjectCreatePayload = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = z.object({
  localId: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type ProjectUpdatePayload = z.infer<typeof ProjectUpdateSchema>;

export const ProjectDeleteSchema = z.object({
  localId: z.string().min(1),
});
export type ProjectDeletePayload = z.infer<typeof ProjectDeleteSchema>;

// 團隊對話 session：專案↔資料夾多對多反查（路徑逐字相等比對，repo 不 normalize）。
export const ProjectsByFolderSchema = z.object({
  folderPath: z.string().min(1),
});
export type ProjectsByFolderPayload = z.infer<typeof ProjectsByFolderSchema>;

export const ProjectsFoldersByProjectSchema = z.object({
  projectLocalId: z.string().min(1),
});
export type ProjectsFoldersByProjectPayload = z.infer<
  typeof ProjectsFoldersByProjectSchema
>;

// -- milestones（Phase 4c）--

export const MilestonesFindAllSchema = z
  .object({
    projectLocalId: z.string().nullish(),
  })
  .optional();
export type MilestonesFindAllPayload = z.infer<typeof MilestonesFindAllSchema>;

export const MilestoneCreateSchema = z.object({
  name: z.string().min(1),
  projectLocalId: z.string().nullish(),
  platformLocalId: z.string().nullish(),
  syncEnabled: z.boolean().optional(),
});
export type MilestoneCreatePayload = z.infer<typeof MilestoneCreateSchema>;

export const MilestoneUpdateSchema = z.object({
  localId: z.string().min(1),
  name: z.string().min(1).optional(),
});
export type MilestoneUpdatePayload = z.infer<typeof MilestoneUpdateSchema>;

export const MilestoneDeleteSchema = z.object({
  localId: z.string().min(1),
});
export type MilestoneDeletePayload = z.infer<typeof MilestoneDeleteSchema>;

export const MilestoneFindMembersSchema = z.object({
  milestoneLocalId: z.string().min(1),
});
export type MilestoneFindMembersPayload = z.infer<
  typeof MilestoneFindMembersSchema
>;

// -- subtasks（Phase 4d）--

export const SubtasksFindForTaskSchema = z.object({
  taskLocalId: z.string().min(1),
});
export type SubtasksFindForTaskPayload = z.infer<
  typeof SubtasksFindForTaskSchema
>;

export const SubtaskUpsertSchema = z.object({
  /** 已存在則更新；loc: 暫鍵或省略則本地新建（§2.9 打卡 local-first）。 */
  localId: z.string().nullish(),
  taskLocalId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullish(),
});
export type SubtaskUpsertPayload = z.infer<typeof SubtaskUpsertSchema>;

export const SubtaskDeleteSchema = z.object({
  localId: z.string().min(1),
});
export type SubtaskDeletePayload = z.infer<typeof SubtaskDeleteSchema>;

// -- projectConfig 草稿（AI 對話區安全閘，專案管理頁，§2.10 / D22）--

/**
 * `projectConfig:draft` 的請求：使用者以自然語言描述要建的專案 / 里程碑，AI 產草稿（不寫 DB/不打 API）。
 * `prompt` = 使用者描述（如「建一個叫 X 的專案，底下兩個里程碑」）。
 */
export const ProjectConfigDraftSchema = z.object({
  prompt: z.string().min(1),
});
export type ProjectConfigDraftPayload = z.infer<
  typeof ProjectConfigDraftSchema
>;

/**
 * ProjectDto — `projects:*` channel 群回傳的單筆本地專案（Phase 6.5 mgmt-ipc-forms）。
 *
 * IPC 序列化邊界投影（main repo `ProjectRow` snake_case → renderer 友善形狀）；renderer 不
 * 反向 import main。`id` = local_id（本地主鍵，回送 update/delete 的鍵）。部分舊欄位
 * 保留為 IPC 相容用途；純本地版固定回 null / false。
 */
export interface ProjectDto {
  /** local_id（本地主鍵；回送 projects:update/delete 的鍵）。 */
  id: string;
  /** 相容舊 IPC 欄位；純本地版固定為 null。 */
  remote_id: string | null;
  name: string;
  description: string | null;
  /**
   * 專案狀態（ProjectStatus 七值；自 raw_json.status 解析）。本地建立 / 無 raw_json → null。
   * 值域：PREPARATION / WAITING / IN_PROGRESS / PENDING / COMPLETED / CLOSED / CANCELLED。
   * 管理頁狀態 filter 用（預設排除 CLOSED / CANCELLED）。
   */
  status: string | null;
  /** 'local'（本地建立，pull 不覆蓋）/ 'remote'（pull 鏡像）。 */
  origin: "local" | "remote";
  /** 歸屬 platform（FK→platforms.local_id；null=未歸屬）。 */
  platform_local_id: string | null;
  /** 相容舊 IPC 欄位；純本地版固定為 false。 */
  sync_enabled: boolean;
  /** 1=本地有未推變更（§2.5 outbox 髒旗標）。 */
  dirty: boolean;
  /** outbox 暫存意圖（create/update/delete）；未推為 null。 */
  pending_op: "create" | "update" | "delete" | null;
}

/** `projects:findAll` 的回傳資料（IpcResult<ProjectsFindAllResult> 之 data）。 */
export type ProjectsFindAllResult = ProjectDto[];

/** `projects:byFolder` 的回傳資料（依資料夾反查的 projects；多對多）。 */
export type ProjectsByFolderResult = ProjectDto[];

/** `projects:foldersByProject` 的回傳資料（某 project 關聯的資料夾路徑）。 */
export type ProjectsFoldersByProjectResult = string[];

/**
 * MilestoneDto — `milestones:*` channel 群回傳的單筆本地里程碑（Phase 6.5 mgmt-ipc-forms）。
 * 同 ProjectDto 的 IPC 邊界投影；額外帶 `project_local_id`（所屬 project，UI 過濾/顯示用）。
 */
export interface MilestoneDto {
  /** local_id（本地主鍵；回送 milestones:update/delete 的鍵）。 */
  id: string;
  remote_id: string | null;
  /** FK→projects.local_id（所屬 project；null=無）。 */
  project_local_id: string | null;
  name: string;
  description: string | null;
  origin: "local" | "remote";
  platform_local_id: string | null;
  sync_enabled: boolean;
  dirty: boolean;
  pending_op: "create" | "update" | "delete" | null;
}

/** `milestones:findAll` 的回傳資料（IpcResult<MilestonesFindAllResult> 之 data）。 */
export type MilestonesFindAllResult = MilestoneDto[];

/**
 * MilestoneMemberDto — `milestones:findMembers` 回傳的單筆成員（U2 團隊成員顯示）。
 *
 * 唯讀鏡像（多為 pull 來的 origin='remote'）；IPC 邊界投影（repo `MilestoneMemberRow` → renderer）。
 * `id` = local_id。`remote_id` = MilestoneMember.id（resolve @assigneeId 來源）。不含機密。
 */
export interface MilestoneMemberDto {
  id: string;
  remote_id: string | null;
  milestone_local_id: string | null;
  user_id: string | null;
  role_id: string | null;
  status: string | null;
  name: string | null;
  origin: "local" | "remote";
  platform_local_id: string | null;
  /**
   * 是否為「目前 active 帳號本人」（多帳戶方案 B / B2.5）。
   * 比對鍵 = active account 的 backend_user_id（getMyProfile.user.id）對上 user_id；
   * backend_user_id 尚未回填（NULL）時降級為全 false（不報錯，供 ProjectManagementView 標「我」）。
   */
  isMe?: boolean;
}

/** `milestones:findMembers` 的回傳資料（IpcResult<MilestoneMembersResult> 之 data）。 */
export type MilestoneMembersResult = MilestoneMemberDto[];

/** ProjectConfigDraft 內的單筆里程碑草稿（純名稱 + 可選描述；不含同步 / 平台欄）。 */
export interface ProjectMilestoneDraft {
  name: string;
  description: string | null;
}

/**
 * ProjectConfigDraft — `projectConfig:draft` 回傳的 AI 草稿（專案管理頁，§2.10 / D22 安全閘）。
 *
 * **純草稿**：AI 只填專案名 + 里程碑樹供人工 preview→apply（apply 只灌左側「新增專案 / 里程碑」
 * 表單，**不直接寫 DB / 不打 API**）。形狀對齊 `ProjectCreatePayload` + `MilestoneCreatePayload`
 * 子集（不含 platformLocalId/syncEnabled），便於 apply 直接灌入表單。
 */
export interface ProjectConfigDraft {
  projectName: string;
  description: string | null;
  milestones: ProjectMilestoneDraft[];
  /** AI 對該草稿的說明 / 後續人工步驟提示（顯示於 preview，非設定值）。 */
  rationale: string;
}
