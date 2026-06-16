<!-- 2026-04-27: Identity Block updated with explicit bootstrap paths (rollout from agent-anatomy.md §6.7) -->

# Agent Ops Dispatch Protocol

## 0. Pre-dispatch Checklist <!-- self-added 2026-05-01 Dispatch Guard rollout -->

在組 prompt 前必先通過以下三項檢查，任一不通過則停止：

- [ ] **Agent 在 org.md 中登記**：確認 `{agent-name}` 存在於 `agents/agent-ops/manager/org.md` 的 hierarchy 中
- [ ] **非通用工具替代**：絕不以 `Explore`、`Beast Mode` 等通用工具替代 team worker（`agents/agent-ops/_shared/calculator` 例外）
- [ ] **任務屬於該 agent 的 scope**：對照 agent 的 `dispatch.trigger` / `dispatch.not_for`（見 agent.yaml）確認任務不越界

---

When dispatching each worker agent, include ALL of the following blocks in the prompt:

## 1. Identity Block

```
You are the {AgentName} agent.

Bootstrap files (read in this order, absolute paths):
  T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents/agent-ops/{agent-name}/agent.yaml
  T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents/agent-ops/{agent-name}/soul.md
  T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents/agent-ops/{agent-name}/org.md
  T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents/agent-ops/{agent-name}/tools.md

Bootstrap once, then start workflow.
```

> **Note**: For shared agents (e.g., agents/agent-ops/_shared/calculator), use `agents/agent-ops/_shared/{agent-name}/...` instead. <!-- 2026-05-01 方案 B：shared/researcher 已廢，唯一剩餘 Shared agent 為 calculator -->

## 2. Memory Block

```
MEMORY: Before starting, read agents/{team}/{agent-name}/memory/MEMORY.md.
【記憶置放閘門｜強制】Before finishing, apply §5 gate: 先問「換一個專案這條還成立嗎？」
  - 成立（跨專案教訓 / dispatch 紀律 / 驗證方法論 / agent 系統事實）→ agents/{team}/{agent-name}/memory/
  - 不成立（專案限定知識 / 現況 / 待辦 / 特定 repo・產品・環境事實）→ ~/.claude/projects/{project-slug}/memory/（禁止寫共用 agents/*/memory/）
  - 混合型 → 通用教訓蒸餾一句留共用、其餘細節進 project memory
Save new learnings to agents/{team}/{agent-name}/memory/ per agents/agent-ops/_protocols/memory-protocol.md.
```

## 4. Task Block

- **Goal**: what to accomplish
- **Scope**: files, directories, domains to focus on (agent system files only)
- **Context**: findings from prior agents in this chain
- **Output format**: what to return

### Context 欄位 — Worker Output Isolation Caution

> **Hard Rule（2026-05-01 user-mandated rule-rollout，源自 worker-handoff-violation-20260501）**：
> Manager 在 dispatch prompt 的 `Context` 欄位（或等效「上游脈絡 / Background」描述段）**禁止寫下游 sibling worker 或審查者 agent 的具名身份**。
>
> ❌ 禁寫：「之後會送 Governance 審查」「另一路 platform-security 在做 systemd」「完成後交給 QA-Reviewer 驗收」
>
> ✅ 可寫：「上游 architect 已產出 `output/.../plan.md`」「並行另有 N 個 worker 處理不同子任務（不點名）」「prior findings: ...」
>
> **理由**：worker 不該認識 sibling 身份；Manager brief 一旦洩漏，worker 就會在 `output_summary` 寫「待 Governance」之類的越權話術，污染 worklog 稽核。
>
> **合法例外**：Shared Context Block §6 — 並行派遣時可寫「另有 worker 在做 [描述任務 type]」，但**不點名 agent 身份**。
>
> **Cross-Reference**：完整規範與 BAD/GOOD examples 見 `agents/agent-ops/_protocols/worklog-protocol.md` §Output Summary 內容規範（Worker Handoff Isolation）

