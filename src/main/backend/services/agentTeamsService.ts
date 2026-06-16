/**
 * backend/services/agentTeamsService.ts — AgentOrg 掃描 + CLI 偵測 + Team Registry
 * delegate service（backend.ts 拆分計畫 Batch 7；行為保留 move-only）。
 *
 * 自 backend.ts 機械搬入：
 *   - Y 區（agent-teams-view-impl-20260607）：static AGENT_ORG_ROOT_DEFAULT /
 *     SETTINGS_KEY_AGENT_ORG_ROOT + _resolveAgentOrgRoot / getAgentOrgRoot /
 *     setAgentOrgRoot / scanAgentOrg / getAgentOrgDetail
 *   - Z 區：CLI 偵測（cli-backend-settings-20260608）detectClis / verifyCliLogin /
 *     getCliInstallPlan / getCliLoginPlan + Team Registry（team-registration-20260608）
 *     registerTeam / unregisterTeam / syncTeam
 *
 * 類名取 AgentTeamsService（非 AgentOrgService）以避免與既有
 * `services/agentOrgService.ts`（scanAgentOrg/getAgentDetail 函式服務）撞名（R8）。
 *
 * 葉節點 service（§3.4 依賴矩陣：只讀 appSettings root）：建構注入 AppSettingsService
 * **同一**實例（R4：lazy 單例不可重複建），getAppSetting/setAppSetting 呼叫鏈與原
 * Backend.getAppSetting/setAppSetting 委派完全等價。
 *
 * static AGENT_ORG_ROOT_DEFAULT 已 Grep 確認無外部讀 Backend.AGENT_ORG_ROOT_DEFAULT
 * → 整個移入本 service，Backend 不再曝露該 static（計畫 Batch 7 註記）。
 */

import type {
  CliId,
  CliStatusDto,
  CliVerifyResult,
  CliPlanDto,
  AgentRegistryItemDto,
  CliLoginSignature,
  TeamSource,
} from "../../../shared/ipcContracts";
import { makeTeamKey, teamPathPart } from "../../../shared/ipcContracts";
import {
  parseTeamSources,
  synthDefaultSource,
  sourceRootForTeam,
  makeSourceId,
  DEFAULT_SOURCE_ID,
} from "./agentTeamSources";
import { scanAgentOrg, getAgentDetail, isQuickCreatedTeam } from "../../services/agentOrgService";
import { builtinAgentOpsAgentsRoot } from "../../services/agentOrgSeedService";
import type { AgentDetail } from "../../services/agentOrgService";
// scan/merge 回傳走 DTO（含必填 sourceId），與 IPC 契約一致；
// 純掃描函式 scanAgentOrg(source.path) 回傳內部 tree，由 wrapper 逐隊補上 sourceId。
import type {
  AgentOrgTree,
  AgentTeamDto,
} from "../../../shared/ipcContracts";
import type { SqliteTaskRepository } from "../../repo/sqliteTaskRepository";
import type { AgentRegistryRow } from "../../repo/sqlite/agentRegistryOps";
import {
  saveDraft as saveDraftSvc,
  getDraft as getDraftSvc,
  clearDraft as clearDraftSvc,
  backupIntroduction as backupIntroductionSvc,
} from "../../services/introductionDraftStore";
import {
  detectAll as detectAllClis,
  verifyLogin as verifyCliLoginSvc,
  getInstallPlan as getCliInstallPlanSvc,
  getLoginPlan as getCliLoginPlanSvc,
  loginSignature as cliLoginSignatureSvc,
} from "../../services/cliBackendService";
import {
  registerTeam as registerTeamSvc,
  unregisterTeam as unregisterTeamSvc,
  syncTeam as syncTeamSvc,
  resolveEntrySkill,
  buildTeamSkillNameMap,
  inspectTeamPlatformsBySkill,
} from "../../services/teamRegistrationService";
import { relocateTeam as relocateTeamSvc } from "../../services/teamRelocationService";
import {
  createAgentTeamFiles,
  createEntrySkillFile,
} from "../../services/agentTeamCreateService";
import type { AppSettingsService } from "./appSettingsService";

export class AgentTeamsService {
  /**
   * AgentOrg 根目錄預設常數（Google Drive 掛載磁碟；Node fs 可直讀）。
   * 用戶可透過 agentOrg:setRoot 覆寫（存入 app_settings(key='agentOrgRootPath')）。
   */
  static readonly AGENT_ORG_ROOT_DEFAULT =
    "T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents";

  /** app_settings key — AgentOrg 根目錄用戶自訂路徑。 */
  private static readonly SETTINGS_KEY_AGENT_ORG_ROOT = "agentOrgRootPath";

  /**
   * app_settings key — 多來源團隊來源清單（docs/multi-source-teams.md Phase 1）。
   * 值形狀 = `TeamSourcesConfig`（`{ version:1, sources: TeamSource[] }`）。
   * 不存在時由 `_resolveAgentOrgSources()` 從既有 `agentOrgRootPath` 自動合成單一 default 來源。
   */
  private static readonly SETTINGS_KEY_AGENT_TEAM_SOURCES = "agentTeamSources";

  constructor(
    private readonly _appSettings: AppSettingsService,
    private readonly _repo: SqliteTaskRepository,
  ) {}

  /**
   * 取當前生效的 AgentOrg 根路徑：
   *   app_settings(key='agentOrgRootPath').path（若有且非空）→ fallback 預設常數。
   */
  private _resolveAgentOrgRoot(): string {
    try {
      const setting = this._appSettings.getAppSetting(
        AgentTeamsService.SETTINGS_KEY_AGENT_ORG_ROOT,
      );
      const customPath =
        typeof setting?.["path"] === "string" ? setting["path"] : "";
      if (customPath.trim()) return customPath.trim();
    } catch {
      /* fallback */
    }
    return AgentTeamsService.AGENT_ORG_ROOT_DEFAULT;
  }

