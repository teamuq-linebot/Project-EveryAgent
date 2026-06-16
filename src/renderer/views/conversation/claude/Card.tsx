import React, { useState, useEffect, useRef } from 'react'
import type { ConversationMessage } from '../../../../shared/ipcContracts'
import {
  SessionIdContext,
  DispatchStatsContext,
  AskAnswersContext,
  AskAnswerCallbackContext,
  SUBAGENT_TOOL_NAMES,
  ASK_TOOL_NAME,
  fmtTime,
  agentHue,
  numCompact,
  fmtDurationMs,
  buildRenderSeq,
  collectAskIds,
  EndDivider,
  type SegItem,
} from './helpers'
import {
  dispatchBadgeOf,
  sourceBadgeOf,
  blockBadgesOf,
  tokenBadgeOf,
  cardPreviewOf,
  labelOfDispatchBlock,
} from './badges'
import { ContentBlockView } from './blocks'

// ============================================================
// SubConvState + SubagentGroup（同檔放置避免 Card ↔ SubagentGroup 循環相依）
// ============================================================

/** 子對話載入狀態。 */
export type SubConvState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'empty'; reason: string }
  | {
      phase: 'ok'
      messages: ConversationMessage[]
      agentId: string
      /** IPC 回傳的 meta，用於子卡徽章顯示名稱（需求2）*/
      agentType?: string
      description?: string
    }

/**
 * Subagent 派遣群組（對應 app.html buildSubagentGroup）。
 * 對應 app.html buildSubagentGroup + openSubagentGroup 的 lazy IPC 邏輯。
 *
 * 結構：`.subagent-group`(+`.group-open`) >
 *   `.subagent-group-header`（chevron + 🤖 + label + 載入後追加 agentId[:8] · N 筆 · 起–迄）
 *   + `.subagent-group-body`（子訊息每則一張 Card，預設收合）。
 *
 * lazy：首次展開才打 getSubagentConversation（沿用現行 phase state + stale-preload 防護 + 防連點）。
 * 遞迴深度限制：depth >= 2 時不顯示展開鈕（F2）。
 */
