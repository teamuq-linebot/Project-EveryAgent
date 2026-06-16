/**
 * AgentTeamsView.tsx — AI 團隊組織樹（由上往下 org-chart 風格）
 * W2: agent-teams-view-impl-20260607
 * W3: 詳情抽屜（含 workflow 內容）
 *
 * 資料來源：window.tuq.agentOrg.scan() → IpcResult<AgentOrgTree>
 * 佈局：工作群組橫排（頂層）→ 團隊節點（展開/收合）→ manager → workers 橫排
 *
 * 拆分後各職責檔：
 *   agentTeamsHelpers.tsx — roleIcon / modelLabel / typeBadge* / AgentOpsActions
 *   AgentDetailDrawer.tsx — 抽屜面板 + SoulMarkdown + WorkflowStructured
 *   RootPathEditor.tsx    — 路徑設定列
 */
import React, { useEffect, useState, useCallback, useRef } from "react";
import type { AgentTeamDto, AgentOrgRootInfo, CliStatusDto, AgentTeamCreateSpecInput, TeamSource } from "../../../shared/ipcContracts";
import { DEFAULT_GROUP_CONFIG, groupTeams, moveTeamToGroup } from "./groupConfig";
import { AgentOrgList } from "./AgentOrgList";
import { useGroupConfig } from "./useGroupConfig";
import { GroupConfigEditor } from "./GroupConfigEditor";
import { useGroupDrawerWidth } from "./useGroupDrawerWidth";
import type { GroupConfig } from "./groupConfig";
import { AgentDetailDrawer } from "./AgentDetailDrawer";
import { RootPathEditor } from "./RootPathEditor";
import type { AgentConversation } from "../../hooks/useAgentConversation";
import { AgentConversationArea } from "./AgentConversationArea";
import { AgentTermView } from "./AgentTermView";
import { stripAgentsSuffix } from "./agentOrgPath";
import { TeamFolderPicker } from "./TeamFolderPicker";
import type { TeamSessionRequest } from "./TeamFolderPicker";
import type { CliId } from "../../../shared/cliRegistry";
import { buildCreateTeamPrompt, normalizeAgentSkillPrompt, typeBadgeLabel, buildTeamAuditPrompt, buildTeamReviewPrompt, teamDisplayId, teamDisplayFolderPath } from "./agentTeamsHelpers";
import { teamLabelOf } from "./GroupZone";
import { humanizeCreateError } from "./createSpecHelpers";
import { previewIntroductionFor } from "./previewIntroduction";
import { PreviewAgentDrawer } from "./PreviewAgentDrawer";
import { TeamDetailDrawer } from "./TeamDetailDrawer";

// 團隊資料夾顯示路徑：見 agentTeamsHelpers.teamDisplayFolderPath（純函式，依各團隊所屬來源根
// 計算，對齊 main 端 openTeamFolder 的 resolveTeamSourceRoot + teamPathPart 語意）。

// 底部終端 overlay 最小/最大高度（px）
const TERM_OVERLAY_MIN_H = 120;
const TERM_OVERLAY_MAX_H_RATIO = 0.80;

// ---------------------------------------------------------------------------
// AgentTeamsView — 主元件
// ---------------------------------------------------------------------------

interface AgentTeamsViewProps {
  /** 由 App.tsx 提升傳入的嵌入式對話狀態（useAgentConversation hook 實例）。 */
  conv: AgentConversation;
  /** 由 App.tsx 注入：開啟真實 session（跳到左側監測列 + session tab）。
   *  目前僅「💬 對話」按鈕使用；其餘嵌入式入口仍走 openAgentSession。 */
  onOpenTeamSession?: (
    label: string,
    prompt: string,
    projectPath: string,
    tool: CliId,
    taskId: string,
    milestoneId: string | null,
    initialTeam: string,
  ) => void;
}

/** model 監測能力誠實標註（計畫 §2.2/§3.2）。 */
const MODEL_LABELS: Record<CliId, string> = {
  claude: "Claude Code（卡片+終端）",
  codex: "Codex（終端；卡片開發中）",
  antigravity: "Gemini（僅終端）",
};

/** app_settings key for per-team folder history（key: teamFolders:<teamId>）。 */
const TEAM_FOLDERS_KEY_PREFIX = 'teamFolders:';
const TEAM_FOLDERS_MAX = 8;

