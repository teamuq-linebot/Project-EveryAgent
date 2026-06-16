/**
 * AgentConversationPane.tsx — AgentTeams 嵌入式對話面板
 *
 * 職責：顯示一條 AgentTeams conversation 的完整 UI：
 *   - topbar（.at-conv-topbar）：label + cwd 尾段 + ✕ 關閉鈕
 *   - 訊息列（.at-conv-messages）：LegacySegmentGroup 段落卡片 + pending/done 提示
 *   - 輸入框（.at-conv-input）：textarea + 送出；Enter 送出，Shift+Enter 換行
 *
 * 訊息渲染改用 LegacySegmentGroup（buildSegments 推段 + card/tool/thinking 完整渲染），
 * 替換舊的 AgentMessageCard / ToolStepsGroup 手工實作。
 * tool_use 走 Card 工具卡、thinking block 渲染、token 徽章顯示均由 LegacySegmentGroup 處理。
 *
 * Props 由父層（AgentConversationArea → AgentTeamsView）持有 hook、以 props 傳入；
 * 本元件不自行呼叫 useAgentConversation，保持純展示。
 *
 * termExpanded / onToggleTerm 由 AgentTeamsView 管理並 prop-drill 下來；
 * 本元件移除 termHeight/termPaneRef/dragStartY 等舊抽屜實作（提升至 AgentTeamsView）。
 *
 * 本元件完全不 import session 模組（SessionTab / ConversationPanel / useConversation 等）。
 * agentteams-shared-conv-20260611 §step-2
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type {
  AgentTeamCreateSpecInput,
  ConvBlock,
  SegmentInfo,
} from "../../../shared/ipcContracts";
import { useConversationData, type ConversationDataApi } from "../../hooks/useConversation";
import type { AgentConversation } from "../../hooks/useAgentConversation";
import { extractCreateTeamSpec, extractStandardizedTeamIds, humanizeCreateError } from "./createSpecHelpers";
import { extractActiveAskQuestion } from "./askQuestionHelpers";
import { AskQuestionCard } from "./AskQuestionCard";
import {
  SessionIdContext,
  DispatchStatsContext,
  AskAnswersContext,
  AskAnswerCallbackContext,
  ASK_TOOL_NAME,
  fmtDurationMs,
  parseAskAnswers,
} from "../conversation/claude/helpers";
import { SegmentGroup } from "../conversation/claude/SegmentGroup";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  /** 對話 ID，供 AgentTermView 訂閱正確 raw stream。 */
  conversationId: string;
  /** topbar 顯示名稱（如「✨ 建立」/ 「🔍 Audit」）。 */
  label: string;
  /** conversation 的工作目錄（agentOrgRoot）；topbar 截斷顯示。 */
  cwd: string;
  /** JSONL 尚未出現（claude 啟動中）→ true；顯示「等待中…」。 */
  pending: boolean;
  /** PTY 已結束 → true；顯示「已結束」輕標。 */
  done: boolean;
  /** PTY 正在輸出（claude 處理中）→ true；顯示「處理中」跳動指示。 */
  busy: boolean;
  /**
   * claude 互動提問解析出的選單選項（非 null = 等待使用者選擇；null = 無提問）。
   * 卡片模式且 !done 時渲染選項按鈕區。
   */
  promptOptions: Array<{ value: string; label: string }> | null;
  /** 使用者送出輸入文字（父層呼叫 conv.sendInput）。 */
  onSendInput: (text: string) => void;
  /** 關閉面板（父層呼叫 conv.close）。 */
  onClose: () => void;
  /** 點選互動提問選項（父層呼叫 conv.selectOption）。 */
  onSelectOption: (value: string) => void;
  /** 重新開始一次對話（父層重用相同 label+prompt 重開）。 */
  onRestart: () => void;
  /**
   * 繼續對話（claude --resume）：以既有 conversationId 續接同一 session、保留 context。
   * 僅 claude 後端提供；非 claude 時 Pane 不渲染此鈕。
   */
  onResume?: (conversationId: string) => void;
  /** 建立團隊成功後刷新左側 AgentOrg 清單。 */
  onTeamCreated?: () => void;
  /** 目前使用的 CLI 後端（claude / codex / antigravity）；決定 skill 前綴符號。預設 'claude'。 */
  cliId?: string;
  /**
   * 開啟方指定的預設 skill 名稱（不含前綴符號）。
   * 未傳時退回預設值 'tuq-agent'。B10 initialSkill 管線（2026-06-11）。
   */
  initialSkill?: string | null;
  /** 終端抽屜是否展開（由 AgentTeamsView 管理，prop drilling）。 */
  termExpanded: boolean;
  /** 翻轉終端抽屜展開狀態（由 AgentTeamsView 管理）。 */
  onToggleTerm: () => void;
  /**
   * 偵測到的建隊 spec 變化時回拋（含 null），供上層就地長出即時預覽卡（批 1）。
   * 第二參數 conversationId = 本對話 id，供上層綁定「按建團隊時開的那條對話」，
   * 避免切到別條對話時把別條偵測到的 spec 灌進別群的預覽卡（F2 跨對話失配修復）。
   */
  onCreateSpecChange?: (spec: AgentTeamCreateSpecInput | null, conversationId: string) => void;
  /** 偵測到規格化完成 marker 時回拋 teamId，供上層清「待優化」徽章。Batch 2b。 */
  onStandardizedDetected?: (teamId: string) => void;
  /**
   * 偵測到的建隊 spec 之 teamId 已存在於目前 teams → 隱藏底部「偵測到建隊 spec」in-pane 列。
   * 已建完團隊就不再叫使用者建。agentteams-stale-detection-row-20260613。
   */
  specAlreadyCreated?: boolean;
  /**
   * 送出結構化選擇題卡片（AskUserQuestion）回應；通常為 conv.submitAsk。
   * 偵測到 activeAskQuestion 時，AskQuestionCard 的 onSubmit 走此回呼。
   * agentteams-ask-card（批 4）。
   */
  onSubmitAsk?: AgentConversation["submitAsk"];
}

