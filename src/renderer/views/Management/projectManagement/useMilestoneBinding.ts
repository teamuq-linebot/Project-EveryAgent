import { useCallback, useState } from 'react'
import type {
  MilestoneDto,
  MilestoneMemberDto,
} from '../../../../shared/ipcContracts'
import { TOOLS, type Tool } from './constants'

/** milestone binding（專案資料夾綁定）表單狀態。 */
export type MilestoneBinding = { projectPath: string; tool: Tool; customCommand: string }

/**
 * useMilestoneBinding — 選取專案下的團隊清單 + 團隊資料夾綁定 + 成員（唯讀鏡像）。
 *
 * 由 useProjectManagement 抽出：milestones/loadMilestones、binding 表單與
 * browse、members 鏡像。binding/members 的初始載入（依 selectedMilestone）與
 * handleSaveBinding 由 useProjectCrud（持有 selectedMilestone）協調；
 * 邏輯/控制流/簽名一字不改。
 */
export function useMilestoneBinding() {
  // ── 團隊 ──
  const [milestones, setMilestones] = useState<MilestoneDto[]>([])

  // milestonesLoading：展開子節點時的局部載入旗標，不影響全樹 listLoading。
  const [milestonesLoading, setMilestonesLoading] = useState(false)

  // ── milestone binding（專案資料夾綁定）──
  const [binding, setBinding] = useState<MilestoneBinding>({ projectPath: '', tool: 'claude' as Tool, customCommand: '' })

  // ── 成員（唯讀鏡像）──
  const [members, setMembers] = useState<MilestoneMemberDto[]>([])

  const loadMilestones = useCallback(async (projectLocalId: string | null) => {
    if (!projectLocalId) {
      setMilestones([])
      return
    }
    // 不觸發 listLoading（listLoading 只保留給 loadProjects/初始載入）
    // 避免展開子樹時整棵樹被 skeleton 替換、導致 scrollTop 歸零。
    setMilestonesLoading(true)
    try {
      const r = await window.tuq.milestones.findAll({ projectLocalId })
      if (r.ok) setMilestones(r.data)
    } catch {
      /* 安全降級 */
    } finally {
      setMilestonesLoading(false)
    }
  }, [])

  // ── milestone binding（專案資料夾綁定）──
  const handleBrowse = useCallback(async () => {
    try {
      const r = await window.tuq.dialog.openDirectory()
      if (r.ok && r.data) setBinding((b) => ({ ...b, projectPath: r.data as string }))
    } catch {
      /* 真機 dialog 未開：靜默 */
    }
  }, [])

  return {
    milestones,
    setMilestones,
    milestonesLoading,
    setMilestonesLoading,
    binding,
    setBinding,
    members,
    setMembers,
    loadMilestones,
    handleBrowse,
  }
}

// 供協調 effect 使用的 binding fallback 與 tool 正規化（與原 inline 邏輯一致）。
export function normalizeBindingTool(tool: string | null | undefined): Tool {
  return (TOOLS.includes(tool as Tool) ? tool : 'claude') as Tool
}
