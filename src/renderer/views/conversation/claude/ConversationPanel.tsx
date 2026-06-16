import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type {
  SkillItem,
  SegmentInfo,
  PromptAlertPayload,
  CardRunStatePayload,
  WorkflowRunSummary,
} from '../../../../shared/ipcContracts'
import { useConversation } from '../../../hooks/useConversation'
import {
  SessionIdContext,
  DispatchStatsContext,
  AskAnswersContext,
  AskAnswerCallbackContext,
  buildSegments,
  fmtDurationMs,
  buildRenderSeq,
  collectAskIds,
} from './helpers'
import { SegmentGroup, LegacySegmentGroup, renderEntry } from './SegmentGroup'
import CliWaitCard from './CliWaitCard'
import WorkflowProgressCard from './WorkflowProgressCard'
import type { CliId } from '../../../../shared/cliRegistry'
import {
  type ViewMode,
  type RawSegState,
  VIEW_MODE_KEY,
  SKILL_PREFIX,
  THINKING_TIMEOUT_MS,
  MODULE_LABELS,
  assistantSig,
  currentActivityLabel,
  buildDispatchStatsMap,
  buildAskAnswersMap,
  RawSegSection,
} from './ConversationPanelParts'

interface Props {
  /** 當前 session id（傳給 SubagentGroup 做子對話查詢用） */
  sessionId: string
  /** 換綁世代號：每次換綁 +1，觸發 useConversation 全量重置。 */
  convEpoch: number
  /** 可用 skill 指令清單（派遣下拉；選定後送出自動前置 `/<name> `） */
  skills: SkillItem[]
  /** 送出後直接寫進 PTY（由 SessionTab 提供） */
  onSend: (text: string) => void
  /** CLI 是否已啟動（背景 PTY + 啟動指令）；未啟動時顯示「開啟 CLI」按鈕而非輸入框 */
  cliStarted: boolean
  /** 點「開啟 CLI」→ 背景啟動 PTY + claude（終端抽屜不展開） */
  onOpenCli: () => void
  /** CLI 終端抽屜是否展開（展開/收合鈕位於輸入框上方） */
  cliExpanded: boolean
  /** 切換 CLI 終端抽屜展開/收合 */
  onToggleCli: () => void
  /** 收合對話面板（鈕位於 header 最左；收合後由 SessionTab 右緣把手展開） */
  onCollapse: () => void
  /** AskUserQuestion 回答 callback：(toolUseId, 1-based 選項序號, 選項文字) → 寫進 PTY */
  onAnswerAsk?: (toolUseId: string, optionIndex: number, label: string) => void
  /** 派遣下拉初始值（裸 skillName）；團隊 session 預設=隊長。空/未傳=直接對話。 */
  initialTeam?: string
  /**
   * 輸入框預填文字（團隊對話跳監測任務時帶入的原始任務描述）；空/未傳=不預填。
   * 只在元件首次掛載時填入一次（lazy useState init），之後使用者可自由編輯/送出。
   * 配合 initialTeam（下拉預設隊長），送出時由既有 SKILL_PREFIX 邏輯補上 `<前綴><隊長> `，
   * 重建完整指令——不重複前綴。改採「預填＋使用者按 Enter」是為了繞開 codex 自動注入
   * Enter 的時序競態（見 TerminalPanel）。
   */
  initialDraft?: string
  /**
   * CLI 是否開機完成（可送出）。false=輸入框 gate「正在開機中…」：送出鈕禁用、Enter 不送出。
   * 未傳=視為就緒（向後相容；只有監測任務的 SessionTab 會傳此旗標）。
   */
  inputReady?: boolean
  /** 該 session 實際在跑的 CLI；決定送出時的 skill 前綴（見 SKILL_PREFIX）。未傳=退回 claude 規則。 */
  cliId?: CliId
  /** 該 session 的執行狀態（card:runState）；running=AI 仍在工作（含中途停頓）→ 顯示「目前動作」指示。 */
  runState?: CardRunStatePayload['state']
  /** 該 session 目前的 workflow 進度（card:workflowProgress）→ 對話框上方進度卡。空/未傳=不顯示。 */
  workflows?: WorkflowRunSummary[]
  /** 目前選定的 AI 模組（工具：claude/codex/vscode/custom）；顯示於對話內容上方的模組列。 */
  tool?: string
  /** 可選的 AI 模組清單（模組下拉的選項）。空/未傳=不顯示模組列。 */
  toolValues?: readonly string[]
  /** 切換 AI 模組 callback（選擇即套用：重解析啟動指令並重整綁定）。 */
  onToolChange?: (tool: string) => void
}

