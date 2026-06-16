import React, { useState, useMemo, useCallback } from 'react'
import type {
  WorkflowRunSummary,
  WorkflowAgentEntry,
  ConversationMessage,
} from '../../../../shared/ipcContracts'
import { fmtDurationMs } from './helpers'

/**
 * WorkflowProgressCard — 對話框上方的 workflow 進度卡。
 *
 * 資料源：main 推的 card:workflowProgress（讀 <session>/workflows/wf_*.json）。
 * 顯示：每個 run 一張卡——名稱 + 狀態徽章 + 摘要；展開後看 phases（標出目前階段）
 * 與各 agent 一行（狀態 / label / 最近工具摘要 / tokens）；點 agent 可再展開
 * prompt / result 預覽。running 預設展開，其餘（歷史）預設收合。
 */

/** agent.state → 狀態圖示 + 文字（未知狀態退回原字串）。 */
const AGENT_STATE: Record<string, { icon: string; label: string }> = {
  queued: { icon: '⏳', label: '排隊中' },
  running: { icon: '🔄', label: '執行中' },
  done: { icon: '✅', label: '完成' },
  error: { icon: '❌', label: '錯誤' },
  failed: { icon: '❌', label: '失敗' },
  skipped: { icon: '⏭', label: '略過' },
}

function agentStateView(state: string): { icon: string; label: string } {
  return AGENT_STATE[state] ?? { icon: '•', label: state }
}

/** run.status → 徽章樣式 modifier + 文字。 */
function runStatusView(status: string): { mod: string; text: string; spin: boolean } {
  if (status === 'running') return { mod: 'running', text: '執行中', spin: true }
  if (status === 'completed') return { mod: 'completed', text: '已完成', spin: false }
  if (status === 'error' || status === 'failed')
    return { mod: 'error', text: '錯誤', spin: false }
  return { mod: 'unknown', text: status, spin: false }
}

/** 數字千分位（tokens 用）。 */
function fmtNum(n: number | undefined): string {
  if (typeof n !== 'number') return '0'
  return n.toLocaleString('en-US')
}

export default function WorkflowProgressCard({
  sessionId,
  workflows,
}: {
  sessionId: string
  workflows: WorkflowRunSummary[]
}): React.JSX.Element {
  return (
    <div className="workflow-progress" role="region" aria-label="Workflow 進度">
      {workflows.map((w) => (
        <WorkflowRunRow key={w.runId} sessionId={sessionId} run={w} />
      ))}
    </div>
  )
}

