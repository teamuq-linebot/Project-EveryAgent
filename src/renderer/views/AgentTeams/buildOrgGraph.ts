/**
 * buildOrgGraph.ts — 將 AgentTeamDto[] 轉換為 React Flow nodes/edges 並套用 dagre 佈局
 * 設計來源：design-reactflow-refactor.md §2.3/§2.4
 *
 * 純 TS，無 React/DOM 依賴（僅 import type），可獨立 tsc 驗。
 */
import dagre from '@dagrejs/dagre'
import type { AgentTeamDto } from '../../../shared/ipcContracts'
import type { GroupConfig } from './groupConfig'
import { groupTeams } from './groupConfig'
import type {
  OrgNode,
  OrgEdge,
  GroupNodeData,
  TeamNodeData,
  WorkerNodeData,
} from './orgTypes'

// ---------------------------------------------------------------------------
// 節點固定尺寸（設計文件 §2.3 — 避免 DOM 測量時序問題）
// ---------------------------------------------------------------------------
const NODE_SIZE = {
  group:  { width: 180, height: 60  },
  team:   { width: 200, height: 90  },   // 90 = body(51) + ops(28) + border(3) ≈ 實際渲染高
  worker: { width: 160, height: 52  },
} as const

// ---------------------------------------------------------------------------
// callbacks 型別（通過 node.data 傳入自訂節點元件）
// ---------------------------------------------------------------------------
export interface OrgCallbacks {
  onSelectAgent?: (agentName: string, teamId: string) => void
  onOpenAgentOpsSession?: (label: string, prompt: string) => void
  onToggleCollapse?: (teamId: string) => void
  onToggleGroupCollapse?: (groupId: string) => void
}

// ---------------------------------------------------------------------------
// buildOrgGraph — 主轉換函式
// ---------------------------------------------------------------------------

/**
 * 將 AgentTeamDto[] 依 groupConfig 分群，產出 React Flow nodes + edges。
 *
 * @param teams           - agentOrg:scan 回傳的 teams 陣列
 * @param groupConfig     - 當前分組設定（用 DEFAULT_GROUP_CONFIG 或使用者自訂）
 * @param collapsedTeams  - 已收合的 teamId Set（收合時 worker 節點完全不加入，dagre 不佈局）
 * @param callbacks       - 節點事件 callbacks（useCallback 穩定 reference，避免 memo 重建）
 * @param collapsedGroups - 已收合的 groupId Set（收合時 team 節點完全不加入，dagre 不佈局）
 * @returns               - { nodes, edges }（尚未套 dagre 位置，呼叫方再套 applyDagreLayout）
 */
