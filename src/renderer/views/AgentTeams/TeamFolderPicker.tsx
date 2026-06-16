/**
 * TeamFolderPicker.tsx — 團隊對話 session 設定彈窗
 *
 * 職責：
 *   - 資料夾：常用清單（recentFolders）+「瀏覽…」→ 設 folder state（不再立即關閉）
 *   - 專案：依 folder 反查（projects.byFolder）→ 選既有 / ＋新建 / 不關聯
 *   - 模型：availableModels（view 端 detect 後傳入，含誠實監測標註）
 *   - 里程碑（選填）：選定 project 後載入（milestones.findAll）
 *   - 任務：textarea，必填
 *   - 底部「開始對話」→ onConfirm(TeamSessionRequest)；task 送出前 strip \r\n
 *   - Esc 關閉；a11y：role=dialog + aria-modal + focus
 *
 * agentteams-embedded-conversation-20260608
 */
import React, { useEffect, useRef, useState, useCallback } from "react";
import type { CliId } from "../../../shared/cliRegistry";
import type { ProjectDto, MilestoneDto } from "../../../shared/ipcContracts";

export interface TeamSessionRequest {
  folder: string;
  model: CliId; // 'claude' | 'codex' | 'antigravity'
  projectLocalId: string | null; // 選既有 project；null=不關聯 / 新建
  newProjectName: string | null; // 有值=新建此名 project（與 projectLocalId 互斥）
  milestoneLocalId: string | null; // 選填
  task: string; // 任務文字（textarea）
}

export interface TeamFolderPickerProps {
  teamId: string;
  teamLabel: string;
  recentFolders: string[];
  /** view 端 cli.detect 後過濾 installed 傳入；含誠實監測標註 label。 */
  availableModels: { id: CliId; label: string }[];
  onConfirm: (r: TeamSessionRequest) => void;
  onCancel: () => void;
  /** 使用者透過「瀏覽資料夾…」選好路徑後立即回呼（供上層即時寫入歷史）。 */
  onFolderBrowsed?: (folder: string) => void;
}

/** 預設模型：偏好 'claude'，availableModels 無 claude 則取第一個。 */
function pickDefaultModel(models: { id: CliId; label: string }[]): CliId {
  if (models.some((m) => m.id === "claude")) return "claude";
  return models[0]?.id ?? "claude";
}

