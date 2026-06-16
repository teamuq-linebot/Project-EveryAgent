# Evaluation Protocol

Before full execution, agents receive a lightweight evaluation request. The agent assesses task difficulty and returns a structured JSON score. This runs on `sonnet` (2026-04-27: 全系統禁用 haiku，user policy)。

## Evaluation Prompt Template

Manager sends this to each candidate agent:

```
You are the {AgentName} agent. Read agents/{agent-name}/soul.md and agents/{agent-name}/skills.md.

EVALUATION MODE — do NOT execute the task. Only assess it.

Task: {task description}
Scope: {files, components, domains}
Context: {any prior findings}

Assess the following and return ONLY this JSON:
- difficulty (1-5): intrinsic complexity of the task
- steps (integer): estimated number of distinct actions/edits required
- Do NOT calculate score — Manager will compute it from difficulty + steps.
```

## Evaluation Output Schema

```json
{
  "agent": "developer",
  "task_summary": "Implement login page with form validation",
  "difficulty": 3,
  "steps": 8,
  "reasoning": [
    "Multi-file changes across component and test layers",
    "Requires understanding existing auth patterns"
  ],
  "estimated_files": 4,
  "risk_flags": ["security-sensitive", "user-facing"],
  "dependencies": ["Need researcher findings on existing auth patterns first"]
}
```

> Note: `score` is computed by Manager (`difficulty + step_bonus`). Agents only report `difficulty` and `steps`.

## Score Definitions

### difficulty (1-5) — Agent 自評，反映任務本身的複雜度

| difficulty | 描述 |
|-----------|------|
| 1 | 機械性：改 typo、改名、套模板 |
| 2 | 低：單一模式、已知 pattern |
| 3 | 中：多檔案、需要判斷 |
| 4 | 高：跨模組、架構決策 |
| 5 | 關鍵：系統級影響、零錯誤容忍 |

### step_bonus (Manager 計算，依 steps 數量)

| steps | step_bonus |
|-------|-----------|
| 1-3   | +0 |
| 4-8   | +1 |
| 9-15  | +2 |
| 16+   | +3 |

### score = difficulty + step_bonus（上限 10）

Manager 計算 `score` 後再做 model mapping。

## Manager's Score → Model Mapping

**原則（2026-04-27 更新）：全系統禁用 haiku。預設 sonnet，複雜推理 / Tier 3 治理升 opus。詳見 `agents/agent-ops/_protocols/rules/no-haiku-policy.md` 與 `agents/agent-ops/manager/memory/feedback_no_haiku_default_sonnet_or_opus.md`。**

| Score | Model | Rationale |
|-------|-------|-----------|
| 1-3 | `sonnet` | 預設 sonnet（haiku 已禁用） |
| 4-6 | `sonnet` | Balanced, task needs some reasoning |
| 7-8 | `opus` | Complex, needs deep reasoning |
| 9-10 | `opus` | Critical, Manager may also add Reviewer as follow-up |

### Haiku Eligibility 段已廢止（2026-04-27 user policy: ban haiku）

所有 agent 使用 sonnet 或 opus。詳見 `agents/agent-ops/manager/memory/feedback_no_haiku_default_sonnet_or_opus.md` 與 `agents/agent-ops/_protocols/rules/no-haiku-policy.md`。

**凡 researcher / reviewer / evaluator / designer 類，一律 sonnet 起跳**，不受 score 1-3 影響。

## Manager Override Rules

Manager always has final authority. Common overrides:

| Situation | Override |
|-----------|---------|
| `risk_flags` contains "security-sensitive" | Minimum `opus`, regardless of score |
| `risk_flags` contains "user-facing" | Minimum `sonnet` |
| Agent self-scored low but `estimated_files` > 5 | Upgrade to next tier |
| Multiple agents scored 7+ on same request | Consider adding Architect round first |
| Agent scored high but task matches a known pattern in memory | May downgrade (but never below `sonnet`; haiku 已全面禁用 2026-04-27) |
| `steps` >= 16 且未拆分 | 考慮拆分為多次派遣（見 Task Splitting Rule） |
| `difficulty` <= 2 且 `steps` >= 10 | 強制最低 `sonnet`，避免低估模型需求 |
| Agent 為 researcher / reviewer / evaluator / designer 類 | 強制最低 `sonnet`（即使 score 1-3） |

## Dispatch Config for Evaluation Phase

```
Agent({
  subagent_type: "general-purpose",
  model: "sonnet",                   # 2026-04-27: haiku→sonnet（user policy: ban haiku）
  run_in_background: false,          # Manager needs scores before proceeding
  prompt: "... EVALUATION MODE ..."
})
```

Multiple evaluations run in parallel (one message, multiple Agent calls).
