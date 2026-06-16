/**
 * agentTeamsBuildGraph.spec.ts — buildOrgGraph.ts + applyDagreLayout 純邏輯單元測試
 *
 * 覆蓋：
 *   BG1: buildOrgGraph — nodes/edges 數量、id 格式
 *   BG2: 收合 team → 該 team 的 worker 節點不存在（collapsedTeams）
 *   BG3: 收合 group → 該 group 的 team 節點不存在（collapsedGroups）
 *   BG4: manager 不在 worker 節點中（需求2 回歸）
 *   BG5: worker 帶 roleInTeam（需求3 回歸）
 *   BG6: applyDagreLayout — 回傳節點帶 position、worker 水平 grid
 *
 * 使用最小 fixture（手構 AgentTeamDto），無 React/DOM 依賴。
 */

import { describe, it, expect } from 'vitest'
import type { AgentTeamDto, AgentNodeDto } from '../src/shared/ipcContracts'
import { DEFAULT_GROUP_CONFIG } from '../src/renderer/views/AgentTeams/groupConfig'
import { buildOrgGraph, applyDagreLayout } from '../src/renderer/views/AgentTeams/buildOrgGraph'
import type { OrgCallbacks } from '../src/renderer/views/AgentTeams/buildOrgGraph'

// ---------------------------------------------------------------------------
// Fixture 工具
// ---------------------------------------------------------------------------

function makeAgent(overrides: Partial<AgentNodeDto> & { name: string; teamId: string }): AgentNodeDto {
  return {
    id: `${overrides.teamId}/${overrides.name}`,
    name: overrides.name,
    title: overrides.name,
    displayName: overrides.displayName ?? null,
    type: overrides.type ?? 'worker',
    roleInTeam: overrides.roleInTeam ?? null,
    model: overrides.model ?? null,
    trigger: overrides.trigger ?? null,
    notFor: overrides.notFor ?? null,
    platform: overrides.platform ?? 'builtin:local',
  }
}

function makeManager(name: string, teamId: string): AgentNodeDto {
  return makeAgent({ name, teamId, type: 'manager', roleInTeam: 'lead' })
}

/**
 * 建立一個最小 AgentTeamDto。
 * id 必須對應到 DEFAULT_GROUP_CONFIG.mappings 中的 teamId，
 * 否則 groupTeams 會把它丟到 UNCLASSIFIED_GROUP。
 */
function makeTeam(
  id: string,
  opts: {
    managerName?: string
    workerNames?: string[]
    workerRoles?: string[]
  } = {},
): AgentTeamDto {
  const manager = opts.managerName
    ? makeManager(opts.managerName, id)
    : null

  const agents = (opts.workerNames ?? []).map((name, i) =>
    makeAgent({
      name,
      teamId: id,
      roleInTeam: opts.workerRoles?.[i] ?? null,
    }),
  )

  return { id, manager, agents }
}

const NO_CALLBACKS: OrgCallbacks = {}

// ---------------------------------------------------------------------------
// BG1: buildOrgGraph — nodes/edges 數量與 id 格式
// ---------------------------------------------------------------------------

