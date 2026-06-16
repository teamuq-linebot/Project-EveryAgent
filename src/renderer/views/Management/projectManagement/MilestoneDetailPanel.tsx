import React from 'react'
import type { MilestoneDto, MilestoneMemberDto, TaskDto } from '../../../../shared/ipcContracts'
import SourceBadge from '../../shell/SourceBadge'
import { TASK_STATUS_LABELS, TOOLS, type Tool } from './constants'

interface Binding {
  projectPath: string
  tool: Tool
  customCommand: string
}

interface MilestoneDetailPanelProps {
  creatingMilestone: boolean
  selectedMilestone: MilestoneDto | null
  milestoneName: string
  setMilestoneName: (v: string) => void
  setStatus: (v: { text: string; ok: boolean; persist?: boolean } | null) => void
  handleSaveMilestone: () => void
  milDeleteConfirm: 'idle' | 'pending' | 'deleting'
  setMilDeleteConfirm: (v: 'idle' | 'pending' | 'deleting') => void
  milDeleteTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  handleDeleteMilestone: () => Promise<void>
  platformNames: Map<string, string>
  platformUsers: Map<string, string>
  binding: Binding
  setBinding: React.Dispatch<React.SetStateAction<Binding>>
  handleBrowse: () => void
  handleSaveBinding: () => void
  members: MilestoneMemberDto[]
  tasksByMilestone: Map<string, TaskDto[]>
  showCreateTask: boolean
  setShowCreateTask: (v: boolean) => void
  taskName: string
  setTaskName: (v: string) => void
  creatingTask: boolean
  handleCreateTask: () => Promise<void>
}

/**
 * MilestoneDetailPanel — 團隊明細子元件（純 presentational）。
 * 從原 ProjectManagementView detail <section> 內「creatingMilestone || selectedMilestone」分支逐字搬出。
 */
