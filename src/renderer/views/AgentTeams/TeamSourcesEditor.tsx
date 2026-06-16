/**
 * TeamSourcesEditor.tsx — 多個「團隊來源」管理面板（docs/multi-source-teams.md Phase 2）
 *
 * 職責：列出目前所有來源、新增（用 dialog.openDirectory 選資料夾）、移除、改顯示名。
 * 沿用 RootPathEditor 的 at-root-editor* 樣式；文案白話（面向非工程師）。
 * 任何成功的變更都會呼 onChanged() 讓上層重掃（doScan）。
 *
 * 用語：對非工程師，「來源」＝一個放團隊的資料夾位置（公司雲端、本機草稿…）。
 */
import React, { useCallback, useEffect, useState } from "react";
import type { TeamSource } from "../../../shared/ipcContracts";

export interface TeamSourcesEditorProps {
  /** 任一來源新增/移除/改名成功後呼叫（上層用來重掃團隊）。 */
  onChanged: () => void;
  /** 關閉面板。 */
  onClose: () => void;
}

type Bridge = {
  agentOrg?: {
    listSources: () => Promise<{ ok: boolean; data?: TeamSource[]; error?: string }>;
    addSource: (p: {
      label: string;
      path: string;
      kind?: TeamSource["kind"];
    }) => Promise<{ ok: boolean; data?: TeamSource[]; error?: string }>;
    removeSource: (
      id: string,
    ) => Promise<{ ok: boolean; data?: TeamSource[]; error?: string }>;
    updateSource: (p: {
      id: string;
      label?: string;
      path?: string;
    }) => Promise<{ ok: boolean; data?: TeamSource[]; error?: string }>;
  };
  dialog?: {
    openDirectory: () => Promise<{ ok: boolean; data?: string | null }>;
  };
};

function getBridge(): Bridge | undefined {
  return (window as Window & typeof globalThis & { tuq?: Bridge }).tuq;
}