describe('BG1 buildOrgGraph nodes/edges 數量與 id 格式', () => {
  it('無 teams → 只有空群 header 節點（真實事業群保留以供建團隊），無 team/worker 節點與 edges', () => {
    const { nodes, edges } = buildOrgGraph([], DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    // 空 teams → groupTeams 保留真實事業群 header（commit 70f9991「空群顯示」）→ 只有 group 節點
    expect(nodes.every((n) => n.type === 'group')).toBe(true)
    expect(nodes.filter((n) => n.type === 'team')).toHaveLength(0)
    expect(nodes.filter((n) => n.type === 'worker')).toHaveLength(0)
    // 無 team → 無 group→team 邊
    expect(edges).toHaveLength(0)
  })

  it('單一 team（1 group + 1 team + N workers）節點數正確', () => {
    const teams = [makeTeam('sw', { managerName: 'manager', workerNames: ['developer', 'tester'] })]
    const { nodes, edges } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)

    // 真實事業群即使空也保留 header（commit 70f9991），故 group 節點數 = 設定的群數；
    // 此測試只驗有 team 的群（deliver）存在 + team/worker 數正確。
    const groupNodes   = nodes.filter((n) => n.type === 'group')
    const teamNodes    = nodes.filter((n) => n.type === 'team')
    const workerNodes  = nodes.filter((n) => n.type === 'worker')

    expect(groupNodes.map((n) => n.id)).toContain('group-deliver')
    expect(teamNodes).toHaveLength(1)
    expect(workerNodes).toHaveLength(2)

    // edges: group→team(1) + team→worker1(1) + team→worker2(1)
    expect(edges).toHaveLength(3)
  })

  it('group 節點 id 格式為 group-{groupId}', () => {
    const teams = [makeTeam('sw', { managerName: 'manager' })]
    const { nodes } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    const groupNode = nodes.find((n) => n.type === 'group')!
    expect(groupNode.id).toBe('group-deliver')
  })

  it('team 節點 id 格式為 team-{teamId}', () => {
    const teams = [makeTeam('sw', { managerName: 'manager' })]
    const { nodes } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    const teamNode = nodes.find((n) => n.type === 'team')!
    expect(teamNode.id).toBe('team-sw')
  })

  it('worker 節點 id 格式為 worker-{teamId}/{agentName}', () => {
    const teams = [makeTeam('sw', { managerName: 'manager', workerNames: ['developer'] })]
    const { nodes } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    const workerNode = nodes.find((n) => n.type === 'worker')!
    expect(workerNode.id).toBe('worker-sw/developer')
  })

  it('多個 teams 產生正確數量的 group→team edges', () => {
    const teams = [
      makeTeam('sw',      { workerNames: ['developer'] }),
      makeTeam('hw',      { workerNames: ['pcb-designer'] }),
    ]
    const { nodes, edges } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)

    // 兩個 team 都在 deliver 群（data/infra 空群也保留 header）→ 2 team + 2 worker，group 含 deliver
    expect(nodes.filter((n) => n.type === 'group').map((n) => n.id)).toContain('group-deliver')
    expect(nodes.filter((n) => n.type === 'team')).toHaveLength(2)
    expect(nodes.filter((n) => n.type === 'worker')).toHaveLength(2)

    const groupToTeamEdges = edges.filter(
      (e) => e.source.startsWith('group-') && e.target.startsWith('team-'),
    )
    expect(groupToTeamEdges).toHaveLength(2)

    const teamToWorkerEdges = edges.filter(
      (e) => e.source.startsWith('team-') && e.target.startsWith('worker-'),
    )
    expect(teamToWorkerEdges).toHaveLength(2)
  })

  it('跨群 teams 各產生自己的 group 節點', () => {
    const teams = [
      makeTeam('sw',       { workerNames: ['dev'] }),       // deliver 群
      makeTeam('web-to-db', { workerNames: ['scraper'] }),  // data 群
    ]
    const { nodes } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)

    // 真實事業群即使空也保留 header（infra 群無 team 也在），故不驗 group 總數；
    // 此測試驗「跨群的兩個 team 各自的 group 節點都存在且不同」。
    const { edges } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    const groupNodes = nodes.filter((n) => n.type === 'group')
    const groupIds = groupNodes.map((n) => n.id)
    expect(groupIds).toContain('group-deliver')
    expect(groupIds).toContain('group-data')
    // group→team 邊把兩個 team 連到各自不同的 group
    const swGroup = edges.find((e) => e.target === 'team-sw')?.source
    const dbGroup = edges.find((e) => e.target === 'team-web-to-db')?.source
    expect(swGroup).toBe('group-deliver')
    expect(dbGroup).toBe('group-data')
  })
})

// ---------------------------------------------------------------------------
// BG2: 收合 team → worker 節點不存在
// ---------------------------------------------------------------------------

