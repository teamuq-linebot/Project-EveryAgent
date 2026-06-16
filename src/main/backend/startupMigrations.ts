/**
 * backend/startupMigrations.ts — 啟動期遷移 / 回填序列
 * （backend.ts 拆分；行為保留 move-only，constructor 末尾 try/catch 搬入）
 */

import { reconcileAgentOrgSeed } from "../services/agentOrgSeedService";
import { reconcileBuiltinAgentSync } from "../services/agentOrgAutoSyncService";
import { initProgressService } from "../services/initProgressService";
import type { SqliteTaskRepository } from "../repo/sqliteTaskRepository";
import type { AppSettingsService } from "./services/appSettingsService";
import type { AgentTeamsService } from "./services/agentTeamsService";

/**
 * 啟動期遷移 / 回填序列（全部 try/catch 容錯降級）。
 * @param repo          主 repository（SqliteTaskRepository 實例）
 * @param appSettings   app_settings delegate service（AgentOrg seed 用）
 * @param agentTeams    AgentTeams delegate service（builtin agent sync 用）
 */
export function runStartupMigrations(
  _repo: SqliteTaskRepository,
  appSettings: AppSettingsService,
  agentTeams: AgentTeamsService,
): void {
  // boot splash 進度回報：進入啟動遷移序列 → 白話「整理資料」（給非工程師看的 boot splash）。
  initProgressService.report("prepare-data", "正在整理你的資料…");

  // A4 內建預設 AgentOrg 範本首啟 seed：
  //   新裝機 / 非公司環境下自動複製內建範本到 ~/.teamuq/AgentOrg/。
  //   冪等（force:false，已存在的設定或路徑直接 skip）。非同步執行、fire-and-forget。
  reconcileAgentOrgSeed(appSettings)
    .then((r) => {
      console.log(`[agent-org-seed] reconcile ${r.status}: ${r.reason}`);
      return reconcileBuiltinAgentSync(agentTeams);
    })
    .then((s) => {
      console.log(`[agent-builtin-sync] ${s.status}: ${s.reason}`);
    })
    .catch((err) => {
      console.error("[agent-org-seed/sync] reconcile failed (non-fatal):", err);
    })
    // boot splash 進度回報：seed + sync 鏈不論成功/skip/拋錯都走到此，標記「全部完成」。
    .finally(() => initProgressService.markDone("一切就緒"));
}
