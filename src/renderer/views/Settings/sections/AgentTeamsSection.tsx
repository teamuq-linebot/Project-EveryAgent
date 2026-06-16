/**
 * AgentTeamsSection.tsx — 設定頁「AI 團隊」組 → 資料來源路徑設定
 *
 * 職責：
 *   - 載入目前的 AgentOrg 根路徑（agentOrg.getRoot）。
 *   - 內嵌 RootPathEditor，讓用戶瀏覽/修改/回復預設。
 *   - 儲存或取消後重新讀取最新路徑。
 * 不複製 RootPathEditor 邏輯，只負責取得/傳入狀態。
 */
import React, { useCallback, useEffect, useState } from "react";
import type { AgentOrgRootInfo } from "../../../../shared/ipcContracts";
import { RootPathEditor } from "../../../views/AgentTeams/RootPathEditor";

export function AgentTeamsSection(): React.JSX.Element {
  const [rootInfo, setRootInfo] = useState<AgentOrgRootInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadRoot = useCallback(async () => {
    try {
      const r = await window.tuq.agentOrg.getRoot();
      if (r.ok && r.data) {
        setRootInfo(r.data);
        setLoadError(null);
      } else {
        setLoadError("無法讀取資料夾設定");
      }
    } catch {
      setLoadError("無法讀取資料夾設定");
    }
  }, []);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  const handleSaved = useCallback(() => {
    loadRoot();
  }, [loadRoot]);

  const handleCancel = useCallback(() => {
    /* 設定頁版本不需關閉，取消後重新讀取最新值即可 */
    loadRoot();
  }, [loadRoot]);

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">AI 團隊資料來源</h3>
      <p
        style={{
          fontSize: 12,
          color: "var(--text-muted)",
          margin: "0 0 var(--sp-2)",
        }}
      >
        AI 團隊的成員資料存放在這個資料夾。
      </p>
      {loadError ? (
        <p style={{ fontSize: 12, color: "var(--error)" }}>{loadError}</p>
      ) : rootInfo ? (
        <RootPathEditor
          currentPath={rootInfo.path}
          defaultPath={rootInfo.defaultPath}
          onSaved={handleSaved}
          onCancel={handleCancel}
        />
      ) : (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>載入中…</p>
      )}
    </section>
  );
}
