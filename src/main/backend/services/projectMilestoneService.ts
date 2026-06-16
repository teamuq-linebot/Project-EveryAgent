/**
 * backend/services/projectMilestoneService.ts — Project / Milestone / Task 本地 CRUD
 * delegate service（backend.ts 拆分計畫 Batch 10；行為保留 move-only）。
 *
 * B9：移除 sync/platformSeeds 依賴、移除雲端 push gate、移除 resolveMyUserId / getActiveConnection
 * 跨域中樞呼叫。保留純本地 CRUD。isRemotePlatform 判定一律改為 false（純本地，無遠端 platform）。
 */

import * as milestonesConfig from "../../config/milestones";
import type { MilestoneEntry } from "../../config/milestones";
import type {
  TaskDto,
  TasksCreatePayload,
  ProjectDto,
  MilestoneDto,
  MilestoneMemberDto,
} from "../../../shared/ipcContracts";
import type {
  ProjectCreateInput,
  ProjectUpdateInput,
  MilestoneCreateInput,
  MilestoneUpdateInput,
  ProjectFindFilter,
  MilestoneFindFilter,
} from "../../repo/taskTypes";
import {
  projectRowToDto,
  milestoneRowToDto,
  milestoneMemberRowToDto,
} from "../rowMappers";
import type { BackendContext } from "../context";

export class ProjectMilestoneService {
  constructor(private readonly _ctx: BackendContext) {}

  // --------------------------------------------------------------------------
  // Tasks
  // --------------------------------------------------------------------------

  /**
   * 取所有任務（看板讀路徑，純本地）。
   */
  async findAllTasks(
    opts: {
      search?: string | null;
      statuses?: string | string[] | null;
      limit?: number | null;
      offset?: number | null;
    } = {},
  ): Promise<TaskDto[]> {
    return this._ctx.taskService.findAllTasks(opts);
  }

  /**
   * 更新任務狀態（看板拖拽 / 右鍵改狀態）— **純本地寫入**（B9：移除雲端 push gate）。
   *
   * 永遠先寫本地（`repo.updateTaskStatus`）：寫 status + updated_at，立即回成功。
   * 回傳更新後的 task 欄位投影（與 renderer 既有契約相容）。
   */
  async updateTask(
    taskId: string,
    status: string,
    _opts: { version?: number | null } = {},
  ): Promise<Record<string, unknown>> {
    const row = this._ctx.repo.updateTaskStatus(taskId, status);
    return row
      ? {
          id: row.local_id,
          status: row.status,
        }
      : {};
  }

  // --------------------------------------------------------------------------
  // Milestone config（對應 Python config/milestones）
  // --------------------------------------------------------------------------

  /**
   * 取單一 milestone 的 entry（不存在 → null）。
   */
  getMilestone(milestoneId: string): MilestoneEntry | null {
    return milestonesConfig.get(milestoneId);
  }

  /**
   * 設定（新增 / 覆寫）某 milestone 的 entry。
   */
  setMilestone(
    milestoneId: string,
    params: {
      project_path: string | null;
      tool: string;
      custom_command?: string | null;
    },
  ): MilestoneEntry {
    return milestonesConfig.setEntry(milestoneId, params);
  }

  // --------------------------------------------------------------------------
  // 專案 / 里程碑 本地 CRUD（Phase 6.5 sidebar 管理 UI；plan §2.6 / §3 / §4c）
  // --------------------------------------------------------------------------

  /** 列出本地專案（§3 免登入；search 過濾 name/description）。 */
  findAllProjects(filter?: ProjectFindFilter): ProjectDto[] {
    return this._ctx.repo.findAllProjects(filter).map(projectRowToDto);
  }

  /** 依資料夾反查關聯的 projects（團隊對話 session 彈窗；多對多，路徑逐字相等比對）。 */
  findProjectsByFolder(folderPath: string): ProjectDto[] {
    return this._ctx.repo.findProjectsByFolder(folderPath).map(projectRowToDto);
  }

  /** 列某 project 關聯的資料夾路徑（多對多反查；依建立順序）。 */
  findFoldersByProject(projectLocalId: string): string[] {
    return this._ctx.repo.findFoldersByProject(projectLocalId);
  }

  /** 本地建立專案（純本地）。 */
  createProject(input: ProjectCreateInput): ProjectDto {
    return projectRowToDto(
      this._ctx.repo.createProject(input),
    );
  }

  /** 更新本地專案。 */
  updateProject(input: ProjectUpdateInput): ProjectDto {
    return projectRowToDto(this._ctx.repo.updateProject(input));
  }

  /** 刪除專案（§2.8：未同步硬刪+級聯子里程碑；已同步 tombstone）。 */
  deleteProject(localId: string): void {
    this._ctx.repo.deleteProject(localId);
  }

  /** 列出本地里程碑（projectLocalId 限定某 project 下，§4c）。 */
  findAllMilestones(filter?: MilestoneFindFilter): MilestoneDto[] {
    return this._ctx.repo.findAllMilestones(filter).map(milestoneRowToDto);
  }

  /** 本地建立里程碑（純本地）。 */
  createMilestone(input: MilestoneCreateInput): MilestoneDto {
    return milestoneRowToDto(
      this._ctx.repo.createMilestone(input),
    );
  }

  /** 更新本地里程碑。 */
  updateMilestone(input: MilestoneUpdateInput): MilestoneDto {
    return milestoneRowToDto(this._ctx.repo.updateMilestone(input));
  }

  /** 刪除里程碑（§2.8：未同步硬刪；已同步 tombstone）。 */
  deleteMilestone(localId: string): void {
    this._ctx.repo.deleteMilestone(localId);
  }

  /**
   * 本地建立任務（§2d 設計文件 + 團隊對話 session 補完）。
   *   B9：移除 assigneeSelf via resolveMyUserId（assigneeUserId 一律 null）。
   *   syncEnabled=false 純本地。
   */
  async createTask(payload: TasksCreatePayload): Promise<TaskDto> {
    const dto = await this._ctx.taskService.createTask({
      name: payload.name,
      milestoneLocalId: payload.milestoneLocalId ?? null,
      projectLocalId: payload.projectLocalId ?? null,
      status: payload.status ?? "PENDING",
      description: payload.description ?? null,
    });
    // 團隊對話 session：建 task 順帶關聯 folder↔project（§4.1，省 IPC round-trip）。
    if (payload.projectLocalId && payload.folderPath) {
      this._ctx.repo.linkProjectFolder(
        payload.projectLocalId,
        payload.folderPath,
      );
    }
    return dto;
  }

  /**
   * 列出某 milestone 的成員（U2 團隊成員顯示；唯讀鏡像）。
   * B9：isMe 一律 false（移除 getActiveConnection 跨域呼叫）。
   */
  findMilestoneMembers(milestoneLocalId: string): MilestoneMemberDto[] {
    return this._ctx.repo
      .findMembersForMilestone(milestoneLocalId)
      .map((row) => milestoneMemberRowToDto(row, null));
  }

}

