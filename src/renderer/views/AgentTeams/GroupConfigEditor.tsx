/**
 * GroupConfigEditor.tsx — 分組設定面板（Batch 1 拖拉分區改版）
 *
 * 右側 overlay 面板；不即時寫入，editingConfig 為本地副本，
 * 按「儲存」才呼叫 onSave(editingConfig)。
 *
 * 依工作群組分區呈現：每群一個區塊（群名＋團隊卡片），最後固定「未分類」區。
 * 團隊卡片用原生 HTML5 drag & drop 拖到其他區塊即完成換群（無新依賴）。
 * 群名可雙擊或按鉛筆 inline 改名；保留既有新增/刪除工作群組功能。
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { GroupConfig, GroupDef } from "./groupConfig";
import {
  UNCLASSIFIED_GROUP,
  moveTeamToGroup,
  moveGroup,
  renameGroup,
  updateGroupDescription,
  computeTeamsToRelocate,
  applyRelocationResult,
} from "./groupConfig";
import { GroupZone, teamLabelOf } from "./GroupZone";
import { GroupSourceApplyDialog } from "./GroupSourceApplyDialog";
import type { ApplyResultSummary } from "./GroupSourceApplyDialog";
import type { AgentTeamDto } from "../../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// 介面
// ---------------------------------------------------------------------------

export interface GroupConfigEditorProps {
  open: boolean;
  groupConfig: GroupConfig;
  teams: AgentTeamDto[];
  onSave: (config: GroupConfig) => void | Promise<void>;
  onClose: () => void;
  /** Batch A：開抽屜時要聚焦的工作群組 id（捲動到該 zone 並觸發其自動改名態）。 */
  focusGroupId?: string;
  /** Batch A：'add' = 一開抽屜就新增一個群並進入可命名狀態；'edit' = 聚焦既有群改名。 */
  mode?: 'edit' | 'add';
  /** 可選資料夾來源清單；傳入後每個工作群組 zone 顯示資料夾下拉選單。 */
  sources?: { id: string; label: string }[];
  /**
   * 就地新增一個資料夾來源（開資料夾選擇器→加入來源清單→刷新）；回傳新來源 id 或 undefined。
   * 透傳給每個工作群組 zone 的「＋ 新增資料夾」按鈕。
   */
  onAddSource?: () => Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// 顏色選項（給新增工作群組用）
// ---------------------------------------------------------------------------

const COLOR_PRESETS = [
  "#6366f1", "#0ea5e9", "#10b981", "#f59e0b",
  "#ef4444", "#a855f7", "#ec4899", "#14b8a6",
];

// 未分類區的顯示用偽群（runtime only，不存設定）
const UNCLASSIFIED_DISPLAY: GroupDef = {
  ...UNCLASSIFIED_GROUP,
  name: "未分類",
  icon: "📦",
};

// ---------------------------------------------------------------------------
// 主元件
// ---------------------------------------------------------------------------

