import { z } from "zod";

export const SESSION_CHANNELS = {
  OPEN: "session:open",
  CLOSE: "session:close",
  /**
   * 列出 main 端「實際存在」的所有 session（含 app 重啟 headless recoverMonitoring
   * 恢復的）。renderer 啟動時據此 hydrate tab，使「card 閃 / 監測列表 / backend 監測集合」
   * 三者一致（fix: 監測中 card 閃數 ≠ 監測列表數）。
   */
  LIST_ACTIVE: "session:listActive",
  LIST_SESSIONS: "session:listSessions",
  RENAME: "session:rename",
  GET_CONVERSATION: "session:getConversation",
  SET_PROJECT: "session:setProject",
  LIST_SKILLS: "session:listSkills",
  GET_SUBAGENT_CONVERSATION: "session:getSubagentConversation",
  /** workflow 子代理完整逐字稿（進度卡展開 agent → 載入完整內容用）。 */
  GET_WORKFLOW_AGENT_CONVERSATION: "session:getWorkflowAgentConversation",
  GET_CONVERSATION_WINDOW: "session:getConversationWindow",
  GET_SEGMENTS: "session:getSegments",
  GET_SEGMENT_MESSAGES: "session:getSegmentMessages",
  /** Raw JSONL 行取回（Raw 模式按需使用；不塞進常規 getConversation payload）。 */
  GET_RAW_LINES: "session:getRawLines",
} as const;

export const SessionOpenSchema = z.object({
  taskId: z.string().min(1),
  /** project root for the PTY working directory */
  projectPath: z.string().optional(),
  /** milestone id for assigneeId resolution */
  milestoneId: z.string().nullish(),
  /** tool hint (claude / codex / vscode / custom) */
  tool: z.string().optional(),
  /** explicit custom launch command */
  customCommand: z.string().nullish(),
  /**
   * 強制開一條全新 session（不沿用 active 綁定、也不 resume 同資料夾最新 session）。
   * 「開始團隊對話」走此路：要把 /tuq-agent <任務> 注入一條乾淨對話，而非接到資料夾舊對話。
   */
  forceNewSession: z.boolean().optional(),
});
export type SessionOpenPayload = z.infer<typeof SessionOpenSchema>;

export const SessionCloseSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionClosePayload = z.infer<typeof SessionCloseSchema>;

export const SessionListSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionListPayload = z.infer<typeof SessionListSchema>;

export const SessionRenameSchema = z.object({
  sessionId: z.string().min(1),
  customTitle: z.string().min(1),
});
export type SessionRenamePayload = z.infer<typeof SessionRenameSchema>;

export const SessionGetConversationSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionGetConversationPayload = z.infer<
  typeof SessionGetConversationSchema
>;

export const SessionSetProjectSchema = z.object({
  sessionId: z.string().min(1),
  projectPath: z.string(),
  tool: z.string().optional(),
});
export type SessionSetProjectPayload = z.infer<typeof SessionSetProjectSchema>;

/** session:setProject 回傳：更新後的路徑/工具 + 重解析的監測對象/啟動指令。 */
export interface SessionProjectResult {
  ok: boolean;
  projectPath: string;
  tool: string;
  claudeSessionId: string | null;
  launchCommand: string | null;
}

export const SessionListSkillsSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionListSkillsPayload = z.infer<typeof SessionListSkillsSchema>;

/** session:getSubagentConversation 請求 payload schema。 */
export const SessionGetSubagentConversationSchema = z.object({
  sessionId: z.string().min(1),
  toolUseId: z.string().min(1),
});
export type SessionGetSubagentConversationPayload = z.infer<
  typeof SessionGetSubagentConversationSchema
>;

/** session:getWorkflowAgentConversation 請求 payload schema。 */
export const SessionGetWorkflowAgentConversationSchema = z.object({
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  agentId: z.string().min(1),
});
export type SessionGetWorkflowAgentConversationPayload = z.infer<
  typeof SessionGetWorkflowAgentConversationSchema
>;

/** session:getConversationWindow 請求 payload schema。 */
export const SessionGetConversationWindowSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionGetConversationWindowPayload = z.infer<
  typeof SessionGetConversationWindowSchema
>;

/** session:getSegments 請求 payload schema。 */
export const SessionGetSegmentsSchema = z.object({
  sessionId: z.string().min(1),
});
export type SessionGetSegmentsPayload = z.infer<
  typeof SessionGetSegmentsSchema
>;

