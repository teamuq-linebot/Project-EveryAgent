/**
 * TeamNode.tsx — 團隊 / manager 節點（React Flow 自訂節點）
 * 設計來源：design-reactflow-refactor.md §5.1 TeamNode
 *
 * LR 佈局：
 * - 左側 target handle（接自 GroupNode）
 * - 右側 source handle（連到 WorkerNode，收合時無 source handle 使用）
 * - 左色帶（groupColor 由上層 data 傳入）
 * - 點本體 → toggle collapsedTeams（展開/收合成員） + chevron
 * - ⓘ 詳情小鈕（角落）→ onSelectAgent 開 manager 抽屜
 */
import React, { useCallback } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import type { TeamNodeType } from '../orgTypes'

export function TeamNode({ data }: NodeProps<TeamNodeType>): React.JSX.Element {
  const {
    teamId,
    managerName,
    displayName,
    collapsed,
    groupColor: groupColorData,
    onSelectAgent,
    onToggleCollapse,
  } = data

  // groupColor：由 orgTypes.ts 正式宣告，預設 neutral
  const groupColor = groupColorData ?? '#94a3b8'
  const rankdir = (data.rankdir as 'LR' | 'TB' | undefined) ?? 'LR'
  const isTB = rankdir === 'TB'

  // 點本體 = toggle 展開收合（不再開抽屜）
  const handleBodyClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onToggleCollapse?.(teamId)
    },
    [onToggleCollapse, teamId],
  )

  // ⓘ 詳情小鈕 = 開 manager 抽屜
  const handleInfoClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (onSelectAgent && managerName) {
        onSelectAgent(managerName, teamId)
      }
    },
    [onSelectAgent, managerName, teamId],
  )

  return (
    <div
      className={`atrf-team-node${collapsed ? ' atrf-team-node--collapsed' : ''}${isTB ? ' atrf-team-node--tb' : ''}`}
      style={{ '--atrf-team-color': groupColor } as React.CSSProperties}
    >
      {/* target handle：LR=左側，TB=頂部 */}
      <Handle
        type="target"
        position={isTB ? Position.Top : Position.Left}
        className="atrf-handle atrf-handle--target"
        isConnectable={false}
      />

      {/* 色帶：LR=左側，TB=頂部 */}
      <div
        className={isTB ? 'atrf-team-band atrf-team-band--tb' : 'atrf-team-band'}
        style={{ background: groupColor }}
      />

      {/* 節點主體（點擊 → toggle 展開/收合成員） */}
      <button
        type="button"
        className="atrf-team-body nodrag"
        onClick={handleBodyClick}
        aria-label={`${teamId} 團隊 ${collapsed ? '展開' : '收合'}`}
      >
        <div className="atrf-team-header">
          <span className="atrf-team-id">{teamId}</span>
          <span className="atrf-team-chevron" aria-hidden="true">
            {collapsed ? '▸' : '▾'}
          </span>
        </div>
        {displayName && (
          <div className="atrf-team-manager">
            <span className="atrf-team-manager-icon">👔</span>
            <span className="atrf-team-manager-name">{displayName}</span>
          </div>
        )}
      </button>

      {/* ⓘ 詳情 按鈕列 */}
      <div className="atrf-team-ops nodrag">
        {managerName && (
          <button
            type="button"
            className="atrf-ops-btn atrf-ops-btn--info"
            onClick={handleInfoClick}
            title={`${teamId} 詳情`}
          >
            ⓘ
          </button>
        )}
      </div>

      {/* source handle：LR=右側，TB=底部（連到 WorkerNode） */}
      <Handle
        type="source"
        position={isTB ? Position.Bottom : Position.Right}
        className="atrf-handle atrf-handle--source"
        isConnectable={false}
      />
    </div>
  )
}

export default TeamNode
