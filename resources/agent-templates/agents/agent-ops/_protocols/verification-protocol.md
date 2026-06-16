# Verification Protocol

Manager MUST verify every agent's work before synthesizing results. Never trust agent self-reports alone.

## Verification Checks

### 1. Worklog Exists
```
Glob: agents/{agent}/worklog/*_{agent}.json
Read the file. Confirm:
  - started_at is filled
  - ended_at is filled
  - duration_seconds > 0
  - status is "completed" or "failed"
```
If worklog is missing → agent may not have run at all.

### 2. Output Artifacts Exist
| Agent Type | What to Check |
|-----------|---------------|
| Developer | Files it claimed to create/modify actually exist. `Glob` or `Read` them. |
| Tester | Test files exist. Run `Bash` to confirm tests pass. |
| Reviewer | Review verdict is in the response (not just "looks good"). |
| Researcher | Findings include actual `file:line` references. Spot-check 1-2 references with `Read`. |
| Architect | Plan contains concrete file paths and component names, not vague descriptions. |
| DevOps | Config files it claimed to create/modify actually exist. |
| Intent | Returned valid JSON matching the output schema. |

### 3. Spot-Check Content
Pick 1-2 claims from the agent's output and verify:
- If agent says "created src/login.tsx" → `Read` that file, confirm it's not empty
- If agent says "all tests pass" → `Bash` run the tests, confirm they pass
- If agent says "found auth in src/middleware/auth.ts:42" → `Read` that file at line 42

### 4. Cross-Check Between Agents
When multiple agents worked on the same task:
- Developer says "implemented per plan" → compare against Architect's plan
- Tester says "tests pass" → Reviewer should also confirm
- If claims conflict → flag, investigate, or re-dispatch

## Verification Actions

| Result | Action |
|--------|--------|
| All checks pass | Proceed to synthesis |
| Worklog missing | Re-dispatch agent, flag as suspicious |
| Artifacts missing | Re-dispatch agent with explicit instruction to write files |
| Spot-check fails | Do NOT include in synthesis. Re-dispatch or report gap. |
| Claims conflict | Investigate. Prefer verifiable evidence over self-report. |

### Check 5: Timesheet Verification
- Manager 報告中是否包含工時打卡明細表？
- 明細表中是否列出所有被派遣的 agent？
- 時間戳是否來自 worklog JSON（非粗估）？
- Action if missing: Manager 必須補上明細表再交付

### Check 6: HITL 合規
- Manager 的 workflow.yaml 是否包含 hitl_gate 步驟？
- hitl_gate 是否引用 `agents/agent-ops/_protocols/hitl-protocol.md`？
- Tier 3 暫停訊息是否使用嚴格 token 格式（`confirm` / `abort` / `modify`）？
- 是否包含「其他任何回覆視為 abort，不得推斷為 confirm」的明確語意？
- Action if non-compliant: 標記為 FAIL，要求修正後重新審查

## When to Skip Verification
- Intent agent (output is JSON classification, validated by schema)
- Evaluation phase (agents only return a score, no artifacts)
