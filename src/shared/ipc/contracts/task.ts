import { z } from "zod";

export const TASK_CHANNELS = {
  FIND_ALL: "tasks:findAll",
  UPDATE: "tasks:update",
  CREATE: "tasks:create",
} as const;

export const TasksFindAllSchema = z.object({
  search: z.string().nullish(),
  statuses: z.union([z.string(), z.array(z.string())]).nullish(),
  limit: z.number().nullish(),
  offset: z.number().nullish(),
});
export type TasksFindAllPayload = z.infer<typeof TasksFindAllSchema>;

export const TasksUpdateSchema = z.object({
  taskId: z.string().min(1),
  status: z.string().min(1),
  version: z.number().nullish(),
});
export type TasksUpdatePayload = z.infer<typeof TasksUpdateSchema>;

export const TasksCreateSchema = z.object({
  name: z.string().min(1).max(200),
  // 團隊對話 session（無 milestone task）改選填；有值才查 milestone（見 backend.createTask 守門）。
  milestoneLocalId: z.string().nullish(), // FK → milestones.local_id（選填）
  // 團隊對話 session：建 task 連 project；有值且帶 folderPath 時 backend 順帶 linkProjectFolder。
  projectLocalId: z.string().nullish(), // FK → projects.local_id（選填）
  folderPath: z.string().nullish(), // session cwd；與 projectLocalId 同有值 → backend link 關聯
  status: z.string().min(1).default("PENDING"),
  description: z.string().nullish(),
  assigneeSelf: z.boolean().optional(), // true = 自動填 active user 的 backend_user_id
});
// 用 z.input：status 有 .default('PENDING')，呼叫端（renderer/preload）可省略，
// schema parse 時補上預設；backend 端亦以 `payload.status ?? 'PENDING'` 容錯。
export type TasksCreatePayload = z.input<typeof TasksCreateSchema>;

/**
 * TaskDto — `tasks:findAll` 回傳的單筆任務（耦合點 4：給 IpcResult 具型別）。
 *
 * 鏡像 main/sync/taskProjection.ts `Task`（IPC 序列化邊界用，避免 renderer 反向 import main）。
 * Phase 4 改走 repo 後，repo 回傳列亦須投影成此形狀（local_id → id；remote_id 另計）。
 * `raw` 保留整筆原始 JSON（打卡 / 補欄位用，勿用回應覆蓋）。
 */
export interface TaskDto {
  id: string;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  milestone_id: string | null;
  milestone_public_id: string | null;
  milestone_name: string | null;
  /** FK→projects.local_id（團隊對話 session：所屬 project；存量列為 null）。 */
  project_local_id: string | null;
  /** 整筆原始 JSON（勿用回應覆蓋）。 */
  raw: Record<string, unknown>;
}

/** `tasks:findAll` 的回傳資料（IpcResult<TasksFindAllResult> 之 data）。 */
export type TasksFindAllResult = TaskDto[];
