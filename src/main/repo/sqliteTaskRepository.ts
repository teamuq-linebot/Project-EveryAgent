/**
 * sqliteTaskRepository.ts — 單一 `~/.teamuq/teamuq.db` repository facade（純本地版）。
 *
 * 已移除：platformOps / platformConfigOps / platformInstance / accountOps /
 *          pullUpsertOps / syncCascadeOps 及全部雲端同步 delegation 方法。
 */

import Database from 'better-sqlite3'
import type {
  ILocalSubtaskStore,
  LocalCreateSubtaskInput,
  LocalOneshotInput,
  LocalSettleSubtaskInput,
} from '../monitor/punchExecutor'
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

// ---------------------------------------------------------------------------
// sqlite/ 子模組
// ---------------------------------------------------------------------------

import { openTeamuqDb } from './sqlite/schema'
import type {
  PunchArtifactRow,
  PunchArtifactInsertInput,
} from './sqlite/types'

import {
  findAllProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  linkProjectFolder,
  unlinkProjectFolder,
  findProjectsByFolder,
  findFoldersByProject,
} from './sqlite/projectOps'
import {
  findAllMilestones,
  getMilestone,
  createMilestone,
  updateMilestone,
  deleteMilestone,
} from './sqlite/milestoneOps'
import {
  findAllTasks,
  getTask,
  createTask,
  updateTaskStatus,
} from './sqlite/taskOps'
import {
  findMembersForMilestone,
} from './sqlite/subtaskOps'
import {
  createLocalSubtask,
  settleLocalSubtask,
  recordLocalOneshot,
} from './sqlite/punchLocalFirstOps'
import {
  insertPunchArtifacts,
  findPunchArtifacts,
} from './sqlite/punchArtifactOps'
import {
  getAllAgentRegistry,
  upsertAgentRegistry,
  setAgentRegistryEnabled,
  setAgentRegistryStandardized,
  rekeyAgentRegistryTeam,
} from './sqlite/agentRegistryOps'
export type { AgentRegistryRow, AgentRegistryUpsertInput } from './sqlite/agentRegistryOps'

// ---------------------------------------------------------------------------
// 對外 re-export（barrel/facade）
// ---------------------------------------------------------------------------

export { SCHEMA_VERSION, CONV_PARSER_VERSION } from './sqlite/version'
export {
  teamuqDbPath,
  ensureSchema,
  ensureConvCacheTables,
  openTeamuqDb,
  CONV_CACHE_DROP,
} from './sqlite/schema'
export type {
  PunchArtifactRow,
  PunchArtifactInputItem,
  PunchArtifactInsertInput,
} from './sqlite/types'

// ---------------------------------------------------------------------------
// SqliteTaskRepository — thin delegation facade（純本地版）
// ---------------------------------------------------------------------------

// NOTE: `implements TaskRepository` removed temporarily — TaskRepository interface still has
//   pull/sync methods that belong to other batches (B6/B7). Will be re-added after interface cleanup.
export class SqliteTaskRepository {
  private readonly db: Database.Database

  constructor(db?: Database.Database) {
    this.db = db ?? openTeamuqDb()
  }

  /** 暴露底層 better-sqlite3 連線（供必要的本地維護流程使用）。 */
  get rawDb(): Database.Database {
    return this.db
  }

  // ─────────────────────────── projects ───────────────────────────

  findAllProjects(filter?: ProjectFindFilter): ProjectRow[] {
    return findAllProjects(this.db, filter)
  }

  getProject(localId: string): ProjectRow | null {
    return getProject(this.db, localId)
  }

  createProject(input: ProjectCreateInput): ProjectRow {
    return createProject(this.db, input)
  }

  updateProject(input: ProjectUpdateInput): ProjectRow {
    return updateProject(this.db, input)
  }

  deleteProject(localId: string): void {
    return deleteProject(this.db, localId)
  }

  // ─────────────────── project_folders ───────────────────

  linkProjectFolder(projectLocalId: string, folderPath: string): void {
    return linkProjectFolder(this.db, projectLocalId, folderPath)
  }

  unlinkProjectFolder(projectLocalId: string, folderPath: string): void {
    return unlinkProjectFolder(this.db, projectLocalId, folderPath)
  }

  findProjectsByFolder(folderPath: string): ProjectRow[] {
    return findProjectsByFolder(this.db, folderPath)
  }