  /**
   * 解析當前生效的「團隊來源清單」（docs/multi-source-teams.md Phase 1）。
   *
   * 來源優先序：
   *   1. app_settings(key='agentTeamSources') 存在且含合法 `sources[]` → 直接用（多來源）。
   *   2. 不存在 / 格式不符 / 空清單 → 從既有 `_resolveAgentOrgRoot()`（agentOrgRootPath）
   *      合成單一 default 來源 `{ id:'default', label:'預設', path:<root>, kind:'gdrive-shared' }`。
   *
   * **向後相容鐵則**：只有 1 個 default 來源時，行為與現況逐字一致——
   * 即多數機器（未設 agentTeamSources）永遠走 case 2，回傳「單一 default 來源」，
   * 其 path === `_resolveAgentOrgRoot()`，掃描/路徑解析與單根時代完全等價。
   *
   * 全面容錯：讀設定/解析任何失敗 → fallback 合成 default 來源（永不 throw）。
   */
  private _resolveAgentOrgSources(): TeamSource[] {
    try {
      const raw = this._appSettings.getAppSetting(
        AgentTeamsService.SETTINGS_KEY_AGENT_TEAM_SOURCES,
      );
      const parsed = parseTeamSources(raw);
      if (parsed) return parsed;
    } catch {
      /* fallback 合成 default */
    }
    // fallback：從既有 agentOrgRootPath 合成單一 default 來源（向後相容）
    return [synthDefaultSource(this._resolveAgentOrgRoot())];
  }

  /**
   * 取某團隊所屬「來源根」（agents 根路徑）。
   *
   * teamId 規則（為 Phase 3 複合鍵預留；Phase 1 永遠回 default 來源根）：
   *   - 含 `::`（複合鍵 `sourceId::teamId`）→ 切出 sourceId 查對應來源 path。
   *     查無該來源 → fallback default 來源根。
   *   - 不含 `::`（裸 teamId）→ 回 default 來源根。
   *
   * **向後相容鐵則**：裸 teamId（或 undefined）永遠回 default 來源根
   *   （單來源時 === `_resolveAgentOrgRoot()`）。
   */
  private _sourceRootForTeam(teamId: string | undefined): string {
    // agent-ops 特例：內建團隊一律從 .teamuq 落地版解析（D1 helper 為單一真相），
    // 使三平台 skill 同步與詳情/openTeamFolder 全鏈指向 .teamuq，不再因公司機 T: 可達而漂移。
    // 裸鍵 `agent-ops` 與任何 `x::agent-ops` 複合鍵都命中（用既有 teamPathPart helper 取 team 部分）。
    if (teamId !== undefined && this._teamPathPart(teamId) === "agent-ops") {
      return builtinAgentOpsAgentsRoot();
    }
    return sourceRootForTeam(
      this._resolveAgentOrgSources(),
      teamId,
      this._resolveAgentOrgRoot(),
    );
  }

  /**
   * 取某團隊的「路徑部分」（複合鍵 `sourceId::teamId` 去掉 `sourceId::` 前綴；裸 teamId 原樣）。
   * 所有「來源根 + 團隊路徑」推導都必須用此值（而非系統鍵），否則路徑會帶 `sourceId::` 前綴。
   */
  private _teamPathPart(teamId: string): string {
    return teamPathPart(teamId);
  }

  /**
   * 公開：取某團隊「來源根」（agents 根）。供 IPC handler（openTeamFolder 等）推團隊資料夾路徑。
   * 多來源：按 teamId 複合鍵歸屬解析；單一 default 來源 + 裸 teamId 時 === getAgentOrgRoot().path。
   */
  resolveTeamSourceRoot(teamId: string): string {
    return this._sourceRootForTeam(teamId);
  }

  // --------------------------------------------------------------------------
  // 多來源團隊 — 來源清單 CRUD（docs/multi-source-teams.md Phase 2）
  // --------------------------------------------------------------------------

  /**
   * 把來源清單持久化到 app_settings(key='agentTeamSources')，形狀＝`TeamSourcesConfig`。
   * 不可變 helper：呼叫端傳「完整新清單」，這裡只負責寫入（version 固定 1）。
   */
  private _persistSources(sources: TeamSource[]): void {
    this._appSettings.setAppSetting(
      AgentTeamsService.SETTINGS_KEY_AGENT_TEAM_SOURCES,
      { version: 1, sources },
    );
  }

  /** 驗證路徑存在（agents 根）；不存在拋 Error（router 包成 err()）。 */
  private async _assertPathExists(p: string): Promise<void> {
    const trimmed = p.trim();
    if (!trimmed) throw new Error("路徑不可為空");
    try {
      const { promises: fsPromises } = await import("node:fs");
      await fsPromises.access(trimmed);
    } catch {
      throw new Error(`路徑不存在或無法存取：${trimmed}`);
    }
  }

  /**
   * agentOrg:listSources — 回傳當前生效的來源清單（含 fallback 合成的 default 來源）。
   * 多數機器（未設 agentTeamSources）回傳「單一 default 來源」，path === getAgentOrgRoot().path。
   */
  listSources(): TeamSource[] {
    return this._resolveAgentOrgSources();
  }

  /**
   * agentOrg:addSource — 驗證 path 存在後 append（自動產 id）。
   * 若目前仍是 fallback 合成的 default 來源（尚未持久化），會把它一併寫入，
   * 確保新增來源後 default 仍在清單內（不丟失）。
   */
  async addSource(input: {
    label: string;
    path: string;
    kind?: TeamSource["kind"];
  }): Promise<TeamSource[]> {
    await this._assertPathExists(input.path);
    const current = this._resolveAgentOrgSources();
    const id = makeSourceId(input.label, current);
    const newSource: TeamSource = {
      id,
      label: input.label.trim(),
      path: input.path.trim(),
      kind: input.kind ?? "other",
    };
    const next = [...current, newSource];
    this._persistSources(next);
    return next;
  }

