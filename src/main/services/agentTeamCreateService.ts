/**
 * agentTeamCreateService.ts — deterministic AI team creation from a structured spec.
 *
 * The AI conversation should collect intent and output AgentTeamCreateSpec. This
 * service owns filesystem writes so team creation is repeatable and cheap.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  AgentTeamCreateMember,
  AgentTeamCreateSpec,
} from "../../shared/ipcContracts";

export interface AgentTeamCreateFileResult {
  teamId: string;
  skillName: string;
  filesCreated: string[];
  filesSkipped: string[];
}

export interface CreateEntrySkillFileResult {
  /** 實際使用的 skill 目錄名（含 fallback 預設值）。 */
  skillName: string;
  /** 寫出（或既有）的 SKILL.md 絕對路徑。 */
  skillMdPath: string;
  /** true = 已存在同名 skill 故未覆寫（冪等）；false = 本次新建。 */
  alreadyExisted: boolean;
}

/**
 * 為一個既有團隊（有資料夾、但該來源缺入口 skill）建立可攜入口 SKILL.md
 * （docs/multi-source-teams.md Phase 4）。
 *
 * 寫到 `<agentOrgRoot>/.claude/skills/<skillName>/SKILL.md`，內容用 `renderClaudeEntrySkill`
 * （Step 0 ROOT 定位 + `<ROOT>/agents/<teamId>/manager` 絕對 bootstrap + needle 字面
 * `agents/<teamId>/manager`，可被 resolveEntrySkill 反查）。
 *
 * **不覆寫既有**：若同名 SKILL.md 已存在 → 直接回 `alreadyExisted: true`，不動檔。
 *
 * @param agentsRoot — 該團隊所屬來源的 agents 根（含尾段 `agents`）。
 * @param teamId     — 純團隊路徑（複合鍵已去 `sourceId::` 前綴；可含 `/` 子團隊）。
 * @param teamName   — 顯示名（SKILL.md heading / description 用）。
 * @param skillName  — 選填 skill 目錄名；省略時用 `tuq-<teamId 末段>`。
 */
export async function createEntrySkillFile(
  agentsRoot: string,
  teamId: string,
  teamName: string,
  skillName?: string,
): Promise<CreateEntrySkillFileResult> {
  const normTeamId = normalizeSlash(teamId.trim());
  const resolvedSkillName = skillName?.trim() || `tuq-${lastPathSegment(normTeamId)}`;
  const agentOrgRoot = agentsRoot.replace(/[/\\]agents[/\\]?$/, "");
  const skillDir = safeJoin(agentOrgRoot, ".claude", "skills", resolvedSkillName);
  const skillMdPath = path.join(skillDir, "SKILL.md");

  if (await exists(skillMdPath)) {
    return { skillName: resolvedSkillName, skillMdPath, alreadyExisted: true };
  }

  const body = renderClaudeEntrySkill(
    normTeamId,
    teamName.trim() || lastPathSegment(normTeamId),
    resolvedSkillName,
  );
  await fs.promises.mkdir(skillDir, { recursive: true });
  await fs.promises.writeFile(skillMdPath, body, "utf8");
  return { skillName: resolvedSkillName, skillMdPath, alreadyExisted: false };
}

interface NormalizedAgent {
  name: string;
  displayName: string;
  title: string;
  type: "manager" | "worker";
  roleInTeam?: "researcher" | "doer" | "verifier" | "shared";
  model: string;
  summary: string;
  responsibilities: string[];
}

