import { z } from "zod";

// ---------------------------------------------------------------------------
// AgentOrg — AI 團隊掃描（agent-teams-view-impl-20260607）
// ---------------------------------------------------------------------------

/**
 * agentOrg:scan / agentOrg:getDetail / agentOrg:getRoot / agentOrg:setRoot channel 常數。
 * rootPath 來源：app_settings(key='agentOrgRootPath')，fallback 既有常數 AGENT_ORG_ROOT。
 */
export const AGENT_ORG_CHANNELS = {
  SCAN: "agentOrg:scan",
  GET_DETAIL: "agentOrg:getDetail",
  GET_ROOT: "agentOrg:getRoot",
  SET_ROOT: "agentOrg:setRoot",
  SAVE_DRAFT: "agentOrg:saveDraft",
  GET_DRAFT: "agentOrg:getDraft",
  CLEAR_DRAFT: "agentOrg:clearDraft",
  WATCH_DRAFT: "agentOrg:watchDraft",
  UNWATCH_DRAFT: "agentOrg:unwatchDraft",
  DRAFT_UPDATED: "agentOrg:draftUpdated",
  BACKUP_INTRO: "agentOrg:backupIntroduction",
  CREATE_TEAM_FROM_SPEC: "agentOrg:createTeamFromSpec",
  /** 為「有團隊、無入口 skill」的團隊建立可攜入口 SKILL.md（寫到該團隊所屬來源的 .claude/skills）。 */
  CREATE_ENTRY_SKILL: "agentOrg:createEntrySkill",
  OPEN_TEAM_FOLDER: "agentOrg:openTeamFolder",
  // 多來源團隊（Phase 2）— 來源清單管理
  LIST_SOURCES: "agentOrg:listSources",
  ADD_SOURCE: "agentOrg:addSource",
  REMOVE_SOURCE: "agentOrg:removeSource",
  UPDATE_SOURCE: "agentOrg:updateSource",
  APPLY_GROUP_SOURCE: "agentOrg:applyGroupSource",
} as const;

/** agentOrg:scan — 無必要參數（rootPath 由 main 端從 app_settings 或常數取）。 */
export const AgentOrgScanSchema = z.object({}).optional();
export type AgentOrgScanPayload = z.infer<typeof AgentOrgScanSchema>;

/** agentOrg:openTeamFolder — 用檔案總管開啟某團隊在 AgentOrg 的資料夾（<agents 根>/<teamId>）。 */
export const AgentOrgOpenTeamFolderSchema = z.object({
  teamId: z.string().min(1),
});
export type AgentOrgOpenTeamFolderPayload = z.infer<
  typeof AgentOrgOpenTeamFolderSchema
>;

/**
 * agentOrg:createEntrySkill — 為「有團隊、無入口 skill」的團隊建立可攜入口 SKILL.md
 * （docs/multi-source-teams.md Phase 4）。
 *
 * skillName 選填：未填時 main 端預設 `tuq-<teamId 末段>`（與 createAgentTeamFiles 同款規則）。
 * 寫到「該團隊所屬來源根」的 `.claude/skills/<skillName>/SKILL.md`，**不覆寫既有檔**。
 */
export const AgentOrgCreateEntrySkillSchema = z.object({
  teamId: z.string().min(1),
  /** skill 目錄名（限 `tuq-<slug>`）；省略時 main 端自動產 `tuq-<teamId 末段>`。 */
  // 與建隊 spec 同款：preprocess 正規化 → 補 tuq- 前綴、清非法字元，regex 作最後防線。
  skillName: z.preprocess(
    normalizeSkillName,
    z
      .string()
      .regex(/^tuq-[a-z0-9][a-z0-9-]*$/)
      .optional(),
  ),
});
export type AgentOrgCreateEntrySkillPayload = z.infer<
  typeof AgentOrgCreateEntrySkillSchema
>;

