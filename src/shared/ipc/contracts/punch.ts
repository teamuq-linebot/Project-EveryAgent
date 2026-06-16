import { z } from "zod";

export const PUNCH_CHANNELS = {
  LIST_FOR_TASK: "punches:listForTask",
} as const;

export const PunchesListForTaskSchema = z.object({
  taskId: z.string().min(1),
});
export type PunchesListForTaskPayload = z.infer<
  typeof PunchesListForTaskSchema
>;

/** PunchRow — mirrors monitor/types.ts PunchRow; serialisable for IPC. */
export interface PunchRow {
  name: string;
  started_at: unknown;
  ended_at: unknown;
  hours: number;
  status: string;
  show_end: boolean;
  type: string;
  /** 來源 CLI（'claude' | 'codex'）：標記該 punch 由哪個 CLI 監測產生。null=舊列 / 未知。 */
  cli?: string | null;
  description: string;
  subtask_id: string;
  error: string;
  /** 打卡冪等鍵；DB 列帶入，monitor 推播路徑不含。 */
  punch_uid?: string | null;
  /** 打卡所屬 session；DB 列帶入，monitor 推播路徑不含。 */
  session_id?: string | null;
  /** DB JOIN 結果；listPunchesForTask 回傳時帶入，monitor 推播路徑（in-memory）不含此欄。 */
  subtask_name?: string | null;
  /** 以下五欄來自 subtasks JOIN（§2.15 彈窗補齊）；monitor 推播路徑不含。 */
  subtask_description?: string | null;
  subtask_start_time?: string | null;
  subtask_end_time?: string | null;
  subtask_duration?: number | null;
  subtask_is_settled?: number | null;
}
