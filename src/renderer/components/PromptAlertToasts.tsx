import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PromptAlertPayload } from '../../shared/ipcContracts'

interface ToastEntry {
  sessionId: string
  taskId: string
  state: 'waiting' | 'error'
  reason: string
  options?: { value: string; label: string }[]
  /** 已送出的選項值；定義時 disable 全部按鈕 */
  sentValue?: string
}

interface Props {
  /** sessionId → 顯示名稱查表；查不到顯示 sessionId 前 8 碼 */
  resolveName: (sessionId: string) => string
  /** 點 toast 本體 → 跳到該 session 分頁 */
  onJump: (sessionId: string) => void
  /**
   * 當前活躍的 session id（或固定 tab 值如 'kanban'）。
   * alert 進來時若 payload.sessionId === activeSessionId，不新增 toast
   * （使用者已在該分頁，內嵌 CliWaitCard 已覆蓋）。
   */
  activeSessionId?: string | null
}

export default function PromptAlertToasts({ resolveName, onJump, activeSessionId }: Props): React.JSX.Element | null {
  const [toasts, setToasts] = useState<Map<string, ToastEntry>>(new Map())

  function removeToast(sessionId: string): void {
    setToasts((prev) => {
      const next = new Map(prev)
      next.delete(sessionId)
      return next
    })
  }

  useEffect(() => {
    const unsub = window.tuq.onPromptAlert((payload: PromptAlertPayload) => {
      const { sessionId, taskId, state, reason } = payload

      if (state === 'resolved') {
        // 狀態解除 → 移除該 session 的 toast
        setToasts((prev) => {
          const next = new Map(prev)
          next.delete(sessionId)
          return next
        })
        return
      }

      // 使用者已在該 session 分頁 → 內嵌 CliWaitCard 已覆蓋，不新增 toast
      if (sessionId === activeSessionId) return

      setToasts((prev) => {
        const next = new Map(prev)
        next.set(sessionId, { sessionId, taskId, state, reason, options: payload.options })
        return next
      })
    })
    return unsub
  }, [activeSessionId])

  function markSent(sessionId: string, value: string): void {
    setToasts((prev) => {
      const next = new Map(prev)
      const entry = next.get(sessionId)
      if (entry) next.set(sessionId, { ...entry, sentValue: value })
      return next
    })
  }

  const entries = Array.from(toasts.values())
  if (entries.length === 0) return null

  return createPortal(
    <div className="prompt-toast-stack">
      {entries.map((t) => {
        const icon = t.state === 'error' ? '⚠' : '⏸'
        const name = resolveName(t.sessionId) || t.sessionId.slice(0, 8)
        const hasSent = t.sentValue !== undefined
        return (
          <div
            key={t.sessionId}
            className={`prompt-toast prompt-toast--${t.state}`}
            onClick={() => {
              onJump(t.sessionId)
              // 不移除 toast：使用者可能只是跳過去看，✕ 或 resolved 才清除
            }}
          >
            <span className="prompt-toast__icon">{icon}</span>
            <span className="prompt-toast__name">{name}</span>
            <span className="prompt-toast__reason">
              {hasSent ? `已送出 ${t.sentValue}` : t.reason}
            </span>
            <button
              className="prompt-toast__close"
              onClick={(e) => {
                e.stopPropagation()
                removeToast(t.sessionId)
              }}
              title="關閉"
            >
              ✕
            </button>
            {t.options && t.options.length > 0 && (
              <div
                className="prompt-toast__opts"
                onClick={(e) => e.stopPropagation()}
              >
                {t.options.map((opt) => (
                  <button
                    key={opt.value}
                    className="prompt-toast__opt-btn"
                    disabled={hasSent}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (hasSent) return
                      window.tuq.pty.write(t.sessionId, opt.value)
                      setTimeout(() => {
                        window.tuq.pty.write(t.sessionId, '\r')
                      }, 150)
                      markSent(t.sessionId, opt.value)
                    }}
                  >
                    {opt.value}. {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
