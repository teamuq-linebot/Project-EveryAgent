/**
 * backend/services/appSettingsService.ts — 通用 app_settings 讀寫 delegate service
 * （backend.ts 拆分計畫 Batch 4；行為保留 move-only）。
 *
 * 自 backend.ts 機械搬入：
 *   - lazy store（原 `_appSettingsStore` 欄位 + `_getAppSettingsStore()`）→ `getStore()`
 *   - `getAppSetting` / `setAppSetting` / `getDataDir`
 *
 * Backend 對應 public 方法改 thin delegation（facade 簽名不變）；本類以外的域
 * （active_connection 讀寫、AgentOrg root 等）一律經 BackendContext.getAppSettingsStore()
 * 取**同一** lazy 單例（R4：不可重複建）。
 */

import * as path from "node:path";
import { AppSettingsStore } from "../../repo/appSettingsStore";
import { teamuqDbPath } from "../../repo/sqliteTaskRepository";

export class AppSettingsService {
  /**
   * app_settings store（多帳戶方案 B / active_connection 持久化）。lazy 建（容錯：失敗 → null →
   * active_connection 讀寫降級 no-op）。與 LLM settings store 分實例但共用同一 teamuq.db。
   */
  private _store: AppSettingsStore | null = null;

  /**
   * 取（lazy 建）app_settings store（active_connection 持久化）。建失敗 → null（降級 no-op）。
   */
  getStore(): AppSettingsStore | null {
    if (!this._store) {
      try {
        this._store = new AppSettingsStore();
      } catch (err) {
        console.error(
          "[active-connection] AppSettingsStore init failed (non-fatal):",
          err,
        );
        this._store = null;
      }
    }
    return this._store;
  }

  /** 取一筆 app_settings（缺鍵 / store 不可用 → null）。 */
  getAppSetting(key: string): Record<string, unknown> | null {
    const store = this.getStore();
    if (!store) return null;
    try {
      return store.getJson(key);
    } catch {
      return null;
    }
  }

  /** 寫一筆 app_settings（upsert；store 不可用 → no-op）。 */
  setAppSetting(key: string, value: Record<string, unknown>): void {
    const store = this.getStore();
    if (!store) return;
    try {
      store.setJson(key, value);
    } catch (err) {
      console.error("[settings] setAppSetting failed (non-fatal):", err);
    }
  }

  /** 解析後的資料目錄（~/.teamuq）絕對路徑，唯讀（設定頁「進階」顯示用）。 */
  getDataDir(): string {
    return path.dirname(teamuqDbPath());
  }
}
