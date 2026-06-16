import { app } from "electron";
import { join } from "path";
import log from "electron-log/main";

/**
 * 應用程式記錄（log）設定 —— 純本地檔案追蹤。
 *
 * 背景：打包版（雙擊 .exe）沒有終端機，所有 console.* 會直接消失，用戶回報問題時
 * 無從追溯。本模組把 main process 的全域 console 導向 electron-log 落地成檔，並捕捉
 * uncaughtException / unhandledRejection，讓崩潰也留下完整 stack。
 *
 * 落地路徑（與 index.ts 的 userData 錨定一致）：
 *   Windows: %APPDATA%\teamuq-electron\logs\main.log
 *   檔案超過 maxSize 後 electron-log 內建輪替為 main.old.log（保留前一份）。
 *
 * 設計取捨：
 * - 不彈錯誤對話框（showDialog:false）：目標用戶為非工程師，原始 stack 對話框只會嚇人；
 *   沿用既有「只記錄、不結束行程」的容錯降級哲學（見原 index.ts unhandledRejection 安全網）。
 * - 不在 renderer 端注入 electron-log：renderer 的 warning/error 已由 index.ts 的 webContents
 *   "console-message" 轉發到 main，console 被接管後自然落檔，免動 sandbox preload。
 */

// 檔案落點：釘在 userData/logs。resolvePathFn 為 lazy（首次寫入才呼叫），此時 index.ts
// 的 app.setPath("userData", …) 已執行完畢，路徑穩定不漂移。
log.transports.file.resolvePathFn = () =>
  join(app.getPath("userData"), "logs", "main.log");

// 檔案輪替：單檔上限 5MB，超過後自動切到 main.old.log（electron-log 內建，保留一份舊檔）。
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.level = "info";

// 終端輸出：dev 模式仍看得到（prod 無終端，保留也無妨）。
log.transports.console.level = "info";

// 接管 main process 全域 console：既有散落各檔的 console.* 零修改即同時落檔 + 印終端。
Object.assign(console, log.functions);

// 捕捉未處理例外與 rejection：沿用「只記錄、不結束行程」哲學，不彈對話框、不強制退出。
log.errorHandler.startCatching({ showDialog: false });

/** 取得目前 log 檔的絕對路徑（供「開啟記錄檔資料夾」等 IPC / UI 使用）。 */
export function getLogFilePath(): string {
  return log.transports.file.getFile().path;
}

export { log };
