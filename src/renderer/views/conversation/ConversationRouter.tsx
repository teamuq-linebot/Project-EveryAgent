import React from 'react'
import type { CliId } from '../../../shared/cliRegistry'
import type {
  SkillItem,
  CardRunStatePayload,
  WorkflowRunSummary,
} from '../../../shared/ipcContracts'
import ClaudeConversationPanel from './claude/ConversationPanel'

interface ConversationRouterProps {
  /** 當前 session id（傳給 SubagentGroup 做子對話查詢用） */
  sessionId: string
  /** 換綁世代號：每次換綁 +1，觸發 useConversation 全量重置。 */
  convEpoch: number
  /** 可用 skill 指令清單（派遣下拉；選定後送出自動前置 `/<name> `） */
  skills: SkillItem[]
  /** 送出後直接寫進 PTY（由 SessionTab 提供） */
  onSend: (text: string) => void
  /** CLI 是否已啟動（背景 PTY + 啟動指令）；未啟動時顯示「開啟 CLI」按鈕而非輸入框 */
  cliStarted: boolean
  /** 點「開啟 CLI」→ 背景啟動 PTY + claude（終端抽屜不展開） */
  onOpenCli: () => void
  /** CLI 終端抽屜是否展開（展開/收合鈕位於輸入框上方） */
  cliExpanded: boolean
  /** 切換 CLI 終端抽屜展開/收合 */
  onToggleCli: () => void
  /** 收合對話面板（鈕位於 header 最左；收合後由 SessionTab 右緣把手展開） */
  onCollapse: () => void
  /** AskUserQuestion 回答 callback：(toolUseId, 1-based 選項序號, 選項文字) → 寫進 PTY */
  onAnswerAsk?: (toolUseId: string, optionIndex: number, label: string) => void
  /** 派遣下拉初始值（裸 skillName）；團隊 session 預設=隊長。空/未傳=直接對話。 */
  initialTeam?: string
  /** 該 session 實際在跑的 CLI；決定送出時的 skill 前綴。未傳=退回 claude 規則。 */
  cliId?: CliId
  /** 該 session 的執行狀態（card:runState）；running=AI 仍在工作（含中途停頓）→ 顯示「目前動作」指示。 */
  runState?: CardRunStatePayload['state']
  /** 該 session 目前的 workflow 進度（card:workflowProgress）→ 對話框上方進度卡。空/未傳=不顯示。 */
  workflows?: WorkflowRunSummary[]
  /** 目前選定的 AI 模組（工具：claude/codex/vscode/custom）；顯示於對話內容上方的模組列。 */
  tool?: string
  /** 可選的 AI 模組清單（對話內容上方模組下拉的選項）。 */
  toolValues?: readonly string[]
  /** 切換 AI 模組 callback（選擇即套用：重解析啟動指令並重整綁定）。 */
  onToolChange?: (tool: string) => void
}

/**
 * ConversationRouter — 依 cliId 分派至對應的 ConversationPanel 實作。
 *
 * 目前 codex / antigravity 尚未有獨立面板，暫時 fallback 到 ClaudeConversationPanel。
 * 未來新增對應實作時，於各 case 替換即可。
 */
export default function ConversationRouter(props: ConversationRouterProps): React.JSX.Element {
  const { cliId = 'claude', ...rest } = props
  switch (cliId) {
    case 'codex':
    case 'antigravity':
      // 目前 codex/agy 尚未有獨立實作，暫時 fallback 到 Claude 面板
      return <ClaudeConversationPanel {...rest} cliId={cliId} />
    case 'claude':
    default:
      return <ClaudeConversationPanel {...rest} cliId={cliId} />
  }
}
