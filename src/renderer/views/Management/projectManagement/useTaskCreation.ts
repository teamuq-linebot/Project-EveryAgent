import { useCallback, useEffect, useState } from 'react'
import type { MilestoneDto } from '../../../../shared/ipcContracts'
import type { StatusMessage } from './useManagementStatus'

/** useTaskCreation 的相依注入（由持有選取狀態 / 載入器的上層提供）。 */
export type TaskCreationDeps = {
  selectedMilestoneId: string | null
  selectedMilestone: MilestoneDto | null
  loadAllTasks: () => Promise<void>
  setStatus: (s: StatusMessage | null) => void
}

/**
 * useTaskCreation — 新增任務（C5 UI 入口）的表單狀態與送出。
 *
 * 由 useProjectManagement 抽出 taskName/creatingTask/showCreateTask 與 handleCreateTask；
 * 切換團隊時重置（setShowCreateTask(false)/setTaskName('')）由上層協調 effect 透過 setter 完成。
 * 邏輯/控制流/簽名一字不改。
 */
export function useTaskCreation({
  selectedMilestoneId,
  selectedMilestone,
  loadAllTasks,
  setStatus,
}: TaskCreationDeps) {
  const [taskName, setTaskName] = useState('')
  const [creatingTask, setCreatingTask] = useState(false)
  const [showCreateTask, setShowCreateTask] = useState(false)

  // 切換團隊時重置新增任務表單，避免舊名稱和展開狀態殘留到新團隊。
  // （原為團隊選取協調 effect 末段的 setShowCreateTask(false)/setTaskName('')；
  //  保持相同 deps [selectedMilestoneId, selectedMilestone] 以維持觸發時機一致。）
  useEffect(() => {
    setShowCreateTask(false)
    setTaskName('')
  }, [selectedMilestoneId, selectedMilestone])

  // ── 新增任務（C5 UI 入口）──
  // guard：名稱空白 disabled；未選團隊不顯示入口；已選團隊才允許送出。
  const handleCreateTask = useCallback(async () => {
    if (!selectedMilestoneId || !taskName.trim()) return
    setCreatingTask(true)
    try {
      const r = await window.tuq.tasks.create({
        name: taskName.trim(),
        milestoneLocalId: selectedMilestoneId,
        // remote 團隊下建任務仍 assigneeSelf=true（後端依 _resolveMyUserId 填入；未登入為 null）
        assigneeSelf: selectedMilestone?.origin === 'remote',
      })
      if (r.ok) {
        setTaskName('')
        setShowCreateTask(false)
        const isRemotePlatform = !!selectedMilestone?.platform_local_id && selectedMilestone.platform_local_id !== 'builtin:local'
        const successMsg = isRemotePlatform
          ? `✓ 任務「${r.data.name}」已建立（已加入同步佇列）`
          : `✓ 任務「${r.data.name}」已建立`
        setStatus({ text: successMsg, ok: true })
        await loadAllTasks()
      } else {
        setStatus({ text: `✗ 建立失敗：${r.error}`, ok: false })
      }
    } catch (e) {
      setStatus({ text: `✗ 建立失敗：${e instanceof Error ? e.message : String(e)}`, ok: false })
    } finally {
      setCreatingTask(false)
    }
  }, [selectedMilestoneId, selectedMilestone, taskName, loadAllTasks, setStatus])

  return {
    taskName,
    setTaskName,
    creatingTask,
    setCreatingTask,
    showCreateTask,
    setShowCreateTask,
    handleCreateTask,
  }
}
