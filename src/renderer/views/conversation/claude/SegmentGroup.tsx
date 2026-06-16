import React, { useState, useEffect, useRef } from 'react'
import type { ConversationMessage, SegmentInfo } from '../../../../shared/ipcContracts'
import type { SegmentLoadState } from '../../../hooks/useConversation'
import {
  Seg,
  SegItem,
  fmtTime,
  numCompact,
  buildRenderSeq,
  collectAskIds,
  EndDivider,
  type RenderEntry,
} from './helpers'
import { Card, AskCard } from './Card'

/**
 * 渲染一條 buildRenderSeq 產出的項（card / run / divider / ask）。
 * defaultOpen：傳給 Card/AiRunGroup 控制初始展開（isLast 段為 true）。
 * key 由 caller 以陣列索引給定，故此處不再加 key。
 */
export function renderEntry(entry: RenderEntry, defaultOpen: boolean): React.JSX.Element {
  if (entry.kind === 'run') return <AiRunGroup items={entry.items} defaultOpen={defaultOpen} />
  if (entry.kind === 'divider') return <EndDivider kind={entry.dKind} labels={entry.labels} />
  // ask entry 已由 buildRenderSeq/isAskQuestion 保證 JSON 有效；AskCard 不會 null
  if (entry.kind === 'ask') return <AskCard m={entry.item.m} />
  return <Card m={entry.item.m} defaultExpanded={defaultOpen} />
}

// ============================================================
// AiRunGroup — 連續 AI 卡群組（主對話用；子對話內部不套用）
// ============================================================

/**
 * 主對話中連續 ≥2 張 assistant 卡的可展開群組。
 *
 * 標頭格式：`AI ×N · 起–迄時間 · ↑Σ ↓Σ`
 *   - 時間取第一張與最後一張的 timestamp（fmtTime），同值時只顯示一個。
 *   - token 為該 run 各卡 usage 加總；全 0 時不顯示 token 段。
 *
 * 開闔：由 defaultOpen prop 控制初始狀態；
 *   isLast 段內的 AiRunGroup 傳 defaultOpen=true，其餘傳 false。
 *   內部使用 userTouchedRef，一旦使用者手動操作即不再跟隨外部 defaultOpen 變動。
 */
