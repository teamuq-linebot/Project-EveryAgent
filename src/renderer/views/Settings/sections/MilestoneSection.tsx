// ---------------------------------------------------------------------------
// ⏱ 監測與工時 — Milestone→專案路徑/工具綁定（搬自舊 SettingsView 主區，config:get/setMilestone）
// ---------------------------------------------------------------------------

import React, { useCallback, useState } from "react";

const TOOLS = ["claude", "codex", "vscode", "custom"] as const;
type Tool = (typeof TOOLS)[number];

export function MilestoneSection(): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string>("");
  const [form, setForm] = useState({
    projectPath: "",
    tool: "claude" as Tool,
    customCommand: "",
  });
  const [loaded, setLoaded] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{
    text: string;
    ok: boolean;
  } | null>(null);

  const loadMilestone = useCallback(async (id: string) => {
    if (!id.trim()) {
      setLoaded(false);
      setForm({ projectPath: "", tool: "claude", customCommand: "" });
      return;
    }
    try {
      const result = await window.tuq.config.getMilestone(id.trim());
      if (result.ok && result.data) {
        const e = result.data;
        setLoaded(true);
        setForm({
          projectPath: e.project_path ?? "",
          tool: (TOOLS.includes(e.tool as Tool) ? e.tool : "claude") as Tool,
          customCommand: e.custom_command ?? "",
        });
      } else {
        setLoaded(false);
        setForm({ projectPath: "", tool: "claude", customCommand: "" });
      }
    } catch {
      setLoaded(false);
    }
    setStatusMsg(null);
  }, []);

  const handleBrowse = useCallback(async () => {
    try {
      const result = await window.tuq.dialog.openDirectory();
      if (result.ok && result.data) {
        setForm((prev) => ({ ...prev, projectPath: result.data as string }));
      }
    } catch {
      /* 真機 dialog 未開 → 靜默 */
    }
  }, []);

  const handleSave = useCallback(async () => {
    const id = selectedId.trim();
    if (!id) {
      setStatusMsg({ text: "✗ 請填寫 Milestone ID", ok: false });
      return;
    }
    if (!form.projectPath.trim()) {
      setStatusMsg({ text: "✗ 請填寫專案資料路徑", ok: false });
      return;
    }
    try {
      const result = await window.tuq.config.setMilestone({
        milestoneId: id,
        projectPath: form.projectPath.trim(),
        tool: form.tool,
        customCommand:
          form.tool === "custom" ? form.customCommand.trim() : null,
      });
      if (result.ok) {
        setStatusMsg({ text: "✓ 已儲存", ok: true });
        setLoaded(true);
      } else {
        setStatusMsg({ text: `✗ 儲存失敗：${result.error}`, ok: false });
      }
    } catch (e) {
      setStatusMsg({
        text: `✗ 儲存失敗：${e instanceof Error ? e.message : String(e)}`,
        ok: false,
      });
    }
  }, [selectedId, form]);

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">Milestone → 專案對應</h3>
      <div className="settings-form">
        <label className="settings-form__label">
          Milestone ID：
          <input
            className="settings-form__input"
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setStatusMsg(null);
            }}
            onBlur={() => loadMilestone(selectedId)}
            placeholder="輸入 milestone id（失焦自動載入）"
          />
        </label>

        {loaded && (
          <p
            style={{
              fontSize: 12,
              color: "var(--text-muted)",
              margin: "0 0 var(--sp-2)",
            }}
          >
            已載入既有設定
          </p>
        )}

        <label className="settings-form__label">
          專案資料路徑：
          <div style={{ display: "flex", gap: "var(--sp-2)" }}>
            <input
              className="settings-form__input"
              value={form.projectPath}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, projectPath: e.target.value }))
              }
              placeholder="/path/to/project"
              style={{ flex: 1 }}
            />
            <button className="settings-form__btn" onClick={handleBrowse}>
              瀏覽…
            </button>
          </div>
        </label>

        <label className="settings-form__label">
          Tool：
          <select
            className="settings-form__select"
            value={form.tool}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, tool: e.target.value as Tool }))
            }
          >
            {TOOLS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        {form.tool === "custom" && (
          <label className="settings-form__label">
            Custom 指令：
            <input
              className="settings-form__input"
              value={form.customCommand}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, customCommand: e.target.value }))
              }
              placeholder="輸入自訂指令"
            />
          </label>
        )}

        <div
          style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}
        >
          <button
            className="settings-form__btn settings-form__btn--primary"
            onClick={handleSave}
          >
            儲存
          </button>
          {statusMsg && (
            <span
              style={{
                fontSize: 13,
                color: statusMsg.ok ? "var(--success)" : "var(--error)",
              }}
            >
              {statusMsg.text}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
