/**
 * groupConfig.ts — 分組設定模型與純邏輯函式
 * 設計來源：design-reactflow-refactor.md §3
 *
 * 純 TS，無 React/DOM 依賴，可獨立 tsc 驗。
 */
import type { AgentTeamDto } from '../../../shared/ipcContracts'
import { teamPathPart, parseTeamKey } from '../../../shared/ipc/contracts/agentOrg'
import type { ApplyGroupSourceResult } from '../../../shared/ipc/contracts/agentOrg'

// ---------------------------------------------------------------------------
// 介面定義
// ---------------------------------------------------------------------------

/** 工作群組定義。 */
export interface GroupDef {
  id: string
  name: string
  icon?: string
  color?: string
  /** 群排序（數字小在前）。 */
  order: number
  /** 工作群組用途描述（餵進建團隊 AI prompt 的 context）；optional，舊設定缺此欄位照讀。 */
  description?: string
  /** 系統內建群組：UI 全唯讀（改名/刪除/描述/資料夾/拖入拖出皆鎖定）。
   *  optional：舊設定無此欄位＝普通群（false-y），向後相容。 */
  isSystem?: boolean
  /** 指向一個 TeamSource.id；undefined＝沿用 default 來源。
   *  屬於此群組的新建團隊落到該來源資料夾。 */
  sourceId?: string
}

/** 單一 team 的分群對映。 */
export interface TeamGroupMapping {
  teamId: string
  groupId: string
}

/** 分組設定完整結構（app_settings key: agentTeamGroups）。 */
export interface GroupConfig {
  groups: GroupDef[]
  mappings: TeamGroupMapping[]
  version: 1
}

// ---------------------------------------------------------------------------
// 型別守衛
// ---------------------------------------------------------------------------

/**
 * isGroupConfig — 驗證任意值是否符合 GroupConfig 結構。
 * 解析失敗時 caller 應 fallback 到 DEFAULT_GROUP_CONFIG。
 */
export function isGroupConfig(v: unknown): v is GroupConfig {
  if (!v || typeof v !== 'object') return false
  const obj = v as Record<string, unknown>
  if (obj['version'] !== 1) return false
  if (!Array.isArray(obj['groups'])) return false
  if (!Array.isArray(obj['mappings'])) return false

  for (const g of obj['groups']) {
    if (typeof g !== 'object' || g === null) return false
    const gd = g as Record<string, unknown>
    if (typeof gd['id'] !== 'string') return false
    if (typeof gd['name'] !== 'string') return false
    if (typeof gd['order'] !== 'number') return false
  }

  for (const m of obj['mappings']) {
    if (typeof m !== 'object' || m === null) return false
    const md = m as Record<string, unknown>
    if (typeof md['teamId'] !== 'string') return false
    if (typeof md['groupId'] !== 'string') return false
  }

  return true
}

// ---------------------------------------------------------------------------
// 系統工作群組常數
// ---------------------------------------------------------------------------

/** 系統工作群組固定 id（雙底線命名，避免與使用者 UUID 群撞號）。 */
export const SYSTEM_GROUP_ID = '__system__'

/** 系統內建工作群組定義（程式碼為真相，不可被使用者修改）。 */
export const SYSTEM_GROUP_DEF: GroupDef = {
  id: SYSTEM_GROUP_ID,
  name: '系統工作群組',
  icon: '🔒',
  color: '#64748b',
  order: 0,
  description: '系統內建團隊，無法修改。',
  isSystem: true,
}

// ---------------------------------------------------------------------------
// 未分類偽群常數
// ---------------------------------------------------------------------------

/** 未分類 team 的 pseudo-group（runtime only，不存設定）。 */
export const UNCLASSIFIED_GROUP: GroupDef = {
  id: '__unclassified__',
  name: '📦 未分類',
  order: 9999,
}

