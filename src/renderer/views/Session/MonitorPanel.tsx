import React, { useState, useEffect, useCallback } from 'react'
import PunchTable from './PunchTable'
import type { MonitorState } from '../../hooks/useMonitor'
import { useCheckinRecords } from '../../hooks/useCheckinRecords'
import type { BindSessionItem } from '../../../shared/ipcContracts'

interface Props {
  sessionId: string
  taskId: string
  monitorState: MonitorState
  /** 外部觸發綁定清單重整（header 套用專案設定後 +1） */
  refreshKey?: number
  onStart: () => void
  onStop: () => void
  /** 列此專案所有 claude session（綁定下拉用） */
  onListSessions: () => Promise<BindSessionItem[]>
  /** 換綁監測對象（null = 新開 session） */
  onRebind: (claudeSessionId: string | null) => Promise<void>
  /** session 改名（寫 custom-title）；回成功與否 */
  onRename: (customTitle: string) => Promise<boolean>
  /** 專案路徑草稿（移自 SessionTab header，現置於綁定列上方） */
  projectPath: string
  /** 專案路徑輸入變動 */
  onProjectPathChange: (path: string) => void
  /** 套用專案路徑（輸入框 blur / Enter）→ 重解析啟動指令並重整綁定 */
  onApplyProject: () => void
  /** 開資料夾選擇對話框（瀏覽鈕）→ 填入並立即套用 */
  onBrowse: () => void
  /** 專案路徑曾被自動修正（原綁定路徑失效，反解自 session 紀錄）→ 顯示提示 */
  pathAutofixed?: boolean
}

/**
 * MonitorPanel — 監測面板。
 * 專案路徑列 + 綁定列（session 下拉 + 套用 + 重整）+ 工具列（start/stop + 狀態）+ PunchTable（7 欄）。
 * 專案路徑置於綁定列上方；AI 模組選擇已移至對話面板頂端。
 * 對應 Qt monitor_area 的綁定下拉 / 監測表格。
 */
export default function MonitorPanel({
  sessionId: _sessionId,
  taskId,
  monitorState,
  refreshKey,
  onStart,
  onStop,
  onListSessions,
  onRebind,
  onRename,
  projectPath,
  onProjectPathChange,
  onApplyProject,
  onBrowse,
  pathAutofixed,
}: Props): React.JSX.Element {
  const { rows, statusText, active } = monitorState

  // 內容指紋：捕捉「列內容變動（subtask 回填 / hours 累進 / 狀態轉換）」與「net-zero 變動」，
  // 比 rows.length 更能偵測推播事件（AV1）。
  const monitorSignature = rows.map((r) => `${String(r.started_at ?? '')}|${r.status}|${String(r.ended_at ?? '')}`).join(',')

  // DB 打卡紀錄：mount 時讀取，monitor 推播 signature 變動時刷新
  const { records: dbRows, error: dbError } = useCheckinRecords(taskId, monitorSignature)

  const [sessions, setSessions] = useState<BindSessionItem[]>([])
  // '' = 「＋ 新 session」項
  const [selected, setSelected] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')

  const refresh = useCallback(async () => {
    const list = await onListSessions()
    setSessions(list)
    const cur = list.find((s) => s.current)
    setSelected(cur ? cur.id : '')
  }, [onListSessions])

  // 進面板載入一次清單；header 套用專案設定（refreshKey +1）時重抓。
  useEffect(() => {
    refresh()
  }, [refresh, refreshKey])

  const apply = useCallback(async () => {
    setBusy(true)
    try {
      await onRebind(selected || null)
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [selected, onRebind, refresh])

  const doRename = useCallback(async () => {
    const t = renameText.trim()
    if (!t) {
      setRenaming(false)
      return
    }
    setBusy(true)
    try {
      await onRename(t)
      setRenaming(false)
      setRenameText('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [renameText, onRename, refresh])

  return (
    <div className="monitor-panel">
      {/* 專案路徑列（移自 SessionTab header；置於「選擇對話」綁定列上方） */}
      <div className="monitor-panel__bind">
        <span className="monitor-panel__bind-label">專案路徑</span>
        <input
          className="monitor-panel__bind-select"
          value={projectPath}
          onChange={(e) => onProjectPathChange(e.target.value)}
          onBlur={onApplyProject}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          placeholder="專案資料夾路徑…"
          title={projectPath || '專案資料夾路徑'}
        />
        <button
          className="monitor-panel__btn monitor-panel__btn--ghost"
          onClick={onBrowse}
        >
          瀏覽
        </button>
      </div>
      {pathAutofixed && (
        <div className="session-path-autofix-note">
          ⚙ 已自動修正專案路徑（原綁定路徑失效，已反解自 session 紀錄）
        </div>
      )}

      {/* 綁定列 */}
      <div className="monitor-panel__bind">
        <span className="monitor-panel__bind-label">對話內容</span>
        <select
          className="monitor-panel__bind-select"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          title="選擇要監測 / resume 的對話"
        >
          <option value="">＋ 新 session</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id} disabled={s.busy} title={s.tooltip}>
              {s.label}
              {s.current ? '（目前）' : ''}
              {s.busy ? '（其他任務監測中）' : ''}
            </option>
          ))}
        </select>
        <button
          className="monitor-panel__btn monitor-panel__btn--ghost"
          onClick={apply}
          disabled={busy}
        >
          {busy ? '套用中…' : '套用'}
        </button>
        <button
          className="monitor-panel__btn monitor-panel__btn--ghost"
          onClick={refresh}
          disabled={busy}
        >
          重整
        </button>
        <button
          className="monitor-panel__btn monitor-panel__btn--ghost"
          onClick={() => setRenaming((v) => !v)}
          disabled={busy}
          title="替目前綁定的 session 命名（寫入 claude /rename）"
        >
          改名
        </button>
      </div>

      {/* 改名輸入列（toggle） */}
      {renaming && (
        <div className="monitor-panel__bind">
          <input
            className="monitor-panel__bind-select"
            placeholder="輸入 session 名稱…"
            value={renameText}
            autoFocus
            onChange={(e) => setRenameText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') doRename()
              else if (e.key === 'Escape') setRenaming(false)
            }}
          />
          <button
            className="monitor-panel__btn monitor-panel__btn--ghost"
            onClick={doRename}
            disabled={busy}
          >
            確定
          </button>
          <button
            className="monitor-panel__btn monitor-panel__btn--ghost"
            onClick={() => setRenaming(false)}
            disabled={busy}
          >
            取消
          </button>
        </div>
      )}

      {/* 工具列 */}
      <div className="monitor-panel__toolbar">
        <span className="monitor-panel__label">打卡紀錄</span>
        <div className="monitor-panel__actions">
          {!active ? (
            <button className="monitor-panel__btn monitor-panel__btn--start" onClick={onStart}>
              開始監測
            </button>
          ) : (
            <button className="monitor-panel__btn monitor-panel__btn--stop" onClick={onStop}>
              停止監測
            </button>
          )}
        </div>
      </div>

      {/* 狀態小字 */}
      {statusText !== '' && <div className="monitor-panel__status">{statusText}</div>}

      {/* 打卡記錄讀取失敗提示 */}
      {dbError != null && (
        <div className="monitor-panel__status" style={{ color: 'var(--color-error, #e53e3e)' }}>
          讀取打卡記錄失敗：{dbError}
        </div>
      )}

      {/* 打卡表（DB 來源，monitor 推播只用來觸發刷新） */}
      <PunchTable rows={dbRows} />
    </div>
  )
}