  /**
   * agentOrg:removeSource — 移除指定 id 來源。
   * 守門：不可移除最後一個來源（至少留一個）；找不到 id 視為已移除（冪等）。
   */
  removeSource(id: string): TeamSource[] {
    const current = this._resolveAgentOrgSources();
    if (current.length <= 1) {
      throw new Error("至少要保留一個團隊來源，無法移除最後一個。");
    }
    const next = current.filter((s) => s.id !== id);
    // 找不到 id（next 長度未變）→ 冪等，仍回現況；但若會把全部移光則上面已擋。
    this._persistSources(next.length > 0 ? next : current);
    return next.length > 0 ? next : current;
  }

  /**
   * agentOrg:updateSource — 修改既有來源的 label / path（皆選填）。
   * 改 path 時驗證新路徑存在；找不到 id 拋 Error。
   */
  async updateSource(input: {
    id: string;
    label?: string;
    path?: string;
  }): Promise<TeamSource[]> {
    const current = this._resolveAgentOrgSources();
    const idx = current.findIndex((s) => s.id === input.id);
    if (idx < 0) {
      throw new Error(`找不到這個來源（id=${input.id}）。`);
    }
    const newPath = input.path?.trim();
    if (newPath) await this._assertPathExists(newPath);
    const newLabel = input.label?.trim();
    const next = current.map((s, i) =>
      i === idx
        ? {
            ...s,
            ...(newLabel ? { label: newLabel } : {}),
            ...(newPath ? { path: newPath } : {}),
          }
        : s,
    );
    this._persistSources(next);
    return next;
  }

  /** agentOrg:getRoot — 回傳當前根路徑 + 是否為自訂 + 預設常數。 */
  getAgentOrgRoot(): import("../../../shared/ipcContracts").AgentOrgRootInfo {
    const defaultPath = AgentTeamsService.AGENT_ORG_ROOT_DEFAULT;
    try {
      const setting = this._appSettings.getAppSetting(
        AgentTeamsService.SETTINGS_KEY_AGENT_ORG_ROOT,
      );
      const customPath =
        typeof setting?.["path"] === "string" ? setting["path"].trim() : "";
      if (customPath) {
        return { path: customPath, isCustom: true, defaultPath };
      }
    } catch {
      /* fallback */
    }
    return { path: defaultPath, isCustom: false, defaultPath };
  }

  /**
   * agentOrg:setRoot — 驗證路徑存在後儲存；路徑不存在拋 Error（router 回 err()）。
   * 傳空字串 = 清除自訂（回 fallback 常數）。
   */
  async setAgentOrgRoot(newPath: string): Promise<void> {
    const trimmed = newPath.trim();
    if (!trimmed) {
      // 清除自訂
      this._appSettings.setAppSetting(
        AgentTeamsService.SETTINGS_KEY_AGENT_ORG_ROOT,
        { path: "" },
      );
      return;
    }
    // 驗證路徑存在（access 失敗 → 拋 Error，router 回 err()）
    try {
      const { promises: fsPromises } = await import("node:fs");
      await fsPromises.access(trimmed);
    } catch {
      throw new Error(`路徑不存在或無法存取：${trimmed}`);
    }
    this._appSettings.setAppSetting(
      AgentTeamsService.SETTINGS_KEY_AGENT_ORG_ROOT,
      { path: trimmed },
    );
  }

