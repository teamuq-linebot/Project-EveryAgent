import React from 'react'
import AiChatShell from '../shell/AiChatShell'
import AiChatPanel from '../shell/AiChatPanel'
import { useProjectManagement } from './projectManagement/useProjectManagement'
import ProjectMasterTree from './projectManagement/ProjectMasterTree'
import ProjectDetailPanel from './projectManagement/ProjectDetailPanel'
import MilestoneDetailPanel from './projectManagement/MilestoneDetailPanel'

// 常數 / 型別 re-export：維持既有 import path 可用（搬至 sibling，原檔不留重複定義）。
export {
  TASK_STATUS_LABELS,
  PROJECT_STATUS_OPTIONS,
  DEFAULT_PROJECT_STATUS_FILTER,
  FALLBACK_PROJECT_STATUS,
  TOOLS,
} from './projectManagement/constants'
export type { Tool } from './projectManagement/constants'

/**
 * ProjectManagementView — U2 專案管理頁強化（plan §12 U2 / §2.4 / §2.6 / §2.7 / D18）。
 *
 * 版面同監測任務頁：「左主內容 + 右 AI 對話欄」（AiChatShell）。
 *
 * 左主內容 = 專案 → 團隊 → 成員 階層管理：
 *   - 專案 CRUD（projects channel）+ 平台指派（platform_local_id 下拉選 enabled platforms +
 *     sync_enabled 開關，呼叫 taskSync.setPlatform/setSyncEnabled → repo setPlatformCascade
 *     級聯；UI 防呆提示「將一併設定下層 N 項」+ §2.4 互鎖 + 鏡像列唯讀）。
 *   - 團隊 CRUD（milestones channel）+ 專案資料夾綁定（milestone_bindings：project_path /
 *     tool / custom_command 表單，走既有 config.getMilestone/setMilestone）。
 *   - 團隊成員（本地唯讀顯示；milestones.findMembers）。
 *
 * 右欄 = AiChatPanel（同 D22 安全閘 shell）：AI 輔助諮詢（草稿→預覽→確認）。
 *
 * bridge（taskSync / platforms / milestones.findMembers）未就緒時安全降級為唯讀提示，不丟例外。
 *
 * 拆分（move-only facade）：資料/狀態/邏輯集中在 useProjectManagement hook；
 * 左樹 / 專案明細 / 團隊明細 / 同步 banner 拆為 projectManagement/ 子元件。對外 default export 不變。
 */
export default function ProjectManagementView(): React.JSX.Element {
  const vm = useProjectManagement()

  const main = (
    <div className="settings-view management-view">
      <h2 className="settings-view__title" style={{ margin: 0 }}>
        專案管理
      </h2>

      <div className="management-layout">
        {/* master：專案 → 團隊 階層樹 */}
        <ProjectMasterTree
          listWidth={vm.listWidth}
          handleNewProject={vm.handleNewProject}
          search={vm.search}
          setSearch={vm.setSearch}
          statusFilter={vm.statusFilter}
          toggleStatusFilter={vm.toggleStatusFilter}
          milestoneFilter={vm.milestoneFilter}
          setMilestoneFilter={vm.setMilestoneFilter}
          allMilestones={vm.allMilestones}
          selectedProjectId={vm.selectedProjectId}
          setSelectedProjectId={vm.setSelectedProjectId}
          selectedMilestoneId={vm.selectedMilestoneId}
          setSelectedMilestoneId={vm.setSelectedMilestoneId}
          listLoading={vm.listLoading}
          projects={vm.projects}
          sourceGroups={vm.sourceGroups}
          collapsedGroups={vm.collapsedGroups}
          setCollapsedGroups={vm.setCollapsedGroups}
          milestonesLoading={vm.milestonesLoading}
          milestones={vm.milestones}
          platformNames={vm.platformNames}
          tasksByMilestone={vm.tasksByMilestone}
          handleNewMilestone={vm.handleNewMilestone}
        />

        {/* 可拖拉分隔把手（H2）*/}
        <div
          className="management-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-valuenow={vm.listWidth}
          aria-valuemin={220}
          aria-valuemax={480}
          onMouseDown={vm.handleSplitterMouseDown}
        />

        {/* detail */}
        <section className="settings-section management-detail">
          {/* 新增/編輯團隊 detail（選了團隊或正在建團隊） */}
          {vm.creatingMilestone || vm.selectedMilestone ? (
            <MilestoneDetailPanel
              creatingMilestone={vm.creatingMilestone}
              selectedMilestone={vm.selectedMilestone}
              milestoneName={vm.milestoneName}
              setMilestoneName={vm.setMilestoneName}
              setStatus={vm.setStatus}
              handleSaveMilestone={vm.handleSaveMilestone}
              milDeleteConfirm={vm.milDeleteConfirm}
              setMilDeleteConfirm={vm.setMilDeleteConfirm}
              milDeleteTimerRef={vm.milDeleteTimerRef}
              handleDeleteMilestone={vm.handleDeleteMilestone}
              platformNames={vm.platformNames}
              platformUsers={vm.platformUsers}
              binding={vm.binding}
              setBinding={vm.setBinding}
              handleBrowse={vm.handleBrowse}
              handleSaveBinding={vm.handleSaveBinding}
              members={vm.members}
              tasksByMilestone={vm.tasksByMilestone}
              showCreateTask={vm.showCreateTask}
              setShowCreateTask={vm.setShowCreateTask}
              taskName={vm.taskName}
              setTaskName={vm.setTaskName}
              creatingTask={vm.creatingTask}
              handleCreateTask={vm.handleCreateTask}
            />
          ) : vm.creatingProject || vm.selectedProject ? (
            <ProjectDetailPanel
              creatingProject={vm.creatingProject}
              selectedProject={vm.selectedProject}
              projectName={vm.projectName}
              setProjectName={vm.setProjectName}
              setStatus={vm.setStatus}
              pendingMilestones={vm.pendingMilestones}
              setPendingMilestones={vm.setPendingMilestones}
              platformNames={vm.platformNames}
              platformUsers={vm.platformUsers}
              handleSaveProject={vm.handleSaveProject}
              projDeleteConfirm={vm.projDeleteConfirm}
              setProjDeleteConfirm={vm.setProjDeleteConfirm}
              projDeleteTimerRef={vm.projDeleteTimerRef}
              handleDeleteProject={vm.handleDeleteProject}
            />
          ) : (
            <div className="settings-empty">
              選取左側專案 / 團隊以檢視 / 編輯，或新增本地專案。
            </div>
          )}

          {vm.status && (
            <p
              role={vm.status.ok ? 'status' : 'alert'}
              className={`management-status ${vm.status.ok ? 'management-status--ok' : 'management-status--error'}${vm.statusFading ? ' management-status--fading' : ''}`}
            >
              {vm.status.text}
            </p>
          )}
        </section>
      </div>
    </div>
  )

  const chat = (
    <AiChatPanel
      scope="project"
      onApply={vm.handleApplyDraft}
      greeting="描述要建立的專案與團隊，我會產一份草稿。例如「建一個叫 X 的專案，底下兩個團隊」。安全閘：只產草稿，不直接寫入；套用後請於左側確認再建立。"
      placeholder="例：建一個叫「行銷網站改版」的專案，底下三個團隊"
    />
  )

  return <AiChatShell title="專案管理" main={main} chat={chat} />
}
