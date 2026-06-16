/**
 * taskService.ts — Task Application Service（純本地，B6 去雲端 filter）。
 *
 * 純本地 app：任務存本地 SQLite，無雲端同步、無登入身分、無 mineOnly / platformTemplates 過濾。
 * findAllTasks 直接讀 repo，只支援 statuses / search / limit / offset 基本過濾。
 */

import type { SqliteTaskRepository } from '../repo/sqliteTaskRepository'
import type { TaskCreateInput, TaskFindFilter, TaskRow } from '../repo/taskTypes'
import type { TaskDto } from '../../shared/ipcContracts'

/**
 * findAllTasks 對外選項（純本地：只支援基本過濾，無 mineOnly / platformTemplates）。
 */
export interface TaskServiceFindAllOpts {
  search?: string | null
  statuses?: string | string[] | null
  limit?: number | null
  offset?: number | null
}

// ---------------------------------------------------------------------------
// TaskService
// ---------------------------------------------------------------------------

export class TaskService {
  private readonly _repo: SqliteTaskRepository

  /**
   * @param repo 本地 repo（SqliteTaskRepository）。
   */
  constructor(repo: SqliteTaskRepository) {
    this._repo = repo
  }

  /**
   * 取看板任務（純讀本地 SQLite；不觸發 pull、不等網路）。
   * repo.findAllTasks 回 TaskRow[]（snake_case）→ 投影成 TaskDto[]（renderer 邊界型別）。
   */
  async findAllTasks(opts: TaskServiceFindAllOpts = {}): Promise<TaskDto[]> {
    const {
      search = null,
      statuses = null,
      limit = null,
      offset = null,
    } = opts

    const filter: TaskFindFilter = {
      search,
      statuses,
      limit,
      offset,
    }

    const rows = this._repo.findAllTasks(filter)
    return rows.map(projectTaskRow)
  }

  /**
   * 本地建立 task（§2e 設計文件）。
   *   呼叫 repo.createTask（寫 SQLite）後以 projectTaskRow 投影成 TaskDto 回傳。
   *   純本地建立，立即寫入 SQLite。
   */
  async createTask(input: TaskCreateInput): Promise<TaskDto> {
    const row = this._repo.createTask(input)
    return projectTaskRow(row)
  }
}

// ---------------------------------------------------------------------------
// 投影：TaskRow（repo 內部 snake_case 列）→ TaskDto（renderer IPC 邊界型別）
// ---------------------------------------------------------------------------

/**
 * 單列投影（§2.6 IPC 邊界）。純本地列由欄位組裝，id=local_id；milestone 顯示欄留 null。
 */
export function projectTaskRow(row: TaskRow): TaskDto {
  return {
    id: row.local_id,
    name: row.name ?? '',
    status: row.status ?? '',
    start_date: row.start_date,
    end_date: row.end_date,
    milestone_id: row.milestone_local_id,
    milestone_public_id: null,
    milestone_name: null,
    project_local_id: row.project_local_id ?? null,
    raw: {},
  }
}
