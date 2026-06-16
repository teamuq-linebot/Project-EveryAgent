import React, { useCallback, useRef, useState } from 'react'

/**
 * AiChatShell — 三個頁面（監測任務 / 專案管理 / 平台設定）的共通版面語言：
 * **「左主內容 + 右 AI 對話欄」**（plan_v1 §12 統一版面語言）。
 *
 * 版面結構刻意對齊監測任務頁 SessionTab 的左右分欄（`session-tab__upper` /
 * `session-tab__conversation-pane` / `session-tab__conv-resizer`）：
 *   - 左：呼叫端傳入的 `main` 主內容（清單 + 明細表單）。
 *   - 右：可收合的 AI 對話欄（`chat`，通常為 <AiChatPanel/>）；拖左緣 resizer 調寬。
 *
 * 復用既有 session-tab CSS（global.css），不新增樣式類別 —— 與監測任務頁同款外觀。
 */

interface Props {
  /** 頁面標題（顯示於主內容上方）。 */
  title: string
  /** 左主內容（清單 + 明細表單）。 */
  main: React.ReactNode
  /** 右側 AI 對話欄內容（通常 <AiChatPanel/>，走 D22 草稿→預覽→套用安全閘）。 */
  chat: React.ReactNode
}

export default function AiChatShell({ title, main, chat }: Props): React.JSX.Element {
  const [chatExpanded, setChatExpanded] = useState(true)
  // 對話欄寬度（px）；null = 預設 38%（同 SessionTab）。拖左緣 resizer 調整。
  const [chatWidth, setChatWidth] = useState<number | null>(null)
  const chatPaneRef = useRef<HTMLDivElement>(null)

  // 拖曳對話欄左緣調整寬度（往左拉變寬；280px ～ 視窗 70%），同 SessionTab.onConvResizeStart。
  const onResizeStart = useCallback((e: React.MouseEvent) => {
    const pane = chatPaneRef.current
    if (!pane) return
    e.preventDefault()
    const startX = e.clientX
    const startW = pane.offsetWidth
    const onMove = (ev: MouseEvent): void => {
      const w = Math.min(
        Math.max(startW + (startX - ev.clientX), 280),
        Math.floor(window.innerWidth * 0.7),
      )
      setChatWidth(w)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

  return (
    <div className="session-tab ai-chat-shell">
      <div className="session-tab__identity">
        <span className="session-tab__task-name">{title}</span>
      </div>
      <div className="session-tab__active">
        <div className="session-tab__upper">
          <div className="ai-chat-shell__main">{main}</div>
          {chatExpanded ? (
            <>
              <div
                className="session-tab__conv-resizer"
                onMouseDown={onResizeStart}
                title="拖曳調整 AI 對話欄寬度"
              />
              <div
                className="session-tab__conversation-pane ai-chat-shell__chat"
                ref={chatPaneRef}
                style={chatWidth !== null ? { flex: `0 0 ${chatWidth}px` } : undefined}
              >
                <div className="ai-chat-shell__chat-inner">
                  <div className="ai-chat-shell__chat-header">
                    <span className="conversation-panel__title">AI 對話</span>
                    <button
                      className="conversation-panel__collapse"
                      onClick={() => setChatExpanded(false)}
                      title="收合 AI 對話欄"
                    >
                      收合 ▸
                    </button>
                  </div>
                  <div className="ai-chat-shell__chat-body">{chat}</div>
                </div>
              </div>
            </>
          ) : (
            <button
              className="session-tab__conv-expand"
              onClick={() => setChatExpanded(true)}
              title="展開 AI 對話欄"
            >
              ◂ AI 對話
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
