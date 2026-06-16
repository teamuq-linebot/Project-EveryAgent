import React, { useState, useCallback, useEffect, useRef } from "react";
import Sidebar from "./views/Sidebar";
import KanbanBoard from "./views/Kanban/KanbanBoard";
import SettingsPage from "./views/Settings/SettingsPage";
import CliOnboardingModal from "./views/Settings/CliOnboardingModal";
import ProjectManagementView from "./views/Management/ProjectManagementView";

import SessionTabHost from "./views/Session/SessionTabHost";
import AgentTeamsView from "./views/AgentTeams/AgentTeamsView";
import { useAgentConversation } from "./hooks/useAgentConversation";
import { useTasks } from "./hooks/useTasks";
import { useSession } from "./hooks/useSession";
import { useTheme } from "./hooks/useTheme";
import type { Task } from "./hooks/useTasks";
import {
  APP_SETTINGS_KEYS,
  APP_SETTINGS_DEFAULTS,
} from "../shared/ipcContracts";
import type { CliId } from "../shared/cliRegistry";

/** 固定 tab 識別子 */
type FixedTab =
  | "kanban"
  | "projects"
  | "milestones"
  | "agent-teams"
  | "platforms"
  | "settings"
  | "gantt";
type TabId = FixedTab | string; // string = sessionId for dynamic tabs

const FIXED_TABS: { id: FixedTab; label: string; icon?: string }[] = [
  { id: "agent-teams", label: "AI 團隊", icon: "🤖" },
  { id: "kanban", label: "看板", icon: "⊞" },
  { id: "projects", label: "專案管理", icon: "◧" },
  // tab id 維持 'platforms'（避免動 session 恢復 / 其他引用）；統一設定頁入口，label/icon 改「設定」。
  { id: "platforms", label: "設定", icon: "⚙" },
];

/** 看板週期自動刷新間隔（ms）預設。設定頁「進階 → 看板刷新間隔」可覆寫（clamp 5~120s，下次啟動或即時生效）。 */
const KANBAN_POLL_MS_DEFAULT = APP_SETTINGS_DEFAULTS.kanbanPollSeconds * 1000;

