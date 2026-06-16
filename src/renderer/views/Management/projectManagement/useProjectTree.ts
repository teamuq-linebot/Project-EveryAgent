import { useCallback, useMemo, useState } from 'react'
import type {
  ProjectDto,
  MilestoneDto,
} from '../../../../shared/ipcContracts'
import { DEFAULT_PROJECT_STATUS_FILTER, FALLBACK_PROJECT_STATUS } from './constants'

/** useProjectTree 的相依注入（資料來源層提供）。 */
export type ProjectTreeDeps = {
  projects: ProjectDto[]
  allMilestones: MilestoneDto[]
  platformNames: Map<string, string>
  platformUsers: Map<string, string>
}

/**
 * useProjectTree — 左側樹狀清單的 filter（狀態多選 / 版本團隊）與三層 source group 計算（G1）。
 *
 * 由 useProjectManagement 抽出 statusFilter/toggleStatusFilter、milestoneFilter 與 sourceGroups useMemo。
 * 邏輯/控制流/排序/數值常數一字不改。
 */
export function useProjectTree({
  projects,
  allMilestones,
  platformNames,
  platformUsers,
}: ProjectTreeDeps) {
  // ── 專案狀態 filter（左側樹狀清單篩選；多選 checkbox）──
  // 選取集合 = 要顯示的 ProjectStatus；預設只勾準備中 / 待執行 / 進行中 / 暫停。
  // 空集合 = 不顯示任何專案（明確回饋；可由 empty 提示引導清/調 filter）。
  const [statusFilter, setStatusFilter] = useState<Set<string>>(
    () => new Set(DEFAULT_PROJECT_STATUS_FILTER),
  )
  const toggleStatusFilter = useCallback((value: string) => {
    setStatusFilter((prev) => {
      const next = new Set(prev)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    })
  }, [])

  // ── 版本/團隊 filter（左側樹狀清單篩選）──
  // '' = 全部；非空 = 過濾只顯示含匹配 milestone 的專案
  const [milestoneFilter, setMilestoneFilter] = useState<string>('')

  // ── 三層樹：source group → 專案 → 團隊（G1 分組渲染）──
  // 先執行既有 filter，再按 platform_local_id 分組。
  const sourceGroups = useMemo(() => {
    // 1. 既有 filter 邏輯（與下方渲染原本一致）+ 專案狀態多選 filter。
    const matchStatus = (p: ProjectDto): boolean => {
      const st = p.status && p.status !== '' ? p.status : FALLBACK_PROJECT_STATUS
      return statusFilter.has(st)
    }
    const filtered = projects.filter((p) => {
      if (!matchStatus(p)) return false
      if (!milestoneFilter) return true
      const targetMilestone = allMilestones.find((m) => m.id === milestoneFilter)
      return targetMilestone?.project_local_id === p.id
    })

    // 2. 分組 key = platform_local_id（或 'builtin:local' 作為本地 fallback；
    //    origin='remote' 但無 platform_local_id → '__remote_unknown__' 獨立組，排最後）
    const groupMap = new Map<string, ProjectDto[]>()
    for (const p of filtered) {
      let key: string
      if (p.origin === 'local') {
        key = 'builtin:local'
      } else if (!p.platform_local_id) {
        // remote 但 platform_local_id 為 null：歸入未知雲端組，避免混入「📍 本地」
        key = '__remote_unknown__'
      } else {
        key = p.platform_local_id
      }
      const arr = groupMap.get(key) ?? []
      arr.push(p)
      groupMap.set(key, arr)
    }

    // 3. 組標題
    const getGroupTitle = (key: string): string => {
      if (key === 'builtin:local') return '📍 本地'
      if (key === '__remote_unknown__') return '雲端'
      const platName = platformNames.get(key)
      const userShort = platformUsers.get(key)
      if (platName && userShort) return `${platName} · ${userShort}`
      if (platName) return platName
      if (userShort) return `雲端 · ${userShort}`
      return '雲端'
    }

    // 4. 排序：本地最前，__remote_unknown__ 最後，其餘按標題字串排序
    const sorted = Array.from(groupMap.entries()).sort(([aKey], [bKey]) => {
      if (aKey === 'builtin:local') return -1
      if (bKey === 'builtin:local') return 1
      if (aKey === '__remote_unknown__') return 1
      if (bKey === '__remote_unknown__') return -1
      return getGroupTitle(aKey).localeCompare(getGroupTitle(bKey))
    })

    return sorted.map(([key, projs]) => ({
      key,
      title: getGroupTitle(key),
      projects: projs,
    }))
  }, [projects, statusFilter, milestoneFilter, allMilestones, platformNames, platformUsers])

  return {
    statusFilter,
    setStatusFilter,
    toggleStatusFilter,
    milestoneFilter,
    setMilestoneFilter,
    sourceGroups,
  }
}