/** agentOrg:createEntrySkill 回傳形狀。 */
export interface AgentOrgCreateEntrySkillResult {
  /** 實際使用的 skill 目錄名（含 main 端 fallback 產生的預設值）。 */
  skillName: string;
  /** 寫出的 SKILL.md 絕對路徑（顯示/除錯用）。 */
  skillMdPath: string;
  /** true = 已存在同名 skill 故未覆寫（冪等）；false = 本次新建。 */
  alreadyExisted: boolean;
}

/** agentOrg:getDetail — 指定 teamId + agentName。 */
export const AgentOrgGetDetailSchema = z.object({
  teamId: z.string().min(1),
  agentName: z.string().min(1),
});
export type AgentOrgGetDetailPayload = z.infer<typeof AgentOrgGetDetailSchema>;

/** agentOrg:getRoot — 無參數，回傳當前 rootPath（含 fallback 常數），以及是否為自訂。 */
export const AgentOrgGetRootSchema = z.object({}).optional();
export type AgentOrgGetRootPayload = z.infer<typeof AgentOrgGetRootSchema>;

/** agentOrg:setRoot — 設定新 rootPath（儲存前驗證路徑存在）。 */
export const AgentOrgSetRootSchema = z.object({
  path: z.string().min(1),
});
export type AgentOrgSetRootPayload = z.infer<typeof AgentOrgSetRootSchema>;

/** agentOrg:getRoot 回傳形狀。 */
export interface AgentOrgRootInfo {
  /** 當前生效的根路徑（已含 fallback 常數）。 */
  path: string;
  /** 是否為用戶自訂（false = 使用預設常數）。 */
  isCustom: boolean;
  /** 預設常數路徑（供 UI 顯示 placeholder）。 */
  defaultPath: string;
}

// ---------------------------------------------------------------------------
// 多來源團隊（Multi-Source Teams）— Phase 1 後端地基（docs/multi-source-teams.md）
// ---------------------------------------------------------------------------

/**
 * TeamSource — 一個「團隊來源」（本機設定，存於 app_settings key `agentTeamSources`）。
 *
 * 核心原則：存「少數的來源」（可攜），推導「多數的團隊路徑」。
 * 團隊位置 = 該來源 `path`（agents 根）+ 團隊資料夾，照舊推導；不存每隊絕對路徑。
 *
 * - `id`    — 穩定識別碼（如 `'default'`、`'projectX'`、`'local'`）。預設來源恆為 `'default'`。
 * - `label` — 顯示名（如「預設」「公司共用」「本機草稿」）。
 * - `path`  — agents 根（建議指向穩定 junction，如 `C:\teamuq-agents\agents`）。
 * - `kind`  — 來源類型（選填；UI 顯示/偵測用，不影響路徑解析）。
 */
export interface TeamSource {
  id: string;
  label: string;
  path: string;
  kind?: "gdrive-shared" | "local" | "project-repo" | "other";
}

/** TeamSourcesConfig — `agentTeamSources` 設定值（含 version 供未來遷移）。 */
export interface TeamSourcesConfig {
  version: 1;
  sources: TeamSource[];
}

/**
 * 多來源團隊複合鍵分隔符（docs/multi-source-teams.md Phase 3）。
 *
 * 非預設來源的團隊系統鍵 = `${sourceId}::${teamId}`。`::` 不會出現在資料夾名，
 * 與 teamId 內既有的 `/` 子團隊分隔不衝突。
 *
 * **約束鐵則**（解析複合鍵的所有 helper 都依賴它）：
 *   - sourceId：來源識別碼（由 `_makeSourceId` 產生，`[a-z0-9-]`），**絕不含 `::` 與 `/`**。
 *   - teamId：團隊路徑（可含 `/` 子團隊，如 `platform/goose-ops`），**絕不含 `::`**。
 *   - agentName：agent 名（agent.yaml `agent:` 或目錄名），**絕不含 `/`**。
 *   故複合鍵以「第一個 `::`」切 sourceId / teamId（用 indexOf 而非 lastIndexOf）。
 */