export function TeamFolderPicker({
  teamLabel,
  recentFolders,
  availableModels,
  onConfirm,
  onCancel,
  onFolderBrowsed,
}: TeamFolderPickerProps): React.JSX.Element {
  const [browsing, setBrowsing] = useState(false);
  const [folder, setFolder] = useState<string>("");
  const [model, setModel] = useState<CliId>(() => pickDefaultModel(availableModels));
  const [projectLocalId, setProjectLocalId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState<string>("");
  const [milestoneLocalId, setMilestoneLocalId] = useState<string | null>(null);
  const [task, setTask] = useState<string>("");

  // folder 反查結果（projects.byFolder）；命中多筆列下拉，0 筆顯提示。
  const [folderProjects, setFolderProjects] = useState<ProjectDto[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  // 選定 project 後載入的里程碑清單。
  const [milestones, setMilestones] = useState<MilestoneDto[]>([]);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Esc 關閉
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  // mount 時聚焦彈窗（a11y）
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // folder 變更 → 反查關聯專案（多對多）。命中 1 筆預選；多筆不預選；0 筆提示。
  useEffect(() => {
    if (!folder) {
      setFolderProjects([]);
      setProjectsLoaded(false);
      setProjectLocalId(null);
      return;
    }
    let cancelled = false;
    setProjectsLoaded(false);
    void (async () => {
      try {
        const r = await window.tuq.projects.byFolder({ folderPath: folder });
        if (cancelled) return;
        const list = r.ok && r.data ? r.data : [];
        setFolderProjects(list);
        // 命中 1 筆 → 預選；多筆/0 筆 → 不預選（清空，由使用者明確選）。
        setProjectLocalId(list.length === 1 ? list[0].id : null);
      } catch {
        if (!cancelled) setFolderProjects([]);
      } finally {
        if (!cancelled) setProjectsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [folder]);

  // 選定 project 後載入里程碑；未選 project（含新建）則清空。
  useEffect(() => {
    if (!projectLocalId) {
      setMilestones([]);
      setMilestoneLocalId(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const r = await window.tuq.milestones.findAll({ projectLocalId });
        if (cancelled) return;
        setMilestones(r.ok && r.data ? r.data : []);
      } catch {
        if (!cancelled) setMilestones([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectLocalId]);

  const handleBrowse = useCallback(async () => {
    setBrowsing(true);
    try {
      const r = await window.tuq.dialog.openDirectory();
      if (r.ok && r.data) {
        setFolder(r.data);
        // 瀏覽選取後立即通知上層寫入歷史（不必等 onConfirm）。
        onFolderBrowsed?.(r.data);
      }
    } catch {
      // 使用者取消或錯誤 → 維持彈窗
    } finally {
      setBrowsing(false);
    }
  }, [onFolderBrowsed]);

  // 選既有 project：清空新建名（互斥）。
  const handleSelectProject = useCallback((value: string) => {
    setProjectLocalId(value || null);
    setNewProjectName("");
  }, []);

  // 填新建名：清空 projectLocalId（互斥）。
  const handleNewProjectName = useCallback((value: string) => {
    setNewProjectName(value);
    if (value.trim()) setProjectLocalId(null);
  }, []);

  const canConfirm = folder !== "" && task.trim() !== "";

  const handleConfirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm({
      folder,
      model,
      // 新建名有值 → 走新建（projectLocalId 必為 null，互斥已保證）。
      projectLocalId: newProjectName.trim() ? null : projectLocalId,
      newProjectName: newProjectName.trim() || null,
      milestoneLocalId,
      // strip \r\n 防 PTY 注入破壞（多行任務折成單一注入）。
      task: task.replace(/[\r\n]+/g, " ").trim(),
    });
  }, [canConfirm, folder, model, newProjectName, projectLocalId, milestoneLocalId, task, onConfirm]);

  return (
    <div
      className="tfp-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="tfp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`設定「${teamLabel}」的對話 session`}
        tabIndex={-1}
      >
        <div className="tfp-header">
          <span className="tfp-title">💬 開始團隊對話</span>
          <span className="tfp-subtitle">團隊：{teamLabel}</span>
          <button
            type="button"
            className="tfp-close"
            onClick={onCancel}
            aria-label="取消"
          >
            ✕
          </button>
        </div>

        <div className="tfp-body">
          {/* a. 資料夾 */}
          <div className="tfp-section">
            <div className="tfp-section-label">工作資料夾</div>
            {recentFolders.length > 0 && (
              <select
                className="tfp-select tfp-folder-select"
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
                aria-label="常用資料夾"
              >
                <option value="">（請選擇或瀏覽）</option>
                {recentFolders.map((f) => (
                  <option key={f} value={f} title={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
            {recentFolders.length === 0 && (
              <p className="tfp-empty-hint">尚無常用資料夾，請瀏覽選擇</p>
            )}
            <button
              type="button"
              className="tfp-browse-btn"
              onClick={handleBrowse}
              disabled={browsing}
            >
              {browsing ? "選擇中…" : "瀏覽資料夾…"}
            </button>
            {folder && (
              <p className="tfp-selected-folder" title={folder}>
                已選：{folder}
              </p>
            )}
          </div>

          {/* b. 專案 */}
          <div className="tfp-section">
            <div className="tfp-section-label">專案（選填）</div>
            <select
              className="tfp-select"
              value={projectLocalId ?? ""}
              onChange={(e) => handleSelectProject(e.target.value)}
              disabled={!!newProjectName.trim()}
            >
              <option value="">不關聯專案</option>
              {folderProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {folder && projectsLoaded && folderProjects.length === 0 && (
              <p className="tfp-empty-hint">此資料夾尚無關聯專案</p>
            )}
            <input
              type="text"
              className="tfp-new-project"
              placeholder="＋ 新建專案（填名稱）"
              value={newProjectName}
              onChange={(e) => handleNewProjectName(e.target.value)}
            />
          </div>

          {/* c. 模型 */}
          <div className="tfp-section">
            <div className="tfp-section-label">模型</div>
            {availableModels.length === 0 ? (
              <p className="tfp-empty-hint">未偵測到已安裝的 AI CLI</p>
            ) : (
              <select
                className="tfp-select"
                value={model}
                onChange={(e) => setModel(e.target.value as CliId)}
              >
                {availableModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* d. 里程碑（選填，選定 project 後才出現） */}
          {projectLocalId && (
            <div className="tfp-section">
              <div className="tfp-section-label">里程碑（選填）</div>
              <select
                className="tfp-select"
                value={milestoneLocalId ?? ""}
                onChange={(e) => setMilestoneLocalId(e.target.value || null)}
              >
                <option value="">（不指定）</option>
                {milestones.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* e. 任務 */}
          <div className="tfp-section">
            <div className="tfp-section-label">任務</div>
            <textarea
              className="tfp-task"
              placeholder="描述要交給團隊的任務…"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <div className="tfp-footer">
          <button type="button" className="tfp-cancel-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className="tfp-confirm-btn"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            開始對話
          </button>
        </div>
      </div>
    </div>
  );
}

export default TeamFolderPicker;
