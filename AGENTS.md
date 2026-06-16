# teamuq-electron — 專案導航地圖

## 構建 / 啟動 / 測試指令

```bash
npm run dev              # electron-vite dev（HMR，三段並行）
npm run build            # 生產構建 → out/
npm run typecheck        # tsc --build --force（先刪 tsbuildinfo 再跑，避免假綠）
npm run lint             # eslint . （max-lines:500 守門）
npm test                 # vitest（全 suite 需 singleFork；見已知陷阱）
npm run test:e2e         # playwright test（需先 build 或在 dev 下跑）
npm run rebuild:node     # npm rebuild better-sqlite3 → Node ABI（vitest 用）
npm run rebuild:electron # electron-builder install-app-deps → Electron ABI（app 用）
```

## 目錄地圖

```
src/
  main/          主行程（Node + Electron）→ @src/main/AGENTS.md
  preload/       sandbox bridge 層（contextBridge 注入 window.tuq）
    index.ts     — 唯一入口；逐域 import bridges/
    bridges/     — 每域一個 *Bridge.ts（pty/auth/tasks/session/monitor/punch/…）
  renderer/      React 渲染行程 → @src/renderer/AGENTS.md
  shared/        main ↔ preload ↔ renderer 共享型別
    ipcContracts.ts    — IPC 型別 barrel（re-export contracts/ 下各域）
    ipc/contracts/     — 各域契約（result/pty/auth/task/session/monitor/punch/…）
    cliRegistry.ts     — CliId（Codex/codex/antigravity）描述子
tests/           vitest spec（全在此目錄，include: tests/**/*.spec.ts）
  e2e/           playwright E2E（golden-path + screenshot tests）
```

## 構建架構（electron-vite 三段）

| 段 | 入口 | 打包工具 | 輸出 |
|---|---|---|---|
| main | src/main/index.ts + worktime/scanWorker.ts | esbuild（rollup） | out/main/ |
| preload | src/preload/index.ts | esbuild（rollup） | out/preload/ |
| renderer | src/renderer/main.tsx | Vite + react | out/renderer/ |

- `node-pty` 為 external（非 bundle）；main 端**禁 lazy require / 動態 import**（esbuild 不打包動態 require，runtime 缺模組）
- preload 中 `zod` 必須 bundle（sandbox preload 不能 require 外部 npm 模組，故 exclude from externalize）
- `externalizeDepsPlugin` 處理其餘 main/preload 依賴

## 關鍵域說明

### 打卡與監測
- `src/main/db/punchLedger.ts` — SQLite 打卡帳本（better-sqlite3，WAL，忠實移植 Python）
- `src/main/monitor/MonitorController.ts` — 監測編排 Controller（2s setInterval 掃描迴圈）
- `src/main/monitor/punchExecutor.ts` — 打卡執行層
- `src/main/services/punchService.ts` — 打卡決策 Application Service（移植 Python punch_service.py）
- `src/main/services/punchBuilder.ts` — 打卡欄位組裝 mixin

### 任務同步
- `src/main/repo/sqliteTaskRepository.ts` — teamuq.db 主 repository（19 表 schema，facade）
  - `src/main/repo/sqlite/` — schema.ts / types.ts / util.ts / version.ts / platformInstance.ts（拆出子模組）
- `src/main/sync/syncEngine.ts` — 同步編排（per-platform 先推後拉，facade）
  - `src/main/sync/engine/` — resolvers / expander / locBackfill / versionPolicy / syncTypes / syncUtils
  - `src/main/sync/adapters/` — graphqlAdapter / restAdapter（按 platform.protocol 選）
  - `src/main/sync/auth/` — authProvider（介面 + 分派）/ cognitoOauthHandler / jwtUtils / secretStore
- `src/main/db/migrateToSingleDb.ts` — Phase 4.0 單 DB 整併（冪等 orchestrator）