export const TEAM_KEY_SEP = "::";

/** 複合鍵解析結果。`sourceId === undefined` 表示裸 teamId（預設來源）。 */
export interface ParsedTeamKey {
  /** 來源識別碼；裸 teamId（預設來源）時為 undefined。 */
  sourceId: string | undefined;
  /** 純團隊路徑（複合鍵時為 `::` 後的部分；裸 teamId 時即原值）。供路徑 join。 */
  teamId: string;
}

/**
 * parseTeamKey — 把團隊系統鍵拆成 `{ sourceId, teamId }`。
 *
 * - 含 `::`（複合鍵 `sourceId::teamId`）→ sourceId=`::` 前段、teamId=`::` 後段（保留其中的 `/`）。
 * - 不含 `::`（裸 teamId，預設來源）→ sourceId=undefined、teamId=原值。
 *
 * 容錯：`::` 在最前（`::foo`，空 sourceId）或最後（`foo::`，空 teamId）等畸形鍵
 * 退化為「裸 teamId」（sourceId=undefined、teamId=原值），不拋錯。
 */
export function parseTeamKey(key: string): ParsedTeamKey {
  const sep = key.indexOf(TEAM_KEY_SEP);
  // sep <= 0：無 `::` 或 `::` 在最前（空 sourceId）→ 裸 teamId。
  if (sep <= 0) return { sourceId: undefined, teamId: key };
  const sourceId = key.slice(0, sep);
  const teamId = key.slice(sep + TEAM_KEY_SEP.length);
  // 空 teamId（`foo::`）→ 退化為裸 teamId（避免推出空路徑）。
  if (!teamId) return { sourceId: undefined, teamId: key };
  return { sourceId, teamId };
}

/**
 * makeTeamKey — 由 sourceId + 純 teamId 組出團隊系統鍵。
 *
 * - sourceId === undefined / 'default' / 空 → 回裸 teamId（預設來源維持零遷移）。
 * - 其餘 → `${sourceId}::${teamId}`。
 */
export function makeTeamKey(
  sourceId: string | undefined,
  teamId: string,
): string {
  if (!sourceId || sourceId === "default") return teamId;
  return `${sourceId}${TEAM_KEY_SEP}${teamId}`;
}

/**
 * teamPathPart — 取團隊系統鍵的「路徑部分」（複合鍵時去掉 `sourceId::` 前綴）。
 * 供 `path.join(sourceRoot, ...teamPathPart.split('/'))` 推團隊資料夾。
 * 裸 teamId 原樣回傳。
 */
export function teamPathPart(key: string): string {
  return parseTeamKey(key).teamId;
}

/**
 * 來源類型枚舉（與 TeamSource.kind 對齊）。UI 顯示/偵測用，不影響路徑解析。
 */
export const TeamSourceKindSchema = z.enum([
  "gdrive-shared",
  "local",
  "project-repo",
  "other",
]);
export type TeamSourceKind = z.infer<typeof TeamSourceKindSchema>;

/**
 * agentOrg:applyGroupSource — 群組級「實體搬移」（plan_v2 §2.1）。
 * 將指定 teamKeys 搬到 toSourceId 來源，重建三平台入口 skill。
 */
export const ApplyGroupSourcePayloadSchema = z.object({
  groupId: z.string().min(1),
  toSourceId: z.string().min(1),
  teamKeys: z.array(z.string().min(1)),
  platforms: z
    .array(z.enum(["claude", "codex", "antigravity"]))
    .default(["claude", "codex", "antigravity"]),
});
export type ApplyGroupSourcePayload = z.infer<
  typeof ApplyGroupSourcePayloadSchema
>;

/** agentOrg:applyGroupSource 回傳形狀。 */
export interface ApplyGroupSourceResult {
  results: {
    oldKey: string;
    newKey: string;
    ok: boolean;
    message?: string;
    displayName: string;
  }[];
}