  /**
   * agentOrg:scan — 多來源掃描：迭代 `_resolveAgentOrgSources()`，每個來源各呼純函式
   * `scanAgentOrg(source.path)`，把每隊標上 `sourceId`+`sourceLabel`，合併成單一清單
   * （parseWarnings 亦合併）。再對合併樹計算 standardized/enabled/platforms。
   *
   * **向後相容鐵則**：只有 1 個 default 來源時（多數機器），此迴圈只跑一圈、source.path
   *   === `_resolveAgentOrgRoot()`，每隊 sourceId='default'，行為與單根時代逐字一致。
   *
   * 容錯：某來源根不可讀（Drive 未掛載等）→ 該來源 scanAgentOrg 拋錯。
   *   - **多來源**：逐來源 catch，把該來源的警告（`<sourceId>: <message>`）併入 parseWarnings，
   *     不阻斷其他來源（一個 Drive 沒掛載不該讓整頁掛掉）。
   *   - **單一來源（含 default 單來源的現況）**：保留舊行為——直接 rethrow，由 IPC handler 包成
   *     `err()`，UI 顯示錯誤提示（向後相容「逐字一致」：舊版單根不可讀即整體 throw）。
   *
   * #7（flag-based）：scan 樹本身為純 fs，不帶 standardized 欄；wrapper 計算
   *   AgentTeamDto.standardized（= 是否已規格化）。只有「快速建立（manager introduction.json 帶
   *   `teamuq_agent_team_ui` flag）且 DB 未顯式標記」的團隊才回 false（左欄顯示「待優化」徽章）。
   */
  async scanAgentOrg(): Promise<AgentOrgTree> {
    const sources = this._resolveAgentOrgSources();
    const mergedTeams: AgentTeamDto[] = [];
    const mergedWarnings: string[] = [];

    for (const source of sources) {
      try {
        const tree = await scanAgentOrg(source.path);
        for (const team of tree.teams) {
          // Phase 3 複合鍵：純掃描函式回傳裸 teamId（== 資料夾路徑）；非預設來源在此包成
          // `${sourceId}::${teamId}`，default 來源維持裸 teamId（零遷移、撞名由 `::` 區分）。
          // team.id 內可能含 '/'（子團隊）；makeTeamKey 只加前綴不動 teamId 內的 '/'。
          const teamKey = makeTeamKey(source.id, team.id);
          // node.id 由純掃描以裸 `${teamId}/${name}` 組成；非預設來源須同步換成
          // `${sourceKey}/${name}`（= `${sourceId}::${teamId}/${name}`），與 team.id 一致，
          // 否則 registry agent_id（=`${team_id}/manager`）對不上 _mergeStandardized 的 override 查詢。
          // default 來源（teamKey === team.id）下 rekey 為 no-op（保持逐字一致）。
          const rekeyNode = <N extends { id: string; name: string }>(node: N): N =>
            teamKey === team.id ? node : { ...node, id: `${teamKey}/${node.name}` };
          mergedTeams.push({
            ...team,
            id: teamKey,
            manager: team.manager ? rekeyNode(team.manager) : null,
            agents: team.agents.map(rekeyNode),
            sourceId: source.id,
            sourceLabel: source.label,
          });
        }
        if (tree.parseWarnings) mergedWarnings.push(...tree.parseWarnings);
      } catch (e) {
        // 單一來源（含 default 單來源現況）：保留舊行為，直接 rethrow → IPC handler 包 err()。
        if (sources.length === 1) throw e;
        // 多來源：該來源根不可讀 → 降級為警告，不阻斷其他來源。
        const msg = e instanceof Error ? e.message : String(e);
        mergedWarnings.push(`${source.id}: ${msg}`);
      }
    }

    // agent-ops 去重：單獨掃 .teamuq 落地根，用其 agent-ops 版覆蓋任何來源（含公司機 T:）掃到的
    // agent-ops，確保列表恰一筆且資料/操作落點都對齊改動 1 的 .teamuq 解析（消除「列表 T:、操作 .teamuq」錯位）。
    // 防禦：.teamuq 掃不到 agent-ops（理論上 D1 已保證存在）→ 不覆蓋、維持原列表，不丟例外。
    try {
      const builtinRoot = builtinAgentOpsAgentsRoot();
      const builtinTree = await scanAgentOrg(builtinRoot);
      const builtinAgentOps = builtinTree.teams.find(
        (team) => teamPathPart(team.id) === "agent-ops",
      );
      if (builtinAgentOps) {
        // 沿用 default 來源的 sourceId（makeTeamKey 對 default 不加前綴 → 裸 `agent-ops` 系統鍵，
        // 與改動 1 命中一致；sourceId 一致避免 badge/registry 誤判）。label 維持 default 顯示名。
        const defaultSource =
          sources.find((s) => s.id === DEFAULT_SOURCE_ID) ?? sources[0];
        const dedupedTeams = mergedTeams.filter(
          (team) => teamPathPart(team.id) !== "agent-ops",
        );
        dedupedTeams.push({
          ...builtinAgentOps,
          id: makeTeamKey(DEFAULT_SOURCE_ID, builtinAgentOps.id),
          sourceId: DEFAULT_SOURCE_ID,
          sourceLabel: defaultSource?.label ?? "預設",
        });
        mergedTeams.length = 0;
        mergedTeams.push(...dedupedTeams);
      }
    } catch {
      // .teamuq 根不可讀 / 掃描失敗 → 不覆蓋，維持原列表（防殘缺，不阻斷整頁）。
    }

    const merged: AgentOrgTree = {
      teams: mergedTeams,
      parseWarnings: mergedWarnings.length > 0 ? mergedWarnings : undefined,
    };
    return this._mergeStandardized(merged);
  }

