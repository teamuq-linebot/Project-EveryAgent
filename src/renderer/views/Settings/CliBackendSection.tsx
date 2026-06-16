import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  CliId,
  CliStatusDto,
  CliPlanDto,
  PtyDataPayload,
  PtyExitPayload,
} from "../../../shared/ipcContracts";
import { CliCard } from "./CliCard";
import { ptyReadyCallbacks } from "../Session/Terminal";

/**
 * CliBackendSection — 「AI CLI 環境」設定區（掛在 SettingsPage 的 AI 連線組）。
 *
 * 功能：
 *   - mount 時呼叫 window.tuq.cliBackend.detect() 偵測三個 CLI（claude / codex / antigravity），
 *     渲染為三張卡；window.tuq?.cliBackend 不存在時安全降級顯示提示（不丟例外）。
 *   - 每張卡顯示 name / bin / version / path 與右上狀態徽章（4 態：未安裝 / 已登入 / 未登入 / 登入未知）。
 *   - [驗證登入]（段二）：呼叫 verifyLogin(id) 深驗，更新該卡 loginState + detail。
 *   - [一鍵安裝]／[一鍵登入]：先取 CliPlanDto，再在卡片下方展開內嵌終端機（重用 Session/Terminal.tsx）；
 *     Terminal mount 會自己 spawn pty；spawn resolve 後由 ptyReadyCallbacks（Terminal.tsx 匯出）通知本元件，
 *     再等 ~100ms 緩衝後注入 plan.command（確保 shell prompt 穩定後才注入）。
 *     注入指令時在尾端串接「完成標記（completion marker）輸出 + `; exit`」：指令跑完後 shell 會印出標記字串
 *     再自然結束。標記字串以**拆字寫法**注入（輸入列只見 `'__TUQCLIDONE_' + '<id>__'` 這種帶 `' + '` 的形式，
 *     不含連續 token），確保輸入列 echo **不會誤觸**自動關閉；只有真正執行 Write-Output/printf 的「輸出列」
 *     才會合成連續 token。
 *   - 自動關閉（主）：訂閱 window.tuq.onPtyData，依 payload.id === 當前 ptyId 過濾並累積該 pty 的輸出；
 *     當累積內容含「join 後的 token」→ closeAndDetect()。改用輸出標記偵測取代不可靠的 onPtyExit
 *     （node-pty 的 onExit 在 Windows ConPTY/winpty 下 shell 自行 `exit` 時不可靠，issues #333 / #413）。
 *   - 自動關閉（備援）：仍訂閱 window.tuq.onPtyExit；若它真有觸發也呼叫同一個 closeAndDetect()。
 *     closeAndDetect 對「同一面板」有防重 guard，marker 與 onExit 兩路都來也只關一次。
 *   - [完成並重新偵測]：手動關閉路徑，kill pty → 收合面板 → 重跑 detect（保留作為退路）。
 *   - 同一時間只允許一張卡開著終端機面板（簡化）。
 *
 * 風格對齊 SettingsPage.tsx 既有 section（settings-section / settings-form / settings-form__btn 系）。
 *
 * 展示層由 CliCard.tsx 子元件負責（SRP 抽取）；本元件只保留 state / effect / marker / auto-close 邏輯。
 */

type CardAction = "install" | "login";

/** 當前開著的終端機面板狀態（同時只允許一張卡開著）。 */
interface ActiveTerminal {
  id: CliId;
  action: CardAction;
  ptyId: string;
  plan: CliPlanDto;
}

/** 完成標記的固定前綴；與唯一 id 串接後即為「join 後的 token」（偵測比對用）。 */
const MARKER_PREFIX = "__TUQCLIDONE_";

/** 由 ptyId 取一段唯一 id 當標記後綴（取尾段時間戳即可，足以區分每次開面板）。 */
function markerIdFromPtyId(ptyId: string): string {
  const tail = ptyId.split("-").pop();
  return tail && tail.length > 0 ? tail : String(Date.now());
}

/** join 後要在輸出流裡比對的完整 token，如 `__TUQCLIDONE_1733650000000__`。 */
function joinedToken(markerId: string): string {
  return `${MARKER_PREFIX}${markerId}__`;
}