## 4.5 Output Path Block <!-- self-added 2026-05-01 rule-rollout (output-path-confirmation) -->

依 P23 Output Path Confirmation 與 `agents/agent-ops/_protocols/rules/output-placement.md` §5.3，每次 dispatch 必含這兩欄：

```
TASK PATHS:
  task_id: {business-context}-YYYYMMDD
  output_path: <Manager 已 mkdir -p 的絕對路徑>
```

- 缺其一視為 brief incomplete，禁止派遣（Worker 必拒並回報 `SCOPE VIOLATION: missing output_path`）
- 跨 worker 接力時，brief 中附上游產物完整絕對路徑（例：`upstream_input: $output_path/strategy_v1.md`）
- 區別於 §7 Workspace Block：Workspace 是 CWD 級（remote CWD 才填），本 Block 是 task 級（每次 dispatch 必填）

## 4.6 Agent-Builder Brief Extension (Team Trichotomy) <!-- self-added 2026-05-23 rdv-trich-p4-dispatch -->

當 `target_agent == agent-ops/agent-builder` 且任務涉及建立/修改 agent 時，Task Block 的 Goal 欄位必須以結構化欄位明列以下 schema，讓 agent-builder 在源頭就能執行 trichotomy check（對應 `creation-validation.md` W8/W9/W10）。

### Extended Brief Schema

```jsonc
{
  "action": "create_agent | enhance_agent | delete_agent | create_skill | ...",
  "name": "agent-name",
  "domain": "一句話描述 agent 職責",
  "reason": "為何需要此 agent",

  // ----- P4 (2026-05-23) 新增欄位 -----

  "role_in_team": "researcher | doer | verifier | shared",
  // 必填條件：action == "create_agent" AND target type == "worker"
  // manager / director / officer type 自動視為 manager role，可省略 role_in_team
  // shared 服務（如 calculator）標 "shared"，agent-builder 會跳過 trichotomy check

  "trichotomy_justification": "string (optional)",
  // 條件必填：role_in_team == "doer" AND 目標 team 已有同 role doer
  // 內容：為何需要新建而非 Enhance 既有 doer（對應 W10 CONDITIONAL_PASS gate）

  "reference_agent": "用作範本的現有 agent (optional)"
}
```

### Agent-Builder 回應規則

- **缺 `role_in_team`（且 action == create_agent、type == worker）**：agent-builder 必須回 `SCOPE VIOLATION: missing role_in_team`，**不**進入 create flow
- **`role_in_team == "doer"` 且 team 已有 doer、但缺 `trichotomy_justification`**：agent-builder 回 WARN（依 W10 CONDITIONAL_PASS，並要求 Manager 補欄位後重派）
- **`role_in_team == "verifier"`、本 team 無對應 doer**：依 W9 SCOPE VIOLATION（V 必須有對應 D），除非屬「跨 team V 例外」

### 跨 team V 例外（依用戶決策 Q3）

當 dispatcher 是**跨 team manager**（例：`agent-ops/manager` 派 `agent-ops/governance` 去審查 `sw` team 的產出），`role_in_team == "verifier"` 不要求本 team 內配對 doer — 因為跨 team V 允許全系統任意 D 即 PASS。Manager 在 brief 中可加註：

```jsonc
{
  "role_in_team": "verifier",
  "cross_team_verifier": true,
  "verifies_against_team": "sw"  // V 鎖定的 D 所在 team
}
```

### 同 manager 派 D+V 合法性（依用戶決策 Q1）

同一 Manager 在同一 dispatch round 同時派出某 team 的 D 與 V worker **不算合一**（agent 名稱不同即合法）。Manager 在 Shared Context Block §6 中應註明兩者並行，但不需額外 justification。

### Manager+ Type 自動歸類（依用戶決策 Q4）

