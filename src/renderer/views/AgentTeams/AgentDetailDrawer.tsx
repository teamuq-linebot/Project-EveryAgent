/**
 * AgentDetailDrawer.tsx — 助手詳情右側滑出面板（含 draft→diff→apply 編輯狀態機）
 *
 * 狀態機（agentteams-edit-flow §4.1）：
 *   VIEW → [✏️修改] → EDITING → [存草稿] → DRAFT_PENDING
 *   DRAFT_PENDING → [查看改了什麼] → APPLY_CONFIRM → [確認套用] → (onOpenAgentOpsSession)
 *   任一狀態 + 上游衝突 → DRAFT_CONFLICT（三選一）
 */
import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type {
  AgentDetailDto,
  AgentIntroduction,
} from "../../../shared/ipcContracts";
import { typeBadgeIcon, typeBadgeLabel, modelLabel } from "./agentTeamsHelpers";
import { diffIntroduction } from "./introDiff";
import { buildApplyPrompt } from "./buildApplyPrompt";
import { IntroductionEditor } from "./IntroductionEditor";
import { IntroductionDiffViewer } from "./IntroductionDiffViewer";
import { ApplyConfirmSheet } from "./ApplyConfirmSheet";
import { DraftConflictBanner } from "./DraftConflictBanner";

// ---------------------------------------------------------------------------
// 狀態機型別
// ---------------------------------------------------------------------------

type DrawerMode =
  | "VIEW"
  | "EDITING"
  | "DRAFT_PENDING"
  | "APPLY_CONFIRM"
  | "DRAFT_CONFLICT";