/**
 * 產生要注入終端機的指令字串：在使用者指令後串接「完成標記輸出 + `; exit`」。
 *
 * 標記以**拆字寫法**注入：輸入列被 shell echo 出來時只會看到 `'__TUQCLIDONE_' + '<id>__'`
 * （powershell）或 `'__TUQCLIDONE_''<id>__'`（bash），中間有 `' + '` / `''` 分隔，**不含連續
 * token**，故輸入列 echo 不會誤觸偵測；只有真正執行 Write-Output/printf 的輸出列才會印出連續
 * 的 `__TUQCLIDONE_<id>__`，那才是命中條件。
 *
 * 尾端保留 `; exit` 當清理：指令會返回的情境（install / `codex login`）跑完後 shell 自然結束。
 * 空指令不注入（回傳空字串，呼叫端會略過 write）。
 *
 * shell='bash' → printf 寫法；其餘（powershell / cmd→預設 shell / default）→ powershell 寫法。
 * （CliCard 內的 mapShell 將 'powershell' 映到 powershell.exe，其餘走 OS 預設 shell；Windows
 * 預設亦為 PowerShell，故非 bash 一律採 powershell 寫法。）
 */
function buildInjection(
  command: string,
  shell: CliPlanDto["shell"],
  markerId: string,
): string {
  const trimmed = command.trim();
  if (!trimmed) return "";
  if (shell === "bash") {
    // 輸入列形式：…; printf '%s\n' '__TUQCLIDONE_''<id>__'; exit （相鄰單引號字串相接，無連續 token）
    return `${trimmed}; printf '%s\\n' '${MARKER_PREFIX}''${markerId}__'; exit`;
  }
  // 輸入列形式：…; Write-Output ('__TUQCLIDONE_' + '<id>__'); exit （字串以 ' + ' 串接，無連續 token）
  return `${trimmed}; Write-Output ('${MARKER_PREFIX}' + '${markerId}__'); exit`;
}

