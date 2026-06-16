import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type {
  SkillItem,
  CardRunStatePayload,
  CardWorkflowProgressPayload,
  WorkflowRunSummary,
} from '../../../shared/ipcContracts'
import type { CliId } from '../../../shared/cliRegistry'
import type { OpenSession } from '../../hooks/useSession'
import { useMonitor } from '../../hooks/useMonitor'
import TerminalPanel from './TerminalPanel'
import MonitorPanel from './MonitorPanel'
import ConversationPanel from '../conversation/ConversationRouter'

interface Props {
  session: OpenSession
  onClose: (sessionId: string) => void
  /** PTY 就緒後自動注入的初始提示（Agent Ops 操作用）；null/空=不注入 */
  initialPrompt?: string | null
  /** 團隊 session 的 agent 下拉預設（裸 skillName）；空=不預選 */
  initialTeam?: string
}

/** 工具選項（header 專案設定列；對應 Qt session_terminal_panel_const.TOOL_VALUES） */
const TOOL_VALUES = ['claude', 'codex', 'vscode', 'custom'] as const

/**
 * SessionTab — 單一開啟 session 的完整 UI（對應 Qt QtSessionTab）。
 *
 * 流程：
 *   1. 開啟即進入純監測（無模式選擇起手畫面）：上方監測面板 + 對話框；
 *      CLI 未啟動、終端抽屜收合。
 *   2. 對話框點「開啟 CLI」→ 背景 spawn PTY + 注入啟動指令（claude 實際跑起來），
 *      對話框出現輸入框；終端抽屜不自動展開（身分列「展開 CLI」可隨時看原始終端）。
 *   3. 終端建立後常駐：收合只隱藏不銷毀（保留 PTY）。
 */
