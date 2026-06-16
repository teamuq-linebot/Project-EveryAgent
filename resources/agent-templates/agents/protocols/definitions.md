# Agent System Definitions

## Tool (工具)

A **tool** is a capability provided by the Claude Code runtime. Agents do not create tools — they are granted access to existing ones.

Available tools:
- `Read` — read file content
- `Write` — create new files
- `Edit` — modify existing files
- `Bash` — execute shell commands
- `Grep` — search file content by regex
- `Glob` — find files by pattern
- `Agent` / `invoke_subagent` — dispatch sub-agents (Manager+, in Antigravity use `invoke_subagent`)
- `define_subagent` — dynamically register an agent's configuration before invoking (Antigravity only)
- `WebSearch` — search the web
- `WebFetch` — fetch a URL

`tools.md` answers: **"What system capabilities can this agent use?"**

## Skill (技能)

A **skill** is domain knowledge the agent applies using its tools. Skills are not system capabilities — they are learned patterns of how to combine tools to achieve domain-specific goals.

`skills.md` answers: **"What domain problems can this agent solve?"**

## Self-Update Rules

**原則：加法自己來，減法和擴權要審批。**

### Agent 可以自己做的（不需要 Agent Builder）

| 檔案 | 允許的操作 | 條件 |
|------|-----------|------|
| `worklog/*.json` | 寫入 | 每次執行必寫 |
| `memory/*.md` | 讀寫 | 保存學到的東西 |
| `skills.md` | **新增** skill | 必須在自己的領域內，標記 `<!-- self-added {date} -->` |
| `workflow.yaml` | **新增** step | 只能加步驟，不能刪或改現有步驟，標記 `# self-added {date}` |

### 必須經過 Agent Builder 的（需要審批）

| 檔案 | 操作 | 為什麼 |
|------|------|--------|
| `skills.md` | **刪除** skill | 可能影響 Manager 的 dispatch 決策 |
| `tools.md` | 任何修改 | 擴權或縮權，影響職責邊界 |
| `soul.md` | 任何修改 | 改變行為判斷基準，影響全局 |
| `workflow.yaml` | **刪除/修改** step | 可能破壞執行流程 |
| `org.md` | 任何修改 | 影響組織關係 |
| `README.md` | 任何修改 | 影響 dispatch 規則 |
| `agent.yaml` | 任何修改 | 影響 bootstrap 載入順序與 dispatch 路由規則 |
| `CLAUDE.md` registry | 任何修改 | 系統級變更 |

## Agent Type Hierarchy（組織層級）

AgentOrg 使用四層 agent 架構：

| Type | 層級 | 職責 | 管轄 | 可派遣 |
|------|------|------|------|--------|
| Officer (L4) | 最高 | 組織策略、跨 Director 協調、政策制定 | 多個 Director | Director, Manager（跳級） |
| Director (L3) | 高層 | 跨 team 統籌、管理多個 Manager | 多個 Manager | Manager, Worker（跳級） |
| Manager (L2) | 中層 | team 內派遣、Worker 結果合成 | 多個 Worker | Worker |
| Worker (L1) | 執行 | 領域專業實作 | 無 | 無 |

### 層級關係

```
User → Officer → Director → Manager → Worker
```

### 向下相容

現有 agent.yaml 若無 type 欄位，依現有規則判斷：
- reports_to == "user" 且有 Agent tool → manager
- 其他 → worker

---

## Scope Guard（越權拒絕機制）

Every agent MUST refuse tasks outside its domain. When an agent receives a task it shouldn't handle:

1. **Do NOT execute** — even if the task seems simple
2. **Report back to Manager** — respond with:
   ```
   SCOPE VIOLATION: This task belongs to {correct_agent}, not {self}.
   Reason: {why this is out of scope}
   Recommended agent: {correct_agent}
   ```
3. **Manager must re-dispatch** to the correct agent

### File Ownership

