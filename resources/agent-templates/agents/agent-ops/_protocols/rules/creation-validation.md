# Agent Creation Validation Checklist

## 1. 使用時機
- Agent Builder 建立新 agent 後
- Governance 審查新 agent 時
- 定期審計全系統 agent 合規性時

## 2. 分類判斷
IF type == "officer" → Officer Anatomy
ELSE IF type == "director" → Director Anatomy
ELSE IF type == "manager" OR (reports_to == "user" AND has Agent tool) → Manager Anatomy
ELSE → Worker Anatomy

## 3. 通用檢查項（全部必通過）
| # | 類別 | 檢查項 | 驗證方式 |
|---|------|--------|---------|
| 1 | 目錄 | agents/{team}/{agent}/ 存在 | Glob |
| 3 | 目錄 | memory/MEMORY.md 存在 | Read |
| 4 | agent.yaml | 所有必填欄位齊全 | Read + schema |
| 5 | agent.yaml | bootstrap 順序：soul→org→tools | Read |
| 6 | soul.md | Identity 獨特非複製 | Read |
| 8 | soul.md | 含 Scope Guard | Grep |
| 9 | soul.md | Anti-patterns 章節存在 | Read |
| 10 | tools.md | 含工具表 | Read |
| 11 | tools.md | 含 "Do NOT Use" 章節 | Grep |
| 12 | org.md | 完整層級圖 | Read |
| 13 | org.md | "When NOT to Pick" 章節 | Grep |
| 14 | skills.md | 存在 | Glob |
| 15 | skills.md | 至少 3 個技能 | Read |
| 16 | workflow.yaml | 有 error_policy | Read |
| 17 | workflow.yaml | 每步有 on_error | Read |
| 18 | soul.md | 含計算委派原則（或在 skills.md 中明確說明不涉及計算） | Grep |
| 19 | tools.md | 含 "MCP Tools (Authorized)" 章節 | Grep |
| 20 | tools.md | MCP 工具選擇符合 agent 職責（參考 mcp-registry.md 和 agent-anatomy.md §3.5） | Read |
| 21 | tools.md | 包含 Google Drive 讀取限制提醒（引用 google-drive-read.md） | Grep |

> 🚫 **#2 / #7 / #22 已於 2026-05-28 移除** — 打卡機制全面移除，新建 agent 不再需要 `worklog/.gitkeep` 目錄（#2）、soul.md 打卡天條原則（#7）、`teamuq_category` 宣告 / `teamuq-category-map.yaml` 登記（#22）。編號保留空缺以維持既有引用穩定。

## 4. Manager 專屬檢查項
| # | 檢查項 | 驗證方式 |
|---|--------|---------|

> 🚫 **M1a / M1b 已於 2026-05-28 移除** — 打卡機制全面移除，Manager workflow.yaml 不再需要 `log_start` / `log_end` / `ensure_login` / `punch_in` / `punch_out` 任何打卡步驟，亦不再驗證打卡命令格式。

| M2 | workflow.yaml 含 verify 步驟 | Grep |
| M3 | workflow.yaml 含 synthesize 步驟 | Grep |
| M4 | tools.md 含 Agent 工具 | Grep |
| M5 | soul.md 含 7 條 Manager 必備原則（2026-05-28 起，原第 5 條打卡原則已隨打卡機制移除） | Read |
| M6 | skills.md 含 dispatch/synthesis 技能 | Read |
| M7 | workflow.yaml 含 hitl_gate 步驟（引用 hitl-protocol.md） | Grep |
| M8 | hitl_gate 使用嚴格 token（confirm/abort/modify），非模糊措辭 | Read |
| M9 | workflow.yaml 含 feedback_detect 步驟（引用 feedback-detect-flow.md） | Grep |
| M10 | workflow.yaml execute 步驟引用 inline-verify-flow.md 或包含 inline_verify 機制 | Grep |
| M11 | workflow/dispatch-protocol.md Worklog Block 包含 trace_id 和 parent_task_id | Grep dispatch-protocol.md for "trace_id" AND "parent_task_id" |

## 4.5 Director 專屬檢查項（含全部 Manager 檢查項 M1-M11）
| # | 檢查項 | 驗證方式 |
|---|--------|---------|
| D1 | agent.yaml type == "director" | Read |
| D2 | soul.md 含 Cross-team coordination 原則 | Grep |
| D3 | soul.md 含 Escalation judgment 原則 | Grep |
| D4 | skills.md 含 Multi-team Coordination 技能 | Read |
| D5 | workflow.yaml 含 dispatch_managers 動作 | Grep |
| D6 | org.md 列出管轄的 Manager 清單 | Read |
| D7 | workflow.yaml 含 feedback_detect 步驟（引用 feedback-detect-flow.md） | Grep |
| D8 | workflow.yaml execute 步驟引用 inline-verify-flow.md | Grep |

