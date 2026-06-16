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
- `Agent` — dispatch sub-agents (Manager only)
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

**原則：Agent 不可心算，所有數學計算必須委派 agents/agent-ops/_shared/calculator。**

AI agent 的數學計算能力不可靠，容易在心算中犯錯。因此：

1. 任何需要精確數值的計算（四則運算、百分比、統計、日期差、單位換算），必須委派 `agents/agent-ops/_shared/calculator` agent
2. Calculator agent 只用程式碼（`node -e` 或 `python -c`）計算，絕不用推理或心算
3. 返回結果必須附帶程式碼佐證

### 例外情況
- 程式碼中的內嵌算術（如 for loop 的計數器）不需要委派
- 不需要精確數值的概略描述（「大約一半」、「數百個」）不需要委派
- SQL 聚合查詢（SUM/AVG/COUNT）由 Developer 直接處理

### 可用的 Calculator Agent
- 路徑：`agents/agent-ops/_shared/calculator/`
- 派遣模型：sonnet  <!-- 2026-04-27: haiku→sonnet（user policy: ban haiku） -->
- 觸發條件：需要精確數值計算

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
| `role_in_team` | `type == worker` 強制必填；`type ∈ {manager, director, officer}` 自動視為 `manager`，無須填寫 | string（**禁止多值**） | `researcher` \| `doer` \| `verifier` \| `shared` | 在 team 內擔任的角色分類；受 `agents/agent-ops/_protocols/rules/agent-anatomy.md` §6.9 Team Trichotomy Rule 約束；完整規範見 `agents/agent-ops/_protocols/team-trichotomy-protocol.md` |

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
- `role_in_team` 變更視同職責變更，需 Agent Builder 審批並重跑 Team Trichotomy Check（詳見 `agents/agent-ops/_protocols/rules/agent-anatomy.md` §6.9）
