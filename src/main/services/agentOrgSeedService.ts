/**
 * services/agentOrgSeedService.ts — 每次啟動冪等 AgentOrg 範本 seed
 *
 * 邏輯：
 *   STEP 1（無條件，最先跑）：實際檢查 ~/.teamuq/AgentOrg 是否含完整 agent-ops
 *     （4 個 anchor），缺了/不完整就從內建範本補（force:false 只補缺檔，不覆蓋）。
 *     此步不受下方 gate a/b 影響。
 *   STEP 3（保留舊 gate a/b，僅決定「是否改寫整包 agentOrgRootPath 旗標」）：
 *     (a) app_settings 已有 agentOrgRootPath → 不改寫旗標
 *     (b) AGENT_ORG_ROOT_DEFAULT 路徑可存取（公司環境）→ 不改寫旗標
 *     (c) 否則把 agentOrgRootPath 設為 .teamuq 的 destAgents
 *
 * 全程不 throw（內部 try/catch），回傳 { status, reason }。
 */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { app } from "electron";
import { AgentTeamsService } from "../backend/services/agentTeamsService";
import type { AppSettingsService } from "../backend/services/appSettingsService";
import { initProgressService } from "./initProgressService";

/** 回傳結果型別 */
export interface AgentOrgSeedResult {
  status: "seeded" | "skipped";
  reason: string;
}

/** app_settings key（與 AgentTeamsService 使用相同的 key） */
const SETTINGS_KEY_AGENT_ORG_ROOT = "agentOrgRootPath";

/**
 * 取內建範本來源目錄：
 *   - 已打包（isPackaged）→ process.resourcesPath/agent-templates
 *   - 開發模式 → <appPath>/resources/agent-templates
 */
function resolveTemplateSource(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "agent-templates");
  }
  return path.join(app.getAppPath(), "resources", "agent-templates");
}

/**
 * 同步檢查路徑是否可存取（fs.accessSync，避免 async 在此行程初期 timing 問題）。
 */
function isAccessible(dirPath: string): boolean {
  try {
    fs.accessSync(dirPath, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * homeDir 推導（單一真相）：TEAMUQ_HOME env 覆寫優先，否則 os.homedir()。
 * 確保 E2E 隔離（TEAMUQ_HOME 覆寫）下所有路徑都指向隔離目錄。
 */
function resolveHomeDir(): string {
  return process.env["TEAMUQ_HOME"] || os.homedir();
}

/**
 * 內建落地的 .teamuq AgentOrg 根目錄（destRoot，= ~/.teamuq/AgentOrg）。
 */
function builtinAgentOpsDestRoot(): string {
  return path.join(resolveHomeDir(), ".teamuq", "AgentOrg");
}

/**
 * 內建落地的 .teamuq AgentOrg agents 根路徑（= ~/.teamuq/AgentOrg/agents）。
 * 供後續流程（D2）共用，避免兩處字面推導漂移。
 */
export function builtinAgentOpsAgentsRoot(): string {
  return path.join(builtinAgentOpsDestRoot(), "agents");
}

/**
 * 純函式：檢查 destRoot（= ~/.teamuq/AgentOrg）下 agent-ops 是否完整。
 * 檢查 4 個 anchor，全部存在才回 true。
 */
function isAgentOpsComplete(destRoot: string): boolean {
  const anchors = [
    path.join(destRoot, "agents", "agent-ops", "manager", "agent.yaml"),
    path.join(destRoot, ".claude", "skills", "tuq-agent", "SKILL.md"),
    path.join(destRoot, "agents", "protocols", "definitions.md"),
    path.join(destRoot, "agents", "agent-ops", "manager", "workflow.yaml"),
  ];
  return anchors.every((anchor) => fs.existsSync(anchor));
}

/**
 * 首啟冪等 AgentOrg 範本 seed。
 *
 * @param appSettings  AppSettingsService 實例（已就緒，與 Backend 同一個）
 * @returns            { status: 'seeded' | 'skipped', reason }
 */
export async function reconcileAgentOrgSeed(
  appSettings: AppSettingsService,
): Promise<AgentOrgSeedResult> {
  try {
    initProgressService.report("prepare-teams", "正在準備你的 AI 團隊…");

    const destRoot = builtinAgentOpsDestRoot();
    const destAgents = builtinAgentOpsAgentsRoot();

    // ─── STEP 1（無條件，最先跑）─────────────────────────────────
    // 每次啟動實際檢查 .teamuq agent-ops 是否完整；缺了/不完整就從內建範本補。
    // 此步不受下方 gate a/b 影響（即使 T: 可達、即使旗標已設）。
    if (!isAgentOpsComplete(destRoot)) {
      const templateSrc = resolveTemplateSource();

      // 確認範本來源存在
      if (!isAccessible(templateSrc)) {
        return {
          status: "skipped",
          reason: `內建範本來源不存在（${templateSrc}），略過 seed`,
        };
      }

      // 建立目標目錄（若不存在）
      await fsp.mkdir(destRoot, { recursive: true });

      initProgressService.report(
        "install-teams",
        "初次啟動，正在安裝內建 AI 團隊，可能需要一點時間…",
      );

      // 複製範本（force:false = 已存在的在地檔不覆蓋，只補缺檔；
      // 範本版本升級不在 scope）
      await fsp.cp(templateSrc, destRoot, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });

      // 複製後再驗一次；仍不完整則不往下接來源
      if (!isAgentOpsComplete(destRoot)) {
        return {
          status: "skipped",
          reason: `內建範本已複製至 ${destRoot}，但複製後 agent-ops 仍不完整`,
        };
      }
    }

    // ─── STEP 3（保留舊 gate a/b，僅決定是否改寫整包 agentOrgRootPath 旗標）─
    // (a) app_settings 已有 agentOrgRootPath → 不改寫旗標
    const existing = appSettings.getAppSetting(SETTINGS_KEY_AGENT_ORG_ROOT);
    const existingPath =
      typeof existing?.["path"] === "string" ? existing["path"].trim() : "";
    if (existingPath) {
      return {
        status: "skipped",
        reason: `agent-ops 已落地；保留既有 agentOrgRootPath="${existingPath}"`,
      };
    }

    // (b) 公司版預設路徑可存取 → 不改寫旗標（整包根維持預設）
    const defaultPath = AgentTeamsService.AGENT_ORG_ROOT_DEFAULT;
    if (isAccessible(defaultPath)) {
      return {
        status: "skipped",
        reason: `agent-ops 已落地；公司 T: 可達（${defaultPath}），整包根維持預設`,
      };
    }

    // (c) 否則把 agentOrgRootPath 設為 .teamuq 的 destAgents
    appSettings.setAppSetting(SETTINGS_KEY_AGENT_ORG_ROOT, {
      path: destAgents,
    });

    return {
      status: "seeded",
      reason: `整包範本落地，agentOrgRootPath 設為 ${destAgents}`,
    };
  } catch (err) {
    // 全程不 throw，記錄後回傳 skipped
    console.error("[agent-org-seed] reconcileAgentOrgSeed 失敗（非阻斷）:", err);
    return {
      status: "skipped",
      reason: `執行期錯誤：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