describe('BG2 collapsedTeams：收合 team 時 worker 節點不存在', () => {
  it('collapsedTeams 包含 teamId 時，該 team 無 worker 節點', () => {
    const teams = [makeTeam('sw', { workerNames: ['developer', 'tester'] })]
    const { nodes } = buildOrgGraph(
      teams,
      DEFAULT_GROUP_CONFIG,
      new Set(['sw']), // 收合 sw
      NO_CALLBACKS,
    )

    const workerNodes = nodes.filter((n) => n.type === 'worker')
    expect(workerNodes).toHaveLength(0)
  })

  it('收合 team 時，team 節點本身仍存在', () => {
    const teams = [makeTeam('sw', { workerNames: ['developer'] })]
    const { nodes } = buildOrgGraph(
      teams,
      DEFAULT_GROUP_CONFIG,
      new Set(['sw']),
      NO_CALLBACKS,
    )

    const teamNode = nodes.find((n) => n.id === 'team-sw')
    expect(teamNode).toBeDefined()
  })

  it('收合 team 時，team→worker edges 不存在', () => {
    const teams = [makeTeam('sw', { workerNames: ['developer'] })]
    const { edges } = buildOrgGraph(
      teams,
      DEFAULT_GROUP_CONFIG,
      new Set(['sw']),
      NO_CALLBACKS,
    )

    const teamToWorker = edges.filter((e) => e.source === 'team-sw' && e.target.startsWith('worker-'))
    expect(teamToWorker).toHaveLength(0)
  })

  it('只收合一個 team，其他 team 的 worker 仍正常存在', () => {
    const teams = [
      makeTeam('sw', { workerNames: ['developer'] }),  // 收合
      makeTeam('hw', { workerNames: ['pcb-designer'] }), // 展開
    ]
    const { nodes } = buildOrgGraph(
      teams,
      DEFAULT_GROUP_CONFIG,
      new Set(['sw']), // 只收合 sw
      NO_CALLBACKS,
    )

    const workerNodes = nodes.filter((n) => n.type === 'worker')
    expect(workerNodes).toHaveLength(1)
    expect(workerNodes[0].id).toBe('worker-hw/pcb-designer')
  })
})

// ---------------------------------------------------------------------------
// BG3: 收合 group → team 節點不存在
// ---------------------------------------------------------------------------

describe('BG3 collapsedGroups：收合 group 時 team 節點不存在', () => {
  it('collapsedGroups 包含 groupId 時，該 group 的 team 節點不存在', () => {
    const teams = [
      makeTeam('sw',  { workerNames: ['developer'] }),
      makeTeam('hw',  { workerNames: ['pcb'] }),
    ]
    const { nodes } = buildOrgGraph(
      teams,
      DEFAULT_GROUP_CONFIG,
      new Set(),       // collapsedTeams 空
      NO_CALLBACKS,
      new Set(['deliver']), // 收合 deliver 群
    )

    const teamNodes = nodes.filter((n) => n.type === 'team')
    expect(teamNodes).toHaveLength(0)
  })

  it('收合 group 時，worker 節點也不存在', () => {
    const teams = [makeTeam('sw', { workerNames: ['developer'] })]
    const { nodes } = buildOrgGraph(
      teams,
      DEFAULT_GROUP_CONFIG,
      new Set(),
      NO_CALLBACKS,
      new Set(['deliver']),
    )

    const workerNodes = nodes.filter((n) => n.type === 'worker')
    expect(workerNodes).toHaveLength(0)
  })

  it('收合 group 時，group 節點本身仍存在', () => {
    const teams = [makeTeam('sw', { workerNames: ['developer'] })]
    const { nodes } = buildOrgGraph(
      teams,
      DEFAULT_GROUP_CONFIG,
      new Set(),
      NO_CALLBACKS,
      new Set(['deliver']),
    )

    const groupNode = nodes.find((n) => n.id === 'group-deliver')
    expect(groupNode).toBeDefined()
  })

  it('只收合一個 group，其他 group 的 team 和 worker 仍存在', () => {
    const teams = [
      makeTeam('sw',       { workerNames: ['dev'] }),     // deliver → 收合
      makeTeam('web-to-db', { workerNames: ['scraper'] }), // data → 展開
    ]
    const { nodes } = buildOrgGraph(
      teams,
      DEFAULT_GROUP_CONFIG,
      new Set(),
      NO_CALLBACKS,
      new Set(['deliver']),
    )

    const teamNodes = nodes.filter((n) => n.type === 'team')
    expect(teamNodes).toHaveLength(1)
    expect(teamNodes[0].id).toBe('team-web-to-db')

    const workerNodes = nodes.filter((n) => n.type === 'worker')
    expect(workerNodes).toHaveLength(1)
    expect(workerNodes[0].id).toBe('worker-web-to-db/scraper')
  })
})

