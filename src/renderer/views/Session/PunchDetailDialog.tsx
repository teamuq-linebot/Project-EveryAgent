import React, { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { PunchRow } from '../../../shared/ipcContracts'
import { fmtElapsedMinutes, punchMinutesDisplay } from './PunchTable'

interface Props {
  row: PunchRow
  onClose: () => void
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

/**
 * 工時顯示：給 PunchTable 的分鐘字串（'—' 或 'Y.Y'）補上「分」單位；'—' 不加單位。
 * 刻意用實際耗時（開始→結束時間戳直算）而非 row.hours；後者進位到 0.01 小時
 * （=0.6 分），會把分鐘量化成 0.6 倍數而顯得怪。
 */
function withMinUnit(mins: string): string {
  return mins === '—' ? '—' : `${mins} 分`
}

function val(v: unknown): string {
  const s = v == null ? '' : String(v).trim()
  return s === '' ? '—' : s
}

/** 把 cli 欄（'claude' | 'codex'）映為可讀來源標籤；空 / 未知 → '—'。 */
function cliLabel(cli: unknown): string {
  const s = (cli == null ? '' : String(cli)).trim().toLowerCase()
  if (s === 'claude') return 'Claude'
  if (s === 'codex') return 'Codex'
  return s === '' ? '—' : s
}

/**
 * lexicalToMarkdownSource — 將 subtasks.description 的 Lexical JSON 還原回原始文字（= Markdown 原文）。
 *
 * 存入端 textToLexical() 是把原文「以 \n 切成多段 paragraph」（空行→空 paragraph）；
 * 故忠實反轉 = 每個頂層 paragraph 收其 text 節點串起來成一行，再以 \n join 回去。
 * 這樣能保留空白行 / 清單 / 標題等 Markdown 結構（舊版 plainText 會把 \n{2,} 併成 \n 而破壞結構）。
 * 解析失敗或非 JSON（相容舊純文字 / 直接 Markdown 欄）→ 原樣回傳。
 */
function lexicalToMarkdownSource(raw: string | null | undefined): string {
  if (raw == null || raw.trim() === '') return ''
  const s = raw.trim()
  if (!s.startsWith('{')) return s // 非 JSON：已是純文字 / Markdown 原文
  try {
    const doc = JSON.parse(s) as Record<string, unknown>
    const root = (doc['root'] ?? doc) as Record<string, unknown>
    const children = root['children']
    if (!Array.isArray(children)) return ''
    const collectText = (node: unknown, out: string[]): void => {
      if (node == null || typeof node !== 'object') return
      const n = node as Record<string, unknown>
      if (n['type'] === 'text' && typeof n['text'] === 'string') {
        out.push(n['text'])
        return
      }
      const kids = n['children']
      if (Array.isArray(kids)) for (const k of kids) collectText(k, out)
    }
    // 每個頂層 paragraph = 原文一行（空 paragraph → 空字串 → 還原空白行）。
    const lines = children.map((para) => {
      const parts: string[] = []
      collectText(para, parts)
      return parts.join('')
    })
    return lines.join('\n').trim()
  } catch {
    return s // 解析失敗：原樣顯示
  }
}

/**
 * PunchDetailDialog — 點「詳情」欄彈出的 Modal。
 * 兩區塊：打卡資訊（punch 欄位） + 子任務資訊（subtasks JOIN 欄位）。
 */
export default function PunchDetailDialog({ row, onClose }: Props): React.JSX.Element {
  // 點 backdrop 關閉
  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose()
  }

  const hasSubtask =
    row.subtask_id != null && row.subtask_id !== '' && row.subtask_id !== '—'

  // 子任務描述：Lexical JSON → 還原 Markdown 原文 → marked 渲染 → DOMPurify 消毒（同對話面板策略）。
  const descHtml = useMemo<string | null>(() => {
    const md = lexicalToMarkdownSource(row.subtask_description)
    if (md === '') return null
    try {
      return DOMPurify.sanitize(marked.parse(md, { async: false }) as string)
    } catch {
      return null
    }
  }, [row.subtask_description])

  return (
    <div className="punch-dialog-backdrop" onClick={handleBackdrop} role="dialog" aria-modal="true">
      <div className="punch-dialog">
        <div className="punch-dialog__header">
          <span className="punch-dialog__title">打卡詳情</span>
          <button className="punch-dialog__close" onClick={onClose} title="關閉">✕</button>
        </div>
        <div className="punch-dialog__body">
          {/* ── 打卡資訊 ── */}
          <div className="punch-dialog__section">
            <span className="punch-dialog__field-label">打卡資訊</span>
          </div>
          <table className="punch-dialog__form">
            <tbody>
              <DetailRow label="項目" value={val(row.name)} />
              <DetailRow label="來源" value={cliLabel(row.cli)} />
              <DetailRow label="開始" value={fmtClock(row.started_at)} />
              <DetailRow label="結束" value={row.show_end ? fmtClock(row.ended_at) : '—'} />
              <DetailRow
                label="工時"
                value={withMinUnit(punchMinutesDisplay(row.status, row.started_at, row.ended_at))}
              />
              <DetailRow label="狀態" value={val(row.status)} />
            </tbody>
          </table>
          {row.error && row.error.trim() !== '' && (
            <div className="punch-dialog__section">
              <span className="punch-dialog__field-label">錯誤</span>
              <div className="punch-dialog__error">{row.error}</div>
            </div>
          )}

          {/* ── 子任務資訊 ── */}
          <div className="punch-dialog__section">
            <span className="punch-dialog__field-label">子任務資訊</span>
          </div>
          {hasSubtask ? (
            <>
              <table className="punch-dialog__form">
                <tbody>
                  <DetailRow label="名稱" value={val(row.subtask_name)} />
                  <DetailRow label="開始" value={fmtClock(row.subtask_start_time)} />
                  <DetailRow label="結束" value={fmtClock(row.subtask_end_time)} />
                  <DetailRow
                    label="工時"
                    value={withMinUnit(fmtElapsedMinutes(row.subtask_start_time, row.subtask_end_time))}
                  />
                  <DetailRow label="已結算" value={row.subtask_is_settled === 1 ? '是' : row.subtask_is_settled === 0 ? '否' : '—'} />
                </tbody>
              </table>
              <div className="punch-dialog__section">
                <span className="punch-dialog__field-label">描述</span>
                {descHtml != null ? (
                  // MD 已 DOMPurify 消毒（剝 script / 事件屬性），innerHTML 安全。
                  <div className="punch-dialog__md" dangerouslySetInnerHTML={{ __html: descHtml }} />
                ) : (
                  <div className="punch-dialog__desc punch-dialog__desc--expanded">—</div>
                )}
              </div>
            </>
          ) : (
            <div className="punch-dialog__section">
              <span className="punch-dialog__field-label">無對應子任務</span>
            </div>
          )}
        </div>
        <div className="punch-dialog__footer">
          <button className="punch-dialog__btn-close" onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <tr className="punch-dialog__row">
      <td className="punch-dialog__label">{label}</td>
      <td className="punch-dialog__value">{value}</td>
    </tr>
  )
}
