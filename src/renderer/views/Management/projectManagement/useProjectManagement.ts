import { useCallback } from 'react'
import { useManagementStatus } from './useManagementStatus'
import { useProjectsData } from './useProjectsData'
import { useMilestoneBinding } from './useMilestoneBinding'
import { useTaskCreation } from './useTaskCreation'
import { useProjectCrud } from './useProjectCrud'
import { useListLayout } from './useListLayout'
import { useProjectTree } from './useProjectTree'

/**
 * useProjectManagement — ProjectManagementView 的資料/狀態/邏輯核心 hook（facade / composition root）。
 *
 * 原本為單一 God hook（逐字搬自 ProjectManagementView body）；現按關注點拆為數個聚焦子 hook：
 *   - useManagementStatus — 狀態列訊息 + auto-dismiss + syncBusy
 *   - useProjectsData     — projects / allMilestones / allTasks 資料源與衍生對照
 *   - useMilestoneBinding — 選取專案下的團隊清單 + 資料夾綁定 + 成員鏡像
 *   - useProjectCrud      — 選取狀態 + 專案/團隊 CRUD + AI 草稿 + 兩段協調 effect
 *   - useTaskCreation     — 新增任務表單與送出（切換團隊時重置）
 *   - useListLayout       — 左欄拖拉寬度 + source group 收合
 *   - useProjectTree      — filter（狀態/團隊）+ 三層 source group 計算
 *
 * 本 hook 僅做組合與少量跨 hook 接線（handleSaveBinding），對外回傳的物件鍵 / 型別與既有完全一致，
 * ProjectManagementView 取用方式（vm.*）零改動。邏輯/SQL/數值常數/控制流/簽名一字不改。
 */
export function useProjectManagement() {
  const statusVm = useManagementStatus()
  const { status, setStatus, statusFading, setStatusFading, syncBusy, setSyncBusy } = statusVm

  const dataVm = useProjectsData()
  const {
    projects, setProjects,
    search, setSearch,
    allMilestones, setAllMilestones,
    allTasks, setAllTasks,
    platformUsers,
    platformNames,
    listLoading, setListLoading,
    loadProjects, loadAllMilestones, loadAllTasks,
    tasksByMilestone,
  } = dataVm

  const bindingVm = useMilestoneBinding()
  const {
    milestones, setMilestones,
    milestonesLoading, setMilestonesLoading,
    binding, setBinding,
    members, setMembers,
    loadMilestones,
    handleBrowse,
  } = bindingVm

  const treeVm = useProjectTree({ projects, allMilestones, platformNames, platformUsers })
  const {
    statusFilter, setStatusFilter,
    toggleStatusFilter,
    milestoneFilter, setMilestoneFilter,
    sourceGroups,
  } = treeVm

  const crudVm = useProjectCrud({
    projects,
    milestones,
    loadProjects,
    loadMilestones,
    loadAllMilestones,
    setBinding,
    setMembers,
    milestoneFilter,
    setMilestoneFilter,
    setStatus,
  })
  const {
    selectedProjectId, setSelectedProjectId,
    projectName, setProjectName,
    creatingProject, setCreatingProject,
    pendingMilestones, setPendingMilestones,
    selectedMilestoneId, setSelectedMilestoneId,
    milestoneName, setMilestoneName,
    creatingMilestone, setCreatingMilestone,
    projDeleteConfirm, setProjDeleteConfirm,
    projDeleteTimerRef,
    milDeleteConfirm, setMilDeleteConfirm,
    milDeleteTimerRef,
    selectedProject,
    selectedMilestone,
    syncReadOnly,
    handleNewProject,
    handleSaveProject,
    handleDeleteProject,
    handleNewMilestone,
    handleSaveMilestone,
    handleDeleteMilestone,
    handleApplyDraft,
  } = crudVm

  const taskVm = useTaskCreation({
    selectedMilestoneId,
    selectedMilestone,
    loadAllTasks,
    setStatus,
  })
  const {
    taskName, setTaskName,
    creatingTask, setCreatingTask,
    showCreateTask, setShowCreateTask,
    handleCreateTask,
  } = taskVm

  const layoutVm = useListLayout()
  const {
    collapsedGroups, setCollapsedGroups,
    listWidth, setListWidth,
    draggingRef,
    dragStartXRef,
    dragStartWidthRef,
    lastWidthRef,
    handleSplitterMouseDown,
  } = layoutVm

  // handleSaveBinding 需同時持有 selectedMilestone（crud）與 binding（bindingVm），於組合層接線。
  const handleSaveBinding = useCallback(async () => {
    if (!selectedMilestone) return
    if (!binding.projectPath.trim()) {
      setStatus({ text: '✗ 請填寫專案資料夾路徑', ok: false })
      return
    }
    try {
      const r = await window.tuq.config.setMilestone({
        milestoneId: selectedMilestone.id,
        projectPath: binding.projectPath.trim(),
        tool: binding.tool,
        customCommand: binding.tool === 'custom' ? binding.customCommand.trim() : null,
      })
      if (r.ok) setStatus({ text: '✓ 已儲存資料夾綁定', ok: true })
      else setStatus({ text: `✗ 儲存失敗：${r.error}`, ok: false })
    } catch (e) {
      setStatus({ text: `✗ 儲存失敗：${e instanceof Error ? e.message : String(e)}`, ok: false })
    }
  }, [selectedMilestone, binding, setStatus])

  return {
    // 專案
    projects, setProjects,
    search, setSearch,
    selectedProjectId, setSelectedProjectId,
    projectName, setProjectName,
    creatingProject, setCreatingProject,
    pendingMilestones, setPendingMilestones,
    // 團隊
    milestones, setMilestones,
    selectedMilestoneId, setSelectedMilestoneId,
    milestoneName, setMilestoneName,
    creatingMilestone, setCreatingMilestone,
    // binding
    binding, setBinding,
    // 成員
    members, setMembers,
    // 新增任務
    taskName, setTaskName,
    creatingTask, setCreatingTask,
    showCreateTask, setShowCreateTask,
    // filter
    statusFilter, setStatusFilter,
    toggleStatusFilter,
    milestoneFilter, setMilestoneFilter,
    allMilestones, setAllMilestones,
    // 任務
    allTasks, setAllTasks,
    // platforms
    platformUsers,
    // loading
    listLoading, setListLoading,
    milestonesLoading, setMilestonesLoading,
    // inline confirm
    projDeleteConfirm, setProjDeleteConfirm,
    projDeleteTimerRef,
    milDeleteConfirm, setMilDeleteConfirm,
    milDeleteTimerRef,
    // status
    status, setStatus,
    statusFading, setStatusFading,
    syncBusy, setSyncBusy,
    // 衍生值
    selectedProject,
    selectedMilestone,
    platformNames,
    syncReadOnly,
    // 載入
    loadProjects,
    loadMilestones,
    loadAllMilestones,
    loadAllTasks,
    // 專案 CRUD
    handleNewProject,
    handleSaveProject,
    handleDeleteProject,
    // 團隊 CRUD
    handleNewMilestone,
    handleSaveMilestone,
    handleDeleteMilestone,
    // binding
    handleBrowse,
    handleSaveBinding,
    // 新增任務
    handleCreateTask,
    // AI 草稿
    handleApplyDraft,
    // source group 收合
    collapsedGroups, setCollapsedGroups,
    // splitter
    listWidth, setListWidth,
    draggingRef,
    dragStartXRef,
    dragStartWidthRef,
    lastWidthRef,
    handleSplitterMouseDown,
    // 衍生 memo
    tasksByMilestone,
    sourceGroups,
  }
}
