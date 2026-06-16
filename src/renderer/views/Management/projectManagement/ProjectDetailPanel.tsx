import React from 'react'
import type { ProjectDto } from '../../../../shared/ipcContracts'
import SourceBadge from '../../shell/SourceBadge'

interface ProjectDetailPanelProps {
  creatingProject: boolean
  selectedProject: ProjectDto | null
  projectName: string
  setProjectName: (v: string) => void
  setStatus: (v: { text: string; ok: boolean; persist?: boolean } | null) => void
  pendingMilestones: string[]
  setPendingMilestones: (v: string[]) => void
  platformNames: Map<string, string>
  platformUsers: Map<string, string>
  handleSaveProject: () => void
  projDeleteConfirm: 'idle' | 'pending' | 'deleting'
  setProjDeleteConfirm: (v: 'idle' | 'pending' | 'deleting') => void
  projDeleteTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>
  handleDeleteProject: () => Promise<void>
}

/**
 * ProjectDetailPanel — 專案明細子元件（純 presentational）。
 * 從原 ProjectManagementView detail <section> 內「creatingProject || selectedProject」分支逐字搬出。
 */
export default function ProjectDetailPanel({
  creatingProject,
  selectedProject,
  projectName,
  setProjectName,
  setStatus,
  pendingMilestones,
  setPendingMilestones,
  platformNames,
  platformUsers,
  handleSaveProject,
  projDeleteConfirm,
  setProjDeleteConfirm,
  projDeleteTimerRef,
  handleDeleteProject,
}: ProjectDetailPanelProps): React.JSX.Element {
  return (
    <>
      <h3 className="settings-section__title">{creatingProject ? '新增專案' : '專案明細'}</h3>
      <div className="settings-form">
        <label className="settings-form__label">
          名稱：
          <input
            className="settings-form__input"
            value={projectName}
            onChange={(e) => {
              setProjectName(e.target.value)
              setStatus(null)
            }}
            placeholder="輸入專案名稱"
          />
        </label>

        {/* AI 草稿套用後暫存的團隊：建立專案後一併自動建立。 */}
        {creatingProject && pendingMilestones.length > 0 && (
          <div
            style={{
              border: '1px dashed var(--border, #ccc)',
              borderRadius: 6,
              padding: 'var(--sp-2) var(--sp-3)',
              fontSize: 12,
            }}
          >
            <div style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-1)' }}>
              建立後將一併新增 {pendingMilestones.length} 個團隊（來自 AI 草稿，可先取消）：
            </div>
            <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
              {pendingMilestones.map((name, i) => (
                <li key={i}>{name}</li>
              ))}
            </ul>
            <button
              className="settings-form__btn"
              style={{ marginTop: 'var(--sp-2)' }}
              onClick={() => setPendingMilestones([])}
            >
              清除待建團隊
            </button>
          </div>
        )}

        {selectedProject && !creatingProject && (
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
              origin={selectedProject.origin}
              syncEnabled={selectedProject.sync_enabled}
              platformName={
                selectedProject.platform_local_id
                  ? platformNames.get(selectedProject.platform_local_id)
                  : null
              }
              userShort={selectedProject.platform_local_id ? platformUsers.get(selectedProject.platform_local_id) ?? null : null}
            />
            {selectedProject.dirty ? '· 本地未同步' : ''}
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
          <button className="settings-form__btn settings-form__btn--primary" onClick={handleSaveProject}>
            {creatingProject ? '建立' : '儲存'}
          </button>
          {selectedProject && !creatingProject && (
            projDeleteConfirm === 'idle' ? (
              <button
                className="settings-form__btn"
                onClick={() => {
                  setProjDeleteConfirm('pending')
                  projDeleteTimerRef.current = setTimeout(() => setProjDeleteConfirm('idle'), 3000)
                }}
              >
                刪除
              </button>
            ) : (
              <div className="management-confirm-row">
                <button
                  className="settings-form__btn settings-form__btn--danger"
                  disabled={projDeleteConfirm === 'deleting'}
                  onClick={async () => {
                    if (projDeleteTimerRef.current) clearTimeout(projDeleteTimerRef.current)
                    setProjDeleteConfirm('deleting')
                    await handleDeleteProject()
                    setProjDeleteConfirm('idle')
                  }}
                >
                  {projDeleteConfirm === 'deleting' ? '刪除中…' : '⚠ 確認刪除？'}
                </button>
                <button
                  className="settings-form__btn"
                  disabled={projDeleteConfirm === 'deleting'}
                  onClick={() => {
                    if (projDeleteTimerRef.current) clearTimeout(projDeleteTimerRef.current)
                    setProjDeleteConfirm('idle')
                  }}
                >
                  取消
                </button>
              </div>
            )
          )}
        </div>
      </div>
    </>
  )
}
