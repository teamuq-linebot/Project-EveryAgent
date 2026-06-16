import { ipcMain, IpcMainInvokeEvent, shell } from "electron";
import { dirname } from "path";
import { mkdirSync } from "fs";
import {
  CONFIG_CHANNELS,
  ConfigGetMilestoneSchema,
  ConfigSetMilestoneSchema,
  SETTINGS_CHANNELS,
  SettingsGetSchema,
  SettingsSetSchema,
  IpcResult,
} from "../../../shared/ipcContracts";
import { getLogFilePath } from "../../logger";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerConfigHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // Config handlers（milestone 設定讀寫）
  // --------------------------------------------------------------------------

  ipcMain.handle(
    CONFIG_CHANNELS.GET_MILESTONE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = ConfigGetMilestoneSchema.parse(raw);
        const entry = backend.projects.getMilestone(payload.milestoneId);
        return ok(entry);
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    CONFIG_CHANNELS.SET_MILESTONE,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult<unknown> => {
      try {
        const payload = ConfigSetMilestoneSchema.parse(raw);
        const entry = backend.projects.setMilestone(payload.milestoneId, {
          project_path: payload.projectPath,
          tool: payload.tool,
          custom_command: payload.customCommand ?? null,
        });
        return ok(entry);
      } catch (e) {
        return err(e);
      }
    },
  );

  // -- 通用 app_settings 讀寫 + 資料目錄（統一設定頁，§2.2 / 9）--

  ipcMain.handle(
    SETTINGS_CHANNELS.GET,
    (
      _event: IpcMainInvokeEvent,
      raw: unknown,
    ): IpcResult<Record<string, unknown> | null> => {
      try {
        const payload = SettingsGetSchema.parse(raw);
        return ok(backend.settings.getAppSetting(payload.key));
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SETTINGS_CHANNELS.SET,
    (_event: IpcMainInvokeEvent, raw: unknown): IpcResult => {
      try {
        const payload = SettingsSetSchema.parse(raw);
        // valueJson 為非機密 JSON 字串；解析成物件交 store（壞 JSON / 非物件 → reject）。
        const parsed: unknown = JSON.parse(payload.valueJson);
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          throw new Error("settings:set valueJson 必須是 JSON 物件");
        }
        backend.settings.setAppSetting(payload.key, parsed as Record<string, unknown>);
        return ok();
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SETTINGS_CHANNELS.GET_DATA_DIR,
    (_event: IpcMainInvokeEvent): IpcResult<string> => {
      try {
        return ok(backend.settings.getDataDir());
      } catch (e) {
        return err(e);
      }
    },
  );

  ipcMain.handle(
    SETTINGS_CHANNELS.OPEN_LOGS_FOLDER,
    async (_event: IpcMainInvokeEvent): Promise<IpcResult<null>> => {
      try {
        // 記錄檔資料夾 = main.log 的所在目錄（單一真相源在 logger.ts）。
        const folder = dirname(getLogFilePath());
        // 防呆：app 剛裝、尚未寫過任何 log 時資料夾可能不存在 → 先建再開（冪等）。
        mkdirSync(folder, { recursive: true });
        // shell.openPath 成功回空字串、失敗回錯誤訊息字串。
        const openErr = await shell.openPath(folder);
        if (openErr) {
          return err("開啟記錄檔資料夾失敗：" + openErr);
        }
        return ok<null>(null);
      } catch (e) {
        return err(e);
      }
    },
  );
}