/** session:getSegmentMessages 請求 payload schema。 */
export const SessionGetSegmentMessagesSchema = z.object({
  sessionId: z.string().min(1),
  startSeq: z.number().int().min(0),
  endSeq: z.number().int().min(0),
});
export type SessionGetSegmentMessagesPayload = z.infer<
  typeof SessionGetSegmentMessagesSchema
>;

/** session:getRawLines 請求 payload schema。 */
export const SessionGetRawLinesSchema = z.object({
  sessionId: z.string().min(1),
  startSeq: z.number().int().min(0),
  endSeq: z.number().int().min(0),
});
export type SessionGetRawLinesPayload = z.infer<
  typeof SessionGetRawLinesSchema
>;

/**
 * session:getRawLines 回傳結果。
 * ok=false 表示非 claude / 無 claudeSessionId / 無 projectPath / 讀檔失敗。
 * truncated=true 表示超過 cap（500 行或 2MB），已截斷並顯示提示。
 */
export interface RawLinesResult {
  ok: boolean;
  /** 原始 JSONL record 字串陣列（每條一行，已去除尾端 '\n'）。 */
  lines: string[];
  /** 是否因超出 cap 被截斷。 */
  truncated: boolean;
}

/**
 * session:getSubagentConversation 回傳結果。
 * ok=false 表示找不到 subagent（非 claude / 無 claudeSessionId / 無對應 meta / JSONL 不存在）。
 * ok=true 時 agentId / agentType / description 來自 meta.json；messages 為 subagent 對話訊息。
 */
export interface SubagentConversationResult {
  ok: boolean;
  /** subagent 識別碼（meta.json 中 "agent-<agentId>" 去前綴後的部分）；找不到時 null */
  agentId: string | null;
  /** meta.json 的 agentType（如 "researcher"）；無此欄或找不到時 null */
  agentType: string | null;
  /** meta.json 的 description；無此欄或找不到時 null */
  description: string | null;
  /** subagent transcript 的對話訊息列表；找不到時為空陣列 */
  messages: ConversationMessage[];
}

/**
 * 段落索引一列（鏡像 conversationStore.ts SegmentRow，不含 file 欄）。
 * 每段代表一輪使用者輸入至 AI 回應的完整對話段落。
 */
export interface SegmentInfo {
  /** 段落序號（從 0 起算） */
  seg_no: number;
  /** 段落起始訊息的 seq（含） */
  start_seq: number;
  /** 段落結束訊息的 seq（含） */
  end_seq: number;
  /** 段落起始時間戳（ISO 字串；無則空字串） */
  start_ts: string;
  /** 段落結束時間戳（ISO 字串；無則空字串） */
  end_ts: string;
  /** 段落標籤（使用者輸入前 30 字 / 指令名稱；純壓縮預覽，不含語意前綴） */
  label: string;
  /** 是否為 /command 段落（1=是，0=否） */
  is_command: number;
  /** 本段落訊息總筆數 */
  msg_count: number;
  /**
   * 開段訊息的語意型別（v12）：取代舊 label 前綴嗅探（'🔔 '）。
   *   - 'typed'   = 使用者手動輸入
   *   - 'command' = /slash 指令
   *   - 'notify'  = promptSource=system 的 harness 注入通知
   *   - 'other'   = assistant/system 等其他開段（純結尾驅動下皆可開段）
   */
  head_kind: "typed" | "command" | "notify" | "other";
}

/**
 * session:getConversationWindow 回傳結果。
 * ok=false 表示非 claude / 無 claudeSessionId / 檔案解析失敗。
 */
export interface ConversationWindowResult {
  ok: boolean;
  /** 本次窗口的訊息列表 */
  messages: ConversationMessage[];
  /** 窗口起始 seq（含） */
  startSeq: number;
  /** 目前訊息總筆數（next_seq） */
  totalCount: number;
}

/**
 * session:getSegments 回傳結果。
 * ok=false 表示非 claude / 無 claudeSessionId / 檔案解析失敗。
 */
export interface SegmentListResult {
  ok: boolean;
  /** 段落索引列表 */
  segments: SegmentInfo[];
  /** 目前訊息總筆數（next_seq） */
  totalCount: number;
}

/** 一個可用的 slash command（skill）。掃描 ~/.claude/skills + <project>/.claude/skills。 */
export interface SkillItem {
  /** 指令名（目錄名）；輸入時前置 `/`，如 `tuq-dev` → `/tuq-dev` */
  name: string;
  /** SKILL.md frontmatter description（無則 null；下拉 tooltip 用） */
  description: string | null;
  /** agent_registry 查表得到的中文顯示名（無對應 → null；向後相容，老資料無此欄時為 null）。 */
  displayName?: string | null;
}