export function TeamSourcesEditor({
  onChanged,
  onClose,
}: TeamSourcesEditorProps): React.JSX.Element {
  const bridge = getBridge();

  const [sources, setSources] = useState<TeamSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // 新增列表單狀態
  const [newLabel, setNewLabel] = useState("");
  const [newPath, setNewPath] = useState("");

  // 改名中的來源 id → 暫存 label
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  const refresh = useCallback(async () => {
    if (!bridge?.agentOrg) {
      setLoading(false);
      return;
    }
    try {
      const r = await bridge.agentOrg.listSources();
      if (r.ok && r.data) setSources(r.data);
      else setErrMsg(r.error ?? "讀取來源清單失敗");
    } catch (e) {
      setErrMsg(String(e));
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleBrowse = useCallback(async () => {
    if (!bridge?.dialog) return;
    try {
      const r = await bridge.dialog.openDirectory();
      if (r.ok && r.data) setNewPath(r.data);
    } catch {
      /* ignore */
    }
  }, [bridge]);

  const handleAdd = useCallback(async () => {
    if (!bridge?.agentOrg) return;
    const label = newLabel.trim();
    const p = newPath.trim();
    if (!label || !p) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const r = await bridge.agentOrg.addSource({ label, path: p });
      if (!r.ok) {
        setErrMsg(r.error ?? "新增失敗");
      } else {
        if (r.data) setSources(r.data);
        setNewLabel("");
        setNewPath("");
        onChanged();
      }
    } catch (e) {
      setErrMsg(String(e));
    } finally {
      setBusy(false);
    }
  }, [bridge, newLabel, newPath, onChanged]);

  const handleRemove = useCallback(
    async (id: string, label: string) => {
      if (!bridge?.agentOrg) return;
      if (sources.length <= 1) {
        setErrMsg("至少要保留一個團隊來源，無法移除最後一個。");
        return;
      }
      if (
        !window.confirm(
          `確定要移除來源「${label}」嗎？\n（只是從清單移除，不會刪掉你電腦上的資料夾。）`,
        )
      ) {
        return;
      }
      setBusy(true);
      setErrMsg(null);
      try {
        const r = await bridge.agentOrg.removeSource(id);
        if (!r.ok) {
          setErrMsg(r.error ?? "移除失敗");
        } else {
          if (r.data) setSources(r.data);
          onChanged();
        }
      } catch (e) {
        setErrMsg(String(e));
      } finally {
        setBusy(false);
      }
    },
    [bridge, sources.length, onChanged],
  );

  const startEdit = useCallback((s: TeamSource) => {
    setEditingId(s.id);
    setEditLabel(s.label);
  }, []);

  const handleSaveLabel = useCallback(async () => {
    if (!bridge?.agentOrg || !editingId) return;
    const label = editLabel.trim();
    if (!label) return;
    setBusy(true);
    setErrMsg(null);
    try {
      const r = await bridge.agentOrg.updateSource({ id: editingId, label });
      if (!r.ok) {
        setErrMsg(r.error ?? "改名失敗");
      } else {
        if (r.data) setSources(r.data);
        setEditingId(null);
        setEditLabel("");
        onChanged();
      }
    } catch (e) {
      setErrMsg(String(e));
    } finally {
      setBusy(false);
    }
  }, [bridge, editingId, editLabel, onChanged]);

  return (
    <div className="at-root-editor at-sources-editor">
      <div className="at-sources-editor__head">
        <span className="at-sources-editor__title">📁 團隊資料夾來源</span>
        <button
          type="button"
          className="at-root-editor__btn"
          onClick={onClose}
          disabled={busy}
        >
          關閉
        </button>
      </div>
      <p className="at-sources-editor__hint">
        這裡管理「放團隊的資料夾」。你可以加入多個位置（例如公司共用雲端、本機草稿），
        團隊清單會把它們合在一起顯示。
      </p>

      {loading ? (
        <p className="at-sources-editor__loading">讀取中…</p>
      ) : (
        <ul className="at-sources-list">
          {sources.map((s) => (
            <li key={s.id} className="at-sources-item">
              <div className="at-sources-item__main">
                {editingId === s.id ? (
                  <input
                    className="at-root-editor__input at-sources-item__label-input"
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    disabled={busy}
                    autoFocus
                  />
                ) : (
                  <span className="at-sources-item__label">{s.label}</span>
                )}
                <span className="at-sources-item__path" title={s.path}>
                  {s.path}
                </span>
              </div>
              <div className="at-sources-item__actions">
                {editingId === s.id ? (
                  <>
                    <button
                      type="button"
                      className="at-root-editor__btn at-root-editor__btn--primary"
                      onClick={handleSaveLabel}
                      disabled={busy || !editLabel.trim()}
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      className="at-root-editor__btn"
                      onClick={() => {
                        setEditingId(null);
                        setEditLabel("");
                      }}
                      disabled={busy}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="at-root-editor__btn"
                      onClick={() => startEdit(s)}
                      disabled={busy}
                      title="改顯示名稱"
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      className="at-root-editor__btn at-root-editor__btn--reset"
                      onClick={() => handleRemove(s.id, s.label)}
                      disabled={busy || sources.length <= 1}
                      title={
                        sources.length <= 1
                          ? "至少要保留一個來源"
                          : "從清單移除這個來源"
                      }
                    >
                      移除
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 新增來源 */}
      <div className="at-sources-add">
        <div className="at-sources-add__title">新增一個資料夾來源</div>
        <div className="at-root-editor__row">
          <input
            className="at-root-editor__input at-sources-add__label"
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="顯示名稱（例如：公司共用、本機草稿）"
            disabled={busy}
          />
        </div>
        <div className="at-root-editor__row">
          <input
            className="at-root-editor__input"
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            placeholder="資料夾路徑（agents 根）"
            disabled={busy}
          />
          <button
            type="button"
            className="at-root-editor__btn"
            onClick={handleBrowse}
            disabled={busy}
          >
            瀏覽…
          </button>
          <button
            type="button"
            className="at-root-editor__btn at-root-editor__btn--primary"
            onClick={handleAdd}
            disabled={busy || !newLabel.trim() || !newPath.trim()}
          >
            {busy ? "處理中…" : "新增"}
          </button>
        </div>
      </div>

      {errMsg && <p className="at-root-editor__error">{errMsg}</p>}
    </div>
  );
}

export default TeamSourcesEditor;