// ---------------------------------------------------------------------------
// BG4: manager 不在 worker 節點中（需求2 回歸）
// ---------------------------------------------------------------------------

describe('BG4 manager 不在 worker 節點中（需求2 回歸）', () => {
  it('team 有 manager 時，worker 節點不含 manager', () => {
    const teams = [makeTeam('sw', { managerName: 'manager', workerNames: ['developer', 'tester'] })]
    const { nodes } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)

    const workerNodes = nodes.filter((n) => n.type === 'worker')
    const workerIds = workerNodes.map((n) => n.id)

    // manager 不應出現在 worker 節點
    expect(workerIds).not.toContain('worker-sw/manager')
    // developer 和 tester 應存在
    expect(workerIds).toContain('worker-sw/developer')
    expect(workerIds).toContain('worker-sw/tester')
  })

  it('team 無 agents 時（只有 manager），worker 節點數為 0', () => {
    const teams = [makeTeam('sw', { managerName: 'manager' })]
    const { nodes } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)

    const workerNodes = nodes.filter((n) => n.type === 'worker')
    expect(workerNodes).toHaveLength(0)
  })

  it('team 無 manager 且無 agents 時，worker 節點數為 0', () => {
    const teams = [makeTeam('sw')]
    const { nodes } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)

    const workerNodes = nodes.filter((n) => n.type === 'worker')
    expect(workerNodes).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// BG5: worker 帶 roleInTeam（需求3 回歸）
// ---------------------------------------------------------------------------

describe('BG5 WorkerNodeData.roleInTeam（需求3 回歸）', () => {
  it('agent.roleInTeam 正確帶入 worker node data', () => {
    const teams = [
      makeTeam('sw', {
        workerNames: ['developer', 'tester'],
        workerRoles: ['doer', 'verifier'],
      }),
    ]
    const { nodes } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)

    const devNode = nodes.find((n) => n.id === 'worker-sw/developer')!
    const testNode = nodes.find((n) => n.id === 'worker-sw/tester')!

    expect(devNode.data.roleInTeam).toBe('doer')
    expect(testNode.data.roleInTeam).toBe('verifier')
  })

  it('agent.roleInTeam 為 null 時 worker node data.roleInTeam 為 undefined', () => {
    const teams = [makeTeam('sw', { workerNames: ['dev'] })] // roleInTeam 預設 null
    const { nodes } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)

    const workerNode = nodes.find((n) => n.id === 'worker-sw/dev')!
    // null → undefined（src 程式碼：agent.roleInTeam ?? undefined）
    expect(workerNode.data.roleInTeam).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// BG6: applyDagreLayout — position + worker grid
// ---------------------------------------------------------------------------

describe('BG6 applyDagreLayout — position 與 worker 水平 grid', () => {
  it('回傳節點帶有 position（x/y 為 number）', () => {
    const teams = [makeTeam('sw', { workerNames: ['dev', 'tester'] })]
    const { nodes, edges } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    const laid = applyDagreLayout(nodes, edges)

    for (const n of laid) {
      expect(typeof n.position.x).toBe('number')
      expect(typeof n.position.y).toBe('number')
    }
  })

  it('group 節點 position 非 (0,0)（dagre 已分配）', () => {
    const teams = [makeTeam('sw', { workerNames: ['dev'] })]
    const { nodes, edges } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    const laid = applyDagreLayout(nodes, edges)

    const groupNode = laid.find((n) => n.type === 'group')!
    // dagre 應給非 (0,0) 座標
    const hasNonZero = groupNode.position.x !== 0 || groupNode.position.y !== 0
    expect(hasNonZero).toBe(true)
  })

  it('同 team 的多個 worker 水平排列（x 遞增，非全同）', () => {
    // 需要 > 1 個 worker 才能驗水平差異
    const teams = [makeTeam('sw', { workerNames: ['dev', 'tester', 'reviewer'] })]
    const { nodes, edges } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    const laid = applyDagreLayout(nodes, edges)

    const workerNodes = laid
      .filter((n) => n.type === 'worker')
      .sort((a, b) => a.id.localeCompare(b.id))

    expect(workerNodes.length).toBeGreaterThanOrEqual(2)

    // 取出 x 值，確認不全相同（至少有一對 x 不同）
    const xs = workerNodes.map((n) => n.position.x)
    const allSame = xs.every((x) => x === xs[0])
    expect(allSame).toBe(false)
  })

  it('同 team 的 worker x 座標嚴格遞增（按加入順序排列的前 perRow 個）', () => {
    // sw team，3 個 worker，不超過 perRow=4，應在同一排
    const teams = [makeTeam('sw', { workerNames: ['w1', 'w2', 'w3'] })]
    const { nodes, edges } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    const laid = applyDagreLayout(nodes, edges)

    // 依 node id 排序取得 worker 節點（id 為 worker-sw/w1, w2, w3）
    const workers = laid
      .filter((n) => n.type === 'worker')
      .sort((a, b) => a.id.localeCompare(b.id))

    // 第一排（w1→w2→w3）x 應嚴格遞增
    for (let i = 1; i < workers.length; i++) {
      expect(workers[i].position.x).toBeGreaterThan(workers[i - 1].position.x)
    }
  })

  it('不同 roleInTeam 的 worker 分到不同排（後一 role 列的 y > 前一 role 列）', () => {
    // 當前佈局（commit 8c12902）改為「依 roleInTeam 分組，每 role 一列」取代舊的 perRow=4 wrap。
    // researcher(row0) → doer(row1)：doer 列的 y 應大於 researcher 列。
    const teams = [
      makeTeam('sw', {
        workerNames: ['rsr', 'dev'],
        workerRoles: ['researcher', 'doer'],
      }),
    ]
    const { nodes, edges } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    const laid = applyDagreLayout(nodes, edges)

    const rsr = laid.find((n) => n.id === 'worker-sw/rsr')!
    const dev = laid.find((n) => n.id === 'worker-sw/dev')!

    // researcher 列在 doer 列上方（LR：列 index 決定 y，遞增往下）
    expect(dev.position.y).toBeGreaterThan(rsr.position.y)
  })

  it('同一 roleInTeam 的多個 worker 在同一排（y 相同、x 遞增）', () => {
    // 同 role（含 null role）→ 同列：5 個同 role worker 全在同一個 y、沿 x 橫排。
    const workerNames = ['w1', 'w2', 'w3', 'w4', 'w5']
    const teams = [makeTeam('sw', { workerNames })] // 皆 roleInTeam=null → 同一列
    const { nodes, edges } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    const laid = applyDagreLayout(nodes, edges)

    const workers = laid
      .filter((n) => n.type === 'worker')
      .sort((a, b) => a.id.localeCompare(b.id))

    expect(workers).toHaveLength(5)

    // 同 role 同列：y 全相同
    const ys = workers.map((n) => n.position.y)
    expect(ys.every((y) => y === ys[0])).toBe(true)
    // x 嚴格遞增
    for (let i = 1; i < workers.length; i++) {
      expect(workers[i].position.x).toBeGreaterThan(workers[i - 1].position.x)
    }
  })

  it('無 worker 節點時 applyDagreLayout 不報錯', () => {
    const teams = [makeTeam('sw', { managerName: 'manager' })] // 只有 manager，無 worker
    const { nodes, edges } = buildOrgGraph(teams, DEFAULT_GROUP_CONFIG, new Set(), NO_CALLBACKS)
    expect(() => applyDagreLayout(nodes, edges)).not.toThrow()
  })

  it('空 nodes/edges 時 applyDagreLayout 回傳空陣列', () => {
    const result = applyDagreLayout([], [])
    expect(result).toHaveLength(0)
  })
})
