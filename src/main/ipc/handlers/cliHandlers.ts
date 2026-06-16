import { ipcMain, IpcMainInvokeEvent } from "electron";
import {
  CLI_CHANNELS,
  CliVerifyLoginSchema,
  CliGetPlanSchema,
} from "../../../shared/ipcContracts";
import { getOnboardingState, dismissOnboarding } from "../../services/cliOnboardingService";
import { ok, err } from "./result";
import type { HandlerContext } from "./context";

export function registerCliHandlers({ backend }: HandlerContext): void {
  // --------------------------------------------------------------------------
  // CLI handlers（CLI 安裝狀態偵測與登入驗證；cli-backend-settings-20260608）
  // --------------------------------------------------------------------------

  ipcMain.handle(CLI_CHANNELS.DETECT, async () => {
    try { return ok(await backend.agentTeams.detectClis()); } catch (e) { return err(e); }
  });

  ipcMain.handle(CLI_CHANNELS.VERIFY_LOGIN, async (_e: IpcMainInvokeEvent, raw: unknown) => {
    try { const p = CliVerifyLoginSchema.parse(raw); return ok(await backend.agentTeams.verifyCliLogin(p.id)); } catch (e) { return err(e); }
  });

  ipcMain.handle(CLI_CHANNELS.GET_INSTALL_PLAN, async (_e: IpcMainInvokeEvent, raw: unknown) => {
    try { const p = CliGetPlanSchema.parse(raw); return ok(await backend.agentTeams.getCliInstallPlan(p.id)); } catch (e) { return err(e); }
  });

  ipcMain.handle(CLI_CHANNELS.GET_LOGIN_PLAN, async (_e: IpcMainInvokeEvent, raw: unknown) => {
    try { const p = CliGetPlanSchema.parse(raw); return ok(await backend.agentTeams.getCliLoginPlan(p.id)); } catch (e) { return err(e); }
  });

  ipcMain.handle(CLI_CHANNELS.LOGIN_SIGNATURE, async (_e: IpcMainInvokeEvent, raw: unknown) => {
    try { const p = CliGetPlanSchema.parse(raw); return ok(await backend.agentTeams.cliLoginSignature(p.id)); } catch (e) { return err(e); }
  });

  // 首啟 CLI 引導（方案 C）：無 payload，settings 由既有注入的 backend.settings 取得。
  ipcMain.handle(CLI_CHANNELS.GET_ONBOARDING_STATE, async () => {
    try { return ok(await getOnboardingState(backend.settings)); } catch (e) { return err(e); }
  });

  ipcMain.handle(CLI_CHANNELS.DISMISS_ONBOARDING, async () => {
    try { await dismissOnboarding(backend.settings); return ok(); } catch (e) { return err(e); }
  });
}