/** 一則訊息的內容區塊（對應 jsonl-viewer 的 block 分類）。 */
export interface ConvBlock {
  kind: "text" | "thinking" | "tool_use" | "tool_result";
  /** text/thinking/tool_result 的文字；tool_use 為其 input 的 JSON 字串 */
  text: string;
  /** 工具名稱（kind==='tool_use'） */
  name?: string;
  /**
   * tool_use block 的原始 id（來自 JSONL content block 的 `id` 欄位）。
   * 用途：與 subagent meta.json 的 `toolUseId` 比對，定位對應的 subagent transcript。
   * 僅 kind==='tool_use' 時有值；其他 kind 不設此欄。
   */
  id?: string;
  /**
   * tool_result 對應的 tool_use block id（來自 JSONL content block 的 `tool_use_id` 欄位）。
   * 用途：app.html 的 `for:` 標示，顯示此筆結果屬於哪次工具呼叫。
   * 僅 kind==='tool_result' 時有值；其他 kind 不設此欄。
   */
  tool_use_id?: string;
  /**
   * 派遣 tool_result 的 toolUseResult 統計（來自 JSONL record 頂層 toolUseResult 物件）。
   * 收合態顯示 subagent 總 token 量用。
   * 僅 kind==='tool_result' 且 toolUseResult 含 agentId 時有值。
   * - totalTokens：本次 subagent 合計 token 數（totalTokens 欄位）
   * - input / output：usage.input_tokens / usage.output_tokens（細項）
   * - durationMs：totalDurationMs（執行時長毫秒）
   */
  subagentStats?: {
    totalTokens?: number;
    input?: number;
    output?: number;
    durationMs?: number;
  };
}

/**
 * 一則 session 對話訊息（給 session chat pane 用，顯示方式參考 jsonl-viewer）。
 * 含內容區塊（text / thinking / tool_use / tool_result）+ user 來源徽章。
 */
export interface ConversationMessage {
  /** 顯示側：tool_result 雖在 JSONL 為 user role，顯示歸 assistant（AI 工作流一部分）；
   *  system = JSONL system/turn_duration 記錄，UI 渲染 turn 結束分隔線用 */
  role: "user" | "assistant" | "system";
  /** 來源徽章：typed/command/meta（user）；tool_result（顯示為 assistant + 此徽章）；
   *  interrupt = 頂層含 interruptedMessageId 的 Esc 中斷記錄；
   *  notify = promptSource=system 的 harness 注入訊息（如背景任務完成通知） */
  source?:
    | "typed"
    | "command"
    | "tool_result"
    | "meta"
    | "interrupt"
    | "notify";
  timestamp?: string;
  blocks: ConvBlock[];
  /** token 用量，assistant 記錄才有；UI token 徽章用 */
  usage?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheCreate?: number;
  };
  /** system/turn_duration 記錄，UI 渲染 turn 結束分隔線用；role==='system' 時出現 */
  turnDuration?: { durationMs: number; messageCount?: number };
  /** assistant record 的 message.stop_reason；'stop_sequence' = 靜默結束，結尾偵測用 */
  stopReason?: string;
  /** assistant 的 message.model === '<synthetic>'；關窗重連時系統注入的「No response requested.」 */
  synthetic?: boolean;
}

/** Session info returned from session:open. */
export interface SessionInfo {
  sessionId: string;
  taskId: string;
  /**
   * 任務顯示名稱（backend 查 repo 填入；查不到時 fallback = taskId）。
   * renderer hydrate 直接用此欄，不再依賴看板 tasks 時序。
   */
  taskName: string;
  /** Resolved project path (from milestone config). Empty string if not configured. */
  projectPath: string;
  /** Milestone id associated with the task. Null if unknown. */
  milestoneId: string | null;
  /** 工具（claude / codex / vscode / custom）。預設 claude。 */
  tool: string;
  /** 終端機開啟時要注入的啟動指令（如 `claude --resume <uuid>`）；null=不注入。 */
  launchCommand: string | null;
  /** 被監測/resume 的真實 claude session uuid（非合成 tab id）；null=非 claude 或無。 */
  claudeSessionId: string | null;
  /** openSession 時 binding 路徑失效、由 JSONL cwd 反解修正時為 true。 */
  pathAutofixed?: boolean;
}