export function SubagentGroup({
  toolUseId,
  label,
  depth,
}: {
  /** 對應 ConvBlock.id（tool_use block 的原始 id）*/
  toolUseId: string
  /** 派遣標題（description > subagent_type > toolName）*/
  label: string
  /** 巢狀深度：0 = 主對話內；1 = 子對話內；>=2 不展開 */
  depth: number
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [subConv, setSubConv] = useState<SubConvState>({ phase: 'idle' })
  // 透過 Context 取得 sessionId（沿用現行方式，避免 prop drilling）
  const sessionId = React.useContext(SessionIdContext)
  // 收合態 subagent 總量 map（由 ConversationPanel 提供；key = tool_use_id）
  const dispatchStats = React.useContext(DispatchStatsContext)

  // 子對話載入成功後計算 meta（起迄時間 + hue + token 加總）
  const subMeta = subConv.phase === 'ok' ? (() => {
    const msgs = subConv.messages
    const t0 = fmtTime(msgs[0]?.timestamp)
    const t1 = fmtTime(msgs[msgs.length - 1]?.timestamp)
    const timeRange = t0 && t1 && t0 !== t1 ? `${t0}–${t1}` : t0 || ''
    const hue = agentHue(subConv.agentId)
    let tokIn = 0, tokOut = 0, tokCR = 0, tokCC = 0
    for (const msg of msgs) {
      const u = msg.usage
      if (!u) continue
      tokIn += u.input ?? 0
      tokOut += u.output ?? 0
      tokCR += u.cacheRead ?? 0
      tokCC += u.cacheCreate ?? 0
    }
    return { agentId: subConv.agentId, count: msgs.length, timeRange, hue, tokIn, tokOut, tokCR, tokCC }
  })() : null

  // header hue 染色（載入前用 CSS 預設；載入後注入 --agent-hue，light/dark 配色由 CSS 處理）
  const headerStyle = subMeta
    ? ({ ['--agent-hue']: String(subMeta.hue) } as React.CSSProperties)
    : undefined

  /** 點擊 header：切換展開；首次展開時 lazy 載入 IPC。 */
  const handleToggle = (): void => {
    const next = !open
    setOpen(next)
    if (!next || subConv.phase !== 'idle') return
    // stale-preload 防護：dev 熱更後 API 可能尚未掛載
    if (typeof window.tuq?.session?.getSubagentConversation !== 'function') {
      setSubConv({ phase: 'empty', reason: '需重啟 app 以載入此功能' })
      return
    }
    setSubConv({ phase: 'loading' })
    window.tuq.session
      .getSubagentConversation(sessionId, toolUseId)
      .then((r) => {
        if (!r.ok || !r.data || !r.data.ok || r.data.messages.length === 0) {
          setSubConv({ phase: 'empty', reason: '找不到子對話紀錄' })
        } else {
          setSubConv({
            phase: 'ok',
            messages: r.data.messages,
            agentId: r.data.agentId ?? '',
            // 需求2：儲存名稱欄位供子卡徽章使用
            agentType: r.data.agentType ?? undefined,
            description: r.data.description ?? undefined,
          })
        }
      })
      .catch(() => {
        setSubConv({ phase: 'empty', reason: '找不到子對話紀錄' })
      })
  }

  return (
    <div className={`subagent-group${open ? ' group-open' : ''}`}>
      {/* Header */}
      <div
        className="subagent-group-header"
        style={headerStyle}
        onClick={depth < 2 ? handleToggle : undefined}
        // depth >= 2：不提供展開（F2 遞迴深度限制）
        title={depth >= 2 ? '巢狀深度已達上限，不支援繼續展開' : undefined}
      >
        <span className="subagent-group-chevron">▶</span>
        <span>🤖</span>
        <span style={{ fontWeight: 700, marginLeft: '4px' }}>{label}</span>
        {/* 載入後追加 meta 資訊（需求1：UUID 短碼不顯示，hue 染色照舊） */}
        {subMeta && (
          <>
            <span style={{ opacity: 0.5, margin: '0 4px' }}>·</span>
            <span style={{ fontSize: '11px' }}>{subMeta.count} 筆</span>
            {subMeta.timeRange && (
              <>
                <span style={{ opacity: 0.5, margin: '0 4px' }}>·</span>
                <span style={{ fontSize: '10px', opacity: 0.75, fontFamily: 'monospace' }}>
                  {subMeta.timeRange}
                </span>
              </>
            )}
            {(subMeta.tokIn > 0 || subMeta.tokOut > 0) && (() => {
              const titleParts = [`input ${subMeta.tokIn.toLocaleString()} · output ${subMeta.tokOut.toLocaleString()}`]
              if (subMeta.tokCR > 0) titleParts.push(`cache read ${subMeta.tokCR.toLocaleString()}`)
              if (subMeta.tokCC > 0) titleParts.push(`cache create ${subMeta.tokCC.toLocaleString()}`)
              return (
                <>
                  <span style={{ opacity: 0.5, margin: '0 4px' }}>·</span>
                  <span className="badge-tokens" title={titleParts.join(' · ')}>
                    {`↑${numCompact(subMeta.tokIn)} ↓${numCompact(subMeta.tokOut)}`}
                  </span>
                </>
              )
            })()}
          </>
        )}
        {/* 收合態（未展開載入）且有 subagentStats → 顯示 token 總量 + ⏱ 耗時（取代精確版，不重複）*/}
        {!subMeta && (() => {
          const stats = dispatchStats.get(toolUseId)
          if (!stats) return null
          const { totalTokens, input, output, durationMs } = stats
          if (!totalTokens && !durationMs) return null
          // hover title：總計 N tokens · input N · output N · 耗時 X
          const titleParts: string[] = []
          if (totalTokens) titleParts.push(`總計 ${totalTokens.toLocaleString()} tokens`)
          if (input) titleParts.push(`input ${input.toLocaleString()}`)
          if (output) titleParts.push(`output ${output.toLocaleString()}`)
          if (durationMs != null) titleParts.push(`耗時 ${fmtDurationMs(durationMs)}`)
          return (
            <>
              {totalTokens != null && (
                <>
                  <span style={{ opacity: 0.5, margin: '0 4px' }}>·</span>
                  <span className="badge-tokens" title={titleParts.join(' · ')}>
                    {numCompact(totalTokens)}
                  </span>
                </>
              )}
              {durationMs != null && (
                <>
                  <span style={{ opacity: 0.5, margin: '0 4px' }}>·</span>
                  <span style={{ fontSize: '11px', opacity: 0.75 }} title={titleParts.join(' · ')}>
                    {`⏱ ${fmtDurationMs(durationMs)}`}
                  </span>
                </>
              )}
            </>
          )
        })()}
        {/* depth >= 2：顯示提示文字取代展開鈕 */}
        {depth >= 2 && (
          <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '8px' }}>[深度限制]</span>
        )}
      </div>

      {/* Body — 展開後渲染子對話卡片 */}
      {open && (
        <div className="subagent-group-body">
          {subConv.phase === 'loading' && (
            <span style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '12px', display: 'block' }}>
              載入中…
            </span>
          )}
          {subConv.phase === 'empty' && (
            <span style={{ padding: '8px 12px', color: 'var(--text-muted)', fontSize: '12px', display: 'block' }}>
              {subConv.reason}
            </span>
          )}
          {subConv.phase === 'ok' &&
            (() => {
              // 子對話也走 buildRenderSeq：結尾分隔線/Ask 卡/run 切斷與主對話一致
              const items: SegItem[] = subConv.messages.map((m, i) => ({ m, key: i }))
              return buildRenderSeq(items, collectAskIds(items)).map((entry, ei) => {
                if (entry.kind === 'divider') {
                  return <EndDivider key={ei} kind={entry.dKind} labels={entry.labels} />
                }
                if (entry.kind === 'ask') {
                  return <AskCard key={ei} m={entry.item.m} />
                }
                // 子對話內 run 群組不另收攏（深層平鋪）→ run 展開為多張子卡；single/card 同樣處理
                const cards = entry.kind === 'run' ? entry.items : [entry.item]
                return cards.map((it) => (
                  <Card
                    key={it.key}
                    m={it.m}
                    defaultExpanded={false}
                    // 子卡掛 card-subagent class（CSS 識別 + 全平面樣式）
                    isSubagentCard={true}
                    depth={depth + 1}
                  />
                ))
              })
            })()}
        </div>
      )}
    </div>
  )
}

