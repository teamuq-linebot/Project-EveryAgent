import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ProjectDto,
  MilestoneDto,
  TaskDto,
} from '../../../../shared/ipcContracts'
import { buildPlatformNameMap } from '../../shell/SourceBadge'

/**
 * useProjectsData — 專案清單 / 全量 milestone / 全量任務的資料來源層。
 *
 * 由 useProjectManagement 抽出：projects 搜尋與載入、allMilestones（filter 選項）、
 * allTasks（第四層任務）及其衍生對照 Map / tasksByMilestone。
 * 邏輯/SQL/數值常數/控制流/簽名一字不改。
 */
export function useProjectsData() {
  // ── 專案 ──
  const [projects, setProjects] = useState<ProjectDto[]>([])
  const [search, setSearch] = useState('')

  // 所有 milestone 的扁平清單（filter 選項來源；與選取專案無關）
  const [allMilestones, setAllMilestones] = useState<MilestoneDto[]>([])

  // ── 全量任務（第四層：團隊下顯示任務）──
  const [allTasks, setAllTasks] = useState<TaskDto[]>([])

  // ── loading states ──
  const [listLoading, setListLoading] = useState(false)

  // platform_local_id → user 短名對照（常空 Map；雲端平台已移除）。
  const platformUsers = new Map<string, string>()

  // U8 來源徽章：platform_local_id → name 對照（常空 Map；雲端平台已移除）。
  const platformNames = useMemo(() => buildPlatformNameMap([]), [])

  // ── 載入 ──
  const loadProjects = useCallback(async () => {
    setListLoading(true)
    try {
      const r = await window.tuq.projects.findAll({ search: search.trim() || null })
      if (r.ok) setProjects(r.data)
    } catch {
      /* 安全降級 */
    } finally {
      setListLoading(false)
    }
  }, [search])

  // 載入全部 milestone（不限 project）供 filter 選項使用；不影響 listLoading。
  const loadAllMilestones = useCallback(async () => {
    try {
      const r = await window.tuq.milestones.findAll({})
      if (r.ok) setAllMilestones(r.data)
    } catch {
      /* 安全降級：filter 下拉無選項，但不影響主功能 */
    }
  }, [])

  // 載入全量任務（不下推任何過濾，管理視角見全部）；不影響 listLoading。
  const loadAllTasks = useCallback(async () => {
    try {
      const r = await window.tuq.tasks.findAll({})
      if (r.ok && Array.isArray(r.data)) setAllTasks(r.data as TaskDto[])
    } catch (e) {
      console.warn('[PMV] loadAllTasks failed:', e)
    }
  }, [])

  useEffect(() => {
    loadProjects()
    loadAllMilestones()
    loadAllTasks()
  }, [loadProjects, loadAllMilestones, loadAllTasks])

  // ── 第四層：按 milestone_id 分組的任務 Map（deps 穩定，不含每 render 重建物件）──
  const tasksByMilestone = useMemo(() => {
    const map = new Map<string, TaskDto[]>()
    for (const t of allTasks) {
      const mid = t.milestone_id
      if (!mid) continue
      const arr = map.get(mid) ?? []
      arr.push(t)
      map.set(mid, arr)
    }
    return map
  }, [allTasks])

  return {
    projects,
    setProjects,
    search,
    setSearch,
    allMilestones,
    setAllMilestones,
    allTasks,
    setAllTasks,
    platformUsers,
    platformNames,
    listLoading,
    setListLoading,
    loadProjects,
    loadAllMilestones,
    loadAllTasks,
    tasksByMilestone,
  }
}
