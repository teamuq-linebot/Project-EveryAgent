import { useState, useEffect, useRef, useCallback } from "react";
import type { ConversationMessage } from "../../shared/ipcContracts";
import type { AskSubmitResult } from "../views/AgentTeams/AskQuestionCard";
import type { ActiveAskQuestion } from "../views/AgentTeams/askQuestionHelpers";
import type { KeyStep } from "../views/AgentTeams/askKeySeq";
import {
  buildSingleSelectSeq,
  buildMultiSelectSeq,
  buildOtherSeq,
  resolveDigit,
} from "../views/AgentTeams/askKeySeq";

const HIDDEN_AGENT_CONV_KEY = "agentConv:hiddenConversationIds";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 單條對話在 renderer 的狀態快照。 */
export interface ConvState {
  conversationId: string;
  /** 顯示用標籤（建立 / 健診 / 成長 / 修改…）；open 時由 caller 傳入。 */
  label: string;
  /** 對話 cwd（agentOrgRoot）；topbar 顯示用。 */
  cwd: string;
  /** 使用的 CLI 後端識別碼（'claude' | 'codex' | 'antigravity'）；onRestart 時重用。 */
  cliId: string;  // 'claude' | 'codex' | 'antigravity'
  /** 重開用：記住本條的 initialPrompt（onRestart 時重用）。 */
  prompt: string;
  /** 來自 agentConv:messages push 的最新全量訊息（服務全量重解析，hook 直接取代）。 */
  messages: ConversationMessage[];
  /** JSONL 尚未出現（claude 啟動中）→ true，UI 顯示「啟動中…」。 */
  pending: boolean;
  /** PTY 已結束（claude 退出）→ true，UI 標「對話已結束」。 */
  done: boolean;
  /** PTY 正在輸出（claude 處理中）→ true。靜默 1500ms 後由服務端歸 false。 */
  busy: boolean;
  /**
   * claude 偵測到互動提問時的選單選項（非 null = 等待使用者選；null = 無提問）。
   * 由 agentConv:promptState push 驅動。
   */
  promptOptions: Array<{ value: string; label: string }> | null;
  /** 建立時間（sidebar 排序 / 顯示用）。 */
  createdAt: number;
  /**
   * 開啟方指定的預設 skill（隊長名稱，不含前綴符號）。
   * 未指定時為 null，UI 層退回預設值（tuq-agent）。
   * B10 initialSkill 管線（2026-06-11）。
   */
  initialSkill?: string | null;
}

export interface AgentConversation {
  /** 所有對話（依插入序；sidebar render 用）。 */
  conversations: ConvState[];
  /** 當前對話 id（null = 無對話）。 */
  activeId: string | null;
  /** 當前對話的狀態快照（= convs.get(activeId)；無則 null）。Pane 直接吃這個。 */
  active: ConvState | null;
  /**
   * 開新一條對話（**不關既有**）。回傳新 conversationId（失敗回 null）。
   * - cwd / initialPrompt 同舊；label 新增（sidebar 顯示）。
   * - 新對話一律切換 activeId（2026-06-11 會議定案；原 §2.3「不搶進行中對話」已廢）。
   * - 服務端達上限（AGENT_CONV_LIMIT）時：回 null 並設 limitError（UI 提示「請先關一個」）。
   */
  open: (
    cwd: string,
    initialPrompt: string,
    label: string,
    cliId?: 'claude' | 'codex' | 'antigravity',
    initialSkill?: string | null,
  ) => Promise<string | null>;
  /**
   * 繼續一條已結束的對話（claude --resume）：以**既有 conversationId** 續接，
   * 保留 context、不重送 prompt。僅 claude 後端支援；非 claude 為 no-op。
   * 找不到該條或 cliId 非 claude 時直接 return（safety）。
   */
  resume: (conversationId: string) => Promise<void>;
  /** 切換當前對話。 */
  switchTo: (conversationId: string) => void;
  /** 關閉一條（close backend + 從 convs 移除）。若關的是 activeId，自動切到相鄰一條（或 null）。 */
  close: (conversationId: string) => void;
  /** 僅從本機清單隱藏歷史對話；不關閉 backend PTY。 */
  hide: (conversationId: string) => void;
  /** 送使用者輸入到當前對話的 PTY stdin（無 active → no-op）。 */
  sendInput: (text: string) => void;
  /** 點選互動提問選項：作用於當前對話。 */
  selectOption: (value: string) => void;
  /**
   * 送出結構化選擇題卡片（AskUserQuestion）的回應：依選取組裝鍵序注入當前對話 PTY。
   * - result：卡片送出結果（單/多選、選取 index、其他文字）。
   * - options：結構化選項（原序，用來算「其他」位置與 label 對照）。
   * - promptOptions：claude 偵測到的 TUI 選項（value=實際數字鍵），供 resolveDigit / Other digit 解析。
   */
  submitAsk: (
    result: AskSubmitResult,
    options: ActiveAskQuestion["options"],
    promptOptions: Array<{ value: string; label: string }>,
  ) => void;
  /**
   * 最近一次 open 觸發的錯誤訊息（如達上限）；非 null = UI 應提示。
   * 呼叫 clearLimitError() 清除。
   */
  limitError: string | null;
  /** 清除 limitError（使用者已看到提示）。 */
  clearLimitError: () => void;
  /**
   * 各對話輸入框的草稿文字（§2.4）。
   * key = conversationId，value = 使用者尚未送出的輸入文字。
   * 對話關閉時自動清除。
   * TODO: AgentConversationPane 整合（目前 Pane 仍用 local state）。
   */
  inputDrafts: Map<string, string>;
  /** 更新指定對話的輸入草稿（§2.4）。 */
  setInputDraft: (conversationId: string, text: string) => void;
}

