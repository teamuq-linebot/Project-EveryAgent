import React from 'react'
import type { ProjectDto, MilestoneDto, TaskDto } from '../../../../shared/ipcContracts'
import SourceBadge from '../../shell/SourceBadge'
import { PROJECT_STATUS_OPTIONS, TASK_STATUS_LABELS } from './constants'

interface SourceGroup {
  key: string
  title: string
  projects: ProjectDto[]
}

interface ProjectMasterTreeProps {
  listWidth: number
  handleNewProject: () => void
  search: string
  setSearch: (v: string) => void
  statusFilter: Set<string>
  toggleStatusFilter: (value: string) => void
  milestoneFilter: string
  setMilestoneFilter: (v: string) => void
  allMilestones: MilestoneDto[]
  selectedProjectId: string | null
  setSelectedProjectId: (v: string | null) => void
  selectedMilestoneId: string | null
  setSelectedMilestoneId: (v: string | null) => void
  listLoading: boolean
  projects: ProjectDto[]
  sourceGroups: SourceGroup[]
  collapsedGroups: Set<string>
  setCollapsedGroups: React.Dispatch<React.SetStateAction<Set<string>>>
  milestonesLoading: boolean
  milestones: MilestoneDto[]
  platformNames: Map<string, string>
  tasksByMilestone: Map<string, TaskDto[]>
  handleNewMilestone: () => void
}

/**
 * ProjectMasterTree — 左側 master 子元件（純 presentational）。
 * 從原 ProjectManagementView main JSX 的 <aside className="management-list"> 整段逐字搬出。
 */
