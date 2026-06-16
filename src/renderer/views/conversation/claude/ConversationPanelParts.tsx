import React, { useState, useCallback } from 'react'
import type { ConversationMessage, ConvBlock } from '../../../../shared/ipcContracts'
import type { CliId } from '../../../../shared/cliRegistry'
import { ASK_TOOL_NAME, parseAskAnswers } from './helpers'
import RawCard from './RawCard'

export type ViewMode = 'card' | 'raw'
export const VIEW_MODE_KEY = 'conv-view-mode'

/** 送出派遣訊息時依 CLI 取的 skill 前綴：claude=`/`、codex=`$`、antigravity=`/`（agy 支援 /skill-name 語意，研究結論 feasible=skills）。 */
export const SKILL_PREFIX: Record<CliId, string> = { claude: '/', codex: '$', antigravity: '/' }

/** 「思考中」安全網：逾此時間仍無回應跡象則自動收起，避免指示器卡死。 */
export const THINKING_TIMEOUT_MS = 5 * 60_000

/**
 * 助理活動簽名：助理訊息數 + 末則區塊數 + 末區塊文字長。
 * 送出訊息後若此簽名相對基準有變動，代表 CLI 已開始產生回應 → 收起「思考中」。
 */
export function assistantSig(messages: ConversationMessage[]): string {
  let count = 0
  let last: ConversationMessage | undefined
  for (const m of messages) {
    if (m.role === 'assistant') {
      count++
      last = m
    }
  }
  const lastBlock = last?.blocks[last.blocks.length - 1]
  return `${count}:${last?.blocks.length ?? 0}:${lastBlock?.text.length ?? 0}`
}

/**
 * 工具名 → 大略「目前動作」標籤（含 emoji）。用於 runState=running 時顯示 AI 正在做什麼。
 * 未列入者退回「AI 思考中」。涵蓋 claude / codex 常見工具；MCP（mcp__*）歸「呼叫工具」。
 */
const TOOL_ACTIVITY: Record<string, string> = {
  Bash: '⚙ 正在執行指令', BashOutput: '⚙ 正在執行指令', KillShell: '⚙ 正在執行指令',
  Read: '📖 正在讀取檔案', NotebookRead: '📖 正在讀取檔案',
  Edit: '✏️ 正在編輯檔案', Write: '✏️ 正在編輯檔案', MultiEdit: '✏️ 正在編輯檔案', NotebookEdit: '✏️ 正在編輯檔案',
  Grep: '🔍 正在搜尋', Glob: '🔍 正在搜尋',
  WebSearch: '🌐 正在查網路', WebFetch: '🌐 正在查網路',
  Task: '🤖 正在派工子代理', Agent: '🤖 正在派工子代理',
  TodoWrite: '📝 正在整理待辦',
}

/**
 * 依對話「最後一個非空訊息的末區塊」大略判斷 AI 目前在做什麼：
 *   末區塊是 tool_use → 對應工具動作（執行指令 / 讀取 / 編輯 / 搜尋…）；
 *   其餘（text/thinking/tool_result/無）→ 退回「AI 思考中」（剛完成一步、模型在想下一步）。
 */
export function currentActivityLabel(messages: ConversationMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = messages[i].blocks
    if (blocks.length === 0) continue
    const last = blocks[blocks.length - 1]
    if (last.kind === 'tool_use' && last.name) {
      const known = TOOL_ACTIVITY[last.name]
      if (known) return known
      if (last.name.startsWith('mcp__')) return '🔌 正在呼叫工具'
    }
    return 'AI 思考中'
  }
  return 'AI 思考中'
}

/**
 * AI 模組顯示名：讓使用者一眼看懂選的是什麼（標的更清楚）。
 * 未列入者退回原值。claude 標「可打卡」，其餘標「未支援監測」以提示差異。
 */
export const MODULE_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  vscode: 'VS Code',
  custom: '自訂指令',
}

/**
 * 收合態 subagent 總量 map：掃所有已載入訊息（新路徑=pool 全量；舊路徑=legacyMessages），
 * 提取 tool_result block 的 subagentStats。
 * key = tool_use_id（與 SubagentGroup.toolUseId 對應的 tool_use block id）。
 */
export function buildDispatchStatsMap(
  messages: ConversationMessage[],
): Map<string, NonNullable<ConvBlock['subagentStats']>> {
  const map = new Map<string, NonNullable<ConvBlock['subagentStats']>>()
  for (const msg of messages) {
    for (const b of msg.blocks) {
      if (b.kind === 'tool_result' && b.tool_use_id && b.subagentStats) {
        map.set(b.tool_use_id, b.subagentStats)
      }
    }
  }
  return map
}

/**
 * Ask 問答答案 map：掃 pool 中以「Your questions have been answered:」開頭的 tool_result block，
 * 僅當其 tool_use_id 對應到某 AskUserQuestion tool_use（避免誤吃同前綴的其他結果）。
 * key = Ask tool_use_id；value = parseAskAnswers 解析的「題 → 答」表。
 */
export function buildAskAnswersMap(
  messages: ConversationMessage[],
): Map<string, Record<string, string>> {
  const askIds = new Set<string>()
  for (const msg of messages) {
    for (const b of msg.blocks) {
      if (b.kind === 'tool_use' && b.name === ASK_TOOL_NAME && b.id) askIds.add(b.id)
    }
  }
  const map = new Map<string, Record<string, string>>()
  for (const msg of messages) {
    for (const b of msg.blocks) {
      if (
        b.kind === 'tool_result' &&
        b.tool_use_id &&
        askIds.has(b.tool_use_id) &&
        b.text.startsWith('Your questions have been answered:')
      ) {
        map.set(b.tool_use_id, parseAskAnswers(b.text))
      }
    }
  }
  return map
}

/** 單個 Raw 段落狀態。 */
export interface RawSegState {
  phase: 'idle' | 'loading' | 'loaded' | 'error'
  lines: string[]
  truncated: boolean
}

// ---------------------------------------------------------------------------
// RawSegSection — Raw 模式下單段的摺疊容器
// ---------------------------------------------------------------------------

interface RawSegSectionProps {
  label: string
  startSeq: number
  endSeq: number
  state: RawSegState | undefined
  onExpand: () => void
}

export function RawSegSection({ label, state, onExpand }: RawSegSectionProps): React.JSX.Element {
  const [open, setOpen] = useState(false)

  const handleToggle = useCallback(() => {
    const next = !open
    setOpen(next)
    if (next && (!state || state.phase === 'idle')) onExpand()
  }, [open, state, onExpand])

  return (
    <div className="raw-seg-section">
      <button className="raw-seg-section__header" onClick={handleToggle} aria-expanded={open}>
        <span className="raw-seg-section__label">{label}</span>
        <span className="raw-seg-section__chevron">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="raw-seg-section__body">
          {!state || state.phase === 'idle' || state.phase === 'loading' ? (
            <div className="raw-seg-section__status">載入中…</div>
          ) : state.phase === 'error' ? (
            <div className="raw-seg-section__status raw-seg-section__status--error">載入失敗</div>
          ) : state.lines.length === 0 ? (
            <div className="raw-seg-section__status">（此段無可渲染 record）</div>
          ) : (
            <>
              {state.truncated && (
                <div className="raw-seg-section__truncated">已截斷（超過 500 行或 2 MB）</div>
              )}
              {state.lines.map((line, i) => (
                <RawCard key={i} index={i} rawLine={line} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
