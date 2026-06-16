/**
 * OrgFlowCanvas.tsx — React Flow 組織圖畫布
 * 設計來源：design-reactflow-refactor.md §5.2
 *
 * Props:
 *   teams           - agentOrg:scan 回傳的 teams 陣列
 *   groupConfig     - 分組設定（批次 2 先用 DEFAULT_GROUP_CONFIG）
 *   collapsedTeams  - 已收合的 teamId Set
 *   onToggleCollapse - 切換收合（提升至 AgentTeamsView）
 *   onSelectAgent   - 點節點開抽屜（提升至 AgentTeamsView）
 *   onOpenAgentOpsSession - 開 Agent Ops PTY session（提升至 AgentTeamsView）
 *
 * 重點：
 *   - ReactFlow 必須包在 ReactFlowProvider 內（v12），由呼叫方或本元件自包
 *   - callbacks 用 useCallback 穩定 reference，再塞進 node.data，避免每次重建節點
 *   - fitView 在 useEffect + requestAnimationFrame（延一幀等 DOM ready）
 *   - onNodesChange 只收 dragging/selected，不收 position（org-chart 非 free-form）
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ReactFlow,
  Background,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react'
import type { AgentTeamDto } from '../../../shared/ipcContracts'
import type { GroupConfig } from './groupConfig'
import { buildOrgGraph, applyDagreLayout } from './buildOrgGraph'
import type { OrgCallbacks } from './buildOrgGraph'
import { GroupNode } from './nodes/GroupNode'
import { TeamNode } from './nodes/TeamNode'
import { WorkerNode } from './nodes/WorkerNode'

// ---------------------------------------------------------------------------
// nodeTypes 在模組層級宣告（避免每次 render 重新建立物件）
// ---------------------------------------------------------------------------
const nodeTypes = {
  group: GroupNode,
  team: TeamNode,
  worker: WorkerNode,
} as const

// ---------------------------------------------------------------------------
// OrgFlowCanvas — 內部元件（需在 ReactFlowProvider 內）
// ---------------------------------------------------------------------------
interface OrgFlowCanvasInnerProps {
  teams: AgentTeamDto[]
  groupConfig: GroupConfig
  collapsedTeams: Set<string>
  collapsedGroups?: Set<string>
  onToggleCollapse: (teamId: string) => void
  onToggleGroupCollapse?: (groupId: string) => void
  onSelectAgent: (teamId: string, agentName: string) => void
  onOpenAgentOpsSession?: (label: string, prompt: string) => void
  /** 組織圖方向：LR=左→右（預設），TB=上→下 */
  rankdir?: 'LR' | 'TB'
}

