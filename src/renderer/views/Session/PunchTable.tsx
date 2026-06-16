import React, { useState } from 'react'
import type { PunchRow } from '../../../shared/ipcContracts'
import PunchDetailDialog from './PunchDetailDialog'

interface Props {
  rows: PunchRow[]
}

/** 格式化 ISO 時間為本地 YYYY-MM-DD HH:MM:SS；解析失敗回「—」 */
function fmtClock(iso: unknown): string {
  if (iso == null || iso === '') return '—'
  try {
    const ms = typeof iso === 'number' ? iso : Date.parse(String(iso))
    if (isNaN(ms)) return '—'
    const d = new Date(ms)
    const pad = (n: number): string => String(n).padStart(2, '0')
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    return `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  } catch {
    return '—'
  }
}

/** 解析 ISO 字串或 epoch ms → 毫秒；失敗回 null。 */
function parseTsMs(ts: unknown): number | null {
  if (ts == null || ts === '') return null
  const ms = typeof ts === 'number' ? ts : Date.parse(String(ts))
  return isNaN(ms) ? null : ms
}

/**
 * 工時(分)欄：實際耗時 = 開始→結束時間戳的分鐘數，1 位小數。
 * - 結束未填（執行中）→ 算到目前時間（隨監測 render 更新）。
 * - 無開始時間 / 結束早於開始（時鐘異常）→ 「—」。
 * 注意：這是真實經過時間，與帳本記錄的 row.hours 可能不同；row.hours 會進位到 0.01 小時
 * (=0.6 分)，故顯示改用時間戳直算。
 */
export function fmtElapsedMinutes(started: unknown, ended: unknown): string {
  const s = parseTsMs(started)
  if (s == null) return '—'
  const e = parseTsMs(ended) ?? Date.now()
  const diffMs = e - s
  if (!isFinite(diffMs) || diffMs < 0) return '—'
  return `${(diffMs / 60000).toFixed(1)}`
}

/**
 * 工時(分)欄顯示：狀態為「已中斷」（stale 列，無有效完成耗時）一律顯示「—」；
 * 其餘用實際耗時（fmtElapsedMinutes）。
 */
export function punchMinutesDisplay(
  status: string,
  started: unknown,
  ended: unknown,
): string {
  if (status === '已中斷') return '—'
  return fmtElapsedMinutes(started, ended)
}

/** 狀態 → CSS class suffix（決定字色） */
export function statusColorClass(status: string): string {
  const s = status.toLowerCase()
  if (s === '已打卡' || s === 'done' || s === 'ok') return 'punch-table__status--done'
  if (s.includes('錯誤') || s.includes('error') || s.includes('fail')) return 'punch-table__status--error'
  if (s === '執行中' || s === 'running' || s === 'in_progress') return 'punch-table__status--running'
  return ''
}

const HEADERS = ['項目', '開始', '結束', '工時(分)', '狀態', '詳情']

/**
 * PunchTable — 打卡記錄表（子任務欄已移除；子任務細節見「詳情」對話框）。
 * 訂閱由父層傳入的 rows（來自 useMonitor → onMonitorRender）；
 * 點「詳情」欄 → 開 PunchDetailDialog。
 */
export default function PunchTable({ rows }: Props): React.JSX.Element {
  const [detailRow, setDetailRow] = useState<PunchRow | null>(null)

  return (
    <>
      <div className="punch-table-wrap">
        <table className="punch-table">
          <thead>
            <tr>
              {HEADERS.map((h) => (
                <th key={h} className="punch-table__th">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="punch-table__empty" colSpan={6}>尚無打卡記錄</td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={`${String(row.name)}-${String(row.started_at)}-${i}`} className="punch-table__row">
                  <td className="punch-table__td punch-table__td--name">{String(row.name)}</td>
                  <td className="punch-table__td punch-table__td--mono">{fmtClock(row.started_at)}</td>
                  <td className="punch-table__td punch-table__td--mono">
                    {row.show_end ? fmtClock(row.ended_at) : '—'}
                  </td>
                  <td className="punch-table__td punch-table__td--num">{punchMinutesDisplay(row.status, row.started_at, row.ended_at)}</td>
                  <td
                    className={`punch-table__td punch-table__status ${statusColorClass(row.status)}`}
                    title={row.error || undefined}
                  >
                    {row.status}
                  </td>
                  <td className="punch-table__td punch-table__td--detail">
                    <button
                      className="punch-table__detail-btn"
                      onClick={() => setDetailRow(row)}
                      title="點擊查看完整細項"
                    >
                      詳情
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {detailRow !== null && (
        <PunchDetailDialog row={detailRow} onClose={() => setDetailRow(null)} />
      )}
    </>
  )
}