// ---------------------------------------------------------------------------
// 預設分組設定（系統群 + 我的群組，共兩群、1 個 team 映射）
// 注意：只影響從未存過 agentTeamGroups 設定的全新使用者。
// 已存設定的使用者畫面由 migrateGroupConfig 冪等決定，本常數不管既有使用者。
// ---------------------------------------------------------------------------

export const DEFAULT_GROUP_CONFIG: GroupConfig = {
  version: 1,
  groups: [
    SYSTEM_GROUP_DEF,
    {
      id: 'mine',
      name: '我的群組',
      icon: '📁',
      color: '#6366f1',
      order: 1,
      description: '放你自己建立的 AI 團隊。',
    },
  ],
  mappings: [{ teamId: 'agent-ops', groupId: SYSTEM_GROUP_ID }],
}

// ---------------------------------------------------------------------------
// 多來源複合鍵相容（docs/multi-source-teams.md Phase 3）
// ---------------------------------------------------------------------------

/**
 * migrateGroupConfig — 冪等遷移/相容處理：把舊 groupConfig 安全帶到多來源複合鍵時代。
 *
 * 設計鐵則（向後相容）：
 *   - **既有裸 key mapping 不動**：default 來源的團隊系統鍵仍是裸 teamId，原 mapping 逐字保留。
 *   - 非預設來源的團隊系統鍵為 `${sourceId}::${teamId}`；其 mapping（若有）以複合 key 存。
 *   - **找不到複合 key 的 mapping 不報錯**：未對映的團隊由 groupTeams 自然落入「未分類」群（既有行為）。
 *
 * 除了既有的「清掉指向不存在工作群組的 orphan mapping」，此函式還執行：
 *   1. ensureSystemGroup：config.groups 無系統群 → 插入最前；已有但漂移 → 用 SYSTEM_GROUP_DEF 覆寫。
 *   2. ensureAgentOpsMapping：agent-ops 必須歸入系統群（裸鍵與複合鍵均涵蓋）。
 *
 * 冪等：對已整理過的 config 再跑一次回傳等值結果；完全無變動時回傳原物件參考（避免無謂
 * re-render / 持久化寫入）。
 */
export function migrateGroupConfig(config: GroupConfig): GroupConfig {
  let groups = config.groups
  let mappings = config.mappings

  // ── 1. ensureSystemGroup ──────────────────────────────────────────────────
  const existingSystemIdx = groups.findIndex((g) => g.id === SYSTEM_GROUP_ID)
  if (existingSystemIdx === -1) {
    // 系統群不存在 → 插入最前
    groups = [SYSTEM_GROUP_DEF, ...groups]
  } else if (
    groups[existingSystemIdx].isSystem !== true ||
    groups[existingSystemIdx].name !== SYSTEM_GROUP_DEF.name ||
    groups[existingSystemIdx].icon !== SYSTEM_GROUP_DEF.icon ||
    groups[existingSystemIdx].color !== SYSTEM_GROUP_DEF.color ||
    groups[existingSystemIdx].order !== SYSTEM_GROUP_DEF.order ||
    groups[existingSystemIdx].description !== SYSTEM_GROUP_DEF.description
  ) {
    // 系統群已存在但定義漂移 → 覆寫（系統群定義以程式碼為真相）
    groups = groups.map((g, i) => (i === existingSystemIdx ? SYSTEM_GROUP_DEF : g))
  }

  // ── 2. 清 orphan mapping（validGroupIds 含 SYSTEM_GROUP_ID，避免把即將補的 mapping 當 orphan 清掉）──
  const validGroupIds = new Set(groups.map((g) => g.id))
  const cleaned = mappings.filter((m) => validGroupIds.has(m.groupId))
  if (cleaned.length !== mappings.length) {
    mappings = cleaned
  }

  // ── 3. ensureAgentOpsMapping ──────────────────────────────────────────────
  // 移除任何「teamPathPart(teamId) === 'agent-ops' 但 groupId !== SYSTEM_GROUP_ID」的 mapping
  // 裸鍵（'agent-ops'）與複合鍵（'x::agent-ops'）都要涵蓋
  const withoutWrongAgentOps = mappings.filter(
    (m) => !(teamPathPart(m.teamId) === 'agent-ops' && m.groupId !== SYSTEM_GROUP_ID),
  )
  if (withoutWrongAgentOps.length !== mappings.length) {
    mappings = withoutWrongAgentOps
  }
  // 若無 agent-ops → SYSTEM_GROUP_ID 的 mapping，補一條裸鍵
  const hasAgentOpsSystemMapping = mappings.some(
    (m) => teamPathPart(m.teamId) === 'agent-ops' && m.groupId === SYSTEM_GROUP_ID,
  )
  if (!hasAgentOpsSystemMapping) {
    mappings = [...mappings, { teamId: 'agent-ops', groupId: SYSTEM_GROUP_ID }]
  }

  // ── 4. 冪等守門：無任何變動 → 回傳原物件 ──────────────────────────────────
  if (groups === config.groups && mappings === config.mappings) return config

  return { ...config, groups, mappings }
}

