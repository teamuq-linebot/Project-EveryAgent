/**
 * RootPathEditor.tsx — AgentOrg 根路徑設定列
 *
 * 職責：路徑輸入、瀏覽目錄、儲存、重設（回復預設）。
 * 被 AgentTeamsView 在 header 列與 error 狀態中使用。
 */
import React, { useState, useCallback } from "react";

export interface RootPathEditorProps {
  currentPath: string;
  defaultPath: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function RootPathEditor({ currentPath, defaultPath, onSaved, onCancel }: RootPathEditorProps): React.JSX.Element {
  const [inputVal, setInputVal] = useState(currentPath);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const bridge = (window as Window & typeof globalThis & {
    tuq?: {
      agentOrg?: {
        setRoot: (p: string) => Promise<{ ok: boolean; error?: string }>;
      };
      dialog?: {
        openDirectory: () => Promise<{ ok: boolean; data?: string | null }>;
      };
    };
  }).tuq;

  const handleBrowse = useCallback(async () => {
    if (!bridge?.dialog) return;
    try {
      const r = await bridge.dialog.openDirectory();
      if (r.ok && r.data) setInputVal(r.data);
    } catch { /* ignore */ }
  }, [bridge]);

  const handleSave = useCallback(async () => {
    if (!bridge?.agentOrg) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await bridge.agentOrg.setRoot(inputVal.trim());
      if (!r.ok) {
        setSaveError(r.error ?? "儲存失敗");
      } else {
        onSaved();
      }
    } catch (e: unknown) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [bridge, inputVal, onSaved]);

  const handleReset = useCallback(async () => {
    if (!bridge?.agentOrg) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await bridge.agentOrg.setRoot("");
      if (!r.ok) {
        setSaveError(r.error ?? "重設失敗");
      } else {
        onSaved();
      }
    } catch (e: unknown) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [bridge, onSaved]);

  return (
    <div className="at-root-editor">
      <div className="at-root-editor__row">
        <input
          className="at-root-editor__input"
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          placeholder={defaultPath}
          disabled={saving}
        />
        <button
          type="button"
          className="at-root-editor__btn"
          onClick={handleBrowse}
          disabled={saving}
        >
          瀏覽…
        </button>
        <button
          type="button"
          className="at-root-editor__btn at-root-editor__btn--primary"
          onClick={handleSave}
          disabled={saving || !inputVal.trim()}
        >
          {saving ? "儲存中…" : "儲存"}
        </button>
        <button
          type="button"
          className="at-root-editor__btn"
          onClick={onCancel}
          disabled={saving}
        >
          取消
        </button>
        <button
          type="button"
          className="at-root-editor__btn at-root-editor__btn--reset"
          onClick={handleReset}
          disabled={saving}
          title="清除自訂路徑，回復預設"
        >
          回復預設
        </button>
      </div>
      {saveError && (
        <p className="at-root-editor__error">{saveError}</p>
      )}
    </div>
  );
}

export default RootPathEditor;