/** agentOrg:listSources — 無參數，回傳當前生效的來源清單 TeamSource[]。 */
export const AgentOrgListSourcesSchema = z.object({}).optional();
export type AgentOrgListSourcesPayload = z.infer<
  typeof AgentOrgListSourcesSchema
>;

/**
 * agentOrg:addSource — 新增一個團隊來源（main 端驗證 path 存在後 append，自動產 id）。
 * label 顯示名、path agents 根、kind 選填（未填 main 端預設 'other'）。
 */
export const AgentOrgAddSourceSchema = z.object({
  label: z.string().min(1),
  path: z.string().min(1),
  kind: TeamSourceKindSchema.optional(),
});
export type AgentOrgAddSourcePayload = z.infer<typeof AgentOrgAddSourceSchema>;

/** agentOrg:removeSource — 移除指定來源（main 端禁止移除最後一個）。 */
export const AgentOrgRemoveSourceSchema = z.object({
  id: z.string().min(1),
});
export type AgentOrgRemoveSourcePayload = z.infer<
  typeof AgentOrgRemoveSourceSchema
>;

/**
 * agentOrg:updateSource — 修改既有來源的 label / path（皆選填，至少帶一個）。
 * 改 path 時 main 端會驗證新路徑存在。
 */
export const AgentOrgUpdateSourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
});
export type AgentOrgUpdateSourcePayload = z.infer<
  typeof AgentOrgUpdateSourceSchema
>;

/**
 * AgentNodeDto — 單一 agent 的基本資訊（scan 回傳用）。
 * id 格式：'teamId/agentName'（如 'sw/developer'、'platform/goose-ops/manager'）。
 */
export interface AgentNodeDto {
  id: string;
  name: string;
  title: string;
  displayName: string | null;
  type: string;
  roleInTeam: string | null;
  model: string | null;
  trigger: string | null;
  notFor: string | null;
  /**
   * 累計 worklog JSON 數量。scan 時不計算（undefined）；getAgentDetail 才精確計算。
   * renderer 顯示：detail 抽屜讀 detail.worklogCount；卡片小徽章讀 agent.worklogCount（undefined 時隱藏）。
   */
  worklogCount?: number;
  /** agent 來源平台識別碼（'cloud'/'local'/'builtin:local' 等）；scan 路徑通常 undefined。 */
  platform?: string;
}