export function buildOrgGraph(
  teams: AgentTeamDto[],
  groupConfig: GroupConfig,
  collapsedTeams: Set<string>,
  callbacks: OrgCallbacks,
  collapsedGroups?: Set<string>,
  rankdir: 'LR' | 'TB' = 'LR',
): { nodes: OrgNode[]; edges: OrgEdge[] } {
  const nodes: OrgNode[] = []
  const edges: OrgEdge[] = []

  const grouped = groupTeams(teams, groupConfig)

  for (const { group, teams: groupTeamList } of grouped) {
    const groupNodeId = `group-${group.id}`
    const isGroupCollapsed = collapsedGroups?.has(group.id) ?? false

    // --- 群節點 ---
    const groupData: GroupNodeData = {
      groupId: group.id,
      name: group.name,
      icon: group.icon,
      color: group.color,
      collapsed: isGroupCollapsed,
      onToggleGroupCollapse: callbacks.onToggleGroupCollapse,
      rankdir,
    }
    nodes.push({
      id: groupNodeId,
      type: 'group',
      position: { x: 0, y: 0 }, // 由 applyDagreLayout 填入
      data: groupData,
      width: NODE_SIZE.group.width,
      height: NODE_SIZE.group.height,
    } as OrgNode)

    // 群收合時：team 節點完全不加入（dagre 不佈局）
    if (isGroupCollapsed) continue

    for (const team of groupTeamList) {
      const teamNodeId = `team-${team.id}`
      const isCollapsed = collapsedTeams.has(team.id)

      // --- Team 節點 ---
      const teamData: TeamNodeData = {
        teamId: team.id,
        managerName: team.manager?.name ?? undefined,
        displayName: team.manager?.displayName ?? team.id,
        collapsed: isCollapsed,
        groupColor: group.color ?? '#94a3b8',
        onSelectAgent: callbacks.onSelectAgent,
        onToggleCollapse: callbacks.onToggleCollapse,
        rankdir,
      }
      nodes.push({
        id: teamNodeId,
        type: 'team',
        position: { x: 0, y: 0 },
        data: teamData,
        width: NODE_SIZE.team.width,
        height: NODE_SIZE.team.height,
      } as OrgNode)

      // 群 → team 邊
      edges.push({
        id: `e-${groupNodeId}-${teamNodeId}`,
        source: groupNodeId,
        target: teamNodeId,
        type: 'smoothstep',
      })

      // 收合時 worker 節點完全不加入（dagre 不佈局）
      if (isCollapsed) continue

      // --- Worker 節點（只含 team.agents，不含 manager；manager 已是 TeamNode 本身） ---
      const agentList = team.agents

      for (const agent of agentList) {
        const workerNodeId = `worker-${team.id}/${agent.name}`
        const workerData: WorkerNodeData = {
          teamId: team.id,
          agentName: agent.name,
          displayName: agent.displayName ?? agent.name,
          type: agent.type,
          roleInTeam: agent.roleInTeam ?? undefined,
          model: agent.model ?? undefined,
          platform: agent.platform,
          worklogCount: agent.worklogCount ?? 0,
          onSelectAgent: callbacks.onSelectAgent,
          onOpenAgentOpsSession: callbacks.onOpenAgentOpsSession,
          rankdir,
        }
        nodes.push({
          id: workerNodeId,
          type: 'worker',
          position: { x: 0, y: 0 },
          data: workerData,
          width: NODE_SIZE.worker.width,
          height: NODE_SIZE.worker.height,
        } as OrgNode)

        // team → worker 邊
        edges.push({
          id: `e-${teamNodeId}-${workerNodeId}`,
          source: teamNodeId,
          target: workerNodeId,
          type: 'smoothstep',
        })
      }
    }
  }

  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// applyDagreLayout — 套用 dagre 佈局，回傳帶 position 的 nodes
// ---------------------------------------------------------------------------

/**
 * Worker 水平鋪開（horizontal flow grid）參數
 * -------------------------------------------------------------
 * 需求：團隊展開後，worker 葉節點要在 team 右側「橫向排成一排」，
 * 成員多時 wrap 成多排（grid），避免 dagre 預設 LR 把同 team workers
 * 沿垂直軸堆成一長條而把樹拖得很高。
 *
 * 折衷與限制（見回報）：dagre 的階層佈局只負責 group→team 主幹（LR），
 * worker 葉層改由本檔「手算座標」鋪成 grid，不再交給 dagre 排 rank。
 */
const WORKER_GRID = {
  /** worker 之間水平間距（同組內） */
  gapX: 16,
  /** worker 之間垂直間距（同組內） */
  gapY: 12,
  /** LR 模式：team 右緣到 worker grid 左緣的水平距離 */
  offsetX: 56,
  /** TB 模式：team 下緣到 worker grid 頂緣的垂直距離 */
  offsetY: 40,
  /** LR 模式：組（列）之間的額外垂直間距（比組內間距大，視覺分組） */
  groupGapY: 24,
  /** TB 模式：組（欄）之間的額外水平間距（比組內間距大，視覺分組） */
  groupGapX: 24,
} as const

/** worker grid 一格的步距（含節點本身 + 間距） */
const WORKER_STEP_X = NODE_SIZE.worker.width + WORKER_GRID.gapX
const WORKER_STEP_Y = NODE_SIZE.worker.height + WORKER_GRID.gapY

// ---------------------------------------------------------------------------
// RDV 角色分組
// ---------------------------------------------------------------------------

/** roleInTeam 對應分組 index（R=0, D=1, V=2, shared=3, 其他=4+） */
const ROLE_ORDER: Record<string, number> = {
  researcher: 0,
  doer:       1,
  verifier:   2,
  shared:     3,
}

/** 取 roleInTeam 的排序 key（未知角色排在 shared 後） */
function roleGroupIndex(roleInTeam: string | undefined): number {
  if (roleInTeam == null) return 99
  return ROLE_ORDER[roleInTeam] ?? 4
}

/**
 * 將 workers 依 roleInTeam 分組，按 R→D→V→shared→其他 順序，
 * 回傳「非空組」的有序陣列，每組為 { roleKey, workers } 。
 * 空組不包含（後面遞補）。
 */
function groupWorkersByRole(
  workers: OrgNode[],
): Array<{ roleKey: string; workers: OrgNode[] }> {
  const map = new Map<string, OrgNode[]>()
  for (const w of workers) {
    const role = (w.data as WorkerNodeData).roleInTeam ?? ''
    if (!map.has(role)) map.set(role, [])
    map.get(role)!.push(w)
  }
  // 按 roleGroupIndex 排序，同 index 保持插入順序
  const entries = [...map.entries()].sort(
    ([a], [b]) => roleGroupIndex(a) - roleGroupIndex(b),
  )
  return entries.map(([roleKey, ws]) => ({ roleKey, workers: ws }))
}

/**
 * 計算 RDV+shared 分組 grid 的整體尺寸（用於 dagre 合成尺寸）。
 *
 * LR 模式：
 *   - 每組 = 一列，組內 worker 橫排
 *   - grid 寬度 = 最長組的 worker 數 × STEP_X（最後一個不加 gap）
 *   - grid 高度 = 組數×worker高 + (組數-1)×groupGapY
 *
 * TB 模式：
 *   - 每組 = 一欄，組內 worker 直排
 *   - grid 寬度 = 組數×worker寬 + (組數-1)×groupGapX
 *   - grid 高度 = 最長組的 worker 數 × STEP_Y（最後一個不加 gap）
 */
function roleGridDims(
  groups: Array<{ roleKey: string; workers: OrgNode[] }>,
  rankdir: 'LR' | 'TB',
): { width: number; height: number } {
  if (groups.length === 0) return { width: 0, height: 0 }
  if (rankdir === 'LR') {
    const maxCountInRow = Math.max(...groups.map((g) => g.workers.length))
    const width =
      maxCountInRow * NODE_SIZE.worker.width +
      (maxCountInRow - 1) * WORKER_GRID.gapX
    const height =
      groups.length * NODE_SIZE.worker.height +
      (groups.length - 1) * WORKER_GRID.groupGapY
    return { width, height }
  } else {
    const maxCountInCol = Math.max(...groups.map((g) => g.workers.length))
    const width =
      groups.length * NODE_SIZE.worker.width +
      (groups.length - 1) * WORKER_GRID.groupGapX
    const height =
      maxCountInCol * NODE_SIZE.worker.height +
      (maxCountInCol - 1) * WORKER_GRID.gapY
    return { width, height }
  }
}

/** 解析 worker node id（`worker-{teamId}/{agentName}`）取得所屬 teamId */
function workerTeamId(nodeId: string): string | null {
  if (!nodeId.startsWith('worker-')) return null
  const rest = nodeId.slice('worker-'.length)
  const slash = rest.indexOf('/')
  return slash >= 0 ? rest.slice(0, slash) : rest
}

/**
 * 套用佈局（rankdir 可選 LR 左→右 或 TB 上→下，同步 API）。
 *
 * 兩階段：
 *   1. dagre 只排 group→team 主幹。team 節點以「合成尺寸」餵入，
 *      讓 dagre 的 nodesep 預留足夠空間，避免相鄰 team 的 worker grid 重疊。
 *      - LR：合成高度 = max(team 高, RDV 分組 grid 高)
 *      - TB：合成寬度 = max(team 寬, RDV 分組 grid 寬)
 *   2. worker 葉層手算座標（按 roleInTeam 分 RDV+shared 組）：
 *      - LR：每組 = 一列，列 index 決定 y，組內 worker 沿 x 遞增；grid 垂直以 team 中心對齊
 *      - TB：每組 = 一欄，欄 index 決定 x，組內 worker 沿 y 遞增；grid 水平以 team 中心對齊
 *      - 空組不顯示（後面組往前遞補）
 *
 * 固定節點尺寸依 node.type 查 NODE_SIZE，不做 DOM 測量。
 */
export function applyDagreLayout(
  nodes: OrgNode[],
  edges: OrgEdge[],
  rankdir: 'LR' | 'TB' = 'LR',
): OrgNode[] {
  // --- 收集每個 team 的 worker 節點清單（保持原始順序，供分組用） ---
  const workerNodesByTeam = new Map<string, OrgNode[]>()
  for (const node of nodes) {
    if (node.type !== 'worker') continue
    const tid = workerTeamId(node.id)
    if (tid == null) continue
    if (!workerNodesByTeam.has(tid)) workerNodesByTeam.set(tid, [])
    workerNodesByTeam.get(tid)!.push(node)
  }

  // 預計算每個 team 的 RDV 分組結果（供合成尺寸 & phase 2 使用）
  const roleGroupsByTeam = new Map<string, ReturnType<typeof groupWorkersByRole>>()
  for (const [tid, ws] of workerNodesByTeam) {
    roleGroupsByTeam.set(tid, groupWorkersByRole(ws))
  }

  // --- 階段 1：dagre 只排 group + team 主幹 ---
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))

  if (rankdir === 'LR') {
    g.setGraph({
      rankdir: 'LR',
      ranksep: 60,   // LR 水平層間距：群 → 團隊
      nodesep: 24,   // LR 同層垂直間距：同層 team 之間（已含 worker grid 預留）
    })
  } else {
    g.setGraph({
      rankdir: 'TB',
      ranksep: 60,   // TB 垂直層間距：群 → 團隊
      nodesep: 32,   // TB 同層水平間距：同層 team 之間（已含 worker grid 預留）
    })
  }

  for (const node of nodes) {
    if (node.type === 'worker') continue // worker 不交給 dagre 排
    const type = node.type as keyof typeof NODE_SIZE | undefined
    const size = type && NODE_SIZE[type] ? NODE_SIZE[type] : NODE_SIZE.worker

    let width: number = size.width
    let height: number = size.height

    if (node.type === 'team') {
      const teamId = node.id.slice('team-'.length)
      const groups = roleGroupsByTeam.get(teamId)
      if (groups && groups.length > 0) {
        const grid = roleGridDims(groups, rankdir)
        if (rankdir === 'LR') {
          // LR：合成高度 = max(team 高, RDV 分組 grid 高)，讓 dagre 預留垂直空間
          height = Math.max(size.height, grid.height)
        } else {
          // TB：合成寬度 = max(team 寬, RDV 分組 grid 寬)，讓 dagre 預留水平空間
          width = Math.max(size.width, grid.width)
        }
      }
    }
    g.setNode(node.id, { width, height })
  }

  for (const edge of edges) {
    // 只排 group→team 邊；team→worker 邊不參與 dagre rank
    if (edge.source.startsWith('group-') && edge.target.startsWith('team-')) {
      g.setEdge(edge.source, edge.target)
    }
  }

  dagre.layout(g)

  // --- 套 group / team 位置（dagre 中心座標轉左上角） ---
  // LR：記錄各 team 的中心 y 與右緣 x，供 worker grid 對齊
  // TB：記錄各 team 的中心 x 與下緣 y，供 worker grid 對齊
  type TeamAnchorLR = { centerY: number; right: number }
  type TeamAnchorTB = { centerX: number; bottom: number }
  const teamAnchorLR = new Map<string, TeamAnchorLR>()
  const teamAnchorTB = new Map<string, TeamAnchorTB>()

  const positioned = nodes.map((node) => {
    if (node.type === 'worker') return node // 稍後處理
    const dagreNode = g.node(node.id)
    if (!dagreNode) return node
    const type = node.type as keyof typeof NODE_SIZE | undefined
    const size = type && NODE_SIZE[type] ? NODE_SIZE[type] : NODE_SIZE.worker
    const x = dagreNode.x - size.width / 2
    const y = dagreNode.y - size.height / 2
    if (node.type === 'team') {
      const teamId = node.id.slice('team-'.length)
      if (rankdir === 'LR') {
        teamAnchorLR.set(teamId, {
          centerY: dagreNode.y,     // dagre 中心 y
          right: x + size.width,   // team 右緣 x
        })
      } else {
        teamAnchorTB.set(teamId, {
          centerX: dagreNode.x,    // dagre 中心 x
          bottom: y + size.height, // team 下緣 y
        })
      }
    }
    return { ...node, position: { x, y } }
  })

  // --- 階段 2：worker 葉層手算 RDV+shared 分組座標 ---
  // 預先計算每個 team 的每個 worker 節點的目標座標（以 node.id 為 key）
  const workerPositions = new Map<string, { x: number; y: number }>()

  for (const [teamId, groups] of roleGroupsByTeam) {
    const grid = roleGridDims(groups, rankdir)

    if (rankdir === 'LR') {
      const anchor = teamAnchorLR.get(teamId)
      if (!anchor) continue

      // grid 左緣：team 右緣 + offset
      const gridLeft = anchor.right + WORKER_GRID.offsetX
      // grid 頂緣：整體 grid 在垂直方向以 team 中心對齊
      const gridTop = anchor.centerY - grid.height / 2

      // 每組 = 一列；列 index = groupIdx；組內 worker 沿 x 遞增
      let groupRowY = gridTop
      for (const { workers } of groups) {
        for (let i = 0; i < workers.length; i++) {
          const x = gridLeft + i * WORKER_STEP_X
          const y = groupRowY
          workerPositions.set(workers[i].id, { x, y })
        }
        // 下一組列 y：worker 高 + 組間距（groupGapY）
        groupRowY += NODE_SIZE.worker.height + WORKER_GRID.groupGapY
      }
    } else {
      // TB 模式：每組 = 一欄；欄 index = groupIdx；組內 worker 沿 y 遞增
      const anchor = teamAnchorTB.get(teamId)
      if (!anchor) continue

      // grid 頂緣：team 下緣 + offset
      const gridTop = anchor.bottom + WORKER_GRID.offsetY
      // grid 左緣：整體 grid 在水平方向以 team 中心對齊
      const gridLeft = anchor.centerX - grid.width / 2

      let groupColX = gridLeft
      for (const { workers } of groups) {
        for (let i = 0; i < workers.length; i++) {
          const x = groupColX
          const y = gridTop + i * WORKER_STEP_Y
          workerPositions.set(workers[i].id, { x, y })
        }
        // 下一組欄 x：worker 寬 + 組間距（groupGapX）
        groupColX += NODE_SIZE.worker.width + WORKER_GRID.groupGapX
      }
    }
  }

  return positioned.map((node) => {
    if (node.type !== 'worker') return node
    const pos = workerPositions.get(node.id)
    if (!pos) return node // team 不存在（理論上不會發生）
    return { ...node, position: pos }
  })
}