function OrgFlowCanvasInner({
  teams,
  groupConfig,
  collapsedTeams,
  collapsedGroups,
  onToggleCollapse,
  onToggleGroupCollapse,
  onSelectAgent,
  onOpenAgentOpsSession,
  rankdir = 'LR',
}: OrgFlowCanvasInnerProps): React.JSX.Element {
  const { fitView } = useReactFlow()
  const fitPendingRef = useRef(false)
  /** 首次載入/掃描完成後 fit 一次；後續展開收合不再 fit */
  const firstFitDoneRef = useRef(false)
  /** 上一次的 rankdir，用於偵測方向切換（切換時強制重 fit） */
  const prevRankdirRef = useRef(rankdir)

  // --- useCallback 穩定 callbacks ---
  // 注意：onSelectAgent 介面為 (teamId, agentName)，但 node.data 介面是 (agentName, teamId)
  // buildOrgGraph 產的 callbacks.onSelectAgent(agentName, teamId)
  // AgentTeamsView.handleSelectAgent(teamId, agentName)
  // 需在此做順序轉換
  const stableOnSelectAgent = useCallback(
    (agentName: string, teamId: string) => {
      onSelectAgent(teamId, agentName)
    },
    [onSelectAgent],
  )

  const stableOnToggleCollapse = useCallback(
    (teamId: string) => {
      onToggleCollapse(teamId)
    },
    [onToggleCollapse],
  )

  const stableOnToggleGroupCollapse = useCallback(
    (groupId: string) => {
      onToggleGroupCollapse?.(groupId)
    },
    [onToggleGroupCollapse],
  )

  const stableOnOpenAgentOpsSession = useCallback(
    (label: string, prompt: string) => {
      // label = 第一參數（按鈕標題），prompt = 第二參數（/tuq-agent 指令）
      // TeamNode Audit/Review 直接組好 label/prompt 傳入，此處直接透傳
      onOpenAgentOpsSession?.(label, prompt)
    },
    [onOpenAgentOpsSession],
  )

  // --- 穩定的 callbacks 物件（memo，只在各 callback 變時才重建）---
  const callbacks: OrgCallbacks = useMemo(
    () => ({
      onSelectAgent: stableOnSelectAgent,
      onOpenAgentOpsSession: stableOnOpenAgentOpsSession,
      onToggleCollapse: stableOnToggleCollapse,
      onToggleGroupCollapse: stableOnToggleGroupCollapse,
    }),
    [stableOnSelectAgent, stableOnOpenAgentOpsSession, stableOnToggleCollapse, stableOnToggleGroupCollapse],
  )

  // --- 每次 teams / groupConfig / collapsedTeams / collapsedGroups / callbacks / rankdir 變動時重算佈局 ---
  const layoutResult = useMemo(() => {
    const { nodes, edges } = buildOrgGraph(teams, groupConfig, collapsedTeams, callbacks, collapsedGroups, rankdir)
    const layoutedNodes = applyDagreLayout(nodes, edges, rankdir)
    return { nodes: layoutedNodes, edges }
  }, [teams, groupConfig, collapsedTeams, collapsedGroups, callbacks, rankdir])

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutResult.nodes)
  const [edges, , onEdgesChange] = useEdgesState(layoutResult.edges)

  // 同步外部佈局結果到受控狀態
  // 觸發 fitView 的條件：
  //   1. 首次載入（firstFitDoneRef 尚未設定）
  //   2. rankdir 切換（重大佈局變更，需重新 fit 確保畫面完整）
  // 後續展開/收合只更新節點，維持當前縮放與平移位置不動。
  useEffect(() => {
    setNodes(layoutResult.nodes)
    const rankdirChanged = prevRankdirRef.current !== rankdir
    if (!firstFitDoneRef.current || rankdirChanged) {
      fitPendingRef.current = true
      prevRankdirRef.current = rankdir
    }
  }, [layoutResult.nodes, setNodes, rankdir])

  // fitView 延一幀等 DOM 完成（只在 firstFitDoneRef 尚未完成時執行）
  // deps: layoutResult.nodes — 節點集合變動時才重新評估是否需 fit；
  // firstFitDoneRef 守門確保只初次 fit，後續展開收合不重置視角。
  useEffect(() => {
    if (!fitPendingRef.current) return
    const raf = requestAnimationFrame(() => {
      fitView({ duration: 200, padding: 0.08 })
      fitPendingRef.current = false
      firstFitDoneRef.current = true
    })
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutResult.nodes])

  // onNodesChange：只收 dragging / selected，不允許 position 被拖曳改動（org-chart）
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const allowed = changes.filter(
        (c) => c.type === 'select' || c.type === 'dimensions',
      )
      if (allowed.length > 0) onNodesChange(allowed)
    },
    [onNodesChange],
  )

  return (
    <div className="atrf-canvas-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        minZoom={0.2}
        maxZoom={2}
      >
        <Background gap={20} size={1} />
        <MiniMap
          nodeStrokeWidth={2}
          pannable
          zoomable
          className="atrf-minimap"
        />
        <Controls showInteractive={false} className="atrf-controls" />
      </ReactFlow>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OrgFlowCanvas — 公開元件（匯出供 AgentTeamsView 使用，不含 Provider）
// AgentTeamsView 需在外層包 <ReactFlowProvider>
// ---------------------------------------------------------------------------
export { type OrgFlowCanvasInnerProps as OrgFlowCanvasProps }
export function OrgFlowCanvas(props: OrgFlowCanvasInnerProps): React.JSX.Element {
  return <OrgFlowCanvasInner {...props} />
}

export default OrgFlowCanvas
