/**
 * orgTypes.ts — React Flow 節點/邊型別定義
 * 設計來源：design-reactflow-refactor.md §2 節點型別
 *
 * 純型別宣告檔，無 React/DOM 依賴，可獨立 tsc 驗。
 */
import type { Node, Edge } from '@xyflow/react'

// ---------------------------------------------------------------------------
// 節點類型聯合字串
// ---------------------------------------------------------------------------
export type OrgNodeType = 'group' | 'team' | 'worker'

// ---------------------------------------------------------------------------
// 節點 data 型別（callbacks 欄位 optional，避免強迫呼叫端補所有 callback）
// ---------------------------------------------------------------------------

/** 工作群組節點 data（點本體 toggle 群展開收合）。 */
export interface GroupNodeData extends Record<string, unknown> {
  groupId: string
  name: string
  icon?: string
  color?: string
  /** 是否已收合（隱藏該群下的 team 節點）*/
  collapsed?: boolean
  /** 切換群收合（groupId 傳入）。 */
  onToggleGroupCollapse?: (groupId: string) => void
  /** 組織圖方向（LR=左→右，TB=上→下），供 handle position 判斷 */
  rankdir?: 'LR' | 'TB'
}

/** Team 節點 data（= manager，點開 manager 抽屜）。 */
export interface TeamNodeData extends Record<string, unknown> {
  teamId: string
  /** manager agent name，例如 'sw/manager' */
  managerName?: string
  /** manager 顯示名稱 */
  displayName: string
  /** 是否已收合（隱藏 worker 節點）*/
  collapsed: boolean
  /** 群組色帶顏色（hex 字串），由 buildOrgGraph 從 groupConfig 傳入 */
  groupColor?: string
  onSelectAgent?: (agentName: string, teamId: string) => void
  onToggleCollapse?: (teamId: string) => void
  /** 組織圖方向（LR=左→右，TB=上→下），供 handle position 判斷 */
  rankdir?: 'LR' | 'TB'
}

/** Worker 節點 data（點開 agent 抽屜）。 */
export interface WorkerNodeData extends Record<string, unknown> {
  teamId: string
  /** agent 相對路徑，例如 'sw/developer' */
  agentName: string
  displayName: string
  type?: string
  /** agent 在團隊中的角色（researcher/doer/verifier 等），供 card roleIcon 顯示 */
  roleInTeam?: string
  model?: string
  /** agent source platform（cloud/local/builtin:local）*/
  platform?: string
  onSelectAgent?: (agentName: string, teamId: string) => void
  onOpenAgentOpsSession?: (agentName: string, teamId: string) => void
  /** 組織圖方向（LR=左→右，TB=上→下），供 handle position 判斷 */
  rankdir?: 'LR' | 'TB'
}

/** 三節點 data 的 union 型別。 */
export type OrgNodeData = GroupNodeData | TeamNodeData | WorkerNodeData

// ---------------------------------------------------------------------------
// React Flow v12 自訂節點型別別名
// NodeProps<T> 的泛型參數需為完整 Node 型別（Node<Data, TypeStr>），非 Data 本身。
// 用法：export function GroupNode({ data }: NodeProps<GroupNodeType>) { ... }
// ---------------------------------------------------------------------------

export type GroupNodeType  = Node<GroupNodeData,  'group'>
export type TeamNodeType   = Node<TeamNodeData,   'team'>
export type WorkerNodeType = Node<WorkerNodeData, 'worker'>

// ---------------------------------------------------------------------------
// Node / Edge 型別別名
// id 規則：group-{groupId} / team-{teamId} / worker-{teamId}/{agentName}
// ---------------------------------------------------------------------------

export type OrgNode = Node<OrgNodeData, OrgNodeType>
export type OrgEdge = Edge
