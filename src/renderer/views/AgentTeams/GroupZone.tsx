/**
 * GroupZone.tsx — 分組設定抽屜的「工作群組區塊」子元件
 *
 * 一個工作群組一個區塊：群標題（雙擊或鉛筆改名）＋ 該群的團隊卡片清單。
 * 團隊卡片用原生 HTML5 drag & drop 拖到其他區塊放下即完成搬移。
 * 未分類區（isUnclassified）固定在最後，不可改名/刪除。
 */
import React, { useState, useCallback, useEffect, useRef } from "react";
import type { GroupDef } from "./groupConfig";
import type { AgentTeamDto } from "../../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// 團隊顯示名稱（與 AgentOrgList 慣例一致：經理顯示名 → 經理名 → 目錄名）
// ---------------------------------------------------------------------------

export function teamLabelOf(team: AgentTeamDto): string {
  return team.manager?.displayName ?? team.manager?.name ?? team.id;
}

// ---------------------------------------------------------------------------
// 團隊卡片（可拖曳）
// ---------------------------------------------------------------------------

interface TeamCardProps {
  team: AgentTeamDto;
  dragging: boolean;
  onDragStart: (teamId: string) => void;
  onDragEnd: () => void;
  /** 系統群成員：true 時 draggable={false} 且不顯示拖曳 grip。 */
  locked?: boolean;
}

