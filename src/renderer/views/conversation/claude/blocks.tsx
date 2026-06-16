import React, { useState, useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { ConvBlock } from '../../../../shared/ipcContracts'
import { TEXT_TRUNC } from './helpers'

/** 文字區塊（對應 app.html makeTextBlock）。
 *  user decision：text block 走 MD 渲染（marked + DOMPurify），覆蓋設計 §5「純文字」。
 *  過長截斷 + 「▼ 顯示更多」沿用現行 TEXT_TRUNC 行為。 */
function TextBlockView({ text }: { text: string }): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)
  const isTrunc = text.length > TEXT_TRUNC
  const src = showAll || !isTrunc ? text : text.slice(0, TEXT_TRUNC)
  // Markdown 渲染（DOMPurify 消毒，同現行 MdText 消毒策略）
  const html = useMemo(() => {
    try {
      return DOMPurify.sanitize(marked.parse(src, { async: false }) as string)
    } catch {
      return src
    }
  }, [src])
  return (
    <div className="block block-text">
      {/* MD 已 DOMPurify 消毒（剝 script/事件屬性），innerHTML 安全 */}
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {isTrunc && !showAll && (
        <span className="truncate-more" onClick={() => setShowAll(true)}>
          {`▼ 顯示更多 (共 ${text.length.toLocaleString()} 字元)`}
        </span>
      )}
    </div>
  )
}

/** 可收合區塊（對應 app.html makeThinkingBlock / makeToolUseBlock / makeToolResultBlock）。
 *  kind：'thinking' | 'tool-use' | 'tool-result'；預設收合，點 header 展開。 */
function CollapsibleBlockView({
  kind,
  b,
}: {
  kind: 'thinking' | 'tool-use' | 'tool-result'
  b: ConvBlock
}): React.JSX.Element {
  const [open, setOpen] = useState(false)

  // header 文字 & class 依 kind 決定（對應 app.html 三支 make* 函式）
  let headerContent: React.ReactNode
  if (kind === 'thinking') {
    // 對應 app.html makeThinkingBlock header
    headerContent = <span>🧠 思考 (thinking)</span>
  } else if (kind === 'tool-use') {
    // 對應 app.html makeToolUseBlock header：工具名 + id（灰小字）
    headerContent = (
      <>
        <span className="tool-name-label">{b.name || 'tool'}</span>
        {b.id && (
          <span style={{ marginLeft: '6px', color: 'var(--text-muted)', fontSize: '11px' }}>
            {`id: ${b.id}`}
          </span>
        )}
      </>
    )
  } else {
    // tool-result：對應 app.html makeToolResultBlock header：工具結果 + for: 短碼（hover 全碼）
    const shortId = b.tool_use_id ? b.tool_use_id.slice(0, 12) : undefined
    headerContent = (
      <>
        <span>工具結果 (tool_result)</span>
        {shortId && (
          <span
            style={{ marginLeft: '8px', color: 'var(--text-muted)', fontSize: '11px' }}
            title={b.tool_use_id && b.tool_use_id.length > 12 ? b.tool_use_id : undefined}
          >
            {`for: ${shortId}`}
          </span>
        )}
      </>
    )
  }

  const isTrunc = b.text.length > TEXT_TRUNC
  const [bodyShowAll, setBodyShowAll] = useState(false)
  const bodyText = bodyShowAll || !isTrunc ? b.text : b.text.slice(0, TEXT_TRUNC) + '\n…[截斷]'

  return (
    <div className={`block collapsible-block block-${kind}${open ? ' collapsible-open' : ''}`}>
      <div className="collapsible-header" onClick={() => setOpen((v) => !v)}>
        <span className="collapsible-chevron">▶</span>
        {headerContent}
      </div>
      <div className="collapsible-body">
        <pre className="json-pretty">{bodyText || '(空)'}</pre>
        {isTrunc && !bodyShowAll && (
          <span className="truncate-more" onClick={() => setBodyShowAll(true)}>
            {`▼ 顯示完整 (${b.text.length.toLocaleString()} 字元)`}
          </span>
        )}
      </div>
    </div>
  )
}

/** 依 b.kind 分流四型（對應 app.html renderContentBlock 分派）。
 *  結構 / class 照 app.html：block-text / block-thinking / block-tool-use / block-tool-result。 */
export function ContentBlockView({ b }: { b: ConvBlock }): React.JSX.Element {
  if (b.kind === 'text') return <TextBlockView text={b.text} />
  if (b.kind === 'thinking') return <CollapsibleBlockView kind="thinking" b={b} />
  if (b.kind === 'tool_use') return <CollapsibleBlockView kind="tool-use" b={b} />
  // tool_result
  return <CollapsibleBlockView kind="tool-result" b={b} />
}
