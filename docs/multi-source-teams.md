# 多來源團隊（Multi-Source Teams）設計

> 狀態：設計定案，分階段實作中。
> 緣起：團隊不再假設全部位於單一 `AgentOrg/agents/` 底下，可散在不同雲端/硬碟、專案 repo、本機資料夾。分組（事業群）維持 UI 標籤、與資料夾解耦。

## 核心原則

> **存「少數的來源」（可攜），推導「多數的團隊路徑」。**

- 不存每隊絕對路徑；存一份**來源清單**（通常 3~5 個），每個來源用穩定 junction 引用 → 跨機一致、不被複寫。
- 團隊位置 = `該來源根 + 團隊資料夾`，照舊推導。
- 機器專屬的（來源清單、junction、agentOrgRoot）一律留本機；共用區（團隊檔、可攜 SKILL.md）不含任何機器路徑。

## 資料模型

### 來源（Team Source）— 本機設定，新 app_settings key `agentTeamSources`
```ts
interface TeamSource {
  id: string;        // 穩定識別碼（如 'default'、'projectX'、'local'）
  label: string;     // 顯示名（如「公司共用」「本機草稿」）
  path: string;      // agents 根（建議指向穩定 junction，如 C:\teamuq-agents\agents）
  kind?: 'gdrive-shared' | 'local' | 'project-repo' | 'other';
}
interface TeamSourcesConfig { version: 1; sources: TeamSource[] }
```
**遷移**：讀取時若 `agentTeamSources` 不存在但舊 `agentOrgRootPath` 有 → 合成單一來源
`{ id:'default', label:'預設', path:<舊 root>, kind:'gdrive-shared' }`。舊 key 保留為 default 來源路徑，向後相容。

### 團隊識別 — sourceId 為「獨立欄位」，不編碼進 teamId
- `AgentTeamDto` 新增 `sourceId: string`（與 `sourceLabel?`）。
- **預設來源（id='default'）的團隊維持裸 teamId**（`sw`、`platform/goose-ops`）→ 既有 registry 列、groupConfig mapping、session team_id **完全不動**（零遷移、零 blast radius）。
- **非預設來源的團隊**用複合鍵 `sourceId::teamId`（`::` 不會出現在資料夾名，與 teamId 內既有的 `/` 子團隊分隔不衝突）。
- 路徑解析：給一個團隊，先查它的 `sourceId` → 取該來源根 → `path.join(sourceRoot, ...teamId.split('/'))`。**不再用單一全域 root**。

### 分組（事業群）— UI 標籤，維持現狀
- `groupConfig.mappings` 的 key 用「團隊的系統鍵」（預設來源＝裸 teamId、其他＝`sourceId::teamId`）。
- 預設來源既有 mapping 不變；新來源團隊新增 mapping 即可。

### 入口 skill — 跟著來源走
- `resolveEntrySkill` 掃「該團隊所屬來源」的 `<sourceRoot>/../.claude/skills/`（每個來源各自一份 skills 目錄）。

## 分階段

### Phase 1 — 來源清單 + 多根掃描（向後相容，UI 不變）
- 新 `agentTeamSources` 設定 + 從 `agentOrgRootPath` 自動遷移成 1 個 default 來源。
- `_resolveAgentOrgRoot()` → `_resolveAgentOrgSources()`（回傳清單）。
- scan wrapper 迭代來源、各自 `scanAgentOrg(sourceRoot)`、團隊標 `sourceId`、合併。`_mergeStandardized` 逐來源。
- `AgentTeamDto` 加 `sourceId`/`sourceLabel`。
- 路徑解析層（getAgentDetail、isQuickCreatedTeam、registerTeam、resolveEntrySkill、openTeamFolder）改吃「該團隊的來源根」而非單一 root。
- **驗收**：只有 default 來源時，行為與現況逐字一致（teamId 裸、無遷移）。
- 風險點：`agentRegistryOps.ensureAgentRegistryRow` 的 `lastIndexOf('/')` 加註解＋確認對 `sourceId::teamId` 仍正確（`::` 不影響，agentId 仍 `<key>/manager`）。

### Phase 2 — 來源管理 UI
- 設定頁（延伸 RootPathEditor / Settings 的 AgentTeamsSection）：列出來源、新增（選資料夾→可自動建穩定 junction→偵測 Google Drive 掛點）、移除、改 label。
- 新 IPC：`agentOrg:listSources` / `addSource` / `removeSource` / `updateSource`。

### Phase 3 — 複合鍵 + 撞名處理 + groupConfig 遷移
- 非預設來源團隊 key = `sourceId::teamId`；UI 顯示隱藏前綴、tooltip 顯示來源。
- 撞名（兩來源同資料夾名）用 sourceId 區分；UI 標注來源徽章。
- groupConfig 一次性遷移工具（既有裸 key 不動）。
- 單元測試涵蓋多層 teamId + 複合鍵路徑拆分。

### Phase 4 — 逐來源入口 skill + 「團隊沒 skill」UX
- inspect/register 逐來源解析 skills 目錄。
- 偵測「有團隊、無入口 skill」→ badge/詳情抽屜顯示「尚未設定入口指令」+「建立入口指令」按鈕（呼叫 renderClaudeEntrySkill 產生可攜 SKILL.md），取代目前看不懂的「找不到入口指令」錯誤。
- （治標：web-to-db 已於 2026-06-14 手動補 `tuq-web-to-db` 入口 skill。）

## 不做 / 反模式
- ❌ 把每隊絕對路徑塞 DB（跟機器走、會複寫、可推導）。
- ❌ 把機器專屬路徑寫進共用 AgentOrg（用 hostname 命名或留本機，比照 `introduction.draft.{hostname}.json`）。
- ❌ 用單一全域 root 推所有團隊路徑（多來源後必錯）。
