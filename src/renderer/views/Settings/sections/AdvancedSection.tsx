// ---------------------------------------------------------------------------
// 🔧 進階 — 看板刷新間隔 / 監測掃描間隔 / 資料目錄（唯讀）
//   間隔走 settings:get/set（clamp 在 UI 與讀取端雙重保護）；資料目錄走 settings:getDataDir。
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useState } from "react";
import {
  APP_SETTINGS_KEYS,
  APP_SETTINGS_DEFAULTS,
} from "../../../../shared/ipcContracts";

function clampSeconds(
  raw: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function AdvancedSection(): React.JSX.Element {
  const [kanbanSec, setKanbanSec] = useState<string>(
    String(APP_SETTINGS_DEFAULTS.kanbanPollSeconds),
  );
  const [monitorSec, setMonitorSec] = useState<string>(
    String(APP_SETTINGS_DEFAULTS.monitorPollSeconds),
  );
  const [dataDir, setDataDir] = useState<string>("");
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(
    null,
  );
  const [logMsg, setLogMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const s = window.tuq?.settings;
    if (!s) return;
    void s
      .get(APP_SETTINGS_KEYS.KANBAN_POLL_SECONDS)
      .then((r) => {
        if (cancelled || !r.ok || !r.data) return;
        const v = (r.data as { seconds?: unknown }).seconds;
        if (typeof v === "number") setKanbanSec(String(v));
      })
      .catch(() => {});
    void s
      .get(APP_SETTINGS_KEYS.MONITOR_POLL_SECONDS)
      .then((r) => {
        if (cancelled || !r.ok || !r.data) return;
        const v = (r.data as { seconds?: unknown }).seconds;
        if (typeof v === "number") setMonitorSec(String(v));
      })
      .catch(() => {});
    void s
      .getDataDir()
      .then((r) => {
        if (cancelled || !r.ok) return;
        setDataDir(r.data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = useCallback(async () => {
    const kanban = clampSeconds(
      kanbanSec,
      APP_SETTINGS_DEFAULTS.kanbanPollSecondsMin,
      APP_SETTINGS_DEFAULTS.kanbanPollSecondsMax,
      APP_SETTINGS_DEFAULTS.kanbanPollSeconds,
    );
    const monitor = clampSeconds(
      monitorSec,
      APP_SETTINGS_DEFAULTS.monitorPollSecondsMin,
      APP_SETTINGS_DEFAULTS.monitorPollSecondsMax,
      APP_SETTINGS_DEFAULTS.monitorPollSeconds,
    );
    // 把 clamp 後的值寫回欄位（讓使用者看到實際生效值）。
    setKanbanSec(String(kanban));
    setMonitorSec(String(monitor));
    try {
      const r1 = await window.tuq.settings.set({
        key: APP_SETTINGS_KEYS.KANBAN_POLL_SECONDS,
        valueJson: JSON.stringify({ seconds: kanban }),
      });
      const r2 = await window.tuq.settings.set({
        key: APP_SETTINGS_KEYS.MONITOR_POLL_SECONDS,
        valueJson: JSON.stringify({ seconds: monitor }),
      });
      if (r1.ok && r2.ok) {
        setStatus({
          text: "✓ 已儲存（監測掃描間隔下次開始監測生效）",
          ok: true,
        });
      } else {
        setStatus({
          text: `✗ 儲存失敗：${!r1.ok ? r1.error : !r2.ok ? r2.error : ""}`,
          ok: false,
        });
      }
    } catch (e) {
      setStatus({
        text: `✗ 儲存失敗：${e instanceof Error ? e.message : String(e)}`,
        ok: false,
      });
    }
  }, [kanbanSec, monitorSec]);

  const handleOpenLogs = useCallback(async () => {
    setLogMsg(null);
    try {
      const r = await window.tuq.settings.openLogsFolder();
      if (!r.ok) setLogMsg(`✗ 開啟失敗：${r.error}`);
    } catch (e) {
      setLogMsg(`✗ 開啟失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">進階</h3>
      <div className="settings-form">
        <label className="settings-form__label">
          看板刷新間隔（秒，{APP_SETTINGS_DEFAULTS.kanbanPollSecondsMin}~
          {APP_SETTINGS_DEFAULTS.kanbanPollSecondsMax}）：
          <input
            className="settings-form__input"
            type="number"
            min={APP_SETTINGS_DEFAULTS.kanbanPollSecondsMin}
            max={APP_SETTINGS_DEFAULTS.kanbanPollSecondsMax}
            value={kanbanSec}
            onChange={(e) => {
              setKanbanSec(e.target.value);
              setStatus(null);
            }}
            style={{ width: 120 }}
          />
        </label>

        <label className="settings-form__label">
          監測掃描間隔（秒，{APP_SETTINGS_DEFAULTS.monitorPollSecondsMin}~
          {APP_SETTINGS_DEFAULTS.monitorPollSecondsMax}）：
          <input
            className="settings-form__input"
            type="number"
            min={APP_SETTINGS_DEFAULTS.monitorPollSecondsMin}
            max={APP_SETTINGS_DEFAULTS.monitorPollSecondsMax}
            value={monitorSec}
            onChange={(e) => {
              setMonitorSec(e.target.value);
              setStatus(null);
            }}
            style={{ width: 120 }}
          />
        </label>

        <label className="settings-form__label">
          資料目錄（唯讀）：
          <input
            className="settings-form__input"
            value={dataDir}
            readOnly
            placeholder="（解析中…）"
            style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}
          />
        </label>

        <div className="settings-form__label" style={{ display: "block" }}>
          <div style={{ marginBottom: "var(--sp-2)" }}>程式執行紀錄：</div>
          <div
            style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: "var(--sp-2)" }}
          >
            程式運作過程會自動記錄在電腦裡。如果遇到問題，可以開啟這個資料夾，把裡面的{" "}
            <code>main.log</code> 檔提供給我們，協助找出原因。
          </div>
          <div
            style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}
          >
            <button className="settings-form__btn" onClick={handleOpenLogs}>
              開啟記錄檔資料夾
            </button>
            {logMsg && (
              <span style={{ fontSize: 13, color: "var(--error)" }}>{logMsg}</span>
            )}
          </div>
        </div>

        <div
          style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}
        >
          <button
            className="settings-form__btn settings-form__btn--primary"
            onClick={handleSave}
          >
            儲存
          </button>
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
      </div>
    </section>
  );
}