// ============================================================
// Card（summary/detail）
// ============================================================

/**
 * 一則訊息卡（對應 app.html buildCard）。
 * 結構：`.card` > `.card-summary`（時間 + chevron + badges + preview）
 *        + `.card-detail`（blocks 用 ContentBlockView 渲染）。
 *
 * - defaultExpanded：控制初始展開狀態；外部（isLast 段）改變時若使用者未手動開闔則跟隨。
 * - isSubagentCard：子卡標示 class `card-subagent`（CSS 識別用；hue 已移至群組標頭不再染框色）。
 * - 卡內若含 subagent 派遣 block（SUBAGENT_TOOL_NAMES）→ detail 內在該 block 位置改渲染 SubagentGroup。
 */
export function Card({
  m,
  defaultExpanded,
  isSubagentCard = false,
  depth = 0,
}: {
  m: ConversationMessage
  /** 初始展開狀態；isLast 段為 true，舊段為 false */
  defaultExpanded: boolean
  /** subagent 子卡傳 true，掛 card-subagent class（CSS 識別用；不再染左框色）。 */
  isSubagentCard?: boolean
  /** 巢狀深度（0=主對話；傳給 SubagentGroup 遞增）*/
  depth?: number
}): React.JSX.Element | null {
  // 防衛：system/turn_duration 訊息不應抵達 Card；交由渲染層改用 TurnDivider。
  // 若意外傳入（舊路徑殘留），安靜回傳 null 避免 UI 破版。
  if (m.role === 'system') return null

  const [expanded, setExpanded] = useState(defaultExpanded)
  // 使用者是否曾手動開闔（若無則跟隨 defaultExpanded 變動）
  const userTouchedRef = useRef(false)
  useEffect(() => {
    if (!userTouchedRef.current) setExpanded(defaultExpanded)
  }, [defaultExpanded])

  const timeText = fmtTime(m.timestamp)

  return (
    <div
      className={`card${expanded ? ' expanded' : ''}${isSubagentCard ? ' card-subagent' : ''}`}
    >
      {/* Summary row — 點擊切換展開 */}
      <div
        className="card-summary"
        onClick={() => {
          userTouchedRef.current = true
          setExpanded((v) => !v)
        }}
      >
        <span className="summary-time" title={m.timestamp ?? undefined}>
          {timeText || '—'}
        </span>
        <span className="chevron">▶</span>
        {/* dispatch badge（有 Task/Agent tool_use 才顯示） */}
        {dispatchBadgeOf(m)}
        {/* source badge */}
        {sourceBadgeOf(m)}
        {/* block 種類徽章 */}
        {blockBadgesOf(m)}
        {/* token 用量徽章（assistant 訊息才有 usage；子對話巢狀卡同元件自動生效） */}
        {tokenBadgeOf(m)}
        {/* preview 文字（靠右） */}
        <span className="summary-preview">{cardPreviewOf(m)}</span>
      </div>

      {/* Detail — 展開後渲染 blocks */}
      {expanded && (
        <div className="card-detail">
          <div className="blocks-container">
            {m.blocks.map((b, bi) => {
              // subagent 派遣 block：在 detail 內改渲染 SubagentGroup（若有 b.id）
              if (b.kind === 'tool_use' && SUBAGENT_TOOL_NAMES.has(b.name ?? '') && b.id) {
                return <SubagentGroup key={bi} toolUseId={b.id} label={labelOfDispatchBlock(b)} depth={depth} />
              }
              return <ContentBlockView key={bi} b={b} />
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ============================================================
// AskCard（AskUserQuestion 問答卡）
// ============================================================

/** AskUserQuestion input.questions[] 單題形狀（research §1）。 */
interface AskQuestion {
  question?: string
  header?: string
  multiSelect?: boolean
  options?: Array<{ label?: string; description?: string }>
}

/**
 * AskUserQuestion 專屬問答卡（對應 research §1）。
 * header「❓ 提問」；body 依 JSON.parse(b.text).questions[] 列出每題（題文 + options label 清單）。
 * 答案配對：由 AskAnswersContext 以 tool_use_id 查「題=答」map，命中選項標 ✓ 並附「你的回答」。
 * JSON.parse 失敗 → 退回現行 tool_use collapsible 顯示（容錯，回 null 由 caller fallback Card）。
 */
export function AskCard({ m }: { m: ConversationMessage }): React.JSX.Element | null {
  const [open, setOpen] = useState(true)
  // 本地「已送出」狀態：送出後顯示提示並防止連點（key = option index 1-based）
  const [sentIndex, setSentIndex] = useState<number | null>(null)
  const askAnswers = React.useContext(AskAnswersContext)
  const onAnswerAsk = React.useContext(AskAnswerCallbackContext)

  // 取第一個 AskUserQuestion tool_use block（含 id）
  const askBlock = m.blocks.find((b) => b.kind === 'tool_use' && b.name === ASK_TOOL_NAME && b.id)
  if (!askBlock || !askBlock.id) return null

  let questions: AskQuestion[]
  try {
    const parsed = JSON.parse(askBlock.text) as { questions?: AskQuestion[] }
    questions = Array.isArray(parsed.questions) ? parsed.questions : []
    if (questions.length === 0) return null // 無題 → 退回 fallback
  } catch {
    return null // JSON.parse 失敗 → 退回現行 collapsible 顯示
  }

  const toolUseId = askBlock.id
  const answers = askAnswers.get(toolUseId) ?? {}
  const timeText = fmtTime(m.timestamp)

  // v1 互動按鈕條件：尚未回答 + 單題 + 非多選
  const isAnswered = Object.keys(answers).length > 0
  const q0 = questions[0]
  const canShowButtons =
    !isAnswered &&
    questions.length === 1 &&
    q0 !== undefined &&
    q0.multiSelect !== true

  return (
    <div className={`ask-card${open ? ' ask-open' : ''}`}>
      <div className="ask-card-header" onClick={() => setOpen((v) => !v)}>
        <span className="ask-card-chevron">▶</span>
        <span className="ask-card-time">{timeText || '—'}</span>
        <span className="ask-card-title">❓ 提問</span>
        <span className="ask-card-count">{questions.length} 題</span>
      </div>
      {open && (
        <div className="ask-card-body">
          {questions.map((q, qi) => {
            const qText = q.question ?? ''
            const ans = answers[qText]
            return (
              <div className="ask-question" key={qi}>
                {q.header && <div className="ask-question-header">{q.header}</div>}
                <div className="ask-question-text">{qText}</div>
                {q.options && q.options.length > 0 && canShowButtons ? (
                  // 未回答 + 單題 + 非多選 → 選項渲染成按鈕
                  sentIndex !== null ? (
                    <div className="ask-sent-notice" style={{ marginTop: 6, color: 'var(--accent, #4a9eff)', fontSize: '0.85em' }}>
                      已送出：{q.options[sentIndex - 1]?.label ?? sentIndex}
                    </div>
                  ) : (
                    <div className="ask-option-buttons" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                      {q.options.map((o, oi) => {
                        const label = o.label ?? ''
                        const idx1 = oi + 1 // 1-based
                        return (
                          <button
                            key={oi}
                            className="ask-option-btn"
                            style={{ textAlign: 'left', cursor: 'pointer' }}
                            onClick={() => {
                              setSentIndex(idx1)
                              onAnswerAsk(toolUseId, idx1, label)
                            }}
                          >
                            {idx1}. {label}
                          </button>
                        )
                      })}
                    </div>
                  )
                ) : (
                  // 已回答 / 多題 / 多選 → 唯讀顯示
                  <>
                    {q.options && q.options.length > 0 && (
                      <>
                        <ul className="ask-options">
                          {q.options.map((o, oi) => {
                            const picked = ans != null && o.label != null && ans === o.label
                            return (
                              <li className={`ask-option${picked ? ' ask-option-picked' : ''}`} key={oi}>
                                <span className="ask-option-mark">{picked ? '✓' : '·'}</span>
                                <span className="ask-option-label">{o.label ?? ''}</span>
                              </li>
                            )
                          })}
                        </ul>
                        {!isAnswered && questions.length > 1 && (
                          <div className="ask-cli-hint" style={{ marginTop: 4, fontSize: '0.82em', opacity: 0.65 }}>
                            請在 CLI 中回答
                          </div>
                        )}
                      </>
                    )}
                    {ans != null && (
                      <div className="ask-answer">你的回答：{ans}</div>
                    )}
                    {!isAnswered && (questions.length > 1 || q.multiSelect) && !q.options?.length && (
                      <div className="ask-cli-hint" style={{ marginTop: 4, fontSize: '0.82em', opacity: 0.65 }}>
                        請在 CLI 中回答
                      </div>
                    )}
                  </>
                )}
                {/* 多題情況下各題若未回答顯示提示 */}
                {!canShowButtons && !isAnswered && ans == null && q.options == null && (
                  <div className="ask-cli-hint" style={{ marginTop: 4, fontSize: '0.82em', opacity: 0.65 }}>
                    請在 CLI 中回答
                  </div>
                )}
              </div>
            )
          })}
          {/* 多題 / 多選整體提示 */}
          {!isAnswered && !canShowButtons && sentIndex === null && (
            <div className="ask-cli-hint" style={{ marginTop: 6, fontSize: '0.82em', opacity: 0.65 }}>
              請在 CLI 中回答
            </div>
          )}
        </div>
      )}
    </div>
  )
}
