import { z } from "zod";
import type { ConversationMessage } from "./session";

/**
 * AgentTeams 專屬對話通道（agentteams-embedded-conversation；plan_v2_fromscratch §3）。
 * 與 session 子系統「完全平行」：不沿用 pty:* / session:*，由 main 端
 * AgentConversationService 自管一條 claude PTY + 自 tail JSONL，推結構化卡片訊息給 renderer。
 *   OPEN/INPUT/CLOSE — renderer→main invoke
 *   MESSAGES        — main→renderer push（tail JSONL 出的全量卡片訊息）
 */
export const AGENT_CONV_CHANNELS = {
  OPEN: "agentConv:open",
  INPUT: "agentConv:input",
  RESIZE: "agentConv:resize",
  CLOSE: "agentConv:close",
  /** renderer→main invoke：永久從清單移除一條對話（DB 標 status='closed'，重啟不再顯示）。 */
  HIDE: "agentConv:hide",
  MESSAGES: "agentConv:messages",
  /** main→renderer push：PTY 原始輸出（含 ANSI），供終端模式即時串流顯示。 */
  RAW: "agentConv:raw",
  /**
   * main→renderer push：PTY 偵測到互動提問（idle 靜止 1500ms 後命中 PROMPT_PATTERNS）。
   * options 有值=waiting；options=null=提問解除（claude 繼續輸出）。
   */
  PROMPT_STATE: "agentConv:promptState",
  /** renderer→main invoke：取本條對話 PTY 原始輸出緩衝（供 AgentTermView 掛載時補齊早期輸出）。 */
  BUFFER: "agentConv:buffer",
  LIST_SESSIONS: "agentConv:listSessions",
  GET_CONVERSATION_WINDOW: "agentConv:getConversationWindow",
  GET_SEGMENTS: "agentConv:getSegments",
  GET_SEGMENT_MESSAGES: "agentConv:getSegmentMessages",
} as const;

/**
 * agentConv:open — 開一條 AgentTeams 對話（invoke renderer→main，回 { conversationId }）。
 * launchCommand 不由 renderer 傳：main handler 內以 `claude --session-id <conversationId>`
 * 組裝，避免 renderer 注入任意指令。
 */
export const AgentConvOpenSchema = z.object({
  /**
   * renderer 自取 uuid（同時是 claude --session-id 與其 JSONL 檔名）。
   * uuid() 驗證是安全邊界：conversationId 會被拼進 `claude --session-id <id>` 寫入裸 shell PTY，
   * 限定 RFC 4122 格式即堵死 shell 元字元 / 換行的命令注入面（renderer 以 crypto.randomUUID() 自取，合法）。
   */
  conversationId: z.string().uuid(),
  /** PTY cwd + JSONL 定檔來源（agentOrgRoot）。 */
  cwd: z.string().min(1),
  /** 啟動後第二段注入的指令（如 `/tuq-agent`）；省略/null=不注入。 */
  initialPrompt: z.string().nullish(),
  /** UI 顯示名稱；main 端會存入 teamuq.db 供重啟還原側欄。 */
  label: z.string().optional(),
  /** 開啟方指定的裸 skill name（不含 / 或 $）；供 DB 還原輸入框預設。 */
  initialSkill: z.string().nullish(),
  /** true=開新前先關閉既有那條（保證任一時刻最多一條）。 */
  forceNew: z.boolean().optional(),
  /** 使用的 AI CLI 後端；預設 claude。省略時 handler 以 'claude' 補。 */
  cliId: z.enum(['claude', 'codex', 'antigravity']).optional(),
  /**
   * true=以 resume 模式續接既有 session（`claude --resume <conversationId>`，保留 context、
   * 不重送 initialPrompt）。省略/false=開新 session（`claude --session-id <conversationId>`）。
   * 目前僅 claude 支援；非 claude 時忽略此旗標。
   */
  resume: z.boolean().optional(),
});
export type AgentConvOpenPayload = z.infer<typeof AgentConvOpenSchema>;

/** agentConv:input — 送使用者輸入到 PTY stdin（invoke）。text 不含結尾 \r（服務補）。 */
export const AgentConvInputSchema = z.object({
  conversationId: z.string().uuid(),
  text: z.string(),
});
export type AgentConvInputPayload = z.infer<typeof AgentConvInputSchema>;

