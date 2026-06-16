import React from 'react'
import type { ConversationMessage, ConvBlock } from '../../../../shared/ipcContracts'
import { numCompact } from './helpers'

/** source 徽章（對應 app.html buildSourceBadge；沿用 SOURCE_LABEL 語意）。
 *  無 source 時回傳 null。
 *  去重規則：source === 'tool_result' 且訊息 blocks 中已含 tool_result block 時，
 *  block 徽章（blockBadgesOf）已顯示「📥 tool_result」，此處跳過以避免雙標籤。
 *  其他 source（typed / command / meta）行為不變。 */
export function sourceBadgeOf(m: ConversationMessage): React.JSX.Element | null {
  const src = m.source
  if (!src) return null
  // 去重：tool_result source + block 內已有 tool_result block → 只渲染 block 徽章，跳過 source 徽章
  if (src === 'tool_result' && m.blocks.some((b) => b.kind === 'tool_result')) return null
  const map: Record<string, string> = {
    typed: '⌨ typed',
    command: '/ command',
    tool_result: '📥 tool_result',
    meta: '📎 meta',
    notify: '🔔 通知',
  }
  return (
    <span className={`badge-source badge-source-${src}`}>
      {map[src] ?? src}
    </span>
  )
}

/** dispatch 徽章（對應 app.html detectDispatches；掃 blocks 偵測 Task/Agent tool_use）。
 *  label 優先序：description > subagent_type > b.name；JSON.parse 失敗退 b.name。
 *  無派遣時回傳 null。 */
export function dispatchBadgeOf(m: ConversationMessage): React.JSX.Element | null {
  const dispatches: string[] = []
  for (const b of m.blocks) {
    if (b.kind !== 'tool_use') continue
    const name = b.name ?? ''
    if (name !== 'Task' && name !== 'Agent') continue
    let label = name
    try {
      const raw = JSON.parse(b.text) as Record<string, unknown>
      const desc = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : undefined
      const stype = typeof raw.subagent_type === 'string' && raw.subagent_type.trim() ? raw.subagent_type.trim() : undefined
      label = desc ?? stype ?? name
    } catch {
      // JSON.parse 失敗 → 退回工具名
    }
    dispatches.push(label)
  }
  if (dispatches.length === 0) return null
  // 最多顯示 2 個，超過加 +N
  const dispText =
    dispatches.length > 2
      ? dispatches.slice(0, 2).join(', ') + ' +' + (dispatches.length - 2)
      : dispatches.join(', ')
  return <span className="badge-dispatch">{`🚀 派遣 → ${dispText}`}</span>
}

/** block 種類徽章列（對應 app.html buildCard seenTypes 迴圈）。
 *  掃 m.blocks 去重顯示出現的 block 型別；tool_use 串工具名（前 3 個 + …）。 */
export function blockBadgesOf(m: ConversationMessage): React.JSX.Element | null {
  const toolUseNames: string[] = []
  const seenTypes = new Set<string>()
  let hasToolUse = false
  for (const b of m.blocks) {
    if (b.kind === 'tool_use') {
      if (!hasToolUse) { hasToolUse = true; seenTypes.add('tool_use') }
      if (b.name) toolUseNames.push(b.name)
    } else {
      seenTypes.add(b.kind)
    }
  }
  if (seenTypes.size === 0) return null
  const els: React.JSX.Element[] = []
  seenTypes.forEach((btype) => {
    if (btype === 'tool_use') {
      const uniqueNames = [...new Set(toolUseNames)]
      const display = uniqueNames.length > 3
        ? uniqueNames.slice(0, 3).join(', ') + '…'
        : uniqueNames.join(', ')
      els.push(
        <span key="tu" className="badge-block badge-block-tooluse">
          {`🔧 ${display || 'tool_use'}`}
        </span>
      )
    } else if (btype === 'tool_result') {
      els.push(<span key="tr" className="badge-block badge-block-toolresult">📥 tool_result</span>)
    } else if (btype === 'thinking') {
      els.push(<span key="th" className="badge-block badge-block-thinking">🧠 thinking</span>)
    } else if (btype === 'text') {
      els.push(<span key="tx" className="badge-block badge-block-text">💬 text</span>)
    }
  })
  return <>{els}</>
}

/** token 用量徽章（對應 app.html badge-tokens；僅 assistant 訊息有 m.usage）。
 *  格式：↑{input} ↓{output}；hover title 顯示完整明細。*/
export function tokenBadgeOf(m: ConversationMessage): React.JSX.Element | null {
  const u = m.usage
  if (!u) return null
  const inp = u.input ?? 0
  const out = u.output ?? 0
  const cr = u.cacheRead ?? 0
  const cc = u.cacheCreate ?? 0
  if (inp === 0 && out === 0 && cr === 0 && cc === 0) return null
  let text = `↑${numCompact(inp)} ↓${numCompact(out)}`
  if (cr > 0) text += ` \u{1F504}${numCompact(cr)}`
  // hover title：完整數字明細（含 cacheCreate）
  const parts = [`input ${inp.toLocaleString()} · output ${out.toLocaleString()}`]
  if (cr > 0) parts.push(`cache read ${cr.toLocaleString()}`)
  if (cc > 0) parts.push(`cache create ${cc.toLocaleString()}`)
  return (
    <span className="badge-tokens" title={parts.join(' · ')}>
      {text}
    </span>
  )
}

/** 卡片 summary 一行預覽（對應 app.html getSummaryPreview）。
 *  取首個 text block 壓縮 ~60 字；無 text 則用 block 種類摘要。 */
export function cardPreviewOf(m: ConversationMessage): string {
  // 首個 text block
  const first = m.blocks.find((b) => b.kind === 'text' && b.text)
  if (first) {
    const t = first.text.replace(/\s+/g, ' ').trim()
    return t.length > 60 ? t.slice(0, 60) + '…' : t
  }
  // 無 text → block 種類摘要
  const toolUse = m.blocks.find((b) => b.kind === 'tool_use')
  if (toolUse) return `[tool_use] ${toolUse.name ?? 'tool'}`
  const thinking = m.blocks.find((b) => b.kind === 'thinking')
  if (thinking) return '[thinking]'
  const n = m.blocks.length
  return n > 0 ? `[${n} blocks]` : ''
}

/** 取 dispatch block 的 label（複用 dispatchBadgeOf 的解析邏輯）。 */
export function labelOfDispatchBlock(b: ConvBlock): string {
  try {
    const raw = JSON.parse(b.text) as Record<string, unknown>
    const desc = typeof raw.description === 'string' && raw.description.trim() ? raw.description.trim() : undefined
    const stype = typeof raw.subagent_type === 'string' && raw.subagent_type.trim() ? raw.subagent_type.trim() : undefined
    return desc ?? stype ?? (b.name ?? 'Task')
  } catch {
    return b.name ?? 'Task'
  }
}
