# Agent Builder Checklist

Run this before reporting completion. **ALL must pass.**

## For Create

### Structure

- [ ] `agents/{name}/` directory exists
- [ ] `agent.yaml` exists with all required fields (agent, title, team, reports_to, bootstrap, workflow, dispatch.model, dispatch.trigger, dispatch.not_for)
- [ ] `agent.yaml` bootstrap sequence includes soul.md, org.md, tools.md in that order
- [ ] `agent.yaml` dispatch.model is appropriate（參見 evaluation-protocol.md Haiku Eligibility）：
      - `haiku` **禁用**（2026-04-27 user policy: ban haiku；全 sonnet/opus）
      - `sonnet` 為預設（所有 researcher / reviewer / evaluator / designer / 審查類 一律 sonnet 起跳）
      - `opus` 用於複雜架構決策、關鍵審查、governance
- [ ] If `skills.md` exists, `agent.yaml` declares `skills: skills.md`
- [ ] Agent name is lowercase, hyphenated
- [ ] `memory/MEMORY.md` exists with agent-specific header
- [ ] agent.yaml 含 `role_in_team` 欄位（worker type 強制；manager+ 自動視為 manager；shared 服務標 shared）  <!-- self-added 2026-05-23 rdv-trich-p3 -->
  - 取值 ∈ {researcher, doer, verifier, shared, unclassified(grace-period only)}
  - **禁止多值**
- [ ] Team Trichotomy Check 已執行（見 create.md Step 3.5）  <!-- self-added 2026-05-23 rdv-trich-p3 -->

### README.md

- [ ] Has role (one sentence)
- [ ] Has "When to Dispatch" criteria
- [ ] Has dispatch config (subagent_type, model)

### soul.md

- [ ] Has unique identity (NOT copied from another agent)
- [ ] Has >= 3 principles specific to this domain
- [ ] Has "Anti-patterns to Avoid" section
- [ ] Has scope guard principle: agent knows what's NOT its job and will refuse (ref definitions.md Scope Guard)

### tools.md

- [ ] Has tool table (Tool | Purpose)
- [ ] Has **"Do NOT Use"** section with explicit prohibited tools
- [ ] Has usage guidelines
- [ ] Has **memory exception**: All agents (including read-only) MUST include `Write` exception for their own `memory/` directory
- [ ] **Permission whitelist**: 確認 agent 需要的 Bash 指令已加入 project settings.json 的 `permissions.allow`（如 `Bash(scripts/...)`, `Bash(python ...)`）。設定檔位置：`~/.claude/projects/{project}/settings.json`

### skills.md

- [ ] Has >= 3 domain-specific skills (NOT generic)
- [ ] Has **"NOT This Agent's Job"** section
- [ ] Skills are domain knowledge, not tool names (see definitions.md)

### workflow.yaml

- [ ] Is YAML format (not .md)
- [ ] Has `error_policy` block at top
- [ ] Does NOT have any 打卡 / worklog / log_start / log_end steps（打卡機制已於 2026-05-28 全面移除，工作記錄改由外部 log 處理）
- [ ] Has `check_memory` step
- [ ] Has `save_memory` step
- [ ] Every step that can fail has `on_error`
- [ ] Any `ref:` flow files follow the format defined in `workflow/flow-file-format.md` (Format A or B, ≥2 steps each)

### org.md

- [ ] Has complete hierarchy showing ALL agents (including Intent, Agent Builder)
- [ ] Has collaboration patterns
- [ ] Has **"When NOT to Pick This Agent"** section

### System Updates

- [ ] CLAUDE.md Agent Registry table updated
- [ ] `agents/agent-ops/manager/org.md` hierarchy updated
- [ ] Other agents' org.md updated if collaboration patterns change
- [ ] No file exceeds ~60 lines
- [ ] No domain overlap with existing agents (verified by reading all README.md + skills.md)
- [ ] Governance Agent has reviewed and approved the new agent (or creation is queued for review)

### Manager/Orchestrator Agents (if applicable)

- [ ] Workflow includes a final synthesis step that aggregates worker return payloads

## For Create Skill

- [ ] `.claude/skills/{name}/SKILL.md` exists
- [ ] Frontmatter has `name`, `description`, `allowed-tools: Glob Grep Read`
- [ ] Contains `$ARGUMENTS` placeholder
- [ ] Points to correct `target_manager_soul` path
- [ ] File is <= 15 lines (thin entry point only, no flow logic)
- [ ] <!-- self-added 2026-06-10 codex-skill-activation --> Target runtime 已判定：`claude` / `codex` / `both`
- [ ] <!-- self-added 2026-06-10 codex-skill-activation --> `tuq-*` manager entry skill 若未明確排除 Codex，`target_runtime == both`；若為 `claude` only，brief 或 deliver 已寫明排除 Codex 的理由
- [ ] Claude runtime：`~/.claude/skills/{name}/SKILL.md` 可解析（或明確 N/A，因 target_runtime 不含 Claude）
- [ ] Codex runtime path exists：`C:/Users/david/.codex/skills/{name}/SKILL.md` 或 `C:/Users/david/.agents/skills/{name}/SKILL.md` 可解析；或 repo `.Codex/skills/{name}/SKILL.md` / `.agents/skills/{name}/SKILL.md` source 存在（或明確 N/A，因 target_runtime 不含 Codex）
- [ ] Codex session loaded：current session skill list 列出 `{name}`，或 deliver 明確標示 `restart required`，不得把「已補路徑、需重開」宣告成「當前 session 已上線」
- [ ] 若補的是 Codex 載入路徑，deliver 必須提醒：Codex skill list 於 session 啟動時讀取，需重開 session 才會出現在 skill list
- [ ] 已確認「只建立 `agents/{team}` 或 `.claude/skills/{name}` 不等於 Codex 上線」

## For Enhance

- [ ] Target file was read before editing
- [ ] Change is marked with `<!-- added {date}: {reason} -->`
- [ ] Modified file was read back to verify edit applied
- [ ] No file exceeds ~60 lines after edit (split if needed)
- [ ] Enhancement stays within agent's existing domain
- [ ] No new domain overlap introduced
