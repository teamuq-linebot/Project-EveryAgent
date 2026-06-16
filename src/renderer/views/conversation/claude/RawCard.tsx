import React, { useState, useCallback } from 'react'

interface Props {
  /** 0-based index in the raw lines array (displayed as seq+1 for 1-based UX). */
  index: number
  /** 原始 JSONL record 字串（單行）。 */
  rawLine: string
}

/**
 * RawCard — Raw 模式下每則訊息的顯示卡。
 * 預設收合，展開後顯示 pretty-print JSON 或原始字串（JSON.parse 失敗時）。
 * 「複製」按鈕走 window.tuq.clipboard.writeText（sandbox 安全，沿用既有橋）。
 */
export default function RawCard({ index, rawLine }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)

  // 解析 header 資訊：seq、時間戳、record type
  const parsed = (() => {
    try {
      return JSON.parse(rawLine) as Record<string, unknown>
    } catch {
      return null
    }
  })()

  const recType: string = (() => {
    if (!parsed) return 'unknown'
    if (typeof parsed['type'] === 'string') return parsed['type']
    if (typeof parsed['role'] === 'string') return parsed['role']
    return 'unknown'
  })()

  const ts: string = (() => {
    if (!parsed) return ''
    const t = parsed['timestamp'] ?? parsed['ts'] ?? ''
    if (typeof t !== 'string') return ''
    try {
      const d = new Date(t)
      if (isNaN(d.getTime())) return t
      return d.toLocaleTimeString()
    } catch {
      return t
    }
  })()

  const pretty = parsed !== null
    ? JSON.stringify(parsed, null, 2)
    : rawLine

  const handleCopy = useCallback(() => {
    window.tuq?.clipboard?.writeText(pretty).catch(() => {/* 容錯 */})
  }, [pretty])

  return (
    <div className={`raw-card${open ? ' raw-card--open' : ''}`}>
      <button
        className="raw-card__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="raw-card__seq">#{index + 1}</span>
        {ts && <span className="raw-card__ts">{ts}</span>}
        <span className="raw-card__type">{recType}</span>
        <span className="raw-card__chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="raw-card__body">
          <pre className="raw-card__json">{pretty}</pre>
          <button className="raw-card__copy" onClick={handleCopy}>複製</button>
        </div>
      )}
    </div>
  )
}
