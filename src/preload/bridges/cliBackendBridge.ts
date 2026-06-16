import { ipcRenderer } from "electron";
import {
  CLI_CHANNELS,
  CliId,
  CliStatusDto,
  CliVerifyResult,
  CliPlanDto,
  CliLoginSignature,
  CliOnboardingStateDto,
  IpcResult,
} from "../../shared/ipcContracts";

// ---------------------------------------------------------------------------
// tuq.cliBackend — CLI 工具偵測 / 登入驗證 / 安裝計畫（cli-backend-settings）
// ---------------------------------------------------------------------------

export const cliBackend = {
  detect(): Promise<IpcResult<CliStatusDto[]>> {
    return ipcRenderer.invoke(CLI_CHANNELS.DETECT, {});
  },
  verifyLogin(id: CliId): Promise<IpcResult<CliVerifyResult>> {
    return ipcRenderer.invoke(CLI_CHANNELS.VERIFY_LOGIN, { id });
  },
  getInstallPlan(id: CliId): Promise<IpcResult<CliPlanDto>> {
    return ipcRenderer.invoke(CLI_CHANNELS.GET_INSTALL_PLAN, { id });
  },
  getLoginPlan(id: CliId): Promise<IpcResult<CliPlanDto>> {
    return ipcRenderer.invoke(CLI_CHANNELS.GET_LOGIN_PLAN, { id });
  },
  loginSignature(id: CliId): Promise<IpcResult<CliLoginSignature>> {
    return ipcRenderer.invoke(CLI_CHANNELS.LOGIN_SIGNATURE, { id });
  },
  getOnboardingState(): Promise<IpcResult<CliOnboardingStateDto>> {
    return ipcRenderer.invoke(CLI_CHANNELS.GET_ONBOARDING_STATE, {});
  },
  dismissOnboarding(): Promise<IpcResult<void>> {
    return ipcRenderer.invoke(CLI_CHANNELS.DISMISS_ONBOARDING, {});
  },
};
