/**
 * agentTeamsGroupConfig.spec.ts — groupConfig.ts 純邏輯單元測試
 *
 * 覆蓋：
 *   GC1: isGroupConfig 型別守衛（合法/缺鍵/型別錯/非物件 各 case）
 *   GC2: DEFAULT_GROUP_CONFIG 結構（2 群（系統群 + 我的群組）+ 1 映射）
 *   GC3: groupTeams(teams, config) — 正確分群/未分類/排序/空 teams
 *   GC4: 團隊層級 Ops prompt
 *   GC5: moveTeamToGroup / renameGroup
 *   GC6: updateGroupDescription
 *   GC7: migrateGroupConfig — 冪等 + 舊設定遷移 + agent-ops 強制歸系統群
 *   GC8: updateGroupSource — 設定/清空
 *
 * 純 TS，無 React/DOM 依賴，不碰 DB。
 */

import { describe, it, expect } from 'vitest'
import type { AgentTeamDto } from '../src/shared/ipcContracts'
import {
  isGroupConfig,
  DEFAULT_GROUP_CONFIG,
  UNCLASSIFIED_GROUP,
  SYSTEM_GROUP_ID,
  SYSTEM_GROUP_DEF,
  groupTeams,
  moveTeamToGroup,
  moveGroup,
  renameGroup,
  updateGroupDescription,
  migrateGroupConfig,
  updateGroupSource,
  computeTeamsToRelocate,
  applyRelocationResult,
} from '../src/renderer/views/AgentTeams/groupConfig'
import {
  buildCreateTeamPrompt,
  buildTeamAuditPrompt,
  buildTeamReviewPrompt,
  normalizeAgentSkillPrompt,
} from '../src/renderer/views/AgentTeams/agentTeamsHelpers'

// ---------------------------------------------------------------------------
// 測試用 AgentTeamDto 最小 fixture
// ---------------------------------------------------------------------------

function makeTeam(id: string): AgentTeamDto {
  return { id, manager: null, agents: [] }
}

// ---------------------------------------------------------------------------
// GC1: isGroupConfig 型別守衛
// ---------------------------------------------------------------------------