export function GroupConfigEditor({
  open,
  groupConfig,
  teams,
  onSave,
  onClose,
  focusGroupId,
  mode,
  sources,
  onAddSource,
}: GroupConfigEditorProps): React.JSX.Element | null {
  // 本地編輯副本（開啟時初始化，不即時存）
  const [editingConfig, setEditingConfig] = useState<GroupConfig>(() => deepClone(groupConfig));
  const [saving, setSaving] = useState(false);
  // 拖曳狀態：正在拖的團隊 + 拖曳經過的區塊（高亮用）
  const [draggingTeamId, setDraggingTeamId] = useState<string | null>(null);
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  // Batch A：記錄「本次 open 由關→開」是否已處理過 target（add/focus），避免每 render 重觸發。
  const targetHandledRef = useRef(false);
  // 行為乙（BM7）：資料夾下拉的「暫存選擇」。每群一個 pending sourceId；
  // 空字串＝暫存選回「預設來源」。沒有 key＝未變更（沿用持久值 group.sourceId）。
  const [pendingSource, setPendingSource] = useState<Record<string, string | undefined>>({});
  // 套用並搬移確認 dialog 狀態（一次只開一個群）。
  const [applyDialog, setApplyDialog] = useState<{ groupId: string; toSourceId: string } | null>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResultSummary | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  // 每次開啟時重新複製最新 groupConfig
  useEffect(() => {
    if (open) {
      setEditingConfig(deepClone(groupConfig));
      setDraggingTeamId(null);
      setDragOverGroupId(null);
      setPendingSource({});
      setApplyDialog(null);
    } else {
      // 關閉後重置 target 處理旗標，下次開啟才會再跑一次 add/focus 邏輯
      targetHandledRef.current = false;
    }
  }, [open, groupConfig]);

  // ESC 關閉
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // ── 工作群組操作 ──────────────────────────────────────────────────────────

  const handleRenameGroup = useCallback((groupId: string, newName: string) => {
    setEditingConfig((prev) => renameGroup(prev, groupId, newName));
  }, []);

  const handleDescriptionChange = useCallback((groupId: string, desc: string) => {
    setEditingConfig((prev) => updateGroupDescription(prev, groupId, desc));
  }, []);

  const handleGroupRemove = useCallback((groupId: string) => {
    setEditingConfig((prev) => {
      if (prev.groups.length <= 1) return prev; // 至少保留 1 群
      // 被移除群的 team → 清掉 mapping（變未分類）
      return {
        ...prev,
        groups: prev.groups.filter((g) => g.id !== groupId),
        mappings: prev.mappings.filter((m) => m.groupId !== groupId),
      };
    });
  }, []);

  const handleMoveGroup = useCallback((groupId: string, direction: "up" | "down") => {
    setEditingConfig((prev) => moveGroup(prev, groupId, direction));
  }, []);

  const handleAddGroup = useCallback(() => {
    setEditingConfig((prev) => {
      const maxOrder = prev.groups.reduce((m, g) => Math.max(m, g.order), 0);
      const colorIdx = prev.groups.length % COLOR_PRESETS.length;
      const newGroup: GroupDef = {
        id: generateId(),
        name: "新工作群組",
        icon: "📁",
        color: COLOR_PRESETS[colorIdx],
        order: maxOrder + 1,
      };
      return { ...prev, groups: [...prev.groups, newGroup] };
    });
  }, []);

  // 行為乙：資料夾下拉只暫存，不即時搬移（按「套用並搬移」才動作）。
  const handleSourceChange = useCallback(
    (groupId: string, sourceId: string | undefined) =>
      setPendingSource((prev) => ({ ...prev, [groupId]: sourceId })),
    [],
  );

  // 取消某群暫存的資料夾選擇。
  const handleCancelPending = useCallback((groupId: string) => {
    setPendingSource((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  }, []);

  // 開啟「套用並搬移」確認 dialog（toSourceId 為暫存選擇；'' 代表預設來源 default）。
  const handleOpenApply = useCallback((groupId: string, pending: string | undefined) => {
    setApplyResult(null);
    setApplyError(null);
    setApplyBusy(false);
    setApplyDialog({ groupId, toSourceId: pending ?? "" });
  }, []);

  // 關閉 dialog；若本批已搬移成功（有結果），一併清掉該群 pending。
  const handleCloseApply = useCallback(() => {
    setApplyDialog((cur) => {
      if (cur && (applyResult !== null)) {
        setPendingSource((prev) => {
          const next = { ...prev };
          delete next[cur.groupId];
          return next;
        });
      }
      return null;
    });
  }, [applyResult]);

  // 確定搬移：呼 IPC、unwrap result、持久化重建 GroupConfig（以持久值 groupConfig 為基底）。
  const handleConfirmApply = useCallback(async () => {
    if (!applyDialog) return;
    const { groupId, toSourceId } = applyDialog;
    // §1.4：以持久值 groupConfig 算出需搬移的系統鍵清單。
    const teamKeys = computeTeamsToRelocate(groupConfig, groupId, toSourceId || "default");
    setApplyBusy(true);
    setApplyError(null);
    try {
      // platforms 明示三平台：與 ApplyGroupSourcePayloadSchema 的 .default / backend 的
      // `?? [...]` 預設一致（搬移後重建三平台入口 skill）。payload 型別取 z.infer（output）
      // 故此欄必填，須明確帶上。
      const r = await window.tuq.agentOrg.applyGroupSource({
        groupId,
        toSourceId,
        teamKeys,
        platforms: ["claude", "codex", "antigravity"],
      });
      if (!r.ok) {
        // r.error 可能含技術細節/路徑，禁穿透給非工程師；保留 console 供除錯。
        console.error("[applyGroupSource] failed", r.error);
        setApplyError("搬移時發生問題，請稍後再試，並確認網路與雲端硬碟連線正常。");
        return;
      }
      const results = r.data?.results ?? [];
      // §1.5：以持久值 groupConfig 為基底重建（mappings rekey + GroupDef.sourceId），重用既有持久化路徑。
      const newConfig = applyRelocationResult(groupConfig, groupId, toSourceId, results);
      await onSave(newConfig);
      setApplyResult({
        successCount: results.filter((x) => x.ok).length,
        failures: results
          .filter((x) => !x.ok)
          .map((x) => ({ displayName: x.displayName, reason: x.message ?? "" })),
      });
    } catch {
      setApplyError("搬移時發生問題，請稍後再試。");
    } finally {
      setApplyBusy(false);
    }
  }, [applyDialog, groupConfig, onSave]);

  // ── Batch A：open 由關→開時，依 target 自動新增群 / 聚焦既有群 ────────────────
  // 只在每次 open session 跑一次（targetHandledRef 控制），避免無限迴圈。
  useEffect(() => {
    if (!open || targetHandledRef.current) return;
    targetHandledRef.current = true;
    if (mode === 'add') {
      // 一開抽屜就新增一個群並進入可命名狀態（新群會被 GroupZone 的 autoEdit 接管聚焦）
      handleAddGroup();
    } else if (focusGroupId) {
      // 捲動到對應 zone（autoEdit 觸發改名態見下方 GroupZone 傳值）。
      // 等下一幀 DOM 就緒後再 scroll。
      setTimeout(() => {
        const el = document.getElementById(`atrf-ge-zone-${focusGroupId}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 32);
    }
  }, [open, mode, focusGroupId, handleAddGroup]);

  // ── 拖拉換群 ──────────────────────────────────────────────────────────────

  const handleDropTeam = useCallback((teamId: string, targetGroupId: string) => {
    setEditingConfig((prev) => moveTeamToGroup(prev, teamId, targetGroupId));
    setDraggingTeamId(null);
    setDragOverGroupId(null);
  }, []);

  const handleTeamDragStart = useCallback((teamId: string) => {
    setDraggingTeamId(teamId);
  }, []);

  const handleTeamDragEnd = useCallback(() => {
    setDraggingTeamId(null);
    setDragOverGroupId(null);
  }, []);

  // ── 儲存 ──────────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await onSave(editingConfig);
    } finally {
      setSaving(false);
    }
  }, [editingConfig, onSave]);

  // ── 依群分桶（含空群；未分類固定最後）─────────────────────────────────────

  const { sortedGroups, teamsByGroup, unclassifiedTeams } = useMemo(() => {
    const sorted = [...editingConfig.groups].sort((a, b) => a.order - b.order);
    const mappingMap = new Map(editingConfig.mappings.map((m) => [m.teamId, m.groupId]));
    const groupIdSet = new Set(editingConfig.groups.map((g) => g.id));
    const byGroup = new Map<string, AgentTeamDto[]>();
    const unclassified: AgentTeamDto[] = [];
    for (const team of teams) {
      const gid = mappingMap.get(team.id);
      if (gid && groupIdSet.has(gid)) {
        const bucket = byGroup.get(gid) ?? [];
        bucket.push(team);
        byGroup.set(gid, bucket);
      } else {
        unclassified.push(team);
      }
    }
    return { sortedGroups: sorted, teamsByGroup: byGroup, unclassifiedTeams: unclassified };
  }, [editingConfig, teams]);

  // Batch A：要自動進改名態的 zone id。
  //  - mode==='add'：剛新增的群（sortedGroups 末尾，order 最大）。
  //  - 否則用 focusGroupId（'edit' 聚焦既有群）。
  const autoEditGroupId =
    mode === 'add'
      ? (sortedGroups.length > 0 ? sortedGroups[sortedGroups.length - 1].id : undefined)
      : focusGroupId;

  // 可調動順序的群（排除系統群，已依 order 排序）；用來算每群是否在頂/底端、
  // 以及只有一個可調動群時不顯示上下箭頭（避免兩顆死按鈕的雜訊）。
  const movableGroupIds = sortedGroups.filter((g) => !g.isSystem).map((g) => g.id);

  // ── 行為乙：套用 dialog 顯示資料（以持久值 groupConfig 為基底算白話名）─────────
  const dialogData = useMemo(() => {
    if (!applyDialog) return null;
    const { groupId, toSourceId } = applyDialog;
    const groupName = groupConfig.groups.find((g) => g.id === groupId)?.name ?? "這個工作群組";
    const toSourceLabel =
      toSourceId === ""
        ? "預設資料夾"
        : (sources?.find((s) => s.id === toSourceId)?.label ?? "新資料夾");
    const teamKeys = computeTeamsToRelocate(groupConfig, groupId, toSourceId || "default");
    const teamNames = teamKeys.map((k) => {
      const t = teams.find((x) => x.id === k);
      return t ? teamLabelOf(t) : k;
    });
    return { groupName, toSourceLabel, teamNames };
  }, [applyDialog, groupConfig, sources, teams]);

  // ── 渲染 ─────────────────────────────────────────────────────────────────

  if (!open) return null;

  return (
    <div className="atrf-ge-overlay" role="region" aria-label="分組設定">
      {/* 純裝飾遮罩；docked 模式下 display:none，不再攔截點擊 */}
      <div className="atrf-ge-backdrop" aria-hidden="true" />

      {/* 面板主體 */}
      <div className="atrf-ge-panel">
        {/* 頭部 */}
        <div className="atrf-ge-header">
          <h3 className="atrf-ge-title">🗂 分組設定</h3>
          <button
            type="button"
            className="atrf-ge-close"
            onClick={onClose}
            aria-label="關閉"
          >
            ✕
          </button>
        </div>

        {/* 可捲動內容 */}
        <div className="atrf-ge-body">
          {/* 操作說明 + 新增工作群組 */}
          <div className="atrf-ge-section-header">
            <p className="atrf-ge-section-hint">
              把團隊卡片拖曳到其他工作群組即可搬移；按「儲存」才會生效。
            </p>
            <button
              type="button"
              className="atrf-ge-add-btn"
              onClick={handleAddGroup}
            >
              ＋ 新增工作群組
            </button>
          </div>

          {/* 每個工作群組一個區塊 */}
          {sortedGroups.map((group) => {
            const hasPending = Object.prototype.hasOwnProperty.call(pendingSource, group.id);
            const effectiveSourceId = hasPending ? pendingSource[group.id] : group.sourceId;
            // 暫存選擇與目前持久值不同 → 顯示「套用並搬移 / 取消」。
            const changed = hasPending && (pendingSource[group.id] ?? undefined) !== (group.sourceId ?? undefined);
            // 順序調整：系統群不可動；只有一個可調動群時不顯示箭頭。
            const mIdx = movableGroupIds.indexOf(group.id);
            const canReorder = mIdx !== -1 && movableGroupIds.length > 1;
            return (
              <React.Fragment key={group.id}>
                <GroupZone
                  group={group}
                  teams={teamsByGroup.get(group.id) ?? []}
                  autoEdit={autoEditGroupId === group.id}
                  isDragOver={dragOverGroupId === group.id}
                  draggingTeamId={draggingTeamId}
                  onRename={group.isSystem ? undefined : (newName) => handleRenameGroup(group.id, newName)}
                  onDescriptionChange={group.isSystem ? undefined : (desc) => handleDescriptionChange(group.id, desc)}
                  onRemove={
                    (!group.isSystem && sortedGroups.length > 1) ? () => handleGroupRemove(group.id) : undefined
                  }
                  onMoveUp={canReorder ? () => handleMoveGroup(group.id, "up") : undefined}
                  onMoveDown={canReorder ? () => handleMoveGroup(group.id, "down") : undefined}
                  canMoveUp={mIdx > 0}
                  canMoveDown={mIdx !== -1 && mIdx < movableGroupIds.length - 1}
                  onDropTeam={(teamId) => handleDropTeam(teamId, group.id)}
                  onDragOverZone={() => setDragOverGroupId(group.id)}
                  onDragLeaveZone={() =>
                    setDragOverGroupId((cur) => (cur === group.id ? null : cur))
                  }
                  onTeamDragStart={handleTeamDragStart}
                  onTeamDragEnd={handleTeamDragEnd}
                  lockDrop={group.isSystem}
                  sources={sources}
                  sourceId={effectiveSourceId}
                  onSourceChange={group.isSystem ? undefined : (sid) => handleSourceChange(group.id, sid)}
                  onAddSource={group.isSystem ? undefined : onAddSource}
                />
                {changed && (
                  <div className="atrf-ge-apply-row" style={APPLY_ROW_STYLE}>
                    <button
                      type="button"
                      className="atrf-ge-btn atrf-ge-btn--cancel"
                      onClick={() => handleCancelPending(group.id)}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="atrf-ge-btn atrf-ge-btn--save"
                      onClick={() => handleOpenApply(group.id, pendingSource[group.id])}
                    >
                      套用並搬移
                    </button>
                  </div>
                )}
              </React.Fragment>
            );
          })}
          {sortedGroups.length === 0 && (
            <p className="atrf-ge-empty-hint">尚無工作群組，請按「新增工作群組」。</p>
          )}

          {/* 未分類區（固定最後） */}
          <GroupZone
            group={UNCLASSIFIED_DISPLAY}
            teams={unclassifiedTeams}
            isUnclassified
            isDragOver={dragOverGroupId === UNCLASSIFIED_DISPLAY.id}
            draggingTeamId={draggingTeamId}
            onDropTeam={(teamId) => handleDropTeam(teamId, UNCLASSIFIED_DISPLAY.id)}
            onDragOverZone={() => setDragOverGroupId(UNCLASSIFIED_DISPLAY.id)}
            onDragLeaveZone={() =>
              setDragOverGroupId((cur) => (cur === UNCLASSIFIED_DISPLAY.id ? null : cur))
            }
            onTeamDragStart={handleTeamDragStart}
            onTeamDragEnd={handleTeamDragEnd}
          />
        </div>

        {/* 底部操作列 */}
        <div className="atrf-ge-footer">
          <button
            type="button"
            className="atrf-ge-btn atrf-ge-btn--cancel"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="button"
            className="atrf-ge-btn atrf-ge-btn--save"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "儲存中…" : "儲存"}
          </button>
        </div>
      </div>

      {/* 行為乙：套用並搬移確認 dialog（置中，蓋在分組設定面板之上） */}
      <GroupSourceApplyDialog
        open={applyDialog !== null}
        groupName={dialogData?.groupName ?? ""}
        toSourceLabel={dialogData?.toSourceLabel ?? ""}
        teamNames={dialogData?.teamNames ?? []}
        busy={applyBusy}
        result={applyResult}
        errorMessage={applyError}
        onConfirm={handleConfirmApply}
        onClose={handleCloseApply}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 工具函式
// ---------------------------------------------------------------------------

const APPLY_ROW_STYLE: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  margin: "-10px 0 4px",
};

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function generateId(): string {
  // crypto.randomUUID 若可用則取前 8 碼；否則 fallback
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
