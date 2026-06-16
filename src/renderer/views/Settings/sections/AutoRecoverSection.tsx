// ---------------------------------------------------------------------------
// ⏱ 自動恢復監測開關 — app_settings('monitor_auto_recover') = { enabled }
//   main index.ts recoverMonitoring 前讀；false → skip。改後下次啟動生效。
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from "react";
import {
  APP_SETTINGS_KEYS,
  APP_SETTINGS_DEFAULTS,
} from "../../../../shared/ipcContracts";

export function AutoRecoverSection(): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean>(
    APP_SETTINGS_DEFAULTS.monitorAutoRecover,
  );
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void window.tuq?.settings
      ?.get(APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER)
      .then((r) => {
        if (cancelled || !r.ok || !r.data) return;
        const v = (r.data as { enabled?: unknown }).enabled;
        if (typeof v === "boolean") setEnabled(v);
      })
      .catch(() => {
        /* 讀不到 → 預設 true */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = useCallback(async (next: boolean) => {
    setEnabled(next);
    setStatus(null);
    try {
      const r = await window.tuq.settings.set({
        key: APP_SETTINGS_KEYS.MONITOR_AUTO_RECOVER,
        valueJson: JSON.stringify({ enabled: next }),
      });
      setStatus(
        r.ok
          ? { text: "✓ 已儲存（下次啟動生效）", ok: true }
          : { text: `✗ 儲存失敗：${r.error}`, ok: false },
      );
    } catch (e) {
      setStatus({
        text: `✗ 儲存失敗：${e instanceof Error ? e.message : String(e)}`,
        ok: false,
      });
    }
  }, []);

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">自動恢復監測</h3>
      <div className="settings-form">
        <label
          className="settings-form__label"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--sp-2)",
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => handleToggle(e.target.checked)}
          />
          啟動時自動恢復上次監測中的任務
        </label>
        <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
          關閉後，重啟 app
          不會自動重啟先前的監測（仍可手動雙擊任務卡開啟）。變更於下次啟動生效。
        </p>
        {status && (
          <span
            style={{
              fontSize: 13,
              color: status.ok ? "var(--success)" : "var(--error)",
            }}
          >
            {status.text}
          </span>
        )}
      </div>
    </section>
  );
}