function readHiddenConversationIds(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_AGENT_CONV_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function rememberHiddenConversationId(conversationId: string): void {
  try {
    const next = readHiddenConversationIds();
    next.add(conversationId);
    localStorage.setItem(HIDDEN_AGENT_CONV_KEY, JSON.stringify([...next].slice(-200)));
  } catch {
    // localStorage failure should not block closing a conversation.
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAgentConversation(): AgentConversation {
  // 主 state：以 conversationId 為 key 的 Map（保插入序，sidebar 依序顯示）。
  const [convs, setConvs] = useState<Map<string, ConvState>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(null);
  // open 失敗（達上限等）訊息；UI 取用後 clearLimitError 清除。
  const [limitError, setLimitError] = useState<string | null>(null);
  // 各對話輸入框草稿（§2.4）。key = conversationId；removeConv 時連帶清除。
  const [inputDrafts, setInputDraftsState] = useState<Map<string, string>>(new Map());

  // Ref 鏡像：讓非同步回呼與 effect cleanup 讀取最新值，不依賴過期 closure。
  const convsRef = useRef<Map<string, ConvState>>(convs);
  useEffect(() => {
    convsRef.current = convs;
  }, [convs]);
  const activeIdRef = useRef<string | null>(activeId);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // mounted 守衛：unmount 後不再 setState；open await 期間若已 unmount 則補 close。
  const mountedRef = useRef(true);

  // ---------------------------------------------------------------------------
  // 訂閱 agentConv:messages push（mount 一次，unmount 取消）
  // 這條 push 只更新 lifecycle 狀態；卡片訊息改由 useConversationData 查詢式資料層讀取。
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const unsubscribe = window.tuq.onAgentConvMessages((payload) => {
      setConvs((prev) => {
        const entry = prev.get(payload.conversationId);
        if (!entry) return prev; // 已關 / 未知 → 丟棄
        const next = new Map(prev);
        next.set(payload.conversationId, {
          ...entry,
          messages: entry.messages,
          pending: payload.pending,
          done: payload.done,
          busy: payload.busy,
        });
        return next;
      });
    });
    return unsubscribe;
  }, []);

  // ---------------------------------------------------------------------------
  // 訂閱 agentConv:promptState push（mount 一次，unmount 取消）
  // options 非 null = claude 等待選擇；null = 解除。依 conversationId 路由到對應條。
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const unsubscribe = window.tuq.onAgentConvPromptState((payload) => {
      setConvs((prev) => {
        const entry = prev.get(payload.conversationId);
        if (!entry) return prev;
        const next = new Map(prev);
        next.set(payload.conversationId, {
          ...entry,
          promptOptions: payload.options,
        });
        return next;
      });
    });
    return unsubscribe;
  }, []);

  // ---------------------------------------------------------------------------
  // 啟動時從 teamuq.db 還原 AgentTeams 對話 metadata。
  // 訊息內容仍由 getConversationWindow/getSegments 回 JSONL 讀；這裡只恢復側欄/右欄狀態。
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    window.tuq.agentConv.listSessions().then((result) => {
      if (cancelled || !result.ok || !result.data?.length) return;
      const hiddenIds = readHiddenConversationIds();
      setConvs((prev) => {
        const next = new Map(prev);
        for (const row of result.data) {
          if (hiddenIds.has(row.conversationId)) continue;
          if (next.has(row.conversationId)) continue;
          next.set(row.conversationId, {
            conversationId: row.conversationId,
            label: row.label,
            cwd: row.cwd,
            cliId: row.cliId,
            prompt: row.initialPrompt ?? "",
            messages: [],
            pending: false,
            done: true,
            busy: false,
            promptOptions: null,
            createdAt: Date.parse(row.createdAt) || Date.now(),
            initialSkill: row.initialSkill,
          });
        }
        return next;
      });
    }).catch(() => {
      // DB metadata restore is best-effort; live conversations still work.
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // unmount cleanup：離開頁面時主動 close 「所有」對話的 backend，避免孤兒 PTY。
  // （backend disposeAll 只在視窗全關才觸發；頁內切走仍須 hook 主動關全部。）
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // StrictMode（dev）會把 effect 跑成 mount → cleanup → mount：cleanup 設 false 後
    // 必須在 effect body 重設 true，否則 mountedRef 永久 false → open() 一律走
    // 「已 unmount 補 close」分支，PTY 在注入 claude 前（~30ms）就被殺，
    // 症狀為永遠 pending + 終端全黑 + 無 JSONL（2026-06-11 根因）。
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const id of convsRef.current.keys()) {
        window.tuq.agentConv.close(id).catch(() => {
          // 靜默：unmount 時 close 失敗不影響 UI
        });
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 內部：從 convs 移除一條（不關 backend；供 open 失敗回收樂觀條 / close 共用）。
  // 若移除的是 activeId，切到相鄰一條（被關條的前一條，無前則後一條，皆無則 null）。
  // ---------------------------------------------------------------------------
  const removeConv = useCallback((conversationId: string): void => {
    setConvs((prev) => {
      if (!prev.has(conversationId)) return prev;
      const ids = [...prev.keys()];
      const idx = ids.indexOf(conversationId);
      const next = new Map(prev);
      next.delete(conversationId);

      // 若移除的是當前對話，切到相鄰一條
      if (activeIdRef.current === conversationId) {
        const remaining = ids.filter((id) => id !== conversationId);
        let nextActive: string | null = null;
        if (remaining.length > 0) {
          // 優先取被關條的前一條，無前則取後一條
          nextActive = ids[idx - 1] ?? ids[idx + 1] ?? remaining[0] ?? null;
        }
        setActiveId(nextActive);
      }
      return next;
    });
    // 同時清除該條的輸入草稿（§2.4）
    setInputDraftsState((prev) => {
      if (!prev.has(conversationId)) return prev;
      const next = new Map(prev);
      next.delete(conversationId);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // open：開新一條（不關既有）；回新 id（失敗回 null）
  // ---------------------------------------------------------------------------
  const open = useCallback(
    async (
      cwd: string,
      initialPrompt: string,
      label: string,
      cliId?: 'claude' | 'codex' | 'antigravity',
      initialSkill?: string | null,
    ): Promise<string | null> => {
      // renderer 自取 conversationId（= claude --session-id，亦為 JSONL 檔名 stem）
      const conversationId = crypto.randomUUID();

      // 先樂觀插入一條 pending 的 ConvState（sidebar 即時冒出「啟動中」），
      // 並設為當前對話。若 open 失敗再移除。
      const optimistic: ConvState = {
        conversationId,
        label,
        cwd,
        cliId: cliId ?? 'claude',
        prompt: initialPrompt,
        messages: [],
        pending: true,
        done: false,
        busy: false,
        promptOptions: null,
        createdAt: Date.now(),
        initialSkill: initialSkill ?? null,
      };
      setConvs((prev) => {
        const next = new Map(prev);
        next.set(conversationId, optimistic);
        return next;
      });
      // 2026-06-11 會議定案：新對話一律直接切換 activeId，不保留舊進行中對話。
      // （原 §2.3「若右欄已有非 pending 進行中對話不搶 activeId」已廢棄。）
      setActiveId(conversationId);

      try {
        const result = await window.tuq.agentConv.open({
          conversationId,
          cwd,
          initialPrompt: initialPrompt || null,
          label,
          initialSkill: initialSkill ?? null,
          // 多對話：不關既有。明傳 false（不靠 schema default）。
          forceNew: false,
          cliId,
        });

        // await 期間元件已 unmount → 不 setState，補 close 避免孤兒 PTY。
        if (!mountedRef.current) {
          window.tuq.agentConv.close(conversationId).catch(() => {});
          return null;
        }

        if (!result.ok) {
          // result.error 是 main 端 err() 攤平後的字串；達上限為 'AGENT_CONV_LIMIT'。
          console.error("[useAgentConversation] open 失敗:", result.error);
          // 移除樂觀插入的那條；若它是 active，切回相鄰一條。
          removeConv(conversationId);
          if (result.error === "AGENT_CONV_LIMIT") {
            setLimitError(
              "同時進行的對話已達上限（6 條），請先關閉一些再開新的。",
            );
          } else {
            setLimitError(`開啟對話失敗：${result.error ?? "未知錯誤"}`);
          }
          return null;
        }

        return conversationId;
      } catch (e) {
        if (!mountedRef.current) return null;
        const detail = e instanceof Error ? e.message : JSON.stringify(e);
        console.error("[useAgentConversation] open 例外:", detail);
        removeConv(conversationId);
        setLimitError(`開啟對話失敗：${detail}`);
        return null;
      }
    },
    [removeConv],
  );

  // ---------------------------------------------------------------------------
  // resume：以既有 conversationId 續接同一條對話（claude --resume）
  // 保留 context、不重送 prompt；找不到或非 claude 直接 return。
  // ---------------------------------------------------------------------------
  const resume = useCallback(
    async (conversationId: string): Promise<void> => {
      const entry = convsRef.current.get(conversationId);
      if (!entry) return; // 找不到該條 → safety return
      // 僅 claude 支援 resume；非 claude 不誤用（後端雖會 fallback，語意上不該續話）。
      if (entry.cliId !== "claude") return;

      // 樂觀更新本地 state：把該條設回「活著」（pending 啟動中、done:false），並切為當前對話。
      // 與 open() 把一條設成 active 的寫法一致（reuse 既有 reducer/setter）。
      setConvs((prev) => {
        const cur = prev.get(conversationId);
        if (!cur) return prev;
        const next = new Map(prev);
        next.set(conversationId, { ...cur, pending: true, done: false, busy: false });
        return next;
      });
      setActiveId(conversationId);

      try {
        // 關鍵：傳既有的 conversationId（不產生新 UUID）+ resume:true + initialPrompt:null。
        const result = await window.tuq.agentConv.open({
          conversationId,
          cwd: entry.cwd,
          initialPrompt: null,
          label: entry.label,
          initialSkill: entry.initialSkill ?? null,
          forceNew: false,
          cliId: "claude",
          resume: true,
        });
        if (!mountedRef.current) return;
        if (!result.ok) {
          console.error("[useAgentConversation] resume 失敗:", result.error);
          setLimitError(`繼續對話失敗：${result.error ?? "未知錯誤"}`);
          // resume 失敗：把該條標回 done（恢復原「已結束」狀態），不從清單移除。
          setConvs((prev) => {
            const cur = prev.get(conversationId);
            if (!cur) return prev;
            const nxt = new Map(prev);
            nxt.set(conversationId, { ...cur, pending: false, done: true, busy: false });
            return nxt;
          });
        }
        // 成功：後端會 spawn claude --resume 並 emit 訊息，onAgentConvMessages 推播接手更新 state。
      } catch (e) {
        if (!mountedRef.current) return;
        const detail = e instanceof Error ? e.message : JSON.stringify(e);
        console.error("[useAgentConversation] resume 例外:", detail);
        setLimitError(`繼續對話失敗：${detail}`);
        setConvs((prev) => {
          const cur = prev.get(conversationId);
          if (!cur) return prev;
          const nxt = new Map(prev);
          nxt.set(conversationId, { ...cur, pending: false, done: true, busy: false });
          return nxt;
        });
      }
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // switchTo：切換當前對話
  // ---------------------------------------------------------------------------
  const switchTo = useCallback((conversationId: string): void => {
    if (!convsRef.current.has(conversationId)) return;
    setActiveId(conversationId);
  }, []);

  // ---------------------------------------------------------------------------
  // close：關該條 backend + 從 convs 移除（自動切相鄰）
  // ---------------------------------------------------------------------------
  const close = useCallback(
    (conversationId: string): void => {
      rememberHiddenConversationId(conversationId);
      window.tuq.agentConv.close(conversationId).catch((e) => {
        console.warn("[useAgentConversation] close 失敗", e);
      });
      removeConv(conversationId);
    },
    [removeConv],
  );

  // ---------------------------------------------------------------------------
  // hide：永久從清單移除（sidebar「×」鈕）。AI 對話偏一次性，× 即「以後別再顯示」。
  // - DB 持久化：標 status='closed'（listSessions 不再回傳，重啟後不重現）——這是權威來源。
  // - localStorage：保留為雙保險（DB 寫入失敗或舊資料時仍能過濾）。
  // 不呼叫 backend close PTY（× 只在 done 出現；hide 後端會自行防呆處理仍活著的情況）。
  // ---------------------------------------------------------------------------
  const hide = useCallback(
    (conversationId: string): void => {
      rememberHiddenConversationId(conversationId);
      window.tuq.agentConv.hide(conversationId).catch((e) => {
        console.warn("[useAgentConversation] hide 持久化失敗", e);
      });
      removeConv(conversationId);
    },
    [removeConv],
  );

  // ---------------------------------------------------------------------------
  // sendInput：作用於當前對話
  // ---------------------------------------------------------------------------
  const sendInput = useCallback((text: string): void => {
    const id = activeIdRef.current;
    if (!id) return;
    window.tuq.agentConv.sendInput(id, text).catch((e) => {
      console.warn("[useAgentConversation] sendInput 失敗", e);
    });
  }, []);

  // ---------------------------------------------------------------------------
  // selectOption（互動提問選項點選）：作用於當前對話
  // 送 value → 150ms → \r（繞 bracketed paste）；送出後樂觀清除該條 promptOptions
  // ---------------------------------------------------------------------------
  const selectOption = useCallback((value: string): void => {
    const id = activeIdRef.current;
    if (!id) return;
    // 樂觀清除當前條的 promptOptions：先清 UI，不等服務端確認（避免重複點）
    setConvs((prev) => {
      const entry = prev.get(id);
      if (!entry) return prev;
      const next = new Map(prev);
      next.set(id, { ...entry, promptOptions: null });
      return next;
    });
    window.tuq.agentConv.sendInput(id, value).catch((e) => {
      console.warn(
        "[useAgentConversation] selectOption sendInput(value) 失敗",
        e,
      );
    });
    setTimeout(() => {
      window.tuq.agentConv.sendInput(id, "\r").catch((e) => {
        console.warn(
          "[useAgentConversation] selectOption sendInput(\\r) 失敗",
          e,
        );
      });
    }, 150);
  }, []);

  // ---------------------------------------------------------------------------
  // submitAsk（結構化選擇題卡片送出）：作用於當前對話
  // 依 result（單/多選 + 其他）組裝鍵序（鍵碼/延遲全在 askKeySeq），累加 delay 串
  // setTimeout 依序送入 PTY。送出後樂觀清除該條 promptOptions（防連點）。
  // ---------------------------------------------------------------------------
  const submitAsk = useCallback(
    (
      result: AskSubmitResult,
      options: ActiveAskQuestion["options"],
      promptOptions: Array<{ value: string; label: string }>,
    ): void => {
      const id = activeIdRef.current;
      if (!id) return;
      // 樂觀清除當前條的 promptOptions：先清 UI，不等服務端確認（避免重複送）。
      setConvs((prev) => {
        const entry = prev.get(id);
        if (!entry) return prev;
        const next = new Map(prev);
        next.set(id, { ...entry, promptOptions: null });
        return next;
      });

      const { multiSelect, selectedIndices, otherSelected, otherText } = result;

      // 「其他」在 TUI 是結構化選項之後的最後一項：
      // 先在 promptOptions 找 label 符合 /其他|other/i 的項取 value；
      // 找不到取 promptOptions 最後一項 value；再不行用 String(options.length + 1)。
      const resolveOtherDigit = (): string => {
        const matched = promptOptions.find((opt) => /其他|other/i.test(opt.label));
        if (matched) return matched.value;
        const last = promptOptions[promptOptions.length - 1];
        if (last) return last.value;
        return String(options.length + 1);
      };

      // 組鍵序。多選含「其他」為 v1 降級：序列跑完後另把其他文字當自由訊息補送。
      let steps: KeyStep[];
      let appendOtherFreeText = false;
      if (!multiSelect && otherSelected) {
        steps = buildOtherSeq(resolveOtherDigit(), otherText);
      } else if (!multiSelect) {
        const idx = selectedIndices[0];
        steps = buildSingleSelectSeq(
          resolveDigit(idx, promptOptions, options[idx]?.label ?? ""),
        );
      } else if (selectedIndices.length === 0 && otherSelected) {
        // 多選但一個結構化選項都沒勾、只勾「其他」（bug #7）：
        // 不可呼 buildMultiSelectSeq（targets 空→只會 push 一個空選單確認 Enter，
        // 對 claude multiSelect 是「一個都沒勾就按 Enter」的無效空確認）。
        // 改走純自由文字路徑：steps 留空（不送任何選單鍵），只靠下方補送 otherText + Enter。
        steps = [];
        appendOtherFreeText = true;
      } else {
        steps = buildMultiSelectSeq(selectedIndices, options.length);
        // v1 降級：多選同時勾「其他」時，於多選 Enter 之後把自由文字當一句訊息補送，
        // 避免在 TUI 多選模式中切到自由輸入模式的時序地雷。
        appendOtherFreeText = otherSelected;
      }

      // 依序執行 KeyStep：累加 delay 串 setTimeout，每步送入 PTY。
      let elapsed = 0;
      for (const step of steps) {
        const at = elapsed;
        setTimeout(() => {
          window.tuq.agentConv.sendInput(id, step.data).catch((e) => {
            console.warn("[useAgentConversation] submitAsk sendInput 失敗", e);
          });
        }, at);
        elapsed += step.delayMsAfter;
      }

      // 多選 + 其他（v1 降級）：序列跑完後補送自由文字 + 150ms + \r。
      // bug #8 守門：「其他」輸入框留空（trim 後為空）時完全不補送，
      // 避免多送一個空白字串 + 裸 Enter（對 claude 是無意義的空白回車）。
      if (appendOtherFreeText && otherText.trim() !== "") {
        const textAt = elapsed;
        setTimeout(() => {
          window.tuq.agentConv.sendInput(id, otherText).catch((e) => {
            console.warn(
              "[useAgentConversation] submitAsk 其他文字補送失敗",
              e,
            );
          });
        }, textAt);
        setTimeout(() => {
          window.tuq.agentConv.sendInput(id, "\r").catch((e) => {
            console.warn(
              "[useAgentConversation] submitAsk 其他文字 \\r 補送失敗",
              e,
            );
          });
        }, textAt + 150);
      }
    },
    [],
  );

  const clearLimitError = useCallback((): void => {
    setLimitError(null);
  }, []);

  // ---------------------------------------------------------------------------
  // setInputDraft：更新指定對話的輸入草稿（§2.4）
  // ---------------------------------------------------------------------------
  const setInputDraft = useCallback((id: string, text: string): void => {
    setInputDraftsState((prev) => new Map(prev).set(id, text));
  }, []);

  // 對外的 conversations 陣列（依插入序）＋ active 快照
  const conversations = [...convs.values()];
  const active = activeId !== null ? (convs.get(activeId) ?? null) : null;

  return {
    conversations,
    activeId,
    active,
    open,
    resume,
    switchTo,
    close,
    hide,
    sendInput,
    selectOption,
    submitAsk,
    limitError,
    clearLimitError,
    inputDrafts,
    setInputDraft,
  };
}