export default function ProjectMasterTree({
  listWidth,
  handleNewProject,
  search,
  setSearch,
  statusFilter,
  toggleStatusFilter,
  milestoneFilter,
  setMilestoneFilter,
  allMilestones,
  selectedProjectId,
  setSelectedProjectId,
  selectedMilestoneId,
  setSelectedMilestoneId,
  listLoading,
  projects,
  sourceGroups,
  collapsedGroups,
  setCollapsedGroups,
  milestonesLoading,
  milestones,
  platformNames,
  tasksByMilestone,
  handleNewMilestone,
}: ProjectMasterTreeProps): React.JSX.Element {
  return (
    <aside className="management-list" style={{ width: listWidth }}>
      <div className="management-list__header">
        <span className="management-list__title">專案</span>
        <button className="settings-form__btn settings-form__btn--primary" onClick={handleNewProject}>
          ＋ 專案
        </button>
      </div>

      <input
        className="settings-form__input"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="搜尋專案…"
        style={{ margin: 'var(--sp-2) 0' }}
      />

      {/* 專案狀態 filter（多選 checkbox；預設勾準備中 / 待執行 / 進行中 / 暫停）*/}
      <div
        className="management-filter-bar"
        role="group"
        aria-label="專案狀態 filter"
        style={{ flexWrap: 'wrap', gap: 'var(--sp-1) var(--sp-3)' }}
      >
        <span
          className="settings-form__label"
          style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}
        >
          狀態：
        </span>
        {PROJECT_STATUS_OPTIONS.map((s) => (
          <label
            key={s.value}
            className="settings-form__label"
            style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              margin: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              flexDirection: 'row',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={statusFilter.has(s.value)}
              onChange={() => toggleStatusFilter(s.value)}
            />
            {s.label}
          </label>
        ))}
      </div>

      {/* 版本/團隊 filter（spec §1.3 可插拔 filter bar）*/}
      <div className="management-filter-bar">
        <label
          htmlFor="management-milestone-filter"
          className="settings-form__label"
          style={{ fontSize: 12, color: 'var(--text-secondary)', margin: 0 }}
        >
          版本：
        </label>
        <select
          id="management-milestone-filter"
          className="settings-form__select"
          value={milestoneFilter}
          onChange={(e) => {
            const next = e.target.value
            setMilestoneFilter(next)
            // 若 filter 非空，且當前選中專案不在過濾結果內，清除選取避免左右脫鉤
            if (next) {
              const targetMil = allMilestones.find((m) => m.id === next)
              if (targetMil?.project_local_id !== selectedProjectId) {
                setSelectedProjectId(null)
                setSelectedMilestoneId(null)
              }
            }
          }}
          style={{ fontSize: 12, padding: '2px 4px' }}
        >
          <option value="">全部</option>
          {allMilestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div className="management-list__body">
        {listLoading ? (
          <div role="status" aria-label="載入中">
            <span className="sr-only">載入中，請稍候</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="management-skeleton">
                <div className="management-skeleton__line" />
                <div className="management-skeleton__line--sub" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="settings-empty">（無本地專案，按「＋ 專案」建立）</div>
        ) : sourceGroups.length === 0 ? (
          <div className="settings-empty">（目前 filter（狀態 / 版本）無匹配專案，請調整或清除 filter）</div>
        ) : (
          sourceGroups.map((group) => {
            const isCollapsed = collapsedGroups.has(group.key)
            return (
            <div key={group.key} className="management-tree__source-group">
              <button
                type="button"
                className="management-group-header"
                aria-expanded={!isCollapsed}
                onClick={() => {
                  setCollapsedGroups((prev) => {
                    const next = new Set(prev)
                    if (next.has(group.key)) next.delete(group.key)
                    else next.add(group.key)
                    return next
                  })
                }}
              >
                <span className="management-group-header__chevron">{isCollapsed ? '▶' : '▼'}</span>
                {group.title}
              </button>
              {!isCollapsed && group.projects.map((p) => (
                <div key={p.id} className="management-tree__group">
                  <button
                    className={
                      'management-tree__node' +
                      (p.id === selectedProjectId ? ' management-tree__node--selected' : '')
                    }
                    onClick={() => setSelectedProjectId(p.id)}
                    aria-pressed={p.id === selectedProjectId}
                    title={p.id}
                  >
                    <span>📁 {p.name}</span>
                    <SourceBadge
                      origin={p.origin}
                      syncEnabled={p.sync_enabled}
                      platformName={p.platform_local_id ? platformNames.get(p.platform_local_id) : null}
                    />
                    {p.dirty && <span className="management-badge">●未同步</span>}
                  </button>
                  {/* 展開選取專案下的團隊 */}
                  {p.id === selectedProjectId && milestonesLoading && (
                    <div className="management-tree__node--child management-milestones-loading" aria-busy="true" aria-label="載入團隊中">
                      <span className="management-milestones-loading__dot" />
                    </div>
                  )}
                  {p.id === selectedProjectId && !milestonesLoading &&
                    milestones.map((m) => (
                      <React.Fragment key={m.id}>
                        <button
                          className={
                            'management-tree__node management-tree__node--child' +
                            (m.id === selectedMilestoneId ? ' management-tree__node--selected' : '')
                          }
                          onClick={() => setSelectedMilestoneId(m.id)}
                          aria-pressed={m.id === selectedMilestoneId}
                          title={m.id}
                        >
                          <span>🎯 {m.name}</span>
                          <SourceBadge
                            origin={m.origin}
                            syncEnabled={m.sync_enabled}
                            platformName={m.platform_local_id ? platformNames.get(m.platform_local_id) : null}
                          />
                        </button>
                        {/* 第四層：選中的團隊下顯示任務清單（v1 純顯示）*/}
                        {m.id === selectedMilestoneId && (() => {
                          const tasks = tasksByMilestone.get(m.id) ?? []
                          if (tasks.length === 0) {
                            return (
                              <div className="management-task-row management-task-row--empty">
                                （無任務）
                              </div>
                            )
                          }
                          return tasks.map((t) => (
                            <div key={t.id} className="management-task-row">
                              <span className="management-task-row__name">{t.name}</span>
                              <span className="management-task-status">{TASK_STATUS_LABELS[t.status] ?? t.status}</span>
                            </div>
                          ))
                        })()}
                      </React.Fragment>
                    ))}
                  {p.id === selectedProjectId && !milestonesLoading && (
                    <button
                      className="management-tree__node management-tree__node--child"
                      onClick={handleNewMilestone}
                      style={{ color: 'var(--accent)' }}
                    >
                      ＋ 團隊
                    </button>
                  )}
                </div>
              ))}
            </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