/** AgentTeamDto — 一個 team 的 manager + agents 清單（scan 回傳用）。 */
export interface AgentTeamDto {
  id: string;
  manager: AgentNodeDto | null;
  agents: AgentNodeDto[];
  /**
   * 此團隊所屬「來源」的識別碼（多來源團隊；docs/multi-source-teams.md Phase 1）。
   * 由 scanAgentOrg wrapper 逐來源掃描時標記（每個來源各自一份 agents 根）。
   * 預設來源恆為 `'default'`；只有 default 來源時，UI 與行為與現況逐字一致。
   */
  sourceId: string;
  /**
   * 此團隊所屬來源的顯示名（如「預設」「公司共用」）。供 UI tooltip/徽章顯示（Phase 2/3）。
   * 未設定來源 label 時可能 undefined。
   */
  sourceLabel?: string;
  /**
   * 是否已規格化（#7，flag-based）。由 scanAgentOrg wrapper 計算後 merge 進來：
   * 只有「快速建立（manager introduction.json 帶 `teamuq_agent_team_ui` flag）且 DB 未顯式標 standardized=1」
   * 的團隊回 false（待優化，左欄顯示徽章）；手寫團隊與顯式已規格化團隊回 true（不顯徽章）。
   * undefined 僅可能出現在舊路徑（一般情況 scan 都會帶值）。
   */
  standardized?: boolean;
  /**
   * 團隊是否「上線」（持久化真相來源；agent_registry.enabled 旗標）。由 scanAgentOrg wrapper
   * 讀該 team manager 列（`${teamId}/manager`）的 enabled 合併進來：
   * - true = 上線（skill 已同步到平台、enabled=1）。
   * - false = 暫停（已從平台移除、enabled=0）。
   * 無 registry 列時為 undefined；UI 預設視為 true（上線，與 registry enabled INSERT default=1 一致）。
   */
  enabled?: boolean;
  /**
   * 三平台 skill 是否「實際已註冊/同步」（檔案/junction 存在於各平台 skills 目錄）。
   * 由 scanAgentOrg wrapper 對每隊呼叫 inspectTeamPlatforms 算出：
   * 反查入口 skillName（resolveEntrySkill）成功後，逐平台 fs.access
   * `<skillsDir>/<skillName>`（claude `~/.claude/skills`、codex `~/.agents/skills`、
   * antigravity `~/.gemini/antigravity-cli/skills`）存在→true、不存在/錯誤→false。
   * 反查 null（找不到入口 skill）→ 三平台一律 false。
   * undefined = 未計算/未知（舊路徑或計算失敗）。
   *
   * ⚠️ 與 `enabled` 語意不同：`enabled` 是 registry 上線旗標（人為標記）；
   * `platforms` 是磁碟上 skill 檔案的實際存在狀態，兩者勿混用。
   */
  platforms?: { claude: boolean; codex: boolean; antigravity: boolean };
  /**
   * 這個團隊「在它自己所屬來源」是否已有可反查的入口 skill（docs/multi-source-teams.md Phase 4）。
   * 由 scanAgentOrg wrapper 計算：`resolveEntrySkill(<該隊來源根去尾 /agents>, <純團隊路徑>) !== null`
   * （即 `<sourceRoot>/../.claude/skills/` 底下有某份 SKILL.md body 命中該隊 needle）。
   *
   * - true  = 已有入口 skill（可安裝到各平台）。
   * - false = 有團隊資料夾、但該來源沒有對應入口 skill（UI 顯示「建立入口指令」按鈕，
   *           取代直接安裝的爛體驗）。
   * - undefined = 未計算/未知（舊路徑或計算失敗）。
   *
   * 註：與 `platforms` 不同——`platforms` 是「入口 skill 已連到各平台 skills 目錄」的狀態；
   * `hasEntrySkill` 是更上游的「來源端到底有沒有那份入口 skill」。無入口 skill 時 platforms 必全 false。
   */
  hasEntrySkill?: boolean;
}

/** AgentOrgTree — agentOrg:scan 回傳（IpcResult<AgentOrgTree>）。 */
export interface AgentOrgTree {
  teams: AgentTeamDto[];
  /**
   * 掃描中遭遇「有 agent.yaml 但讀取/解析失敗」的相對路徑清單（相對於 rootPath）。
   * 無警告時為 undefined（向後相容）。
   */
  parseWarnings?: string[];
}

/**
 * AgentIntroduction — introduction.json 結構化白話介紹（全欄位 optional，容忍缺欄/格式差異）。
 */
export interface AgentIntroduction {
  id?: string;
  display_name?: string;
  team?: string;
  role?: string;
  summary?: string;
  capabilities?: string[];
  when_to_use?: string;
  not_for?: string;
  reports_to?: string;
  manages?: string[];
  callable_by?: string[];
  inputs?: string;
  outputs?: string;
  workflows?: { scenario: string; steps: string[] }[];
  examples?: string[];
  flags?: string[];
  last_updated?: string;
}

// ---------------------------------------------------------------------------
// AI 團隊建立 spec（teamuq_agent_team_ui）
// ---------------------------------------------------------------------------

export const AgentTeamPlatformSchema = z.enum(["claude", "codex", "antigravity"]);
export type AgentTeamPlatform = z.infer<typeof AgentTeamPlatformSchema>;