export default function App(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>("agent-teams");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 看板輪詢間隔（ms）：啟動讀 app_settings('kanban_poll_seconds') 一次，clamp 5~120s（設定頁「進階」改）。
  const [kanbanPollMs, setKanbanPollMs] = useState<number>(
    KANBAN_POLL_MS_DEFAULT,
  );
  useEffect(() => {
    let cancelled = false;
    void window.tuq?.settings
      ?.get(APP_SETTINGS_KEYS.KANBAN_POLL_SECONDS)
      .then((r) => {
        if (cancelled || !r.ok || !r.data) return;
        const raw = (r.data as { seconds?: unknown }).seconds;
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(n)) return;
        const clamped = Math.min(
          APP_SETTINGS_DEFAULTS.kanbanPollSecondsMax,
          Math.max(APP_SETTINGS_DEFAULTS.kanbanPollSecondsMin, Math.round(n)),
        );
        setKanbanPollMs(clamped * 1000);
      })
      .catch(() => {
        /* 讀不到 → 維持預設 15s */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const { tasks, runStates, loading, error, reload, updateStatus, acknowledge } = useTasks();

  const {
    sessions,
    openSession,
    closeSession,
    hydrateFromActive,
    refillTaskNames,
  } = useSession();
  const { theme, toggle: toggleTheme, setTheme } = useTheme();

  // 團隊 session 的對話輸入框預填草稿映射：sessionId → 原始任務描述字串。
  // 以 ref 持有（不需觸發 re-render），在 SessionTabHost 渲染時讀取並傳入（SessionTab
  // 自動啟動 CLI + 預填到輸入框，由使用者按 Enter 送出；不自動注入 PTY）。
  const sessionInitialPromptsRef = useRef<Map<string, string>>(new Map());

  // 團隊 session 的 agent 下拉預設（裸 skillName）映射：sessionId → skillName。
  // 仿 sessionInitialPromptsRef 模式；ConversationPanel 下拉以此為初始值（§4.3）。
  const sessionInitialTeamsRef = useRef<Map<string, string>>(new Map());

  // taskSourceMeta：B7 schema 瘦身後 origin/platform_local_id 欄將消失，本批先降級為空物件。
  const taskSourceMeta = {};

  // task 名稱解析（hydrate 恢復 tab 時取顯示名）：以 taskId join 看板 tasks；查不到退回 taskId。
  // 用 ref 持最新 tasks，避免把 hydrate effect 綁進 tasks 依賴而反覆重跑。
  const tasksRef = useRef<Task[]>([]);
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);
  const resolveTaskName = useCallback(
    (taskId: string): string | undefined =>
      tasksRef.current.find((t) => t.id === taskId)?.name,
    [],
  );

  // App 啟動恢復：把 main 端「實際存在」的所有 session（含 headless recoverMonitoring 恢復的，
  // index.ts whenReady 後 async 跑）併入 renderer → 自動開對應 tab + 進左邊監測列表。
  // 修「監測中 card 閃數 ≠ 監測列表數」：card 閃由 backend monitor 推 onCardRunState，
  // headless 恢復的 session 會閃但原本沒 tab/不在列表；hydrate 後三者一致。
  // recoverMonitoring 是 async，掛載當下 main 端可能還沒填好集合 → 退避重試數次補抓晚到的恢復。
  // hydrate 以 taskId 去重冪等：多次跑只補新出現的、不重複加 tab。
  useEffect(() => {
    let cancelled = false;
    const delays = [0, 600, 1500, 3000]; // ms：覆蓋 recoverMonitoring 各綁定逐一恢復的時窗
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const d of delays) {
      timers.push(
        setTimeout(() => {
          if (!cancelled) void hydrateFromActive(resolveTaskName);
        }, d),
      );
    }
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [hydrateFromActive, resolveTaskName]);

  // 回填保險：tasks 首次有值後觸發一次，把 hydrate 時因看板未載入而降級為 taskId 的名稱補上。
  // backend 已帶 taskName 故通常不需此保險；萬一 repo 查無（新建任務尚未落 DB）此處補救。
  const tasksLoadedRef = useRef(false);
  useEffect(() => {
    if (tasks.length > 0 && !tasksLoadedRef.current) {
      tasksLoadedRef.current = true;
      refillTaskNames(resolveTaskName);
    }
  }, [tasks, refillTaskNames, resolveTaskName]);

  // 看板自動刷新：focus / 切到看板 tab 時觸發（8 秒節流在 useTasks 內）。
  // 讀路徑純本地 SQLite（不打網路），不需要 loggedIn 才刷——切到「本地組」（builtin:local）時
  // auth.loggedIn=false，若仍加 loggedIn 條件會導致本地新建任務切回看板後看不見（bug fix）。
  const handleKanbanFocus = useCallback(() => {
    reload();
  }, [reload]);

  // F5 強制刷新（繞過節流）/ F11 全螢幕
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "F5") {
        e.preventDefault();
        if (activeTab === "kanban") reload(true);
      } else if (e.key === "F11") {
        e.preventDefault();
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeTab, reload]);

  // window focus → refresh kanban（節流保護在 hook 內）
  const windowFocusRef = useRef(false);
  useEffect(() => {
    const onFocus = (): void => {
      if (!windowFocusRef.current) {
        windowFocusRef.current = true;
        return;
      }
      if (activeTab === "kanban") reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [activeTab, reload]);

  // 週期性自動刷新：在看板 tab 時，每 kanbanPollMs 拉一次（節流保護）。
  // 解決「看板開著放著不同步」——原本只在 focus/切tab/F5 才刷。
  // 讀路徑純本地 SQLite，不需 loggedIn 才週期刷——本地組（builtin:local）下 loggedIn=false，
  // 若加 loggedIn 條件會停止週期刷新，導致新建任務在看板上滯後出現（bug fix）。
  // 間隔讀自設定頁「進階 → 看板刷新間隔」（kanbanPollMs 變動 → effect 重綁，即時生效）。
  useEffect(() => {
    const id = setInterval(() => {
      if (activeTab === "kanban") reload();
    }, kanbanPollMs);
    return () => clearInterval(id);
  }, [activeTab, reload, kanbanPollMs]);

  const handleCardDoubleClick = useCallback(
    async (task: Task) => {
      // Phase 5（local-first 接線本地讀）：milestone 鍵改讀 TaskService 投影的結構化欄位
      // `task.milestone_id`（純本地列=milestone_local_id；鏡像列=遠端 milestone id），
      // 不再從 raw["milestoneId"] / raw["milestone"].id 二次解析。
      // §2.7：session:open 由 task 列的 milestone_local_id 直查 milestone_bindings。
      // 防呆：投影欄缺值時退回 raw（鏡像列舊資料相容），對齊既有等價行為。
      const milestoneId: string | null =
        task.milestone_id ??
        (task.raw["milestoneId"] as string | null | undefined) ??
        ((
          task.raw["milestone"] as Record<string, unknown> | null | undefined
        )?.["id"] as string | null | undefined) ??
        null;
      // openSession 回傳新（或既有）sessionId → 直接切過去。
      // 不靠 setTimeout + sessions.find（那會讀到 openSession 前的 stale state，
      // 導致「tab 出現但視窗沒跳過去」）。
      const sid = await openSession(task.id, task.name, milestoneId || null);
      if (sid) setActiveTab(sid);
    },
    [openSession],
  );

  const handleCloseSession = useCallback(
    (sessionId: string) => {
      closeSession(sessionId);
      // 關掉後切回看板
      setActiveTab("kanban");
    },
    [closeSession],
  );

  // AI 團隊嵌入式對話（agentConv）— 提升到 App 讓 Sidebar 也能看到對話清單
  const agentConv = useAgentConversation();

  // 側欄點 AI 對話列 → 切到 AI 團隊頁並切換該對話
  const handleSelectAgentConv = useCallback(
    (convId: string) => {
      setActiveTab("agent-teams");
      agentConv.switchTo(convId);
    },
    [agentConv],
  );

  // 開啟團隊對話 session（AgentTeamsView 的「💬 對話」按鈕入口）：
  // taskId 為彈窗流程建的真 task local_id（取代原本傳 label）；tool=彈窗選的 model；
  // projectPath 由 TeamFolderPicker 選定後傳入；initialTeam=裸 skillName（下拉預設）。
  // initialDraft=原始任務描述（預填到對話輸入框、由使用者按 Enter 送出，不自動注入 PTY）。
  // → openSession(taskId, label, milestoneId, {projectPath, tool}) → sessionId
  // → sessionInitialPromptsRef 餵預填草稿、sessionInitialTeamsRef 餵下拉預設
  // → setActiveTab 跳到該 session tab。
  const handleOpenTeamSession = useCallback(
    async (
      label: string,
      initialDraft: string,
      projectPath: string,
      tool: CliId,
      taskId: string,
      milestoneId: string | null,
      initialTeam: string,
    ): Promise<void> => {
      try {
        const sid = await openSession(taskId, label, milestoneId, {
          projectPath,
          tool,
          // 「開始團隊對話」一律開全新 session（不 resume 同資料夾舊對話），
          // 讓 /tuq-agent <任務> 注入一條乾淨對話。
          forceNewSession: true,
        });
        if (!sid) return;
        sessionInitialPromptsRef.current.set(sid, initialDraft);
        sessionInitialTeamsRef.current.set(sid, initialTeam);
        setActiveTab(sid);
      } catch {
        // 靜默失敗（使用者仍在 agent-teams tab）
      }
    },
    [openSession],
  );

  const handleTabChange = useCallback(
    (tabId: TabId) => {
      setActiveTab(tabId);
      if (tabId === "kanban") {
        handleKanbanFocus();
      }
    },
    [handleKanbanFocus],
  );

  // 「完成綠點」已讀標記：只在「使用者切換 / 點進某個 session tab」的當下，
  // 且該任務此刻正亮綠（completed）時，才標記已讀 → 降為中性色。
  //
  // 為何只在 activeTab 變動時觸發（不把 sessions / runStates 進 deps）？
  //   使用者要的是「對話一結束就亮綠，即使正開著該 tab」。若 runStates 進 deps，
  //   正在看時一完成就會被即時標記已讀（綠點一閃即逝、形同不顯示）。
  //   改為只在「點進/切換到該 tab」這個使用者動作當下才標記已讀；正開著時才完成 →
  //   不觸發 → 綠點正常亮，待下次再點進該任務才轉中性。
  //   sessions / runStates 以 ref 取最新值（不當 dep，避免其變動觸發誤標）。
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const runStatesRef = useRef(runStates);
  runStatesRef.current = runStates;
  useEffect(() => {
    const s = sessionsRef.current.find((s) => s.sessionId === activeTab);
    // 只在此刻「正亮綠」時才標記已讀（runStates 為已套用 ack 的有效值：
    // completed=綠點顯示中、idle=已讀、running/waiting=工作中 → 後者不誤標）。
    if (s && runStatesRef.current[s.taskId] === "completed") acknowledge(s.taskId);
  }, [activeTab, acknowledge]);

  return (
    <div className="app-shell app-shell--row">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed((v) => !v)}
        fixedTabs={FIXED_TABS}
        sessions={sessions}
        runStates={runStates}
        taskSourceMeta={taskSourceMeta}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        onCloseSession={handleCloseSession}
        theme={theme}
        onToggleTheme={toggleTheme}
        agentConversations={agentConv.conversations}
        activeAgentConvId={activeTab === "agent-teams" ? agentConv.activeId : null}
        onSelectAgentConv={handleSelectAgentConv}
        onHideAgentConv={agentConv.hide}
      />

      {/* 內容區 */}
      <main className="app-content">
        {activeTab === "kanban" && (
          <div className="tab-pane">
            <KanbanBoard
              tasks={tasks}
              runStates={runStates}
              loading={loading}
              error={error}
              onCardDoubleClick={handleCardDoubleClick}
              onCardMove={(taskId, newStatus) =>
                updateStatus(taskId, newStatus)
              }
            />
          </div>
        )}

        {activeTab === "projects" && (
          <div className="tab-pane">
            <ProjectManagementView />
          </div>
        )}

        {/* AgentTeams 常駐掛載（keep-mounted）、僅以 display 切換 —— 切走時 xterm terminal
            不卸載、PTY onData 訂閱不中斷、對話 state 不重置、無需 getBuffer replay 補償。
            對齊 Session tab 的 display:none 模式（App.tsx ~L493 的 sessions.map 段落）。 */}
        <div
          className="tab-pane"
          style={activeTab === "agent-teams" ? undefined : { display: "none" }}
        >
          <AgentTeamsView conv={agentConv} onOpenTeamSession={handleOpenTeamSession} />
        </div>

        {activeTab === "platforms" && (
          <div className="tab-pane">
            <SettingsPage theme={theme} onSetTheme={setTheme} />
          </div>
        )}

        {/* session tab 常駐掛載、僅以 display 切換 —— 卸載會 kill PTY，
            切回來時重 spawn + 重注入 claude --resume（CLI 重複啟動）。 */}
        {sessions.map((s) => (
          <div
            key={s.sessionId}
            className="tab-pane"
            style={activeTab === s.sessionId ? undefined : { display: "none" }}
          >
            <SessionTabHost
              session={s}
              onClose={handleCloseSession}
              initialPrompt={sessionInitialPromptsRef.current.get(s.sessionId)}
              initialTeam={sessionInitialTeamsRef.current.get(s.sessionId)}
            />
          </div>
        ))}
      </main>

      {/* 首啟 onboarding：偵測缺漏的 AI 工具 → 引導去設定頁安裝（不在此 modal 內裝）。
          mount 時自拉狀態；shouldPrompt 為 false 時自身不渲染任何 DOM。 */}
      <CliOnboardingModal onGoToSettings={() => setActiveTab("platforms")} />
    </div>
  );
}
