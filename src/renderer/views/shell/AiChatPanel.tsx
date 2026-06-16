import React, { useCallback, useRef, useState } from 'react'
import type { ProjectConfigDraft } from '../../../shared/ipcContracts'

/**
 * AiChatPanel — 右側 AI 對話欄（純本地版）。
 *
 * 雲端 LLM draft 功能已移除（platformConfig / projectConfig channel 不存在）。
 * 保留 UI 骨架；送出時回傳「功能尚未就緒」提示。
 */

type ChatRole = 'user' | 'assistant'

interface ChatEntry {
  role: ChatRole
  text: string
  projectDraft?: ProjectConfigDraft | null
}

type ProjectProps = {
  scope: 'project'
  onApply?: (draft: ProjectConfigDraft) => void
}

type PlatformProps = {
  scope: 'platform'
  onApply?: (draft: Record<string, unknown>) => void
}

type Props = (ProjectProps | PlatformProps) & {
  placeholder?: string
  greeting?: string
}

export default function AiChatPanel(props: Props): React.JSX.Element {
  const { placeholder, greeting } = props
  const [entries, setEntries] = useState<ChatEntry[]>(
    greeting ? [{ role: 'assistant', text: greeting }] : [],
  )
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    if (el) requestAnimationFrame(() => (el.scrollTop = el.scrollHeight))
  }, [])

  const append = useCallback(
    (entry: ChatEntry) => {
      setEntries((prev) => [...prev, entry])
      scrollToBottom()
    },
    [scrollToBottom],
  )

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    append({ role: 'user', text })
    setInput('')
    setBusy(true)
    try {
      // AI draft 後端已移除（無 LLM 整合）。
      append({
        role: 'assistant',
        text: 'AI 草稿功能目前不可用（後端尚未接線）。',
      })
    } finally {
      setBusy(false)
    }
  }, [input, busy, append])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

  const onApplyProject =
    props.scope === 'project' ? props.onApply : undefined

  return (
    <div className="ai-chat-panel">
      <div className="ai-chat-panel__list" ref={listRef}>
        {entries.length === 0 && (
          <div className="ai-chat-panel__empty">
            以自然語言描述需求，AI 會產出草稿。安全閘：AI 只產草稿，不直接寫入、不連線、不碰機密。
          </div>
        )}
        {entries.map((entry, i) => (
          <div
            key={i}
            className={`ai-chat-panel__msg ai-chat-panel__msg--${entry.role}`}
          >
            <div className="ai-chat-panel__bubble">{entry.text}</div>

            {entry.projectDraft && (
              <div className="ai-chat-panel__draft">
                <dl className="ai-chat-panel__draft-fields">
                  <dt>專案名稱</dt>
                  <dd>{entry.projectDraft.projectName}</dd>
                  <dt>里程碑</dt>
                  <dd>
                    {entry.projectDraft.milestones.length === 0 ? (
                      '（無）'
                    ) : (
                      <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
                        {entry.projectDraft.milestones.map((m, j) => (
                          <li key={j}>{m.name}</li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </dl>
                {entry.projectDraft.rationale && (
                  <p className="ai-chat-panel__draft-note">{entry.projectDraft.rationale}</p>
                )}
                {onApplyProject && (
                  <button
                    className="settings-form__btn settings-form__btn--primary"
                    onClick={() => onApplyProject(entry.projectDraft as ProjectConfigDraft)}
                  >
                    套用到左側表單
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ai-chat-panel__input-row">
        <textarea
          className="ai-chat-panel__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={placeholder ?? '描述需求（Enter 送出，Shift+Enter 換行）…'}
          disabled={busy}
        />
        <button
          className="settings-form__btn settings-form__btn--primary"
          onClick={() => void handleSend()}
          disabled={busy || !input.trim()}
        >
          {busy ? '產生中…' : '送出'}
        </button>
      </div>
    </div>
  )
}
