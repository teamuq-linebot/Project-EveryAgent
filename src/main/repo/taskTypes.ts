/**
 * taskTypes.ts — repo 層的實體列型別 + CRUD 輸入型別（純本地版）。
 *
 * 純本地 app：任務/專案/打卡存本地 SQLite，免登入、不連雲端。
 * 已移除：SyncControlFields / origin / remote_id / platform_local_id / sync_enabled /
 *         dirty / pending_op / tombstone / raw_json / version（樂觀鎖）/
 *         assignee_id / assignee_user_id / AccountRow / AccountUpsertInput。
 */

// ---------------------------------------------------------------------------
// 共用列舉 / 標記欄位
// ---------------------------------------------------------------------------

/** 後端 ProjectStatus 七值（字串存 DB，型別僅作提示）。 */
export type TaskStatus =
  | 'TODO'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'DONE'
  | 'BLOCKED'
  | 'CANCELLED'
  | 'BACKLOG'

/** 後端 priority 五值（字串存 DB，型別僅作提示）。 */
export type TaskPriority = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

/** 四實體鍵（IPC TaskSyncSet* 的 entity 欄共用）。 */
export type EntityKind = 'project' | 'milestone' | 'task' | 'subtask'

/** 建立 / 更新時間戳（ISO 字串）。created_at NOT NULL；updated_at nullable。 */
export interface Timestamps {
  created_at: string
  updated_at: string | null
}

// ---------------------------------------------------------------------------
// 五實體列型別（逐欄對齊 DDL，純本地）
// ---------------------------------------------------------------------------

/** projects 列。主鍵 local_id。 */
export interface ProjectRow extends Timestamps {
  local_id: string
  name: string
  description: string | null
}

/**
 * milestones 列。FK project_local_id→projects.local_id。
 */
export interface MilestoneRow extends Timestamps {
  local_id: string
  /** FK→projects.local_id。 */
  project_local_id: string | null
  name: string
  description: string | null
}

/**
 * tasks 列。FK milestone_local_id→milestones.local_id（session:open binding 直查鍵，§2.7）。
 */
export interface TaskRow extends Timestamps {
  local_id: string
  /** FK→milestones.local_id（§2.7 binding 直查鍵）。 */
  milestone_local_id: string | null
  /** FK→projects.local_id（團隊對話 session：task↔project；存量列為 null）。 */
  project_local_id: string | null
  name: string
  /** ProjectStatus 七值（字串存 DB）。 */
  status: string | null
  description: string | null
  /** priority 五值（字串存 DB）。 */
  priority: string | null
  start_date: string | null
  end_date: string | null
}

/**
 * subtasks 列。local_id = UUID；FK task_local_id→tasks.local_id。
 */
export interface SubtaskRow extends Timestamps {
  /** UUID local_id。 */
  local_id: string
  /** FK→tasks.local_id。 */
  task_local_id: string
  name: string
  description: string | null
  start_time: string | null
  end_time: string | null
  duration: number | null
  assignee_id: string | null
  category_id: string | null
  /** 1=已結算。 */
  is_settled: number
}

// ---------------------------------------------------------------------------
// CRUD / upsert 輸入型別
// ---------------------------------------------------------------------------

/** 建立本地 project 的輸入。local_id / 時間戳 由 repo 產生。 */
export interface ProjectCreateInput {
  name: string
  description?: string | null
}

/** 更新 project 的輸入。localId 認親；只帶要改的欄。 */
export interface ProjectUpdateInput {
  localId: string
  name?: string
  description?: string | null
}

/** 建立本地 milestone 的輸入。 */
export interface MilestoneCreateInput {
  name: string
  description?: string | null
  projectLocalId?: string | null
}

/** 建立本地 task 的輸入。local_id / 時間戳 由 repo 產生。 */
export interface TaskCreateInput {
  name: string
  milestoneLocalId?: string | null
  /** FK→projects.local_id（團隊對話 session：建 task 連 project；選填）。 */
  projectLocalId?: string | null
  status?: string | null
  description?: string | null
}

/** 更新 milestone 的輸入。 */
export interface MilestoneUpdateInput {
  localId: string
  name?: string
  description?: string | null
}

/**
 * subtask upsert 輸入（§2.9 打卡 local-first）。
 * localId 帶值=更新；省略=本地新建。
 */
export interface SubtaskUpsertInput {
  localId?: string | null
  taskLocalId: string
  name: string
  description?: string | null
  startTime?: string | null
  endTime?: string | null
  duration?: number | null
  assigneeId?: string | null
  categoryId?: string | null
}

// ---------------------------------------------------------------------------
// 查詢過濾型別
// ---------------------------------------------------------------------------

/** 任務查詢過濾。 */
export interface TaskFindFilter {
  search?: string | null
  /** 單值或多值狀態過濾。 */
  statuses?: string | string[] | null
  limit?: number | null
  offset?: number | null
}

/** project 查詢過濾。 */
export interface ProjectFindFilter {
  search?: string | null
}

/** milestone 查詢過濾。projectLocalId 限定某 project 下的里程碑。 */
export interface MilestoneFindFilter {
  projectLocalId?: string | null
}

/** 成員列型別（過渡保留供 taskRepository.ts / rowMappers.ts 型別相容）。 */
export interface MilestoneMemberRow extends Timestamps {
  local_id: string
  remote_id: string | null
  milestone_local_id: string | null
  milestone_remote_id: string | null
  user_id: string | null
  role_id: string | null
  status: string | null
  name: string | null
  origin: string
  platform_local_id: string | null
  raw_json: string | null
}

// ---------------------------------------------------------------------------
// 級聯 / 互鎖設定型別 — 供 TaskRepository 級聯方法簽章共用
// ---------------------------------------------------------------------------

/** setSyncEnabledCascade / setPlatformCascade 的目標。 */
export interface SyncBindingTarget {
  entity: EntityKind
  localId: string
}