// ---------------------------------------------------------------------------
// groupTeams — 純函式：依設定將 teams 分組回傳
// ---------------------------------------------------------------------------

/** groupTeams 回傳項目。 */
export interface GroupedTeams {
  group: GroupDef
  teams: AgentTeamDto[]
}

/**
 * groupTeams — 依 GroupConfig 將 AgentTeamDto[] 分群。
 * - 已分群的 teams 按 GroupDef.order 排序。
 * - 無對應 groupId 的 teams 歸入 UNCLASSIFIED_GROUP（如有則附在尾端）。
 * - 真實設定的工作群組即使無 team 也保留（顯示 header，供使用者建團隊）；
 *   未分類偽群（UNCLASSIFIED_GROUP）空則不顯示。
 */
export function groupTeams(teams: AgentTeamDto[], config: GroupConfig): GroupedTeams[] {
  // 建立 teamId → groupId 的 lookup Map
  const mappingMap = new Map<string, string>()
  for (const m of config.mappings) {
    mappingMap.set(m.teamId, m.groupId)
  }

  // 建立 groupId → GroupDef 的 lookup Map
  const groupDefMap = new Map<string, GroupDef>()
  for (const g of config.groups) {
    groupDefMap.set(g.id, g)
  }

  // 按 groupId 歸桶
  const buckets = new Map<string, AgentTeamDto[]>()
  const unclassified: AgentTeamDto[] = []

  for (const team of teams) {
    const groupId = mappingMap.get(team.id)
    if (groupId && groupDefMap.has(groupId)) {
      const bucket = buckets.get(groupId) ?? []
      bucket.push(team)
      buckets.set(groupId, bucket)
    } else {
      unclassified.push(team)
    }
  }

  // 依 order 排序群。真實工作群組即使空也保留（顯示 header）；
  // 僅未分類偽群空時才濾除（不冒出空的「未分類」桶）。
  const result: GroupedTeams[] = config.groups
    .slice()
    .sort((a, b) => a.order - b.order)
    .filter((g) => g.id !== UNCLASSIFIED_GROUP.id || (buckets.get(g.id)?.length ?? 0) > 0)
    .map((g) => ({ group: g, teams: buckets.get(g.id) ?? [] }))

  // 附加未分類群（如有）
  if (unclassified.length > 0) {
    result.push({ group: UNCLASSIFIED_GROUP, teams: unclassified })
  }

  return result
}

// ---------------------------------------------------------------------------
// 分組設定編輯純函式（GroupConfigEditor 拖拉換群／改名用）
// ---------------------------------------------------------------------------

/**
 * moveTeamToGroup — 回傳把 teamId 搬到 targetGroupId 後的新 GroupConfig（純函式，不改入參）。
 * - targetGroupId 為 UNCLASSIFIED_GROUP.id 時移除該 team 的 mapping（變未分類）。
 * - 其餘情況：先移除舊 mapping 再加入新 mapping（不會產生重複）。
 */
