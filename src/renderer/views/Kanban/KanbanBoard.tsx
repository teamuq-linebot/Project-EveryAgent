import React, { useState, useCallback, useMemo } from 'react'
import TaskCard from './TaskCard'
import type { Task, RunStateMap } from '../../hooks/useTasks'
import { ACTIVE_COLUMNS, groupTasksByColumn } from '../../hooks/useTasks'

interface Props {
  tasks: Task[]
  runStates: RunStateMap
  loading: boolean
  error: string | null
  onCardDoubleClick: (task: Task) => void
  onCardMove: (taskId: string, newStatus: string) => void
}

/** 拖放目標欄 hover 狀態 */
type DragTarget = string | null

export default function KanbanBoard({
  tasks,
  runStates,
  loading,
  error,
  onCardDoubleClick,
  onCardMove,
}: Props): React.JSX.Element {
  // 正在拖曳的 task id + 來源欄 status
  const [dragging, setDragging] = useState<{ taskId: string; fromStatus: string } | null>(null)
  const [dragTarget, setDragTarget] = useState<DragTarget>(null)

  // 背景輪詢刷新時 tasks 引用換新 → grouped 重算；用 useMemo 避免每次父層 re-render
  // 都重建分欄 Map（次要閃源消除，配合 TaskCard React.memo）。
  const grouped = useMemo(() => groupTasksByColumn(tasks), [tasks])

  const handleDragStart = useCallback(
    (task: Task, e: React.DragEvent<HTMLDivElement>) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', task.id)
      setDragging({ taskId: task.id, fromStatus: task.status })
    },
    []
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, colStatus: string) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDragTarget(colStatus)
    },
    []
  )

  const handleDragLeave = useCallback(() => {
    setDragTarget(null)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>, toStatus: string) => {
      e.preventDefault()
      setDragTarget(null)
      if (!dragging) return
      const { taskId, fromStatus } = dragging
      setDragging(null)
      if (fromStatus === toStatus) return
      onCardMove(taskId, toStatus)
    },
    [dragging, onCardMove]
  )

  const handleDragEnd = useCallback(() => {
    setDragging(null)
    setDragTarget(null)
  }, [])

  if (loading) {
    return (
      <div className="kanban-status">
        <span style={{ color: 'var(--text-secondary)' }}>載入中…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="kanban-status">
        <span style={{ color: 'var(--error)' }}>載入失敗：{error}</span>
      </div>
    )
  }

  return (
    <div className="kanban-container">
    <div className="kanban-board">
      {ACTIVE_COLUMNS.filter(({ status }) => status !== 'PREPARATION').map(({ label, status }) => {
        const colTasks = grouped.get(status) ?? []
        const isTarget = dragTarget === status

        return (
          <div
            key={status}
            className={`kanban-col${isTarget ? ' kanban-col--drag-over' : ''}`}
            onDragOver={(e) => handleDragOver(e, status)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, status)}
          >
            <div className="kanban-col__header">
              <span className="kanban-col__name">{label}</span>
              <span className="kanban-col__badge">{colTasks.length}</span>
            </div>
            <div className="kanban-col__cards">
              {colTasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  runState={runStates[task.id] ?? 'none'}
                  platformName={null}
                  userShort={null}
                  onDoubleClick={onCardDoubleClick}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
    </div>
  )
}
