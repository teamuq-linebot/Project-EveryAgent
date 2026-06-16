# src/renderer — 渲染行程導航地圖

## 入口

- `main.tsx` — ReactDOM.createRoot → `<App />`
- `App.tsx` — 根元件；管理 tab 切換（kanban / projects / milestones / agent-teams / platforms / settings / session）
- `global.css` — 全域樣式
- `theme.ts` — ThemeMode 型別 + localStorage 讀寫

## 目錄職責速查

### hooks/（共享狀態 hooks）

| Hook | 職責 |
|---|---|
| `useAuth.ts` | 認證狀態（登入/登出/帳號切換） |
| `useTasks.ts` | 任務清單與 CRUD |
| `useSession.ts` | OpenSession 管理（開/關 session tab） |
| `useMonitor.ts` | 監測狀態訂閱（IPC push 事件） |
| `useConversation.ts` | Session 對話訊息（ConversationMessage[]） |
| `useAgentConversation.ts` | AgentTeams 對話訊息（agentConv IPC push） |
| `useCheckinRecords.ts` | 打卡紀錄讀取 |
| `useTheme.ts` | 主題切換 |

### views/（頁面層）

#### Kanban/
- `KanbanBoard.tsx` — 看板主視圖（mine-only toggle / platform filter）
- `TaskCard.tsx` — 任務卡片

#### Session/
- `SessionTabHost.tsx` — session tab 掛載點（動態 session）
- `SessionTab.tsx` — 終端 + 監測面板容器
- `Terminal.tsx` — xterm.js 終端元件
- `TerminalPanel.tsx` — 終端 + 工具列
- `MonitorPanel.tsx` — 監測狀態面板
- `PunchTable.tsx` — 打卡表（normalizeDbRow → makePunchRow 在 hook 層完成，非 backend/preload）
- `PunchDetailDialog.tsx` — 打卡詳情對話框
- `ConversationPanel.tsx` — 對話訊息面板（>500 行 allowlist）
- `conversation/` — Card / CliWaitCard / blocks / badges / SegmentGroup / helpers（>500 行 allowlist）

#### AgentTeams/
- `AgentTeamsView.tsx` — AI 團隊 org-chart（>500 行 allowlist）
- `AgentDetailDrawer.tsx` — 抽屜面板（SoulMarkdown / WorkflowStructured；>500 行 allowlist）
- `AgentConversationArea.tsx` / `AgentConversationPane.tsx` — 嵌入式對話區
- `AgentOrgList.tsx` — 工作群組 → 團隊清單
- `OrgFlowCanvas.tsx` — ReactFlow org-chart 畫布（@xyflow/react + @dagrejs/dagre）
- `nodes/` — GroupNode / TeamNode / WorkerNode（ReactFlow 自訂節點）
- `groupConfig.ts` / `useGroupConfig.ts` / `GroupConfigEditor.tsx` — 群組顯示設定
- `buildOrgGraph.ts` — dagre 佈局計算
- `agentOrgPath.ts` / `orgTypes.ts` / `agentTeamsHelpers.tsx` — 純函式 leaf

#### Management/
- `ProjectManagementView.tsx` — 專案管理主視圖（tabs: milestones / members）
- `projectManagement/` — ProjectMasterTree / ProjectDetailPanel / MilestoneDetailPanel / useProjectManagement（>500 行 allowlist）/ SyncConfirmBanner / constants

#### Settings/
- `SettingsPage.tsx` — 設定頁容器
- `CliBackendSection.tsx` / `CliCard.tsx` — AI CLI 後端設定
- `PlatformSettingsView.tsx` — 平台設定
- `platform/` — PlatformForm / PlatformList / OperationsEditor / platformFormTypes
- `sections/` — AdvancedSection / AppearanceSection / AutoRecoverSection / LlmBackendSection / MilestoneSection

#### shell/
- `Sidebar.tsx`（views/）— 左側導覽列

### components/
- `PromptAlertToasts.tsx` — CLI 等待提示 Toast

## window.tuq（IPC 橋）

由 preload/index.ts 注入 `window.tuq`；renderer 呼叫方式：
- `window.tuq.<domain>.<method>(…)` — IPC invoke（回 Promise）
- `window.tuq.onXxx(handler)` — IPC 事件訂閱（回 unsubscribe fn）

各域橋對應：`pty / auth / tasks / session / monitor / punches / config / settings / projects / milestones / platforms / platformOps / platformConfig / projectConfig / taskSync / agentOrg / teamRegistry / agentConv / cliBackend`

## 關鍵約束

- **PunchTable 正規化**：`listPunchesForTask` 回傳原始 DB 列（`status='open'/'done'`）；`makePunchRow` 正規化在 hook `normalizeDbRow()` 完成，**不在 backend/preload 層**
- **AgentTeams splitter 坑**：左欄固定寬用 `flex: 0 0 <w>px`，畫布容器用 `flex: 1`；不可用 `calc(100vh)`
- **PMV/MMV 共用 `management-*` CSS**：改共用 class 必同時驗兩頁（ProjectManagementView + MilestoneManagementView）
- **看板輪詢重排 + UI 點擊**：必須單一 eval 原子化（CDP verify 時）
- **monitor signature**：用 `started_at|status|ended_at` 取代 `rows.length` 才能捕捉內容變動