// ---------------------------------------------------------------------------
// SoulMarkdown — soul.md 完整 markdown 渲染（marked + DOMPurify）
// ---------------------------------------------------------------------------
function SoulMarkdown({ markdown }: { markdown: string }): React.JSX.Element {
  const html = useMemo(() => {
    try {
      return DOMPurify.sanitize(
        marked.parse(markdown, { async: false }) as string,
      );
    } catch {
      return DOMPurify.sanitize(markdown);
    }
  }, [markdown]);
  return (
    <div
      className="at-drawer-soul-md"
      // html 已由 DOMPurify 消毒（剝 script / 事件屬性），innerHTML 安全
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ---------------------------------------------------------------------------
// WorkflowStructured — workflow.yaml 結構化呈現 + raw 摺疊
// ---------------------------------------------------------------------------

/** 解析 yaml 行：取縮排深度（以 2 空格為單位）與行內容 */
interface YamlLine {
  depth: number;
  raw: string;
  isList: boolean;
  key: string | null;
  value: string | null;
}

function parseYamlLine(line: string): YamlLine {
  const leading = line.match(/^(\s*)/)?.[1] ?? "";
  const depth = Math.floor(leading.length / 2);
  const trimmed = line.trimStart();
  const isList = trimmed.startsWith("- ");
  const content = isList ? trimmed.slice(2) : trimmed;
  const colonIdx = content.indexOf(":");
  let key: string | null = null;
  let value: string | null = null;
  if (colonIdx > 0) {
    key = content.slice(0, colonIdx).trim();
    const rest = content.slice(colonIdx + 1).trim();
    value = rest || null;
  } else if (colonIdx === -1 && content.trim()) {
    value = content.trim();
  }
  return { depth, raw: trimmed, isList, key, value };
}

function WorkflowStructured({ yaml }: { yaml: string }): React.JSX.Element {
  const [rawOpen, setRawOpen] = useState(false);

  const lines = yaml.split(/\r?\n/);

  return (
    <div className="at-workflow-structured">
      {lines.map((line, idx) => {
        if (!line.trim() || line.trim().startsWith("#")) {
          return line.trim().startsWith("#") ? (
            <div key={idx} className="at-wf-comment">
              {line.trim()}
            </div>
          ) : null;
        }
        const parsed = parseYamlLine(line);
        const indent = parsed.depth * 12;

        if (parsed.isList) {
          return (
            <div
              key={idx}
              className="at-wf-list-item"
              style={{ paddingLeft: indent + 8 }}
            >
              <span className="at-wf-bullet">•</span>
              {parsed.key ? (
                <>
                  <span className="at-wf-key">{parsed.key}</span>
                  {parsed.value && <span className="at-wf-colon">:</span>}
                  {parsed.value && (
                    <span className="at-wf-value">{parsed.value}</span>
                  )}
                </>
              ) : (
                <span className="at-wf-value">{parsed.value ?? ""}</span>
              )}
            </div>
          );
        }

        if (parsed.key && !parsed.value) {
          return (
            <div
              key={idx}
              className={
                parsed.depth === 0
                  ? "at-wf-block-title"
                  : "at-wf-block-subtitle"
              }
              style={{ paddingLeft: indent }}
            >
              {parsed.key}
            </div>
          );
        }

        if (parsed.key && parsed.value) {
          return (
            <div key={idx} className="at-wf-kv" style={{ paddingLeft: indent }}>
              <span className="at-wf-key">{parsed.key}</span>
              <span className="at-wf-colon">:</span>
              <span className="at-wf-value">{parsed.value}</span>
            </div>
          );
        }

        return (
          <div
            key={idx}
            className="at-wf-value at-wf-value--plain"
            style={{ paddingLeft: indent }}
          >
            {parsed.value ?? parsed.raw}
          </div>
        );
      })}

      <div className="at-wf-raw-toggle-row">
        <button
          type="button"
          className="at-drawer-toggle"
          onClick={() => setRawOpen((v) => !v)}
        >
          {rawOpen ? "收合原始設定檔 ▲" : "查看原始設定檔 ▼"}
        </button>
      </div>
      {rawOpen && (
        <pre className="at-drawer-workflow at-drawer-workflow--raw">{yaml}</pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// IntroductionBody — 渲染 introduction.json 結構化白話介紹（VIEW 模式）
// 已 export 供 PreviewAgentDrawer（唯讀預覽抽屜）重用（agent-teams-live-preview-card-20260613）。
// ---------------------------------------------------------------------------
export function IntroductionBody({
  intro,
}: {
  intro: AgentIntroduction;
}): React.JSX.Element {
  return (
    <>
      {intro.summary && (
        <section className="at-drawer-section">
          <p className="at-drawer-intro-summary">{intro.summary}</p>
        </section>
      )}

      {(intro.role || intro.team || intro.reports_to) && (
        <section className="at-drawer-section">
          <div className="at-drawer-intro-meta">
            {intro.role && (
              <span className="at-drawer-intro-badge">角色：{intro.role}</span>
            )}
            {intro.team && (
              <span className="at-drawer-intro-badge">組別：{intro.team}</span>
            )}
            {intro.reports_to && (
              <span className="at-drawer-intro-badge">
                直屬：{intro.reports_to}
              </span>
            )}
          </div>
        </section>
      )}

      {intro.capabilities && intro.capabilities.length > 0 && (
        <section className="at-drawer-section">
          <h4 className="at-drawer-section-title">能做什麼</h4>
          <ul className="at-drawer-intro-list">
            {intro.capabilities.map((cap, i) => (
              <li key={i}>{cap}</li>
            ))}
          </ul>
        </section>
      )}

      {intro.when_to_use && (
        <section className="at-drawer-section">
          <h4 className="at-drawer-section-title">適合找他</h4>
          <p className="at-drawer-section-text">{intro.when_to_use}</p>
        </section>
      )}
      {intro.not_for && (
        <section className="at-drawer-section">
          <h4 className="at-drawer-section-title">不適合</h4>
          <p className="at-drawer-section-text">{intro.not_for}</p>
        </section>
      )}

      {intro.inputs && (
        <section className="at-drawer-section">
          <h4 className="at-drawer-section-title">輸入</h4>
          <p className="at-drawer-section-text">{intro.inputs}</p>
        </section>
      )}
      {intro.outputs && (
        <section className="at-drawer-section">
          <h4 className="at-drawer-section-title">產出</h4>
          <p className="at-drawer-section-text">{intro.outputs}</p>
        </section>
      )}

      {intro.workflows && intro.workflows.length > 0 && (
        <section className="at-drawer-section">
          <h4 className="at-drawer-section-title">工作方式</h4>
          {intro.workflows.map((wf, i) => (
            <div key={i} className="at-drawer-intro-workflow">
              <p className="at-drawer-intro-workflow-scenario">{wf.scenario}</p>
              {wf.steps && wf.steps.length > 0 && (
                <ol className="at-drawer-intro-list at-drawer-intro-list--ordered">
                  {wf.steps.map((step, j) => (
                    <li key={j}>{step}</li>
                  ))}
                </ol>
              )}
            </div>
          ))}
        </section>
      )}

      {intro.examples && intro.examples.length > 0 && (
        <section className="at-drawer-section">
          <h4 className="at-drawer-section-title">範例情境</h4>
          <ul className="at-drawer-intro-list">
            {intro.examples.map((ex, i) => (
              <li key={i}>{ex}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// AgentDetailDrawer — 主元件
// ---------------------------------------------------------------------------
export interface AgentDetailDrawerProps {
  teamId: string;
  agentName: string;
  onClose: () => void;
  onOpenAgentOpsSession?: (label: string, prompt: string) => void;
  /** 若 true，以 docked 模式渲染（無 overlay 遮罩、無 fixed 定位） */
  docked?: boolean;
}

export function AgentDetailDrawer({
  teamId,
  agentName,
  onClose,
  onOpenAgentOpsSession,
  docked = false,
}: AgentDetailDrawerProps): React.JSX.Element {
  // ── 詳情載入狀態 ──────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<AgentDetailDto | null>(null);
  const abortRef = useRef(false);
  /** 同一 agent 編輯期間只開一次修改協助對話；切換 agent 時由 getDetail effect 重置 */
  const editAssistOpenedRef = useRef(false);

  // ── 狀態機 ────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<DrawerMode>("VIEW");
  const [draftIntro, setDraftIntro] = useState<AgentIntroduction | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);
  const [draftLoading, setDraftLoading] = useState(false);
  const [discardConfirming, setDiscardConfirming] = useState(false);

  // ── 可拖曳寬度（at-drawer-width；clamp 320–960；預設 400）──────────────
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("at-drawer-width");
      if (!raw) return 400;
      const v = Number(raw);
      return Number.isFinite(v) ? Math.min(960, Math.max(320, v)) : 400;
    } catch {
      return 400;
    }
  });
  const drawerDraggingRef = useRef(false);
  const drawerDragStartXRef = useRef(0);
  const drawerDragStartWidthRef = useRef(0);
  const drawerLastWidthRef = useRef(drawerWidth);

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      drawerDraggingRef.current = true;
      drawerDragStartXRef.current = e.clientX;
      drawerDragStartWidthRef.current = drawerWidth;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
    },
    [drawerWidth],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!drawerDraggingRef.current) return;
      const delta = e.clientX - drawerDragStartXRef.current;
      const next = Math.min(
        960,
        Math.max(320, drawerDragStartWidthRef.current - delta),
      );
      drawerLastWidthRef.current = next;
      setDrawerWidth(next);
    };
    const onMouseUp = () => {
      if (!drawerDraggingRef.current) return;
      drawerDraggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      try {
        localStorage.setItem(
          "at-drawer-width",
          String(drawerLastWidthRef.current),
        );
      } catch {
        /* storage 不可寫 */
      }
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // ESC 關閉
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── getDetail ──────────────────────────────────────────────────────────────
  useEffect(() => {
    abortRef.current = false;
    // 切換 agent 時重置「修改協助對話已開」旗標，允許下次再開
    editAssistOpenedRef.current = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    setMode("VIEW");
    setDraftIntro(null);
    setDiscardConfirming(false);

    const bridge = (
      window as Window &
        typeof globalThis & {
          tuq?: {
            agentOrg?: {
              getDetail: (p: {
                teamId: string;
                agentName: string;
              }) => Promise<{
                ok: boolean;
                data?: AgentDetailDto | null;
                error?: string;
              }>;
              getDraft: (p: {
                teamId: string;
                agentName: string;
              }) => Promise<{
                ok: boolean;
                data?: { draft: AgentIntroduction | null; conflict: boolean };
                error?: string;
              }>;
              clearDraft: (p: {
                teamId: string;
                agentName: string;
              }) => Promise<{ ok: boolean; error?: string }>;
              saveDraft: (p: {
                teamId: string;
                agentName: string;
                draft: AgentIntroduction;
                baseHash?: string;
              }) => Promise<{ ok: boolean; error?: string }>;
            };
          };
        }
    ).tuq?.agentOrg;

    if (!bridge) {
      setError("agentOrg bridge 未就緒");
      setLoading(false);
      return;
    }

    bridge
      .getDetail({ teamId, agentName })
      .then(async (r) => {
        if (abortRef.current) return;
        if (!r.ok) {
          setError(r.error ?? "讀取失敗");
          setLoading(false);
          return;
        }
        setDetail(r.data ?? null);
        setLoading(false);

        // 載入後立即檢查是否有本機草稿
        if (!r.data?.introduction) return;
        setDraftLoading(true);
        try {
          const dr = await bridge.getDraft({ teamId, agentName });
          if (abortRef.current) return;
          if (dr.ok && dr.data?.draft) {
            setDraftIntro(dr.data.draft);
            setMode(dr.data.conflict ? "DRAFT_CONFLICT" : "DRAFT_PENDING");
          }
        } catch {
          // 草稿載入失敗靜默（非阻塞）
        } finally {
          if (!abortRef.current) setDraftLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (abortRef.current) return;
        setError(String(e));
        setLoading(false);
      });

    // 訂閱 draftUpdated push + 啟動 fs.watch（P3 AI 共編機制）
    const agentOrgBridge = (window as Window & typeof globalThis & { tuq?: { agentOrg?: {
      onDraftUpdated?: (handler: (payload: { teamId: string; agentName: string; draft: AgentIntroduction | null }) => void) => () => void;
      watchDraft?: (p: { teamId: string; agentName: string }) => Promise<{ ok: boolean }>;
      unwatchDraft?: (p: { teamId: string; agentName: string }) => Promise<{ ok: boolean }>;
    } } }).tuq?.agentOrg;

    // 啟動 fs.watch 監看草稿檔（靜默失敗不影響功能）
    agentOrgBridge?.watchDraft?.({ teamId, agentName }).catch(() => {});

    const unsubscribe = agentOrgBridge?.onDraftUpdated?.((payload) => {
      if (payload.teamId !== teamId || payload.agentName !== agentName) return;
      if (payload.draft === null) return; // AI 寫壞 JSON，靜默（保留上一個有效版本）
      setDraftIntro(payload.draft);
      setMode("DRAFT_PENDING");
    });

    return () => {
      abortRef.current = true;
      unsubscribe?.();
      // 停止 fs.watch（靜默失敗）
      agentOrgBridge?.unwatchDraft?.({ teamId, agentName }).catch(() => {});
    };
  }, [teamId, agentName]);

  // ── 狀態機 handlers ────────────────────────────────────────────────────────

  /** ✏️修改：進入 EDITING 模式，初始化 draft 為 detail.introduction 的副本；
   *  同時開啟修改協助 AI 對話（若 onOpenAgentOpsSession 存在且本次尚未開過） */
  const handleStartEditing = useCallback(() => {
    if (!detail?.introduction) return;
    setDraftIntro({ ...detail.introduction });
    setMode("EDITING");

    // 開啟修改協助 AI 對話（optional prop 不存在時跳過；同一 agent 只開一次）
    if (onOpenAgentOpsSession && !editAssistOpenedRef.current) {
      editAssistOpenedRef.current = true;
      const editAssistLabel = `🤖 修改協助 ${agentName}`;
      const editAssistPrompt =
        `/tuq-agent 我正在編輯 ${teamId}/${agentName} 的白話介紹（introduction.json）草稿，` +
        `請先讀取目前已有的簡介內容（介紹格式規範見 agent-introduction.md），` +
        `等候我的進一步指示。先不要修改任何檔案，不要套用任何變更。`;
      onOpenAgentOpsSession(editAssistLabel, editAssistPrompt);
    }
  }, [detail, onOpenAgentOpsSession, teamId, agentName]);

  /** EDITING 模式下用戶改欄位 */
  const handleDraftChange = useCallback((updated: AgentIntroduction) => {
    setDraftIntro(updated);
  }, []);

  /** 存草稿（EDITING → DRAFT_PENDING） */
  const handleSaveDraft = useCallback(async () => {
    if (!draftIntro) return;
    const bridge = (window as Window & typeof globalThis & { tuq?: { agentOrg?: { saveDraft: (p: { teamId: string; agentName: string; draft: AgentIntroduction }) => Promise<{ ok: boolean; error?: string }> } } }).tuq?.agentOrg;
    if (!bridge) return;
    setDraftSaving(true);
    try {
      await bridge.saveDraft({ teamId, agentName, draft: draftIntro });
      setMode("DRAFT_PENDING");
    } catch {
      // 失敗靜默（用戶可再試）
    } finally {
      setDraftSaving(false);
    }
  }, [draftIntro, teamId, agentName]);

  /** 放棄草稿：clearDraft → VIEW */
  const handleDiscardDraft = useCallback(async () => {
    const bridge = (window as Window & typeof globalThis & { tuq?: { agentOrg?: { clearDraft: (p: { teamId: string; agentName: string }) => Promise<{ ok: boolean }> } } }).tuq?.agentOrg;
    if (bridge) {
      try { await bridge.clearDraft({ teamId, agentName }); } catch { /* 靜默 */ }
    }
    setDraftIntro(null);
    setMode("VIEW");
    setDiscardConfirming(false);
  }, [teamId, agentName]);

  /** 取消編輯（不清草稿：若之前有存稿 → 回 DRAFT_PENDING；否則 → VIEW） */
  const handleCancelEditing = useCallback(() => {
    setMode(draftIntro ? "DRAFT_PENDING" : "VIEW");
  }, [draftIntro]);

  /** 查看這次改了什麼 → APPLY_CONFIRM */
  const handleViewDiff = useCallback(() => {
    setMode("APPLY_CONFIRM");
  }, []);

  /** 取消套用 → 回 DRAFT_PENDING */
  const handleCancelApply = useCallback(() => {
    setMode("DRAFT_PENDING");
  }, []);

  /** 確認套用：buildApplyPrompt → onOpenAgentOpsSession → clearDraft */
  const handleConfirmApply = useCallback(() => {
    if (!detail?.introduction || !draftIntro || !onOpenAgentOpsSession) return;
    const diffs = diffIntroduction(detail.introduction, draftIntro);
    if (diffs.length === 0) {
      setMode("DRAFT_PENDING");
      return;
    }
    const prompt = buildApplyPrompt(teamId, agentName, diffs);
    const label = `✏️ 套用修改 ${agentName}`;

    // 套用前非阻塞備份（失敗不擋流程）
    const backupBridge = (window as Window & typeof globalThis & { tuq?: { agentOrg?: { backupIntroduction?: (p: { teamId: string; agentName: string }) => Promise<unknown> } } }).tuq?.agentOrg;
    backupBridge?.backupIntroduction?.({ teamId, agentName }).catch(() => {});

    onOpenAgentOpsSession(label, prompt);

    // 套用後清草稿（非阻塞）
    const clearBridge = (window as Window & typeof globalThis & { tuq?: { agentOrg?: { clearDraft?: (p: { teamId: string; agentName: string }) => Promise<unknown> } } }).tuq?.agentOrg;
    clearBridge?.clearDraft?.({ teamId, agentName }).catch(() => {});

    setDraftIntro(null);
    setMode("VIEW");
  }, [detail, draftIntro, onOpenAgentOpsSession, teamId, agentName]);

  /** 衝突：使用我的草稿（保留 draftIntro，視為 DRAFT_PENDING） */
  const handleConflictUseMine = useCallback(() => {
    setMode("DRAFT_PENDING");
  }, []);

  /** 衝突：使用最新版本（clearDraft → VIEW） */
  const handleConflictUseLatest = useCallback(() => {
    void handleDiscardDraft();
  }, [handleDiscardDraft]);

  /** 衝突：先不動（保留草稿，暫時轉回 DRAFT_PENDING） */
  const handleConflictIgnore = useCallback(() => {
    setMode("DRAFT_PENDING");
  }, []);

  // ── 計算 diffs（APPLY_CONFIRM 用）─────────────────────────────────────────
  const diffs = useMemo(() => {
    if (mode !== "APPLY_CONFIRM" || !detail?.introduction || !draftIntro) return [];
    return diffIntroduction(detail.introduction, draftIntro);
  }, [mode, detail, draftIntro]);

  // ── Header ─────────────────────────────────────────────────────────────────
  const icon = detail ? typeBadgeIcon(detail.roleInTeam) : "👤";
  const displayLabel = detail
    ? (detail.displayName ?? detail.title ?? detail.name)
    : agentName;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`at-drawer${docked ? " at-drawer--docked" : ""}`} role="complementary" aria-label="助手詳情">
      {/* 遮罩（點擊關閉）— docked 模式不渲染 */}
      {!docked && <div className="at-drawer-overlay" onClick={onClose} />}

      {/* 面板主體 */}
      <div className={`at-drawer-panel${mode === "EDITING" ? " at-drawer--editing" : ""}`} style={docked ? undefined : { width: drawerWidth }}>
        {/* 拖曳把手（左緣）— docked 模式由父層 splitter 控制寬度，不渲染 */}
        {!docked && (
          <div
            className="at-drawer-resize-handle"
            onMouseDown={handleResizeMouseDown}
            role="separator"
            aria-orientation="vertical"
            aria-label="調整詳情面板寬度"
          />
        )}

        {/* 頭部 */}
        <div className="at-drawer-header">
          <div className="at-drawer-title-row">
            <span className="at-drawer-icon">{icon}</span>
            <div className="at-drawer-title-block">
              <h3 className="at-drawer-name">{displayLabel}</h3>
              {detail && <p className="at-drawer-team">{teamId} 組</p>}
            </div>
          </div>
          <div className="at-drawer-header-actions">
            {/* EDITING：儲存草稿 / 取消 移到 header */}
            {mode === "EDITING" && (
              <>
                <button
                  type="button"
                  className="at-drawer-headbtn at-drawer-headbtn--labeled at-drawer-headbtn--primary"
                  onClick={() => void handleSaveDraft()}
                  disabled={draftSaving}
                >
                  {draftSaving ? "儲存中…" : "儲存草稿"}
                </button>
                <button
                  type="button"
                  className="at-drawer-headbtn at-drawer-headbtn--labeled"
                  onClick={handleCancelEditing}
                  disabled={draftSaving}
                >
                  取消
                </button>
              </>
            )}
            {/* DRAFT_PENDING：header 提示 + 三動作 */}
            {mode === "DRAFT_PENDING" && (
              <div className="at-drawer-header-draft-indicator">
                <span className="at-drawer-header-draft-indicator__label">📝 有未套用的修改</span>
                <div className="at-drawer-header-draft-indicator__actions">
                  <button type="button" className="at-drawer-headbtn at-drawer-headbtn--labeled at-drawer-headbtn--primary" onClick={handleViewDiff}>查看改了什麼</button>
                  <button type="button" className="at-drawer-headbtn at-drawer-headbtn--labeled" onClick={handleStartEditing}>繼續編輯</button>
                  <button type="button" className="at-drawer-headbtn at-drawer-headbtn--labeled at-drawer-headbtn--danger" onClick={() => setDiscardConfirming(true)}>移除草稿</button>
                </div>
              </div>
            )}
            {/* ✏️修改 — 僅在 VIEW 且有 introduction 時顯示 */}
            {onOpenAgentOpsSession && detail?.introduction && mode === "VIEW" && (
              <button
                type="button"
                className="at-drawer-headbtn at-drawer-headbtn--labeled"
                title="修改這位助手的介紹"
                onClick={handleStartEditing}
              >
                ✏️ 修改
              </button>
            )}
            <button
              type="button"
              className="at-drawer-close"
              onClick={onClose}
              aria-label="關閉"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 徽章列（type + model） */}
        {detail && (
          <div className="at-drawer-badges">
            <span className="at-drawer-badge at-drawer-badge--type">
              {typeBadgeIcon(detail.roleInTeam)}{" "}
              {typeBadgeLabel(detail.roleInTeam)}
            </span>
            {detail.model && (
              <span className="at-drawer-badge at-drawer-badge--model">
                {modelLabel(detail.model)}（{detail.model}）
              </span>
            )}
          </div>
        )}

        {/* loading */}
        {loading && (
          <div className="at-drawer-body">
            <div className="at-drawer-skeleton" />
            <div className="at-drawer-skeleton at-drawer-skeleton--wide" />
            <div className="at-drawer-skeleton" />
            <div className="at-drawer-skeleton at-drawer-skeleton--wide" />
            <p className="at-drawer-loading-hint">正在載入助手資料…</p>
          </div>
        )}

        {/* error */}
        {!loading && error && (
          <div className="at-drawer-body">
            <div className="at-drawer-error">
              <span>⚠️</span>
              <span>讀取失敗：{error}</span>
            </div>
          </div>
        )}

        {/* 內容（依狀態機模式切換） */}
        {!loading && !error && detail && (
          <div className="at-drawer-body">
            {/* ── DRAFT_CONFLICT ─────────────────────── */}
            {mode === "DRAFT_CONFLICT" && (
              <DraftConflictBanner
                onUseMine={handleConflictUseMine}
                onUseLatest={handleConflictUseLatest}
                onIgnore={handleConflictIgnore}
              />
            )}

            {/* ── EDITING ────────────────────────────── */}
            {mode === "EDITING" && draftIntro && (
              <IntroductionEditor
                draft={draftIntro}
                onChange={handleDraftChange}
                onCancel={handleCancelEditing}
                onSaveDraft={() => void handleSaveDraft()}
                saving={draftSaving}
              />
            )}

            {/* ── APPLY_CONFIRM ──────────────────────── */}
            {mode === "APPLY_CONFIRM" && (
              <>
                <IntroductionDiffViewer diffs={diffs} />
                <ApplyConfirmSheet
                  diffs={diffs}
                  onConfirm={handleConfirmApply}
                  onCancel={handleCancelApply}
                />
              </>
            )}

            {/* ── VIEW / DRAFT_PENDING / DRAFT_CONFLICT（底部 body） ── */}
            {(mode === "VIEW" || mode === "DRAFT_PENDING" || mode === "DRAFT_CONFLICT") && (
              <>
                {/* 放棄草稿二次確認（P2-C） */}
                {mode === "DRAFT_PENDING" && discardConfirming && (
                  <div className="at-drawer-discard-confirm">
                    <p>確定要放棄這份草稿修改嗎？放棄後無法復原。</p>
                    <div className="at-drawer-discard-confirm__actions">
                      <button
                        type="button"
                        className="at-drawer-discard-confirm__btn at-drawer-discard-confirm__btn--danger"
                        onClick={() => { setDiscardConfirming(false); void handleDiscardDraft(); }}
                      >
                        確定放棄
                      </button>
                      <button
                        type="button"
                        className="at-drawer-discard-confirm__btn"
                        onClick={() => setDiscardConfirming(false)}
                      >
                        先不要
                      </button>
                    </div>
                  </div>
                )}

                {/* 介紹內容（有 introduction.json → 結構化；否則 fallback soul/workflow） */}
                {detail.introduction ? (
                  <IntroductionBody intro={detail.introduction} />
                ) : (
                  <>
                    {detail.trigger && (
                      <section className="at-drawer-section">
                        <h4 className="at-drawer-section-title">他負責什麼</h4>
                        <p className="at-drawer-section-text">{detail.trigger}</p>
                      </section>
                    )}
                    {detail.notFor && (
                      <section className="at-drawer-section">
                        <h4 className="at-drawer-section-title">不適合找他做</h4>
                        <p className="at-drawer-section-text">{detail.notFor}</p>
                      </section>
                    )}
                    <section className="at-drawer-section">
                      <h4 className="at-drawer-section-title">工作方式</h4>
                      {detail.workflowYaml ? (
                        <WorkflowStructured yaml={detail.workflowYaml} />
                      ) : (
                        <p className="at-drawer-empty-note">
                          （此助手沒有 workflow 定義）
                        </p>
                      )}
                    </section>
                    {detail.soulExcerpt && (
                      <section className="at-drawer-section">
                        <h4 className="at-drawer-section-title">關於他</h4>
                        <SoulMarkdown markdown={detail.soulExcerpt} />
                      </section>
                    )}
                  </>
                )}

                {/* 活動 */}
                <section className="at-drawer-section">
                  <h4 className="at-drawer-section-title">活動</h4>
                  <p className="at-drawer-section-text">
                    累計工作記錄 {detail.worklogCount} 筆
                  </p>
                </section>
              </>
            )}

            {/* 草稿載入中提示（極短暫顯示） */}
            {draftLoading && (
              <p className="at-drawer-loading-hint">正在檢查草稿…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AgentDetailDrawer;