export async function createAgentTeamFiles(
  agentsRoot: string,
  spec: AgentTeamCreateSpec,
): Promise<AgentTeamCreateFileResult> {
  const normalized = normalizeSpec(spec);
  const agentOrgRoot = agentsRoot.replace(/[/\\]agents[/\\]?$/, "");
  const teamDir = safeJoin(agentsRoot, normalized.teamId);

  if (await exists(teamDir)) {
    throw new Error(`AI 團隊已存在，未建立：${normalized.teamId}`);
  }

  const created: string[] = [];
  const skipped: string[] = [];
  const managerDir = path.join(teamDir, "manager");
  const manager = normalizeManager(normalized);
  const members = normalized.members.map((member) => normalizeMember(normalized, member));

  await writeAgentBundle(managerDir, normalized.teamId, manager, created, skipped);
  for (const member of members) {
    await writeAgentBundle(
      path.join(teamDir, member.name),
      normalized.teamId,
      member,
      created,
      skipped,
    );
  }

  const skillDir = safeJoin(agentOrgRoot, ".claude", "skills", normalized.skillName);
  const skillMdPath = path.join(skillDir, "SKILL.md");

  // 衝突偵測：若 SKILL.md 已存在，先讀其內容確認 needle 是否屬於本團隊。
  // needle = `agents/<teamId>/manager`；用 boundary-aware 比對（後接 `/` 或非字母數字符）
  // 避免 `agents/team-a/manager` 誤命中 `agents/team-ab/manager`。
  if (await exists(skillMdPath)) {
    const existingContent = await fs.promises.readFile(skillMdPath, "utf8");
    const needle = `agents/${normalized.teamId}/manager`;
    // boundary-aware：needle 後接字元必須是非字母數字（含行尾、/、換行等），避免子字串誤配。
    const needlePattern = new RegExp(
      needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=[^a-zA-Z0-9]|$)",
    );
    if (!needlePattern.test(existingContent)) {
      // 被其他團隊佔用 → 白話錯誤，讓 humanizeCreateError 原樣顯示
      throw new Error(
        `這個團隊的入口指令名「${normalized.skillName}」已經被其他團隊用了，請換一個團隊名稱再建立一次。`,
      );
    }
    // 同隊重跑（冪等）→ 維持 skip 行為
    skipped.push(skillMdPath);
  } else {
    await writeIfMissing(
      skillMdPath,
      renderClaudeEntrySkill(normalized.teamId, normalized.teamName, normalized.skillName),
      created,
      skipped,
    );
  }

  return {
    teamId: normalized.teamId,
    skillName: normalized.skillName,
    filesCreated: created,
    filesSkipped: skipped,
  };
}

function normalizeSpec(spec: AgentTeamCreateSpec): AgentTeamCreateSpec & { skillName: string } {
  const teamId = normalizeSlash(spec.teamId.trim());
  const skillName = spec.skillName?.trim() || `tuq-${lastPathSegment(teamId)}`;
  return {
    ...spec,
    teamId,
    teamName: spec.teamName.trim(),
    skillName,
    platforms: spec.platforms.length > 0 ? spec.platforms : ["claude", "codex", "antigravity"],
    manager: spec.manager ?? {},
    members: spec.members ?? [],
  };
}

function normalizeManager(spec: AgentTeamCreateSpec & { skillName: string }): NormalizedAgent {
  const manager = spec.manager ?? {};
  return {
    name: "manager",
    displayName: manager.displayName?.trim() || `${spec.teamName}組長`,
    title: manager.title?.trim() || `${spec.teamName} Manager`,
    type: "manager",
    model: manager.model?.trim() || "sonnet",
    summary: manager.summary?.trim() || `管理 ${spec.teamName} 團隊的需求釐清、派工、驗收與交付。`,
    responsibilities:
      manager.responsibilities && manager.responsibilities.length > 0
        ? manager.responsibilities
        : ["釐清使用者需求", "拆分工作並派工", "彙整結果並交付"],
  };
}

function normalizeMember(
  spec: AgentTeamCreateSpec,
  member: AgentTeamCreateMember,
): NormalizedAgent {
  return {
    name: member.name.trim(),
    displayName: member.displayName?.trim() || member.title?.trim() || member.name.trim(),
    title: member.title?.trim() || member.displayName?.trim() || member.name.trim(),
    type: "worker",
    roleInTeam: member.roleInTeam,
    model: member.model?.trim() || "sonnet",
    summary: member.summary?.trim() || `${spec.teamName} 的 ${member.name} 專員。`,
    responsibilities:
      member.responsibilities && member.responsibilities.length > 0
        ? member.responsibilities
        : ["依 manager brief 執行指定工作", "回報產出與風險"],
  };
}

async function writeAgentBundle(
  agentDir: string,
  teamId: string,
  agent: NormalizedAgent,
  created: string[],
  skipped: string[],
): Promise<void> {
  await writeIfMissing(path.join(agentDir, "agent.yaml"), renderAgentYaml(teamId, agent), created, skipped);
  await writeIfMissing(path.join(agentDir, "soul.md"), renderSoul(agent), created, skipped);
  await writeIfMissing(path.join(agentDir, "org.md"), renderOrg(teamId, agent), created, skipped);
  await writeIfMissing(path.join(agentDir, "tools.md"), renderTools(agent), created, skipped);
  await writeIfMissing(path.join(agentDir, "skills.md"), renderSkills(agent), created, skipped);
  await writeIfMissing(path.join(agentDir, "workflow.yaml"), renderWorkflow(agent), created, skipped);
  await writeIfMissing(path.join(agentDir, "README.md"), renderReadme(agent), created, skipped);
  await writeIfMissing(
    path.join(agentDir, "introduction.json"),
    `${JSON.stringify(renderIntroduction(teamId, agent), null, 2)}\n`,
    created,
    skipped,
  );
}