function WorkflowRunRow({
  sessionId,
  run,
}: {
  sessionId: string
  run: WorkflowRunSummary
}): React.JSX.Element {
  // running 預設展開；歷史（completed 等）預設收合。
  const [open, setOpen] = useState(run.status === 'running')
  const status = runStatusView(run.status)

  const doneCount = useMemo(
    () => run.agents.filter((a) => a.state === 'done').length,
    [run.agents],
  )
  const agentTotal = run.agentCount ?? run.agents.length

  return (
    <div className={`workflow-run workflow-run--${status.mod}`}>
      <button
        className="workflow-run__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`workflow-run__badge workflow-run__badge--${status.mod}`}>
          {status.spin && <span className="workflow-run__spinner" aria-hidden="true" />}
          {status.text}
        </span>
        <span className="workflow-run__name" title={run.runId}>
          {run.workflowName}
        </span>
        <span className="workflow-run__summary">
          {doneCount}/{agentTotal} agents
          {typeof run.totalTokens === 'number' && ` · ${fmtNum(run.totalTokens)} tok`}
          {typeof run.durationMs === 'number' && ` · ${fmtDurationMs(run.durationMs)}`}
        </span>
        <span className="workflow-run__chevron">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="workflow-run__body">
          {run.phases.length > 0 && <PhaseRow run={run} />}
          {run.agents.length > 0 && (
            <div className="workflow-run__agents">
              {run.agents.map((a) => (
                <AgentRow
                  key={`${a.phaseIndex}-${a.index}`}
                  sessionId={sessionId}
                  runId={run.runId}
                  agent={a}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 階段 pill 列：依各 agent 狀態判斷每個 phase 是否完成 / 進行中。 */
function PhaseRow({ run }: { run: WorkflowRunSummary }): React.JSX.Element {
  // phase（1-based phaseIndex）→ 該階段 agents 是否全完成 / 有在跑。
  const phaseState = useMemo(() => {
    const map = new Map<number, { total: number; done: number; running: number }>()
    for (const a of run.agents) {
      const cur = map.get(a.phaseIndex) ?? { total: 0, done: 0, running: 0 }
      cur.total += 1
      if (a.state === 'done') cur.done += 1
      if (a.state === 'running') cur.running += 1
      map.set(a.phaseIndex, cur)
    }
    return map
  }, [run.agents])

  return (
    <div className="workflow-run__phases">
      {run.phases.map((p, i) => {
        const st = phaseState.get(i + 1)
        let mod = 'pending'
        if (st && st.total > 0 && st.done === st.total) mod = 'done'
        else if (st && (st.running > 0 || st.done > 0)) mod = 'active'
        return (
          <span
            key={i}
            className={`workflow-phase workflow-phase--${mod}`}
            title={p.detail || p.title}
          >
            <span className="workflow-phase__no">{i + 1}</span>
            {p.title}
          </span>
        )
      })}
    </div>
  )
}

/** 完整逐字稿載入狀態。 */
type FullState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ok'; text: string }
  | { phase: 'empty'; reason: string }

/** 把 transcript 訊息攤平成可讀全文（text/thinking 直出；tool_use 標工具名 + input；tool_result 標結果）。 */
function messagesToText(messages: ConversationMessage[]): string {
  const parts: string[] = []
  for (const m of messages) {
    for (const b of m.blocks) {
      const t = (b.text || '').trim()
      if (!t) continue
      if (b.kind === 'tool_use') parts.push(`【工具 ${b.name ?? ''}】\n${t}`)
      else if (b.kind === 'tool_result') parts.push(`【結果】\n${t}`)
      else if (b.kind === 'thinking') parts.push(`（思考）\n${t}`)
      else parts.push(t)
    }
  }
  return parts.join('\n\n')
}

/** 單一 agent 一行；點擊展開 prompt / result 預覽，並可按需載入完整逐字稿。 */
function AgentRow({
  sessionId,
  runId,
  agent,
}: {
  sessionId: string
  runId: string
  agent: WorkflowAgentEntry
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [full, setFull] = useState<FullState>({ phase: 'idle' })
  const sv = agentStateView(agent.state)
  const hasPreview = Boolean(agent.promptPreview || agent.resultPreview)
  const canLoadFull = Boolean(agent.agentId)
  const canExpand = hasPreview || canLoadFull

  const toggle = useCallback(() => {
    if (canExpand) setOpen((v) => !v)
  }, [canExpand])

  const loadFull = useCallback(() => {
    if (!agent.agentId) return
    // stale-preload（dev 熱更）容錯：API 尚未注入就提示重啟
    if (typeof window.tuq?.session?.getWorkflowAgentConversation !== 'function') {
      setFull({ phase: 'empty', reason: '需重啟 app 以載入此功能' })
      return
    }
    setFull({ phase: 'loading' })
    window.tuq.session
      .getWorkflowAgentConversation(sessionId, runId, agent.agentId)
      .then((r) => {
        if (!r.ok || !r.data || !r.data.ok || r.data.messages.length === 0) {
          setFull({ phase: 'empty', reason: '找不到完整逐字稿（可能尚未寫入）' })
          return
        }
        const text = messagesToText(r.data.messages)
        setFull(text ? { phase: 'ok', text } : { phase: 'empty', reason: '逐字稿無文字內容' })
      })
      .catch(() => setFull({ phase: 'empty', reason: '載入失敗' }))
  }, [sessionId, runId, agent.agentId])

  return (
    <div className={`workflow-agent workflow-agent--${agent.state}`}>
      <button
        className="workflow-agent__row"
        onClick={toggle}
        aria-expanded={open}
        disabled={!canExpand}
      >
        <span className="workflow-agent__icon" title={sv.label} aria-label={sv.label}>
          {sv.icon}
        </span>
        <span className="workflow-agent__label" title={agent.label}>
          {agent.label}
        </span>
        <span className="workflow-agent__meta">
          {agent.lastToolSummary || agent.lastToolName || ''}
        </span>
        <span className="workflow-agent__nums">
          {typeof agent.tokens === 'number' && `${fmtNum(agent.tokens)} tok`}
          {typeof agent.toolCalls === 'number' && ` · ${agent.toolCalls} calls`}
        </span>
        {canExpand && <span className="workflow-agent__chevron">{open ? '▴' : '▾'}</span>}
      </button>

      {open && (
        <div className="workflow-agent__detail">
          {/* 完整內容：載入成功 → 顯示全文；否則顯示預覽 + 載入鈕 */}
          {full.phase === 'ok' ? (
            <div className="workflow-agent__block">
              <div className="workflow-agent__block-label">完整逐字稿</div>
              <div className="workflow-agent__block-text">{full.text}</div>
            </div>
          ) : (
            <>
              {agent.promptPreview && (
                <div className="workflow-agent__block">
                  <div className="workflow-agent__block-label">Prompt（預覽）</div>
                  <div className="workflow-agent__block-text">{agent.promptPreview}</div>
                </div>
              )}
              {agent.resultPreview && (
                <div className="workflow-agent__block">
                  <div className="workflow-agent__block-label">Result（預覽）</div>
                  <div className="workflow-agent__block-text">{agent.resultPreview}</div>
                </div>
              )}
              {canLoadFull && (
                <div className="workflow-agent__full-actions">
                  {full.phase === 'loading' ? (
                    <span className="workflow-agent__full-status">載入中…</span>
                  ) : full.phase === 'empty' ? (
                    <span className="workflow-agent__full-status">{full.reason}</span>
                  ) : (
                    <button className="workflow-agent__full-btn" onClick={loadFull}>
                      載入完整內容
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
