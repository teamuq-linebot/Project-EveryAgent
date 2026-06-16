import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ProjectDto,
  MilestoneDto,
  MilestoneMemberDto,
  ProjectConfigDraft,
} from '../../../../shared/ipcContracts'
import type { StatusMessage } from './useManagementStatus'
import type { MilestoneBinding } from './useMilestoneBinding'
import { normalizeBindingTool } from './useMilestoneBinding'

/** useProjectCrud 的相依注入（資料來源層 / binding / filter / 狀態提供）。 */
export type ProjectCrudDeps = {
  projects: ProjectDto[]
  milestones: MilestoneDto[]
  loadProjects: () => Promise<void>
  loadMilestones: (projectLocalId: string | null) => Promise<void>
  loadAllMilestones: () => Promise<void>
  // binding / members（由 useMilestoneBinding 持有，協調 effect 透過 setter 寫入）
  setBinding: (b: MilestoneBinding) => void
  setMembers: (m: MilestoneMemberDto[]) => void
  // milestoneFilter（刪除團隊時若正命中需重置）
  milestoneFilter: string
  setMilestoneFilter: (v: string) => void
  // 狀態
  setStatus: (s: StatusMessage | null) => void
}

/**
 * useProjectCrud — 專案 / 團隊的選取狀態、建立 / 編輯表單、CRUD 操作、AI 草稿套用，
 * 以及切換選取時的兩段協調 effect（載入團隊 / binding / 成員，重置任務表單）。
 *
 * 由 useProjectManagement 抽出 selectedProjectId/selectedMilestoneId、projectName/milestoneName、
 * creatingProject/creatingMilestone、pendingMilestones、inline delete confirm 三態機與其 timer，
 * 兩個協調 useEffect、unmount cleanup effect，及 handleNewProject/handleSaveProject/
 * handleDeleteProject/handleNewMilestone/handleSaveMilestone/handleDeleteMilestone/
 * handleApplyDraft。邏輯/數值常數/控制流/簽名一字不改。
 * （新增任務表單於切換團隊時的重置已移至 useTaskCreation；handleSaveBinding 因需同時持有
 *   selectedMilestone 與 binding，由 useProjectManagement 組裝。）
 */
