/**
 * WorkerNode.tsx — Worker（子成員）節點（React Flow 自訂節點）
 * 設計來源：design-reactflow-refactor.md §5.1 WorkerNode
 *
 * - roleIcon + displayName + worklog badge
 * - 上方 target handle
 * - 點 → data.onSelectAgent(agentName, teamId) 開 worker 抽屜
 */
import React, { useCallback } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { WorkerNodeType } from '../orgTypes'

/** 依 type / roleInTeam 字串回傳 emoji icon */
function roleIcon(type: string | undefined): string {
  switch (type) {
    case 'manager':    return '👔'
    case 'researcher': return '🔬'
    case 'doer':       return '⚡'
    case 'verifier':   return '✅'
    default:           return '👤'
  }
}

export function WorkerNode({ data }: NodeProps<WorkerNodeType>): React.JSX.Element {
  const { teamId, agentName, displayName, onSelectAgent } = data

  // worklogCount 由 buildOrgGraph 寫入 data（AgentNodeDto.worklogCount）
  const worklogCount = (data['worklogCount'] as number | undefined) ?? 0
  // roleInTeam 優先（researcher/doer/verifier 等角色），fallback 到 type
  const roleInTeam = data.roleInTeam as string | undefined
  const agentType = data.type as string | undefined
  const iconRole = roleInTeam ?? agentType
  const rankdir = (data.rankdir as 'LR' | 'TB' | undefined) ?? 'LR'
  const isTB = rankdir === 'TB'

  const handleClick = useCallback(() => {
    onSelectAgent?.(agentName, teamId)
  }, [onSelectAgent, agentName, teamId])

  return (
    <div className="atrf-worker-node">
      {/* target handle：LR=左側（worker 在 team 右方，邊由左接入），TB=頂部（worker 在 team 下方，邊由上接入） */}
      <Handle
        type="target"
        position={isTB ? Position.Top : Position.Left}
        className={isTB ? 'atrf-handle atrf-handle--target-top' : 'atrf-handle atrf-handle--target-left'}
        isConnectable={false}
      />

      {/* 節點主體（點擊 → 開 worker 抽屜） */}
      <button
        type="button"
        className="atrf-worker-body nodrag"
        onClick={handleClick}
        aria-label={`${displayName} 詳情`}
      >
        <span className="atrf-worker-icon" role="img" aria-label={iconRole ?? 'worker'}>
          {roleIcon(iconRole)}
        </span>
        <span className="atrf-worker-name">{displayName}</span>
        {worklogCount > 0 && (
          <span className="atrf-worker-badge" title={`${worklogCount} 筆工作記錄`}>
            {worklogCount}
          </span>
        )}
      </button>
    </div>
  )
}

export default WorkerNode
