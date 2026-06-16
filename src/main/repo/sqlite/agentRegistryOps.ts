// ---------------------------------------------------------------------------
// agentRegistryOps.ts — agent_registry 表的純函式 CRUD（B5 加法表）
//   參數 db: Database.Database；無副作用、無 import side-effect。
//
//   設計要點：
//     upsertAgentRegistry — INSERT ... ON CONFLICT DO UPDATE：
//       只更新 display_name / title / team_id / skill_name / updated_at。
//       **不覆寫 enabled 與 remark**（使用者手動設定，掃描洗不掉）。
// ---------------------------------------------------------------------------

import Database from 'better-sqlite3'
import { nowIso } from './util'

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export interface AgentRegistryRow {
  agent_id: string
  display_name: string | null
  title: string | null
  team_id: string | null
  skill_name: string | null
  remark: string | null
  enabled: number          // SQLite INTEGER；1=啟用 / 0=停用
  standardized: number     // SQLite INTEGER；1=已規格化 / 0=待優化（快速建立預設 0）
  created_at: string
  updated_at: string
}

export interface AgentRegistryUpsertInput {
  agentId: string
  displayName?: string | null
  title?: string | null
  teamId?: string | null
  skillName?: string | null
  /** 規格化狀態（1=已規格化 / 0=待優化）。省略 → INSERT 預設 0；ON CONFLICT 不覆寫（掃描洗不掉手動值）。 */
  standardized?: number
}

// ---------------------------------------------------------------------------
// getAllAgentRegistry — 回傳全部列，按 team_id ASC、agent_id ASC 排序
// ---------------------------------------------------------------------------

export function getAllAgentRegistry(db: Database.Database): AgentRegistryRow[] {
  return db
    .prepare(
      'SELECT * FROM agent_registry ORDER BY team_id ASC, agent_id ASC',
    )
    .all() as AgentRegistryRow[]
}

// ---------------------------------------------------------------------------
// upsertAgentRegistry — insert or update（enabled / remark 不覆寫）
// ---------------------------------------------------------------------------

export function upsertAgentRegistry(
  db: Database.Database,
  input: AgentRegistryUpsertInput,
): AgentRegistryRow {
  const now = nowIso()
  const displayName = input.displayName ?? null
  const title = input.title ?? null
  const teamId = input.teamId ?? null
  const skillName = input.skillName ?? null
  const standardized = input.standardized ?? 0

  db.prepare(
    'INSERT INTO agent_registry ' +
      '(agent_id, display_name, title, team_id, skill_name, remark, enabled, standardized, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, ?, NULL, 1, ?, ?, ?) ' +
      'ON CONFLICT(agent_id) DO UPDATE SET ' +
      '  display_name = excluded.display_name, ' +
      '  title        = excluded.title, ' +
      '  team_id      = excluded.team_id, ' +
      '  skill_name   = excluded.skill_name, ' +
      '  updated_at   = excluded.updated_at ' +
      '-- enabled / remark / standardized 不覆寫：手動值由 setAgentRegistryEnabled / setAgentRegistryStandardized 管理',
  ).run(input.agentId, displayName, title, teamId, skillName, standardized, now, now)

  return db
    .prepare('SELECT * FROM agent_registry WHERE agent_id = ?')
    .get(input.agentId) as AgentRegistryRow
}

// ---------------------------------------------------------------------------
// ensureAgentRegistryRow — 確保某 agent_id 有 registry 列（列不存在則建）
//   背景：AgentOrg 檔案放共用硬碟、agent_registry 是 per-machine 本機 DB，
//   故「沒建過該團隊」的機器上 setter 找不到列；改 upsert 前先把列補出來。
//   建列沿用 upsertAgentRegistry 的 INSERT 路徑（enabled=1 / standardized=0 預設、
//   created_at/updated_at 帶齊），其餘欄位由 agentId 推導合理 default：
//     team_id   = agentId 去掉最後一段（'<teamId>/manager' → '<teamId>'）
//   回傳：true=本次新建了列；false=列原本就存在。
// ---------------------------------------------------------------------------

function ensureAgentRegistryRow(db: Database.Database, agentId: string): boolean {
  const exists = db
    .prepare('SELECT 1 FROM agent_registry WHERE agent_id = ?')
    .get(agentId) as { 1: number } | undefined
  if (exists) return false

  // agent_id = `${teamId}/${agentName}`。多來源複合鍵下 teamId 可為 `${sourceId}::${teamId}`，
  // 故 teamId 可同時含 `::`（來源前綴分隔）與 `/`（子團隊分隔，如 `platform/goose-ops`）。
  // 約束鐵則（docs/multi-source-teams.md Phase 3）：agentName 絕無 `/`、sourceId 絕無 `/`。
  //   ⇒ agent_id 的「最後一個 `/`」永遠是 teamId 與 agentName 的分界，與 `::` 無關。
  // 例：`projX::platform/goose-ops/manager` → lastIndexOf('/') 切在 /manager 前 →
  //     teamId='projX::platform/goose-ops'、agentName='manager'（正確）。
  const slash = agentId.lastIndexOf('/')
  const teamId = slash > 0 ? agentId.slice(0, slash) : null

  // 沿用 upsertAgentRegistry 的建列邏輯（INSERT 預設 enabled=1 / standardized=0）。
  upsertAgentRegistry(db, { agentId, teamId })
  return true
}

