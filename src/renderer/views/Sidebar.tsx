import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ThemeMode } from "../theme";
import type { OpenSession } from "../hooks/useSession";
import type { RunStateMap } from "../hooks/useTasks";
import type { ConvState } from "../hooks/useAgentConversation";
import PromptAlertToasts from "../components/PromptAlertToasts";

/** 監測列狀態點：依 run-state 著色 + tooltip（對齊 TaskCard）。 */
const RUN_STATE_DOT: Record<
  "none" | "idle" | "running" | "waiting" | "error" | "completed",
  { color: string; tooltip: string }
> = {
  running: { color: "var(--accent)", tooltip: "正在執行…" },
  waiting: { color: "var(--warning)", tooltip: "等待你的決定…" },
  error: { color: "var(--error)", tooltip: "CLI 發生錯誤" },
  completed: { color: "var(--success, #22c55e)", tooltip: "對話已完成" },
  idle: { color: "var(--text-muted)", tooltip: "session 開啟（閒置）" },
  none: { color: "var(--text-faint, var(--text-muted))", tooltip: "" },
};

/** 拖曳寬度 localStorage key + 範圍 + 預設（用戶定案：220~400，預設加寬到 260）。 */
const WIDTH_KEY = "sidebar-width";
const WIDTH_MIN = 220;
const WIDTH_MAX = 400;
const WIDTH_DEFAULT = 260;
/** 收合態固定寬（不受拖曳影響）。 */
const COLLAPSED_WIDTH = 48;
const AGENT_CONV_VISIBLE_LIMIT = 4;

function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (!raw) return WIDTH_DEFAULT;
    const v = Number(raw);
    if (!Number.isFinite(v) || v < WIDTH_MIN || v > WIDTH_MAX)
      return WIDTH_DEFAULT;
    return v;
  } catch {
    return WIDTH_DEFAULT;
  }
}

interface FixedTabDef {
  id: string;
  label: string;
  /** 導覽圖示（可選）；未提供時退回預設 ▦。Phase 6.5：專案/里程碑管理 tab 各帶獨立圖示。 */
  icon?: string;
}

/** App 下推的 taskId → 來源 metadata（解析平台·人 chip 用；只取 chip 需要的兩欄）。 */
export interface TaskSourceMeta {
  origin: "local" | "remote";
  platform_local_id: string | null;
}

interface Props {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  fixedTabs: FixedTabDef[];
  sessions: OpenSession[];
  /** 監測任務 run-state（依 taskId 查；著色監測列狀態點）。 */
  runStates: RunStateMap;
  /** taskId → 來源 metadata（origin / platform_local_id），供監測列平台·人 chip 解析。 */
  taskSourceMeta?: Record<string, TaskSourceMeta>;
  activeTab: string;
  onTabChange: (id: string) => void;
  onCloseSession: (sessionId: string) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  /** AI 團隊嵌入式對話清單（用於側欄顯示；點選 → 切到 AI 團隊頁並切換該對話）。 */
  agentConversations?: ConvState[];
  /** 當前 active 的 agent conv id（僅 AI 團隊頁為 active tab 時非 null）。 */
  activeAgentConvId?: string | null;
  /** 點選 AI 對話列的 callback。 */
  onSelectAgentConv?: (convId: string) => void;
  /** 從側欄隱藏已結束的 AI 對話；不應關閉進行中的 backend PTY。 */
  onHideAgentConv?: (convId: string) => void;
}

/** error > waiting > running > completed > idle > none 的排序權重（紅/橘恆置頂）。 */
const RUN_STATE_ORDER: Record<
  "none" | "idle" | "running" | "waiting" | "error" | "completed",
  number
> = {
  error: 0,
  waiting: 1,
  running: 2,
  completed: 3,
  idle: 4,
  none: 5,
};

