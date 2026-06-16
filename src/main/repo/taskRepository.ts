/**
 * taskRepository.ts — TaskRepository 介面（純本地版）。
 *
 * 雲端同步方法（upsert*FromRemote / setSyncEnabledCascade / setPlatformCascade /
 * clearRemoteByPlatform / countRemoteByPlatform / account* / PullScope）已隨雲端
 * 功能刪除，僅保留純本地 CRUD 介面。
 * TaskService 已直接依賴 SqliteTaskRepository；本介面作為文件參照留存。
 */

import type {
  MilestoneCreateInput,
  MilestoneFindFilter,
  MilestoneMemberRow,
  MilestoneRow,
  MilestoneUpdateInput,
  ProjectCreateInput,
  ProjectFindFilter,
  ProjectRow,
  ProjectUpdateInput,
  SubtaskRow,
  SubtaskUpsertInput,
  TaskCreateInput,
  TaskFindFilter,
  TaskRow,
} from './taskTypes'

export interface TaskRepository {
  // ─── projects ───
  findAllProjects(filter?: ProjectFindFilter): ProjectRow[]
  getProject(localId: string): ProjectRow | null
  createProject(input: ProjectCreateInput): ProjectRow
  updateProject(input: ProjectUpdateInput): ProjectRow
  deleteProject(localId: string): void

  // ─── project_folders ───
  linkProjectFolder(projectLocalId: string, folderPath: string): void
  unlinkProjectFolder(projectLocalId: string, folderPath: string): void
  findProjectsByFolder(folderPath: string): ProjectRow[]
  findFoldersByProject(projectLocalId: string): string[]

  // ─── milestones ───
  findAllMilestones(filter?: MilestoneFindFilter): MilestoneRow[]
  getMilestone(localId: string): MilestoneRow | null
  createMilestone(input: MilestoneCreateInput): MilestoneRow
  updateMilestone(input: MilestoneUpdateInput): MilestoneRow
  deleteMilestone(localId: string): void

  // ─── tasks ───
  findAllTasks(filter?: TaskFindFilter): TaskRow[]
  getTask(localId: string): TaskRow | null
  createTask(input: TaskCreateInput): TaskRow
  updateTaskStatus(idOrRemoteId: string, status: string): TaskRow | null

  // ─── subtasks ───
  findSubtasksForTask(taskLocalId: string): SubtaskRow[]
  upsertSubtask(input: SubtaskUpsertInput): SubtaskRow
  deleteSubtask(localId: string): void

  // ─── milestone members ───
  findMembersForMilestone(milestoneLocalId: string): MilestoneMemberRow[]
}
