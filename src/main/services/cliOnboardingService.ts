/**
 * cliOnboardingService.ts — 首啟「引導式」CLI onboarding 狀態（方案 C）。
 *
 * 純讀寫 app_settings + 委派 cliBackendService.detectAll，不做任何安裝動作
 * （安裝沿用設定頁既有可見終端機流程）。比照 cliBackendService 純函式風格、全面容錯。
 *
 * ⚠️ 禁 lazy require / 動態 import：所有 import 一律頂層（esbuild 不打包動態 require）。
 */

import { APP_SETTINGS_KEYS, APP_SETTINGS_DEFAULTS } from "../../shared/ipcContracts";
import type { CliId, CliOnboardingStateDto } from "../../shared/ipcContracts";
import type { AppSettingsService } from "../backend/services/appSettingsService";
import { detectAll } from "./cliBackendService";

/**
 * 取得引導提示狀態：
 *   - 旗標 dismissed===true → { shouldPrompt:false, missing:[] }（一次性提示已關閉）。
 *   - 否則 detectAll → missing = installed===false 的 id；shouldPrompt = missing.length > 0。
 * 任何例外 → 安全預設 { shouldPrompt:false, missing:[] }（不打擾使用者）。
 */
export async function getOnboardingState(
  settings: AppSettingsService,
): Promise<CliOnboardingStateDto> {
  try {
    const flag = settings.getAppSetting(APP_SETTINGS_KEYS.CLI_ONBOARDING);
    const dismissed =
      (flag?.["dismissed"] as boolean | undefined) ??
      APP_SETTINGS_DEFAULTS.cliOnboarding.dismissed;
    if (dismissed === true) return { shouldPrompt: false, missing: [] };

    const statuses = await detectAll();
    const missing: CliId[] = statuses
      .filter((s) => s.installed === false)
      .map((s) => s.id);
    return { shouldPrompt: missing.length > 0, missing };
  } catch {
    return { shouldPrompt: false, missing: [] };
  }
}

/** 永久關閉一次性引導提示：把 'cli_onboarding' 設為 { dismissed:true }（upsert；失敗只記不拋）。 */
export async function dismissOnboarding(settings: AppSettingsService): Promise<void> {
  try {
    settings.setAppSetting(APP_SETTINGS_KEYS.CLI_ONBOARDING, { dismissed: true });
  } catch {
    /* setAppSetting 內部已容錯，這層僅防型別外例外 */
  }
}
