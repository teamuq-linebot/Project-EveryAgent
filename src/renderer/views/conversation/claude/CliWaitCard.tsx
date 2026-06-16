import React, { useEffect, useState } from 'react'
import type { PromptAlertPayload } from '../../../../shared/ipcContracts'

interface Props {
  sessionId: string
  /** 點「展開 CLI」→ 展開終端機抽屜（由 ConversationPanel 注入）。 */
  onExpandCli?: () => void
}

interface CardState {
  state: 'waiting' | 'error'
  reason: string
  options?: { value: string; label: string }[]
  /** CLI 正在問的問題/標題（選項上方文字） */
  prompt?: string
  sentValue?: string
}

/**
 * CliWaitCard — 內嵌於對話輸入區上方的 CLI 等待/錯誤提示卡。
 * 訂閱 window.tuq.onPromptAlert，只理此 session 的事件。
 * resolved → 清空；waiting/error → 顯示卡。
 *
 * 說明：claude 的選單是全螢幕 TUI（以游標定位排版），原始 byte stream 無法穩定還原成
 * 乾淨的選項文字，故多數情況解析不到可點選項。此時改提供「展開 CLI」讓使用者直接到終端
 * 機回答（claude TUI 在終端機才正常）。只有當選項能乾淨解析（如一般 shell `1) foo` 選單）
 * 才額外顯示快捷選項按鈕。
 */
export default function CliWaitCard({ sessionId, onExpandCli }: Props): React.JSX.Element | null {
  const [card, setCard] = useState<CardState | null>(null)

  useEffect(() => {
    const unsub = window.tuq.onPromptAlert((payload: PromptAlertPayload) => {
      if (payload.sessionId !== sessionId) return

      if (payload.state === 'resolved') {
        setCard(null)
        return
      }

      setCard({
        state: payload.state,
        reason: payload.reason,
        options: payload.options,
        prompt: payload.prompt,
      })
    })
    return unsub
  }, [sessionId])

  if (!card) return null

  const icon = card.state === 'error' ? '⚠' : '⏸'
  const hasSent = card.sentValue !== undefined
  const hasOptions = !!card.options && card.options.length > 0
  // 對使用者顯示友善訊息（不暴露 menu_digit / yn_prompt 等內部規則名）。
  const message =
    card.state === 'error'
      ? 'CLI 發生錯誤——請展開 CLI 查看與處理'
      : hasOptions
        ? 'CLI 正在等待你的選擇——點下方選項即可回應'
        : 'CLI 正在等待你的回應——請展開 CLI 操作'

  function markSent(value: string): void {
    setCard((prev) => (prev ? { ...prev, sentValue: value } : prev))
  }

  return (
    <div className={`cli-wait-card cli-wait-card--${card.state}`}>
      <div className="cli-wait-card__row">
        <span className="cli-wait-card__icon">{icon}</span>
        <span className="cli-wait-card__reason">{message}</span>
        {onExpandCli && (
          <button
            className="cli-wait-card__expand"
            onClick={onExpandCli}
            title="展開 CLI 終端機以回應"
          >
            展開 CLI
          </button>
        )}
      </div>
      {card.prompt && (
        <div className="cli-wait-card__prompt">{card.prompt}</div>
      )}
      {hasOptions && (
        <div className="cli-wait-card__opts">
          {card.options?.map((opt) => (
            <button
              key={opt.value}
              className="prompt-toast__opt-btn"
              disabled={hasSent}
              onClick={() => {
                if (hasSent) return
                window.tuq.pty.write(sessionId, opt.value)
                setTimeout(() => {
                  window.tuq.pty.write(sessionId, '\r')
                }, 150)
                markSent(opt.value)
              }}
            >
              {hasSent && card.sentValue === opt.value ? `已送出 ${opt.value}` : `${opt.value}. ${opt.label}`}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