  /**
   * 計算每個 team 的 standardized + enabled + platforms（帶到前端的值）。同一份 registry 讀取，避免兩次查詢。
   *
   * platforms — 三平台 skill 實際註冊狀態（檔案/junction 存在）：
   *   先 buildTeamSkillNameMap(agentOrgRoot, teamIds) 掃一次 skills 目錄建 teamId→skillName 映射
   *   （readdir 1 次 + 每個 SKILL.md 讀 1 次），再對每隊 inspectTeamPlatformsBySkill(skillName)
   *   逐平台 fs.access。藉此把 fs I/O 從 N×M（每隊各自 readdir + readFile）降到 1×M + N×3。
   *   全面容錯，反查 null 或任何錯誤皆回三平台 false，不阻斷掃描。
   *   agentOrgRoot = 該隊來源根（`_sourceRootForTeam(team.id)`）去尾段 /agents
   *   （對齊 registerTeam / upsertRegistryFromScan 的處理）。多來源：逐來源根分組各掃一次 skills 目錄。
   *
   * standardized — flag-based 判定：
   *   1. DB **顯式** standardized=1（未來的 override；正規 agent-ops 流程跑完後標 1）→ true（已規格化、不顯徽章）。
   *   2. 否則看 manager introduction.json `flags`：
   *      - 含 `teamuq_agent_team_ui`（快速建立）→ false（待優化、顯徽章）。
   *      - 無此 flag（手寫團隊）→ true（不顯徽章）。
   *   DB 欄位語意：default 0 不再代表「待優化」，僅 `1` 被當作顯式 override；其餘一律以 flag 為主。
   *   如此「存量列補 0」不會把手寫團隊誤判為待優化。
   *
   * enabled — 上線真相來源（持久化）：
   *   讀該 team manager 列（`${teamId}/manager`）的 enabled 欄。有列 → 1 對應 true、0 對應 false；
   *   無 registry 列 → undefined（UI 端預設視為 true，與 registry enabled INSERT default=1 一致）。
   *
   * DB 讀失敗不阻斷掃描（standardized 視為無 override 純走 flag；enabled 全 undefined）。
   */
  private async _mergeStandardized(tree: AgentOrgTree): Promise<AgentOrgTree> {
    // DB override：只認顯式 standardized=1 的 manager 列。
    // enabledByTeam：同一份 registry 讀取，記下每隊 manager 列的 enabled（1→true / 0→false）。
    let overrideTeams: Set<string>;
    const enabledByTeam = new Map<string, boolean>();
    try {
      const rows = this._repo.getAgentRegistry();
      const managerRows = rows.filter(
        (r) =>
          typeof r.team_id === "string" &&
          r.agent_id === `${r.team_id}/manager`,
      );
      overrideTeams = new Set(
        managerRows
          .filter((r) => r.standardized === 1)
          .map((r) => r.team_id as string),
      );
      for (const r of managerRows) {
        enabledByTeam.set(r.team_id as string, r.enabled === 1);
      }
    } catch {
      overrideTeams = new Set(); // DB 不可讀：無 override，純走 flag；enabled 全 undefined
    }

    // 多來源：每隊用其「所屬來源根」（`_sourceRootForTeam(team.id)`）推路徑，非單一全域 root。
    // 先把該隊來源根去尾段 /agents 得 agentOrgRoot（buildTeamSkillNameMap / inspect 期望此形）。
    // pathPartByTeam：複合鍵 → 純團隊路徑（去 `sourceId::` 前綴）；所有 fs 路徑/needle 都用它，
    //   只在 Map key 與最終 DTO 回傳處沿用系統鍵 team.id（撞名由 `::` 區分）。
    const sourceRootByTeam = new Map<string, string>();
    const agentOrgRootByTeam = new Map<string, string>();
    const pathPartByTeam = new Map<string, string>();
    for (const team of tree.teams) {
      const sRoot = this._sourceRootForTeam(team.id);
      sourceRootByTeam.set(team.id, sRoot);
      agentOrgRootByTeam.set(team.id, sRoot.replace(/[/\\]agents[/\\]?$/, ""));
      pathPartByTeam.set(team.id, this._teamPathPart(team.id));
    }

    // 效能：把同一 agentOrgRoot 的團隊分組，各組「掃一次 skills 目錄」建 teamId→skillName 映射
    // （readdir 1 次 + 每個 SKILL.md 讀 1 次）。單一 default 來源時只有一組 → 與單根時代等價 I/O。
    // buildTeamSkillNameMap 吃「純團隊路徑」needle；故傳 pathPart，回來以 pathPart 反查回系統鍵
    // 存進 skillNameByTeam（key 一律系統鍵 team.id）。groupByAor: aor → [{ key, pathPart }]。
    const groupByAor = new Map<string, { key: string; pathPart: string }[]>();
    for (const team of tree.teams) {
      const aor = agentOrgRootByTeam.get(team.id) as string;
      const list = groupByAor.get(aor) ?? [];
      list.push({ key: team.id, pathPart: pathPartByTeam.get(team.id) as string });
      groupByAor.set(aor, list);
    }
    const skillNameByTeam = new Map<string, string | null>();
    for (const [aor, items] of groupByAor) {
      const map = await buildTeamSkillNameMap(aor, items.map((i) => i.pathPart));
      for (const { key, pathPart } of items) {
        skillNameByTeam.set(key, map.get(pathPart) ?? null);
      }
    }

    const teams = await Promise.all(
      tree.teams.map(async (team) => {
        // enabled：有 manager registry 列 → 該值；無列 → undefined（UI 預設 true）。
        const enabled = enabledByTeam.has(team.id)
          ? enabledByTeam.get(team.id)
          : undefined;
        // platforms：三平台 skill 實際存在狀態（用已掃好的 skillName 對三平台 fs.access；
        // skillName null/任何錯誤 → 三平台 false）。
        const skillName = skillNameByTeam.get(team.id) ?? null;
        const platforms = await inspectTeamPlatformsBySkill(skillName);
        // hasEntrySkill（Phase 4）：該隊「在自己所屬來源」有沒有可反查的入口 skill。
        // skillNameByTeam 已是逐來源 buildTeamSkillNameMap 的反查結果（resolveEntrySkill 等價）；
        // 非 null 即代表有入口 skill。無入口 skill 時 UI 改顯示「建立入口指令」按鈕。
        const hasEntrySkill = skillName !== null;
        if (overrideTeams.has(team.id)) {
          // 顯式已規格化 → 不顯徽章
          return { ...team, standardized: true, enabled, platforms, hasEntrySkill };
        }
        // isQuickCreatedTeam 讀該隊 manager introduction.json → 用「該隊來源根」+ 純團隊路徑。
        const quickCreated = await isQuickCreatedTeam(
          sourceRootByTeam.get(team.id) as string,
          pathPartByTeam.get(team.id) as string,
        );
        // 快速建立 → false（待優化、顯徽章）；手寫 → true（不顯徽章）
        return { ...team, standardized: !quickCreated, enabled, platforms, hasEntrySkill };
      }),
    );

    return { ...tree, teams };
  }

  /** agentOrg:getDetail — 回傳單一 agent 詳細資料（async IO；含 worklogCount）。 */
  async getAgentOrgDetail(
    payload: import("../../../shared/ipcContracts").AgentOrgGetDetailPayload,
  ): Promise<AgentDetail | null> {
    // 路徑解析用「純團隊路徑」（複合鍵去 `sourceId::` 前綴）；來源根則按系統鍵歸屬。
    return getAgentDetail(
      this._sourceRootForTeam(payload.teamId),
      this._teamPathPart(payload.teamId),
      payload.agentName,
    );
  }

  // --------------------------------------------------------------------------
  // Introduction 草稿 — draft→diff→apply 後端鏈（agentteams-edit-flow §4、§6）
  // --------------------------------------------------------------------------

