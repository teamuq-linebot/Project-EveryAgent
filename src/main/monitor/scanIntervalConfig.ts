/**
 * scanIntervalConfig.ts — 掃描間隔解析（自 MonitorController.ts 抽出）
 */

import { AppSettingsStore } from '../repo/appSettingsStore';
import { APP_SETTINGS_KEYS, APP_SETTINGS_DEFAULTS } from '../../shared/ipcContracts';

/** 掃描間隔（ms）預設。對應 Python MONITOR_POLL_MS = 2000；可由設定頁「進階 → 監測掃描間隔」覆寫。 */
export const MONITOR_POLL_MS = APP_SETTINGS_DEFAULTS.monitorPollSeconds * 1000;

/**
 * 解析掃描間隔（ms）：讀 app_settings('monitor_poll_seconds').seconds，clamp 1~30s，
 * 缺鍵 / 壞值 / store 不可用 → 預設 2s。每次 startMonitor（armTimer）讀一次（改了下次 start 生效）。
 */
export function resolveScanIntervalMs(): number {
  try {
    const store = new AppSettingsStore();
    try {
      const raw = store.getJson(APP_SETTINGS_KEYS.MONITOR_POLL_SECONDS)?.['seconds'];
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) return MONITOR_POLL_MS;
      const clamped = Math.min(
        APP_SETTINGS_DEFAULTS.monitorPollSecondsMax,
        Math.max(APP_SETTINGS_DEFAULTS.monitorPollSecondsMin, Math.round(n)),
      );
      return clamped * 1000;
    } finally {
      store.close();
    }
  } catch {
    return MONITOR_POLL_MS;
  }
}