export default function SessionTab({ session, onClose, initialPrompt, initialTeam }: Props): React.JSX.Element {
  const [cliExpanded, setCliExpanded] = useState(false)
  const [convExpanded, setConvExpanded] = useState(true)
  // 對話框寬度（px）；null = 預設 38%。拖左緣 resizer 調整。
  const [convWidth, setConvWidth] = useState<number | null>(null)
  const convPaneRef = useRef<HTMLDivElement>(null)
  // CLI 終端高度（px）；null = 預設 55%。拖上緣 resizer 調整。
  const [cliHeight, setCliHeight] = useState<number | null>(null)
  const cliPaneRef = useRef<HTMLDivElement>(null)
  // CLI 是否已啟動：true = 終端已掛載（背景 spawn PTY + 注入啟動指令），
  // 之後常駐（收合只隱藏，不 kill PTY）；對話框輸入框也以此 gate。
  const [cliStarted, setCliStarted] = useState(false)
  // 該 session 的執行狀態（card:runState，依 taskId 過濾）。running=AI 仍在工作（含中途停頓）
  // → 對話框顯示「目前動作」指示。狀態源同側邊欄卡片變色。
  const [runState, setRunState] = useState<CardRunStatePayload['state']>('none')
  // 該 session 的 workflow 進度（card:workflowProgress，依 taskId 過濾）→ 對話框上方進度卡。
  const [workflows, setWorkflows] = useState<WorkflowRunSummary[]>([])
  // PTY 是否已就緒（spawn + launchCommand 注入完成）；未就緒時對話框輸入先排隊。
  const ptyReadyRef = useRef(false)
  // 排隊中的對話框輸入：存「原始 text」（不帶 \r）；flush 時才走兩段寫補送 Enter。
  const pendingInputRef = useRef<string[]>([])
  const { state: monitorState, start, stop, listSessions, rebind, rename } = useMonitor(
    session.sessionId,
  )
  // 訂閱 card:runState（依 session.taskId 過濾）→ 驅動對話框「目前動作」指示。
  useEffect(() => {
    setRunState('none') // 切 task 先重置，避免沿用上一個 task 的狀態
    const unsub = window.tuq.onCardRunState((payload: CardRunStatePayload) => {
      if (payload.taskId === session.taskId) setRunState(payload.state)
    })
    return unsub
  }, [session.taskId])
  // 訂閱 card:workflowProgress（依 session.taskId 過濾）→ 對話框上方 workflow 進度卡。
  useEffect(() => {
    setWorkflows([]) // 切 task 先重置
    // dev 熱更時 preload 可能還是舊版，缺 API 就跳過（重啟 app 後恢復）
    if (typeof window.tuq.onCardWorkflowProgress !== 'function') return
    const unsub = window.tuq.onCardWorkflowProgress((payload: CardWorkflowProgressPayload) => {
      if (payload.taskId === session.taskId) setWorkflows(payload.workflows)
    })
    return unsub
  }, [session.taskId])
  // 終端啟動指令：初始為 openSession 解析值；rebind（含「＋ 新 session」）後更新，
  // 終端 lazy spawn 時才不會注入 stale 的 `claude --resume <舊 session>`。
  const [launchCommand, setLaunchCommand] = useState(session.launchCommand)
  // 終端世代：+1 會以新 key 重掛 TerminalPanel（unmount kill 舊 PTY → 舊 claude 結束，
  // 重掛 spawn 新 PTY + 注入新啟動指令）。換綁到不同 session 且 CLI 已啟動時使用。
  const [ptyEpoch, setPtyEpoch] = useState(0)
  // 對話世代：換綁成功（handleRebind）或套用專案設定成功（applyProject）後 +1，
  // 觸發 ConversationPanel/useConversation 全量重置 + 轉場「重新整理中…」。
  const [convEpoch, setConvEpoch] = useState(0)
  // 目前綁定的 claude session uuid（判斷換綁是否真的換了對象）。
  const claudeIdRef = useRef(session.claudeSessionId)
  // 終端實際所在的專案路徑（ground truth）。初始為 session.projectPath；套用設定後
  // 以 backend 解析結果更新。TerminalPanel 以此為 cwd —— 切換路徑須以新值重掛 PTY 才生效：
  // 已啟動的 claude 不會自己換目錄，否則監測切到新路徑卻對不到仍在舊 cwd 跑的 session。
  const [appliedPath, setAppliedPath] = useState(session.projectPath || '')
  // 專案路徑 / 工具草稿（header 專案設定列；套用後寫回 milestone 設定）。
  const [pathDraft, setPathDraft] = useState(session.projectPath || '')
  const [toolDraft, setToolDraft] = useState(session.tool || 'claude')
  // MonitorPanel 綁定清單重整訊號（header 套用專案設定後 +1 觸發重抓）。
  const [bindRefreshKey, setBindRefreshKey] = useState(0)
  // 可用 skill 指令清單（對話框派遣下拉；掃 ~/.claude/skills + 專案 .claude/skills）。
  const [skills, setSkills] = useState<SkillItem[]>([])

  // 載入 skill 清單；套用專案設定（路徑可能變）後重抓。
  useEffect(() => {
    // dev 熱更時 preload 可能還是舊版，缺 API 就跳過（重啟 app 後恢復）
    if (typeof window.tuq.session.listSkills !== 'function') return
    let alive = true
    window.tuq.session
      .listSkills(session.sessionId)
      .then((r) => {
        if (alive && r.ok && r.data) setSkills(r.data)
      })
      .catch(() => {
        /* 靜默 */
      })
    return () => {
      alive = false
    }
  }, [session.sessionId, bindRefreshKey])

  // 對話框送出時的 skill 前綴依「實際在跑的 CLI」決定（ground truth；rebind/applyProject
  // 後 launchCommand 會更新）。取啟動指令第一個 token 對應 CliId；無法判定退回 session.tool
  // （非 CliId 的 vscode/custom 也一併退回 claude）。
  const cliId = useMemo<CliId>(() => {
    const head = (launchCommand ?? '').trim().split(/\s+/)[0]
    if (head === 'claude') return 'claude'
    if (head === 'codex') return 'codex'
    if (head === 'agy') return 'antigravity'
    if (session.tool === 'claude' || session.tool === 'codex' || session.tool === 'antigravity') {
      return session.tool
    }
    return 'claude'
  }, [launchCommand, session.tool])

  // 換綁監測對象 → 更新終端啟動指令；若對象真的變了且 CLI 已啟動，
  // 重啟終端（舊 claude 不會自己退出，須 kill PTY 換新的）。
  // CLI 未啟動時換綁只更新 launchCommand 不重啟 PTY；之後開 CLI 時
  // TerminalPanel 取到的已是新指令，故安全——不需要在此強制 epoch +1。
  const handleRebind = useCallback(
    async (claudeSessionId: string | null) => {
      const r = await rebind(claudeSessionId)
      if (!r) return
      setLaunchCommand(r.launchCommand)
      const changed = r.claudeSessionId !== claudeIdRef.current
      claudeIdRef.current = r.claudeSessionId
      if (changed && cliStarted) {
        ptyReadyRef.current = false // 新 PTY 注入完才再就緒
        setPtyEpoch((e) => e + 1)
      }
      // 換綁成功（無論 session 是否真的變了）→ 觸發對話重置轉場
      setConvEpoch((e) => e + 1)
    },
    [rebind, cliStarted],
  )

  // 開啟即啟動純監測；離開（unmount）停止。
  useEffect(() => {
    start(session.taskId, session.projectPath, session.milestoneId).catch(() => {
      /* 靜默 */
    })
    return () => {
      stop().catch(() => {
        /* 靜默 */
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 團隊對話流程開的 session 帶 initialPrompt（含使用者剛在「開始團隊對話」輸入的任務描述）：
  // 一進來就自動啟動 CLI（背景 spawn PTY → 注入啟動指令 + initialPrompt），不必等使用者手動
  // 「開啟 CLI」。純監測（無 initialPrompt，如雙擊看板卡）維持 lazy 啟動。
  // initialPrompt 的實際注入由 TerminalPanel 在 PTY 就緒後完成（只注入一次）。
  useEffect(() => {
    if (initialPrompt && initialPrompt.trim()) setCliStarted(true)
  }, [initialPrompt])

  // 對話框「開啟 CLI」：背景掛載終端（spawn PTY + 注入啟動指令，claude 實際跑起來），
  // 不展開終端抽屜 —— 對話框輸入框隨即可用。
  const openCli = useCallback(() => {
    setCliStarted(true)
  }, [])

  const toggleCli = useCallback(() => {
    setCliExpanded((v) => {
      const next = !v
      if (next) setCliStarted(true) // 首次展開也會啟動 CLI
      return next
    })
  }, [])

  const handleStart = useCallback(() => {
    start(session.taskId, appliedPath, session.milestoneId).catch(() => {
      /* 靜默 */
    })
  }, [session, appliedPath, start])

  const handleStop = useCallback(() => {
    stop().catch(() => {
      /* 靜默 */
    })
  }, [stop])

  // header 設定列：套用專案路徑 + 工具（存回 milestone 設定；backend 會重解析
  // 監測對象與啟動指令 → 同步回本地，並通知 MonitorPanel 重整綁定清單）。
  // 取消「套用」按鈕後改為選擇即套用：下拉切換 / 瀏覽選資料夾 / 路徑輸入框 blur+Enter
  // 都直接觸發。因 setState 為 async，呼叫時以參數覆寫剛選的值（pathArg/toolArg），
  // 避免讀到尚未更新的 pathDraft/toolDraft state。
  const applyProject = useCallback(async (pathArg?: string, toolArg?: string) => {
    const path = (pathArg ?? pathDraft).trim()
    const tool = toolArg ?? toolDraft
    const prevPath = appliedPath
    const prevLaunch = launchCommand
    // 選擇即套用後 onBlur 會在沒改動時也觸發 → 路徑與工具都沒變就 no-op，
    // 避免無謂的 setProject（會 +convEpoch 重置對話、+bindRefreshKey 重抓綁定）。
    if (path === appliedPath && tool === toolDraft) return
    try {
      const r = await window.tuq.session.setProject(session.sessionId, path, tool)
      if (r.ok && r.data && r.data.ok) {
        setLaunchCommand(r.data.launchCommand)
        claudeIdRef.current = r.data.claudeSessionId
        setAppliedPath(r.data.projectPath || '')
        // setProject 回 ok → 換綁成功，觸發對話重置轉場
        setConvEpoch((e) => e + 1)
        // 路徑或啟動指令真的變了且 CLI 已啟動 → 須重掛 PTY：舊終端的 claude 仍在舊 cwd，
        // 不會自己換目錄；不重掛則監測切到新路徑卻對不到舊 cwd 的 session（監測失敗）。
        // 重掛以新 cwd（appliedPath）+ 新 launchCommand spawn，對齊 handleRebind 行為。
        const changed =
          (r.data.projectPath || '') !== prevPath || r.data.launchCommand !== prevLaunch
        if (changed && cliStarted) {
          ptyReadyRef.current = false // 新 PTY 注入完才再就緒
          setPtyEpoch((e) => e + 1)
        }
      }
    } catch {
      /* 靜默 */
    }
    setBindRefreshKey((k) => k + 1)
  }, [session.sessionId, pathDraft, toolDraft, appliedPath, launchCommand, cliStarted])

  // AI 模組（工具）切換：下拉已從專案列移至對話面板頂端，沿用原「選擇即套用」語意
  // （setProject 會重解析啟動指令並重整綁定）。
  const handleToolChange = useCallback(
    (tool: string) => {
      setToolDraft(tool)
      applyProject(undefined, tool)
    },
    [applyProject],
  )

  // 開資料夾選擇對話框（header 瀏覽鈕）→ 填入路徑草稿並立即套用（選擇即套用）。
  const handleBrowse = useCallback(async () => {
    try {
      const r = await window.tuq.dialog.openDirectory()
      if (r.ok && r.data) {
        setPathDraft(r.data)
        applyProject(r.data)
      }
    } catch {
      /* 靜默 */
    }
  }, [applyProject])

  // 拖曳對話框左緣調整寬度（往左拉變寬；240px ～ 視窗 70%）。
  const onConvResizeStart = useCallback((e: React.MouseEvent) => {
    const pane = convPaneRef.current
    if (!pane) return
    e.preventDefault()
    const startX = e.clientX
    const startW = pane.offsetWidth
    const onMove = (ev: MouseEvent): void => {
      const w = Math.min(
        Math.max(startW + (startX - ev.clientX), 240),
        Math.floor(window.innerWidth * 0.7),
      )
      setConvWidth(w)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // 拖曳 CLI 上緣調整高度（往上拉變高；120px ～ 視窗 80%）。
  const onCliResizeStart = useCallback((e: React.MouseEvent) => {
    const pane = cliPaneRef.current
    if (!pane) return
    e.preventDefault()
    const startY = e.clientY
    const startH = pane.offsetHeight
    const onMove = (ev: MouseEvent): void => {
      const h = Math.min(
        Math.max(startH + (startY - ev.clientY), 120),
        Math.floor(window.innerHeight * 0.8),
      )
      setCliHeight(h)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  // 文字與 Enter 分兩次寫：一包寫入會被 TUI 當 bracketed paste，結尾 \r 變換行不送出。
  const writeAndSubmit = useCallback(
    (text: string) => {
      window.tuq.pty.write(session.sessionId, text)
      setTimeout(() => {
        window.tuq.pty.write(session.sessionId, '\r')
      }, 150)
    },
    [session.sessionId],
  )

  // AskUserQuestion 按鈕回答：寫數字選項序號 + 150ms 後送 Enter，繞 bracketed paste。
  // 若 PTY 未就緒（理論上 ask 出現時 PTY 必已在）→ no-op 並 console.warn。
  const handleAnswerAsk = useCallback(
    (_toolUseId: string, optionIndex: number, _label: string) => {
      if (!cliStarted || !ptyReadyRef.current) {
        console.warn('[AskCard] handleAnswerAsk: PTY not ready, ignoring answer', optionIndex)
        return
      }
      window.tuq.pty.write(session.sessionId, String(optionIndex))
      setTimeout(() => {
        window.tuq.pty.write(session.sessionId, '\r')
      }, 150)
    },
    [cliStarted, session.sessionId],
  )

  // 對話框輸入直送 PTY（等同終端打字）。輸入框僅在 CLI 已啟動後顯示，
  // 此處仍保險確保已啟動；不自動展開終端抽屜（CLI 在背景跑）。
  const handleSend = useCallback(
    (text: string) => {
      setCliStarted(true)
      if (ptyReadyRef.current) {
        writeAndSubmit(text)
      } else {
        // PTY 尚未就緒（spawn 是 async）→ 先排隊原始 text，待 onReady flush，
        // 避免首則訊息打到還沒建立的 PTY 而遺失。
        pendingInputRef.current.push(text)
      }
    },
    [writeAndSubmit],
  )

  // TerminalPanel 回報 PTY 就緒（含 launchCommand 注入後）→ 依序 flush 排隊輸入。
  const handlePtyReady = useCallback(() => {
    ptyReadyRef.current = true
    const pending = pendingInputRef.current
    pendingInputRef.current = []
    // 多筆依序送，每筆間隔 ~400ms（text → 150ms → \r → 250ms → 下一筆），
    // 避免連發黏成一次 paste。
    pending.forEach((text, i) => {
      setTimeout(() => writeAndSubmit(text), i * 400)
    })
  }, [writeAndSubmit])

  // ---- 身分列（header）：任務識別（專案路徑移至監測面板綁定列上方；AI 模組移至對話面板頂端）----
  const identityBar = (
    <div className="session-tab__identity">
      <span className="session-tab__task-name" title={session.taskName || session.taskId}>
        {session.taskName || session.taskId}
      </span>
      <button
        className="session-tab__close-btn"
        onClick={() => onClose(session.sessionId)}
        title="關閉 session"
      >
        ✕
      </button>
    </div>
  )

  // ---- 監測面板（上）+ 可展開 CLI 抽屜（下），同時可見 ----
  const showTerminal = cliStarted
  return (
    <div className="session-tab">
      {identityBar}
      <div className="session-tab__active">
        <div className="session-tab__upper">
          <div className="session-tab__monitor-pane">
            <MonitorPanel
              sessionId={session.sessionId}
              taskId={session.taskId}
              monitorState={monitorState}
              refreshKey={bindRefreshKey}
              onStart={handleStart}
              onStop={handleStop}
              onListSessions={listSessions}
              onRebind={handleRebind}
              onRename={rename}
              projectPath={pathDraft}
              onProjectPathChange={setPathDraft}
              onApplyProject={() => applyProject()}
              onBrowse={handleBrowse}
              pathAutofixed={session.pathAutofixed}
            />
          </div>
          {convExpanded ? (
            <>
              <div
                className="session-tab__conv-resizer"
                onMouseDown={onConvResizeStart}
                title="拖曳調整對話框寬度"
              />
              <div
                className="session-tab__conversation-pane"
                ref={convPaneRef}
                style={convWidth !== null ? { flex: `0 0 ${convWidth}px` } : undefined}
              >
                <ConversationPanel
                  sessionId={session.sessionId}
                  convEpoch={convEpoch}
                  skills={skills}
                  onSend={handleSend}
                  cliStarted={cliStarted}
                  onOpenCli={openCli}
                  cliExpanded={cliExpanded}
                  onToggleCli={toggleCli}
                  onCollapse={() => setConvExpanded(false)}
                  onAnswerAsk={handleAnswerAsk}
                  initialTeam={initialTeam}
                  cliId={cliId}
                  runState={runState}
                  workflows={workflows}
                  tool={toolDraft}
                  toolValues={TOOL_VALUES}
                  onToolChange={handleToolChange}
                />
              </div>
            </>
          ) : (
            /* 對話收合後右緣的直立把手：點擊重新展開 */
            <button
              className="session-tab__conv-expand"
              onClick={() => setConvExpanded(true)}
              title="展開對話"
            >
              ◂ 對話
            </button>
          )}
        </div>
        {showTerminal && (
          <>
            <div
              className="session-tab__cli-resizer"
              style={{ display: cliExpanded ? 'block' : 'none' }}
              onMouseDown={onCliResizeStart}
              title="拖曳調整終端高度"
            />
            <div
              className="session-tab__cli-pane"
              ref={cliPaneRef}
              style={{
                display: cliExpanded ? 'flex' : 'none',
                ...(cliHeight !== null ? { flex: `0 0 ${cliHeight}px` } : {}),
              }}
            >
              <TerminalPanel
                key={ptyEpoch}
                sessionId={session.sessionId}
                projectPath={appliedPath || undefined}
                tool={session.tool}
                launchCommand={launchCommand}
                onReady={handlePtyReady}
                initialPrompt={initialPrompt}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
}