export default function CliBackendSection(): React.JSX.Element {
  const [cards, setCards] = useState<CliStatusDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 每張卡「驗證登入」按鈕的 loading 狀態（id → true）。
  const [verifying, setVerifying] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<ActiveTerminal | null>(null);
  // onPtyData / onPtyExit handler 需即時讀目前 active（避免 effect closure 抓到舊值），故鏡像到 ref。
  const activeRef = useRef<ActiveTerminal | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  // 累積「當前面板 ptyId」的輸出字串，供完成標記（completion marker）偵測；每次開面板重置。
  const ptyOutputRef = useRef<string>("");
  // 防重複關閉：marker 命中與 onExit 備援可能都到，同一面板只關一次。每次開面板重置為 false。
  const closedRef = useRef<boolean>(false);
  // 防重複注入：ptyReadyCallbacks 回呼與備援路徑都只注入一次。每次開面板重置為 false。
  const injectedRef = useRef<boolean>(false);
  // 自動驗證中的 CLI id 集合（closeAndDetect 後對 claude/codex 自動深驗，期間顯示「驗證中」）。
  const [autoVerifying, setAutoVerifying] = useState<Set<CliId>>(new Set());

  const detect = useCallback(async () => {
    const bridge = window.tuq?.cliBackend;
    if (!bridge) {
      setLoading(false);
      setError("bridge-missing");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await bridge.detect();
      if (result.ok) {
        setCards(result.data);
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void detect();
  }, [detect]);

  // [驗證登入]（段二）：深驗後更新該卡 loginState + detail。
  const handleVerify = useCallback(async (id: CliId) => {
    const bridge = window.tuq?.cliBackend;
    if (!bridge) return;
    setVerifying((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await bridge.verifyLogin(id);
      if (result.ok) {
        const v = result.data;
        setCards((prev) =>
          prev.map((c) =>
            c.id === id
              ? { ...c, loginState: v.loginState, detail: v.detail, loginProbe: "verified" }
              : c,
          ),
        );
      }
    } catch {
      /* 驗證失敗 → 維持原狀（安全降級） */
    } finally {
      setVerifying((prev) => ({ ...prev, [id]: false }));
    }
  }, []);

  // [一鍵安裝]／[一鍵登入]：取 plan → 展開內嵌終端機 → 延遲注入指令。
  const handleOpenTerminal = useCallback(
    async (id: CliId, action: CardAction) => {
      const bridge = window.tuq?.cliBackend;
      if (!bridge) return;
      // 同一時間只允許一張卡開著終端機：開新的前先收掉舊的（kill 舊 pty + 清回呼）。
      setActive((prev) => {
        if (prev) {
          ptyReadyCallbacks.delete(prev.ptyId);
          try {
            void window.tuq?.pty?.kill(prev.ptyId);
          } catch {
            /* ignore */
          }
        }
        return null;
      });

      try {
        const planResult =
          action === "install"
            ? await bridge.getInstallPlan(id)
            : await bridge.getLoginPlan(id);
        if (!planResult.ok) {
          setError(planResult.error);
          return;
        }
        const plan = planResult.data;
        const ptyId = `cli-${action}-${id}-${Date.now()}`;
        // 重置本面板的輸出累積、防重關閉旗標、防重注入旗標（每次開面板獨立）。
        ptyOutputRef.current = "";
        closedRef.current = false;
        injectedRef.current = false;
        // PTY spawn 成功後由 Terminal.tsx 觸發 ptyReadyCallbacks；在 setActive 之前先登記，
        // 避免極端快速 spawn 的競爭條件（雖機率極低，仍先登記為佳）。
        // 收到通知後：等 ~100ms 緩衝確保 shell prompt 穩定，再注入指令。
        // injectedRef 防範 StrictMode 雙 mount 等意外雙重觸發。
        ptyReadyCallbacks.set(ptyId, () => {
          if (injectedRef.current) return;
          injectedRef.current = true;
          setTimeout(() => {
            try {
              const markerId = markerIdFromPtyId(ptyId);
              const injection = buildInjection(plan.command, plan.shell, markerId);
              if (injection) {
                window.tuq?.pty?.write(ptyId, injection + "\r");
              }
            } catch {
              /* pty 意外消失 → 使用者可手動於終端機輸入 */
            }
          }, 100);
        });
        setActive({ id, action, ptyId, plan });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  // 收合面板 + 重跑 detect：kill pty（冪等）→ 清 active → 重新偵測刷新徽章。
  // detect 完成後對 claude / codex 自動執行段二深驗（verifyLogin），讓徽章直接顯示真實狀態；
  // 驗證期間以 autoVerifying Set 驅動卡片顯示「確認中…」；agy 不跑深驗（恆 unknown）。
  // 自動關閉（marker 主 / onPtyExit 備援）與手動「完成並重新偵測」共用。
  // 防重複關閉：marker 命中與 onExit 可能都來，closedRef guard 確保同一面板只執行一次。
  const closeAndDetect = useCallback(async () => {
    if (closedRef.current) return;
    closedRef.current = true;

    // 記錄是哪張卡的 action（關閉前抓），供 agy 特殊文案用。
    const closedId = activeRef.current?.id ?? null;

    setActive((prev) => {
      if (prev) {
        try {
          // 此時 shell 多半已因 `; exit` 結束，kill 落在已死 pty（冪等、安全；node-pty #413
          // 的凍結是「最後一個 write 非 \r」造成，與 kill 已死 pty 無關）。
          void window.tuq?.pty?.kill(prev.ptyId);
        } catch {
          /* ignore */
        }
      }
      return null;
    });

    await detect();

    // agy 登入視窗關閉後補白話說明文案（不跑深驗）。
    if (closedId === "antigravity") {
      setCards((prev) =>
        prev.map((c) =>
          c.id === "antigravity"
            ? {
                ...c,
                detail:
                  "登入視窗已關閉。此工具無法自動確認登入狀態，請直接開始使用以確認。",
              }
            : c,
        ),
      );
      return;
    }

    // claude / codex：detect 後自動跑段二深驗，讓徽章顯示真實狀態。
    const bridge = window.tuq?.cliBackend;
    if (!bridge) return;
    const idsToVerify: CliId[] = (["claude", "codex"] as CliId[]).filter(
      (id) => closedId === null || id === closedId,
    );
    if (idsToVerify.length === 0) return;

    setAutoVerifying((prev) => {
      const next = new Set(prev);
      idsToVerify.forEach((id) => next.add(id));
      return next;
    });

    await Promise.allSettled(
      idsToVerify.map(async (id) => {
        try {
          const result = await bridge.verifyLogin(id);
          if (result.ok) {
            const v = result.data;
            setCards((prev) =>
              prev.map((c) =>
                c.id === id
                  ? { ...c, loginState: v.loginState, detail: v.detail, loginProbe: "verified" }
                  : c,
              ),
            );
          }
        } catch {
          /* 深驗失敗 → 維持 detect 結果（安全降級） */
        } finally {
          setAutoVerifying((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }
      }),
    );
  }, [detect]);

  // [完成並重新偵測]：手動關閉退路（自動關閉失靈時可用）。
  const handleFinish = closeAndDetect;

  // 自動關閉（主）：監看 pty 輸出流找完成標記（completion marker），不依賴不可靠的 onExit。
  // 只累積「目前面板的 ptyId」的輸出（過濾其他 pty，如 session 終端機）；累積內容含 join 後的
  // token → closeAndDetect()。輸入列 echo 只有拆字形式（含 ' + ' / ''），不含連續 token，故不誤觸。
  useEffect(() => {
    const sub = window.tuq?.onPtyData;
    if (!sub) return;
    const unsub = sub((payload: PtyDataPayload) => {
      const cur = activeRef.current;
      if (!cur || payload.id !== cur.ptyId) return;
      ptyOutputRef.current += payload.data;
      const token = joinedToken(markerIdFromPtyId(cur.ptyId));
      if (ptyOutputRef.current.includes(token)) {
        void closeAndDetect();
      }
    });
    return unsub;
  }, [closeAndDetect]);

  // 自動關閉（備援）：若 onPtyExit 真有觸發（shell 因 `; exit` 結束且本機 onExit 可靠時），
  // 呼叫同一個 closeAndDetect()（closedRef guard 防與 marker 路徑重複關閉）。
  // 只對「目前面板的 ptyId」反應（過濾其他 pty 的 exit）。
  useEffect(() => {
    const sub = window.tuq?.onPtyExit;
    if (!sub) return;
    const unsub = sub((payload: PtyExitPayload) => {
      const cur = activeRef.current;
      if (cur && payload.id === cur.ptyId) {
        void closeAndDetect();
      }
    });
    return unsub;
  }, [closeAndDetect]);

  // 登入完成自動關閉：登入面板開著時，輪詢 loginSignature 偵測「憑證剛被寫入」→ 主動關面板。
  //   - codex login 跑完會 return（完成標記 `; exit` 已能自動關）；本輪詢主要服務 claude / agy 等
  //     互動式 TUI（登入完成後 TUI 仍開著，標記不會印出 → 否則要等使用者手動退出才關）。
  //   - 首抓設為基準 sig（避免本來就已登入時瞬關）；之後 sig 變動且 loggedIn → 視為剛登入完成。
  //   - 與 marker / onPtyExit 共用 closeAndDetect（closedRef guard 防重複關）。
  useEffect(() => {
    const cur = active;
    if (!cur || cur.action !== "login") return;
    const bridge = window.tuq?.cliBackend;
    if (!bridge?.loginSignature) return;

    let cancelled = false;
    let baseline: string | null = null; // 開面板當下的基準 sig（首抓後設定）

    const tick = async () => {
      try {
        const r = await bridge.loginSignature(cur.id);
        if (cancelled || !r.ok) return;
        const { loggedIn, sig } = r.data;
        if (baseline === null) {
          baseline = sig; // 首抓設基準，不關
          return;
        }
        if (loggedIn && sig !== baseline) {
          void closeAndDetect(); // 憑證剛被寫入＝登入完成
        }
      } catch {
        /* 輪詢失敗 → 下次再試 */
      }
    };

    void tick(); // 立即抓基準
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active, closeAndDetect]);

  // bridge 不存在 → 安全降級。
  if (error === "bridge-missing") {
    return (
      <section className="settings-section">
        <h3 className="settings-section__title">AI CLI 環境</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          CLI 偵測功能尚未就緒（bridge 未載入）。請於完整的桌面 app 中開啟此頁。
        </p>
      </section>
    );
  }

  return (
    <section className="settings-section">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "var(--sp-3)",
        }}
      >
        <h3 className="settings-section__title" style={{ margin: 0 }}>
          AI CLI 環境
        </h3>
        <button
          className="settings-form__btn"
          onClick={() => void detect()}
          disabled={loading}
        >
          {loading ? "偵測中…" : "重新偵測"}
        </button>
      </div>

      <p
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          margin: "0 0 var(--sp-3)",
        }}
      >
        偵測本機的 AI CLI（Claude / Codex / Gemini）安裝與登入狀態，可一鍵在內嵌終端機安裝或登入。
      </p>

      {error && error !== "bridge-missing" && (
        <p
          style={{
            fontSize: 13,
            color: "var(--error)",
            margin: "0 0 var(--sp-3)",
          }}
        >
          ✗ 偵測失敗：{error}
        </p>
      )}

      {loading && cards.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
          偵測中…
        </p>
      ) : (
        <div className="cli-card-list">
          {cards.map((card) => (
            <CliCard
              key={card.id}
              card={card}
              activeTerminal={
                active?.id === card.id
                  ? { ptyId: active.ptyId, plan: active.plan }
                  : null
              }
              isVerifying={!!verifying[card.id] || autoVerifying.has(card.id)}
              onInstall={(id) => void handleOpenTerminal(id, "install")}
              onLogin={(id) => void handleOpenTerminal(id, "login")}
              onVerify={(id) => void handleVerify(id)}
              onFinish={() => void handleFinish()}
            />
          ))}
        </div>
      )}
    </section>
  );
}