  /** agentOrg:saveDraft — 寫 introduction.draft.{hostname}.json（含 _meta._base_hash）。 */
  async saveIntroductionDraft(
    payload: import("../../../shared/ipcContracts").AgentOrgSaveDraftPayload,
  ): Promise<void> {
    // 路徑解析用「純團隊路徑」（複合鍵去 `sourceId::` 前綴）。
    return saveDraftSvc(
      this._sourceRootForTeam(payload.teamId),
      this._teamPathPart(payload.teamId),
      payload.agentName,
      payload.draft,
      payload.baseHash,
    );
  }

  /** agentOrg:getDraft — 讀本機 hostname 草稿（含上游衝突偵測）。 */
  async getIntroductionDraft(
    payload: import("../../../shared/ipcContracts").AgentOrgGetDraftPayload,
  ): Promise<import("../../../shared/ipcContracts").AgentOrgDraftResult> {
    return getDraftSvc(
      this._sourceRootForTeam(payload.teamId),
      this._teamPathPart(payload.teamId),
      payload.agentName,
    );
  }

  /** agentOrg:clearDraft — 刪除本機 hostname 草稿檔（冪等）。 */
  async clearIntroductionDraft(
    payload: import("../../../shared/ipcContracts").AgentOrgClearDraftPayload,
  ): Promise<void> {
    return clearDraftSvc(
      this._sourceRootForTeam(payload.teamId),
      this._teamPathPart(payload.teamId),
      payload.agentName,
    );
  }

  /** 套用前備份 introduction.json → introduction.backup.json（M7；apply chain 用，無 IPC）。 */
  async backupIntroduction(teamId: string, agentName: string): Promise<void> {
    return backupIntroductionSvc(
      this._sourceRootForTeam(teamId),
      this._teamPathPart(teamId),
      agentName,
    );
  }

  // --------------------------------------------------------------------------
  // CLI backend — CLI 安裝狀態偵測與登入驗證（cli-backend-settings-20260608）
  // --------------------------------------------------------------------------

  async detectClis(): Promise<CliStatusDto[]> { return detectAllClis(); }
  async verifyCliLogin(id: CliId): Promise<CliVerifyResult> { return verifyCliLoginSvc(id); }
  async getCliInstallPlan(id: CliId): Promise<CliPlanDto> { return getCliInstallPlanSvc(id); }
  async getCliLoginPlan(id: CliId): Promise<CliPlanDto> { return getCliLoginPlanSvc(id); }
  async cliLoginSignature(id: CliId): Promise<CliLoginSignature> { return cliLoginSignatureSvc(id); }

  // --------------------------------------------------------------------------
  // Team Registry — 團隊 claude skill 連結（team-registration-20260608）
  // --------------------------------------------------------------------------

  /** teamRegistry:register — 把 team 入口 skill junction 連結到 ~/.claude/skills。
   *  下游用「純團隊路徑」（複合鍵去前綴）推檔案；回傳沿用呼叫端系統鍵 teamId（撞名穩定）。 */
  async registerTeam(
    payload: import("../../../shared/ipcContracts").RegisterTeamPayload,
  ): Promise<import("../../../shared/ipcContracts").RegisterTeamResult> {
    const r = await registerTeamSvc(
      this._sourceRootForTeam(payload.teamId),
      this._teamPathPart(payload.teamId),
      payload.platforms,
    );
    return { ...r, teamId: payload.teamId };
  }

  /** teamRegistry:unregister — 移除已連結的 skill junction 與/或 codex 產生物。 */
  async unregisterTeam(
    payload: import("../../../shared/ipcContracts").UnregisterTeamPayload,
  ): Promise<import("../../../shared/ipcContracts").UnregisterTeamResult> {
    // teamId 選填（payload 至少有 teamId 或 skillName 之一）；有才轉純路徑下傳。
    const teamPath =
      payload.teamId !== undefined
        ? this._teamPathPart(payload.teamId)
        : undefined;
    const r = await unregisterTeamSvc(
      this._sourceRootForTeam(payload.teamId),
      { teamId: teamPath, skillName: payload.skillName },
      payload.platforms,
    );
    // 回傳沿用呼叫端系統鍵（下游以純路徑回 teamId；null 代表反查不到 skill，保留 null）。
    return { ...r, teamId: r.teamId === null ? null : (payload.teamId ?? r.teamId) };
  }

  /** teamRegistry:sync — 同步/更新 team 入口 skill（重跑 register 冪等邏輯；預設兩平台都同步）。 */
  async syncTeam(
    payload: import("../../../shared/ipcContracts").RegisterTeamPayload,
  ): Promise<import("../../../shared/ipcContracts").RegisterTeamResult> {
    const r = await syncTeamSvc(
      this._sourceRootForTeam(payload.teamId),
      this._teamPathPart(payload.teamId),
      payload.platforms,
    );
    return { ...r, teamId: payload.teamId };
  }