| File Type | Owner | Examples |
|-----------|-------|---------|
| Application code | Developer | src/, scripts/, configs |
| Application tests (unit/integration) | Developer (unit), Tester (integration) | test/, spec/ |
| Browser E2E tests with auth | E2E Tester | e2e/, *.spec.ts (playwright), auth fixtures |
| Architecture plans | Architect | design docs, ADRs |
| Agent system files | Agent Builder | soul.md, tools.md, skills.md, org.md, workflow.yaml, definitions.md |
| Agent entry point | Agent Builder | agent.yaml (bootstrap sequence, dispatch rules) |
| Orchestration flow | Agent Builder | SKILL.md (Manager's workflow) |
| Protocol definitions | Agent Builder | worklog-protocol.md, memory-protocol.md, etc. |
| CI/CD & infra | DevOps | .github/, Dockerfile, deploy/ |
| CLAUDE.md registry | Agent Builder | CLAUDE.md agent registry table |
| BNI member data | BNI workers | C:\bni\members\, C:\bni\report\, C:\bni\new\ |
| Platform infra config | Platform workers | agents/platform/, DGX GB10, Goose platform |

---

## 計算委派規則（Calculation Delegation）

**原則：Agent 不可心算，所有數學計算必須委派 shared/calculator。**

AI agent 的數學計算能力不可靠，容易在心算中犯錯。因此：

1. 任何需要精確數值的計算（四則運算、百分比、統計、日期差、單位換算），必須委派 `shared/calculator` agent
2. Calculator agent 只用程式碼（`node -e` 或 `python -c`）計算，絕不用推理或心算
3. 返回結果必須附帶程式碼佐證

### 例外情況
- 程式碼中的內嵌算術（如 for loop 的計數器）不需要委派
- 不需要精確數值的概略描述（「大約一半」、「數百個」）不需要委派
- SQL 聚合查詢（SUM/AVG/COUNT）由 Developer 直接處理

### 可用的 Calculator Agent
- 路徑：`agents/shared/calculator/`
- 派遣模型：sonnet  <!-- 2026-04-27: haiku→sonnet（user policy: ban haiku） -->
- 觸發條件：需要精確數值計算

---

## Platform Team — Agent Registry

平台基礎設施團隊，負責管理 DGX GB10 硬體系統。報告對象：`agent-ops/manager`。

| Agent | 路徑 | 類型 | 職責範疇 |
|-------|------|------|---------|
| gb10-sysadmin | `agents/platform/gb10-sysadmin/` | worker | DGX GB10 系統管理、硬體監控、驅動維護、資源調度 |

### Scope（Platform Team 管轄）
- `agents/platform/` 下所有 agent 定義檔案
- DGX GB10 硬體設定、驅動、資源分配

### 不屬於 Platform Team
- 應用層程式碼 → sw/manager
- Agent 系統定義修改 → agent-ops/manager
- BNI 資料處理 → bni/manager

---

## Finance Team — Agent Registry

財務請款團隊，負責為毛多多股份有限公司代表生成給客戶的請款單。報告對象：`user`（team manager 直接對接用戶）。

| Agent | 路徑 | 類型 | 模型 | 職責範疇 |
|-------|------|------|------|---------|
| manager | `agents/finance/manager/` | manager | sonnet | 接受請款單產生請求、派遣 workers、驗收交付 |
| billing-builder | `agents/finance/billing-builder/` | worker | sonnet | 由範本 xlsx + client config + 工時 TSV + 代購明細產出新 xlsx |
| billing-renderer | `agents/finance/billing-renderer/` | worker | sonnet | xlsx → PDF（LibreOffice headless）+ 蓋章疊加 <!-- 2026-04-27: haiku→sonnet（user policy: ban haiku） --> |
| billing-qa | `agents/finance/billing-qa/` | worker | sonnet | 8 項驗收：金額、編號唯一性、累計結餘、時數一致、PDF 完整性、蓋章確認、bug 修正、客戶資料一致 |

### Scope（Finance Team 管轄）
- `agents/finance/` 下所有 agent 定義檔案
- `agents/finance/config/*.yaml`（每客戶一份 config）
- `agents/finance/template/*.xlsx`（客戶範本，需人工放入）
- `agents/finance/assets/*.png`（蓋章圖等，需人工放入）
- 客戶資料夾內請款單 xlsx/PDF 的讀寫（如 `G:\共用雲端硬碟\客服.SAVFE.財務\`）

### 不屬於 Finance Team
- 應用程式碼（`scripts/finance/*.py`）→ sw/manager
- Agent 系統定義修改 → agent-ops/manager
- 會計帳務、稅務申報、一般財務報表
- 合約撰寫與審查

### 相關客戶資料夾（用戶維護）
- 思輔科技：`G:\共用雲端硬碟\客服.SAVFE.財務\`
- 新客戶：用戶新增時需建立對應 `agents/finance/config/{client_code}.yaml`

### 立場
- 供應商：毛多多股份有限公司（統編 50799368，負責人黃嘉和）
- 服務類型：電子顧問訂閱制（預設 38 小時月費 + 超額加購 + 代購加成 + 設備使用）
- Finance Team 產出「毛多多 → 客戶」的請款單，**不**處理客戶給毛多多的進項發票

---

## 1997-Factory Team — Agent Registry

披薩食品工廠生產團隊，負責 4–11吋 pizza 的生產線規劃與生產管理。報告對象：`user`。

| agent | path | type | model | description |
|-------|------|------|-------|-------------|
| manager | `agents/1997-factory/manager/` | manager | opus | 廠長：拆解產線/生管任務、派遣、合成、把關 |
| process-spec | `agents/1997-factory/process-spec/` | worker | sonnet | \[R\] 配方/BOM、設備規格、食安/HACCP 法規、產能需求蒐集 |
| line-planner | `agents/1997-factory/line-planner/` | worker | sonnet | \[D\] 4–11吋產線佈局/站別/節拍/瓶頸/換型 SMED |
| production-controller | `agents/1997-factory/production-controller/` | worker | sonnet | \[D\] 排程/工單/WIP/MRP/OEE/班別/日報 |
| quality-safety | `agents/1997-factory/quality-safety/` | worker | sonnet | \[V\] HACCP/CCP/食安驗收 + 品質檢驗 + 規劃方案 QA |

### Scope（1997-Factory Team 管轄）
- 4–11吋 pizza 產線規劃（站別設計、節拍計算、瓶頸分析、換型 SMED）
- 生產排程與工單管理（MRP/OEE/WIP/班別/日報）
- 物料 BOM、設備規格、產能需求蒐集
- 食安驗收（HACCP/CCP）與品質檢驗

### 不屬於 1997-Factory Team
- 應用程式碼 → sw/manager
- 硬體設計（PCB/電路）→ hw-design/manager
- 非生產製造任務（行銷、業務、財務）→ 對應 team manager 轉介

---

## Social Team — Agent Registry

社群內容團隊，把品牌/個人語氣轉成跨平台社群內容（FB/IG/Threads/X）。報告對象：`user`。

| agent | path | type | model | description |
|-------|------|------|-------|-------------|
| manager | `agents/social/manager/` | manager | opus | 組長：拆解、派遣、整合、把關 brand-safety gate |
| trend-researcher | `agents/social/trend-researcher/` | worker | sonnet | \[R\] 受眾/熱點/競品研究 + 使用者語氣模式擷取（voice_profile） |
| content-writer | `agents/social/content-writer/` | worker | sonnet | \[D\] 內容日曆 + FB/IG/Threads/X 平台化文案 |
| visual-designer | `agents/social/visual-designer/` | worker | sonnet | \[D\] 配圖/縮圖視覺方向與生成 prompt |
| content-qa | `agents/social/content-qa/` | worker | opus | \[V\] 品牌調性 + 敏感詞法遵 + 平台政策驗收 |

### Scope（Social Team 管轄）
- 跨平台社群貼文與內容日曆（FB/IG/Threads/X 平台化改寫）
- 品牌/個人語氣擷取與套用（voice_profile）
- 受眾/熱點/競品研究、配圖視覺方向與生成 prompt
- 品牌安全、敏感詞、平台政策合規驗收

### 不屬於 Social Team
- 影片/短影音製作 → video/manager
- 應用程式碼 → sw/manager
- agent 系統維護 → agent-ops/manager
- 教材內容 → edu/manager

---

## Video Team — Agent Registry

短影音製作團隊，自動化短影音/YouTube 產製 pipeline。報告對象：`user`。

| agent | path | type | model | description |
|-------|------|------|-------|-------------|
| manager | `agents/video/manager/` | manager | opus | 組長：拆解 pipeline、派遣、整合、把關 |
| video-researcher | `agents/video/video-researcher/` | worker | sonnet | \[R\] 選題/趨勢/參考片拆解（topic_brief） |
| script-writer | `agents/video/script-writer/` | worker | sonnet | \[D\] 逐句腳本 + 開場 hook + 分鏡 shotlist |
| asset-producer | `agents/video/asset-producer/` | worker | sonnet | \[D\] 視覺生成 prompt + TTS 配音腳本 + B-roll 清單 |
| video-editor | `agents/video/video-editor/` | worker | sonnet | \[D\] CapCut JSON + ffmpeg 組裝工程檔 |
| video-qa | `agents/video/video-qa/` | worker | opus | \[V\] 節奏/字幕/平台規格/版權合規驗收 |

### Scope（Video Team 管轄）
- 短影音/YouTube 選題、腳本、分鏡
- 視覺生成 prompt、TTS 配音腳本、素材清單與授權
- CapCut JSON / ffmpeg 組裝工程檔
- 節奏/字幕/平台規格/版權合規驗收

### 不屬於 Video Team
- 純社群圖文貼文 → social/manager
- 應用程式碼 → sw/manager
- agent 系統維護 → agent-ops/manager
- 教材內容 → edu/manager

---

## Agent Entry Point Schema (agent.yaml)

`agent.yaml` 是每個 agent 的唯一入口，定義 bootstrap 載入順序與 dispatch 路由規則。

### 必填欄位 (Required)

| 欄位 | 型別 | 說明 |
|------|------|------|
| `agent` | string | agent 的短名稱（與目錄名相同） |
| `title` | string | 人類可讀的完整職稱 |
| `team` | string | 所屬 team（`sw` / `edu` / `agent-ops` / `shared`） |
| `reports_to` | string | 回報對象（`user` 或 `team/role`，如 `sw/manager`） |
| `type` | string | agent 類型（`worker` / `manager` / `director` / `officer`） |
| `bootstrap` | list | 載入順序清單，必須包含 `soul.md`、`org.md`、`tools.md` |
| `workflow` | string | 執行入口，固定為 `workflow.yaml` |
| `dispatch.model` | string | 預設模型（`sonnet` / `opus`，2026-04-27: haiku 禁用） |
| `dispatch.trigger` | string | 一行說明：什麼情況派遣此 agent |
| `dispatch.not_for` | string | 一行說明：什麼情況不應派遣此 agent |

### 條件必填欄位 (Conditional Required) <!-- self-added 2026-05-23 rdv-trich-p2-rules-20260523 -->

| 欄位 | 必填條件 | 型別 | 允許值 | 說明 |
|------|---------|------|--------|------|
| `role_in_team` | `type == worker` 強制必填；`type ∈ {manager, director, officer}` 自動視為 `manager`，無須填寫 | string（**禁止多值**） | `researcher` \| `doer` \| `verifier` \| `shared` | 在 team 內擔任的角色分類；受 `agents/protocols/rules/agent-anatomy.md` §6.9 Team Trichotomy Rule 約束；完整規範見 `agents/protocols/team-trichotomy-protocol.md` |

> **Grace period（既有 agent 過渡）**：截止 2026-06-22 前允許 `role_in_team: unclassified`；其後此值不再合法，所有 worker 必須完成歸類。

### 選填欄位 (Optional)

| 欄位 | 型別 | 說明 |
|------|------|------|
| `skills` | string | 技能檔路徑（`skills.md`），有 skills.md 的 agent 應宣告此欄位 |

### 標準範本

```yaml
agent: {name}
title: "{Title}"
team: {team}
type: worker | manager | director | officer    # ← 新增
reports_to: {target}

# 2026-05-23 self-added：worker type 強制必填；manager+ type 自動視為 manager，免填
role_in_team: researcher | doer | verifier | shared   # worker only；禁止多值

bootstrap:
  - soul.md
  - org.md
  - tools.md

workflow: workflow.yaml

dispatch:
  model: sonnet | opus  # 2026-04-27: haiku 禁用
  trigger: "一行描述：何時派遣"
  not_for: "一行描述：何時不派遣"

# 選填，僅在 skills.md 存在時宣告
skills: skills.md
```

### 修改規則

- `agent.yaml` 屬 Agent Builder 管轄，任何修改須透過 Agent Builder 審批
- Bootstrap 清單順序不可任意調換（soul → org → tools 是固定順序）
- `dispatch.model` 變更視同擴權，需 Governance 審查
- `role_in_team` 變更視同職責變更，需 Agent Builder 審批並重跑 Team Trichotomy Check（詳見 `agents/protocols/rules/agent-anatomy.md` §6.9）