/**
 * skillName 正規化：建隊 spec 由 AI 自由產生，常給出不含 `tuq-` 前綴或夾雜空白/大寫的
 * skillName（如 "sw-engineering"、"SW Engineering"），直接送 schema 會被 regex 擋下並
 * 丟技術錯誤。比照 roleInTeam/platforms 的寬鬆策略：能修就修，不能修才退成 undefined
 * （交給下游自動生成）。輸出保證滿足 /^tuq-[a-z0-9][a-z0-9-]*$/ 或為 undefined。
 */
export function normalizeSkillName(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-") // 非 [a-z0-9-] → 連字號
    .replace(/-+/g, "-") // 收斂重複連字號
    .replace(/^-+|-+$/g, ""); // 去頭尾連字號
  if (s === "") return undefined;
  if (!s.startsWith("tuq-")) s = `tuq-${s}`;
  return s;
}

export const AgentTeamCreateMemberSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  displayName: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  roleInTeam: z.enum(["researcher", "doer", "verifier", "shared"]).default("doer"),
  model: z.string().min(1).optional(),
  summary: z.string().min(1).optional(),
  responsibilities: z.array(z.string().min(1)).default([]),
});
export type AgentTeamCreateMember = z.infer<typeof AgentTeamCreateMemberSchema>;

export const AgentTeamCreateSpecSchema = z.object({
  teamId: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*$/),
  teamName: z.string().min(1),
  // preprocess 先正規化（補 tuq- 前綴、清非法字元），regex 作為最後防線；
  // 比照 roleInTeam/platforms 寬鬆策略，避免 AI 給 "sw-engineering" 之類值就建隊失敗。
  skillName: z.preprocess(
    normalizeSkillName,
    z
      .string()
      .regex(/^tuq-[a-z0-9][a-z0-9-]*$/)
      .optional(),
  ),
  platforms: z
    .array(AgentTeamPlatformSchema)
    .default(["claude", "codex", "antigravity"]),
  manager: z
    .object({
      displayName: z.string().min(1).optional(),
      title: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      summary: z.string().min(1).optional(),
      responsibilities: z.array(z.string().min(1)).default([]),
    })
    .default({}),
  members: z.array(AgentTeamCreateMemberSchema).default([]),
  // 指定目標來源 TeamSource.id；省略 = 沿用 default 來源（建團隊落該來源資料夾）
  sourceId: z.string().optional(),
});
export type AgentTeamCreateSpecInput = z.input<typeof AgentTeamCreateSpecSchema>;
export type AgentTeamCreateSpec = z.infer<typeof AgentTeamCreateSpecSchema>;

export interface AgentTeamCreateResult {
  teamId: string;
  skillName: string;
  filesCreated: string[];
  filesSkipped: string[];
  registryRows: AgentRegistryCreatedRow[];
  sync: import("./teamRegistry").RegisterTeamResult;
}

export interface AgentRegistryCreatedRow {
  agentId: string;
  displayName: string | null;
  title: string | null;
  teamId: string | null;
  skillName: string | null;
}

// ---------------------------------------------------------------------------
// Introduction 草稿（agentteams-edit-flow §4、§6.1）
// ---------------------------------------------------------------------------

/**
 * AgentIntroductionSchema — AgentIntroduction 的 zod 對應（全欄位 optional，
 * passthrough 容忍未列欄位；draft 內容驗證用）。
 */
export const AgentIntroductionSchema = z
  .object({
    id: z.string().optional(),
    display_name: z.string().optional(),
    team: z.string().optional(),
    role: z.string().optional(),
    summary: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    when_to_use: z.string().optional(),
    not_for: z.string().optional(),
    reports_to: z.string().optional(),
    manages: z.array(z.string()).optional(),
    callable_by: z.array(z.string()).optional(),
    inputs: z.string().optional(),
    outputs: z.string().optional(),
    workflows: z
      .array(z.object({ scenario: z.string(), steps: z.array(z.string()) }))
      .optional(),
    examples: z.array(z.string()).optional(),
    flags: z.array(z.string()).optional(),
    last_updated: z.string().optional(),
  })
  .passthrough();

