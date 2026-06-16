import { z } from "zod";

// ---------------------------------------------------------------------------
// CLI 後端偵測（cli-backend-settings-20260608）
// 偵測 claude / codex / antigravity CLI 安裝與登入狀態；
// 一鍵安裝 / 登入計畫（走內嵌終端機）。
// ---------------------------------------------------------------------------

/**
 * CLI 後端偵測 channel 常數。
 * DETECT         — 偵測全部（或指定）CLI 安裝 + 登入狀態（段一 file-probe）。
 * VERIFY_LOGIN   — 段二深驗：跑 loginVerify.args 確認登入態（需 timeout，非互動）。
 * GET_INSTALL_PLAN — 取得指定 CLI 的一鍵安裝計畫（供 renderer 送進終端機）。
 * GET_LOGIN_PLAN   — 取得指定 CLI 的一鍵登入計畫（互動式，供 renderer 送進終端機）。
 * LOGIN_SIGNATURE  — 取得登入「憑證簽章」（憑證檔 mtime / keychain 存在性）；
 *                    renderer 於登入面板開著時輪詢，簽章變動即代表剛完成登入 → 自動關面板。
 *                    刻意只 fs.stat（不開子行程），避免與正在跑的互動式 login 衝突。
 * GET_ONBOARDING_STATE — 首啟 CLI 引導：是否該彈出引導 modal + 未安裝的 CLI 清單（方案 C）。
 * DISMISS_ONBOARDING   — 永久關閉首啟引導一次性提示（dismissed=true，之後不再彈）。
 */
export const CLI_CHANNELS = {
  DETECT: "cli:detect",
  VERIFY_LOGIN: "cli:verifyLogin",
  GET_INSTALL_PLAN: "cli:getInstallPlan",
  GET_LOGIN_PLAN: "cli:getLoginPlan",
  LOGIN_SIGNATURE: "cli:loginSignature",
  GET_ONBOARDING_STATE: "cli:getOnboardingState",
  DISMISS_ONBOARDING: "cli:dismissOnboarding",
} as const;

/**
 * CLI id 型別（與 cliRegistry.ts 的 CliId 字面量保持一致）。
 * 若將來 cliRegistry 可安全 import 到 shared，改為 re-export；
 * 現在兩處字面量一致、各自獨立，避免 circular 或打包邊界問題。
 */
export type CliId = "claude" | "codex" | "antigravity";

/** CLI 登入狀態。 */
export type CliLoginState = "unknown" | "logged_in" | "logged_out";

/**
 * CliStatusDto — cli:detect 回傳的單筆 CLI 狀態。
 * loginProbe 說明 loginState 的探測方式：
 *   'file'     = 段一 credential 檔存在探測。
 *   'keychain' = macOS Keychain 存在性探測（Claude 在 mac 走 Keychain，無檔）。
 *   'none'     = 無 credentialFiles 且無 Keychain（keyring 型），無法判定 → loginState='unknown'。
 *   'verified' = 段二 loginVerify 深驗通過（cli:verifyLogin 後更新）。
 */
export interface CliStatusDto {
  id: CliId;
  name: string;
  bin: string;
  installed: boolean;
  version: string | null;
  path: string | null; // 解析到的執行檔路徑（PATH 或 knownPaths）
  loginState: CliLoginState;
  loginProbe: "file" | "keychain" | "none" | "verified"; // 此 loginState 怎麼得來的
  detail?: string; // 給 UI 顯示的補充說明（如「憑證存 keyring 無法判定」）
}

/** cli:verifyLogin 回傳：深驗後的登入狀態（段二）。 */
export interface CliVerifyResult {
  id: CliId;
  loginState: CliLoginState;
  detail: string;
}

/**
 * CliPlanDto — cli:getInstallPlan / cli:getLoginPlan 回傳的終端機執行計畫。
 * interactive=true 表示指令需要使用者互動（login 通常為 true）。
 * shell='default' 表示由 main 端依 OS 選 shell（PowerShell on win, bash on mac/linux）。
 */
export interface CliPlanDto {
  id: CliId;
  command: string; // 終端機要跑的指令
  shell: "powershell" | "cmd" | "bash" | "default";
  cwd: string | null;
  interactive: boolean; // login 通常 true（需使用者互動）
  note?: string;
}

/**
 * cli:loginSignature 回傳：登入憑證簽章（供登入面板輪詢偵測「剛完成登入」）。
 *   loggedIn — 目前是否存在有效憑證（檔存在 / keychain 命中）。
 *   sig      — 憑證指紋（檔路徑+mtimeMs 串接；mac keychain 為 'kc:1'/'kc:0'）。
 *              開面板時記錄基準 sig，輪詢中 sig 改變且 loggedIn 即代表憑證剛被寫入。
 */
export interface CliLoginSignature {
  id: CliId;
  loggedIn: boolean;
  sig: string;
}

/**
 * cli:getOnboardingState 回傳：首啟 CLI 引導提示狀態（方案 C）。
 *   shouldPrompt — 是否該彈出引導 modal（旗標未 dismissed 且至少一個 CLI 未安裝）。
 *   missing      — 未安裝的 CLI id 陣列（renderer 轉成白話名顯示）。
 */
export interface CliOnboardingStateDto {
  shouldPrompt: boolean;
  missing: CliId[];
}

/** cli:verifyLogin 請求 payload 型別。 */
export interface CliVerifyLoginPayload {
  id: CliId;
}

/** cli:getInstallPlan / cli:getLoginPlan 請求 payload 型別。 */
export interface CliGetPlanPayload {
  id: CliId;
}

// -- CLI zod schemas（對齊既有 z.object 風格）--

export const CliIdSchema = z.enum(["claude", "codex", "antigravity"]);
export const CliVerifyLoginSchema = z.object({ id: CliIdSchema });
export const CliGetPlanSchema = z.object({ id: CliIdSchema });