export function useProjectCrud({
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
}: ProjectCrudDeps) {
  // ── 專案 ──
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)
  // AI 草稿「套用」後暫存的團隊名稱清單；建立專案後自動逐筆建立（仍人工觸發「建立」鈕）。
  const [pendingMilestones, setPendingMilestones] = useState<string[]>([])

  // ── 團隊 ──
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null)
  const [milestoneName, setMilestoneName] = useState('')
  const [creatingMilestone, setCreatingMilestone] = useState(false)

  // ── inline confirm（刪除確認）三態狀態機 ──
  // 專案刪除：idle → pending（點刪除）→ deleting（點確認）→ idle（完成）
  const [projDeleteConfirm, setProjDeleteConfirm] = useState<'idle' | 'pending' | 'deleting'>('idle')
  const projDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 團隊刪除：同樣三態
  const [milDeleteConfirm, setMilDeleteConfirm] = useState<'idle' | 'pending' | 'deleting'>('idle')
  const milDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // unmount cleanup：清除 pending delete timers（F7 fix）
  useEffect(() => {
    return () => {
      if (projDeleteTimerRef.current) clearTimeout(projDeleteTimerRef.current)
      if (milDeleteTimerRef.current) clearTimeout(milDeleteTimerRef.current)
    }
  }, [])

  const selectedProject = projects.find((p) => p.id === selectedProjectId) ?? null
  const selectedMilestone = milestones.find((m) => m.id === selectedMilestoneId) ?? null
  // 鏡像列（pull 來的）platform/sync_enabled 兩欄唯讀（§2.4）。
  const syncReadOnly = !selectedProject || selectedProject.origin === 'remote'

  // 選專案 → 載團隊、清團隊選取
  useEffect(() => {
    setCreatingProject(false)
    setStatus(null)
    setSelectedMilestoneId(null)
    if (selectedProject) setProjectName(selectedProject.name)
    else setProjectName('')
    loadMilestones(selectedProjectId)
  }, [selectedProjectId, selectedProject, loadMilestones, setStatus])

  // 選團隊 → 載 binding + 成員
  useEffect(() => {
    setCreatingMilestone(false)
    if (selectedMilestone) {
      setMilestoneName(selectedMilestone.name)
      // binding（走既有 config channel，鍵=milestone local_id）
      window.tuq.config
        .getMilestone(selectedMilestone.id)
        .then((r) => {
          if (r.ok && r.data) {
            setBinding({
              projectPath: r.data.project_path ?? '',
              tool: normalizeBindingTool(r.data.tool),
              customCommand: r.data.custom_command ?? '',
            })
          } else {
            setBinding({ projectPath: '', tool: 'claude', customCommand: '' })
          }
        })
        .catch(() => setBinding({ projectPath: '', tool: 'claude', customCommand: '' }))
      // 成員（唯讀鏡像）
      const mb = window.tuq?.milestones?.findMembers
      if (mb) {
        mb(selectedMilestone.id)
          .then((r) => {
            if (r.ok) setMembers(r.data)
          })
          .catch(() => setMembers([]))
      } else {
        setMembers([])
      }
    } else {
      setMilestoneName('')
      setMembers([])
      setBinding({ projectPath: '', tool: 'claude', customCommand: '' })
    }
    // 註：切換團隊時重置新增任務表單（setShowCreateTask(false)/setTaskName('')）已移至
    //     useTaskCreation 的同 deps effect，觸發時機與原合併 effect 一致。
  }, [selectedMilestoneId, selectedMilestone, setBinding, setMembers])

  // ── 專案 CRUD ──
  const handleNewProject = useCallback(() => {
    setSelectedProjectId(null)
    setSelectedMilestoneId(null)
    setCreatingProject(true)
    setProjectName('')
    setPendingMilestones([])
    setStatus(null)
  }, [setStatus])

  const handleSaveProject = useCallback(async () => {
    const trimmed = projectName.trim()
    if (!trimmed) {
      setStatus({ text: '✗ 請輸入專案名稱', ok: false })
      return
    }
    try {
      if (creatingProject || !selectedProjectId) {
        const r = await window.tuq.projects.create({ name: trimmed })
        if (r.ok) {
          setCreatingProject(false)
          setSelectedProjectId(r.data.id)
          // 套用 AI 草稿時暫存的團隊 → 建立專案後逐筆自動建立（仍經人工「建立」鈕觸發）。
          const queued = pendingMilestones
          if (queued.length > 0) {
            setPendingMilestones([])
            let created = 0
            for (const name of queued) {
              const mr = await window.tuq.milestones.create({
                name,
                projectLocalId: r.data.id,
              })
              if (mr.ok) created++
            }
            await loadMilestones(r.data.id)
            setStatus({ text: `✓ 已新增專案，並建立 ${created}/${queued.length} 個團隊`, ok: true })
          } else {
            setStatus({ text: '✓ 已新增專案', ok: true })
          }
          await loadProjects()
          await loadAllMilestones()
        } else setStatus({ text: `✗ 新增失敗：${r.error}`, ok: false })
      } else {
        const r = await window.tuq.projects.update({ localId: selectedProjectId, name: trimmed })
        if (r.ok) {
          setStatus({ text: '✓ 已儲存', ok: true })
          await loadProjects()
        } else setStatus({ text: `✗ 儲存失敗：${r.error}`, ok: false })
      }
    } catch (e) {
      setStatus({ text: `✗ 失敗：${e instanceof Error ? e.message : String(e)}`, ok: false })
    }
  }, [projectName, creatingProject, selectedProjectId, pendingMilestones, loadProjects, loadMilestones, loadAllMilestones, setStatus])

  const handleDeleteProject = useCallback(async () => {
    if (!selectedProjectId) return
    try {
      const r = await window.tuq.projects.delete(selectedProjectId)
      if (r.ok) {
        setSelectedProjectId(null)
        setStatus({ text: '✓ 已刪除專案', ok: true })
        await loadProjects()
        await loadAllMilestones()
      } else setStatus({ text: `✗ 刪除失敗：${r.error}`, ok: false })
    } catch (e) {
      setStatus({ text: `✗ 刪除失敗：${e instanceof Error ? e.message : String(e)}`, ok: false })
    }
  }, [selectedProjectId, loadProjects, loadAllMilestones, setStatus])

  // ── 團隊 CRUD ──
  const handleNewMilestone = useCallback(() => {
    if (!selectedProjectId) {
      setStatus({ text: '✗ 請先選取（或新增）一個專案', ok: false })
      return
    }
    setSelectedMilestoneId(null)
    setCreatingMilestone(true)
    setMilestoneName('')
    setStatus(null)
  }, [selectedProjectId, setStatus])

  const handleSaveMilestone = useCallback(async () => {
    const trimmed = milestoneName.trim()
    if (!trimmed) {
      setStatus({ text: '✗ 請輸入團隊名稱', ok: false })
      return
    }
    try {
      if (creatingMilestone || !selectedMilestoneId) {
        const r = await window.tuq.milestones.create({
          name: trimmed,
          projectLocalId: selectedProjectId,
        })
        if (r.ok) {
          setStatus({ text: '✓ 已新增團隊', ok: true })
          setCreatingMilestone(false)
          setSelectedMilestoneId(r.data.id)
          await loadMilestones(selectedProjectId)
          await loadAllMilestones()
        } else setStatus({ text: `✗ 新增失敗：${r.error}`, ok: false })
      } else {
        const r = await window.tuq.milestones.update({ localId: selectedMilestoneId, name: trimmed })
        if (r.ok) {
          setStatus({ text: '✓ 已儲存', ok: true })
          await loadMilestones(selectedProjectId)
        } else setStatus({ text: `✗ 儲存失敗：${r.error}`, ok: false })
      }
    } catch (e) {
      setStatus({ text: `✗ 失敗：${e instanceof Error ? e.message : String(e)}`, ok: false })
    }
  }, [milestoneName, creatingMilestone, selectedMilestoneId, selectedProjectId, loadMilestones, loadAllMilestones, setStatus])

  const handleDeleteMilestone = useCallback(async () => {
    if (!selectedMilestoneId) return
    try {
      const r = await window.tuq.milestones.delete(selectedMilestoneId)
      if (r.ok) {
        // 若被刪的 milestone 正是當前 filter，重置 filter 避免清單靜默空白（F4）。
        if (milestoneFilter === selectedMilestoneId) setMilestoneFilter('')
        setSelectedMilestoneId(null)
        setStatus({ text: '✓ 已刪除團隊', ok: true })
        await loadMilestones(selectedProjectId)
        await loadAllMilestones()
      } else setStatus({ text: `✗ 刪除失敗：${r.error}`, ok: false })
    } catch (e) {
      setStatus({ text: `✗ 刪除失敗：${e instanceof Error ? e.message : String(e)}`, ok: false })
    }
  }, [selectedMilestoneId, milestoneFilter, selectedProjectId, loadMilestones, loadAllMilestones, setMilestoneFilter, setStatus])

  // ── AI 草稿 apply（D22 第三步）：灌入左側「新增專案」表單（creating 模式，未送出）──
  // **不直接寫 DB** —— 僅填專案名 + 暫存團隊清單；人工按「建立」才建專案，建好後自動建團隊。
  const handleApplyDraft = useCallback((draft: ProjectConfigDraft) => {
    setSelectedProjectId(null)
    setSelectedMilestoneId(null)
    setCreatingProject(true)
    setProjectName(draft.projectName)
    const names = draft.milestones.map((m) => m.name).filter((n) => n.trim())
    setPendingMilestones(names)
    setStatus({
      text:
        names.length > 0
          ? `↓ 已套用 AI 草稿：專案「${draft.projectName}」+ ${names.length} 個團隊；請人工確認後按「建立」`
          : `↓ 已套用 AI 草稿：專案「${draft.projectName}」；請人工確認後按「建立」`,
      ok: true,
      persist: true,
    })
  }, [setStatus])

  return {
    selectedProjectId,
    setSelectedProjectId,
    projectName,
    setProjectName,
    creatingProject,
    setCreatingProject,
    pendingMilestones,
    setPendingMilestones,
    selectedMilestoneId,
    setSelectedMilestoneId,
    milestoneName,
    setMilestoneName,
    creatingMilestone,
    setCreatingMilestone,
    projDeleteConfirm,
    setProjDeleteConfirm,
    projDeleteTimerRef,
    milDeleteConfirm,
    setMilDeleteConfirm,
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
  }
}