export function moveTeamToGroup(
  config: GroupConfig,
  teamId: string,
  targetGroupId: string,
): GroupConfig {
  const filtered = config.mappings.filter((m) => m.teamId !== teamId)
  if (targetGroupId === UNCLASSIFIED_GROUP.id) {
    return { ...config, mappings: filtered }
  }
  return { ...config, mappings: [...filtered, { teamId, groupId: targetGroupId }] }
}

/**
 * renameGroup — 回傳把 groupId 改名為 newName 後的新 GroupConfig（純函式，不改入參）。
 * - newName trim 後為空、或 groupId 不存在時，回傳原 config（不變）。
 */
export function renameGroup(
  config: GroupConfig,
  groupId: string,
  newName: string,
): GroupConfig {
  const trimmed = newName.trim()
  if (!trimmed) return config
  if (!config.groups.some((g) => g.id === groupId)) return config
  return {
    ...config,
    groups: config.groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)),
  }
}

/**
 * updateGroupDescription — 回傳把 groupId 的 description 改成 newDescription 後的新 GroupConfig（純函式，不改入參）。
 * - 與 renameGroup 不同：描述允許清空——newDescription trim 後為空時存為 undefined（不顯示於 prompt）。
 * - groupId 不存在時回傳原 config（不變）。
 */
export function updateGroupDescription(
  config: GroupConfig,
  groupId: string,
  newDescription: string,
): GroupConfig {
  if (!config.groups.some((g) => g.id === groupId)) return config
  const trimmed = newDescription.trim()
  const nextDescription = trimmed ? trimmed : undefined
  return {
    ...config,
    groups: config.groups.map((g) =>
      g.id === groupId ? { ...g, description: nextDescription } : g,
    ),
  }
}

/**
 * updateGroupSource — 回傳把 groupId 的 sourceId 設為 newSourceId 後的新 GroupConfig（純函式，不改入參）。
 * - 空字串或 undefined → 清除 sourceId（恢復使用 default 來源）。
 * - groupId 不存在時回傳原 config（不變）。
 */
export function updateGroupSource(
  config: GroupConfig,
  groupId: string,
  newSourceId: string | undefined,
): GroupConfig {
  if (!config.groups.some((g) => g.id === groupId)) return config
  const nextSourceId = newSourceId && newSourceId.trim() ? newSourceId.trim() : undefined
  return {
    ...config,
    groups: config.groups.map((g) =>
      g.id === groupId ? { ...g, sourceId: nextSourceId } : g,
    ),
  }
}

/**
 * moveGroup — 回傳把 groupId 與相鄰群上/下對調順序後的新 GroupConfig（純函式，不改入參）。
 *
 * 規則：
 *   - 系統群（isSystem）固定釘頂、不參與排序：target 為系統群時回傳原 config。
 *   - 只在「非系統群」之間調動：把可調動群依 order 排序，找出 target 與相鄰群對調位置，
 *     再依新位置重新編號 order（系統群保持 order 0，可調動群依序 1,2,3…）。
 *     重新編號可避免舊資料 order 重複時「對調 order 值卻無變化」的死角，保證每次點擊都生效。
 *   - 已在頂端按上 / 已在底端按下 → 邊界無動作，回傳原 config（caller 應同時把對應按鈕 disable）。
 *   - groupId 不存在時回傳原 config（不變）。
 */
