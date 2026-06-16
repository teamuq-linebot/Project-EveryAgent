/**
 * backend/rowMappers.ts — repo 列（snake_case Row）→ IPC 邊界 DTO 的純函式映射（純本地版）。
 *
 * 雲端相關映射（platformRowToDto / platformOperationRowToDto / _pendingOp /
 * parseProjectStatus）已隨雲端功能刪除。
 */

import type {
  ProjectRow,
  MilestoneRow,
  MilestoneMemberRow,
} from "../repo/taskTypes";
import type {
  ProjectDto,
  MilestoneDto,
  MilestoneMemberDto,
} from "../../shared/ipcContracts";

/** ProjectRow（repo snake_case 列）→ ProjectDto（IPC 邊界；local_id→id）。 */
export function projectRowToDto(row: ProjectRow): ProjectDto {
  return {
    id: row.local_id,
    remote_id: null,
    name: row.name,
    description: row.description,
    status: null,
    origin: "local",
    platform_local_id: null,
    sync_enabled: false,
    dirty: false,
    pending_op: null,
  };
}

/** MilestoneRow → MilestoneDto（IPC 邊界；含 project_local_id）。 */
export function milestoneRowToDto(row: MilestoneRow): MilestoneDto {
  return {
    id: row.local_id,
    remote_id: null,
    project_local_id: row.project_local_id,
    name: row.name,
    description: row.description,
    origin: "local",
    platform_local_id: null,
    sync_enabled: false,
    dirty: false,
    pending_op: null,
  };
}

/**
 * MilestoneMemberRow → MilestoneMemberDto（IPC 邊界；唯讀鏡像，U2 團隊成員顯示）。
 */
export function milestoneMemberRowToDto(
  row: MilestoneMemberRow,
  _myUserId: string | null = null,
): MilestoneMemberDto {
  return {
    id: row.local_id,
    remote_id: row.remote_id,
    milestone_local_id: row.milestone_local_id,
    user_id: row.user_id,
    role_id: row.role_id,
    status: row.status,
    name: row.name,
    origin: row.origin as "local" | "remote",
    platform_local_id: row.platform_local_id,
    isMe: false,
  };
}
