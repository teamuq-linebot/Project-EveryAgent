import React from 'react'
import type { OpenSession } from '../../hooks/useSession'
import SessionTab from './SessionTab'

interface Props {
  session: OpenSession
  onClose: (sessionId: string) => void
  /** PTY 就緒後自動注入的初始提示（Agent Ops 操作用）；null/空=不注入 */
  initialPrompt?: string | null
  /** 團隊 session 的 agent 下拉預設（裸 skillName）；空=不預選 */
  initialTeam?: string
}

/**
 * SessionTabHost — 動態 session tab 容器（掛載點）。
 * 渲染 SessionTab（終端 + 監測面板）。
 */
export default function SessionTabHost({ session, onClose, initialPrompt, initialTeam }: Props): React.JSX.Element {
  return <SessionTab session={session} onClose={onClose} initialPrompt={initialPrompt} initialTeam={initialTeam} />
}