  findFoldersByProject(projectLocalId: string): string[] {
    return findFoldersByProject(this.db, projectLocalId)
  }

  // ─────────────────────────── milestones ───────────────────────────

  findAllMilestones(filter?: MilestoneFindFilter): MilestoneRow[] {
    return findAllMilestones(this.db, filter)
  }

  getMilestone(localId: string): MilestoneRow | null {
    return getMilestone(this.db, localId)
  }

  createMilestone(input: MilestoneCreateInput): MilestoneRow {
    return createMilestone(this.db, input)
  }

  updateMilestone(input: MilestoneUpdateInput): MilestoneRow {
    return updateMilestone(this.db, input)
  }

  deleteMilestone(localId: string): void {
    return deleteMilestone(this.db, localId)
  }

  // ─────────────────────────── tasks ───────────────────────────

  private notInBatch(method: string): never {
    throw new Error(`SqliteTaskRepository.${method}: not implemented in repo-proj-ms batch (1/3)`)
  }

  findAllTasks(filter?: TaskFindFilter): TaskRow[] {
    return findAllTasks(this.db, filter)
  }

  getTask(localId: string): TaskRow | null {
    return getTask(this.db, localId)
  }

  createTask(input: TaskCreateInput): TaskRow {
    return createTask(this.db, input)
  }

  updateTaskStatus(idOrRemoteId: string, status: string): TaskRow | null {
    return updateTaskStatus(this.db, idOrRemoteId, status)
  }

  findSubtasksForTask(_taskLocalId: string): SubtaskRow[] {
    return this.notInBatch('findSubtasksForTask')
  }

  upsertSubtask(_input: SubtaskUpsertInput): SubtaskRow {
    return this.notInBatch('upsertSubtask')
  }

  deleteSubtask(_localId: string): void {
    return this.notInBatch('deleteSubtask')
  }

  findMembersForMilestone(milestoneLocalId: string): MilestoneMemberRow[] {
    return findMembersForMilestone(this.db, milestoneLocalId)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 打卡 local-first（§2.9 / §2.14 D；ILocalSubtaskStore 契約）
  // ═══════════════════════════════════════════════════════════════════════

  createLocalSubtask(input: LocalCreateSubtaskInput): { localId: string } {
    return createLocalSubtask(this.db, input)
  }

  settleLocalSubtask(input: LocalSettleSubtaskInput): void {
    return settleLocalSubtask(this.db, input)
  }

  recordLocalOneshot(input: LocalOneshotInput): { localId: string } {
    return recordLocalOneshot(this.db, input)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // punch_artifacts 逐筆精確寫入（§2.14d D31）
  // ═══════════════════════════════════════════════════════════════════════

  insertPunchArtifacts(input: PunchArtifactInsertInput): number {
    return insertPunchArtifacts(this.db, input)
  }

  findPunchArtifacts(punchSessionId: string, punchUid: string): PunchArtifactRow[] {
    return findPunchArtifacts(this.db, punchSessionId, punchUid)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // agent_registry（B5 加法表）
  // ═══════════════════════════════════════════════════════════════════════

  getAgentRegistry(): import('./sqlite/agentRegistryOps').AgentRegistryRow[] {
    return getAllAgentRegistry(this.db)
  }

  upsertAgentRegistry(
    input: import('./sqlite/agentRegistryOps').AgentRegistryUpsertInput,
  ): import('./sqlite/agentRegistryOps').AgentRegistryRow {
    return upsertAgentRegistry(this.db, input)
  }

  setAgentRegistryEnabled(agentId: string, enabled: boolean): boolean {
    return setAgentRegistryEnabled(this.db, agentId, enabled)
  }

  setAgentRegistryStandardized(agentId: string, standardized: boolean): boolean {
    return setAgentRegistryStandardized(this.db, agentId, standardized)
  }

  rekeyAgentRegistryTeam(oldKey: string, newKey: string): number {
    return rekeyAgentRegistryTeam(this.db, oldKey, newKey)
  }
}

// 型別自檢（編譯期）：三方法（createLocalSubtask / settleLocalSubtask / recordLocalOneshot）
// 全數落地後，以整體 ILocalSubtaskStore 驗證 SqliteTaskRepository 的簽章完整性。
const _assertLocalSubtaskStore: ILocalSubtaskStore =
  null as unknown as SqliteTaskRepository
void _assertLocalSubtaskStore