function renderAgentYaml(teamId: string, agent: NormalizedAgent): string {
  const lines = [
    `agent: ${agent.name}`,
    `title: "${agent.title}"`,
    `display_name: "${agent.displayName}"`,
    `team: ${teamId}`,
    `type: ${agent.type}`,
  ];
  if (agent.type === "worker") {
    lines.push(`role_in_team: ${agent.roleInTeam ?? "doer"}`);
    lines.push("reports_to: manager");
  } else {
    lines.push("reports_to: user");
  }
  lines.push(
    "bootstrap:",
    "  - soul.md",
    "  - org.md",
    "  - tools.md",
    "workflow: workflow.yaml",
    "dispatch:",
    `  model: ${agent.model}`,
    `  trigger: "${agent.summary}"`,
    '  not_for: "不屬於本團隊職責的任務"',
    "skills:",
    "  - skills.md",
    "",
  );
  return lines.join("\n");
}

function renderSoul(agent: NormalizedAgent): string {
  return [
    `# ${agent.displayName}`,
    "",
    agent.summary,
    "",
    "## 原則",
    "- 先確認任務目標與交付物。",
    "- 不直接猜測缺漏需求；必要時先提出澄清。",
    "- 交付時列出已完成內容、風險與下一步。",
    "",
  ].join("\n");
}