/**
 * Sidebar — 方向 B（三分明確分層）。
 *   - 頂部：logo + 收合鈕 + 導覽 icon rail（4 個固定 tab 壓成一排小圖示）
 *           + ⚠N 等決定橘計數（waiting>0 才出現；收合態常駐於頂部）。
 *   - 「等決定」橘框子區：waiting 的監測任務獨立置頂橘框（waiting>0 才現，零動畫）。
 *   - 主體：其餘監測任務（running / idle）；每列 狀態點 + 任務名 + 平台·人 chip + ✕。
 *   - 底部：主題切換 + AccountSwitcher（帳號狀態面板，不動）。
 *   - 右緣拖曳 handle：220~400px，localStorage 記住（key=sidebar-width；預設 260）。
 * collapsed 時縮成 48px 窄欄（圖示直排 + 監測點，橘點置頂）。
 */
export default function Sidebar({
  collapsed,
  onToggleCollapsed,
  fixedTabs,
  sessions,
  runStates,
  taskSourceMeta,
  activeTab,
  onTabChange,
  onCloseSession,
  theme,
  onToggleTheme,
  agentConversations = [],
  activeAgentConvId,
  onSelectAgentConv,
  onHideAgentConv,
}: Props): React.JSX.Element {
  // ── 可拖曳寬度（參考專案管理頁 pmv-list-width 同款機制）──
  const [width, setWidth] = useState<number>(readSidebarWidth);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const lastWidthRef = useRef(width);

  const handleHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;
      setDragging(true);
      dragStartXRef.current = e.clientX;
      dragStartWidthRef.current = width;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [width],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent): void => {
      if (!draggingRef.current) return;
      const delta = e.clientX - dragStartXRef.current;
      const next = Math.min(
        WIDTH_MAX,
        Math.max(WIDTH_MIN, dragStartWidthRef.current + delta),
      );
      lastWidthRef.current = next;
      setWidth(next);
    };
    const onMouseUp = (): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      // 結束時寫 localStorage（讀 lastWidthRef，副作用不放在 setState updater 內）。
      try {
        localStorage.setItem(WIDTH_KEY, String(lastWidthRef.current));
      } catch {
        /* storage 不可寫 */
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
  }, []);

  /** 解析單一 session 的平台·人 chip 文字（純本地：一律回 null，不顯 chip）。 */
  const resolveChip = useCallback(
    (_taskId: string): { icon: string; text: string; title: string } | null => {
      return null;
    },
    [],
  );

  // ── 監測任務分流：waiting（等決定）獨立；其餘按 waiting>running>idle 排序 ──
  const sortedSessions = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const ra = RUN_STATE_ORDER[runStates[a.taskId] ?? "none"];
      const rb = RUN_STATE_ORDER[runStates[b.taskId] ?? "none"];
      return ra - rb;
    });
  }, [sessions, runStates]);

  const waitingSessions = useMemo(
    () =>
      sortedSessions.filter(
        (s) => (runStates[s.taskId] ?? "none") === "waiting",
      ),
    [sortedSessions, runStates],
  );
  const otherSessions = useMemo(
    () =>
      sortedSessions.filter(
        (s) => (runStates[s.taskId] ?? "none") !== "waiting",
      ),
    [sortedSessions, runStates],
  );
  const waitingCount = waitingSessions.length;

  const visibleAgentConversations = useMemo(() => {
    const activeOrLive = agentConversations.filter(
      (c) => c.conversationId === activeAgentConvId || !c.done,
    );
    const activeOrLiveIds = new Set(activeOrLive.map((c) => c.conversationId));
    const recentDone = agentConversations
      .filter((c) => c.done && !activeOrLiveIds.has(c.conversationId))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.max(0, AGENT_CONV_VISIBLE_LIMIT - activeOrLive.length));
    return [...activeOrLive, ...recentDone];
  }, [activeAgentConvId, agentConversations]);
  const hiddenAgentConversationCount = Math.max(
    0,
    agentConversations.length - visibleAgentConversations.length,
  );

  /** 點 ⚠N 等決定徽章 → 跳第一條 waiting session。 */
  const handleJumpToWaiting = useCallback(() => {
    const first = waitingSessions[0];
    if (first) onTabChange(first.sessionId);
  }, [waitingSessions, onTabChange]);

  /** 渲染單一監測列（等決定子區 / 主體共用；waiting 帶左緣橘條）。 */
  const renderSessionRow = useCallback(
    (s: OpenSession, isWaiting: boolean): React.JSX.Element => {
      const runState = runStates[s.taskId] ?? "none";
      const dot = RUN_STATE_DOT[runState];
      const chip = resolveChip(s.taskId);
      const name = s.taskName || s.taskId;
      return (
        <button
          key={s.sessionId}
          className={`sidebar__item sidebar__session${
            isWaiting ? " sidebar__session--waiting" : ""
          }${activeTab === s.sessionId ? " sidebar__item--active" : ""}`}
          onClick={() => onTabChange(s.sessionId)}
          title={dot.tooltip ? `${name} — ${dot.tooltip}` : name}
        >
          <span
            className="sidebar__item-icon"
            style={{ color: dot.color }}
            title={dot.tooltip || undefined}
          >
            ●
          </span>
          {!collapsed && <span className="sidebar__item-label">{name}</span>}
          {!collapsed && chip && (
            <span className="sidebar__session-chip" title={chip.title}>
              {chip.icon} {chip.text}
            </span>
          )}
          {!collapsed && (
            <span
              className="sidebar__session-close"
              title="關閉 session"
              onClick={(e) => {
                e.stopPropagation();
                onCloseSession(s.sessionId);
              }}
            >
              ✕
            </span>
          )}
        </button>
      );
    },
    [runStates, resolveChip, activeTab, collapsed, onTabChange, onCloseSession],
  );

  const asideStyle: React.CSSProperties = collapsed
    ? { width: COLLAPSED_WIDTH }
    : { width };

  return (
    <aside
      className={`sidebar${collapsed ? " sidebar--collapsed" : ""}${
        dragging ? " sidebar--dragging" : ""
      }`}
      style={asideStyle}
    >
      {/* 頂部：logo + 收合鈕 */}
      <div className="sidebar__top">
        {!collapsed && <span className="sidebar__logo">快組隊-AI團隊</span>}
        <button
          className="sidebar__collapse"
          onClick={onToggleCollapsed}
          title={collapsed ? "展開側欄" : "收合側欄"}
        >
          {collapsed ? "»" : "«"}
        </button>
      </div>

      {/* ⚠N 等決定橘計數（waiting>0 才出現；展開/收合皆可點，跳第一條 waiting） */}
      {waitingCount > 0 && (
        <button
          className="sidebar__waiting-badge"
          onClick={handleJumpToWaiting}
          title={`${waitingCount} 個任務等你決定`}
        >
          ⚠{waitingCount}
          {!collapsed && (
            <span className="sidebar__waiting-badge-text">等決定</span>
          )}
        </button>
      )}

      {/* 導覽列：展開態「圖示+文字」縱向列表；收合態純圖示+tooltip */}
      <nav className="sidebar__rail">
        {fixedTabs.map(({ id, label, icon }) => (
          <button
            key={id}
            className={`sidebar__rail-item${
              activeTab === id ? " sidebar__rail-item--active" : ""
            }`}
            onClick={() => onTabChange(id)}
            title={label}
          >
            <span className="sidebar__rail-icon">{icon ?? "▦"}</span>
            {!collapsed && <span className="sidebar__rail-label">{label}</span>}
          </button>
        ))}
      </nav>

      {/* 分隔線：換頁（導覽）與工作（監測）的界線 */}
      <div className="sidebar__divider" />

      {/* 主體：監測任務 */}
      <div className="sidebar__monitor">
        {/* group header（總計數） */}
        {!collapsed && (
          <div className="sidebar__monitor-header">
            <span className="sidebar__monitor-title">監測任務</span>
            <span className="sidebar__group-count">{sessions.length}</span>
          </div>
        )}

        {/* 等決定橘框子區（waiting>0 才出現；置頂、靜態無動畫） */}
        {waitingCount > 0 && (
          <div className="sidebar__waiting-box">
            {!collapsed && (
              <div className="sidebar__waiting-box-header">
                <span className="sidebar__waiting-box-title">等決定</span>
                <span className="sidebar__waiting-box-count">
                  {waitingCount}
                </span>
              </div>
            )}
            <div className="sidebar__waiting-box-body">
              {waitingSessions.map((s) => renderSessionRow(s, true))}
            </div>
          </div>
        )}

        {/* 其餘監測列（running 藍 → idle 灰） */}
        <div className="sidebar__monitor-body">
          {otherSessions.map((s) => renderSessionRow(s, false))}
          {sessions.length === 0 && !collapsed && (
            <div className="sidebar__empty">（雙擊任務卡開啟）</div>
          )}
        </div>

        {/* AI 對話子區塊（agentConv 嵌入式對話；點選切到 AI 團隊頁） */}
        {agentConversations.length > 0 && (
          <div className="sidebar__agent-conv-group">
            {!collapsed && (
              <div className="sidebar__agent-conv-header">
                <span className="sidebar__agent-conv-title">🤖 AI 對話</span>
                <span className="sidebar__group-count">{agentConversations.length}</span>
              </div>
            )}
            {visibleAgentConversations.map((c) => {
              const isActive = c.conversationId === activeAgentConvId;
              const dotColor = c.done
                ? "var(--success, #22c55e)"
                : c.pending || c.busy
                  ? "var(--accent)"
                  : "var(--text-muted)";
              const dotTip = c.done ? "已結束" : c.pending ? "啟動中…" : c.busy ? "執行中…" : "閒置";
              return (
                <div
                  key={c.conversationId}
                  className="sidebar__agent-conv-row"
                >
                  <button
                    type="button"
                    className={`sidebar__item sidebar__agent-conv-item${isActive ? " sidebar__item--active" : ""}`}
                    onClick={() => onSelectAgentConv?.(c.conversationId)}
                    title={c.label + (dotTip ? ` — ${dotTip}` : "")}
                  >
                    <span className="sidebar__item-icon" style={{ color: dotColor }} title={dotTip}>●</span>
                    {!collapsed && <span className="sidebar__item-label">{c.label}</span>}
                  </button>
                  {!collapsed && c.done && onHideAgentConv && (
                    <button
                      type="button"
                      className="sidebar__agent-conv-close"
                      title="從 AI 對話清單移除"
                      onClick={() => onHideAgentConv(c.conversationId)}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {!collapsed && hiddenAgentConversationCount > 0 && (
              <div className="sidebar__agent-conv-more">
                另有 {hiddenAgentConversationCount} 筆歷史已收起
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sidebar__spacer" />

      {/* 底部：主題切換 */}
      <div className="sidebar__bottom">
        <button
          className="sidebar__icon-btn"
          onClick={onToggleTheme}
          title={theme === "dark" ? "切換淺色" : "切換深色"}
        >
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>

      {/* 右緣拖曳 handle（展開態才出現；收合態固定 48px 不拖） */}
      {!collapsed && (
        <div
          className="sidebar__resize-handle"
          onMouseDown={handleHandleMouseDown}
          title="拖曳調整側欄寬度"
          role="separator"
          aria-orientation="vertical"
        />
      )}

      {/* PTY 等待輸入/錯誤 toast（portal 渲染到 body，不影響側欄版面） */}
      <PromptAlertToasts
        resolveName={(sid) => {
          const s = sessions.find((s) => s.sessionId === sid);
          return s?.taskName || sid.slice(0, 8);
        }}
        onJump={(sid) => onTabChange(sid)}
        activeSessionId={activeTab}
      />
    </aside>
  );
}
