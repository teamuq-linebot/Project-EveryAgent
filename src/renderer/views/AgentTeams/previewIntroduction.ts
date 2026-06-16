/**
 * previewIntroduction.ts — 由建隊 spec 即時渲染「成員 instruction」（＝ introduction.json
 * 內容）的 renderer 純函式 leaf，供即時預覽卡的唯讀抽屜使用（不寫檔、無 fs、無副作用）。
 *
 * ⚠️ 與 main 端 `agentTeamCreateService.ts` 的 `renderIntroduction` /
 *    `normalizeManager` / `normalizeMember` / `roleLabel` 為**同源邏輯的平移版**
 *    （仿 createSpecHelpers 範式，可接受兩份來源）。改一邊的轉換規則時，另一邊須同步，
 *    否則「預覽」與「實際建立後的 introduction.json」會不一致。
 *
 * 介面：
 *   - previewManagerIntroduction(spec)         → manager 的 AgentIntroduction
 *   - previewMemberIntroduction(spec, index)   → 第 index 位成員的 AgentIntroduction
 *   - previewIntroductionFor(spec, who)        → who="manager" | { memberIndex } 的統一入口
 *
 * agent-teams-live-preview-card-20260613（批 1）。
 */
import type {
  AgentIntroduction,
  AgentTeamCreateSpecInput,
} from "../../../shared/ipcContracts";

/** spec.members[i] 的型別（input 形狀，欄位多為 optional）。 */
type SpecMember = NonNullable<AgentTeamCreateSpecInput["members"]>[number];
/** spec.manager 的型別（input 形狀，欄位多為 optional）。 */
type SpecManager = NonNullable<AgentTeamCreateSpecInput["manager"]>;

/** 規格化後的中間表示，對齊 main 端 NormalizedAgent 的預覽必要欄位。 */
interface PreviewAgent {
  name: string;
  displayName: string;
  type: "manager" | "worker";
  roleInTeam?: "researcher" | "doer" | "verifier" | "shared";
  summary: string;
  responsibilities: string[];
}

/**
 * who="manager" 取 manager；who={ memberIndex } 取對應成員。
 * 成員索引越界時回退成 manager（介面容錯，預覽不丟例外）。
 */
export function previewIntroductionFor(
  spec: AgentTeamCreateSpecInput,
  who: "manager" | { memberIndex: number },
): AgentIntroduction {
  if (who === "manager") return previewManagerIntroduction(spec);
  return previewMemberIntroduction(spec, who.memberIndex);
}

/** manager → AgentIntroduction（即時預覽用，不寫檔）。 */
export function previewManagerIntroduction(spec: AgentTeamCreateSpecInput): AgentIntroduction {
  return renderIntroduction(spec.teamId, normalizeManager(spec));
}

/**
 * 第 memberIndex 位成員 → AgentIntroduction（即時預覽用，不寫檔）。
 * 索引越界或無成員時回退成 manager 介紹（避免預覽崩潰）。
 */
export function previewMemberIntroduction(
  spec: AgentTeamCreateSpecInput,
  memberIndex: number,
): AgentIntroduction {
  const members = spec.members ?? [];
  const member = members[memberIndex];
  if (!member) return previewManagerIntroduction(spec);
  return renderIntroduction(spec.teamId, normalizeMember(spec, member));
}

// ---------------------------------------------------------------------------
// 以下為 agentTeamCreateService.ts 純轉換邏輯的平移（同源，改一邊需同步）
// ---------------------------------------------------------------------------

/** 平移自 agentTeamCreateService.normalizeManager（：92-106）。 */
function normalizeManager(spec: AgentTeamCreateSpecInput): PreviewAgent {
  const teamName = (spec.teamName ?? "").trim();
  const manager: SpecManager = spec.manager ?? {};
  return {
    name: "manager",
    displayName: manager.displayName?.trim() || `${teamName}組長`,
    type: "manager",
    summary: manager.summary?.trim() || `管理 ${teamName} 團隊的需求釐清、派工、驗收與交付。`,
    responsibilities:
      manager.responsibilities && manager.responsibilities.length > 0
        ? manager.responsibilities
        : ["釐清使用者需求", "拆分工作並派工", "彙整結果並交付"],
  };
}

/** 平移自 agentTeamCreateService.normalizeMember（：108-125）。 */
function normalizeMember(spec: AgentTeamCreateSpecInput, member: SpecMember): PreviewAgent {
  const teamName = (spec.teamName ?? "").trim();
  const name = (member.name ?? "").trim();
  return {
    name,
    displayName: member.displayName?.trim() || member.title?.trim() || name,
    type: "worker",
    roleInTeam: member.roleInTeam,
    summary: member.summary?.trim() || `${teamName} 的 ${name} 專員。`,
    responsibilities:
      member.responsibilities && member.responsibilities.length > 0
        ? member.responsibilities
        : ["依 manager brief 執行指定工作", "回報產出與風險"],
  };
}

/** 平移自 agentTeamCreateService.renderIntroduction（：272-302），輸出 AgentIntroduction。 */
function renderIntroduction(teamId: string, agent: PreviewAgent): AgentIntroduction {
  const managerWorkflows = [
    { scenario: "使用者提出新需求", steps: ["確認目標與交付物", "拆分任務", "交付彙整結果"] },
    { scenario: "需求資訊不足", steps: ["指出缺口", "提出澄清問題", "等待補充後再執行"] },
    { scenario: "需要多人協作", steps: ["選擇合適成員", "派工", "驗收並整合"] },
  ];
  const workerWorkflows = [
    { scenario: "收到 manager brief", steps: ["理解任務", "執行工作", "回報結果"] },
    { scenario: "發現風險或缺口", steps: ["標記風險", "提出處理建議", "等待 manager 決策"] },
  ];

  return {
    id: `${teamId}/${agent.name}`,
    display_name: agent.displayName,
    team: teamId,
    role: agent.type === "manager" ? "組長" : roleLabel(agent.roleInTeam),
    summary: agent.summary,
    capabilities: agent.responsibilities,
    when_to_use: agent.summary,
    not_for: "不屬於本團隊職責的任務。",
    reports_to: agent.type === "manager" ? "使用者" : "組長",
    manages: agent.type === "manager" ? ["同團隊成員"] : [],
    callable_by: agent.type === "manager" ? ["使用者", "快組隊-AI團隊平台"] : ["同團隊組長"],
    inputs: "任務目標、限制條件、預期交付物。",
    outputs: "完成結果、風險、下一步建議。",
    workflows: agent.type === "manager" ? managerWorkflows : workerWorkflows,
    examples: [`請${agent.displayName}處理這個任務。`],
    flags: ["teamuq_agent_team_ui"],
    last_updated: new Date().toISOString().slice(0, 10),
  };
}

/** 平移自 agentTeamCreateService.roleLabel（：416-421）。 */
function roleLabel(role?: string): string {
  if (role === "researcher") return "研究員";
  if (role === "verifier") return "審查者";
  if (role === "shared") return "共享支援";
  return "執行者";
}