function renderOrg(teamId: string, agent: NormalizedAgent): string {
  return [
    `# ${agent.displayName} 組織關係`,
    "",
    `- team: ${teamId}`,
    `- type: ${agent.type}`,
    `- reports_to: ${agent.type === "manager" ? "user" : "manager"}`,
    "",
    "## 職責",
    ...agent.responsibilities.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function renderTools(agent: NormalizedAgent): string {
  const managerLine =
    agent.type === "manager"
      ? "- 可依任務需要派工給同 team worker，並做彙整與驗收。"
      : "- 不自行派工；依 manager brief 執行並回報。";
  return [
    `# ${agent.displayName} 工具規則`,
    "",
    managerLine,
    "- 優先使用平台提供的結構化資料與後端 API。",
    "- 涉及檔案或資料庫變更時，回報變更範圍。",
    "",
  ].join("\n");
}

function renderSkills(agent: NormalizedAgent): string {
  return [
    `# ${agent.displayName} 能力`,
    "",
    ...agent.responsibilities.map((item) => `- ${item}`),
    "",
  ].join("\n");
}

function renderWorkflow(agent: NormalizedAgent): string {
  if (agent.type === "manager") {
    return [
      "workflow:",
      "  - id: clarify",
      "    action: confirm_goal",
      "  - id: dispatch",
      "    action: assign_or_execute",
      "  - id: verify",
      "    action: review_output",
      "  - id: deliver",
      "    action: summarize_result",
      "",
    ].join("\n");
  }
  return [
    "workflow:",
    "  - id: read_brief",
    "    action: understand_manager_request",
    "  - id: execute",
    "    action: produce_output",
    "  - id: self_check",
    "    action: verify_against_brief",
    "  - id: report",
    "    action: return_result",
    "",
  ].join("\n");
}

function renderReadme(agent: NormalizedAgent): string {
  return [
    `# ${agent.displayName}`,
    "",
    agent.summary,
    "",
    "本目錄由快組隊-AI團隊建立流程依結構化 spec 產生。",
    "",
  ].join("\n");
}

function renderIntroduction(teamId: string, agent: NormalizedAgent): Record<string, unknown> {
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
    last_updated: today(),
  };
}

/**
 * 產生「Step 0 定位 AgentOrg 根目錄」段。仿 tuq-dev SKILL.md 的四路徑 fallback，
 * 但參數化：方式 C 的 symlink 反查用本團隊的 `skillName`。目的是讓 manager
 * bootstrap 時先解出 `<ROOT>` 絕對前綴，不依賴 CWD、不寫死 T: 槽，保持可攜。
 */
export function renderRootResolutionBlock(skillName: string): string {
  return [
    "## Step 0 — 定位 AgentOrg 根目錄（必做，只做一次）",
    "",
    "本 skill 的所有檔案路徑都相對於 AgentOrg 專案根目錄（以下稱 `<ROOT>`）。",
    "依序嘗試下列 4 種方式，第一個成功者即採用：",
    "",
    "**方式 A — Plugin 模式（marketplace install）**",
    "若下一行的 `${CLAUDE_PLUGIN_ROOT}` 已被 Claude Code 替換成實際路徑（非字面量），取之；否則跳過。",
    "> CLAUDE_PLUGIN_ROOT: `${CLAUDE_PLUGIN_ROOT}`",
    "",
    "**方式 B — 環境變數覆寫**",
    "```bash",
    "bash -c 'echo \"${AGENTORG_ROOT:-}\"'",
    "```",
    "非空且該路徑下存在 `agents/protocols/definitions.md` 則取之。",
    "",
    "**方式 C — 全域 symlink 反查（setup-global-skills.sh install）**",
    "```bash",
    `python3 -c "import os; p=os.path.realpath(os.path.expanduser('~/.claude/skills/${skillName}/SKILL.md')); r=os.path.abspath(os.path.join(os.path.dirname(p),'..','..','..')); print(r if os.path.isfile(os.path.join(r,'agents','protocols','definitions.md')) else '')"`,
    "```",
    `輸出非空則取之。（反推 3 層：\`${skillName}/\` → \`skills/\` → \`.claude/\` → \`<ROOT>\`）`,
    "",
    "**方式 D — CWD 上溯**",
    "從當前工作目錄向上逐層檢查是否存在 `agents/protocols/definitions.md`，命中即為 `<ROOT>`。",
    "",
    "**四者皆失敗時**：停止執行並回報",
    "「無法定位 AgentOrg 根目錄。請執行 `bash scripts/setup-global-skills.sh` 完成全域安裝，或設定環境變數 `AGENTORG_ROOT=<AgentOrg 絕對路徑>`」。",
    "",
    "取得 `<ROOT>` 後，**後續所有 Read 一律使用絕對路徑** `<ROOT>/agents/...`，嚴禁相對路徑、嚴禁 search/Glob 亂找。",
  ].join("\n");
}

/**
 * 產生 claude 入口 SKILL.md 的完整內容字串（frontmatter + body）。
 *
 * 純字串組裝、無 fs 副作用：寫檔由呼叫端負責（createAgentTeamFiles 的
 * writeIfMissing，或 teamRegistrationService 的內容感知覆寫）。
 *
 * 內含：YAML frontmatter（name/description/allowed-tools）、Step 0 ROOT 定位段、
 * `<ROOT>/agents/<teamId>/manager` 絕對 bootstrap、以及供反查用的 needle 字面
 * `agents/<teamId>/manager`（Manager directory 行，勿移除）。
 */
export function renderClaudeEntrySkill(teamId: string, teamName: string, skillName: string): string {
  const managerDir = `agents/${teamId}/manager`;
  return [
    "---",
    `name: ${skillName}`,
    `description: Use when you want the ${teamName} manager from AgentOrg to handle tasks for this team.`,
    "allowed-tools: Glob Grep Read Bash",
    "---",
    "",
    `# ${teamName} Manager`,
    "",
    "- Treat this skill as entering the manager role before responding.",
    // 🔒 硬約束：保留字面字串 agents/<teamId>/manager 供 teamRegistrationService
    //    的 resolveEntrySkill 反查入口 skill（needle 比對 SKILL.md body）。勿移除。
    `- Manager directory (relative to ROOT): ${managerDir}`,
    "",
    renderRootResolutionBlock(skillName),
    "",
    "## Bootstrap",
    "",
    "解出 `<ROOT>` 後，依序讀取下列檔案（一律用 `<ROOT>/` 絕對前綴，嚴禁相對路徑、嚴禁 search/Glob 亂找）：",
    `  1. \`<ROOT>/${managerDir}/agent.yaml\``,
    `  2. \`<ROOT>/${managerDir}/soul.md\``,
    `  3. \`<ROOT>/${managerDir}/org.md\``,
    `  4. \`<ROOT>/${managerDir}/tools.md\``,
    `  5. \`<ROOT>/${managerDir}/workflow.yaml\``,
    "",
    "- Follow that manager's scope, principles, dispatch rules, and workflow.",
    "- Always respond in Traditional Chinese unless the user clearly asks for another language.",
    "",
  ].join("\n");
}

async function writeIfMissing(
  filePath: string,
  content: string,
  created: string[],
  skipped: string[],
): Promise<void> {
  if (await exists(filePath)) {
    skipped.push(filePath);
    return;
  }
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content, "utf8");
  created.push(filePath);
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}

function safeJoin(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(root, ...segments);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`不安全的建立路徑：${resolvedTarget}`);
  }
  return resolvedTarget;
}

function normalizeSlash(input: string): string {
  return input.replace(/\\/g, "/");
}

function lastPathSegment(input: string): string {
  return normalizeSlash(input).split("/").filter(Boolean).at(-1) ?? input;
}

function roleLabel(role?: string): string {
  if (role === "researcher") return "研究員";
  if (role === "verifier") return "審查者";
  if (role === "shared") return "共享支援";
  return "執行者";
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
