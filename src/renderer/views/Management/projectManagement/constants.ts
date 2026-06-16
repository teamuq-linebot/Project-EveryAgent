import { ACTIVE_COLUMNS } from '../../../hooks/useTasks'

// F3: 從看板 ACTIVE_COLUMNS 複用 status → 中文 label 對照（不自創 mapping，值域對齊看板）。
export const TASK_STATUS_LABELS: Record<string, string> = Object.fromEntries(
  ACTIVE_COLUMNS.map((c) => [c.status, c.label])
)

// 專案狀態 filter 選項（ProjectStatus 七值）。前 5 個 = 看板 active 欄（複用 label），
// 末 2 個 = 結案 / 取消（看板不顯示）。
export const PROJECT_STATUS_OPTIONS: { value: string; label: string }[] = [
  ...ACTIVE_COLUMNS.map((c) => ({ value: c.status, label: c.label })),
  { value: 'CLOSED', label: '結案' },
  { value: 'CANCELLED', label: '取消' },
]
// 預設勾選的狀態（準備中 / 待執行 / 進行中 / 暫停；完成 / 結案 / 取消預設不勾）。
export const DEFAULT_PROJECT_STATUS_FILTER = ['PREPARATION', 'WAITING', 'IN_PROGRESS', 'PENDING']
// 本地建立 / 無 status 的專案視為此狀態做 filter 比對（落在預設勾選集合內，故預設一律顯示）。
export const FALLBACK_PROJECT_STATUS = 'IN_PROGRESS'

export const TOOLS = ['claude', 'codex', 'vscode', 'custom'] as const
export type Tool = (typeof TOOLS)[number]