## 4.6 Officer 專屬檢查項（含全部 Director 檢查項 M1-M11 + D1-D8）
| # | 檢查項 | 驗證方式 |
|---|--------|---------|
| O1 | agent.yaml type == "officer" | Read |
| O2 | reports_to == "user" | Read |
| O3 | soul.md 含 Strategic vision 原則 | Grep |
| O4 | soul.md 含 Policy authority 原則 | Grep |
| O5 | skills.md 含 Organizational Strategy 技能 | Read |
| O6 | workflow.yaml 含 dispatch_directors 動作 | Grep |
| O7 | workflow.yaml 含 policy_check 步驟 | Grep |
| O8 | workflow.yaml 含 feedback_detect 步驟（引用 feedback-detect-flow.md） | Grep |
| O9 | workflow.yaml execute 步驟引用 inline-verify-flow.md | Grep |

## 5. Worker 專屬檢查項
| # | 檢查項 | 驗證方式 |
|---|--------|---------|
| W1 | tools.md 不含 Agent 工具 | Grep (negative) |
| W2 | soul.md 含 ≥3 領域專屬原則 | Read |
| W3 | skills.md 有 domain-specific 技能 | Read |
| W4 | workflow.yaml 不含 Manager 專屬步驟（dispatch_agents_parallel, dispatch_rounds, merge_results, verify_agent_work） | Grep (negative) |
| W5 | workflow.yaml 含 R-D-V 結構 | Read |
| W6 | workflow.yaml 包含 `check_memory` + `save_memory` 步驟 | 新建 agent 必備，確保自我成長機制落地 |
| W7 | Manager 類 agent 包含 `feedback_detect` 步驟 | Manager 專屬，偵測用戶回饋 |
| W8 | agent.yaml 含 `role_in_team` 且 ∈ {researcher, doer, verifier, shared}（worker type only） | Read agent.yaml + schema 驗證 |
| W9 | 若 `role_in_team == "verifier"`：目標 team 至少有 1 個 doer 且名稱不重疊（Team Trichotomy core 鎖） | Glob agents/{team}/*/agent.yaml + grep role_in_team |
| W10 | 若 `role_in_team == "doer"` 且該 team 已有 doer：dispatch brief 必含「為何不 Enhance」說明 | Read manager brief |

<!-- self-added 2026-05-23 rdv-trich-p3-flow-20260523 -->
**W8/W9/W10 判定原則**：
- W8 FAIL = 阻斷 PASS（**HIGH**，必修）— role_in_team 是 trichotomy 強制檢查的基礎欄位
- W9 FAIL = 阻斷 PASS（**HIGH**，trichotomy core 鎖）— V 不能孤立，必須與 D 配對
- W10 FAIL = CONDITIONAL_PASS（**MED**，可標必修但不阻斷）— 提示應優先考慮 Enhance

**例外處理**：
- W9 例外 1（跨 team V）：dispatcher 為跨 team manager（如 agent-ops/manager 派 governance）時，全系統有任意 doer 即 PASS — 不限本 team 內配對
- W8/W9 例外 2（shared 服務）：role_in_team == "shared" 自動 PASS，豁免 trichotomy 強制配對（如 agents/agent-ops/_shared/calculator）
- W8 例外 3（grace period）：截止 2026-06-22 前，允許 `role_in_team: unclassified` 作為過渡值；2026-06-22 後此值不再合法，必修升級

詳見 `agents/agent-ops/_protocols/team-trichotomy-protocol.md` 與 `agents/agent-ops/_protocols/rules/agent-anatomy.md` §6.9。
<!-- /self-added -->

<!-- self-added 2026-06-08 adopt-bp-rules-20260608 -->
| W11 | **評估方法已定義**（Evaluation-Method Gate）— 上線前，創建者必須在驗收文件或 dispatch brief 中明確定義：(a) **outcome-based 驗收標準**（評最終交付物狀態，非 tool-call 路徑）；(b) 若該 agent 屬「重複可靠執行」類，須定義 **pass^k 可靠度門檻**。「沒有定義好怎麼評它，就不算建立完成。」 | Read dispatch brief / acceptance doc；缺任一項 → FAIL | <!-- self-added 2026-06-08 adopt-bp-rules-20260608 --> |

**W11 補充說明**：
- outcome-based 評判原則見 `output-verification.md`（outcome-based grading）
- pass^k 可靠度指標定義見 `agent-slo.md`（pass^k）
- 此閉環要求源自 Evolution `resource_external_research_multiagent_2026-04-14.md` 識別的「PDCA Check / Evaluation 閉環缺失」問題
- W11 FAIL = 阻斷 PASS（**HIGH**，必修）— 無評估方法定義的 agent 不得上線

<!-- /self-added -->

<!-- added 2026-06-08 introduction-rules-20260608 -->
| W12 | **introduction.json 已產出且含多情境 workflows**（Agent Introduction Gate）— 建立新 agent 時，必須同步在 agent 目錄下產出 `introduction.json`，依 `agent-introduction.md` schema 規格：key 一律英文、值一律繁中白話、`workflows` 欄位含**多種情境陣列**（每元素 `{scenario, steps[]}`，manager 類 ≥3 情境，worker 類 ≥2 情境）。缺檔或 `workflows` 僅有單一情境 = FAIL 阻斷 PASS。 | Glob `agents/{team}/{agent}/introduction.json`；Read 確認 `workflows` 陣列長度 ≥2（worker）/ ≥3（manager）；缺檔或單情境 → FAIL |

**W12 補充說明**：
- schema 規格見 `agents/agent-ops/_protocols/rules/agent-introduction.md`（含欄位定義與值格式要求）
- `introduction.json` 為標準解剖七件套之外的**第八件**標準檔，列於 `agent-anatomy.md` 標準檔表
- 目的：供外部軟體編排讀取 + 供非工程師理解每個 AI 助手職責（key 英文穩定、值繁中白話）
- bootstrap 不讀此檔（與啟動流程無關，純 metadata）
- W12 FAIL = 阻斷 PASS（**HIGH**，必修）— 無 introduction.json 或單一情境 workflows 的 agent 不得宣告建立完成
<!-- /added -->

## 5.5 Team 級別檢查項
| # | 檢查項 | 驗證方式 | 說明 |
|---|--------|---------|------|
| T1 | 新建 team 必須有對應的 `.claude/skills/tuq-{team}/SKILL.md` 入口 | Glob | 確保 SKILL 檔案存在 |<!-- self-added 2026-05-30 hwdesign-global-skill-gap-fix-20260529-r2 -->
| T2 | Claude runtime 載入路徑可解析：新建 team 必須在 `~/.claude/skills/tuq-{team}/` 有全域 junction（directory junction / symlink）且 `~/.claude/skills/tuq-{team}/SKILL.md` 可解析 | Bash: `Test-Path ~/.claude/skills/tuq-{team}/SKILL.md`（Windows）或 `ls -la ~/.claude/skills/tuq-{team}/SKILL.md` | **Definition-of-Done（Claude）**：目標 runtime 含 Claude 時，`~/.claude/skills/<name>/SKILL.md` 必須可解析，junction 存在且指向 repo 對應 skill 目錄（`AgentOrg/.claude/skills/<name>/`）。落地方式：執行 `scripts/setup-global-skills.sh`（路徑：`AgentOrg/scripts/setup-global-skills.sh`）或手動建立 directory junction 指向 `AgentOrg/.claude/skills/<name>/`。**Governance 行為**：T2 不可 silent pass；若 runtime 連結尚未執行，Governance 必須回報「T2 deferred — 需 runtime global-link step」。 |<!-- self-added 2026-05-30 hwdesign-global-skill-gap-fix-20260529-r2 -->
| T3 | 新建 team 必須在 `settings.local.json` 註冊 `Skill(tuq-{team})` 權限 | Grep | 確保 Claude Code 有執行權限 |
| T4 | Codex runtime 載入路徑可解析 | Bash: `Test-Path C:/Users/david/.codex/skills/tuq-{team}/SKILL.md` 或 `Test-Path C:/Users/david/.agents/skills/tuq-{team}/SKILL.md`；若使用 repo source，確認 `.Codex/skills/tuq-{team}/SKILL.md` 或 `.agents/skills/tuq-{team}/SKILL.md` 已由 session 載入，且證據必須列出 current session skill list 中的 `tuq-{team}` 或等價可驗證證據，不能只說 repo source 存在 | **Definition-of-Done（Codex）**：目標 runtime 含 Codex 時，必須讓 skill 在 Codex 可載入 skill 路徑可解析；只建立 `agents/{team}` 或 `.claude/skills/tuq-{team}` 不等於 Codex 上線。Codex session 啟動時讀 skill list，補完後必須重開 session 才會出現在 skill list。 |<!-- self-added 2026-06-10 codex-skill-activation -->

<!-- self-added 2026-05-30 hwdesign-global-skill-gap-fix-20260529 -->
## 5.6 Global Skill Activation（新 skill/team 強制收尾步驟）

**觸發條件**：任何新 skill 或新 team 建立時，必須執行本節全部步驟，**未通過不得宣告完成（Definition-of-Done 強制項）**。

<!-- self-added 2026-06-10 codex-skill-activation -->
**Runtime 判定**：先判斷目標執行環境為 `claude` / `codex` / `both`。Claude 規則仍沿用 `.claude/skills` / `~/.claude/skills`；Codex 規則必須額外驗證 Codex 可載入 skill 路徑。只建立 `agents/{team}` 或 `.claude/skills/{name}` 不等於 Codex 上線。

| 步驟 | 動作 | 驗證方式 | 失敗處置 |
|------|------|---------|---------|
| GSA-1 | Claude runtime：執行 `bash scripts/setup-global-skills.sh`（路徑：`AgentOrg/scripts/setup-global-skills.sh`）建立全域 junction；或手動建立 `~/.claude/skills/<name>` directory junction 指向 repo `AgentOrg/.claude/skills/<name>/`<!-- self-added 2026-05-30 hwdesign-global-skill-gap-fix-20260529-r2 --> | 腳本輸出無錯誤；target_runtime 不含 Claude 時標 N/A | 排查 junction 建立權限，重跑腳本 |
| GSA-2 | Claude runtime：驗證 `~/.claude/skills/<name>/SKILL.md` 可解析（junction 存在且指向 `AgentOrg/.claude/skills/<name>/`<!-- self-added 2026-05-30 hwdesign-global-skill-gap-fix-20260529-r2 -->）；若 skill 入口檔非 `SKILL.md`，驗證對應入口檔可解析<!-- self-added 2026-05-30 hwdesign-global-skill-gap-fix-20260529-r2 --> | PowerShell: `Test-Path ~/.claude/skills/<name>/SKILL.md` 回傳 True；target_runtime 不含 Claude 時標 N/A | T2 deferred — 回報並補建 junction，再次驗證 |
| GSA-3 | Codex runtime：驗證 `C:/Users/david/.codex/skills/<name>/SKILL.md` 或 `C:/Users/david/.agents/skills/<name>/SKILL.md` 可解析；或 repo `.Codex/skills/<name>/SKILL.md` / `.agents/skills/<name>/SKILL.md` source 已由 session 載入 | PowerShell: `Test-Path C:/Users/david/.codex/skills/<name>/SKILL.md` 或 `Test-Path C:/Users/david/.agents/skills/<name>/SKILL.md` 回傳 True；repo source 模式必須列出 current session skill list 中的 `<name>`，或提供等價可驗證證據（例如本 session 實際載入清單截取），不能只說 repo source 存在；target_runtime 不含 Codex 時標 N/A | Codex skill activation missing — 補建 Codex 可載入路徑；補完後提醒重開 Codex session |
| GSA-4 | 未通過目標 runtime 對應的 GSA 檢查 → **不得**宣告 skill/team 完成；deliver 必須包含「runtime 載入路徑已驗證」確認 | Manager deliver block 含驗證截圖或指令輸出；Codex runtime 另含「需重開 session」提醒 | 阻斷交付，補連結後重跑對應 GSA |

**與 T2/T4 關係**：本節是 T2（Claude）與 T4（Codex）的落地執行規程；T2/T4 為稽核收尾項，GSA 為執行步驟，依 target_runtime 並行適用。

**根因參考**：retrospective `retrospective_hwdesign_global_skill_gap_20260529.md`（trace_id: tr-hwdesign-20260529）— 建了≠上線，全域連結必須成為強制、可驗證收尾。
<!-- /self-added -->

**W5: workflow.yaml 含 R-D-V 三段結構**
- Worker 的 workflow.yaml 至少含 3 個語意階段：
  - Research 段：`assess` / `research` / `diagnose`（至少一個）
  - Plan 段：`plan`（明確的規劃步驟）
  - Execute 段：`execute` / `configure` / `install` / `author`（至少一個）
- 每段須有獨立 `ref: workflow/XXX-flow.md`
- 驗證方式：Read workflow.yaml → 確認三段均存在
- 參考金標準：`agents/platform/gb10-sysadmin/workflow.yaml`（完整 R-D-V 結構）

## 6. 系統整合檢查
| # | 檢查項 | 驗證方式 |
|---|--------|---------|
| S1 | workflow.yaml 所有 ref: 指向存在的檔案 | Glob |
| S2 | org.md hierarchy 與實際目錄一致 | Read + Glob |
| S3 | CLAUDE.md Agent Anatomy 表已更新 | Read |

| S4 | **跨檔案 registry 完整性** — 新 agent 建立時，**直屬 Manager 的下列檔案**全部需登記新 agent | 見 S4 驗證方式 | <!-- self-added 2026-05-11 creation-validation-cross-team-registry-20260511 --> |

<!-- self-added 2026-05-11 creation-validation-cross-team-registry-20260511 -->
**S4 驗證方式（按 type 適用）**：

對 type=worker 的新 agent，依下列 5 處覆蓋表逐項檢查：

| # | 檔案 | 必查內容 | 缺失嚴重性 |
|---|------|---------|-----------|
| S4.1 | `agents/{team}/manager/org.md` | hierarchy 含新 agent 行 | HIGH（即現 S2，併入此處統一檢視） |
| S4.2 | `agents/{team}/manager/soul.md` | Scope 行（若有列舉 agent 名單）含新 agent | **HIGH**（Scope 是 Manager 行為基準） |
| S4.3 | `agents/{team}/manager/skills.md` | dispatch table / trigger map（若存在）含新 agent | MED |
| S4.4 | `agents/{team}/manager/README.md` | available agents / dispatch rules（若存在）含新 agent | MED |
**判定原則**：
- 「若有」的檔案區段：該檔案有對應區段但未含新 agent → FAIL
- 「若有」的檔案區段：該檔案無對應區段（純方法論說明）→ NOTE「無適用區段，略過」
- S4.1 (HIGH) + S4.2 (HIGH) 任一 FAIL = 阻斷 PASS，列為必修
- S4.3 / S4.4 FAIL = CONDITIONAL_PASS（可標必修但不阻斷）

對 type=manager / director / officer 的新 agent，S4 改檢查「上層 manager 的對應檔案」（director 對 officer、manager 對 user 入口 / SKILL.md 等），但本次任務範圍**僅補 worker 適用版**，更高層級請於本檔案末尾標註。

TODO: extend S4 to manager/director/officer in future <!-- self-added 2026-05-11 creation-validation-cross-team-registry-20260511 -->

**起源**：2026-05-11 sw/seo-geo-specialist 建立後發現 sw/manager soul.md Scope 行、agents/agent-ops/_shared/intent 分類表未登記，但既有 S1-S3 未抓到。
<!-- /self-added -->

| S5 | **reference doc 放置位置** — agent 若有個人靜態 reference 文件（coding checklist、design patterns、debug playbook、cheat sheet 等），必須放 `agents/{team}/{agent}/reference/` 子目錄，**不得直接放 agent 根目錄**（會與 anatomy 標準七件套 agent.yaml/soul.md/org.md/tools.md/skills.md/workflow.yaml/README.md 混淆） | Glob 檢查 agent 根目錄是否含 anatomy 標準七件套以外的 `.md` 檔（除 AGENTS.md、CLAUDE.md 等已知例外）；若有 → 應移到 reference/ | <!-- self-added 2026-05-12 creation-validation-reference-20260512 --> |

<!-- self-added 2026-05-12 creation-validation-reference-20260512 -->
**S5 驗證方式**：

對既有 agent 與新建 agent 同樣適用：

1. `ls agents/{team}/{agent}/*.md` 列出 agent 根目錄所有 .md
2. 比對「標準清單」：`agent.yaml`、`soul.md`、`org.md`、`tools.md`、`skills.md`、`README.md`、`AGENTS.md`、`SKILL.md`（部分 agent 有）
3. 任何不在標準清單的 `.md` 檔 → 應視為 reference doc 候選，應位於 `reference/` 子目錄
4. 例外：歷史備份檔（`*.bak.YYYY-MM-DD` 結尾）暫不檢查 — 屬 cleanup 範疇

**判定**：
- 有 reference doc 在根目錄 → FAIL（HIGH，必修）
- 有 reference doc 在 reference/ 子目錄 → PASS
- 無 reference doc → N/A（PASS by default）

**Reference**：`agents/agent-ops/_protocols/rules/agent-anatomy.md` reference/ 子目錄定義
<!-- /self-added -->

## 7. 完成判定
- 通用項 100% + 角色專屬項 100% + 系統整合 S1-S5 100% = PASS  <!-- self-added 2026-05-12 creation-validation-reference-20260512 -->
- **GSA（Global Skill Activation）FAIL = 阻斷 PASS（必修）** — 新 skill/team 必須通過 §5.6 中目標 runtime 對應的 GSA 檢查：Claude 需 `~/.claude/skills/<name>/SKILL.md` 可解析；Codex 需 `C:/Users/david/.codex/skills/<name>/SKILL.md` 或 `C:/Users/david/.agents/skills/<name>/SKILL.md` 可解析，或 repo `.Codex/skills` / `.agents/skills` source 已由 session 載入。否則不得宣告完成。  <!-- self-added 2026-06-10 codex-skill-activation -->
- S4 HIGH 項任一 FAIL = 阻斷 PASS（必修）；S4 MED 項 FAIL = CONDITIONAL_PASS
- S5 FAIL = 阻斷 PASS（必修）— reference doc 必移 reference/ 子目錄  <!-- self-added 2026-05-12 creation-validation-reference-20260512 -->
- W8/W9 HIGH 項任一 FAIL = 阻斷 PASS（必修）— W8 role_in_team 必填合法值、W9 V 必對應同 team D（trichotomy core 鎖）  <!-- self-added 2026-05-25 rdv-trich-h8-creation-validation-20260525 -->
- W10 FAIL = CONDITIONAL_PASS（可標必修但不阻斷）— 提示應優先考慮 Enhance 既有 D-worker，詳見 §5 W10 判定原則  <!-- self-added 2026-05-25 rdv-trich-h8-creation-validation-20260525 -->
- W12 FAIL = 阻斷 PASS（**HIGH**，必修）— 缺 introduction.json 或 workflows 單一情境的 agent 不得宣告建立完成  <!-- added 2026-06-08 introduction-rules-20260608 -->
- 任何 FAIL 項目阻止交付
- Worker: 通用 + W1-W12  <!-- self-added 2026-05-25 rdv-trich-h8-creation-validation-20260525：W6/W7 已在 §5 落地（W6 check_memory/save_memory、W7 feedback_detect），W8/W9/W10 為 2026-05-23 trichotomy 落地；W11 為 2026-06-08 adopt-bp-rules-20260608 Evaluation-Method Gate 落地；W12 為 2026-06-08 introduction-rules-20260608 Agent Introduction Gate 落地 -->
- Manager: 通用 + M1-M11
- Director: 通用 + M1-M11 + D1-D8
- Officer: 通用 + M1-M11 + D1-D8 + O1-O9

## 8. 常見缺失（歷史審計發現）
- skills.md 遺漏（最常見，9/19 agents 於 2026-04-14 審計中發現）
- workflow.yaml 缺 on_error
- tools.md 缺 "Do NOT Use" 章節
- W4 已修訂（2026-04-14）：原規則禁止 Worker 含 log_start/log_end，與當時「打卡是天條」矛盾。現改為禁止 Worker 含 Manager 專屬動作（dispatch, merge, verify_agent_work）。註：打卡機制已於 2026-05-28 全面移除，本條僅存歷史脈絡。
- Manager workflow.yaml 缺 hitl_gate 步驟（2026-04-15 審計新增）
- tools.md 缺 MCP 工具集（2026-04-17 新增：agent 不知道自己可用 desktop-commander、bash 等 MCP 工具）
- tools.md 使用 read_file 而非 read_multiple_files 讀取 T:\ 路徑（2026-04-17 新增：觸發 Google Drive 空內容問題）
- S2 → S4 規則升級（2026-05-11）：原 S2 僅查 hierarchy/目錄一致，擴展為 S4 五項跨檔 registry 完整性檢查。起源：sw/seo-geo-specialist 建立後 4 處 registry 漏登記事件（sw/manager soul.md Scope、skills.md dispatch table、README.md、agents/agent-ops/_shared/intent 分類表均未更新）。<!-- self-added 2026-05-11 creation-validation-cross-team-registry-20260511 -->
- S5 reference doc 放置位置（2026-05-12）：agent 個人靜態 reference 文件（coding-checklist 等）誤放 agent 根目錄與系統檔混淆。起源：2026-05-12 SW Team coding-checklist 落地事件 — manager 跨 team 委託時內聯執行未派 builder，漏判 anatomy 合規。<!-- self-added 2026-05-12 creation-validation-reference-20260512 -->