### AgentTeams（AI 助手團隊）
- `src/main/services/agentOrgService.ts` — 掃描 AgentOrg 目錄、解析 agent.yaml
- `src/main/services/agentConversationService.ts` — 一條 Codex 對話後端（node-pty 裸 shell；兩段時序注入 300ms + 1500ms）
- `src/main/pty/ptyManager.ts` — PTY 生命週期管理（@xterm/headless 無頭終端）
- `src/main/pty/promptDetector.ts` — TUI 選單偵測（pure leaf function）

### Session 管理
- `src/main/services/sessions.ts` — 啟動指令組裝（buildLaunchCommand）
- `src/main/services/conversationStore.ts` — 對話 JSONL 快取（conv_state/conv_messages/conv_segments）
- `src/main/monitor/sessionLiveness.ts` — session 存活偵測（心跳 + ~/.Codex/sessions）

### 工時計算
- `src/main/worktime/worktimeSource.ts` — IWorktimeSource 實作（worker_thread 掃描）
- `src/main/worktime/scanWorker.ts` — worker_thread 入口（獨立 esbuild 入口）
- `src/main/worktime/Codex/` — discover / index / parse（JSONL 純函式 leaf）
- `src/main/worktime/codex/` — discover / parse

### Backend / IPC
- `src/main/backend.ts` — Composition Root（Application Service 層，facade；>500 行豁免）
- `src/main/ipc/router.ts` — 統一 IPC 入口（registerIpcHandlers；domains 逐一呼叫）
- `src/main/ipc/handlers/` — 各域 handler（ptyHandlers / authHandlers / taskHandlers / …）

## 資料庫
- 路徑：`~/.teamuq/teamuq.db`（WAL，`TEAMUQ_HOME` env 覆寫，測試用 tmp DB）
- 讀取端**一律讀 teamuq.db 表**；舊 JSON（~/.teamuq/*.migrated.*）已廢棄
- `punchLedger` + `sqliteTaskRepository` 兩處 DDL 須同步維護（subtasks partial index）
- punch ⋈ subtask JOIN 須用 `OR s.remote_id = p.subtask_id`（locBackfill 後 local_id 不再匹配）

## ESLint 守門
- `max-lines: 500`（skipBlankLines/skipComments）；新檔超 500 即 CI 擋下
- 既有大檔已列入 `eslint.config.mjs` allowlist（見 `files:` 陣列）；重構降下後移除豁免

## 已知陷阱

### better-sqlite3 雙 ABI
- vitest 需 **Node ABI**：`npm run rebuild:node`
- app 需 **Electron ABI**：`npm run rebuild:electron`
- 兩者混用 → 測試全紅或 app 起不來；`BSQ3_NODE_ABI=1` 可啟用 `.abi-node-bsq3/` 備用路徑

### vitest singleFork
- 全 suite 必須 singleFork（DB 連線 + PTY 不支援並行 worker）
- `vitest.config.ts` 目前未明確設 `pool:'forks'`；若未來新增 pool 設定，必須加 `singleFork:true`

### 22 個 pre-existing 紅燈
- `tests/qwen.spec.ts` + `tests/punchExecutor.spec.ts`（qwen.ts 已刪，殘留 import）
- `tests/agentTeamsBuildGraph.spec.ts`（dagre 邊界 edge case）
- 這些**非新 regression**；驗 regression 只看相對基線新增的紅燈

### parallel tsc 假訊號
- 多 worker 並行各跑 `tsc --build --force` 會汙染 `out/*.tsbuildinfo` 致假綠/假紅
- 權威 typecheck：先刪 tsbuildinfo 再單跑，或用 `--noEmit`

### userData 錨定
- `index.ts` 明確 `app.setPath('userData', …/teamuq-electron)`；改顯示名勿動此行（防資料目錄漂移）

### esbuild 不打包動態 require
- main 端所有 import 須頂層（禁 lazy require / `await import()`）
- 違反 → 打包版 runtime 缺模組，難以在 dev 模式發現