// ---------------------------------------------------------------------------
// setAgentRegistryEnabled — upsert enabled 旗標（1=啟用 / 0=停用）
//   列不存在 → 先建列再寫目標值（共用硬碟 / per-machine DB 場景）。
//   回傳 true 表示已建列或值有變動；false 表示列已存在且值相同（no-op）。
//   冪等：重複呼叫同一目標值，建列後第二次起為 no-op。
// ---------------------------------------------------------------------------

export function setAgentRegistryEnabled(
  db: Database.Database,
  agentId: string,
  enabled: boolean,
): boolean {
  const created = ensureAgentRegistryRow(db, agentId)

  const row = db
    .prepare('SELECT enabled FROM agent_registry WHERE agent_id = ?')
    .get(agentId) as Pick<AgentRegistryRow, 'enabled'> | undefined

  const newVal = enabled ? 1 : 0
  // 列剛建出（預設 enabled=1）時，若目標值相同則無需 UPDATE，但仍回 true（已落地目標狀態）。
  if (!row || row.enabled === newVal) return created

  db.prepare(
    'UPDATE agent_registry SET enabled = ?, updated_at = ? WHERE agent_id = ?',
  ).run(newVal, nowIso(), agentId)
  return true
}

// ---------------------------------------------------------------------------
// rekeyAgentRegistryTeam — 把某團隊（team_id===oldKey）的所有列遷到 newKey
//   每列：agent_id 由 `${oldKey}/<agentName>` → `${newKey}/<agentName>`
//         （agentName = agent_id 最後一段，lastIndexOf('/') 切，與 ensureAgentRegistryRow 同規則）
//         team_id 由 oldKey → newKey；其餘欄位原值保留；updated_at = now。
//   做法（單一 transaction）：SELECT 舊列 → 對每列 INSERT OR REPLACE 新 agent_id 列 → DELETE 舊列。
//   冪等：newKey===oldKey → no-op，回 0。
//   目標鍵已存在（撞名）→ INSERT OR REPLACE 覆寫（上層 §4 衝突偵測已先擋）。
//   回傳：遷移的列數。
// ---------------------------------------------------------------------------

export function rekeyAgentRegistryTeam(
  db: Database.Database,
  oldKey: string,
  newKey: string,
): number {
  if (oldKey === newKey) return 0

  const rows = db
    .prepare('SELECT * FROM agent_registry WHERE team_id = ?')
    .all(oldKey) as AgentRegistryRow[]

  if (rows.length === 0) return 0

  const now = nowIso()

  const doRekey = db.transaction(() => {
    const insert = db.prepare(
      'INSERT OR REPLACE INTO agent_registry ' +
        '(agent_id, display_name, title, team_id, skill_name, remark, enabled, standardized, created_at, updated_at) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    const del = db.prepare('DELETE FROM agent_registry WHERE agent_id = ?')

    for (const row of rows) {
      const slash = row.agent_id.lastIndexOf('/')
      const agentName = slash >= 0 ? row.agent_id.slice(slash + 1) : row.agent_id
      const newAgentId = `${newKey}/${agentName}`
      insert.run(
        newAgentId,
        row.display_name,
        row.title,
        newKey,
        row.skill_name,
        row.remark,
        row.enabled,
        row.standardized,
        row.created_at,
        now,
      )
      del.run(row.agent_id)
    }

    return rows.length
  })

  return doRekey() as number
}

// ---------------------------------------------------------------------------
// setAgentRegistryStandardized — upsert standardized 旗標（1=已規格化 / 0=待優化）
//   列不存在 → 先建列再寫目標值（共用硬碟 / per-machine DB 場景：規格化跑完
//   但本機沒 manager registry 列時，過去 UPDATE-only 會把 standardized 寫不進去，
//   「待優化」徽章永不消失）。
//   回傳 true 表示已建列或值有變動；false 表示列已存在且值相同（no-op）。
//   冪等：重複呼叫同一目標值，建列後第二次起為 no-op。
//   供正規 agent-ops 規格化流程跑完後標 1；快速建立保持 0（待優化徽章顯示條件）。
// ---------------------------------------------------------------------------

export function setAgentRegistryStandardized(
  db: Database.Database,
  agentId: string,
  standardized: boolean,
): boolean {
  const created = ensureAgentRegistryRow(db, agentId)

  const row = db
    .prepare('SELECT standardized FROM agent_registry WHERE agent_id = ?')
    .get(agentId) as Pick<AgentRegistryRow, 'standardized'> | undefined

  const newVal = standardized ? 1 : 0
  // 列剛建出（預設 standardized=0）時，若目標值相同則無需 UPDATE，但仍回 true（已落地目標狀態）。
  if (!row || row.standardized === newVal) return created

  db.prepare(
    'UPDATE agent_registry SET standardized = ?, updated_at = ? WHERE agent_id = ?',
  ).run(newVal, nowIso(), agentId)
  return true
}