/**
 * agentOrg:saveDraft — 寫入 introduction.draft.{hostname}.json（hostname 由 main
 * 端 os.hostname() 取得並做檔名安全化；renderer 不傳）。
 * baseHash 省略時由 main 端以目前 introduction.json 內容計算 sha256。
 */
export const AgentOrgSaveDraftSchema = z.object({
  teamId: z.string().min(1),
  agentName: z.string().min(1),
  draft: AgentIntroductionSchema,
  baseHash: z.string().optional(),
});
export type AgentOrgSaveDraftPayload = z.infer<typeof AgentOrgSaveDraftSchema>;

/** agentOrg:getDraft — 讀本機 hostname 的草稿（含上游衝突偵測結果）。 */
export const AgentOrgGetDraftSchema = z.object({
  teamId: z.string().min(1),
  agentName: z.string().min(1),
});
export type AgentOrgGetDraftPayload = z.infer<typeof AgentOrgGetDraftSchema>;

/** agentOrg:clearDraft — 刪除本機 hostname 的草稿檔（不存在視為成功）。 */
export const AgentOrgClearDraftSchema = z.object({
  teamId: z.string().min(1),
  agentName: z.string().min(1),
});
export type AgentOrgClearDraftPayload = z.infer<typeof AgentOrgClearDraftSchema>;

/**
 * agentOrg:backupIntroduction — 套用前備份 introduction.json → introduction.backup.json。
 * 由 renderer handleConfirmApply 非阻塞呼叫；失敗不擋套用流程。
 */
export const AgentOrgBackupIntroSchema = z.object({
  teamId: z.string().min(1),
  agentName: z.string().min(1),
});
export type AgentOrgBackupIntroPayload = z.infer<typeof AgentOrgBackupIntroSchema>;

/** 草稿檔 _meta 區塊（main 端寫入；UI 不得顯示 hash/hostname — Persona Gate S1）。 */
export interface IntroductionDraftMeta {
  /** 草稿建立時 introduction.json 原文的 sha256（上游衝突偵測用）。 */
  _base_hash: string;
  /** 草稿建立時間（ISO 字串）。 */
  _created_at: string;
  /** 建立草稿的機器 hostname（多機 Google Drive 同步隔離用）。 */
  _hostname: string;
}

/** 草稿物件 — AgentIntroduction + _meta（檔案實際內容形狀）。 */
export interface AgentIntroductionDraft extends AgentIntroduction {
  _meta?: IntroductionDraftMeta;
}

/**
 * agentOrg:getDraft 回傳形狀（IpcResult<AgentOrgDraftResult>）。
 * conflict = 草稿 _base_hash ≠ sha256(目前 introduction.json 內容)。
 */
export interface AgentOrgDraftResult {
  /** 本機 hostname 的草稿（無草稿或 parse 失敗 → null）。 */
  draft: AgentIntroductionDraft | null;
  /** 上游衝突：原始 introduction.json 在草稿建立後被改過。 */
  conflict: boolean;
}

/**
 * AgentDetailDto — agentOrg:getDetail 回傳（IpcResult<AgentDetailDto>）。
 * 含 workflow.yaml 原文 + soul.md 完整原文（找不到則 null）。
 * soulExcerpt：欄位名沿用，但現在回傳完整 soul.md markdown（renderer 渲染成 HTML）。
 * introduction：introduction.json 結構化白話介紹（讀不到則 null）。
 */
export interface AgentDetailDto extends AgentNodeDto {
  workflowYaml: string | null;
  soulExcerpt: string | null;
  introduction: AgentIntroduction | null;
}

/**
 * agentOrg:draftUpdated push payload（fs.watch 偵測到草稿檔變動後 main 推播）。
 * draft = null 表示此次讀取無效（JSON 壞掉）；UI 應保留上一個有效版本。
 */
export interface AgentOrgDraftUpdatedPayload {
  teamId: string;
  agentName: string;
  draft: AgentIntroduction | null;
}
