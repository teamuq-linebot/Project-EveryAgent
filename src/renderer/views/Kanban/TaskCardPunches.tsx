import React, { useState } from 'react'
import { useCheckinRecords } from '../../hooks/useCheckinRecords'
import { punchMinutesDisplay, statusColorClass } from '../Session/PunchTable'
import PunchDetailDialog from '../Session/PunchDetailDialog'
import type { PunchRow } from '../../../shared/ipcContracts'

interface Props {
  /** 任務 local id；用於 punches:listForTask 查打卡紀錄。 */
  taskId: string
}

/**
 * TaskCardPunches — 看板卡片底部「打卡紀錄」收合區。
 *
 * - 預設收合；mount 即讀一次 DB（供 toggle 顯示筆數），展開時 reload() 重抓求新鮮。
 * - 看板欄寬窄（min-width 220px），故用精簡列表（狀態·項目·工時）而非 8 欄 PunchTable；
 *   點單筆開既有 PunchDetailDialog 看完整細項（重用，不重造）。
 * - monitorSignature 傳 ''：看板無 monitor 推播，靠 mount 抓取 + 展開 reload 維持新鮮。
 * - 所有互動 stopPropagation，避免觸發父卡片的拖曳 / 雙擊開 session。
 */
export default function TaskCardPunches({ taskId }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { records, loading, error, reload } = useCheckinRecords(taskId, '')
  const [detailRow, setDetailRow] = useState<PunchRow | null>(null)

  // 過濾掉「已中斷」（session 中途死掉、無有效完成時間的噪音列）；
  // 保留 已打卡 / 執行中 / 錯誤。完整紀錄仍可於 PunchDetailDialog 查看。
  const visible = records.filter((r) => r.status !== '已中斷')
  const count = visible.length

  const toggle = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setExpanded((v) => {
      const next = !v
      if (next) reload() // 展開時重抓，避免顯示陳舊資料
      return next
    })
  }

  return (
    <div
      className="task-card__punches"
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="task-card__punches-toggle"
        onClick={toggle}
        aria-expanded={expanded}
        title={expanded ? '收合打卡紀錄' : '展開打卡紀錄'}
      >
        <span className={`task-card__punches-caret${expanded ? ' is-open' : ''}`}>▸</span>
        <span className="task-card__punches-label">打卡紀錄</span>
        <span className="task-card__punches-count">{count}</span>
      </button>

      {expanded && (
        <div className="task-card__punches-body">
          {loading && count === 0 ? (
            <div className="task-card__punches-empty">載入中…</div>
          ) : error != null ? (
            <div className="task-card__punches-empty">讀取失敗：{error}</div>
          ) : count === 0 ? (
            <div className="task-card__punches-empty">尚無打卡記錄</div>
          ) : (
            <ul className="task-card__punch-list">
              {visible.map((row, i) => (
                <li
                  key={`${String(row.name)}-${String(row.started_at)}-${i}`}
                  className="task-card__punch-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDetailRow(row)
                  }}
                  title="點擊查看完整細項"
                >
                  <span className={`task-card__punch-status ${statusColorClass(row.status)}`}>
                    {row.status}
                  </span>
                  <span className="task-card__punch-name">{String(row.name) || '(未命名)'}</span>
                  <span className="task-card__punch-min">
                    {punchMinutesDisplay(row.status, row.started_at, row.ended_at)} 分
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {detailRow !== null && (
        <PunchDetailDialog row={detailRow} onClose={() => setDetailRow(null)} />
      )}
    </div>
  )
}
