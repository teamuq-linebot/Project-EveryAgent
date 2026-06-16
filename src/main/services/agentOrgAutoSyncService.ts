/**
 * agentOrgAutoSyncService.ts — 內建 AgentOrg team 自動同步服務
 *
 * 匯出 reconcileBuiltinAgentSync(agentTeams)，對內建 team `agent-ops` 執行
 * 三平台（claude/codex/antigravity）skill 同步。
 *
 * 設計約束：
 *   - 頂層 import only（禁 lazy require / await import；esbuild 不打包動態 require）
 *   - 永不 throw（任何路徑都回傳 BuiltinAgentSyncResult）
 *   - 不碰 fs（冪等性由 syncTeam 內部 junction/marker 機制保證）
 */

import type { AgentTeamsService } from "../backend/services/agentTeamsService";
import { initProgressService } from "./initProgressService";

export interface BuiltinAgentSyncResult {
  status: "synced" | "skipped";
  reason: string;
}

const BUILTIN_TEAM_ID = "agent-ops";
const BUILTIN_PLATFORMS = ["claude", "codex", "antigravity"] as const;

/**
 * 對內建 team `agent-ops` 執行三平台 skill 同步。
 *
 * 呼叫時機：startupMigrations 首啟 seed 完成後（接線由另一批負責）。
 *
 * 回傳語意：
 *   - status='synced'  — syncTeam 成功找到入口 skill 並執行同步（各平台冪等）
 *   - status='skipped' — agentOrgRoot 下找不到 agent-ops 入口 skill（skillName === null）
 *
 * 永不 throw；任何執行期錯誤都捕捉並回傳 skipped + reason。
 */
export async function reconcileBuiltinAgentSync(
  agentTeams: AgentTeamsService,
): Promise<BuiltinAgentSyncResult> {
  try {
    initProgressService.report("link-start", "正在把 AI 團隊接到你的助手…");

    const result = await agentTeams.syncTeam({
      teamId: BUILTIN_TEAM_ID,
      platforms: [...BUILTIN_PLATFORMS],
    });

    if (result.skillName === null) {
      return {
        status: "skipped",
        reason: "當前 agentOrgRoot 下找不到 agent-ops 入口 skill，略過自動同步",
      };
    }

    const claudeState = result.claude?.state ?? "（未執行）";
    const codexState = result.codex?.state ?? "（未執行）";
    const agyState = result.agy?.state ?? "（未執行）";

    initProgressService.report("link-done", "AI 團隊已就緒", "done");

    return {
      status: "synced",
      reason: `tuq-agent(${result.skillName}) → claude=${claudeState} codex=${codexState} agy=${agyState}`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      status: "skipped",
      reason: `執行期錯誤：${message}`,
    };
  }
}
