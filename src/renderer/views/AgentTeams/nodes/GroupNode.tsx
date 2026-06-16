/**
 * GroupNode.tsx — 工作群組節點（React Flow 自訂節點）
 * 設計來源：design-reactflow-refactor.md §5.1 GroupNode
 *
 * LR 佈局：左側色帶 + icon + name + chevron（點本體 toggle 展開/收合）
 * - 右側 source handle（LR：連到 TeamNode）
 * - 不可拖曳（draggable=false 由 OrgFlowCanvas 設）
 */
import React, { useCallback } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { GroupNodeType } from '../orgTypes'

export function GroupNode({ data }: NodeProps<GroupNodeType>): React.JSX.Element {
  const color = data.color ?? '#6366f1'
  const icon = data.icon ?? '🏢'
  const collapsed = data.collapsed ?? false
  const rankdir = (data.rankdir as 'LR' | 'TB' | undefined) ?? 'LR'
  const isTB = rankdir === 'TB'

  const handleBodyClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      data.onToggleGroupCollapse?.(data.groupId)
    },
    [data],
  )

  return (
    <div
      className={`atrf-group-node${isTB ? ' atrf-group-node--tb' : ''}`}
      style={{ '--atrf-group-color': color } as React.CSSProperties}
    >
      {/* 色帶：LR=左側色帶，TB=頂部色帶 */}
      <div
        className={isTB ? 'atrf-group-band atrf-group-band--tb' : 'atrf-group-band atrf-group-band--lr'}
        style={{ background: color }}
      />
      {/* 節點主體（點擊 → toggle 群展開/收合） */}
      <button
        type="button"
        className="atrf-group-body atrf-group-body--btn nodrag"
        onClick={handleBodyClick}
        aria-label={`${data.name} 群組 ${collapsed ? '展開' : '收合'}`}
      >
        <span className="atrf-group-icon" role="img" aria-label={data.name}>
          {icon}
        </span>
        <span className="atrf-group-name">{data.name}</span>
        <span className="atrf-group-chevron" aria-hidden="true">
          {collapsed ? '▸' : '▾'}
        </span>
      </button>
      {/* source handle：LR=右側，TB=底部 */}
      <Handle
        type="source"
        position={isTB ? Position.Bottom : Position.Right}
        className="atrf-handle atrf-handle--source"
        isConnectable={false}
      />
    </div>
  )
}

export default GroupNode
