import { ipcRenderer } from "electron";
import {
  SETTINGS_CHANNELS,
  SettingsSetPayload,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.settings — 通用 app_settings 讀寫 + 資料目錄（統一設定頁進階組）
// ---------------------------------------------------------------------------

export const settings = {
  /** 讀一筆 app_settings（缺鍵 → null）。 */
  get(key: string): Promise<IpcResult<Record<string, unknown> | null>> {
    return ipcRenderer.invoke(SETTINGS_CHANNELS.GET, { key });
  },
  /** 寫一筆 app_settings（upsert）。 */
  set(payload: SettingsSetPayload): Promise<IpcResult> {
    return ipcRenderer.invoke(SETTINGS_CHANNELS.SET, payload);
  },
  /** 資料目錄（~/.teamuq）絕對路徑，唯讀。 */
  getDataDir(): Promise<IpcResult<string>> {
    return ipcRenderer.invoke(SETTINGS_CHANNELS.GET_DATA_DIR);
  },
  /** 用檔案總管開啟記錄檔（main.log）所在資料夾（除錯用）。 */
  openLogsFolder(): Promise<IpcResult<null>> {
    return ipcRenderer.invoke(SETTINGS_CHANNELS.OPEN_LOGS_FOLDER);
  },
};