  /**
   * agentOrg:createTeamFromSpec — 建立新 AI 團隊：
   *   1. 從結構化 spec 產生 AgentOrg manager/worker 檔案與入口 SKILL.md
   *   2. upsert agent_registry（teamuq.db）
   *   3. 同步 Claude/Codex/Antigravity callable skills
   */
  async createTeamFromSpec(
    spec: import("../../../shared/ipcContracts").AgentTeamCreateSpec,
  ): Promise<import("../../../shared/ipcContracts").AgentTeamCreateResult> {
    // 建檔落點：把團隊建到 spec.sourceId 指定的來源根（省略/查無 → fallback default 來源根，
    // 與舊行為 _resolveAgentOrgRoot() 等價）。
    const sources = this._resolveAgentOrgSources();
    const targetRoot =
      (spec.sourceId ? sources.find((s) => s.id === spec.sourceId)?.path : undefined) ??
      this._resolveAgentOrgRoot();
    const fileResult = await createAgentTeamFiles(targetRoot, spec);
    // 系統鍵（複合鍵）：registry / sync 一致使用。default 來源 → makeTeamKey 回裸 fileResult.teamId
    // （與現況逐字相同＝零行為變更）；非預設 → `${sourceId}::${teamId}`。
    const systemKey = makeTeamKey(spec.sourceId ?? DEFAULT_SOURCE_ID, fileResult.teamId);
    const registryRows: import("../../../shared/ipcContracts").AgentRegistryCreatedRow[] = [];

    const manager = spec.manager ?? {};
    const managerRow = this._repo.upsertAgentRegistry({
      agentId: `${systemKey}/manager`,
      displayName: manager.displayName ?? `${spec.teamName}組長`,
      title: manager.title ?? `${spec.teamName} Manager`,
      teamId: systemKey,
      skillName: fileResult.skillName,
      standardized: 0, // 快速建立：不顯式標已規格化（待優化由 introduction.json 的 teamuq_agent_team_ui flag 自然判定）
    });
    registryRows.push(_rowToCreatedDto(managerRow));

    for (const member of spec.members ?? []) {
      const row = this._repo.upsertAgentRegistry({
        agentId: `${systemKey}/${member.name}`,
        displayName: member.displayName ?? member.title ?? member.name,
        title: member.title ?? member.displayName ?? member.name,
        teamId: systemKey,
        skillName: null,
        standardized: 0, // 快速建立：不顯式標已規格化（待優化由 flag 判定）
      });
      registryRows.push(_rowToCreatedDto(row));
    }

    // skill 同步：用 systemKey 解析「來源根」與「純團隊路徑」。
    //   - default 來源 → systemKey === 裸 fileResult.teamId，_sourceRootForTeam 回 default 來源根、
    //     _teamPathPart 回裸 teamId（與舊行為逐字一致）。
    //   - 非預設來源 → _sourceRootForTeam 依複合鍵歸屬到 spec.sourceId 的來源根，
    //     _teamPathPart 去 `sourceId::` 前綴回純團隊路徑，junction target 指向正確來源根。
    const sync = await syncTeamSvc(
      this._sourceRootForTeam(systemKey),
      this._teamPathPart(systemKey),
      spec.platforms,
    );

    return {
      teamId: systemKey,
      skillName: fileResult.skillName,
      filesCreated: fileResult.filesCreated,
      filesSkipped: fileResult.filesSkipped,
      registryRows,
      sync,
    };
  }

  /**
   * agentOrg:createEntrySkill — 為「有團隊、無入口 skill」的團隊建立可攜入口 SKILL.md
   * （docs/multi-source-teams.md Phase 4）。
   *
   * 寫到「該團隊所屬來源根」的 `.claude/skills/<skillName>/SKILL.md`（多來源：複合鍵歸屬），
   * 不覆寫既有檔。teamName 取該隊 manager registry 列的 display_name，無列則用 teamId 末段。
   *
   * 路徑解析：來源根用系統鍵歸屬（`_sourceRootForTeam`）；teamId needle / 末段用「純團隊路徑」
   * （複合鍵去 `sourceId::` 前綴），與 resolveEntrySkill 反查 needle 逐字一致。
   */
  async createEntrySkill(
    payload: import("../../../shared/ipcContracts").AgentOrgCreateEntrySkillPayload,
  ): Promise<import("../../../shared/ipcContracts").AgentOrgCreateEntrySkillResult> {
    const teamPath = this._teamPathPart(payload.teamId);
    // CreateEntrySkillFileResult 與 AgentOrgCreateEntrySkillResult 欄位同形 → 直接回傳。
    return createEntrySkillFile(
      this._sourceRootForTeam(payload.teamId),
      teamPath,
      this._deriveTeamName(payload.teamId, teamPath),
      payload.skillName,
    );
  }

  /**
   * agentOrg:applyGroupSource — 群組級「實體搬移」編排（plan_v2 §2.1）。
   *
   * 對 `payload.teamKeys` 逐一**序列**搬移（搬移是檔案操作，不並行）：
   *   1. teamPath = _teamPathPart(oldKey)
   *   2. agent-ops 硬排除（plan_v2 §0 C5 / §1.3）：系統團隊不可搬移 → 列 ok:false。
   *   3. newKey = makeTeamKey(toSourceId, teamPath)
   *   4. from/toSourceRoot 皆走 _sourceRootForTeam（傳 oldKey / newKey 複合鍵即回對應來源 agents 根，
   *      勿自行 path.join）。
   *   5. displayName 搬移**前**取（registry 仍為 oldKey）。
   *   6. relocateTeam（檔案搬移 + 三平台 skill 重建編排）。
   *   7. 成功才 rekeyAgentRegistryTeam(oldKey, newKey)（DB 系統鍵改寫，plan_v2 §3.1/§3.3）。
   *
   * 範圍界定（plan_v2 §2.1 權衡）：
   *   - GroupConfig.mappings / GroupDef.sourceId 不在 main 端改寫；本方法只回 results，
   *     由 renderer（BM8 applyRelocationResult）拿結果後單一寫入點重建 GroupConfig。
   *   - agent_conv_sessions.team_id（plan_v2 §3.2 可選）本批不做：repo/store 無現成委派方法，
   *     新增 store 方法超出本批 Edit 預算與 BM5 聚焦範圍（見回報 issues）。
   *
   * platforms 預設三平台（plan_v2 §2.3/§2.4/§7.2 描述重建三平台 skill）。
   */
  async applyGroupSource(
    payload: import("../../../shared/ipcContracts").ApplyGroupSourcePayload,
  ): Promise<import("../../../shared/ipcContracts").ApplyGroupSourceResult> {
    const platforms = payload.platforms ?? ["claude", "codex", "antigravity"];
    const results: import("../../../shared/ipcContracts").ApplyGroupSourceResult["results"] =
      [];

    for (const oldKey of payload.teamKeys) {
      const teamPath = this._teamPathPart(oldKey);
      const displayName = this._deriveTeamName(oldKey, teamPath); // 搬移前取（registry 仍 oldKey）

      // agent-ops 硬排除（系統團隊落點寫死 .teamuq，不可搬移）。
      if (teamPath === "agent-ops") {
        results.push({
          oldKey,
          newKey: oldKey,
          ok: false,
          message: "系統團隊不可搬移",
          displayName,
        });
        continue;
      }

      const newKey = makeTeamKey(payload.toSourceId, teamPath);
      const fromSourceRoot = this._sourceRootForTeam(oldKey);
      const toSourceRoot = this._sourceRootForTeam(newKey);

      const r = await relocateTeamSvc({
        teamPath,
        fromSourceRoot,
        toSourceRoot,
        platforms,
      });

      if (r.ok) {
        // DB 系統鍵改寫（agent_registry N 列 rekey）；冪等：newKey===oldKey → no-op。
        this._repo.rekeyAgentRegistryTeam(oldKey, newKey);
      }

      results.push({
        oldKey,
        newKey,
        ok: r.ok,
        message: r.message,
        displayName,
      });
    }

    return { results };
  }