export function moveGroup(
  config: GroupConfig,
  groupId: string,
  direction: "up" | "down",
): GroupConfig {
  const target = config.groups.find((g) => g.id === groupId);
  if (!target || target.isSystem) return config;

  const systemGroups = config.groups.filter((g) => g.isSystem);
  const movable = config.groups
    .filter((g) => !g.isSystem)
    .sort((a, b) => a.order - b.order);

  const idx = movable.findIndex((g) => g.id === groupId);
  if (idx === -1) return config;
  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= movable.length) return config; // 已在邊界

  // 對調位置後依序重新編號（系統群維持 order 0，可調動群 1,2,3…）。
  const reordered = movable.slice();
  [reordered[idx], reordered[swapIdx]] = [reordered[swapIdx], reordered[idx]];
  const reassigned = reordered.map((g, i) => ({ ...g, order: i + 1 }));

  return { ...config, groups: [...systemGroups, ...reassigned] };
}

// ---------------------------------------------------------------------------
// 行為乙搬移用純函式（plan_v2_relocation.md §1.4、§1.5、§3.1）
// ---------------------------------------------------------------------------

/**
 * computeTeamsToRelocate — 計算「群組 groupId 中需實體搬移到 toSourceId 的系統鍵清單」（§1.4）。
 *
 * 過濾邏輯：
 *   1. 只取 groupId 所對應的 mapping。
 *   2. 硬排除 teamPathPart === 'agent-ops'（寫死落點，永不搬移）。
 *   3. 已在目標來源者跳過（冪等）：
 *      - 複合鍵：parseTeamKey(key).sourceId === toSourceId → 跳過。
 *      - 裸鍵（sourceId===undefined）且 toSourceId==='default' → 跳過（裸鍵即代表 default 來源）。
 *
 * 純函式，不改入參。
 */
export function computeTeamsToRelocate(
  config: GroupConfig,
  groupId: string,
  toSourceId: string,
): string[] {
  return config.mappings
    .filter((m) => m.groupId === groupId)
    .map((m) => m.teamId)
    .filter((key) => teamPathPart(key) !== 'agent-ops')
    .filter((key) => {
      const { sourceId } = parseTeamKey(key)
      // 裸鍵（sourceId===undefined）代表 default 來源
      const effectiveSourceId = sourceId ?? 'default'
      return effectiveSourceId !== toSourceId
    })
}

/**
 * applyRelocationResult — 依 applyGroupSource 回傳結果重建 GroupConfig（§1.5 + §3.1）。
 *
 * 規則：
 *   - mappings：對每個 ok===true 的 result，把該群組內 teamId===oldKey 的 mapping 換成 newKey；
 *     ok===false 保留 oldKey 不動；其他群的 mapping 一律不動。
 *   - GroupDef.sourceId（§1.5 時機）：
 *     「至少一筆 ok===true」或「results.length===0（空群/無可搬隊）」→ 寫入 groupId 的 GroupDef.sourceId = toSourceId。
 *     「有 results 但全 ok===false」→ 不寫 sourceId（維持原值），避免設定與事實脫節。
 *
 * 純函式，不改入參。
 */
export function applyRelocationResult(
  config: GroupConfig,
  groupId: string,
  toSourceId: string,
  results: ApplyGroupSourceResult['results'],
): GroupConfig {
  // 建立 oldKey→newKey 的快取（只取成功的）
  const successMap = new Map<string, string>()
  for (const r of results) {
    if (r.ok) successMap.set(r.oldKey, r.newKey)
  }

  // 重建 mappings：目標群內成功的換 newKey，其餘不動
  const newMappings = config.mappings.map((m) => {
    if (m.groupId !== groupId) return m
    const newKey = successMap.get(m.teamId)
    return newKey !== undefined ? { ...m, teamId: newKey } : m
  })

  // §1.5：決定是否寫入 sourceId
  const hasAnySuccess = results.some((r) => r.ok)
  const isEmpty = results.length === 0
  const shouldWriteSourceId = hasAnySuccess || isEmpty

  const newGroups = shouldWriteSourceId
    ? config.groups.map((g) =>
        g.id === groupId ? { ...g, sourceId: toSourceId || undefined } : g,
      )
    : config.groups

  return { ...config, groups: newGroups, mappings: newMappings }
}