/** 讀指定團隊的資料夾歷史（失敗/缺 → []）。 */
async function readTeamFolders(teamId: string): Promise<string[]> {
  try {
    const key = TEAM_FOLDERS_KEY_PREFIX + teamId;
    const r = await window.tuq.settings.get(key);
    if (!r.ok || !r.data) return [];
    const raw = (r.data as { folders?: unknown }).folders;
    if (!Array.isArray(raw)) return [];
    return raw.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** 把 folder prepend 進歷史（去重、截斷 TEAM_FOLDERS_MAX）後寫回。 */
async function saveTeamFolder(teamId: string, folder: string): Promise<void> {
  try {
    const key = TEAM_FOLDERS_KEY_PREFIX + teamId;
    const existing = await readTeamFolders(teamId);
    const next = [folder, ...existing.filter((f) => f !== folder)].slice(0, TEAM_FOLDERS_MAX);
    await window.tuq.settings.set({ key, valueJson: JSON.stringify({ folders: next }) });
  } catch {
    /* non-fatal：寫失敗不影響開 session */
  }
}

export default function AgentTeamsView({ conv, onOpenTeamSession }: AgentTeamsViewProps): React.JSX.Element {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teams, setTeams] = useState<AgentTeamDto[]>([]);
  const [rootInfo, setRootInfo] = useState<AgentOrgRootInfo | null>(null);
  // 多來源清單（sourceId → path）；詳情抽屜顯示路徑用，對齊 main 端開資料夾語意。
  // 與 doScan 一起載入；分組設定的「＋ 新增資料夾」(handleAddTeamSource) 變更後一併刷新。
  const [teamSources, setTeamSources] = useState<TeamSource[]>([]);
  // scan 中讀不到的成員路徑清單（parseWarnings）；非空時顯示警示列
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  // parseWarnings 展開/收合狀態
  const [warningExpanded, setWarningExpanded] = useState(false);

  // 分組設定持久化（批次 4）
  const { groupConfig: persistedGroupConfig, setGroupConfig } = useGroupConfig();
  // 載入中 null 時用 DEFAULT 過渡，避免空圖閃爍；就緒後切換到持久化設定
  const activeGroupConfig = persistedGroupConfig ?? DEFAULT_GROUP_CONFIG;

  // 分組設定面板開關（批次 5）
  const [showGroupEditor, setShowGroupEditor] = useState(false);
  // Batch A：開抽屜時的目標群組 + 模式（供「✏️ 編輯」聚焦該群、「＋ 新增工作群組」直接進新增態）。
  // 採加法：showGroupEditor 仍是主開關，{} = 既有無 target 行為（⚙ 更多 → 🗂 分組設定）。
  const [groupEditorTarget, setGroupEditorTarget] = useState<{ focusGroupId?: string; mode?: 'edit' | 'add' }>({});
  // 分組設定抽屜寬度（Batch 2：可拖拉調寬＋localStorage 持久化）
  const { width: groupDrawerWidth, handleResizeStart: handleGroupDrawerResizeStart } = useGroupDrawerWidth();

  // 抽屜狀態：null = 關閉
  const [drawerSel, setDrawerSel] = useState<{ teamId: string; agentName: string } | null>(null);

  // 即時預覽卡成員選取（agentteams-preview-members-instruction）：null = 未選。
  // 與真團隊詳情抽屜 drawerSel 互斥共用右欄（開一個必清另一個）。
  const [previewMemberSel, setPreviewMemberSel] = useState<{ who: "manager" | number } | null>(null);
  // 開著「團隊詳情/設定」抽屜的 teamId（null = 未開）；與 drawerSel / previewMemberSel 互斥共用右欄。
  const [teamDetailSel, setTeamDetailSel] = useState<string | null>(null);

  // 路徑設定列開關
  const [showRootEditor, setShowRootEditor] = useState(false);

  // 建立 AI 團隊：async 執行中 loading 態
  const [opening, setOpening] = useState(false);

  // CLI 選擇器彈窗狀態
  const [cliPickerOpen, setCliPickerOpen] = useState(false);
  const [cliPickerContext, setCliPickerContext] = useState<{ label: string; prompt: string; initialSkill?: string | null; onOpened?: (conversationId: string | null) => void } | null>(null);
  const [availableClis, setAvailableClis] = useState<CliStatusDto[]>([]);

  // TeamFolderPicker 彈窗狀態：null = 關閉
  const [folderPickerState, setFolderPickerState] = useState<{
    teamId: string;
    teamLabel: string;
    recentFolders: string[];
    /** view 端 detect 後過濾 installed 的可選模型（含誠實監測標註）。 */
    availableModels: { id: CliId; label: string }[];
    /** 彈窗確認後要執行的後續（label + prompt + 裸 skillName 已確定）。 */
    onResolve: (r: TeamSessionRequest) => void;
  } | null>(null);

  // 收合的 teamId Set（React Flow org-chart 用）
  // 預設全收：teams 載入後以 useEffect 設為所有 teamId，初始畫面只顯示群→團隊兩層
  const [collapsedTeams, setCollapsedTeams] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (teams.length > 0) {
      // 預設全收合，但排除第一個群組的第一個 team（讓首屏立即看到成員）
      const grouped = groupTeams(teams, activeGroupConfig);
      const firstTeamId = grouped[0]?.teams[0]?.id;
      const allIds = teams.map((t) => t.id);
      setCollapsedTeams(new Set(firstTeamId ? allIds.filter((id) => id !== firstTeamId) : allIds));
    }
  }, [teams]); // eslint-disable-line react-hooks/exhaustive-deps

  // 收合的 groupId Set（React Flow org-chart 用）
  // 預設全展開：群組層預設顯示（讓使用者看到所有團隊），可點群節點收合
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Batch A：群組 header「✏️ 編輯」→ 開抽屜、聚焦該群並自動進改名態。
  // 供 Batch C 從 AgentOrgList 透過 onEditGroup prop 呼叫。
  const handleEditGroup = useCallback((groupId: string) => {
    setGroupEditorTarget({ focusGroupId: groupId, mode: 'edit' });
    setShowGroupEditor(true);
  }, []);

  // Batch A：清單底部「＋ 新增工作群組」→ 開抽屜並直接進新增群模式。
  // 供 Batch C 從 AgentOrgList 透過 onAddGroup prop 呼叫。
  const handleAddGroupFromList = useCallback(() => {
    setGroupEditorTarget({ mode: 'add' });
    setShowGroupEditor(true);
  }, []);

  // Batch B：群組 header「✨ 建團隊」→ 開建團隊對話（帶該群 context），
  // 新團隊建立並 scan 回來後自動歸入被點的群（handler + effect 定義於 openAgentSession 之後）。
  // 待歸群的目標 groupId（null = 無待處理）。
  const pendingGroupRef = useRef<string | null>(null);
  // 按下建團隊當下的 team id 快照，用來偵測 scan 後新增的 team。
  const knownTeamIdsRef = useRef<Set<string>>(new Set());

  // 規格化完成偵測去重（Batch 2b）：marker 會持續留在逐字稿裡，
  // 已處理過的 teamId 不再重複呼叫 setStandardized / doScan。
  const standardizedHandledRef = useRef<Set<string>>(new Set());

  // 即時預覽卡（agent-teams-live-preview-card-20260613 批 2）：
  //   draftSpec     — 對話偵測到的建隊 spec（批 1 回拋；含 null 代表尚未偵測到/已清除）
  //   previewGroupId — 預覽卡要長在哪個群組（按下「✨ 建團隊」當下記住）
  //   creatingPreview — 按「建立」後 async 執行中
  //   previewStatus  — 建立過程/失敗的白話狀態字串（null = 無）
  const [draftSpec, setDraftSpec] = useState<AgentTeamCreateSpecInput | null>(null);
  const [previewGroupId, setPreviewGroupId] = useState<string | null>(null);
  const [creatingPreview, setCreatingPreview] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  // F2 跨對話失配修復：記住「按建團隊時開的那條對話」id。
  //   只有來源對話偵測到的 spec 才會灌進預覽卡（onCreateSpecChange 比對此 id）；
  //   active 切離此對話時，清掉預覽卡（draftSpec/previewGroupId）避免長錯群或顯示別條內容。
  const [previewConversationId, setPreviewConversationId] = useState<string | null>(null);
  // 同步 ref 鏡像：供 onCreateSpecChange handler 在 closure 內讀最新值，免把它列進 deps 而重建 callback。
  const previewConversationIdRef = useRef<string | null>(null);
  useEffect(() => { previewConversationIdRef.current = previewConversationId; }, [previewConversationId]);

  // 切換收合 groupId
  const handleToggleGroupCollapse = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const bridge = window.tuq.agentOrg;

  const doScan = useCallback((opts?: { silent?: boolean }) => {
    let cancelled = false;
    if (!opts?.silent) setLoading(true);
    setError(null);

    // 先拿根路徑資訊
    bridge.getRoot().then((rr) => {
      if (cancelled) return;
      if (rr.ok && rr.data) setRootInfo(rr.data);
    }).catch(() => { /* non-fatal */ });

    // 多來源清單（詳情抽屜顯示路徑用）；non-fatal，失敗時退回 default 根。
    bridge.listSources().then((sr) => {
      if (cancelled) return;
      if (sr.ok && sr.data) setTeamSources(sr.data);
    }).catch(() => { /* non-fatal */ });

    bridge.scan().then((r) => {
      if (cancelled) return;
      if (!r.ok) {
        setError(r.error ?? "掃描失敗");
      } else {
        setTeams(r.data?.teams ?? []);
        setParseWarnings(r.data?.parseWarnings ?? []);
        setWarningExpanded(false);
      }
      setLoading(false);
    }).catch((e: unknown) => {
      if (cancelled) return;
      setError(String(e));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [bridge]);

  useEffect(() => {
    const cleanup = doScan();
    return cleanup;
  }, [doScan]);

  // 就地新增一個團隊資料夾來源（給「分組設定」的資料夾欄位旁的「＋ 新增資料夾」用）：
  // 開資料夾選擇器 → 用既有 addSource 寫入（同 TeamSourcesEditor 的那條路徑）→ 刷新下拉清單。
  // 回傳新來源 id（成功）或 undefined（取消/失敗）；不在此處綁群組，交由呼叫端走既有 onSourceChange。
  const handleAddTeamSource = useCallback(async (): Promise<string | undefined> => {
    try {
      const picked = await window.tuq.dialog.openDirectory();
      if (!picked.ok || !picked.data) return undefined; // 使用者取消或失敗
      const folderPath: string = picked.data;
      // 預設顯示名取資料夾最後一段（白話、可改）；面向非工程師故用「資料夾」字眼。
      const segs = folderPath.split(/[\\/]/).filter(Boolean);
      const defaultLabel = segs[segs.length - 1] || "新資料夾";
      const input = window.prompt("幫這個資料夾位置取個好認的名字：", defaultLabel);
      if (input === null) return undefined; // 使用者取消命名
      const label = input.trim() || defaultLabel;

      const prevIds = new Set(teamSources.map((s) => s.id));
      const r = await window.tuq.agentOrg.addSource({ label, path: folderPath });
      if (!r.ok) {
        // r.error 可能含技術細節/路徑，禁穿透給非工程師；保留 console 供除錯。
        console.error("[addTeamSource] failed", r.error);
        window.alert("加入資料夾時發生問題，請確認資料夾存在、且雲端硬碟連線正常後再試一次。");
        return undefined;
      }
      setTeamSources(r.data); // 刷新下拉清單（新來源即可被選到）
      const created = r.data.find((s) => !prevIds.has(s.id));
      return created?.id;
    } catch (e) {
      console.error("[addTeamSource] error", e);
      window.alert("加入資料夾時發生問題，請稍後再試。");
      return undefined;
    }
  }, [teamSources]);

  const handleSelectAgent = useCallback((teamId: string, agentName: string) => {
    setDrawerSel({ teamId, agentName });
    setPreviewMemberSel(null); // 互斥：開真團隊抽屜時關預覽抽屜
    setTeamDetailSel(null); // 互斥：關團隊詳情抽屜
  }, []);

  // 點預覽卡成員 tile → 開右欄唯讀預覽抽屜（與真團隊抽屜互斥共用右欄）。
  const handleSelectPreviewMember = useCallback((who: "manager" | number) => {
    setPreviewMemberSel({ who });
    setDrawerSel(null);
    setTeamDetailSel(null); // 互斥：關團隊詳情抽屜
  }, []);

  // 開團隊詳情/設定抽屜（ⓘ 詳情鈕）；與 agent 詳情、預覽成員抽屜互斥共用右欄。
  const handleOpenTeamDetail = useCallback((teamId: string) => {
    setTeamDetailSel(teamId);
    setDrawerSel(null);
    setPreviewMemberSel(null);
  }, []);

  const handleCloseDrawer = useCallback(() => {
    setDrawerSel(null);
  }, []);

  // 右側抽屜欄寬（docked 模式）
  const [drawerColWidth, setDrawerColWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('at-drawer-col-width')
      if (!raw) return 400
      const v = Number(raw)
      if (!Number.isFinite(v) || v < 280 || v > 700) return 400
      return v
    } catch {
      return 400
    }
  })
  const drawerColDraggingRef = useRef(false)
  const drawerColDragStartXRef = useRef(0)
  const drawerColDragStartWidthRef = useRef(0)
  const drawerColLastWidthRef = useRef(drawerColWidth)

  const handleDrawerSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    drawerColDraggingRef.current = true
    drawerColDragStartXRef.current = e.clientX
    drawerColDragStartWidthRef.current = drawerColWidth
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [drawerColWidth])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!drawerColDraggingRef.current) return
      // 向左拖（負 delta）→ 右欄增寬
      const delta = drawerColDragStartXRef.current - e.clientX
      const next = Math.min(700, Math.max(280, drawerColDragStartWidthRef.current + delta))
      drawerColLastWidthRef.current = next
      setDrawerColWidth(next)
    }
    const onMouseUp = () => {
      if (!drawerColDraggingRef.current) return
      drawerColDraggingRef.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      try { localStorage.setItem('at-drawer-col-width', String(drawerColLastWidthRef.current)) } catch { /* storage 不可寫 */ }
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [])

  // ── 對話欄（右側）可拖曳寬度：org col 改成 flex:1 填滿，conv col 固定可調 ──
  // localStorage key: at-conv-col-width；clamp 280–800；預設 480
  // 拖曳方向：向右拖 splitter → conv col 變小（delta 取負）；向左拖 → 變大
  const [convColWidth, setConvColWidth] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('at-conv-col-width')
      if (!raw) return 480
      const v = Number(raw)
      if (!Number.isFinite(v) || v < 280 || v > 800) return 480
      return v
    } catch {
      return 480
    }
  })
  const draggingRef = useRef(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)
  const lastWidthRef = useRef(convColWidth)

  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    dragStartXRef.current = e.clientX
    dragStartWidthRef.current = convColWidth
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
  }, [convColWidth])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return
      const delta = e.clientX - dragStartXRef.current
      // 向右拖（+delta）= 邊界右移 = conv 縮小，故取 -delta
      const next = Math.min(800, Math.max(280, dragStartWidthRef.current - delta))
      lastWidthRef.current = next
      setConvColWidth(next)
    }
    const onMouseUp = () => {
      if (!draggingRef.current) return
      draggingRef.current = false
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      try { localStorage.setItem('at-conv-col-width', String(lastWidthRef.current)) } catch { /* storage 不可寫 */ }
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
    return () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [])

  // ── 底部終端抽屜狀態（flex column 末端成員，展開時把上方往上推）──────────
  const [termExpandedByConv, setTermExpandedByConv] = useState<Map<string, boolean>>(new Map());
  const activeTermExpanded = conv.activeId ? (termExpandedByConv.get(conv.activeId) ?? false) : false;
  const toggleActiveTerm = useCallback(() => {
    const id = conv.activeId;
    if (!id) return;
    setTermExpandedByConv((prev) => {
      const next = new Map(prev);
      next.set(id, !(next.get(id) ?? false));
      return next;
    });
  }, [conv.activeId]);
  // termHeight：null = 使用 CSS 預設 40%；拖曳後改為固定 px
  const [termHeight, setTermHeight] = useState<number | null>(null);
  const termDraggingRef = useRef(false);
  const termDragStartYRef = useRef<number>(0);
  const termDragStartHRef = useRef<number>(0);
  const termPaneRef = useRef<HTMLDivElement>(null);

  const handleTermResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      termDraggingRef.current = true;
      termDragStartYRef.current = e.clientY;
      termDragStartHRef.current = termPaneRef.current?.offsetHeight ?? (termHeight ?? 300);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'row-resize';
    },
    [termHeight],
  );

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (!termDraggingRef.current) return;
      // 滑鼠往上（dy < 0）→ 抽屜高度增大
      const dy = ev.clientY - termDragStartYRef.current;
      const newH = Math.max(TERM_OVERLAY_MIN_H, Math.min(
        window.innerHeight * TERM_OVERLAY_MAX_H_RATIO,
        termDragStartHRef.current - dy,
      ));
      setTermHeight(Math.round(newH));
    };
    const onUp = () => {
      if (!termDraggingRef.current) return;
      termDraggingRef.current = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, []);

  // conv 由 App.tsx 提升傳入（useAgentConversation hook 實例）；
  // 側欄 AI 對話清單也使用同一實例，確保點側欄列後 AgentTeamsView 能直接切換 activeId。

  /** 內部：已確定 cliId 後直接開 session。
   *  initialSkill：傳給 conv.open 的預設隊長 skill 名稱（不含前綴符號）。
   *  未指定時 conv.open 內部存 null，UI 退回 tuq-agent。
   */
  const startSession = useCallback(
    async (label: string, prompt: string, cliId: string, initialSkill?: string | null): Promise<string | null> => {
      setOpening(true);
      try {
        const rr = await window.tuq.agentOrg.getRoot();
        if (!rr.ok || !rr.data?.path) {
          console.warn('[AgentTeamsView] getRoot 失敗', rr);
          return null;
        }
        const cwd = stripAgentsSuffix(rr.data.path);
        const normalizedPrompt = normalizeAgentSkillPrompt(prompt, cliId, initialSkill ?? 'tuq-agent');
        return await conv.open(cwd, normalizedPrompt, label, cliId as 'claude' | 'codex' | 'antigravity', initialSkill ?? null);
      } finally {
        setOpening(false);
      }
    },
    [conv],
  );

  /** 公開：先偵測 CLI，若多個已登入則開 CLI 選擇器；cliId 已知時直接開。
   *  initialSkill：可選，傳給 conv.open 的預設隊長 skill 名稱（不含前綴符號）。
   *  onOpened：可選，對話實際開成後回拋新 conversationId（失敗時 null）。
   *    供「✨ 建團隊」綁定來源對話（F2 跨對話失配修復）；CLI 多選彈窗路徑會延後到使用者選定後才觸發。
   */
  const openAgentSession = useCallback(
    (
      label: string,
      prompt: string,
      cliId?: string,
      initialSkill?: string | null,
      onOpened?: (conversationId: string | null) => void,
    ): void => {
      if (cliId) {
        void startSession(label, prompt, cliId, initialSkill).then((id) => onOpened?.(id));
        return;
      }
      setOpening(true);
      void window.tuq.cliBackend.detect().then((r) => {
        if (!r.ok) {
          setOpening(false);
          void startSession(label, prompt, 'claude', initialSkill).then((id) => onOpened?.(id));
          return;
        }
        const installed = r.data.filter((c) => c.installed);
        if (installed.length === 1) {
          void startSession(label, prompt, installed[0].id, initialSkill).then((id) => onOpened?.(id));
        } else if (installed.length === 0) {
          setOpening(false);
          void startSession(label, prompt, 'claude', initialSkill).then((id) => onOpened?.(id));
        } else {
          setAvailableClis(installed);
          setCliPickerContext({ label, prompt, initialSkill, onOpened });
          setCliPickerOpen(true);
          setOpening(false);
        }
      }).catch(() => setOpening(false));
    },
    [startSession],
  );

  // Batch B：群組 header「✨ 建團隊」handler（定義於 openAgentSession 之後以滿足宣告順序）。
  const handleCreateTeamInGroup = useCallback((groupId: string, groupName: string) => {
    pendingGroupRef.current = groupId;
    knownTeamIdsRef.current = new Set(teams.map((t) => t.id));
    // 即時預覽卡（批 2）：記住目標群組、清掉上一輪殘留狀態。
    setPreviewGroupId(groupId);
    setPreviewStatus(null);
    // P2-2：清掉上一輪偵測到的舊 spec，避免切群/重觸發時預覽卡瞬間顯示舊內容；
    //       等新 spec 偵測到（onCreateSpecChange → setDraftSpec）再長出。
    setDraftSpec(null);
    // F2 跨對話失配修復：先清掉上一輪綁定的來源對話；新對話開成後（onOpened）才設回。
    //   清成 null 期間 onCreateSpecChange 一律忽略（id 不匹配），避免舊對話殘留 spec 灌入。
    setPreviewConversationId(null);
    // P2-1：確保目標群是展開的——若被收合則移出收合集合，否則預覽卡藏在收合的 body 裡看不到建立鈕。
    setCollapsedGroups((prev) => {
      if (!prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
    // 找出該工作群組目前既有團隊的顯示名，傳進 prompt 讓 AI 設計互補、不重複的新團隊。
    const grouped = groupTeams(teams, activeGroupConfig);
    const existingTeams = (grouped.find((g) => g.group.id === groupId)?.teams ?? []).map(teamLabelOf);
    // F2：onOpened 在對話實際開成後拿到新 conversationId，綁為來源對話。
    //   之後只有此對話偵測到的 spec 才會長進 groupId 的預覽卡。
    void openAgentSession(
      '✨ 建立 AI 團隊',
      buildCreateTeamPrompt({ id: groupId, name: groupName }, existingTeams),
      undefined,
      undefined,
      (newConvId) => { if (newConvId) setPreviewConversationId(newConvId); },
    );
  }, [teams, activeGroupConfig, openAgentSession]);

  // 自動歸群：scan 後 teams 變動時，把「快照中沒有、現在出現」的新 team 歸入 pendingGroup。
  // 以 activeGroupConfig（持久值優先）為基底逐一 fold，最後只 setGroupConfig 一次，避免競態。
  useEffect(() => {
    const target = pendingGroupRef.current;
    if (!target) return;
    const known = knownTeamIdsRef.current;
    const newIds = teams.map((t) => t.id).filter((id) => !known.has(id));
    if (newIds.length === 0) return; // 只是其他 re-render，沒有新 team → 不動 config
    let updated = activeGroupConfig;
    for (const id of newIds) {
      updated = moveTeamToGroup(updated, id, target);
    }
    void setGroupConfig(updated);
    pendingGroupRef.current = null;
    knownTeamIdsRef.current = new Set(teams.map((t) => t.id));
  }, [teams]); // eslint-disable-line react-hooks/exhaustive-deps

  // 即時預覽卡（批 2）：按「建立」→ 真正建團隊；成功後 doScan 重掃，真卡會在 teams 更新後取代預覽（見下方清除 effect）。
  const handleCreatePreview = useCallback(async () => {
    if (!draftSpec || creatingPreview) return;
    setCreatingPreview(true);
    setPreviewStatus("正在建立團隊…");
    try {
      const targetGroup = previewGroupId
        ? activeGroupConfig.groups.find((g) => g.id === previewGroupId)
        : undefined;
      const specToCreate = targetGroup?.sourceId
        ? { ...draftSpec, sourceId: targetGroup.sourceId }
        : draftSpec;
      const result = await window.tuq.agentOrg.createTeamFromSpec(specToCreate);
      if (!result.ok) {
        console.error('[createTeam] preview create failed', result.error);
        setPreviewStatus(humanizeCreateError(result.error));
        return;
      }
      setPreviewStatus(null);
      await doScan(); // 重掃 teams；真卡會在 teams 更新後取代預覽
    } catch (e) {
      console.error('[createTeam] preview create error', e);
      setPreviewStatus("建立失敗，請稍後再試或在對話裡微調後重試。");
    } finally {
      setCreatingPreview(false);
    }
  }, [draftSpec, creatingPreview, doScan, previewGroupId, activeGroupConfig]);

  // 即時預覽卡（批 2）：按「取消」→ 清掉預覽 state（不動對話）。
  const handleCancelPreview = useCallback(() => {
    setDraftSpec(null);
    setPreviewGroupId(null);
    setPreviewStatus(null);
    setPreviewConversationId(null); // F2：解綁來源對話
    // P2 修復：取消預覽＝撤銷在此群建隊的意圖，連待歸群目標一併清掉；
    //   否則使用者改用對話面板底部「建立團隊」列真的建出團隊時，
    //   自動歸群 effect 會把它靜默歸進「已被取消」的群。
    pendingGroupRef.current = null;
  }, []);

  // F2 跨對話失配修復：對話回拋偵測到的 spec 時，只認「按建團隊時開的那條對話」（previewConversationId）。
  //   convId 不匹配（切到別條對話、或尚未綁定）→ 一律忽略，避免別條 spec 灌進別群的預覽卡。
  //   用 ref 讀最新綁定 id，免把 previewConversationId 列進 deps 而每次重建 callback。
  const handleCreateSpecChange = useCallback((spec: AgentTeamCreateSpecInput | null, convId: string) => {
    if (convId !== previewConversationIdRef.current) return;
    setDraftSpec(spec);
  }, []);

  // F2 跨對話失配修復：active 對話切離來源對話 → 清掉預覽卡（避免 A 群殘留別條內容）。
  //   只在「有綁定來源、且 active 已不是它」時清；previewConversationId 設 null 期間（剛按建團隊、尚未開成）不誤清。
  useEffect(() => {
    if (previewConversationId && conv.activeId !== previewConversationId) {
      setDraftSpec(null);
      setPreviewGroupId(null);
      setPreviewStatus(null);
      setPreviewConversationId(null);
      // P2 修復：切離來源對話＝結束此對話的建隊脈絡，一併撤銷待歸群目標，
      //   避免重新武裝後的 pendingGroupRef 殘留、把日後出現的團隊誤歸入舊群。
      pendingGroupRef.current = null;
    }
  }, [conv.activeId, previewConversationId]);

  // 即時預覽卡（批 2）：真卡取代預覽卡 — teams 出現與 draftSpec 同 id 的真團隊後收掉預覽。
  // 獨立 effect，不與自動歸群 effect 互相干擾。
  useEffect(() => {
    if (draftSpec && teams.some((t) => t.id === draftSpec.teamId)) {
      // 只收掉預覽卡 UI（draftSpec/previewStatus）；**保留** previewConversationId / previewGroupId 綁定，
      //   讓「同一條對話接著要求建第二隊」的新 spec 仍能通過 handleCreateSpecChange 的 id 比對、
      //   並在同一群就地長出預覽卡（先前連 previewConversationId 一起清成 null → 第二隊永遠不顯預覽卡）。
      setDraftSpec(null);
      setPreviewStatus(null);
      // 重新武裝待歸群目標：本對話後續建出的團隊也自動歸入同群。
      //   （自動歸群 effect 宣告在前、同一次 commit 先跑，已把 pendingGroupRef 清 null
      //     並刷新 knownTeamIdsRef 含剛建好的團隊，這裡只需把目標群再設回。）
      //   僅在仍綁著來源對話時才武裝；切離/取消會把 pendingGroupRef 清回 null。
      if (previewConversationIdRef.current) {
        pendingGroupRef.current = previewGroupId;
      }
    }
  }, [teams, draftSpec, previewGroupId]);

  // 達上限（或 open 失敗）時提示使用者；提示後清除旗標避免重複彈。
  useEffect(() => {
    if (conv.limitError) {
      window.alert(conv.limitError);
      conv.clearLimitError();
    }
  }, [conv.limitError]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRootSaved = useCallback(() => {
    setShowRootEditor(false);
    // 重新掃描
    doScan();
  }, [doScan]);

  // 開啟與特定團隊的對話（團隊標頭「💬 對話」按鈕入口）。
  // 流程：
  //   1. 反查 entrySkill（resolveEntrySkill）
  //   2. 讀該 team 的資料夾歷史
  //   3. 開 TeamFolderPicker 彈窗
  //   4. 使用者選定 folder → 寫回歷史 → 呼 openSession(folder)
  // 若 App.tsx 有傳 onOpenTeamSession，走真實 session（左側監測列 + tab 跳轉）；
  // 未傳時（向後相容）仍走嵌入式 openAgentSession。
  const handleOpenTeamChat = useCallback((teamId: string, teamLabel: string): void => {
    const label = `💬 ${teamLabel}`;
    void (async () => {
      // 1. 反查 entrySkill（空 platforms = 純反查，不做 junction/codex link）。
      //    保存「裸 skillName」（不帶斜線）供 agent 下拉預設用（§4.3）。
      //    開 CLI 時自動注入 `<前綴>skillName 任務`，前綴依彈窗選的 model 決定
      //    （codex→`$`、claude→`/`、agy→無前綴只送任務）。見下方 step 4.4。
      let skillName = 'tuq-agent';
      try {
        const r = await window.tuq.teamRegistry.sync({ teamId, platforms: [] });
        if (r.ok && r.data?.skillName) {
          skillName = r.data.skillName;
        }
      } catch {
        // 反查失敗 → 維持 fallback
      }

      // 2. 讀資料夾歷史
      const recentFolders = await readTeamFolders(teamId);

      // 3. 一次性偵測已安裝 CLI → availableModels（installed===true；不過濾 agy）。
      let availableModels: { id: CliId; label: string }[] = [];
      try {
        const det = await window.tuq.cliBackend.detect();
        if (det.ok && det.data) {
          availableModels = det.data
            .filter((c) => c.installed === true)
            .map((c) => ({ id: c.id, label: MODEL_LABELS[c.id] ?? c.name }));
        }
      } catch {
        // 偵測失敗 → 空清單（彈窗顯示「未偵測到已安裝的 AI CLI」）
      }

      // 4. 開彈窗；onResolve 在使用者確認後執行
      setFolderPickerState({
        teamId,
        teamLabel,
        recentFolders,
        availableModels,
        onResolve: (r: TeamSessionRequest) => {
          setFolderPickerState(null);
          void (async () => {
            // 4.1 解析 projectId：有新建名 → 先建 project；否則用選定的（可 null）。
            let projectId: string | null = r.projectLocalId;
            if (r.newProjectName) {
              try {
                const pr = await window.tuq.projects.create({ name: r.newProjectName });
                if (pr.ok && pr.data) projectId = pr.data.id;
                else console.warn('[AgentTeams] 新建專案失敗，任務將不關聯專案', pr);
              } catch (err) {
                // 建 project 失敗 → 退回不關聯（projectId 維持 r.projectLocalId）
                console.warn('[AgentTeams] 新建專案失敗，任務將不關聯專案', err);
              }
            }

            // 4.2 建真 task（帶 projectLocalId + folderPath → backend 順帶 linkProjectFolder）。
            let taskId: string | null = null;
            try {
              const tr = await window.tuq.tasks.create({
                name: r.task.trim().slice(0, 200) || `💬 ${teamLabel}`,
                projectLocalId: projectId,
                milestoneLocalId: r.milestoneLocalId,
                folderPath: r.folder,
                description: r.task,
              });
              if (tr.ok && tr.data) taskId = tr.data.id;
            } catch {
              // 建 task 失敗 → 無 taskId，無法走真 session
            }
            if (!taskId) return;

            // 4.3 寫回資料夾歷史（非阻塞）。
            void saveTeamFolder(teamId, r.folder);

            // 4.4 initialPrompt = `<CLI 前綴><隊長 skillName> <任務>`（strip \r\n 由彈窗已處理）。
            //     前綴依彈窗選的 model：codex→`$`、claude→`/`、agy→無前綴（agy 無對應 skill，只送任務）。
            //     與 ConversationPanel 的 SKILL_PREFIX 規則一致。
            const SEND_PREFIX: Record<CliId, string> = { claude: '/', codex: '$', antigravity: '/' };
            const pfx = SEND_PREFIX[r.model] ?? '/';
            const prompt = pfx ? `${pfx}${skillName} ${r.task}` : r.task;

            // 4.5 開真 session（taskId / tool=model / milestone / 裸 skillName 下拉預設）。
            if (onOpenTeamSession) {
              void onOpenTeamSession(
                label,
                prompt,
                r.folder,
                r.model,
                taskId,
                r.milestoneLocalId,
                skillName,
              );
            } else {
              // 嵌入式路徑：傳 initialSkill 讓對話面板預設到該隊長 skill
              void openAgentSession(label, prompt, undefined, skillName);
            }
          })();
        },
      });
    })();
  }, [onOpenTeamSession, openAgentSession]);

  // 逐平台安裝/移除（平台 badge 點擊 + 詳情抽屜共用）。install=true 走 sync 單一平台、false 走 unregister 單一平台。
  // 「在哪些平台可用」的真相＝「skill 是否在檔案系統上」，由 team.platforms 反映，**不再寫 agent_registry.enabled**
  //（根除 DB enabled 與 fs 分岐的舊 bug）；完成後 doScan 重掃讓 badge/抽屜即時反映 fs。回傳白話結果字串（空＝成功）。
  const handleSetPlatform = useCallback(
    async (
      teamId: string,
      platforms: CliId[],
      install: boolean,
    ): Promise<string> => {
      if (platforms.length === 0) return '';
      // 樂觀更新：立即反映 badge 狀態，不等後端（一次更新群組內所有平台）。
      const patch = Object.fromEntries(platforms.map((p) => [p, install]));
      setTeams(prev => prev.map(t =>
        t.id === teamId
          ? { ...t, platforms: { claude: false, codex: false, antigravity: false, ...(t.platforms ?? {}), ...patch } } as AgentTeamDto
          : t,
      ));
      try {
        if (install) {
          const r = await window.tuq.teamRegistry.sync({ teamId, platforms });
          if (!r.ok) { doScan({ silent: true }); return `加入時遇到問題：${r.error ?? '未知原因'}`; }
          if (!r.data.skillName) { doScan({ silent: true }); return '找不到這個團隊的入口指令，請確認設定正確。'; }
        } else {
          const r = await window.tuq.teamRegistry.unregister({ teamId, platforms });
          if (!r.ok) { doScan({ silent: true }); return `拿掉時遇到問題：${r.error ?? '未知錯誤'}`; }
        }
        doScan({ silent: true });
        return '';
      } catch (e: unknown) {
        doScan({ silent: true });
        return `操作時遇到問題：${String(e)}`;
      }
    },
    [doScan],
  );

  // 為「有團隊、無入口 skill」的團隊建立可攜入口 SKILL.md（Phase 4）。
  // skillName 省略 → main 端用 `tuq-<teamId 末段>`。成功後 doScan 重掃，平台安裝列才會出現。
  // 回傳白話結果字串（空＝成功無訊息）。
  const handleCreateEntrySkill = useCallback(
    async (teamId: string): Promise<string> => {
      try {
        const r = await window.tuq.agentOrg.createEntrySkill({ teamId });
        if (!r.ok) return `建立入口指令時遇到問題：${r.error ?? '未知原因'}`;
        doScan({ silent: true });
        return r.data.alreadyExisted ? '這個團隊已經有入口指令了。' : '';
      } catch (e: unknown) {
        return `建立入口指令時遇到問題：${String(e)}`;
      }
    },
    [doScan],
  );

  // 開啟團隊在 AgentOrg 的資料夾（檔案總管）；main 端 shell.openPath 解析路徑。
  const handleOpenTeamFolder = useCallback(async (teamId: string): Promise<void> => {
    try {
      const r = await window.tuq.agentOrg.openTeamFolder(teamId);
      if (!r.ok) window.alert(r.error ?? '無法開啟這個團隊的資料夾');
    } catch (e) {
      console.warn('[AgentTeams] openTeamFolder 失敗', e);
    }
  }, []);

  // 規格化完成偵測（Batch 2b）：對話輸出 marker → 標記 manager 為 standardized → 重掃讓「待優化」徽章消失。
  // 以 standardizedHandledRef 去重，避免 marker 持續留在逐字稿導致重複呼叫 / 重複 doScan。
  const handleStandardizedDetected = useCallback(async (teamId: string): Promise<void> => {
    if (standardizedHandledRef.current.has(teamId)) return;
    try {
      const r = await window.tuq.agentRegistry.setStandardized({ agentId: `${teamId}/manager`, standardized: true });
      if (r.ok) {
        standardizedHandledRef.current.add(teamId);
        doScan();
      }
    } catch (e) {
      console.error('[AgentTeams] setStandardized 失敗', e);
    }
  }, [doScan]);

  // 切換收合 teamId
  const handleToggleCollapse = useCallback((teamId: string) => {
    setCollapsedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  }, []);

  if (loading) {
    return (
      <div className="at-loading">
        <div className="at-skeleton" />
        <div className="at-skeleton at-skeleton--wide" />
        <div className="at-skeleton" />
        <p className="at-loading-hint">正在讀取 AI 團隊資料…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="at-error">
        <span className="at-error-icon">⚠️</span>
        <p className="at-error-msg">找不到 AI 團隊資料夾</p>
        <p className="at-error-detail">{error}</p>
        <p className="at-error-hint">請確認 AI 團隊資料夾存在並可讀取，或點下方按鈕設定正確路徑。</p>
        <button
          type="button"
          className="at-root-editor__btn at-root-editor__btn--primary at-error-set-path-btn"
          style={{ marginTop: 8 }}
          onClick={() => setShowRootEditor(true)}
        >
          ⚙ 設定資料夾路徑
        </button>
        {showRootEditor && (
          <RootPathEditor
            currentPath={rootInfo?.path ?? ""}
            defaultPath={rootInfo?.defaultPath ?? ""}
            onSaved={handleRootSaved}
            onCancel={() => setShowRootEditor(false)}
          />
        )}
      </div>
    );
  }

  // 掃描成功但無任何 agent：仍渲染完整 header（設定列），只把組織圖區換成空狀態，
  // 否則使用者會卡在純文字頁、無法點「資料來源」改路徑或「建立 AI 團隊」。
  const isEmpty = teams.length === 0;

  // 偵測到的建隊 spec 之 teamId 已存在於目前 teams → 該團隊已建過。
  // 用於隱藏對話面板底部那條「偵測到建隊 spec」in-pane 列（已建完不再叫使用者建）。
  const specAlreadyCreated = !!draftSpec && teams.some((t) => t.id === draftSpec.teamId);

  return (
    <div className="at-root">
      <div className="at-header">
        <div className="at-header-row">
          <div>
            <h2 className="at-title">🤖 AI 團隊</h2>
            <p className="at-subtitle">這裡是你的 AI 工作夥伴。點團隊看成員，或在工作群組上按『✨ 建團隊』新增。</p>
          </div>
          {/* 全域操作鈕已退場：建團隊改由各群組 header 的「✨ 建團隊」入口（無團隊時走 empty-state CTA）；
              分組設定走群組 header「✏️ 編輯」；設定資料夾走 error/empty 態按鈕。故 header 不再放操作列。 */}
        </div>

        {showRootEditor && (
          <RootPathEditor
            currentPath={rootInfo?.path ?? ""}
            defaultPath={rootInfo?.defaultPath ?? ""}
            onSaved={handleRootSaved}
            onCancel={() => setShowRootEditor(false)}
          />
        )}

      </div>

      {/* 三欄佈局：[組織圖 | splitter | AI 對話 | drawer-splitter | 詳情抽屜(docked)]
          - 抽屜欄僅在 drawerSel 非 null 時渲染（docked 模式，無遮罩）
          - flex:1 1 0 + min-height:0 讓 .at-main 可被下方 .at-term-pane 壓縮 */}
      <div className="at-main" style={{ flex: '1 1 0', minHeight: 0 }}>
        {/* 左欄：組織圖（CSS media query 控制 < 1200px 隱藏；JS state 控制手動 toggle） */}
        <div
          className="at-teams-org-col"
          style={{ flex: '1' }}
        >
          {/* AgentOrgList 三層可收合清單；無資料時改顯示空狀態 */}
          {/* parseWarnings 警示列：有讀不出來的成員時顯示（可展開路徑） */}
          {parseWarnings.length > 0 && (
            <div className="at-parse-warnings-banner">
              <span className="at-parse-warnings-banner__icon" aria-hidden="true">⚠️</span>
              <span className="at-parse-warnings-banner__msg">
                有 {parseWarnings.length} 位成員的資料讀不出來，已先略過。
              </span>
              <details
                open={warningExpanded}
                onToggle={(e) => setWarningExpanded((e.currentTarget as HTMLDetailsElement).open)}
                className="at-parse-warnings-banner__details"
              >
                <summary className="at-parse-warnings-banner__summary">
                  {warningExpanded ? '收起路徑' : '查看路徑'}
                </summary>
                <ul className="at-parse-warnings-banner__list">
                  {parseWarnings.map((p) => (
                    <li key={p} className="at-parse-warnings-banner__item">{p}</li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          {isEmpty ? (
            <div className="at-empty">
              <div className="at-empty-inner">
                <p className="at-empty-title">尚無 AI 團隊</p>
                <p className="at-empty-hint">
                  AI 團隊資料夾為空或讀取結果為空。請點下方「⚙ 設定資料來源路徑」設定正確路徑，或點「✨ 建立 AI 團隊」新增第一組。
                </p>
                <div className="at-empty-actions">
                  <button
                    type="button"
                    className="at-root-editor__btn at-root-editor__btn--primary"
                    onClick={() => setShowRootEditor(true)}
                  >
                    ⚙ 設定資料來源路徑
                  </button>
                  <button
                    type="button"
                    className="at-ops-btn at-ops-btn--create"
                    onClick={() => void openAgentSession('✨ 建立 AI 團隊', buildCreateTeamPrompt())}
                    disabled={opening}
                  >
                    {opening ? '準備中…' : '✨ 建立 AI 團隊'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <AgentOrgList
              teams={teams}
              groupConfig={activeGroupConfig}
              collapsedGroups={collapsedGroups}
              collapsedTeams={collapsedTeams}
              onToggleGroup={handleToggleGroupCollapse}
              onToggleTeam={handleToggleCollapse}
              onSelectAgent={handleSelectAgent}
              onSetPlatform={handleSetPlatform}
              onOpenTeamDetail={handleOpenTeamDetail}
              onOpenTeamChat={handleOpenTeamChat}
              onOpenTeamOpsSession={openAgentSession}
              onEditGroup={handleEditGroup} /* Batch C 接 UI（群組 header ✏️ 編輯鈕） */
              onAddGroup={handleAddGroupFromList} /* Batch C 接 UI（底部 ＋ 新增工作群組鈕） */
              onCreateTeamInGroup={handleCreateTeamInGroup} /* Batch C 接 UI（群組 header ✨ 建團隊鈕） */
              previewSpec={draftSpec} /* 即時預覽卡（批 2→批 3 接 UI） */
              previewGroupId={previewGroupId}
              onCreatePreview={handleCreatePreview}
              onCancelPreview={handleCancelPreview}
              creatingPreview={creatingPreview}
              previewStatus={previewStatus}
              onSelectPreviewMember={handleSelectPreviewMember}
            />
          )}
        </div>

        {/* org splitter + conv 欄：有開啟的對話時才顯示（避免歷史對話 restore 導致空白欄） */}
        {conv.activeId && (
          <>
            <div
              className="management-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={convColWidth}
              aria-valuemin={280}
              aria-valuemax={800}
              onMouseDown={handleSplitterMouseDown}
            />
            <div className="at-teams-conv-col" style={{ flex: `0 0 ${convColWidth}px` }}>
              <AgentConversationArea
                conv={conv}
                onRestart={openAgentSession}
                onResume={conv.resume}
                onTeamCreated={doScan}
                termExpanded={activeTermExpanded}
                onToggleTerm={toggleActiveTerm}
                onCreateSpecChange={handleCreateSpecChange}
                onStandardizedDetected={handleStandardizedDetected}
                specAlreadyCreated={specAlreadyCreated}
              />
            </div>
          </>
        )}

        {/* 右欄：詳情抽屜（docked 模式，無遮罩） */}
        {drawerSel && (
          <>
            <div
              className="at-teams-drawer-splitter"
              role="separator"
              aria-orientation="vertical"
              onMouseDown={handleDrawerSplitterMouseDown}
            />
            <div className="at-teams-drawer-col" style={{ flex: `0 0 ${drawerColWidth}px` }}>
              <AgentDetailDrawer
                teamId={drawerSel.teamId}
                agentName={drawerSel.agentName}
                docked
                onClose={handleCloseDrawer}
                onOpenAgentOpsSession={openAgentSession}
              />
            </div>
          </>
        )}

        {/* 右欄：預覽卡成員唯讀抽屜（與 drawerSel 互斥共用右欄；docked，無遮罩）。
            draftSpec 可能在抽屜開著時變 null（預覽卡消失）→ 不渲染（previewMemberSel 留存但無內容可顯示，
            下次選真團隊成員會自動清掉，按 ✕ 也會清）。 */}
        {previewMemberSel &&
          draftSpec &&
          // P3 修復：抽屜開著時對話可能改出「成員數變少」的新 spec，使選中的索引越界。
          //   越界時不渲染抽屜（否則 header 顯示不存在的「成員」、body 卻 fallback 成組長介紹，自相矛盾）。
          (previewMemberSel.who === "manager" ||
            previewMemberSel.who < (draftSpec.members?.length ?? 0)) &&
          (() => {
          const teamName = (draftSpec.teamName ?? "").trim();
          const isManager = previewMemberSel.who === "manager";
          const member = isManager ? null : (draftSpec.members ?? [])[previewMemberSel.who as number];
          const intro = previewIntroductionFor(
            draftSpec,
            isManager ? "manager" : { memberIndex: previewMemberSel.who as number },
          );
          const displayName = isManager
            ? (draftSpec.manager?.displayName?.trim() || `${teamName}組長`)
            : (member?.displayName?.trim() || member?.title?.trim() || member?.name || "成員");
          const roleLabel = isManager ? "組長" : typeBadgeLabel(member?.roleInTeam ?? null);
          return (
            <>
              <div
                className="at-teams-drawer-splitter"
                role="separator"
                aria-orientation="vertical"
                onMouseDown={handleDrawerSplitterMouseDown}
              />
              <div className="at-teams-drawer-col" style={{ flex: `0 0 ${drawerColWidth}px` }}>
                <PreviewAgentDrawer
                  intro={intro}
                  displayName={displayName}
                  roleLabel={roleLabel}
                  onClose={() => setPreviewMemberSel(null)}
                />
              </div>
            </>
          );
        })()}

        {/* 右欄：團隊詳情/設定抽屜（與 agent 詳情、預覽成員抽屜互斥共用右欄；docked，無遮罩）。
            顯示團隊檔案位置 + 開啟資料夾 + 三平台逐一安裝/移除。 */}
        {teamDetailSel && (() => {
          const t = teams.find((tm) => tm.id === teamDetailSel);
          if (!t) return null;
          // 複合鍵團隊顯示名隱藏 `sourceId::` 前綴；來源資訊改由 sourceLabel 徽章呈現。
          const tLabel = t.manager?.displayName ?? t.manager?.name ?? teamDisplayId(t.id);
          // 來源徽章只在非預設來源顯示（default 來源 sourceId='default'）。
          const tSourceLabel = t.sourceId && t.sourceId !== "default" ? t.sourceLabel : undefined;
          // 「建立入口指令」的預設指令名：tuq-<純團隊路徑末段>（與 main 端 fallback 一致）。
          const tPurePath = teamDisplayId(t.id);
          const tDefaultSkillName =
            "tuq-" + (tPurePath.split("/").filter(Boolean).at(-1) ?? tPurePath);
          return (
            <>
              <div
                className="at-teams-drawer-splitter"
                role="separator"
                aria-orientation="vertical"
                onMouseDown={handleDrawerSplitterMouseDown}
              />
              <div className="at-teams-drawer-col" style={{ flex: `0 0 ${drawerColWidth}px` }}>
                <TeamDetailDrawer
                  team={t}
                  teamLabel={tLabel}
                  sourceLabel={tSourceLabel}
                  folderPath={teamDisplayFolderPath(teamSources, rootInfo?.path, t.id)}
                  onOpenFolder={() => void handleOpenTeamFolder(t.id)}
                  onSetPlatform={(platforms, install) => handleSetPlatform(t.id, platforms, install)}
                  onCreateEntrySkill={() => handleCreateEntrySkill(t.id)}
                  defaultSkillName={tDefaultSkillName}
                  onClose={() => setTeamDetailSel(null)}
                  onAudit={() => void openAgentSession(`🔍 健診 ${tLabel}`, buildTeamAuditPrompt(t.id, tLabel))}
                  onReview={() => void openAgentSession(`📋 改善 ${tLabel}`, buildTeamReviewPrompt(t.id, tLabel))}
                />
              </div>
            </>
          );
        })()}

        {/* 右欄：分組設定抽屜（Batch 2 docked 化：flex 佔位推擠，非 absolute 覆蓋；
            固定寬 flex: 0 0 <w>px，畫布欄 flex:1；把手在內側邊緣可拖拉調寬） */}
        {showGroupEditor && (
          <>
            <div
              className="atrf-ge-drawer-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={groupDrawerWidth}
              aria-valuemin={420}
              onMouseDown={handleGroupDrawerResizeStart}
            />
            <div className="atrf-ge-drawer-col" style={{ flex: `0 0 ${groupDrawerWidth}px` }}>
              <GroupConfigEditor
                open={showGroupEditor}
                groupConfig={activeGroupConfig}
                teams={teams}
                focusGroupId={groupEditorTarget.focusGroupId}
                mode={groupEditorTarget.mode}
                sources={teamSources}
                onAddSource={handleAddTeamSource}
                onSave={async (c: GroupConfig) => {
                  await setGroupConfig(c);
                  setShowGroupEditor(false);
                  setGroupEditorTarget({});
                }}
                onClose={() => { setShowGroupEditor(false); setGroupEditorTarget({}); }}
              />
            </div>
          </>
        )}
      </div>


      {/* TeamFolderPicker 彈窗：選工作資料夾後再開 session */}
      {folderPickerState && (
        <TeamFolderPicker
          teamId={folderPickerState.teamId}
          teamLabel={folderPickerState.teamLabel}
          recentFolders={folderPickerState.recentFolders}
          availableModels={folderPickerState.availableModels}
          onConfirm={folderPickerState.onResolve}
          onCancel={() => setFolderPickerState(null)}
          onFolderBrowsed={(browsedFolder) => {
            // 瀏覽選取後立即寫入歷史，並同步更新彈窗的常用清單（不必等 onConfirm）。
            void saveTeamFolder(folderPickerState.teamId, browsedFolder);
            setFolderPickerState((prev) => {
              if (!prev) return prev;
              const next = [browsedFolder, ...prev.recentFolders.filter((f) => f !== browsedFolder)].slice(0, TEAM_FOLDERS_MAX);
              return { ...prev, recentFolders: next };
            });
          }}
        />
      )}

      {/* CLI 選擇器彈窗：偵測到多個 CLI 時讓使用者選擇 */}
      {cliPickerOpen && cliPickerContext && (
        <div className="at-cli-picker-overlay" onClick={() => setCliPickerOpen(false)}>
          <div className="at-cli-picker-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="at-cli-picker-title">選擇 AI 助手</h3>
            <div className="at-cli-picker-list">
              {availableClis.map((cli) => (
                <button
                  key={cli.id}
                  type="button"
                  className="at-cli-picker-item"
                  onClick={() => {
                    setCliPickerOpen(false);
                    void startSession(cliPickerContext.label, cliPickerContext.prompt, cli.id, cliPickerContext.initialSkill)
                      .then((id) => cliPickerContext.onOpened?.(id));
                  }}
                >
                  <span className="at-cli-picker-name">{cli.name}</span>
                  {cli.loginState === 'logged_in' && (
                    <span className="at-cli-picker-badge">已登入</span>
                  )}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="at-cli-picker-cancel"
              onClick={() => setCliPickerOpen(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* ── 底部終端抽屜（flex column 末端成員）── AgentTermView 常駐掛載，display:none 切換。
          展開時 .at-term-pane 佔位，把上方 .at-main 往上推（真抽屜，非 overlay）。
          key={conv.activeId}：activeId 換新時重建 terminal（清空歷史）。
          conv.activeId 存在時才掛載（無對話時不需要終端）。 */}
      {conv.activeId && (
        <>
          {/* 拖曳把手：termExpanded 時才顯示（row-resize） */}
          {activeTermExpanded && (
            <div
              className="at-term-resizer"
              onMouseDown={handleTermResizeStart}
              aria-label="拖曳調整終端高度"
              role="separator"
            />
          )}
          {/* 終端面板：termExpanded 時展開（flex 佔位）；否則 display:none 不佔空間 */}
          <div
            className="at-term-pane"
            ref={termPaneRef}
            style={
              activeTermExpanded
                ? {
                    display: 'flex',
                    flexDirection: 'column',
                    flex: `0 0 ${termHeight === null ? '40%' : `${termHeight}px`}`,
                    minHeight: TERM_OVERLAY_MIN_H,
                  }
                : { display: 'none' }
            }
          >
            {/* 面板頂部工具列：收合按鈕 */}
            <div className="at-term-pane-bar">
              <button
                type="button"
                className="at-term-overlay-bar__close"
                onClick={toggleActiveTerm}
                aria-label="收合終端"
                title="收合原始畫面"
              >
                ✕ 收合
              </button>
            </div>
            <AgentTermView key={conv.activeId} conversationId={conv.activeId} />
          </div>
        </>
      )}
    </div>
  );
}
