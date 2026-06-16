# src/main — 主行程導航地圖

## 目錄職責速查

| 目錄 / 檔案 | 職責 |
|---|---|
| `index.ts` | Electron app 入口；建 BrowserWindow、singleton PtyManager + Backend、registerIpcHandlers |
| `backend.ts` | Composition Root（Application Service 組裝層）；含 MonitorController 持有與 emit 注入；>500 行 allowlist |
| `updater.ts` | electron-updater 自動更新 |
| `ipc/router.ts` | 統一 registerIpcHandlers；各域 handlers/ 逐一呼叫 |
| `ipc/handlers/` | 按域拆分的 ipcMain.handle 呼叫（pty/auth/task/session/monitor/punch/config/…） |
| `db/punchLedger.ts` | 打卡 SQLite 帳本（better-sqlite3；>500 行 allowlist） |
| `db/punchSchema.ts` | DDL 常數（punches/notifications/subtasks 表 + index） |
| `db/punchSqlHelpers.ts` | SQL 純函式 helper |
| `db/migrateToSingleDb.ts` | Phase 4.0 單 DB 整併（冪等 orchestrator；>500 行 allowlist） |
| `repo/sqliteTaskRepository.ts` | teamuq.db 主 repository（19 表 schema；facade；>500 行 allowlist） |
| `repo/sqlite/` | schema.ts / types.ts / util.ts / version.ts / platformInstance.ts（拆出子模組） |
| `repo/taskRepository.ts` | ITaskRepository 介面 |
| `repo/appSettingsStore.ts` | app_settings KV store |
| `sync/syncEngine.ts` | 同步編排 facade（per-platform 先推後拉；>500 行 allowlist） |
| `sync/engine/` | resolvers / expander / locBackfill / versionPolicy / syncTypes / syncUtils |
| `sync/adapters/` | graphqlAdapter / restAdapter（按 platform.protocol 選；restAdapter >500 行 allowlist） |
| `sync/auth/` | authProvider（介面 + 分派）/ cognitoOauthHandler / jwtUtils / secretStore |
| `sync/platformSeeds.ts` | 平台種子資料 reconcile（>500 行 allowlist） |
| `sync/taskProjection.ts` | pull 回應展開投影 |
| `monitor/MonitorController.ts` | 監測 Controller（2s 掃描迴圈；>500 行 allowlist） |
| `monitor/punchExecutor.ts` | 打卡執行層（>500 行 allowlist） |
| `monitor/sessionLiveness.ts` | session 存活偵測（心跳 + ~/.claude/sessions） |
| `monitor/SessionRunStateMachine.ts` | session run-state FSM |
| `monitor/PunchTableBuilder.ts` | 打卡表 UI 資料組裝 |
| `services/taskService.ts` | 任務 CRUD Application Service |
| `services/punchService.ts` | 打卡決策（移植 Python punch_service.py；>500 行 allowlist） |
| `services/punchBuilder.ts` | 打卡欄位組裝 mixin |
| `services/agentOrgService.ts` | 掃描 AgentOrg 目錄、解析 agent.yaml |
| `services/agentConversationService.ts` | AgentTeams 對話後端（node-pty 裸 shell；兩段時序注入） |
| `services/conversationStore.ts` | 對話 JSONL 快取（conv_state/messages/segments；>500 行 allowlist） |
| `services/cliBackendService.ts` | AI CLI 偵測 / 深驗 / 安裝計畫（純 fs/child_process） |
| `services/teamRegistrationService.ts` | team ↔ claude/codex skill 同步（>500 行 allowlist） |
| `services/sessions.ts` | 啟動指令組裝（buildLaunchCommand） |
| `services/conversation/` | legacyDbMigration / parseHelpers / segmentCache |
| `pty/ptyManager.ts` | PTY 生命週期（@xterm/headless 無頭終端；node-pty external） |
| `pty/promptDetector.ts` | TUI 選單偵測（pure leaf function；可直接 import） |
| `worktime/worktimeSource.ts` | IWorktimeSource 實作（worker_thread 掃描） |
| `worktime/scanWorker.ts` | worker_thread 入口（esbuild 獨立入口） |
| `worktime/aggregate.ts` | collectPunchEvents 聚合 |
| `worktime/punchCore.ts` | 打卡核心邏輯（>500 行 allowlist） |
| `worktime/claude/` | discover / index / parse（JSONL 純函式 leaf） |
| `worktime/codex/` | discover / parse |
| `worktime/scanWatermarkStore.ts` | 水位持久化（scan_watermarks 表） |
| `llm/` | api / claudeCliProvider / openaiCompatProvider / provider / providerConfig（>500 行 allowlist） |
| `config/milestones.ts` | MilestoneEntry 設定 |
| `config/taskSessions.ts` | task_sessions 設定 |
| `backend/` | 拆出 helpers / types / monitorView / services（為 backend.ts 減行數） |

## 關鍵約束

- **禁 lazy require / 動態 import**：esbuild 不打包動態 require，打包版 runtime 缺模組
- **DB 路徑**：`~/.teamuq/teamuq.db`；`TEAMUQ_HOME` env 覆寫（測試 tmp DB 隔離）
- **punch ⋈ subtask JOIN**：locBackfill 後須用 `OR s.remote_id = p.subtask_id`
- **punchLedger + sqliteTaskRepository 兩處 DDL 同步**：partial index ON CONFLICT target 須帶逐字相同 WHERE 子句
- **backend.ts 禁 import BrowserWindow / app**：由 index.ts 注入（可單測）