export default function MilestoneDetailPanel({
  creatingMilestone,
  selectedMilestone,
  milestoneName,
  setMilestoneName,
  setStatus,
  handleSaveMilestone,
  milDeleteConfirm,
  setMilDeleteConfirm,
  milDeleteTimerRef,
  handleDeleteMilestone,
  platformNames,
  platformUsers,
  binding,
  setBinding,
  handleBrowse,
  handleSaveBinding,
  members,
  tasksByMilestone,
  showCreateTask,
  setShowCreateTask,
  taskName,
  setTaskName,
  creatingTask,
  handleCreateTask,
}: MilestoneDetailPanelProps): React.JSX.Element {
  return (
    <>
      <h3 className="settings-section__title">
        {creatingMilestone ? '新增團隊' : '團隊'}
      </h3>
      <div className="settings-form">
        <label className="settings-form__label">
          名稱：
          <input
            className="settings-form__input"
            value={milestoneName}
            onChange={(e) => {
              setMilestoneName(e.target.value)
              setStatus(null)
            }}
            placeholder="輸入團隊名稱"
          />
        </label>
        {selectedMilestone && !creatingMilestone && (
          <p
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--sp-2)',
            }}
          >
            來源：
            <SourceBadge
              origin={selectedMilestone.origin}
              syncEnabled={selectedMilestone.sync_enabled}
              platformName={
                selectedMilestone.platform_local_id
                  ? platformNames.get(selectedMilestone.platform_local_id)
                  : null
              }
              userShort={selectedMilestone.platform_local_id ? platformUsers.get(selectedMilestone.platform_local_id) ?? null : null}
            />
            {selectedMilestone.dirty ? '· 本地未同步' : ''}
          </p>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <button className="settings-form__btn settings-form__btn--primary" onClick={handleSaveMilestone}>
            {creatingMilestone ? '建立' : '儲存'}
          </button>
          {selectedMilestone && !creatingMilestone && (
            milDeleteConfirm === 'idle' ? (
              <button
                className="settings-form__btn"
                onClick={() => {
                  setMilDeleteConfirm('pending')
                  milDeleteTimerRef.current = setTimeout(() => setMilDeleteConfirm('idle'), 3000)
                }}
              >
                刪除
              </button>
            ) : (
              <div className="management-confirm-row">
                <button
                  className="settings-form__btn settings-form__btn--danger"
                  disabled={milDeleteConfirm === 'deleting'}
                  onClick={async () => {
                    if (milDeleteTimerRef.current) clearTimeout(milDeleteTimerRef.current)
                    setMilDeleteConfirm('deleting')
                    await handleDeleteMilestone()
                    setMilDeleteConfirm('idle')
                  }}
                >
                  {milDeleteConfirm === 'deleting' ? '刪除中…' : '⚠ 確認刪除？'}
                </button>
                <button
                  className="settings-form__btn"
                  disabled={milDeleteConfirm === 'deleting'}
                  onClick={() => {
                    if (milDeleteTimerRef.current) clearTimeout(milDeleteTimerRef.current)
                    setMilDeleteConfirm('idle')
                  }}
                >
                  取消
                </button>
              </div>
            )
          )}
        </div>
      </div>

      {/* 專案資料夾綁定（milestone_bindings） */}
      {selectedMilestone && !creatingMilestone && (
        <>
          <div className="management-section-title">專案資料夾綁定</div>
          <div className="settings-form">
            <label className="settings-form__label">
              專案資料夾路徑：
              <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
                <input
                  className="settings-form__input"
                  value={binding.projectPath}
                  onChange={(e) => setBinding((b) => ({ ...b, projectPath: e.target.value }))}
                  placeholder="/path/to/project"
                  style={{ flex: 1 }}
                />
                <button className="settings-form__btn" onClick={handleBrowse}>
                  瀏覽…
                </button>
              </div>
            </label>
            <label className="settings-form__label">
              工具：
              <select
                className="settings-form__select"
                value={binding.tool}
                onChange={(e) => setBinding((b) => ({ ...b, tool: e.target.value as Tool }))}
              >
                {TOOLS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            {binding.tool === 'custom' && (
              <label className="settings-form__label">
                Custom 指令：
                <input
                  className="settings-form__input"
                  value={binding.customCommand}
                  onChange={(e) => setBinding((b) => ({ ...b, customCommand: e.target.value }))}
                  placeholder="輸入自訂啟動指令"
                />
              </label>
            )}
            <button className="settings-form__btn settings-form__btn--primary" onClick={handleSaveBinding}>
              儲存綁定
            </button>
          </div>

          {/* 團隊成員（唯讀鏡像） */}
          <div className="management-section-title">團隊成員（唯讀鏡像）</div>
          {members.length === 0 ? (
            <div className="settings-empty">（無成員；成員由雲端 pull 鏡像，唯讀）</div>
          ) : (
            <table className="settings-table" role="table">
              <thead>
                <tr>
                  <th scope="col">姓名</th>
                  <th scope="col">角色</th>
                  <th scope="col">狀態</th>
                  <th scope="col">來源</th>
                </tr>
              </thead>
              <tbody>
                {members.map((mem) => (
                  <tr key={mem.id}>
                    <td>
                      {mem.name ?? mem.user_id ?? mem.remote_id ?? '—'}
                      {mem.isMe && <span className="management-me-badge">我</span>}
                    </td>
                    <td>{mem.role_id ?? '—'}</td>
                    <td className={mem.status === 'active' ? 'management-member-status--active' : ''}>
                      {mem.status ?? '—'}
                    </td>
                    <td>{mem.origin === 'remote' ? '雲端' : '本地'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* 任務清單（v1 純顯示；資料來自 tasksByMilestone useMemo）*/}
          <div className="management-section-title" style={{ marginTop: 'var(--sp-4)' }}>
            任務
          </div>
          {(() => {
            const milTasks = tasksByMilestone.get(selectedMilestone.id) ?? []
            if (milTasks.length === 0) {
              return (
                <div className="settings-empty" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                  （此團隊尚無任務）
                </div>
              )
            }
            return (
              <table className="settings-table" role="table">
                <thead>
                  <tr>
                    <th scope="col">任務名稱</th>
                    <th scope="col">狀態</th>
                  </tr>
                </thead>
                <tbody>
                  {milTasks.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>{TASK_STATUS_LABELS[t.status] ?? t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          })()}

          {/* C5：新增任務入口 — 任務清單下方 */}
          <div className="management-section-title" style={{ marginTop: 'var(--sp-4)' }}>
            新增任務
          </div>
          {!showCreateTask ? (
            <button
              className="settings-form__btn settings-form__btn--primary"
              onClick={() => { setShowCreateTask(true); setTaskName('') }}
            >
              ＋ 新增任務
            </button>
          ) : (
            <div className="management-create-task-form">
              {!!selectedMilestone?.platform_local_id && selectedMilestone.platform_local_id !== 'builtin:local' && (
                <p className="management-create-task-form__hint">
                  此任務將加入同步佇列，自動推送至雲端。
                </p>
              )}
              <div className="management-create-task-form__row">
                <input
                  className="settings-form__input"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="輸入任務名稱（必填）"
                  onKeyDown={(e) => { if (e.key === 'Enter' && taskName.trim() && !creatingTask) void handleCreateTask() }}
                  maxLength={200}
                  autoFocus
                />
                <button
                  className="settings-form__btn settings-form__btn--primary"
                  disabled={!taskName.trim() || creatingTask}
                  onClick={() => void handleCreateTask()}
                >
                  {creatingTask ? '建立中…' : '建立'}
                </button>
                <button
                  className="settings-form__btn"
                  disabled={creatingTask}
                  onClick={() => { setShowCreateTask(false); setTaskName('') }}
                >
                  取消
                </button>
              </div>
              {taskName.length >= 200 && (
                <p className="management-create-task-form__error">任務名稱不得超過 200 字</p>
              )}
            </div>
          )}
        </>
      )}
    </>
  )
}