/**
 * ConversationPanel — session 對話顯示（卡片式 + 段落群組，顯示方式參考 jsonl-viewer）
 * + 輸入框（Enter 送出直寫 PTY、IME 安全、Shift+Enter 換行）。
 */
export default function ConversationPanel({
  sessionId,
  convEpoch,
  skills,
  onSend,
  cliStarted,
  onOpenCli,
  cliExpanded,
  onToggleCli,
  onCollapse,
  onAnswerAsk,
  initialTeam,
  initialDraft,
  inputReady = true,
  cliId,
  runState,
  workflows,
  tool,
  toolValues,
  onToolChange,
}: Props): React.JSX.Element {
  // 首次掛載以 initialDraft 預填（之後使用者自由編輯）；團隊對話跳監測任務時帶入原始任務描述。
  const [draft, setDraft] = useState(initialDraft ?? '')
  // 派遣對象：'' = 直接對話；其餘為 skill 名（送出時前置 `/<name> `）。
  // 團隊 session 以隊長 skillName 為初始值（§4.3）。
  const [team, setTeam] = useState(initialTeam ?? '')
  // 收合/展開全部信號：每次 +1 觸發子段落響應（counter 避免多次點擊值相同不觸發）
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [expandSignal, setExpandSignal] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  // 卡片 / Raw 模式切換（localStorage 持久化）
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return (localStorage.getItem(VIEW_MODE_KEY) as ViewMode) ?? 'card' } catch { return 'card' }
  })
  // Raw 模式：各段的原始行快取（key = start_seq）
  const [rawSegStates, setRawSegStates] = useState<Map<number, RawSegState>>(new Map())
  // 使用者是否在底部附近：只有在底部才跟隨新訊息自動捲到底。
  const nearBottomRef = useRef(true)
  // 「思考中」：送出訊息後、CLI 尚未產生回應前顯示，讓使用者知道正在等待。
  const [thinking, setThinking] = useState(false)
  // 送出當下的助理活動基準；之後簽名一變即視為 CLI 已開始回應。
  const thinkingBaselineRef = useRef('')
  // 安全網計時器（逾時自動收起）。
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopThinking = useCallback(() => {
    setThinking(false)
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current)
      thinkingTimerRef.current = null
    }
  }, [])

  // 資料層：段骨架（索引）+ 記憶體訊息池（只增不減合併）+ 段 DB 撈取。
  const {
    segments: segIndex,
    totalCount,
    getMessagesFor,
    fetchSegment,
    segmentStateOf,
    loading,
    refresh,
    legacyMessages,
    legacy,
    switching,
    messages,
  } = useConversation(sessionId, convEpoch)

  // 舊路徑（stale-preload 退回）：前端推段；新路徑下不使用。
  const legacySegments = useMemo(
    () => (legacy ? buildSegments(legacyMessages) : []),
    [legacy, legacyMessages],
  )

  // 收合態 subagent 總量 map：掃所有已載入訊息（新路徑=pool 全量；舊路徑=legacyMessages），
  // 提取 tool_result block 的 subagentStats。
  // key = tool_use_id（與 SubagentGroup.toolUseId 對應的 tool_use block id）。
  const dispatchStatsMap = useMemo(() => buildDispatchStatsMap(messages), [messages])

  // Ask 問答答案 map：掃 pool 中以「Your questions have been answered:」開頭的 tool_result block，
  // 僅當其 tool_use_id 對應到某 AskUserQuestion tool_use（避免誤吃同前綴的其他結果）。
  // key = Ask tool_use_id；value = parseAskAnswers 解析的「題 → 答」表。
  const askAnswersMap = useMemo(() => buildAskAnswersMap(messages), [messages])

  // runState=running → AI 仍在工作（含中途停頓）；顯示「目前動作」指示（依最後工具大略判斷）。
  const running = runState === 'running'
  const activityLabel = useMemo(
    () => (running ? currentActivityLabel(messages) : 'AI 思考中'),
    [running, messages],
  )

  const onListScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  }, [])

  // 捲動跟隨：訊息總數、串流內容（messages 池版本：同一則尾訊息逐漸增長時
  // totalCount 不變但池內容會變）或舊路徑變動時皆觸發，貼底時自動捲到最新內容。
  // rAF 等 DOM 重排（新段/新區塊插入後 scrollHeight 更新）完成再捲，避免捲不到底。
  useEffect(() => {
    const el = listRef.current
    if (!el || !nearBottomRef.current) return
    const id = requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    })
    return () => cancelAnimationFrame(id)
  }, [totalCount, messages, legacyMessages])

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next: ViewMode = prev === 'card' ? 'raw' : 'card'
      try { localStorage.setItem(VIEW_MODE_KEY, next) } catch { /* 容錯 */ }
      return next
    })
  }, [])

  const fetchRawSeg = useCallback((startSeq: number, endSeq: number) => {
    setRawSegStates((prev) => {
      const cur = prev.get(startSeq)
      if (cur && (cur.phase === 'loading' || cur.phase === 'loaded')) return prev
      const next = new Map(prev)
      next.set(startSeq, { phase: 'loading', lines: [], truncated: false })
      return next
    })
    if (typeof window.tuq?.session?.getRawLines !== 'function') {
      setRawSegStates((prev) => {
        const next = new Map(prev)
        next.set(startSeq, { phase: 'error', lines: [], truncated: false })
        return next
      })
      return
    }
    window.tuq.session.getRawLines(sessionId, startSeq, endSeq).then((r) => {
      if (r.ok && r.data && r.data.ok) {
        setRawSegStates((prev) => {
          const next = new Map(prev)
          next.set(startSeq, { phase: 'loaded', lines: r.data!.lines, truncated: r.data!.truncated })
          return next
        })
      } else {
        setRawSegStates((prev) => {
          const next = new Map(prev)
          next.set(startSeq, { phase: 'error', lines: [], truncated: false })
          return next
        })
      }
    }).catch(() => {
      setRawSegStates((prev) => {
        const next = new Map(prev)
        next.set(startSeq, { phase: 'error', lines: [], truncated: false })
        return next
      })
    })
  }, [sessionId])

  const send = useCallback(() => {
    if (!inputReady) return // CLI 開機中：gate 住不送出（Enter / 送出鈕都擋）
    const text = draft.trim()
    if (!text) return
    // 選了派遣對象 → 依該 session 的 CLI 前置 skill 前綴：claude `/`、codex `$`、agy 無前綴。
    // 前綴為空（antigravity，無對應 skill 註冊）或未選派遣對象 → 直接送 text。
    const prefix = SKILL_PREFIX[cliId ?? 'claude'] ?? '/'
    onSend(team && prefix ? `${prefix}${team} ${text}` : text)
    setDraft('')
    // 標記「思考中」：記下送出當下的助理活動基準，待 CLI 產生新內容（或互動提示/錯誤）即解除。
    thinkingBaselineRef.current = assistantSig(messages)
    setThinking(true)
    if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current)
    thinkingTimerRef.current = setTimeout(() => setThinking(false), THINKING_TIMEOUT_MS)
  }, [draft, team, onSend, cliId, messages, inputReady])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault()
        send()
      }
    },
    [send],
  )

  // CLI 開始回應（助理活動簽名相對基準有變動）→ 收起「思考中」。
  useEffect(() => {
    if (!thinking) return
    if (assistantSig(messages) !== thinkingBaselineRef.current) stopThinking()
  }, [messages, thinking, stopThinking])

  // 互動提示 / 錯誤出現時（CliWaitCard 接手）→ 收起「思考中」，避免兩張卡並存語意衝突。
  useEffect(() => {
    const unsub = window.tuq.onPromptAlert((payload: PromptAlertPayload) => {
      if (payload.sessionId !== sessionId) return
      if (payload.state === 'waiting' || payload.state === 'error') stopThinking()
    })
    return unsub
  }, [sessionId, stopThinking])

  // 換綁 / 切 session → 重置「思考中」；卸載時清計時器。
  useEffect(() => {
    stopThinking()
  }, [sessionId, convEpoch, stopThinking])
  useEffect(() => () => {
    if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current)
  }, [])

  // 穩定的 onAnswerAsk callback ref：避免 context value 參考每次 render 變動觸發不必要的子樹重渲。
  const answerAskCb = React.useCallback(
    (toolUseId: string, optionIndex: number, label: string) => {
      onAnswerAsk?.(toolUseId, optionIndex, label)
    },
    [onAnswerAsk],
  )

  return (
    // 透過 Context 提供 sessionId / dispatchStatsMap / askAnswersMap / answerAskCb；深層元件取用，不需逐層 prop drilling
    <SessionIdContext.Provider value={sessionId}>
    <DispatchStatsContext.Provider value={dispatchStatsMap}>
    <AskAnswersContext.Provider value={askAnswersMap}>
    <AskAnswerCallbackContext.Provider value={answerAskCb}>
    <div className="conversation-panel">
      <div className="conversation-panel__header">
        <div className="conversation-panel__header-left">
          <button className="conversation-panel__collapse" onClick={onCollapse} title="收合對話">
            ▸
          </button>
          <span className="conversation-panel__title">對話</span>
        </div>
        <div className="conversation-panel__header-actions">
          <button
            className={`conversation-panel__view-toggle${viewMode === 'raw' ? ' conversation-panel__view-toggle--active' : ''}`}
            onClick={toggleViewMode}
            title={viewMode === 'card' ? '切換為 Raw 模式' : '切換為卡片模式'}
          >
            {viewMode === 'card' ? '卡片' : 'Raw'}
          </button>
          {viewMode === 'card' && (
            <>
              <button
                className="conversation-panel__seg-action"
                onClick={() => setCollapseSignal((n) => n + 1)}
                title="收合全部段落"
              >
                ⊟ 收合
              </button>
              <button
                className="conversation-panel__seg-action"
                onClick={() => setExpandSignal((n) => n + 1)}
                title="展開全部段落"
              >
                ⊞ 展開
              </button>
            </>
          )}
          <button
            className="conversation-panel__refresh"
            onClick={() => void refresh()}
            disabled={loading}
            title="重新載入對話"
          >
            {loading ? '重整中…' : '重整'}
          </button>
        </div>
      </div>

      {/* AI 模組選擇：固定於對話內容正上方，標明此 session 實際驅動的 CLI 模組。 */}
      {toolValues && toolValues.length > 0 && onToolChange && (
        <div className="conversation-panel__module-bar">
          <span className="conversation-panel__module-label">AI 模組</span>
          <select
            className="conversation-panel__module-select"
            value={tool ?? ''}
            onChange={(e) => onToolChange(e.target.value)}
            title="選擇此 session 使用的 AI 模組（claude 可打卡；codex/vscode/custom 尚未支援監測）"
          >
            {toolValues.map((t) => (
              <option key={t} value={t}>
                {MODULE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Workflow 進度卡：固定在對話列表上方，不隨對話捲動。 */}
      {workflows && workflows.length > 0 && (
        <WorkflowProgressCard sessionId={sessionId} workflows={workflows} />
      )}

      <div className="conversation-panel__list" ref={listRef} onScroll={onListScroll}>
        {switching ? (
          <div className="conversation-panel__empty">重新整理中…</div>
        ) : legacy ? (
          /* 舊路徑（stale-preload 退回）：前端推段平鋪 legacyMessages */
          legacyMessages.length === 0 ? (
            <div className="conversation-panel__empty">
              {cliStarted ? '尚無對話，於下方輸入或終端開始' : '尚無對話，點下方「開啟 CLI」開始'}
            </div>
          ) : (
            (() => {
              const lastSegN = [...legacySegments].reverse().find((s) => s.kind === 'segment')?.n
              return legacySegments.map((seg, si) =>
                seg.kind === 'preamble' ? (
                  // preamble 也走 buildRenderSeq（defaultOpen=false，因非最新段）
                  <React.Fragment key={`pre-${si}`}>
                    {buildRenderSeq(seg.items, collectAskIds(seg.items)).map((entry, ei) => (
                      <React.Fragment key={ei}>{renderEntry(entry, false)}</React.Fragment>
                    ))}
                  </React.Fragment>
                ) : (
                  <LegacySegmentGroup
                    key={`seg-${seg.n}`}
                    seg={seg}
                    isLast={seg.n === lastSegN}
                    collapseSignal={collapseSignal}
                    expandSignal={expandSignal}
                  />
                ),
              )
            })()
          )
        ) : segIndex.length === 0 && totalCount === 0 ? (
          <div className="conversation-panel__empty">
            {cliStarted ? '尚無對話，於下方輸入或終端開始' : '尚無對話，點下方「開啟 CLI」開始'}
          </div>
        ) : viewMode === 'raw' ? (
          /* Raw 模式：每段一個摺疊區，展開後按需 getRawLines → RawCard 列 */
          (() => {
            const rawSegs: React.JSX.Element[] = []
            const allSegs: { key: string; label: string; startSeq: number; endSeq: number }[] = []
            // 前言
            const hasPre = segIndex.length > 0 && segIndex[0].start_seq > 0
            if (hasPre) allSegs.push({ key: 'raw-preamble', label: '前言', startSeq: 0, endSeq: segIndex[0].start_seq - 1 })
            for (const s of segIndex) allSegs.push({ key: `raw-seg-${s.seg_no}`, label: s.label || `段落 ${s.seg_no}`, startSeq: s.start_seq, endSeq: s.end_seq })

            for (const seg of allSegs) {
              const st = rawSegStates.get(seg.startSeq)
              rawSegs.push(
                <RawSegSection
                  key={seg.key}
                  label={seg.label}
                  startSeq={seg.startSeq}
                  endSeq={seg.endSeq}
                  state={st}
                  onExpand={() => fetchRawSeg(seg.startSeq, seg.endSeq)}
                />
              )
            }
            return rawSegs
          })()
        ) : (
          /* 新路徑（卡片模式）：段骨架常駐（前言 + 全段）；每段判斷記憶體齊全 → 渲染 / 否則 fetch */
          (() => {
            const lastSegNo = segIndex.length > 0 ? segIndex[segIndex.length - 1].seg_no : -1
            const rows: React.JSX.Element[] = []

            // 前言（若 segments[0].start_seq > 0；前言不在表內，範圍 = [0, start_seq-1]）
            const hasPreamble = segIndex.length > 0 && segIndex[0].start_seq > 0
            const preEnd = hasPreamble ? segIndex[0].start_seq - 1 : -1
            if (hasPreamble) {
              const pre = getMessagesFor(0, preEnd)
              // msg_count：已載入（pool 涵蓋 [0,preEnd]）用實際長度；
              // 未載入用 preEnd+1 估計（可能高估：recordToConversationMessage 對
              // summary 等 record 回 null，不計入可渲染訊息數）。
              const preMsgCount = pre.complete ? pre.messages.length : preEnd + 1
              const preMeta: SegmentInfo = {
                seg_no: 0,
                start_seq: 0,
                end_seq: preEnd,
                start_ts: '',
                end_ts: '',
                label: '前言',
                is_command: 0,
                msg_count: preMsgCount,
                head_kind: 'other',
              }
              rows.push(
                <SegmentGroup
                  key="seg-preamble"
                  segMeta={preMeta}
                  segNo={0}
                  durationText=""
                  messages={pre.complete ? pre.messages : undefined}
                  onNeedFetch={() => fetchSegment(0, preEnd)}
                  loadingState={segmentStateOf(0)}
                  isLast={false}
                  countIsEstimate={!pre.complete}
                  collapseSignal={collapseSignal}
                  expandSignal={expandSignal}
                />,
              )
            }

            for (const s of segIndex) {
              const got = getMessagesFor(s.start_seq, s.end_seq)
              // 時長：start_ts→end_ts 差（沿用 fmtDurationMs；標 ⏱ ~）
              let durationText = ''
              if (s.start_ts && s.end_ts) {
                const d = Date.parse(s.end_ts) - Date.parse(s.start_ts)
                if (isFinite(d) && d >= 0) durationText = '⏱ ~' + fmtDurationMs(d)
              }
              rows.push(
                <SegmentGroup
                  key={`seg-${s.seg_no}`}
                  segMeta={s}
                  segNo={s.seg_no}
                  durationText={durationText}
                  messages={got.complete ? got.messages : undefined}
                  onNeedFetch={() => fetchSegment(s.start_seq, s.end_seq)}
                  loadingState={segmentStateOf(s.start_seq)}
                  isLast={s.seg_no === lastSegNo}
                  collapseSignal={collapseSignal}
                  expandSignal={expandSignal}
                />,
              )
            }
            return rows
          })()
        )}
      </div>

      {/* 進度指示：送出後等待首次回應（thinking）或 AI 仍在工作（runState=running，含中途停頓）。
          running 時顯示「目前動作」（依最後工具大略判斷）；否則顯示「AI 思考中」。 */}
      {(thinking || running) && (
        <div className="cli-thinking-card" role="status" aria-live="polite">
          <span className="cli-thinking-card__spinner" aria-hidden="true" />
          <span className="cli-thinking-card__text">
            {activityLabel}<span className="cli-thinking-card__dots" aria-hidden="true" />
          </span>
        </div>
      )}

      {/* CLI 等待/錯誤內嵌卡：固定在輸入區正上方，不隨對話捲動 */}
      <CliWaitCard
        sessionId={sessionId}
        onExpandCli={cliExpanded ? undefined : onToggleCli}
      />

      {cliStarted ? (
        <>
          {/* 輸入框上方工具列：派遣下拉（左）+ CLI 終端展開/收合（右） */}
          <div className="conversation-panel__cli-bar">
            <select
              className="conversation-panel__team-select"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              title={
                team
                  ? (skills.find((s) => s.name === team)?.description ?? `/${team}`)
                  : '選擇派遣對象：送出時自動前置 /<skill>；不選則直接對話'
              }
            >
              <option value="">直接對話（不派遣）</option>
              {/* skills 載入前，若已選定 team（隊長）卻無對應 option，先補一個避免 controlled select 顯示空白 */}
              {team && !skills.some((s) => s.name === team) && (
                <option value={team}>{skills.find((s) => s.name === team)?.displayName ?? team}</option>
              )}
              {skills.map((s) => (
                <option key={s.name} value={s.name} title={s.description ?? undefined}>
                  {s.displayName ?? s.name}
                </option>
              ))}
            </select>
            <button
              className="conversation-panel__cli-toggle"
              onClick={onToggleCli}
              title={cliExpanded ? '收合 CLI 終端' : '展開 CLI 終端'}
            >
              {cliExpanded ? '▴ 收合 CLI' : '▾ 展開 CLI'}
            </button>
          </div>
          <div className="conversation-panel__composer">
            <textarea
              className="conversation-panel__input"
              value={draft}
              placeholder={inputReady ? '輸入訊息…（Enter 送出，Shift+Enter 換行）' : '正在開機中…（可先檢視/修改，就緒後即可送出）'}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <button className="conversation-panel__send" onClick={send} disabled={!inputReady} title={inputReady ? undefined : 'CLI 正在開機中，就緒後即可送出'}>
              {inputReady ? '送出' : '⏳ 開機中…'}
            </button>
          </div>
        </>
      ) : (
        <div className="conversation-panel__composer">
          <button
            className="conversation-panel__open-cli"
            onClick={onOpenCli}
            title="背景啟動 CLI（claude），啟動後即可在此輸入"
          >
            ▶ 開啟 CLI
          </button>
        </div>
      )}
    </div>
    </AskAnswerCallbackContext.Provider>
    </AskAnswersContext.Provider>
    </DispatchStatsContext.Provider>
    </SessionIdContext.Provider>
  )
}
