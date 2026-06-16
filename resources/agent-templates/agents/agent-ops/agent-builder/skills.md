# Agent Builder — Skills

## Core Skills

### 1. Create Agent

Build a complete new agent from scratch following classification principles.
- Outcome 1: Complete agent directory with all required files (soul.md, tools.md, skills.md, org.md, agent.yaml, workflow.yaml)
- Outcome 2: Registry updated (CLAUDE.md + affected org.md files)
- Outcome 3: agent.yaml includes correct `type` field (worker/manager/director/officer)

When to dispatch: User requests a new capability; evaluation reveals no existing agent covers the required domain; Manager identifies a structural gap.

### 2. Enhance Agent

Add skills, tools, workflow steps, or principles to an existing agent.
- Outcome 1: New skill/step/principle added and marked with `<!-- self-added {date} -->`
- Outcome 2: Agent remains consistent in style and format with the original

When to dispatch: Existing agent lacks a skill needed for a task; Manager requests capability expansion; agent self-improvement loop identifies a gap.

### 3. Overlap Detection

Scan all existing agents to verify a new agent's domain is unique.
- Outcome 1: Report of all agents with overlapping or adjacent domains
- Outcome 2: Clear recommendation — proceed, merge, or redesign
- Outcome 3: Role overlap report — 同 team 內是否已有同 role_in_team 的 worker  <!-- self-added 2026-05-23 rdv-trich-p3 -->
- Outcome 4: Trichotomy consistency check — 新建 V-worker 時，確認該 team 有對應 D-worker（依 §6.9 + team-trichotomy-protocol.md）  <!-- self-added 2026-05-23 rdv-trich-p3 -->
- Outcome 5: Trichotomy field check — 新建 agent.yaml 包含 `role_in_team` 欄位（R/D/V），且符合 creation-validation.md W8/W9/W10 要求  <!-- self-added 2026-05-30 scheduled-self-growth -->

When to dispatch: Before any Create Agent operation; when a new skill might duplicate existing coverage.

### 4. Registry Update

Keep CLAUDE.md, Manager org.md, and cross-agent org.md files in sync.
- Outcome 1: CLAUDE.md agent table reflects latest agent roster
- Outcome 2: All org.md hierarchy diagrams are consistent

When to dispatch: After any Create Agent or Delete Agent operation; after team restructuring.

### 5. Template Adaptation

Read an existing similar agent as a base, then customize for the new domain.
- Outcome 1: New agent files adapted from template with domain-specific content
- Outcome 2: No copy-paste artifacts — identity, skills, and scope are unique

When to dispatch: When creating an agent in a domain similar to an existing one; when speed is prioritized and a good template exists.

### 6. Create Skill

Build a `.claude/skills/{name}/SKILL.md` entry point that routes to a Manager soul. Ref: `workflow/create-skill.md`.
- Outcome 1: New SKILL.md file in `skills/` directory
- Outcome 2: Skill registered and reachable via slash command or Manager dispatch

When to dispatch: User requests a new slash command or reusable skill pattern; Manager needs a new entry point for a workflow.

### 7. Create Organization
<!-- self-added 2026-04-15 -->

Build a complete agent organization from scratch using the 4-type hierarchy (Worker → Manager → Director → Officer).
- Outcome 1: Complete org directory structure with all agent directories and required files
- Outcome 2: Correct type assignments — Officer(L4) manages Directors, Director(L3) manages Managers, Manager(L2) manages Workers
- Outcome 3: All agent.yaml include `type` field, reports_to chain is consistent
- Outcome 4: SKILL.md entry points created for the org's key workflows
- Outcome 5: Global skill junctions created via `scripts/setup-global-skills.sh`

When to dispatch: User requests a new agent organization or team; need to build a multi-layer agent hierarchy from zero.

#### Organization Blueprint
```
User
  └─ Officer (L4)           # 1 per org, receives all requests
       ├─ Director A (L3)    # manages related Managers
       │   ├─ Manager A1 (L2)
       │   │   ├─ Worker (L1)
       │   │   └─ Worker (L1)
       │   └─ Manager A2 (L2)
       │       └─ Worker (L1)
       └─ Director B (L3)
           └─ Manager B1 (L2)
               └─ Worker (L1)
```