export function AiRunGroup({
  items,
  defaultOpen,
}: {
  items: SegItem[]
  defaultOpen: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  const userTouchedRef = useRef(false)
  useEffect(() => {
    if (!userTouchedRef.current) setOpen(defaultOpen)
  }, [defaultOpen])

  // 統計：N、時間範圍、token 加總
  const count = items.length
  const t0 = fmtTime(items[0]?.m.timestamp)
  const t1 = fmtTime(items[items.length - 1]?.m.timestamp)
  const timeRange = t0 && t1 && t0 !== t1 ? `${t0}–${t1}` : t0 || ''

  let tokIn = 0, tokOut = 0
  for (const { m } of items) {
    const u = m.usage
    if (!u) continue
    tokIn += u.input ?? 0
    tokOut += u.output ?? 0
  }
  const hasTokens = tokIn > 0 || tokOut > 0

  return (
    <div className={`ai-run-group${open ? ' group-open' : ''}`}>
      <div
        className="ai-run-group-header"
        onClick={() => {
          userTouchedRef.current = true
          setOpen((v) => !v)
        }}
      >
        <span className="ai-run-group-chevron">▶</span>
        <span className="ai-run-group-label">AI ×{count}</span>
        {timeRange && (
          <>
            <span className="ai-run-group-sep">·</span>
            <span className="ai-run-group-time">{timeRange}</span>
          </>
        )}
        {hasTokens && (
          <>
            <span className="ai-run-group-sep">·</span>
            <span className="badge-tokens">{`↑${numCompact(tokIn)} ↓${numCompact(tokOut)}`}</span>
          </>
        )}
      </div>
      {open && (
        <div className="ai-run-group-body">
          {/* buildRenderSeq 保證 run 內僅含 runnable（assistant/meta）卡，無分隔線/system */}
          {items.map(({ m, key }) => (
            <Card key={key} m={m} defaultExpanded={defaultOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 舊路徑段落群組（從前端推段的 Seg 渲染；stale-preload 退回時用）。
 * 開闔：isLast=true 展開、卡片預設展開；其餘收合。
 *
 * NOTE（ai-run-group-20260604）：LegacySegmentGroup 不套用 AiRunGroup 群組化。
 * 原因：stale-preload 路徑為備援路徑，使用率極低（僅在新 IPC 未掛載時觸發）；
 * 此路徑的 Seg.items 已整段平鋪，加群組邏輯後 TS 結構差異大且測試覆蓋不足。
 * 若日後廢棄 legacy 路徑前不需要投資修改此元件。
 */
export function LegacySegmentGroup({
  seg,
  isLast,
  collapseSignal = 0,
  expandSignal = 0,
}: {
  seg: Seg
  isLast: boolean
  /** 每次 +1 → 強制收合本段（由 ConversationPanel「收合全部」按鈕觸發） */
  collapseSignal?: number
  /** 每次 +1 → 強制展開本段（由 ConversationPanel「展開全部」按鈕觸發） */
  expandSignal?: number
}): React.JSX.Element {
  const [open, setOpen] = useState(isLast)
  const userTouchedRef = useRef(false)
  useEffect(() => {
    if (!userTouchedRef.current) setOpen(isLast)
  }, [isLast])

  // collapseSignal/expandSignal 變動（值非 0 且有變化）→ 強制開闔並標記 userTouched
  useEffect(() => {
    if (collapseSignal === 0) return
    userTouchedRef.current = true
    setOpen(false)
  }, [collapseSignal])

  useEffect(() => {
    if (expandSignal === 0) return
    userTouchedRef.current = true
    setOpen(true)
  }, [expandSignal])

  // v13：notify 不開段，notify 變體分支已移除（dead code 清除）

  return (
    <div className={`segment-group${open ? ' group-open' : ''}`}>
      <div
        className="segment-group-header"
        onClick={() => {
          userTouchedRef.current = true
          setOpen((v) => !v)
        }}
      >
        <span className="segment-group-chevron">▶</span>
        <span className="segment-num">{`段 ${seg.n}`}</span>
        <span className="segment-sep">·</span>
        <span
          className={`segment-label${seg.isCommand ? ' segment-label-command' : ''}`}
          title={seg.label}
        >
          {seg.label}
        </span>
        {seg.durationText && <span className="segment-duration">{seg.durationText}</span>}
        <span className="segment-sep">·</span>
        <span className="segment-count">{seg.items.length} 則</span>
      </div>
      {open && (
        <div className="segment-group-body">
          {/* legacy 路徑亦走 buildRenderSeq：分隔線/Ask 卡/run 群組與新路徑一致 */}
          {buildRenderSeq(seg.items, collectAskIds(seg.items)).map((entry, ei) => (
            <React.Fragment key={ei}>{renderEntry(entry, isLast)}</React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 新路徑段落群組（段骨架常駐 + 記憶體/DB 雙來源）。
 *
 * 渲染決策（由父層決定後傳入）：
 *   - `messages` 有值 → 段已齊全（窗內或快取），直接記憶體渲染。
 *   - `messages` 為 undefined → 不完整/窗外段，展開時呼叫 `onNeedFetch` 撈整段；
 *     依 `loadingState` 顯示「載入中…」或「載入失敗 · 重試」。
 *
 * 開闔策略：isLast=true 展開、段內卡片預設展開；其餘段收合、卡片收合。
 * 卡片 React key 用全域 seq（startSeq + 段內序號），穩定不受窗口縮放影響。
 */
export function SegmentGroup({
  segMeta,
  segNo,
  durationText,
  messages,
  onNeedFetch,
  loadingState,
  isLast,
  countIsEstimate,
  collapseSignal = 0,
  expandSignal = 0,
}: {
  /** 段索引一列（start/end seq、label、is_command、msg_count）；前言段 seg_no 給 0。 */
  segMeta: SegmentInfo
  /** 顯示用段號（前言 = 0 顯示「前言」；其餘顯示「段 n」）。 */
  segNo: number
  /** 已算好的時長文字（start_ts→end_ts 差）。 */
  durationText: string
  /** 記憶體中已齊全的整段訊息；undefined = 需 fetch。 */
  messages: ConversationMessage[] | undefined
  /** 展開但 messages 為 undefined 時觸發（撈整段；含重試）。 */
  onNeedFetch: () => void
  /** 該段的 DB 載入狀態（idle/loading/error/loaded）。 */
  loadingState: SegmentLoadState
  isLast: boolean
  /** true → 計數前加 ~ 標示為估計值（前言載入前使用，因 null-mapping records 可能高估）。 */
  countIsEstimate?: boolean
  /** 每次 +1 → 強制收合本段（由 ConversationPanel「收合全部」按鈕觸發） */
  collapseSignal?: number
  /** 每次 +1 → 強制展開本段（由 ConversationPanel「展開全部」按鈕觸發） */
  expandSignal?: number
}): React.JSX.Element {
  const [open, setOpen] = useState(isLast)
  const userTouchedRef = useRef(false)
  useEffect(() => {
    if (!userTouchedRef.current) setOpen(isLast)
  }, [isLast])

  // collapseSignal/expandSignal 變動（值非 0 且有變化）→ 強制開闔並標記 userTouched
  useEffect(() => {
    if (collapseSignal === 0) return
    userTouchedRef.current = true
    setOpen(false)
  }, [collapseSignal])

  useEffect(() => {
    if (expandSignal === 0) return
    userTouchedRef.current = true
    setOpen(true)
  }, [expandSignal])

  // 展開且記憶體沒有整段（窗外/不完整）→ 觸發一次 fetch（fetchSegment 本身冪等防重打）
  useEffect(() => {
    if (open && messages === undefined) onNeedFetch()
  }, [open, messages, onNeedFetch])

  const isCommand = segMeta.is_command === 1
  const label = segMeta.label || (segNo === 0 ? '前言' : '(接續)')

  // v13：notify 不開段，notify 變體分支已移除（dead code 清除）

  const body = open && (
    <div className="segment-group-body">
      {messages !== undefined ? (
        // 記憶體渲染：buildRenderSeq 集中處理結尾分隔線/Ask 卡/run 群組/相鄰分隔線合併
        // key 用全域 seq（start_seq + 段內 idx）
        (() => {
          const items: SegItem[] = messages.map((m, idx) => ({ m, key: segMeta.start_seq + idx }))
          return buildRenderSeq(items, collectAskIds(items)).map((entry, ei) => (
            <React.Fragment key={ei}>{renderEntry(entry, isLast)}</React.Fragment>
          ))
        })()
      ) : loadingState.phase === 'error' ? (
        <div className="segment-load-state">
          <span className="segment-load-error">載入失敗</span>
          <button className="segment-load-retry" onClick={onNeedFetch}>
            重試
          </button>
        </div>
      ) : (
        <div className="segment-load-state">
          <span className="segment-load-loading">載入中…</span>
        </div>
      )}
    </div>
  )

  return (
    <div className={`segment-group${open ? ' group-open' : ''}`}>
      <div
        className="segment-group-header"
        onClick={() => {
          userTouchedRef.current = true
          setOpen((v) => !v)
        }}
      >
        <span className="segment-group-chevron">▶</span>
        <span className="segment-num">{segNo === 0 ? '前言' : `段 ${segNo}`}</span>
        <span className="segment-sep">·</span>
        <span
          className={`segment-label${isCommand ? ' segment-label-command' : ''}`}
          title={label}
        >
          {label}
        </span>
        {durationText && <span className="segment-duration">{durationText}</span>}
        <span className="segment-sep">·</span>
        <span className="segment-count">{countIsEstimate ? '~' : ''}{segMeta.msg_count} 則</span>
      </div>
      {body}
    </div>
  )
}