  /**
   * 取某團隊的白話顯示名：優先用該隊 manager registry 列（`${systemKey}/manager`）的
   * display_name；無列 / DB 讀失敗 → fallback 純團隊路徑末段。
   */
  private _deriveTeamName(systemKey: string, teamPath: string): string {
    const fallback = teamPath.split("/").filter(Boolean).at(-1) ?? teamPath;
    try {
      const row = this._repo
        .getAgentRegistry()
        .find((r) => r.agent_id === `${systemKey}/manager`);
      const name = typeof row?.display_name === "string" ? row.display_name.trim() : "";
      return name || fallback;
    } catch {
      return fallback;
    }
  }

  // --------------------------------------------------------------------------
  // Agent Registry — DB 委派 + 掃描批次更新（agentteams-ab-20260611）
  // --------------------------------------------------------------------------

  /** agentRegistry:getAll — 回傳全部列（Dto 陣列）。 */
  getAgentRegistry(): AgentRegistryRow[] {
    return this._repo.getAgentRegistry();
  }

  /** 單筆 upsert（display_name/title/skill_name 可更新；enabled/remark 不覆寫）。 */
  upsertAgentRegistry(
    input: import("../../repo/sqlite/agentRegistryOps").AgentRegistryUpsertInput,
  ): AgentRegistryRow {
    return this._repo.upsertAgentRegistry(input);
  }

  /** agentRegistry:setEnabled — 切換 enabled（回傳 true=值有變動）。 */
  setAgentRegistryEnabled(agentId: string, enabled: boolean): boolean {
    return this._repo.setAgentRegistryEnabled(agentId, enabled);
  }

  /** agentRegistry:setStandardized — 切換 standardized（回傳 true=值有變動）。 */
  setAgentRegistryStandardized(agentId: string, standardized: boolean): boolean {
    return this._repo.setAgentRegistryStandardized(agentId, standardized);
  }

  /**
   * agentRegistry:upsertFromScan — 掃描 tree 逐筆 upsert 到 agent_registry。
   * manager：嘗試以 resolveEntrySkill 反查入口 skill（找不到則 null）。
   * worker/其他：skill_name = null。
   */
  async upsertRegistryFromScan(tree: AgentOrgTree): Promise<AgentRegistryItemDto[]> {
    const results: AgentRegistryItemDto[] = [];

    for (const team of tree.teams) {
      // resolveEntrySkill 期望 agents/ 的上層目錄（agentOrgRoot）：用「該隊來源根」去尾段 /agents。
      // 多來源：每隊各自的來源根；單一 default 來源時 === _resolveAgentOrgRoot() 去尾段（行為不變）。
      const agentOrgRoot = this._sourceRootForTeam(team.id).replace(
        /[/\\]agents[/\\]?$/,
        "",
      );
      // resolveEntrySkill 的 teamId needle 比對檔案路徑 → 用「純團隊路徑」（複合鍵去 `sourceId::` 前綴）。
      // registry 的 agent_id / team_id 則沿用系統鍵（node.id / team.id 已在 scan wrapper rekey 成複合鍵）。
      const teamPath = this._teamPathPart(team.id);
      // manager
      if (team.manager) {
        const node = team.manager;
        let skillName: string | null = null;
        try {
          const found = await resolveEntrySkill(agentOrgRoot, teamPath);
          skillName = found?.skillName ?? null;
        } catch {
          // IO 失敗不阻斷整批
        }
        const row = this._repo.upsertAgentRegistry({
          agentId: node.id,
          displayName: node.displayName,
          title: node.title,
          teamId: team.id,
          skillName,
        });
        results.push(_rowToDto(row));
      }

      // agents（workers）
      for (const node of team.agents) {
        const row = this._repo.upsertAgentRegistry({
          agentId: node.id,
          displayName: node.displayName,
          title: node.title,
          teamId: team.id,
          skillName: null,
        });
        results.push(_rowToDto(row));
      }
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// 私有 helper — DB 列轉 Dto
// ---------------------------------------------------------------------------

function _rowToDto(row: AgentRegistryRow): AgentRegistryItemDto {
  return {
    agentId: row.agent_id,
    displayName: row.display_name,
    title: row.title,
    teamId: row.team_id,
    skillName: row.skill_name,
    remark: row.remark,
    enabled: row.enabled === 1,
    standardized: row.standardized === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function _rowToCreatedDto(
  row: AgentRegistryRow,
): import("../../../shared/ipcContracts").AgentRegistryCreatedRow {
  return {
    agentId: row.agent_id,
    displayName: row.display_name,
    title: row.title,
    teamId: row.team_id,
    skillName: row.skill_name,
  };
}