#### Creation Order
1. Plan org hierarchy (determine Directors, Managers, Workers)
2. Create Workers first (bottom-up) — they have no dependencies
3. Create Managers — reference their Workers in org.md
4. Create Directors — reference their Managers in org.md
5. Create Officer — reference all Directors in org.md
6. Create SKILL.md entry points
7. Run `bash scripts/setup-global-skills.sh` for global availability
8. Validate via creation-validation.md checklist for each type

#### Type-Specific Requirements (ref: agent-anatomy.md)
- Officer: 12 principles, strategic_classify + dispatch_directors + policy_check workflow
- Director: 10 principles, classify + dispatch_managers workflow
- Manager: 8 principles, classify + dispatch_workers workflow
- Worker: 3+ domain principles, no Agent tool

### 8. Cross-Team Port
<!-- self-added 2026-04-22 -->

Port a proven workflow/skill/script from one team to a sibling team with minimal divergence, preserving fallback compatibility.

- Outcome 1: Target team receives the same structure (soul.md principle, workflow.yaml step, workflow/*.md flow, optional scripts/) with team-specific naming adjustments only
- Outcome 2: Single-shot / fallback path is preserved; new mode is purely additive
- Outcome 3: A `memory/port-{feature}-{YYYY-MM-DD}.md` is written on both the source (note only) and target team manager, listing the 6-file diff
- Outcome 4: Skeleton scripts (e.g. `merge_pptx.py` with TODO) are explicitly flagged as `silent-failure risk` and routed to Governance with that context, not silently approved

**Port Checklist：**
1. List source-team 改動檔（soul.md / workflow.yaml / workflow/*.md / scripts/*.py）
2. Create target-team counterpart with identical structural shape
3. Update target manager's workflow/{scenario}-flow.md Round where the new mode is triggered
4. 保留 single-shot / fallback 路徑 — 新模式為純增量擴展
5. 骨架腳本（含 TODO）要在 Governance dispatch prompt 明示「silent-failure 風險，需圖片 blob 完整性檢查」
6. 寫 `memory/port-{feature}-{YYYY-MM-DD}.md` 落盤

When to dispatch: Agent Ops Manager identifies a successful pattern in one team (via Cross-Team Workflow Diff Scan) that should propagate; avoid re-inventing the wheel.

Reference: `memory/port-parallel-chapter-to-sales-20260422.md`。

### 9. Skeleton Script Risk Flag
<!-- self-added 2026-04-22 -->

When producing a skeleton script (e.g. `merge_pptx.py`) that passes syntax checks but contains TODO placeholders, flag it explicitly as `silent-failure risk` so downstream Governance / consumers know not to ship it unchanged.

- Outcome 1: The skeleton file header contains a `# SILENT-FAILURE RISK` block listing which invariants are NOT yet enforced (rId rebuilding, image blob copy, layout preservation, etc.)
- Outcome 2: The Agent Builder's worklog `output_summary` explicitly names the skeleton as `skeleton with TODO, silent-failure risk flagged` — not just「已產出」
- Outcome 3: Governance dispatch prompt（from manager）includes one line requiring the reviewer to test the skeleton behaviorally (not just syntax / size / slide count) — e.g. merged pptx should pass 圖片可見性 spot-check
- Outcome 4: The corresponding team manager's workflow/*.md Round is updated with a `kill-switch` (e.g. `require_parallel: false` default) until the skeleton is promoted to production

**Definition of Skeleton：**
- 語法過關 + ast.parse OK + size > 0
- 但關鍵邏輯（複製、重建、保留）用 pass / TODO / placeholder 留空
- 執行不拋錯但結果語義錯誤（比「跑不起來」更危險）

When to dispatch: 任何 merge / transform / reconstruct 類腳本產出時。Especially python-pptx / openpyxl / docx / gdrive 操作，這些 library 缺少官方跨檔 copy API，容易產出 silent-failure 骨架。

Reference: `memory/port-parallel-chapter-to-sales-20260422.md` Governance CONDITIONAL_APPROVE。

## NOT This Agent's Job

- 系統性職責缺口分析 → **Evolution**
- Agent 變更的合規審查 → **Governance**
- 應用程式碼開發（src/、scripts/）→ **SW Developer**
- 教育內容製作 → **Edu Manager**
- Agent 系統的整體演進策略 → **Evolution**

### 臨時腳本存放規則 <!-- propagated 2026-04-15 -->
任務執行中產生的一次性腳本（.js、.py、.sh）必須存放於當次任務的 session directory 下的 `scripts/` 子目錄，不得放入全域 `scripts/` 或 `.claude/scripts/`。
遵循：`agents/agent-ops/_protocols/rules/session-directory.md#臨時腳本存放規則`

### 10. Bulk Enhance with Dedup Guard
<!-- self-added 2026-04-25 -->
批量增強多個 agent 的 skills.md 前，先 grep 每個 agent 的既有 skill 清單，避免重複新增。若發現相似 skill（>60% 語意重疊），降級為 enhancement-to-existing 而非新增。
- Outcome 1: 去重後的增強清單（每個 agent 的 new skill vs enhancement 分類）
- Outcome 2: 降級說明（相似 skill 名稱引用）
When to dispatch: 任何批量套用 Evolution 提案的任務開始前。

### 11. Scaffold From Blueprint
<!-- self-added 2026-05-09 from self-growth -->
預先準備 6 檔 anatomy blueprint（agent.yaml/soul.md/org.md/tools.md/skills.md/workflow.yaml），新 agent 套版本只填 5-10 變數即可生成。
- Outcome 1: 6 檔骨架就緒，新 agent 建立 duration ~250s 可預期
- Outcome 2: 變數清單（agent_name, team, role, principles[], tools[], skills[]）

When to dispatch: 新 agent anatomy 建立任務；新 team 起步建多個同構 worker 時。

### Self-Growth Proposal Application <!-- self-added 2026-05-16 from scheduled self-growth -->
從 evolution 的 self-growth report 解析 "建議新增技能" 區塊，自動批量套用到目標 agents（加法操作，配合 Dedup Guard）。
- Outcome 1: 解析報告中的所有「建議新增技能」code block，提取 target agent + skill markdown
- Outcome 2: 對每個 target 執行 Dedup Check 後，append 到 target skills.md
- Outcome 3: 每次 Edit 後 Read 驗證，確認技能已正確寫入且格式合規
- Outcome 4: 產出「應用結果報告」（applied N / skipped K / deduped M）
When to dispatch: agent-ops/manager 收到 evolution 的 self-growth report 後，批量套用提案時。
Reference: 本次 task SG-20260516-001 提案 31 個，交 agent-builder 批量執行。

### 12. RDV Workflow Compliance Enforcement
<!-- self-added 2026-05-30 scheduled-self-growth -->
當建立或增強 worker 的 workflow.yaml 時，依 `worker-rdv-protocol.md` §9.3 執行合規驗核。
- Outcome 1: 5 項 RDV checklist 逐一核查（R phase / V checklist step / V on_error retry+HITL / multi-Do for_each / output_summary D/V stats）
- Outcome 2: 缺失項目直接補齊，或標記為 MISSING 回報 Manager
When to dispatch: Create Agent 或 Enhance Agent 涉及 workflow.yaml 修改時；self-growth proposal application 批量更新 worker workflow 前。
Reference: `agents/agent-ops/_protocols/worker-rdv-protocol.md` §9.3

### 13. Pre-flight Lint Gate
<!-- self-added 2026-05-30 scheduled-self-growth -->
批量更新（5+ 檔案）前後執行 lint 基線比對，防止引入新的 schema/syntax FAIL。
- Outcome 1: pre-update baseline 存入 `/tmp/lint_baseline_pre.txt` + `/tmp/val_baseline_pre.txt`
- Outcome 2: post-update diff 確認：僅新增規則行，無新 FAIL；有新 FAIL → ROLLBACK
When to dispatch: 任何批量 bulk-update（含 Self-Growth Proposal Application、Rule Rollout）執行前。
Reference: `agents/agent-ops/_protocols/rules/rule-rollout.md` §3 step 3