`action == create_agent` 且 target type ∈ {`manager`, `director`, `officer`} 時，agent-builder 自動視為 `role_in_team == "manager"`，Manager **無需**在 brief 填 `role_in_team`。如 Manager 多此一舉填了，agent-builder 會以 type 為準並 log warning（不阻擋）。

### Cross-Reference

- `agents/agent-ops/_protocols/team-trichotomy-protocol.md` — 完整規範（R/D/V 三足鼎立的定義與例外）
- `agents/agent-ops/_protocols/rules/agent-anatomy.md` §6.9 — Team Trichotomy Rule
- `agents/agent-ops/_protocols/rules/creation-validation.md` W8/W9/W10 — agent-builder 端的 gate 邏輯
- `agents/agent-ops/agent-builder/workflow/create.md` Step 3.5 — agent-builder 創建流程中的 trichotomy check 對應點

## 5. Language Block

```
LANGUAGE: Respond in {user's language}.
```

## Agent Tool Parameters

```
Agent({
  description: "short label",
  subagent_type: "general-purpose",
  model: "sonnet" | "opus",  # 必填，禁止省略；禁用 haiku（no-haiku-policy.md）；依 intent classification 選定
  prompt: assembled from blocks above,
  run_in_background: true if not blocking next round,
})
```

> ⚠️ **model 強制硬碼**：`model:` 欄位必須明確填入 `"sonnet"` 或 `"opus"`，**不得省略或寫成自由變數**。
> 省略 model 參數會導致 Claude Code 使用預設模型（可能 fallback 到 Haiku 4.5），違反 no-haiku-policy.md。
> 動態 model 選擇邏輯應在 caller 端（plan_dispatch / classify step）決定後再填入此欄位。
> Reference: `agents/agent-ops/_protocols/rules/no-haiku-policy.md`、`agents/agent-ops/_protocols/rules/manager-dispatch-source.md`

## 6. Shared Context Block (for parallel dispatch)

When dispatching multiple agents in parallel, include a shared context summary so each agent knows what others are working on.

```
SHARED CONTEXT: Other agents working in parallel on this task:
- {Agent A}: {brief description of their task}
- {Agent B}: {brief description of their task}
If your work overlaps with theirs, focus on YOUR scope and note the overlap.
Do NOT duplicate their work.
```

### When to include

- dispatch_agents_parallel with 2+ agents
- Any round where agents might touch overlapping files

### When to skip

- Single agent dispatch
- Sequential rounds (each agent sees previous output)

## 7. Workspace Block (for remote CWD)

When the calling CWD differs from `<ROOT>` (i.e., the user invoked the skill from another project), a local workspace `tuq_log/` exists at `$CWD/tuq_log/`. Include this block in every dispatch prompt:

```
WORKSPACE:
  tuq_log: $TUQ_LOG                         # absolute path to CWD/tuq_log
  output_dir: $TUQ_LOG/output/              # agent deliverables go here
  tmp_dir: $TUQ_LOG/tmp/                    # scratch files go here
```

### When to include

- CWD ≠ `<ROOT>` (user is in a different project)

### When to skip

- CWD == `<ROOT>` (working inside AgentOrg itself)

### 7.1 ROOT vs CWD 角色區分（2026-05-01 self-added）

`$TUQ_LOG` 與 AgentOrg ROOT 的關係：

- 業務專案 CWD（如 `Training_AgentOrg/`）= `$TUQ_LOG` 的來源
- AgentOrg ROOT = agent 系統本體

agent-ops 屬**系統 team**：CWD == ROOT 時 output 落 ROOT 本體屬合規（agent 系統管理產出本就放 ROOT）。

對比：edu / sales / finance / bni / sw 屬**業務 team**，CWD == ROOT 時必須警告或停工（見 `init-output-path-flow.md` §2c）。

## Parallelism Rules

- Agent Builder + Evolution 可以並行（操作不同檔案時）
- Governance 必須在 Agent Builder 完成後才執行（需審查變更）
- Intent 必須先完成才能派遣其他 agent