export const AgentConvResizeSchema = z.object({
  conversationId: z.string().uuid(),
  cols: z.number().int().min(1),
  rows: z.number().int().min(1),
});
export type AgentConvResizePayload = z.infer<typeof AgentConvResizeSchema>;

/** agentConv:close — 關一條（kill PTY + 清 timer + 停 tail）（invoke）。 */
export const AgentConvCloseSchema = z.object({
  conversationId: z.string().uuid(),
});
export type AgentConvClosePayload = z.infer<typeof AgentConvCloseSchema>;

/**
 * agentConv:hide — 永久從清單移除一條對話（X 鈕）。
 * DB 標 status='closed'，listSessions 不再回傳 → 重啟後不再顯示（一次性對話語意）。
 * 若該條仍活著（防呆）也會一併 close PTY。
 */
export const AgentConvHideSchema = z.object({
  conversationId: z.string().uuid(),
});
export type AgentConvHidePayload = z.infer<typeof AgentConvHideSchema>;

export const AgentConvGetConversationWindowSchema = z.object({
  conversationId: z.string().uuid(),
});
export type AgentConvGetConversationWindowPayload = z.infer<
  typeof AgentConvGetConversationWindowSchema
>;

export const AgentConvGetSegmentsSchema = z.object({
  conversationId: z.string().uuid(),
});
export type AgentConvGetSegmentsPayload = z.infer<typeof AgentConvGetSegmentsSchema>;

export const AgentConvGetSegmentMessagesSchema = z.object({
  conversationId: z.string().uuid(),
  startSeq: z.number().int().min(0),
  endSeq: z.number().int().min(0),
});
export type AgentConvGetSegmentMessagesPayload = z.infer<
  typeof AgentConvGetSegmentMessagesSchema
>;

export interface AgentConvSessionDto {
  conversationId: string;
  label: string;
  cliId: 'claude' | 'codex' | 'antigravity';
  cwd: string;
  initialPrompt: string | null;
  initialSkill: string | null;
  status: 'running' | 'done' | 'closed';
  createdAt: string;
  updatedAt: string;
}

/**
 * agentConv:messages — tail JSONL 出的本條對話全量卡片訊息（push main→renderer，非 invoke）。
 * 每次推送都是該 conversation「目前全部可顯示訊息」的全量快照（renderer 直接 render）。
 */
export interface AgentConvMessagesPayload {
  /** 對應 agentConv:open 的 conversationId（renderer 以此過濾非當前對話的推送）。 */
  conversationId: string;
  /** 本條 conversation 目前全部可顯示訊息（已濾 null；thinking block 由 renderer 不畫）。 */
  messages: ConversationMessage[];
  /** JSONL 尚未出現（claude 啟動中 / 尚未首次寫檔）→ true，UI 顯示「啟動中…」。 */
  pending: boolean;
  /** PTY 已結束（claude 退出）→ true，UI 標「對話已結束」。 */
  done: boolean;
  /**
   * PTY 正在輸出（claude 處理中）→ true。
   * 依據：PTY onData 有輸出後 busy=true；靜默 1500ms 後 debounce 歸 false；PTY 結束也歸 false。
   * UI 顯示「處理中」/「輸入中」指示器。
   */
  busy: boolean;
}

/**
 * agentConv:promptState — PTY 互動提問偵測推播（push main→renderer，非 invoke）。
 * options 非 null = claude 正在等待使用者選擇（含已解析的選單選項）。
 * options = null = 提問解除（claude 新輸出到來，已恢復 active）。
 * 選項形狀對齊既有 PromptAlertPayload.options：{ value: string; label: string }[]
 */
export interface AgentConvPromptStatePayload {
  /** 對應 agentConv:open 的 conversationId。 */
  conversationId: string;
  /** waiting 時從 PTY 尾段解析的選單選項（value=數字字串、label=顯示文字）；提問解除時為 null。 */
  options: Array<{ value: string; label: string }> | null;
}

/**
 * agentConv:raw — PTY 原始輸出串流（push main→renderer，非 invoke）。
 * chunk 為 node-pty onData 給的原始字串（含 ANSI escape），原樣推、不解析、不去色——
 * renderer 端 xterm.js 直接 write(chunk) 即可正確渲染。
 */
export interface AgentConvRawPayload {
  /** 對應 agentConv:open 的 conversationId（renderer 以此過濾非當前對話的推送）。 */
  conversationId: string;
  /** PTY onData 給的原始輸出字串（含 ANSI；原樣傳遞）。 */
  chunk: string;
}