// ---------------------------------------------------------------------------
// 前綴對照表：依 cliId 決定 skill 指令符號
// ---------------------------------------------------------------------------

// agy 支援 /skill-name 語意（~/.gemini/antigravity-cli/skills/ 全域 skills），前綴與 claude 相同。
const CLI_SKILL_PREFIX: Record<string, string> = {
  claude: "/",
  codex: "$",
  antigravity: "/",
};

// ---------------------------------------------------------------------------
// AgentConversationPane
// ---------------------------------------------------------------------------

export function AgentConversationPane({
  conversationId,
  label,
  cwd,
  pending,
  done,
  busy,
  promptOptions,
  onSendInput,
  onClose,
  onSelectOption,
  onRestart,
  onResume,
  onTeamCreated,
  cliId = "claude",
  initialSkill,
  termExpanded,
  onToggleTerm,
  onCreateSpecChange,
  onStandardizedDetected,
  specAlreadyCreated,
  onSubmitAsk,
}: Props): React.JSX.Element {
  // 實際要注入的 skill 名稱：開啟方指定 initialSkill 優先，否則退回 'tuq-agent'。
  // B10 initialSkill 管線（2026-06-11）。
  const effectiveSkill = initialSkill ?? "tuq-agent";
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputText, setInputText] = useState("");
  const [createStatus, setCreateStatus] = useState<string | null>(null);
  const [creatingTeam, setCreatingTeam] = useState(false);

  // 展開全部 / 收合全部 signal（每次 +1 觸發 LegacySegmentGroup 強制開闔）
  const [collapseSignal, setCollapseSignal] = useState(0);
  const [expandSignal, setExpandSignal] = useState(0);

  const conversationApi = useMemo<ConversationDataApi>(
    () => ({
      getWindow: () => window.tuq.agentConv.getConversationWindow(conversationId),
      getSegments: () => window.tuq.agentConv.getSegments(conversationId),
      getSegmentMessages: (startSeq, endSeq) =>
        window.tuq.agentConv.getSegmentMessages(conversationId, startSeq, endSeq),
    }),
    [conversationId],
  );

  const {
    segments: segIndex,
    totalCount,
    getMessagesFor,
    fetchSegment,
    segmentStateOf,
    refresh,
    switching,
    messages: conversationMessages,
  } = useConversationData(conversationId, conversationApi);

  // 新訊息進來時捲到底
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationMessages]);

  useEffect(() => {
    if (!pending) void refresh();
  }, [busy, pending, refresh]);

  const dispatchStatsMap = useMemo(() => {
    const map = new Map<string, NonNullable<ConvBlock["subagentStats"]>>();
    for (const msg of conversationMessages) {
      for (const b of msg.blocks) {
        if (b.kind === "tool_result" && b.tool_use_id && b.subagentStats) {
          map.set(b.tool_use_id, b.subagentStats);
        }
      }
    }
    return map;
  }, [conversationMessages]);

  const askAnswersMap = useMemo(() => {
    const askIds = new Set<string>();
    for (const msg of conversationMessages) {
      for (const b of msg.blocks) {
        if (b.kind === "tool_use" && b.name === ASK_TOOL_NAME && b.id) askIds.add(b.id);
      }
    }
    const map = new Map<string, Record<string, string>>();
    for (const msg of conversationMessages) {
      for (const b of msg.blocks) {
        if (
          b.kind === "tool_result" &&
          b.tool_use_id &&
          askIds.has(b.tool_use_id) &&
          b.text.startsWith("Your questions have been answered:")
        ) {
          map.set(b.tool_use_id, parseAskAnswers(b.text));
        }
      }
    }
    return map;
  }, [conversationMessages]);

  // 已回答的 AskUserQuestion tool_use_id 集合（askAnswersMap 的 key 即 toolUseId）。
  const answeredIds = useMemo(
    () => new Set(askAnswersMap.keys()),
    [askAnswersMap],
  );

  // 目前待回答的結構化選擇題（AskUserQuestion）；無則 null → 退回現有數字按鈕。
  // agentteams-ask-card（批 4）。
  const activeAskQuestion = useMemo(
    () => extractActiveAskQuestion(conversationMessages, answeredIds),
    [conversationMessages, answeredIds],
  );

  const createSpec = useMemo(
    () => extractCreateTeamSpec(conversationMessages),
    [conversationMessages],
  );

  // 把偵測到的 spec（含 null）往上回拋，供上層即時更新群組內預覽卡。
  // agent-teams-live-preview-card-20260613 批 1。
  // 帶上本對話 conversationId，讓上層只認「按建團隊時開的那條對話」的 spec（F2 跨對話失配修復）。
  useEffect(() => {
    onCreateSpecChange?.(createSpec, conversationId);
  }, [createSpec, conversationId, onCreateSpecChange]);

  // 規格化完成 marker 偵測（Batch 2b；F3 多隊）：一條對話可能含多隊 marker，
  // 抽出所有不同 teamId，對每隊各回拋一次供上層清「待優化」徽章（上層 ref 去重「同隊一次」）。
  const standardizedTeamIds = useMemo(
    () => extractStandardizedTeamIds(conversationMessages),
    [conversationMessages],
  );
  useEffect(() => {
    for (const teamId of standardizedTeamIds) onStandardizedDetected?.(teamId);
  }, [standardizedTeamIds, onStandardizedDetected]);

  const handleApplyCreateSpec = useCallback(() => {
    if (!createSpec || creatingTeam) return;
    setCreatingTeam(true);
    setCreateStatus("正在建立團隊、寫入 DB 並同步技能...");
    window.tuq.agentOrg.createTeamFromSpec(createSpec).then((result) => {
      if (!result.ok) {
        setCreateStatus(`建立失敗：${humanizeCreateError(result.error)}`);
        return;
      }
      setCreateStatus(`已建立 ${result.data.teamId}，skill：${result.data.skillName}`);
      onTeamCreated?.();
    }).catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      setCreateStatus(`建立失敗：${message}`);
    }).finally(() => {
      setCreatingTeam(false);
    });
  }, [createSpec, creatingTeam, onTeamCreated]);

  // 送出輸入：自動加 skill 前綴（依 cliId 符號 + effectiveSkill），再補 \r。
  const handleSend = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    const prefix = CLI_SKILL_PREFIX[cliId] ?? "/";
    const prefixed = `${prefix}${effectiveSkill} ${text}`;
    onSendInput(prefixed);
    const enterDelay = Math.max(150, Math.ceil(prefixed.length / 80) * 50);
    setTimeout(() => onSendInput("\r"), enterDelay);
    setInputText("");
  }, [inputText, onSendInput, cliId, effectiveSkill]);

  // Enter 送出 / Shift+Enter 換行
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // cwd 尾段（顯示用）
  const cwdTailStr = cwd.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? cwd;

  return (
    <div className="at-conv-pane">
      {/* topbar */}
      <div className="at-conv-topbar">
        <span className="at-conv-topbar__label">{label}</span>
        <span className="at-conv-topbar__cwd" title={cwd}>{cwdTailStr}</span>
        <div className="at-conv-topbar__actions">
          <button
            type="button"
            className="at-conv-topbar__expand-btn"
            onClick={() => setExpandSignal((v) => v + 1)}
            title="展開全部段落"
            aria-label="展開全部段落"
          >
            全部展開
          </button>
          <button
            type="button"
            className="at-conv-topbar__collapse-btn"
            onClick={() => setCollapseSignal((v) => v + 1)}
            title="收合全部段落"
            aria-label="收合全部段落"
          >
            全部收合
          </button>
          <button
            className="at-conv-topbar__close"
            onClick={onClose}
            aria-label="關閉對話"
            type="button"
          >
            ✕ 關閉
          </button>
        </div>
      </div>

      {/* 訊息列（LegacySegmentGroup 段落卡片形式顯示） */}
      <div className="at-conv-messages">
        {pending && (
          <div className="at-conv-status at-conv-status--pending">
            ⏳ 正在準備 AI 助手，請稍候…
          </div>
        )}
        {!pending && totalCount === 0 && !done && (
          <div className="at-conv-status at-conv-status--hint">
            👋 AI 助手準備中，待會兒它會問你想建立什麼樣的團隊
          </div>
        )}

        {/* 共用 Session conversation data/render path：後端 segment 索引 + lazy loaded messages。 */}
        <SessionIdContext.Provider value="">
          <DispatchStatsContext.Provider value={dispatchStatsMap}>
            <AskAnswersContext.Provider value={askAnswersMap}>
              <AskAnswerCallbackContext.Provider value={() => {}}>
                {switching ? (
                  <div className="at-conv-status at-conv-status--hint">重新整理中…</div>
                ) : (
                  (() => {
                    const lastSegNo = segIndex.length > 0 ? segIndex[segIndex.length - 1].seg_no : -1;
                    const rows: React.JSX.Element[] = [];
                    const hasPreamble = segIndex.length > 0 && segIndex[0].start_seq > 0;
                    const preEnd = hasPreamble ? segIndex[0].start_seq - 1 : -1;

                    if (hasPreamble) {
                      const pre = getMessagesFor(0, preEnd);
                      const preMeta: SegmentInfo = {
                        seg_no: 0,
                        start_seq: 0,
                        end_seq: preEnd,
                        start_ts: "",
                        end_ts: "",
                        label: "前言",
                        is_command: 0,
                        msg_count: pre.complete ? pre.messages.length : preEnd + 1,
                        head_kind: "other",
                      };
                      rows.push(
                        <SegmentGroup
                          key="seg-preamble"
                          segMeta={preMeta}
                          segNo={0}
                          durationText=""
                          messages={pre.complete ? pre.messages : undefined}
                          onNeedFetch={() => fetchSegment(0, preEnd)}
                          loadingState={segmentStateOf(0)}
                          isLast={false}
                          countIsEstimate={!pre.complete}
                          collapseSignal={collapseSignal}
                          expandSignal={expandSignal}
                        />,
                      );
                    }

                    for (const s of segIndex) {
                      const got = getMessagesFor(s.start_seq, s.end_seq);
                      let durationText = "";
                      if (s.start_ts && s.end_ts) {
                        const d = Date.parse(s.end_ts) - Date.parse(s.start_ts);
                        if (isFinite(d) && d >= 0) durationText = "⏱ ~" + fmtDurationMs(d);
                      }
                      rows.push(
                        <SegmentGroup
                          key={`seg-${s.seg_no}`}
                          segMeta={s}
                          segNo={s.seg_no}
                          durationText={durationText}
                          messages={got.complete ? got.messages : undefined}
                          onNeedFetch={() => fetchSegment(s.start_seq, s.end_seq)}
                          loadingState={segmentStateOf(s.start_seq)}
                          isLast={s.seg_no === lastSegNo}
                          collapseSignal={collapseSignal}
                          expandSignal={expandSignal}
                        />,
                      );
                    }
                    return rows;
                  })()
                )}
              </AskAnswerCallbackContext.Provider>
            </AskAnswersContext.Provider>
          </DispatchStatsContext.Provider>
        </SessionIdContext.Provider>

        {busy && !done && (
          <div className="at-conv-status at-conv-status--busy">
            <span className="at-conv-typing__dot" />
            <span className="at-conv-typing__dot" />
            <span className="at-conv-typing__dot" />
            🤖 AI 處理中，請稍候…
          </div>
        )}
        {done && (
          <div className="at-conv-status at-conv-status--done at-conv-status--done-row">
            <span>對話已結束</span>
            {/* 繼續對話（保留 context 續聊）：僅 claude 支援，放在「開始新對話」前面為主要選項 */}
            {cliId === "claude" && onResume && (
              <button
                type="button"
                className="at-conv-continue-btn"
                onClick={() => onResume(conversationId)}
              >
                💬 繼續對話
              </button>
            )}
            <button
              type="button"
              className="at-conv-restart-btn"
              onClick={onRestart}
            >
              🔄 開始新對話
            </button>
          </div>
        )}
        {/* 換你回覆提示：AI 回完、等待使用者輸入時顯示 */}
        {!pending && !busy && !done && totalCount > 0 && promptOptions === null && (
          <div className="at-conv-your-turn" aria-live="polite">
            👇 換你回覆
          </div>
        )}

        {/* 互動提問區（卡片模式 + 非結束 + 有 options 時顯示）。
            偵測到結構化 AskUserQuestion → 渲染白話選擇題卡片；否則退回現有數字按鈕。 */}
        {promptOptions !== null && !done && (
          activeAskQuestion ? (
            <AskQuestionCard
              question={activeAskQuestion}
              onSubmit={(r) => onSubmitAsk?.(r, activeAskQuestion.options, promptOptions)}
            />
          ) : (
            <div className="at-conv-prompt" role="group" aria-label="請選擇一個選項">
              <p className="at-conv-prompt__label">請選擇一個選項繼續：</p>
              <div className="at-conv-prompt__options">
                {promptOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className="at-conv-prompt__option"
                    onClick={() => onSelectOption(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )
        )}
        {createSpec && !specAlreadyCreated && (
          <div className="at-conv-create-spec">
            <div className="at-conv-create-spec__meta">
              <strong>要建立這個 AI 團隊嗎？</strong>
              <span>{createSpec.teamName}</span>
            </div>
            <button
              type="button"
              className="at-conv-create-spec__apply"
              onClick={handleApplyCreateSpec}
              disabled={creatingTeam}
            >
              {creatingTeam ? "建立中..." : "建立團隊"}
            </button>
            {createStatus && <div className="at-conv-create-spec__status">{createStatus}</div>}
          </div>
        )}
        {/* 捲動錨點 */}
        <div ref={messagesEndRef} />
      </div>

      {/* ── 查看原始畫面按鈕列 ────────────────────────────────────────────── */}
      <div className="at-conv-term-bar">
        <button
          type="button"
          className={`at-conv-term-bar__toggle${termExpanded ? " at-conv-term-bar__toggle--active" : ""}`}
          onClick={onToggleTerm}
          aria-pressed={termExpanded}
          title={termExpanded ? "收合詳細記錄" : "展開 AI 的詳細執行畫面"}
        >
          🖥 {termExpanded ? "收合原始畫面" : "查看原始畫面"}
        </button>
      </div>

      {/* 輸入框（常駐底部） */}
      <div className="at-conv-input">
        <textarea
          className="at-conv-input__textarea"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`輸入訊息（自動加 ${CLI_SKILL_PREFIX[cliId] ?? "/"}${effectiveSkill} 前綴；Enter 送出，Shift+Enter 換行）`}
          rows={2}
          disabled={done}
        />
        <button
          className="at-conv-input__send"
          onClick={handleSend}
          disabled={done || !inputText.trim()}
          type="button"
        >
          送出
        </button>
      </div>
    </div>
  );
}
