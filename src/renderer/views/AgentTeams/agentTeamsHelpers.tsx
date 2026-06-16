/**
 * agentTeamsHelpers.tsx — AgentTeams 共用純函式與小元件
 *
 * 職責：roleIcon / modelLabel / typeBadge* 對應函式，以及 AgentOpsActions 小元件。
 * 這些 helpers 由 AgentDetailDrawer 使用，獨立成檔以避免主元件臃腫。
 */
import React from "react";
import type { TeamSource } from "../../../shared/ipcContracts";
import { parseTeamKey } from "../../../shared/ipcContracts";
import type { CliId } from "../../../shared/cliRegistry";

// ---------------------------------------------------------------------------
// 平台群組（團隊「能在哪些 AI 工具用」的顯示單位）
// ---------------------------------------------------------------------------
//
// codex 與 antigravity(Gemini) 共用 ~/.agents/skills，可見性本來就綁定，
// 故合併成單一「Codex / Gemini」群組：一個開關同時加入/拿掉兩者。
// claude 走 ~/.claude/skills junction，獨立一組。
// 真相仍是 team.platforms（各 CliId 在 fs 上的 skill 是否存在）；群組亮＝任一 member 就位。

export interface PlatformGroup {
  /** 群組識別（busy / confirm state 用）。 */
  key: string;
  /** 白話顯示名。 */
  label: string;
  /** 這個群組實際涵蓋的 CliId（一次加入 / 拿掉全部 member）。 */
  members: CliId[];
  /** 白話用途說明。 */
  hint: string;
}

export const PLATFORM_GROUPS: readonly PlatformGroup[] = [
  {
    key: "claude",
    label: "Claude Code",
    members: ["claude"],
    hint: "加到 Claude Code，就能在裡面叫出這個團隊使用",
  },
  {
    key: "codexGemini",
    label: "Codex / Gemini",
    members: ["codex", "antigravity"],
    hint: "加到 Codex 和 Gemini，就能在這兩個工具裡用這個團隊",
  },
];

/** 群組是否「就位」：任一 member 在 fs 上有 skill（team.platforms 為真相）。 */
export function isGroupOn(
  platforms: Partial<Record<CliId, boolean>> | undefined,
  group: PlatformGroup,
): boolean {
  return group.members.some((m) => platforms?.[m] === true);
}

// ---------------------------------------------------------------------------
// 多來源團隊顯示（docs/multi-source-teams.md Phase 3）
// ---------------------------------------------------------------------------

/**
 * teamDisplayId — 團隊系統鍵的「顯示用 teamId」（複合鍵 `sourceId::teamId` 隱藏 `sourceId::` 前綴）。
 * 撞名（不同來源同 teamId）由 sourceLabel 徽章/tooltip 在 UI 區分，clean 字串不外露技術前綴。
 * 裸 teamId 原樣回傳。
 */
export function teamDisplayId(teamKey: string): string {
  return parseTeamKey(teamKey).teamId;
}

/**
 * teamDisplayFolderPath — 詳情抽屜「📂 這個團隊住在這裡」顯示用的團隊資料夾路徑。
 *
 * 對齊 main 端開資料夾語意（agentOrgHandlers.ts OPEN_TEAM_FOLDER）：
 *   folder = <該團隊所屬來源根> + <純團隊路徑（去 `sourceId::` 前綴）>
 * 來源根解析鏡像 main 端 `sourceRootForTeam`（agentTeamSources.ts）：
 *   - 複合鍵 `sourceId::teamId` → 查 sources 內對應 id 的 path；查無 → fallback default。
 *   - 裸 teamId（預設來源）→ default 來源根（sources 內 id==='default'，無則第一個，再無則 defaultRoot）。
 *
 * 分隔符沿用既有 teamFolderPathOf 做法：依來源根字串是否含 `\` 決定 `\`（Windows）或 `/`，
 * 並把純團隊路徑內的 `/`（子團隊）正規化成同一分隔符。
 *
 * 邊界：
 *   - 解析出的來源根為空（sources 未載入或查無且 defaultRoot 空）→ 回 ""
 *     （維持抽屜「（找不到資料夾位置）」+ 按鈕 disabled 的時序行為）。
 *
 * @param sources     當前生效的來源清單（agentOrg.listSources()）；未載入時傳 []。
 * @param defaultRoot 預設來源根（rootInfo.path，結尾 .../agents）；未載入時傳 undefined/""。
 * @param teamKey     團隊系統鍵（裸 teamId 或複合鍵 `sourceId::teamId`）。
 */
