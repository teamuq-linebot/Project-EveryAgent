/**
 * services/taskProjection.ts — 遠端 task node → 扁平 Task 投影
 * （原 sync/taskProjection.ts 搬移至 services/；B9 刪 sync/ 後落點）。
 *
 * 內容逐字移入，語意不改。
 */

// ---------------------------------------------------------------------------
// Task interface（扁平投影；對應原 appsync/models.ts Task frozen dataclass）
// ---------------------------------------------------------------------------

export interface Task {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly start_date: string | null;
  readonly end_date: string | null;
  readonly milestone_id: string | null;
  readonly milestone_public_id: string | null;
  readonly milestone_name: string | null;
  /** 整筆原始 JSON（勿用回應覆蓋）。*/
  readonly raw: Record<string, unknown>;
}

/**
 * 從 findAllTasks.data.tasks[] 的單筆 JSON 建立 Task。
 */
export function taskFromJson(node: Record<string, unknown> | null | undefined): Task {
  const n = node ?? {};
  const milestone = (n['milestone'] as Record<string, unknown> | null | undefined) ?? {};

  const milestoneId = milestone['id'];
  const milestonePublicId = milestone['publicId'];

  return {
    id: String(n['id'] ?? ''),
    name: String(n['name'] ?? '') || '',
    status: String(n['status'] ?? '') || '',
    start_date: (n['startDate'] as string | null | undefined) ?? null,
    end_date: (n['endDate'] as string | null | undefined) ?? null,
    milestone_id: milestoneId != null ? String(milestoneId) : null,
    milestone_public_id: milestonePublicId != null ? String(milestonePublicId) : null,
    milestone_name: (milestone['name'] as string | null | undefined) ?? null,
    raw: n as Record<string, unknown>,
  };
}