describe('GC1 isGroupConfig 型別守衛', () => {
  it('合法的 GroupConfig 回傳 true', () => {
    const v = {
      version: 1 as const,
      groups: [{ id: 'g1', name: '群1', order: 1 }],
      mappings: [{ teamId: 'sw', groupId: 'g1' }],
    }
    expect(isGroupConfig(v)).toBe(true)
  })

  it('groups 欄位為空陣列也合法', () => {
    expect(isGroupConfig({ version: 1, groups: [], mappings: [] })).toBe(true)
  })

  it('group 有選填欄位（icon/color）仍合法', () => {
    const v = {
      version: 1 as const,
      groups: [{ id: 'g', name: 'G', order: 1, icon: '🚀', color: '#fff' }],
      mappings: [],
    }
    expect(isGroupConfig(v)).toBe(true)
  })

  it('version 不為 1 回傳 false', () => {
    expect(isGroupConfig({ version: 2, groups: [], mappings: [] })).toBe(false)
  })

  it('缺少 version 欄位回傳 false', () => {
    expect(isGroupConfig({ groups: [], mappings: [] })).toBe(false)
  })

  it('缺少 groups 欄位回傳 false', () => {
    expect(isGroupConfig({ version: 1, mappings: [] })).toBe(false)
  })

  it('缺少 mappings 欄位回傳 false', () => {
    expect(isGroupConfig({ version: 1, groups: [] })).toBe(false)
  })

  it('groups 不是陣列回傳 false', () => {
    expect(isGroupConfig({ version: 1, groups: 'not-array', mappings: [] })).toBe(false)
  })

  it('mappings 不是陣列回傳 false', () => {
    expect(isGroupConfig({ version: 1, groups: [], mappings: 'not-array' })).toBe(false)
  })

  it('group 缺 id 欄位回傳 false', () => {
    const v = {
      version: 1,
      groups: [{ name: 'G', order: 1 }], // 缺 id
      mappings: [],
    }
    expect(isGroupConfig(v)).toBe(false)
  })

  it('group 缺 name 欄位回傳 false', () => {
    const v = {
      version: 1,
      groups: [{ id: 'g', order: 1 }], // 缺 name
      mappings: [],
    }
    expect(isGroupConfig(v)).toBe(false)
  })

  it('group 缺 order 欄位回傳 false', () => {
    const v = {
      version: 1,
      groups: [{ id: 'g', name: 'G' }], // 缺 order
      mappings: [],
    }
    expect(isGroupConfig(v)).toBe(false)
  })

  it('group.order 型別錯誤（string）回傳 false', () => {
    const v = {
      version: 1,
      groups: [{ id: 'g', name: 'G', order: '1' }], // string 非 number
      mappings: [],
    }
    expect(isGroupConfig(v)).toBe(false)
  })

  it('group 為 null 的陣列元素回傳 false', () => {
    const v = { version: 1, groups: [null], mappings: [] }
    expect(isGroupConfig(v)).toBe(false)
  })

  it('mapping 缺 teamId 欄位回傳 false', () => {
    const v = {
      version: 1,
      groups: [],
      mappings: [{ groupId: 'g1' }], // 缺 teamId
    }
    expect(isGroupConfig(v)).toBe(false)
  })

  it('mapping 缺 groupId 欄位回傳 false', () => {
    const v = {
      version: 1,
      groups: [],
      mappings: [{ teamId: 'sw' }], // 缺 groupId
    }
    expect(isGroupConfig(v)).toBe(false)
  })

  it('mapping 為 null 的陣列元素回傳 false', () => {
    const v = { version: 1, groups: [], mappings: [null] }
    expect(isGroupConfig(v)).toBe(false)
  })

  it('非物件（null）回傳 false', () => {
    expect(isGroupConfig(null)).toBe(false)
  })

  it('非物件（數字）回傳 false', () => {
    expect(isGroupConfig(42)).toBe(false)
  })

  it('非物件（字串）回傳 false', () => {
    expect(isGroupConfig('hello')).toBe(false)
  })

  it('undefined 回傳 false', () => {
    expect(isGroupConfig(undefined)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GC2: DEFAULT_GROUP_CONFIG 結構驗證
// ---------------------------------------------------------------------------

describe('GC2 DEFAULT_GROUP_CONFIG 結構', () => {
  it('isGroupConfig(DEFAULT_GROUP_CONFIG) 為 true', () => {
    expect(isGroupConfig(DEFAULT_GROUP_CONFIG)).toBe(true)
  })

  it('version 為 1', () => {
    expect(DEFAULT_GROUP_CONFIG.version).toBe(1)
  })

  it('恰好有 2 個群（系統群 + 我的群組）', () => {
    expect(DEFAULT_GROUP_CONFIG.groups).toHaveLength(2)
  })

  it('包含系統群（SYSTEM_GROUP_ID）', () => {
    const ids = DEFAULT_GROUP_CONFIG.groups.map((g) => g.id)
    expect(ids).toContain(SYSTEM_GROUP_ID)
  })

  it('包含 mine 群', () => {
    const ids = DEFAULT_GROUP_CONFIG.groups.map((g) => g.id)
    expect(ids).toContain('mine')
  })

  it('不含 deliver / data / infra 群（已移除）', () => {
    const ids = DEFAULT_GROUP_CONFIG.groups.map((g) => g.id)
    expect(ids).not.toContain('deliver')
    expect(ids).not.toContain('data')
    expect(ids).not.toContain('infra')
  })

  it('系統群 order=0（排最前）', () => {
    const sys = DEFAULT_GROUP_CONFIG.groups.find((g) => g.id === SYSTEM_GROUP_ID)!
    expect(sys).toBeDefined()
    expect(sys.order).toBe(0)
    expect(sys.isSystem).toBe(true)
  })

  it('mine 群 order=1', () => {
    const mine = DEFAULT_GROUP_CONFIG.groups.find((g) => g.id === 'mine')!
    expect(mine).toBeDefined()
    expect(mine.order).toBe(1)
    expect(mine.name).toBe('我的群組')
  })

  it('群的 order 依序為 0 / 1（排序正確）', () => {
    const orders = DEFAULT_GROUP_CONFIG.groups
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((g) => g.order)
    expect(orders).toEqual([0, 1])
  })

  it('恰好有 1 個 mapping（agent-ops→系統群）', () => {
    expect(DEFAULT_GROUP_CONFIG.mappings).toHaveLength(1)
  })

  it('agent-ops 映射到系統群', () => {
    const m = DEFAULT_GROUP_CONFIG.mappings.find((m) => m.teamId === 'agent-ops')
    expect(m).toBeDefined()
    expect(m!.groupId).toBe(SYSTEM_GROUP_ID)
  })

  it('每個 mapping 的 groupId 都存在於 groups 中', () => {
    const groupIds = new Set(DEFAULT_GROUP_CONFIG.groups.map((g) => g.id))
    for (const m of DEFAULT_GROUP_CONFIG.mappings) {
      expect(groupIds.has(m.groupId), `mapping teamId=${m.teamId} groupId=${m.groupId} 不存在`).toBe(true)
    }
  })

  it('空 teams 時 groupTeams 只長出系統群 + 我的群組兩個 header（不冒未分類）', () => {
    const result = groupTeams([], DEFAULT_GROUP_CONFIG)
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.group.id)).toEqual([SYSTEM_GROUP_ID, 'mine'])
    for (const r of result) {
      expect(r.teams).toHaveLength(0)
    }
    expect(result.map((r) => r.group.id)).not.toContain(UNCLASSIFIED_GROUP.id)
  })
})

// ---------------------------------------------------------------------------
// GC3: groupTeams 分群邏輯
// ---------------------------------------------------------------------------

describe('GC3 groupTeams 分群邏輯', () => {
  it('空 teams 回傳 2 個真實空群（系統群 + 我的群組，各 teams:[]），不含未分類桶', () => {
    const result = groupTeams([], DEFAULT_GROUP_CONFIG)
    // 真實工作群組即使 0 team 也保留（顯示 header），未分類偽群空則不顯示
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.group.id)).toEqual([SYSTEM_GROUP_ID, 'mine'])
    for (const r of result) {
      expect(r.teams).toHaveLength(0)
    }
    expect(result.map((r) => r.group.id)).not.toContain(UNCLASSIFIED_GROUP.id)
  })

  it('agent-ops 正確落入系統群', () => {
    const teams = [makeTeam('agent-ops')]
    const result = groupTeams(teams, DEFAULT_GROUP_CONFIG)

    const sysGroup = result.find((r) => r.group.id === SYSTEM_GROUP_ID)
    expect(sysGroup).toBeDefined()
    expect(sysGroup!.teams.map((t) => t.id)).toContain('agent-ops')
  })

  it('未映射的 team 落入 UNCLASSIFIED_GROUP（仍含 2 真實空群）', () => {
    const teams = [makeTeam('unknown-team-xyz')]
    const result = groupTeams(teams, DEFAULT_GROUP_CONFIG)

    // 2 個真實空群（顯示 header）+ 1 未分類桶（含未映射 team）
    expect(result).toHaveLength(3)
    const unclassified = result.find((r) => r.group.id === UNCLASSIFIED_GROUP.id)!
    expect(unclassified).toBeDefined()
    expect(unclassified.teams.map((t) => t.id)).toContain('unknown-team-xyz')
    // 真實空群仍保留且不含該 team
    expect(result.map((r) => r.group.id)).toEqual([
      SYSTEM_GROUP_ID,
      'mine',
      UNCLASSIFIED_GROUP.id,
    ])
  })

  it('UNCLASSIFIED_GROUP 附在結果尾端', () => {
    const teams = [makeTeam('agent-ops'), makeTeam('orphan-team')]
    const result = groupTeams(teams, DEFAULT_GROUP_CONFIG)

    const lastGroup = result[result.length - 1]
    expect(lastGroup.group.id).toBe(UNCLASSIFIED_GROUP.id)
  })

  it('真實空群保留並顯示 header，未分類空群不顯示', () => {
    // 只提供 agent-ops（歸系統群）；mine 為真實空群應保留，未分類無 team 不出現
    const teams = [makeTeam('agent-ops')]
    const result = groupTeams(teams, DEFAULT_GROUP_CONFIG)

    const ids = result.map((r) => r.group.id)
    // 兩個真實工作群組皆出現（即使 mine 為空）
    expect(ids).toContain(SYSTEM_GROUP_ID)
    expect(ids).toContain('mine')
    // 沒有未映射 team，未分類偽群不顯示
    expect(ids).not.toContain(UNCLASSIFIED_GROUP.id)
    // mine 空群回傳 teams:[]
    expect(result.find((r) => r.group.id === SYSTEM_GROUP_ID)!.teams.map((t) => t.id)).toEqual(['agent-ops'])
    expect(result.find((r) => r.group.id === 'mine')!.teams).toHaveLength(0)
  })

  it('依 GroupDef.order 排序（system=0 < mine=1）', () => {
    const teams = [makeTeam('agent-ops')]
    const result = groupTeams(teams, DEFAULT_GROUP_CONFIG)

    const groupOrders = result
      .filter((r) => r.group.id !== UNCLASSIFIED_GROUP.id)
      .map((r) => r.group.order)
    // 驗證已升序排列
    for (let i = 1; i < groupOrders.length; i++) {
      expect(groupOrders[i]).toBeGreaterThan(groupOrders[i - 1])
    }
  })

  it('全部 team 未映射時：回傳 2 真實空群 + 未分類桶（含所有未映射 team）', () => {
    const teams = [makeTeam('a'), makeTeam('b'), makeTeam('c')]
    const result = groupTeams(teams, DEFAULT_GROUP_CONFIG)

    // 2 個真實空群（各 teams:[]）+ 1 未分類桶
    expect(result).toHaveLength(3)
    // 真實空群皆為空
    for (const id of [SYSTEM_GROUP_ID, 'mine']) {
      expect(result.find((r) => r.group.id === id)!.teams).toHaveLength(0)
    }
    // 未分類桶附在尾端，含全部未映射 team
    const unclassified = result[result.length - 1]
    expect(unclassified.group.id).toBe(UNCLASSIFIED_GROUP.id)
    expect(unclassified.teams.map((t) => t.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('自訂 config：只有一個群時正確分群', () => {
    const config = {
      version: 1 as const,
      groups: [{ id: 'grp-a', name: 'A 群', order: 1 }],
      mappings: [
        { teamId: 'alpha', groupId: 'grp-a' },
        { teamId: 'beta', groupId: 'grp-a' },
      ],
    }
    const teams = [makeTeam('alpha'), makeTeam('beta'), makeTeam('gamma')]
    const result = groupTeams(teams, config)

    // grp-a 含 alpha + beta，gamma 未分類
    expect(result).toHaveLength(2)
    const grpA = result.find((r) => r.group.id === 'grp-a')!
    expect(grpA.teams.map((t) => t.id).sort()).toEqual(['alpha', 'beta'])

    const unclassified = result.find((r) => r.group.id === UNCLASSIFIED_GROUP.id)!
    expect(unclassified.teams.map((t) => t.id)).toEqual(['gamma'])
  })

  it('mapping 指向不存在的 groupId 時 team 落入 UNCLASSIFIED_GROUP（真實空群仍保留）', () => {
    const config = {
      version: 1 as const,
      groups: [{ id: 'real-group', name: 'Real', order: 1 }],
      mappings: [{ teamId: 'orphan', groupId: 'nonexistent-group' }],
    }
    const teams = [makeTeam('orphan')]
    const result = groupTeams(teams, config)

    // 新契約：真實空群 real-group 保留（teams:[]）+ 未分類桶（含壞映射的 orphan）
    expect(result).toHaveLength(2)
    expect(result.map((r) => r.group.id)).toEqual(['real-group', UNCLASSIFIED_GROUP.id])
    expect(result.find((r) => r.group.id === 'real-group')!.teams).toHaveLength(0)
    const unclassified = result.find((r) => r.group.id === UNCLASSIFIED_GROUP.id)!
    expect(unclassified.teams.map((t) => t.id)).toContain('orphan')
  })
})

// ---------------------------------------------------------------------------
// GC4: 團隊層級 Ops prompt
// ---------------------------------------------------------------------------

describe('GC4 團隊層級 Ops prompt', () => {
  it('建立 AI 團隊 prompt 會帶入快組隊平台情境與建立目的', () => {
    const prompt = buildCreateTeamPrompt()
    expect(prompt).toContain('/tuq-agent')
    expect(prompt).toContain('platform_context: teamuq_agent_team_ui')
    expect(prompt).toContain('快組隊-AI團隊')
    expect(prompt).toContain('建立新的 AI 團隊')
    expect(prompt).toContain('agent_team_create_spec JSON')
    expect(prompt).toContain('agent_registry')
    expect(prompt).toContain('Claude/Codex/AGY')
  })

  it('健診 prompt 會帶入明確團隊對象', () => {
    expect(buildTeamAuditPrompt('sw', 'SW Team')).toBe(
      '/tuq-agent audit sw 現在是要對「SW Team」團隊做健診。',
    )
  })

  it('改善 prompt 會帶入明確團隊對象', () => {
    expect(buildTeamReviewPrompt('sw', 'SW Team')).toBe(
      '/tuq-agent review sw 現在是要對「SW Team」團隊做自我改善。',
    )
  })

  it('Codex 初始 prompt 會轉成 $ skill 前綴', () => {
    expect(normalizeAgentSkillPrompt(buildTeamAuditPrompt('edu', '教育組長'), 'codex')).toBe(
      '$tuq-agent audit edu 現在是要對「教育組長」團隊做健診。',
    )
  })

  it('Claude 初始 prompt 會保留 / skill 前綴', () => {
    expect(normalizeAgentSkillPrompt(buildTeamReviewPrompt('edu', '教育組長'), 'claude')).toBe(
      '/tuq-agent review edu 現在是要對「教育組長」團隊做自我改善。',
    )
  })

  it('沒有 skill 前綴的 prompt 會依 CLI 補上預設 skill', () => {
    expect(normalizeAgentSkillPrompt('請幫我建立一組資料分析團隊', 'codex')).toBe(
      '$tuq-agent 請幫我建立一組資料分析團隊',
    )
  })

  it('Codex 建立團隊 prompt 會轉成 $tuq-agent 並保留平台情境', () => {
    expect(normalizeAgentSkillPrompt(buildCreateTeamPrompt(), 'codex')).toContain(
      '$tuq-agent platform_context: teamuq_agent_team_ui',
    )
  })
})

// ---------------------------------------------------------------------------
// GC5: moveTeamToGroup / renameGroup（分組編輯純函式）
// ---------------------------------------------------------------------------

describe('GC5 moveTeamToGroup / renameGroup', () => {
  const twoGroupConfig = {
    version: 1 as const,
    groups: [
      { id: 'grp-a', name: 'A 群', order: 1 },
      { id: 'grp-b', name: 'B 群', order: 2 },
    ],
    mappings: [{ teamId: 'sw', groupId: 'grp-a' }],
  }

  it('換群：mapping 更新且不重複，原 config 不被修改（純函式）', () => {
    const next = moveTeamToGroup(twoGroupConfig, 'sw', 'grp-b')
    expect(next.mappings).toEqual([{ teamId: 'sw', groupId: 'grp-b' }])
    // 原 config 不變
    expect(twoGroupConfig.mappings).toEqual([{ teamId: 'sw', groupId: 'grp-a' }])
  })

  it('搬到未分類（UNCLASSIFIED_GROUP.id）：移除 mapping；未映射 team 搬入群：新增 mapping', () => {
    const toUnclassified = moveTeamToGroup(twoGroupConfig, 'sw', UNCLASSIFIED_GROUP.id)
    expect(toUnclassified.mappings.find((m) => m.teamId === 'sw')).toBeUndefined()

    const fromUnclassified = moveTeamToGroup(twoGroupConfig, 'orphan', 'grp-b')
    expect(fromUnclassified.mappings).toContainEqual({ teamId: 'orphan', groupId: 'grp-b' })
    // 既有 mapping 不受影響
    expect(fromUnclassified.mappings).toContainEqual({ teamId: 'sw', groupId: 'grp-a' })
  })

  it('改名後 groups 更新（含 trim），其他群與 mappings 不動', () => {
    const next = renameGroup(twoGroupConfig, 'grp-a', '  交付事業群  ')
    expect(next.groups.find((g) => g.id === 'grp-a')!.name).toBe('交付事業群')
    expect(next.groups.find((g) => g.id === 'grp-b')!.name).toBe('B 群')
    expect(next.mappings).toEqual(twoGroupConfig.mappings)
    // 原 config 不變
    expect(twoGroupConfig.groups.find((g) => g.id === 'grp-a')!.name).toBe('A 群')
  })

  it('改名防呆：空白名稱或不存在的群回傳原 config 不變', () => {
    expect(renameGroup(twoGroupConfig, 'grp-a', '   ')).toBe(twoGroupConfig)
    expect(renameGroup(twoGroupConfig, 'no-such-group', '新名字')).toBe(twoGroupConfig)
  })
})

// ---------------------------------------------------------------------------
// GC6: updateGroupDescription（描述允許清空，與 renameGroup 不同）
// ---------------------------------------------------------------------------

describe('GC6 updateGroupDescription', () => {
  const descConfig = {
    version: 1 as const,
    groups: [
      { id: 'grp-a', name: 'A 群', order: 1, description: '原本 A 描述' },
      { id: 'grp-b', name: 'B 群', order: 2, description: '原本 B 描述' },
    ],
    mappings: [{ teamId: 'sw', groupId: 'grp-a' }],
  }

  it('正常設定描述（含 trim），原 config 不被 mutate（純函式）', () => {
    const next = updateGroupDescription(descConfig, 'grp-a', '  交付群新描述  ')
    expect(next.groups.find((g) => g.id === 'grp-a')!.description).toBe('交付群新描述')
    // 原 config 不變
    expect(descConfig.groups.find((g) => g.id === 'grp-a')!.description).toBe('原本 A 描述')
    expect(next).not.toBe(descConfig)
  })

  it('trim 後為空字串 → 存 undefined（允許清空，與 renameGroup 不同）', () => {
    const next = updateGroupDescription(descConfig, 'grp-a', '   ')
    expect(next.groups.find((g) => g.id === 'grp-a')!.description).toBeUndefined()
    // 原 config 仍保留原描述
    expect(descConfig.groups.find((g) => g.id === 'grp-a')!.description).toBe('原本 A 描述')
  })

  it('空字串輸入 → 存 undefined', () => {
    const next = updateGroupDescription(descConfig, 'grp-a', '')
    expect(next.groups.find((g) => g.id === 'grp-a')!.description).toBeUndefined()
  })

  it('groupId 不存在 → 回傳原 config（同參考，不變）', () => {
    expect(updateGroupDescription(descConfig, 'no-such-group', '某描述')).toBe(descConfig)
  })

  it('只動目標群，其他群與 mappings 不變', () => {
    const next = updateGroupDescription(descConfig, 'grp-a', '只改 A')
    expect(next.groups.find((g) => g.id === 'grp-a')!.description).toBe('只改 A')
    // grp-b 與其 name 不動
    expect(next.groups.find((g) => g.id === 'grp-b')!.description).toBe('原本 B 描述')
    expect(next.groups.find((g) => g.id === 'grp-b')!.name).toBe('B 群')
    // 目標群其他欄位（name/order/id）保留
    const a = next.groups.find((g) => g.id === 'grp-a')!
    expect(a.name).toBe('A 群')
    expect(a.order).toBe(1)
    // mappings 不變
    expect(next.mappings).toEqual(descConfig.mappings)
    expect(next.mappings).toBe(descConfig.mappings)
  })
})

// ---------------------------------------------------------------------------
// GC7: migrateGroupConfig — 系統群注入 + agent-ops 強制歸系統群 + 冪等
// ---------------------------------------------------------------------------

describe('GC7 migrateGroupConfig', () => {
  /** 不含系統群的舊版設定（模擬老用戶設定） */
  const oldConfig = {
    version: 1 as const,
    groups: [
      { id: 'deliver', name: '交付群', order: 1 },
      { id: 'infra', name: '基礎群', order: 2 },
    ],
    mappings: [
      { teamId: 'sw', groupId: 'deliver' },
      { teamId: 'agent-ops', groupId: 'deliver' }, // agent-ops 誤放 deliver
    ],
  }

  it('舊設定（無系統群）→ 遷移後含系統群且排最前', () => {
    const next = migrateGroupConfig(oldConfig)
    expect(next.groups[0].id).toBe(SYSTEM_GROUP_ID)
    expect(next.groups[0].isSystem).toBe(true)
  })

  it('舊設定：agent-ops 被誤放別群 → 遷移後移正回系統群', () => {
    const next = migrateGroupConfig(oldConfig)
    const mapping = next.mappings.find((m) => m.teamId === 'agent-ops')
    expect(mapping).toBeDefined()
    expect(mapping!.groupId).toBe(SYSTEM_GROUP_ID)
    // 不再有 agent-ops 指向 deliver
    expect(next.mappings.some((m) => m.teamId === 'agent-ops' && m.groupId === 'deliver')).toBe(false)
  })

  it('舊設定：sw → deliver 映射保留不動', () => {
    const next = migrateGroupConfig(oldConfig)
    expect(next.mappings.find((m) => m.teamId === 'sw')?.groupId).toBe('deliver')
  })

  it('已含系統群且正確的 config 再跑一次 → 回傳原物件參考（嚴格冪等）', () => {
    const next = migrateGroupConfig(oldConfig)
    const next2 = migrateGroupConfig(next)
    expect(next2).toBe(next)
  })

  it('DEFAULT_GROUP_CONFIG 已含系統群 + agent-ops mapping → migrateGroupConfig 回傳原物件', () => {
    const result = migrateGroupConfig(DEFAULT_GROUP_CONFIG)
    expect(result).toBe(DEFAULT_GROUP_CONFIG)
  })

  it('複合鍵 agent-ops（x::agent-ops）被誤放別群 → 遷移後移正回系統群', () => {
    const config = {
      version: 1 as const,
      groups: [SYSTEM_GROUP_DEF, { id: 'deliver', name: '交付群', order: 1 }],
      mappings: [
        { teamId: 'src1::agent-ops', groupId: 'deliver' }, // 複合鍵誤放
        { teamId: 'sw', groupId: 'deliver' },
      ],
    }
    const next = migrateGroupConfig(config)
    // 複合鍵的 agent-ops 不再歸 deliver
    expect(next.mappings.some((m) => m.teamId === 'src1::agent-ops' && m.groupId === 'deliver')).toBe(false)
    // 有至少一條 agent-ops → SYSTEM_GROUP_ID
    const hasSystemAgentOps = next.mappings.some(
      (m) => (m.teamId === 'agent-ops' || m.teamId === 'src1::agent-ops') && m.groupId === SYSTEM_GROUP_ID,
    )
    expect(hasSystemAgentOps).toBe(true)
  })

  it('孤兒 mapping（指向不存在群）在遷移後被清除', () => {
    const config = {
      version: 1 as const,
      groups: [SYSTEM_GROUP_DEF],
      mappings: [
        { teamId: 'agent-ops', groupId: SYSTEM_GROUP_ID },
        { teamId: 'orphan-team', groupId: 'deleted-group' }, // 孤兒
      ],
    }
    const next = migrateGroupConfig(config)
    expect(next.mappings.some((m) => m.teamId === 'orphan-team')).toBe(false)
    // agent-ops 系統映射保留
    expect(next.mappings.some((m) => m.teamId === 'agent-ops' && m.groupId === SYSTEM_GROUP_ID)).toBe(true)
  })

  it('系統群定義漂移（isSystem 被清掉）→ 遷移後還原為 SYSTEM_GROUP_DEF', () => {
    const driftedSysGroup = { id: SYSTEM_GROUP_ID, name: '被改名了', order: 0 } // isSystem 缺失
    const config = {
      version: 1 as const,
      groups: [driftedSysGroup, { id: 'deliver', name: '交付群', order: 1 }],
      mappings: [
        { teamId: 'agent-ops', groupId: SYSTEM_GROUP_ID },
      ],
    }
    const next = migrateGroupConfig(config)
    const sys = next.groups.find((g) => g.id === SYSTEM_GROUP_ID)!
    expect(sys.isSystem).toBe(true)
    expect(sys.name).toBe(SYSTEM_GROUP_DEF.name)
  })
})

// ---------------------------------------------------------------------------
// GC8: updateGroupSource — 設定/清空
// ---------------------------------------------------------------------------

describe('GC8 updateGroupSource', () => {
  const srcConfig = {
    version: 1 as const,
    groups: [
      { id: 'grp-a', name: 'A 群', order: 1 },
      { id: 'grp-b', name: 'B 群', order: 2, sourceId: 'existing-src' },
    ],
    mappings: [{ teamId: 'sw', groupId: 'grp-a' }],
  }

  it('設定 sourceId → 新 config 對應群帶 sourceId（原 config 不 mutate）', () => {
    const next = updateGroupSource(srcConfig, 'grp-a', 'src-gdrive')
    expect(next.groups.find((g) => g.id === 'grp-a')!.sourceId).toBe('src-gdrive')
    // 原 config 不動
    expect(srcConfig.groups.find((g) => g.id === 'grp-a')!.sourceId).toBeUndefined()
    expect(next).not.toBe(srcConfig)
  })

  it('空字串清空 sourceId → sourceId 變 undefined', () => {
    const next = updateGroupSource(srcConfig, 'grp-b', '')
    expect(next.groups.find((g) => g.id === 'grp-b')!.sourceId).toBeUndefined()
  })

  it('undefined 清空 sourceId → sourceId 變 undefined', () => {
    const next = updateGroupSource(srcConfig, 'grp-b', undefined)
    expect(next.groups.find((g) => g.id === 'grp-b')!.sourceId).toBeUndefined()
  })

  it('純空白字串清空 sourceId → sourceId 變 undefined', () => {
    const next = updateGroupSource(srcConfig, 'grp-b', '   ')
    expect(next.groups.find((g) => g.id === 'grp-b')!.sourceId).toBeUndefined()
  })

  it('groupId 不存在 → 回傳原 config 同參考', () => {
    expect(updateGroupSource(srcConfig, 'no-such-group', 'src-x')).toBe(srcConfig)
  })

  it('只動目標群，其他群與 mappings 不變', () => {
    const next = updateGroupSource(srcConfig, 'grp-a', 'new-src')
    expect(next.groups.find((g) => g.id === 'grp-b')!.sourceId).toBe('existing-src')
    expect(next.groups.find((g) => g.id === 'grp-b')!.name).toBe('B 群')
    expect(next.mappings).toEqual(srcConfig.mappings)
  })
})

// ---------------------------------------------------------------------------
// GC9: computeTeamsToRelocate（行為乙 §1.4）
// ---------------------------------------------------------------------------

describe('GC9 computeTeamsToRelocate', () => {
  /** 基礎 config fixture：兩個群，含多種系統鍵 */
  const baseConfig = {
    version: 1 as const,
    groups: [
      { id: 'grp-a', name: 'A 群', order: 1 },
      { id: 'grp-b', name: 'B 群', order: 2 },
    ],
    mappings: [
      // grp-a：裸鍵、複合鍵、agent-ops
      { teamId: 'sw',              groupId: 'grp-a' },
      { teamId: 'hw',              groupId: 'grp-a' },
      { teamId: 'src1::edu',       groupId: 'grp-a' },
      { teamId: 'agent-ops',       groupId: 'grp-a' }, // 應硬排除
      // grp-b：不受影響
      { teamId: 'billing',         groupId: 'grp-b' },
      { teamId: 'src2::devops',    groupId: 'grp-b' },
    ],
  }

  it('只取目標群（grp-a）的 mapping', () => {
    const keys = computeTeamsToRelocate(baseConfig, 'grp-a', 'src1')
    // 只有 grp-a 的隊，grp-b 不出現
    expect(keys).not.toContain('billing')
    expect(keys).not.toContain('src2::devops')
  })

  it('硬排除 agent-ops（裸鍵）', () => {
    const keys = computeTeamsToRelocate(baseConfig, 'grp-a', 'src1')
    expect(keys).not.toContain('agent-ops')
  })

  it('跳過已在目標來源的裸鍵（toSourceId==="default"）', () => {
    // 裸鍵 sw/hw 代表 default 來源，toSourceId=default → 應跳過
    const keys = computeTeamsToRelocate(baseConfig, 'grp-a', 'default')
    expect(keys).not.toContain('sw')
    expect(keys).not.toContain('hw')
    // 複合鍵 src1::edu 來源非 default → 應包含
    expect(keys).toContain('src1::edu')
  })

  it('跳過已在目標來源的複合鍵（sourceId === toSourceId）', () => {
    // src1::edu 已在 src1，toSourceId=src1 → 跳過
    const keys = computeTeamsToRelocate(baseConfig, 'grp-a', 'src1')
    expect(keys).not.toContain('src1::edu')
    // 裸鍵 sw/hw 來源是 default，不等於 src1 → 應包含
    expect(keys).toContain('sw')
    expect(keys).toContain('hw')
  })

  it('其他群（grp-b）的隊不受影響', () => {
    const keys = computeTeamsToRelocate(baseConfig, 'grp-a', 'src1')
    expect(keys).not.toContain('billing')
    expect(keys).not.toContain('src2::devops')
  })

  it('空群（groupId 無 mapping）回傳空陣列', () => {
    const keys = computeTeamsToRelocate(baseConfig, 'nonexistent-grp', 'src1')
    expect(keys).toHaveLength(0)
  })

  it('群內全是 agent-ops 時回傳空陣列', () => {
    const config = {
      version: 1 as const,
      groups: [{ id: 'sys', name: '系統群', order: 0 }],
      mappings: [
        { teamId: 'agent-ops', groupId: 'sys' },
        { teamId: 'src1::agent-ops', groupId: 'sys' },
      ],
    }
    expect(computeTeamsToRelocate(config, 'sys', 'src1')).toHaveLength(0)
  })

  it('純函式：不改入參 config', () => {
    const before = JSON.stringify(baseConfig)
    computeTeamsToRelocate(baseConfig, 'grp-a', 'src1')
    expect(JSON.stringify(baseConfig)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// GC10: applyRelocationResult（行為乙 §1.5 + §3.1）
// ---------------------------------------------------------------------------

describe('GC10 applyRelocationResult', () => {
  /** 基礎 config fixture */
  const baseConfig = {
    version: 1 as const,
    groups: [
      { id: 'grp-a', name: 'A 群', order: 1 },
      { id: 'grp-b', name: 'B 群', order: 2 },
    ],
    mappings: [
      { teamId: 'sw',           groupId: 'grp-a' },
      { teamId: 'hw',           groupId: 'grp-a' },
      { teamId: 'src1::edu',    groupId: 'grp-a' },
      { teamId: 'billing',      groupId: 'grp-b' },
    ],
  }

  it('全成功 → 目標群 mapping 換 newKey + groupId 寫入 sourceId', () => {
    const results: import('../src/shared/ipc/contracts/agentOrg').ApplyGroupSourceResult['results'] = [
      { oldKey: 'sw',        newKey: 'src2::sw',        ok: true,  displayName: 'SW' },
      { oldKey: 'hw',        newKey: 'src2::hw',        ok: true,  displayName: 'HW' },
      { oldKey: 'src1::edu', newKey: 'src2::edu',       ok: true,  displayName: 'Edu' },
    ]
    const next = applyRelocationResult(baseConfig, 'grp-a', 'src2', results)

    // mapping 換鍵
    expect(next.mappings).toContainEqual({ teamId: 'src2::sw',  groupId: 'grp-a' })
    expect(next.mappings).toContainEqual({ teamId: 'src2::hw',  groupId: 'grp-a' })
    expect(next.mappings).toContainEqual({ teamId: 'src2::edu', groupId: 'grp-a' })
    // 舊鍵不再存在
    expect(next.mappings.find((m) => m.teamId === 'sw')).toBeUndefined()
    expect(next.mappings.find((m) => m.teamId === 'hw')).toBeUndefined()
    expect(next.mappings.find((m) => m.teamId === 'src1::edu')).toBeUndefined()
    // sourceId 寫入
    expect(next.groups.find((g) => g.id === 'grp-a')!.sourceId).toBe('src2')
    // grp-b 不受影響
    expect(next.mappings).toContainEqual({ teamId: 'billing', groupId: 'grp-b' })
  })

  it('部分失敗 → 成功者換鍵、失敗者留 oldKey + sourceId 仍寫入（≥1 成功）', () => {
    const results: import('../src/shared/ipc/contracts/agentOrg').ApplyGroupSourceResult['results'] = [
      { oldKey: 'sw',        newKey: 'src2::sw',  ok: true,  displayName: 'SW' },
      { oldKey: 'hw',        newKey: 'src2::hw',  ok: false, message: '目標衝突', displayName: 'HW' },
    ]
    const next = applyRelocationResult(baseConfig, 'grp-a', 'src2', results)

    // 成功的換鍵
    expect(next.mappings).toContainEqual({ teamId: 'src2::sw', groupId: 'grp-a' })
    // 失敗的保留 oldKey
    expect(next.mappings).toContainEqual({ teamId: 'hw', groupId: 'grp-a' })
    // ≥1 成功 → sourceId 仍寫入
    expect(next.groups.find((g) => g.id === 'grp-a')!.sourceId).toBe('src2')
  })

  it('全失敗 → mapping 不動 + sourceId 不寫', () => {
    const results: import('../src/shared/ipc/contracts/agentOrg').ApplyGroupSourceResult['results'] = [
      { oldKey: 'sw', newKey: 'src2::sw', ok: false, message: '失敗', displayName: 'SW' },
      { oldKey: 'hw', newKey: 'src2::hw', ok: false, message: '失敗', displayName: 'HW' },
    ]
    const next = applyRelocationResult(baseConfig, 'grp-a', 'src2', results)

    // mapping 不變
    expect(next.mappings).toContainEqual({ teamId: 'sw', groupId: 'grp-a' })
    expect(next.mappings).toContainEqual({ teamId: 'hw', groupId: 'grp-a' })
    // sourceId 不寫（維持原值 undefined）
    expect(next.groups.find((g) => g.id === 'grp-a')!.sourceId).toBeUndefined()
  })

  it('results.length===0（空群）→ sourceId 寫入（純設定變更，行為乙退化成行為甲）', () => {
    const next = applyRelocationResult(baseConfig, 'grp-a', 'src2', [])
    expect(next.groups.find((g) => g.id === 'grp-a')!.sourceId).toBe('src2')
    // mapping 完全不動
    expect(next.mappings).toEqual(baseConfig.mappings)
  })

  it('其他群的 mapping 一律不動（只動 groupId===targetGroupId）', () => {
    const results: import('../src/shared/ipc/contracts/agentOrg').ApplyGroupSourceResult['results'] = [
      { oldKey: 'sw', newKey: 'src2::sw', ok: true, displayName: 'SW' },
    ]
    const next = applyRelocationResult(baseConfig, 'grp-a', 'src2', results)
    // grp-b 的 billing 不動
    expect(next.mappings).toContainEqual({ teamId: 'billing', groupId: 'grp-b' })
    expect(next.groups.find((g) => g.id === 'grp-b')!.sourceId).toBeUndefined()
  })

  it('純函式：不改入參 config', () => {
    const before = JSON.stringify(baseConfig)
    applyRelocationResult(baseConfig, 'grp-a', 'src2', [
      { oldKey: 'sw', newKey: 'src2::sw', ok: true, displayName: 'SW' },
    ])
    expect(JSON.stringify(baseConfig)).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// GC9: moveGroup — 群組順序上/下移動
// ---------------------------------------------------------------------------

describe('GC9 moveGroup 群組順序調整', () => {
  // 系統群(order 0) + 三個可調動群 a/b/c（order 1/2/3）
  function makeConfig(): typeof DEFAULT_GROUP_CONFIG {
    return {
      version: 1,
      groups: [
        SYSTEM_GROUP_DEF,
        { id: 'a', name: 'A', order: 1 },
        { id: 'b', name: 'B', order: 2 },
        { id: 'c', name: 'C', order: 3 },
      ],
      mappings: [],
    }
  }

  // 取「依 order 排序後」的可調動群 id 序列（驗證視覺順序）
  function movableOrder(cfg: typeof DEFAULT_GROUP_CONFIG): string[] {
    return cfg.groups
      .filter((g) => !g.isSystem)
      .slice()
      .sort((x, y) => x.order - y.order)
      .map((g) => g.id)
  }

  it('往下移：b down → 順序變 a, c, b', () => {
    const out = moveGroup(makeConfig(), 'b', 'down')
    expect(movableOrder(out)).toEqual(['a', 'c', 'b'])
  })

  it('往上移：c up → 順序變 a, c, b', () => {
    const out = moveGroup(makeConfig(), 'c', 'up')
    expect(movableOrder(out)).toEqual(['a', 'c', 'b'])
  })

  it('系統群維持 order 0、不參與調動', () => {
    const out = moveGroup(makeConfig(), 'a', 'down')
    const sys = out.groups.find((g) => g.id === SYSTEM_GROUP_ID)
    expect(sys?.order).toBe(0)
    // 可調動群被重新編號為 1,2,3（連續、無 0）
    const orders = out.groups.filter((g) => !g.isSystem).map((g) => g.order).sort()
    expect(orders).toEqual([1, 2, 3])
  })

  it('頂端往上 = 邊界無動作（回傳原 config 參考）', () => {
    const cfg = makeConfig()
    expect(moveGroup(cfg, 'a', 'up')).toBe(cfg)
  })

  it('底端往下 = 邊界無動作（回傳原 config 參考）', () => {
    const cfg = makeConfig()
    expect(moveGroup(cfg, 'c', 'down')).toBe(cfg)
  })

  it('系統群不可調動（回傳原 config 參考）', () => {
    const cfg = makeConfig()
    expect(moveGroup(cfg, SYSTEM_GROUP_ID, 'down')).toBe(cfg)
  })

  it('不存在的 groupId = 回傳原 config 參考', () => {
    const cfg = makeConfig()
    expect(moveGroup(cfg, 'nope', 'up')).toBe(cfg)
  })

  it('純函式：不改入參', () => {
    const cfg = makeConfig()
    const before = JSON.stringify(cfg)
    moveGroup(cfg, 'b', 'down')
    expect(JSON.stringify(cfg)).toBe(before)
  })

  it('order 重複的舊資料也能正確調動（重新編號消除死角）', () => {
    const cfg: typeof DEFAULT_GROUP_CONFIG = {
      version: 1,
      groups: [
        SYSTEM_GROUP_DEF,
        { id: 'a', name: 'A', order: 5 },
        { id: 'b', name: 'B', order: 5 },
      ],
      mappings: [],
    }
    const out = moveGroup(cfg, 'a', 'down')
    expect(movableOrder(out)).toEqual(['b', 'a'])
  })
})