function TeamCard({ team, dragging, onDragStart, onDragEnd, locked }: TeamCardProps): React.JSX.Element {
  const label = teamLabelOf(team);
  return (
    <div
      className={`atrf-ge-team-card${dragging ? " atrf-ge-team-card--dragging" : ""}${locked ? " atrf-ge-team-card--locked" : ""}`}
      draggable={!locked}
      onDragStart={locked ? undefined : (e) => {
        e.dataTransfer.setData("text/plain", team.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(team.id);
      }}
      onDragEnd={locked ? undefined : onDragEnd}
      title={locked ? label : `${label}（拖曳到其他工作群組即可搬移）`}
    >
      {!locked && <span className="atrf-ge-team-card__grip" aria-hidden="true">⠿</span>}
      <span className="atrf-ge-team-card__name">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 工作群組區塊（拖放目標 + 群名 inline 改名）
// ---------------------------------------------------------------------------

export interface GroupZoneProps {
  group: GroupDef;
  teams: AgentTeamDto[];
  /** 未分類區：不可改名/刪除，永遠顯示在最後。 */
  isUnclassified?: boolean;
  /** Batch A：true 時自動進入改名態並聚焦輸入框（由 GroupConfigEditor 對命中的 zone 傳入）。 */
  autoEdit?: boolean;
  /** 拖曳中的團隊正經過此區塊（高亮）。 */
  isDragOver: boolean;
  /** 目前拖曳中的團隊（null = 沒有拖曳進行中）。 */
  draggingTeamId: string | null;
  onRename?: (newName: string) => void;
  /** 描述變更（commit on blur）；未提供時不顯示描述輸入框（如未分類區）。 */
  onDescriptionChange?: (newDescription: string) => void;
  onRemove?: () => void;
  /** 群組往前移一位；未提供時不顯示上移按鈕（系統群 / 未分類）。 */
  onMoveUp?: () => void;
  /** 群組往後移一位；未提供時不顯示下移按鈕（系統群 / 未分類）。 */
  onMoveDown?: () => void;
  /** 是否已在最前（上移按鈕 disable）。 */
  canMoveUp?: boolean;
  /** 是否已在最後（下移按鈕 disable）。 */
  canMoveDown?: boolean;
  onDropTeam: (teamId: string) => void;
  onDragOverZone: () => void;
  onDragLeaveZone: () => void;
  onTeamDragStart: (teamId: string) => void;
  onTeamDragEnd: () => void;
  /** 系統群：true 時不接受任何 drop（handleDragOver 不 preventDefault、handleDrop 早退）。 */
  lockDrop?: boolean;
  /** 可供選擇的團隊資料夾來源清單（選項 A：綁 sourceId）。 */
  sources?: { id: string; label: string }[];
  /** 目前群組綁定的 sourceId（undefined = 預設來源）。 */
  sourceId?: string;
  /** 選擇資料夾來源時的回呼；空選項傳 undefined。undefined 時 select disabled。 */
  onSourceChange?: (sourceId: string | undefined) => void;
  /**
   * 就地新增一個資料夾來源：開資料夾選擇器→加入來源清單。
   * 回傳新來源 id（成功）或 undefined（取消/失敗）；成功時本元件會把該群選取值指向新來源。
   * 未提供時不顯示「＋ 新增資料夾」按鈕（如系統群）。
   */
  onAddSource?: () => Promise<string | undefined>;
}

export function GroupZone({
  group,
  teams,
  isUnclassified = false,
  autoEdit = false,
  isDragOver,
  draggingTeamId,
  onRename,
  onDescriptionChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  onDropTeam,
  onDragOverZone,
  onDragLeaveZone,
  onTeamDragStart,
  onTeamDragEnd,
  lockDrop,
  sources,
  sourceId,
  onSourceChange,
  onAddSource,
}: GroupZoneProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  // 就地新增資料夾來源進行中（避免重複點擊開多個選擇器）。
  const [addingSource, setAddingSource] = useState(false);
  const [nameVal, setNameVal] = useState(group.name);
  const [descVal, setDescVal] = useState(group.description ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  // Batch A：記錄已處理過的 autoEdit，避免 autoEdit 持續 true 時每 render 重設改名態
  const autoEditHandledRef = useRef(false);

  // 同步外部 name 變更（如父元件 reset）
  useEffect(() => {
    setNameVal(group.name);
  }, [group.name]);

  // 同步外部 description 變更（如父元件 reset）
  useEffect(() => {
    setDescVal(group.description ?? "");
  }, [group.description]);

  // Batch A：autoEdit 由 false→true 時自動進改名態並聚焦輸入框（只跑一次）
  useEffect(() => {
    if (autoEdit && !autoEditHandledRef.current && onRename) {
      autoEditHandledRef.current = true;
      setEditing(true);
      // 等下一幀 input 渲染後 focus + 全選，方便直接覆寫
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 16);
    }
    if (!autoEdit) {
      autoEditHandledRef.current = false;
    }
  }, [autoEdit, onRename]);

  const commitRename = useCallback(() => {
    const trimmed = nameVal.trim();
    if (trimmed && trimmed !== group.name) {
      onRename?.(trimmed);
    } else {
      setNameVal(group.name); // 恢復
    }
    setEditing(false);
  }, [nameVal, group.name, onRename]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      // 阻止冒泡，避免被 GroupConfigEditor 掛在 document 的 keydown 攔截
      e.stopPropagation();
      commitRename();
    }
    if (e.key === "Escape") {
      // 阻止冒泡，否則 Escape 會冒泡到 document → onClose() 誤關整個抽屜並丟失未存的換群
      e.stopPropagation();
      setNameVal(group.name);
      setEditing(false);
    }
  }, [commitRename, group.name]);

  const startEdit = useCallback(() => {
    if (!onRename) return;
    setEditing(true);
    // 等下一幀 input 出現後 focus
    setTimeout(() => inputRef.current?.focus(), 16);
  }, [onRename]);

  // ── 描述 inline 編輯（commit on blur，避免每鍵重算 config）──────────────────

  const commitDescription = useCallback(() => {
    // 與目前 group.description 不同才提交（含清空：'' 對應 undefined）
    if (descVal !== (group.description ?? "")) {
      onDescriptionChange?.(descVal);
    }
  }, [descVal, group.description, onDescriptionChange]);

  const handleDescKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Escape 必須阻止冒泡，否則會冒泡到 document → onClose() 誤關整個抽屜並丟失未存的換群。
    if (e.key === "Escape") {
      e.stopPropagation();
      setDescVal(group.description ?? "");
      (e.target as HTMLTextAreaElement).blur();
    }
    // Enter 在 textarea 應允許換行，不攔截送出。
  }, [group.description]);

  // ── 拖放目標 handlers ─────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!draggingTeamId) return; // 只接受本面板內的團隊拖曳
    if (lockDrop) return; // 系統群：不接受 drop，不高亮
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    onDragOverZone();
  }, [draggingTeamId, lockDrop, onDragOverZone]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 進入子元素也會觸發 dragleave；只在真正離開區塊時清除高亮
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      onDragLeaveZone();
    }
  }, [onDragLeaveZone]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (lockDrop) return; // 系統群：不接受拖入
    e.preventDefault();
    const teamId = e.dataTransfer.getData("text/plain") || draggingTeamId;
    if (teamId) onDropTeam(teamId);
  }, [lockDrop, draggingTeamId, onDropTeam]);

  // ── 就地新增資料夾來源 ───────────────────────────────────────────────────────
  // 開資料夾選擇器→加入來源清單（成功回新來源 id）→把本群選取值指向它（走既有 onSourceChange）。
  const handleAddSourceClick = useCallback(async () => {
    if (!onAddSource || addingSource) return;
    setAddingSource(true);
    try {
      const newId = await onAddSource();
      if (newId) onSourceChange?.(newId);
    } finally {
      setAddingSource(false);
    }
  }, [onAddSource, addingSource, onSourceChange]);

  // ── 渲染 ─────────────────────────────────────────────────────────────────

  const zoneClass = [
    "atrf-ge-zone",
    isUnclassified ? "atrf-ge-zone--unclassified" : "",
    isDragOver ? "atrf-ge-zone--over" : "",
  ].filter(Boolean).join(" ");

  return (
    <section
      id={`atrf-ge-zone-${group.id}`}
      className={zoneClass}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      aria-label={`${group.name} 工作群組`}
    >
      <div className="atrf-ge-zone-header">
        {group.color && (
          <span className="atrf-ge-group-dot" style={{ background: group.color }} />
        )}
        {group.icon && <span className="atrf-ge-group-icon">{group.icon}</span>}

        {editing ? (
          <input
            ref={inputRef}
            className="atrf-ge-group-name-input"
            value={nameVal}
            onChange={(e) => setNameVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            maxLength={30}
            aria-label="工作群組名稱"
          />
        ) : (
          <span
            className="atrf-ge-group-name"
            onDoubleClick={startEdit}
            title={onRename ? "雙擊可改名" : undefined}
          >
            {group.name}
          </span>
        )}

        <span className="atrf-ge-zone-count">{teams.length} 個團隊</span>

        {onMoveUp && (
          <button
            type="button"
            className="atrf-ge-inline-btn"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            title="往前移一位"
            aria-label={`${group.name} 往前移一位`}
          >
            ▲
          </button>
        )}

        {onMoveDown && (
          <button
            type="button"
            className="atrf-ge-inline-btn"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            title="往後移一位"
            aria-label={`${group.name} 往後移一位`}
          >
            ▼
          </button>
        )}

        {!editing && onRename && (
          <button
            type="button"
            className="atrf-ge-inline-btn"
            onClick={startEdit}
            title="改名"
            aria-label={`重新命名 ${group.name}`}
          >
            ✏️
          </button>
        )}

        {onRemove && (
          <button
            type="button"
            className="atrf-ge-inline-btn atrf-ge-inline-btn--danger"
            onClick={onRemove}
            title="刪除此工作群組（裡面的團隊會移到未分類）"
            aria-label={`刪除 ${group.name}`}
          >
            🗑
          </button>
        )}
      </div>

      <div className="atrf-ge-zone-body">
        {onDescriptionChange && (
          <textarea
            className="atrf-ge-group-desc-input"
            value={descVal}
            onChange={(e) => setDescVal(e.target.value)}
            onBlur={commitDescription}
            onKeyDown={handleDescKeyDown}
            placeholder="這個工作群組是做什麼的？（建立新團隊時會把這段說明給 AI 當背景）"
            aria-label={`${group.name} 工作群組描述`}
            rows={2}
            style={{
              width: "100%",
              minHeight: "3.4em",
              marginBottom: 8,
              padding: "6px 8px",
              fontSize: "0.85em",
              lineHeight: 1.4,
              fontFamily: "inherit",
              color: "inherit",
              background: "rgba(0,0,0,0.18)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 6,
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
        )}
        {sources !== undefined && (
          <div className="atrf-ge-zone-source-row">
            <label className="atrf-ge-zone-source-label" htmlFor={`atrf-ge-source-${group.id}`}>
              團隊資料夾
            </label>
            <select
              id={`atrf-ge-source-${group.id}`}
              className="atrf-ge-zone-source-select"
              value={sourceId ?? ""}
              disabled={!onSourceChange || lockDrop}
              onChange={(e) => {
                const val = e.target.value;
                onSourceChange?.(val === "" ? undefined : val);
              }}
            >
              <option value="">（預設來源）</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
            {onAddSource && onSourceChange && !lockDrop && (
              <button
                type="button"
                className="atrf-ge-zone-source-add"
                onClick={() => void handleAddSourceClick()}
                disabled={addingSource}
                title="挑一個電腦上的資料夾當新的團隊存放位置"
              >
                {addingSource ? "處理中…" : "＋ 新增資料夾…"}
              </button>
            )}
          </div>
        )}
        {teams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            dragging={draggingTeamId === team.id}
            onDragStart={onTeamDragStart}
            onDragEnd={onTeamDragEnd}
            locked={lockDrop}
          />
        ))}
        {teams.length === 0 && (
          <p className="atrf-ge-zone-empty">
            {isUnclassified ? "所有團隊都已分組" : "目前沒有團隊，把團隊拖曳到這裡"}
          </p>
        )}
      </div>
    </section>
  );
}