export function teamDisplayFolderPath(
  sources: TeamSource[],
  defaultRoot: string | undefined,
  teamKey: string,
): string {
  const { sourceId, teamId } = parseTeamKey(teamKey);
  // 來源根解析（鏡像 main 端 sourceRootForTeam）。
  let root: string | undefined;
  if (sourceId) {
    root = sources.find((s) => s.id === sourceId)?.path;
  }
  if (!root) {
    // 裸 teamId、或複合鍵查無對應來源 → fallback default（sources default → 第一個 → defaultRoot）。
    root =
      sources.find((s) => s.id === "default")?.path ??
      sources[0]?.path ??
      defaultRoot;
  }
  if (!root) return "";
  const sep = root.includes("\\") ? "\\" : "/";
  const tid = teamId.replace(/\//g, sep);
  return root.replace(/[/\\]$/, "") + sep + tid;
}

/**
 * teamIsFromNonDefaultSource — 此團隊系統鍵是否來自非預設來源（含 `sourceId::` 前綴）。
 * UI 用來決定是否顯示來源徽章。
 */
export function teamIsFromNonDefaultSource(teamKey: string): boolean {
  return parseTeamKey(teamKey).sourceId !== undefined;
}

// ---------------------------------------------------------------------------
// role icon 對應
// ---------------------------------------------------------------------------
export function roleIcon(role: string | null): string {
  switch (role) {
    case "researcher":
      return "🔬";
    case "doer":
      return "⚡";
    case "verifier":
      return "✅";
    case "manager":
      return "👔";
    default:
      return "👤";
  }
}

// ---------------------------------------------------------------------------
// model 白話對應
// ---------------------------------------------------------------------------
export function modelLabel(model: string | null): string {
  if (!model) return "";
  if (model.includes("opus")) return "深度";
  if (model.includes("sonnet")) return "標準";
  if (model.includes("haiku")) return "快速";
  return model;
}

// ---------------------------------------------------------------------------
// type 白話 badge
// ---------------------------------------------------------------------------
export function typeBadgeIcon(roleInTeam: string | null): string {
  switch (roleInTeam) {
    case "manager":
      return "👔";
    case "researcher":
      return "🔬";
    case "doer":
      return "⚡";
    case "verifier":
      return "✅";
    default:
      return "👤";
  }
}

export function typeBadgeLabel(roleInTeam: string | null): string {
  switch (roleInTeam) {
    case "manager":
      return "主管";
    case "researcher":
      return "研究";
    case "doer":
      return "執行";
    case "verifier":
      return "品管";
    default:
      return roleInTeam ?? "其他";
  }
}

// ---------------------------------------------------------------------------
// 團隊層級 Ops prompt
// ---------------------------------------------------------------------------

export function buildTeamAuditPrompt(teamId: string, teamLabel: string): string {
  return `/tuq-agent audit ${teamId} 現在是要對「${teamLabel}」團隊做健診。`;
}

export function buildTeamReviewPrompt(teamId: string, teamLabel: string): string {
  return `/tuq-agent review ${teamId} 現在是要對「${teamLabel}」團隊做自我改善。`;
}

/**
 * 規格化（正式化）prompt：把快速建立的團隊補完到 agent-ops 標準。
 * - platform_context: teamuq_agent_team_ui → 讓 agent-ops 走平台 auto-fix 分支（實際修而非只報告）。
 * - 末尾要求 AI 輸出可解析的 JSON 完成 marker（自帶 teamId），系統據此自動清除「待優化」標記。
 *   marker 字串為 `agent_team_standardized`、teamId 欄位名為 `teamId`（供偵測鏈 extractor 對齊）。
 */
export function buildTeamStandardizePrompt(teamId: string, teamLabel: string): string {
  const parts = [
    "/tuq-agent",
    "platform_context: teamuq_agent_team_ui。",
    `請把「${teamLabel}」（teamId=${teamId}）這個快速建立的團隊正式化（規格化）：逐一 review 每個成員的 soul.md / org.md / tools.md / skills.md / workflow.yaml，補完到 agent-ops 標準（agent 結構完整、scope guard、workflow 採 Research→Plan→Execute 三段、消除斷鏈），並過 governance 審查。`,
    "全部規格化完成後，請在對話最後輸出一行可被解析的 JSON marker，內含 teamId，格式：",
    `\`\`\`json\n{"agent_team_standardized": {"teamId": "${teamId}"}}\n\`\`\``,
    "系統會據此自動把「待優化」標記清除。",
  ];
  return parts.join(" ");
}

export function buildCreateTeamPrompt(
  group?: {
    id: string;
    name: string;
    description?: string;
  },
  /** 該工作群組目前既有團隊的顯示名清單（例如各 team manager 的 displayName）。
   *  用來讓 AI 知道該群已有哪些團隊，避免設計出重複的新團隊。空陣列時不帶此段。 */
  existingTeams?: string[],
): string {
  const parts = [
    "/tuq-agent",
    "platform_context: teamuq_agent_team_ui。",
    "現在使用者正在快組隊-AI團隊這個系統裡，要建立新的 AI 團隊。",
  ];
  if (group) {
    // 點明歸屬給對話 context；只放使用者看得懂的群名，不外露 groupId 技術字串。
    parts.push(`這個新團隊請歸入工作群組「${group.name}」。`);
    // 有工作群組描述才併入；空白不帶。用自然語言當背景脈絡，不外露欄位 key。
    if (group.description && group.description.trim()) {
      parts.push(
        `這個工作群組的定位與用途是：${group.description.trim()}。請以此作為團隊設計的背景脈絡。`,
      );
    }
    // 既有團隊清單：用團隊顯示名（非 teamId 技術字串），讓 AI 設計互補、不重複的新團隊。
    // 邊界：清單為空（該群還沒有團隊）時不帶此段，避免出現空清單那句。
    const known = (existingTeams ?? []).map((t) => t.trim()).filter(Boolean);
    if (known.length > 0) {
      parts.push(
        `這個工作群組（${group.name}）目前已經有這些團隊：${known.join("、")}。請設計一個與它們互補、不重複的新團隊，並在釐清需求時把這些既有團隊納入考量。`,
      );
    }
  }
  // ── 白話開場指引（給 AI 的行為準則）──────────────────────────────────────
  // 目標用戶：完全不懂 AI、也不懂技術的一般人。
  // 重點 1：AI 必須用最白話的方式帶使用者，一次只問一件事，絕對不對使用者提任何技術詞彙。
  // 重點 2：AI 的第一句話只問一個生活化問題，並附具體例子讓使用者照著講。
  // 重點 3：使用者只要說出大概想做什麼，AI 就自行補齊整個團隊配置並直接產出預覽，不盤問細節。
  // 重點 4：後端契約（agent_team_create_spec）內化為 AI 的內部指示，完全不對使用者外露。
  parts.push(
    [
      "【給 AI 的行為準則——請完整遵守，不要對使用者提起這段】",
      "使用者是完全不懂 AI、也完全不懂技術的一般人。",
      "請用最白話的方式陪他，一次只做一件事。",
      "絕對不要對使用者使用任何技術詞彙，包括但不限於：用途、輸入輸出、成員角色、技能、管理關係、spec、JSON、roleInTeam、agent——這些字在對話中一個都不要出現。",
      "",
      "你的第一句話只問一個生活化問題，並附 3 個具體範例，讓他照著講一句就好。例如：",
      "「想找一群 AI 小幫手幫你做什麼？用一句話講就好，例如：",
      "① 幫我每天整理 Email、把重要的挑出來",
      "② 幫我把客戶常問的問題寫成罐頭回覆",
      "③ 幫我把會議錄音整理成重點筆記。",
      "你照著講一句就行，剩下的我來配。」",
      "",
      "使用者只要說出大概想做什麼，你就盡量自己幫他補齊整個小幫手團隊（需要哪些小幫手、各自做什麼），直接產出預覽，不要反過來盤問細節。",
      "只有真的非問不可時，才用白話一次補問一個問題。",
      "",
      "【給系統用的內部規格——請不要對使用者提起，也不要在對話中解釋這段內容】",
      "需求大致清楚後，請在對話末尾輸出 agent_team_create_spec JSON（不要用 shell 直接寫 AgentOrg 檔案）。",
      "平台後端會依 spec 建立 manager/worker 檔案、寫 agent_registry，並同步 Claude/Codex/AGY 入口指令。",
      'spec 欄位：teamId、teamName、skillName、platforms=["claude","codex","antigravity"]、manager、members；members 每筆包含 name、displayName、title、roleInTeam、model、summary、responsibilities。',
      "roleInTeam 只能是這四個之一：researcher / doer / verifier / shared；團隊的主管／PM／負責人放頂層 manager 物件，不要當成 member 的 roleInTeam。",
    ].join(" "),
  );
  return parts.join(" ");
}

export function cliSkillPrefix(cliId: string): "/" | "$" {
  return cliId === "codex" ? "$" : "/";
}

export function normalizeAgentSkillPrompt(
  prompt: string,
  cliId: string,
  skillName = "tuq-agent",
): string {
  const prefix = cliSkillPrefix(cliId);
  const trimmed = prompt.trim();
  if (!trimmed) return `${prefix}${skillName}`;

  const command = trimmed.match(/^([/$])([^\s]+)(.*)$/s);
  if (command) {
    const [, , name, rest] = command;
    return `${prefix}${name}${rest}`;
  }

  return `${prefix}${skillName} ${trimmed}`;
}

// ---------------------------------------------------------------------------
// Agent Ops 操作按鈕（Audit / Review）—— 用於 AgentDetailDrawer 底部
// ---------------------------------------------------------------------------
export interface AgentOpsActionsProps {
  label: string; // 按鈕顯示的對象名（team id 或 agentName）
  opsTarget: string; // tuq-agent 指令的目標（如 "sw" 或 "sw/developer"）
  onOpenAgentOpsSession?: (label: string, prompt: string) => void;
}

export function AgentOpsActions({
  label,
  opsTarget,
  onOpenAgentOpsSession,
}: AgentOpsActionsProps): React.JSX.Element | null {
  if (!onOpenAgentOpsSession) return null;
  return (
    <div className="at-ops-actions">
      <button
        type="button"
        className="at-ops-btn at-ops-btn--audit"
        onClick={() =>
          onOpenAgentOpsSession(
            `🔍 健診 ${label}`,
            `/tuq-agent audit ${opsTarget}`,
          )
        }
        title={`讓 AI 檢查這位助手最近的工作、找出可改進處`}
      >
        🔍 健診
      </button>
      <button
        type="button"
        className="at-ops-btn at-ops-btn--review"
        onClick={() =>
          onOpenAgentOpsSession(
            `📋 成長 ${label}`,
            `/tuq-agent review ${opsTarget}`,
          )
        }
        title={`請 AI 成長這位助手的工作表現`}
      >
        📋 成長
      </button>
    </div>
  );
}
