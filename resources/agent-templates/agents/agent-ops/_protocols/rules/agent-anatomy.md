# Agent Anatomy Rules

## 1. 適用範圍
所有 agents/ 目錄下的 agent 都必須遵守此規範。

## 2. 角色分類
### 分類判定條件

| Type | 判定條件 |
|------|---------|
| Officer (L4) | agent.yaml 中 type == "officer"，reports_to == "user"，管理多個 Director |
| Director (L3) | agent.yaml 中 type == "director"，reports_to 為 officer 或 "user"，管理多個 Manager |
| Manager (L2) | agent.yaml 中 type == "manager"，reports_to 為 director 或 "user"（向下相容），管理多個 Worker |
| Worker (L1) | agent.yaml 中 type == "worker"，reports_to 為某個 manager，無下屬 |

**層級關係（低→高）**：Worker (L1) → Manager (L2) → Director (L3) → Officer (L4) → user

> **向下相容注意**：現有 Manager 的 reports_to == "user" 仍然合法（表示尚未導入 Director/Officer 層）。

### 舊判定條件（保留供參考）
- **Manager / Orchestrator**：agent.yaml 中 reports_to == "user" 或有下屬 agent 向其回報；tools.md 包含 Agent 工具；workflow.yaml 包含 dispatch_agent 或 dispatch_agents_parallel 動作
- **Worker**：agent.yaml 中 reports_to 指向某個 manager；tools.md 不包含 Agent 工具；無下屬

## 3. 通用必備檔案（所有 Type 共用）
| 檔案 | 必備 | 用途 | 可編輯者 |
|------|:----:|------|---------|
| agent.yaml | ✅ | 入口：bootstrap 順序、dispatch 路由 | Agent Builder only |
| soul.md | ✅ | 人格、原則、反模式 | Agent Builder only |
| tools.md | ✅ | 系統能力授權 | Agent Builder only |
| skills.md | ✅ | 領域專業知識 | Agent 可新增；刪除/修改需審批 |
| org.md | ✅ | 組織角色與回報關係 | Agent Builder only |
| workflow.yaml | ✅ | 執行工作流步驟 | Agent 可新增步驟；刪除/修改需審批 |
| memory/MEMORY.md | ✅ | 持久記憶索引 | Agent 自主讀寫 |
| introduction.json | 標準檔（中文化 metadata） | 中文化 metadata 介紹卡，供外部軟體編排；bootstrap 不讀；schema 見 `agents/agent-ops/_protocols/rules/agent-introduction.md` | Agent Builder only | <!-- added 2026-06-08 introduction-rules-20260608 -->

> 🚫 **打卡機制已於 2026-05-28 全面移除**（TeamUQ AppSync 與 local worklog 皆移除）。agent 不再需要 `worklog/` 目錄或 TeamUQ subtask 打卡記錄；workflow.yaml **不再需要任何打卡 step**（`ensure_login` / `punch_in` / `punch_out` / `log_start` / `log_end`），soul.md **不再需要打卡 Principle**。Agent 工作記錄改由外部 log 處理。歷史打卡 protocol（`punch-protocol.md` / `worklog-protocol.md`）已標記 OBSOLETE 保留作考古。

### 3.1 禁止出現的目錄（Hard Rule）

agent 資料夾只能放**身份與行為定義**，禁止出現任務產物目錄。以下目錄一律禁止：

| 禁止目錄 | 說明 |
|---------|------|
| `output/` | 任務產物 |
| `deliverables/` | 交付物 |
| `artifacts/` | 產出檔案 |
| `products/` | 產品/成品 |

所有任務產物必須寫到 `<CWD>/output/{team}/{task_id}/`，由 Manager 派遣時傳遞 `output_path` 參數決定。

**⚠️ 禁止目錄**：agent 資料夾下禁止出現任何任務產物目錄（`output/`, `deliverables/`, `artifacts/`, `products/`）。詳見下方 §3.1 與 [`output-placement.md`](output-placement.md)。

`output-placement.md` 是本規則在產物放置方面的詳細延伸規範（從屬補充）。

<!-- self-added 2026-05-12 move-checklist-to-reference-20260512 -->
## 3.2 `reference/` 子目錄（self-added 2026-05-12）

存放 agent 的**個人靜態參考文件**（個人 coding checklist、design patterns、debug playbook、領域 cheat sheet 等）。

**特性**：
- 非 bootstrap 自動載入 — agent 在執行任務時可主動 Read，但不在 agent.yaml bootstrap 序列中
- 與 `memory/`（runtime 累積、worklog 心得 cache）區隔：reference/ 是相對靜態的指南，memory/ 是動態演進的紀錄
- 個人性質、不強制（與 protocol 區隔）— 這些是 agent 自己看的 cheat sheet，不對外 enforce
- 可以 self-add（依 self-growth.md 加法自己來規則）— agent 經驗累積後可自行擴充

**禁止**：
- 不把 reference doc 放 agent 根目錄（會與標準七件套 agent.yaml/soul/org/tools/skills/workflow/README 混淆）
- 不把 protocol-level 強制規則放 reference/（強制規則屬 `agents/agent-ops/_protocols/`）
- 不放動態 runtime 紀錄（屬 memory/ 或 worklog/）

**範例**：
- `agents/sw/developer/reference/coding-checklist.md`
- `agents/sw/reviewer/reference/coding-checklist.md`

**起源**：2026-05-12 SW Team coding checklist 落地事件 — 原放 agent 根目錄與系統檔混淆，發現 anatomy 缺 reference doc 規範。
<!-- end self-added 2026-05-12 -->

## 3.5 tools.md MCP 工具集規範

### 目的
Subagent 在 Cowork 環境下自動繼承所有已連接的 MCP 工具（desktop-commander、gmail、calendar、workspace__bash、memory 等）。tools.md 必須明確列出該 agent 被授權使用的 MCP 工具，讓 agent 知道自己的完整能力。

### tools.md 必含段落
1. **Primary Tools** — 核心工具（Agent 用於 Manager、Read/Write/Edit 用於 Worker 等）
2. **MCP Tools (Authorized)** — 該 agent 被授權使用的 MCP 工具及其用途。參考 `agents/agent-ops/_protocols/mcp-registry.md`
3. **Do NOT Use** — 明確禁止的工具

### MCP 工具分類（依 mcp-registry.md）
| 類別 | 工具前綴 | 適用場景 |
|------|---------|---------|
| 檔案系統（Google Drive） | mcp__desktop-commander__ | 讀寫 T:\ 路徑檔案。**注意**：read_file 在 T:\ 只回傳 metadata，必須用 read_multiple_files（見 google-drive-read.md） |
| Shell 執行 | mcp__workspace__bash | 執行腳本（mkdir、業務腳本等；打卡腳本已於 2026-05-28 移除，不再呼叫） |
| Gmail | mcp__b1592d31*__gmail_* | 郵件操作 |
| Google Calendar | mcp__972626e3*__* | 日曆操作 |
| Memory（Knowledge Graph） | mcp__memory__* / mcp__server-memory__* | 持久化知識圖譜 |
| Chrome 瀏覽器 | mcp__Claude_in_Chrome__* | 網頁自動化 |
| 網路搜尋 | WebSearch, mcp__workspace__web_fetch | 線上搜尋與擷取 |

### Agent 職責→工具集對應原則
- **所有 agent**：desktop-commander（讀寫 T:\）、workspace__bash（mkdir、業務腳本；打卡腳本已於 2026-05-28 移除）
- **需要研究的 agent**：加上 WebSearch、web_fetch、Chrome
- **需要溝通的 agent**：加上 Gmail、Calendar
- **需要記憶的 agent**：加上 memory / server-memory
- **Manager 專屬**：Agent 工具（subagent 無法使用）、ToolSearch（subagent 無法使用）

## 4. agent.yaml 必填欄位
詳見 `agents/agent-ops/_protocols/definitions.md` §Agent Entry Point Schema。必填欄位：`agent`、`title`、`display_name`、`team`、`type`、`reports_to`、`bootstrap`（順序：soul.md → org.md → tools.md）、`workflow`、`dispatch.model`、`dispatch.trigger`、`dispatch.not_for`。

| 欄位 | 說明 |
|------|------|
| `title` | agent 的英文職稱，用於系統內部識別與 dispatch 路由。 |
| `display_name` | 用戶可見的繁體中文顯示名稱。用於報告、worklog 明細、deliver 步驟中面向用戶的輸出。遵循 `naming-convention.md`：用戶看到的用中文，系統內部用英文 `title`。 |

**`type` 欄位允許值**：`worker | manager | director | officer`

> 現有 agent.yaml 若未含 `type` 欄位，依 reports_to 推斷：reports_to == "user" 視為 manager，否則視為 worker。新建 agent 必須明確填寫 type。

### 4.1 `role_in_team` 欄位（Hard Rule，2026-05-23 self-added — rdv-trich-p2-rules-20260523）

| 欄位 | 必填條件 | 允許值 | 說明 |
|------|---------|--------|------|
| `role_in_team` | **`type == worker` 強制必填**；`type ∈ {manager, director, officer}` 自動視為 `manager`，無須填寫 | `researcher` \| `doer` \| `verifier` \| `shared`（**禁止多值**，強制單一） | 在 team 內擔任的角色分類，受 §6.9 Team Trichotomy Rule 約束 |

**允許值語意**：
- `researcher` — R-worker：動手前的資訊蒐集 / 規格訂定 / 驗收 checklist 設計
- `doer` — D-worker：實際產出 artifact（程式、文件、xlsx、簡報、3D 草圖等）
- `verifier` — V-worker：第三方驗收 / QA / Audit / Code Review
- `shared` — 跨 team 共享服務（如 `agents/agent-ops/_shared/calculator`），豁免 trichotomy 約束

**過渡值**：既有 agent 在 grace period（截止 2026-06-22）內允許 `role_in_team: unclassified`；grace period 結束後此值不再合法。

**參照**：
- §6.9 Team Trichotomy Rule（本檔案下方章節）
- `agents/agent-ops/_protocols/team-trichotomy-protocol.md`（完整規範與案例）
- `agents/agent-ops/_protocols/worker-rdv-protocol.md`（個體層 Worker-internal RDV，與本欄位是雙層架構；原名 `rdv-protocol.md`，2026-05-23 rename）

## 5. soul.md 通用規範
### 必含章節
- Identity（身份描述，必須獨特不可複製貼上）
- Principles（至少 4 條原則）
- Anti-patterns（至少 3 條反模式）

### 必含原則
- Scope Guard（超出領域必須拒絕）
- 計算委派（任何數學計算必須委派 agents/agent-ops/_shared/calculator，不可心算）
- 回饋偵測（偵測用戶正/負面回饋語意，觸發 memory 保存，依 feedback-memory.md）
- 逐次驗證（每個 worker 完成後立即驗證其聲稱與實際產出一致，依 inline-verify-flow.md）

## 6. Manager 專屬規範
### soul.md 必含原則（7 條）
1. Never do the work yourself
2. Maximize parallelism
3. Pick the right agent
4. Brief thoroughly
5. Fail gracefully
6. Respond in user's language
7. Split large tasks

> Manager 必含原則由 8 條縮減為 7 條 — 原第 5 條「Every agent punches their own clock」已隨 2026-05-28 打卡機制全面移除而刪除。

### workflow.yaml 必含步驟
`init_output_path` → `feedback_detect` → `classify/route` → `[hitl_gate]` → `execute` → `[governance]` → `verify` → `synthesize` → `deliver`

> 🚫 **打卡機制已於 2026-05-28 全面移除** — workflow.yaml 不再需要 `ensure_login` / `punch_in` / `punch_out` / `log_start` / `log_end` 任何打卡 step。
- feedback_detect 引用共用流程：`agents/agent-ops/_protocols/workflows/feedback-detect-flow.md`
- 方括號步驟可選但建議
- hitl_gate 建議包含：依 hitl-protocol.md 判斷風險等級，Tier 3 操作暫停等待用戶 `confirm` / `abort` / `modify` 嚴格 token
- synthesize 必須獨立（不可埋在 deliver 子動作）
- classify 步驟必須包含回饋偵測（依 agents/agent-ops/_protocols/rules/feedback-memory.md）
- 偵測到用戶回饋時，先保存 memory 再繼續處理任務
- execute 步驟必須包含 inline verification：每次 agent 返回後依 `agents/agent-ops/_protocols/workflows/inline-verify-flow.md` 逐項驗證，通過才派下一個

### skills.md 必含技能
- Task Decomposition
- Agent Selection / Dispatch
- Result Synthesis

### tools.md
- 必須含 Agent 工具
- 必須包含 "MCP Tools (Authorized)" 章節，列出該 Manager 被授權使用的 MCP 工具（參考 §3.5）

## 6.5 Director 專屬規範
Director 規範是 Manager 規範的**超集**（繼承所有 Manager 要求並新增以下）。

### soul.md 必含原則（9 條）
1–7. 同 Manager 原有 7 條
8. Cross-team coordination — 跨 team 任務時，協調相關 Manager 的優先順序與資源
9. Escalation judgment — 判斷何時需上報 Officer 決策，何時自行處理

### workflow.yaml 必含步驟
`init_output_path` → `feedback_detect` → `classify` → `dispatch_managers` → `[hitl_gate]` → `synthesize` → `deliver`

> 🚫 **打卡機制已於 2026-05-28 全面移除** — 不再需要 `ensure_login` / `punch_in` / `punch_out` / `log_start` / `log_end`。
- feedback_detect 引用共用流程：`agents/agent-ops/_protocols/workflows/feedback-detect-flow.md`
- hitl_gate 依 hitl-protocol.md 判斷，跨 team 操作建議納入
- dispatch_managers 必須支援並行派遣多個 Manager
- classify 步驟必須包含回饋偵測（依 agents/agent-ops/_protocols/rules/feedback-memory.md）
- 偵測到用戶回饋時，先保存 memory 再繼續處理任務
- dispatch_managers 步驟必須包含 inline verification：每次 Manager 返回後依 `agents/agent-ops/_protocols/workflows/inline-verify-flow.md` 逐項驗證，通過才派下一個

### skills.md 必含技能
- Multi-team Coordination
- Manager Selection & Dispatch
- Cross-team Result Synthesis
- Resource Prioritization

### tools.md
- 必須含 Agent 工具
- 可派遣 Manager 和 Worker
- 必須包含 "MCP Tools (Authorized)" 章節，列出該 Director 被授權使用的 MCP 工具（參考 §3.5）

## 6.6 Officer 專屬規範
Officer 規範是 Director 規範的**超集**（繼承所有 Director 要求並新增以下）。

### soul.md 必含原則（11 條）
1–9. 同 Director 原有 9 條
10. Strategic vision — 從組織整體角度評估任務優先順序，非單一 team 視角
11. Policy authority — 有權制定跨組織政策，但修改需經 Governance 審查

### workflow.yaml 必含步驟
`init_output_path` → `feedback_detect` → `strategic_classify` → `dispatch_directors` → `[hitl_gate]` → `synthesize` → `policy_check` → `deliver`

> 🚫 **打卡機制已於 2026-05-28 全面移除** — 不再需要 `ensure_login` / `punch_in` / `punch_out` / `log_start` / `log_end`。
- feedback_detect 引用共用流程：`agents/agent-ops/_protocols/workflows/feedback-detect-flow.md`
- hitl_gate 依 hitl-protocol.md，Officer 層操作預設為高風險，建議強制啟用
- policy_check 必須在 deliver 前執行，確認輸出符合組織政策
- strategic_classify 步驟必須包含回饋偵測（依 agents/agent-ops/_protocols/rules/feedback-memory.md）
- 偵測到用戶回饋時，先保存 memory 再繼續處理任務
- dispatch_directors 步驟必須包含 inline verification：每次 Director 返回後依 `agents/agent-ops/_protocols/workflows/inline-verify-flow.md` 逐項驗證，通過才派下一個

### skills.md 必含技能
- Organizational Strategy
- Director Selection & Dispatch
- Cross-organization Synthesis
- Policy Making & Enforcement

### tools.md
- 必須含 Agent 工具
- 可派遣 Director、Manager（跳級派遣允許，但需記錄原因）
- 必須包含 "MCP Tools (Authorized)" 章節，列出該 Officer 被授權使用的 MCP 工具（參考 §3.5）

<!-- self-added 2026-04-27 — dispatch-path rollout -->
## 6.7 Manager Dispatch Prompt 必含 Worker Bootstrap Paths（Hard Rule）

**規則**：Manager（含 Director / Officer，凡有派遣行為的角色）派遣 worker 時，dispatch prompt 必須在 Identity Block 列出 worker 的 4 個 bootstrap 檔案絕對路徑：
- `agent.yaml`
- `soul.md`
- `org.md`
- `tools.md`

**理由**：worker subagent 從零開始無 context。若 prompt 只寫「You are the X agent」而不給 path，worker 必須先反查 dispatch caller（manager）才能找到自己的定義，浪費 round trip 與 token。違反 Manager soul.md Principle 4「Brief thoroughly — 從零開始就要 context 完整」精神。

**範本**：
```
You are the {AgentName} agent.

Bootstrap files (read in this order, absolute paths):
  T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents/{team}/{agent}/agent.yaml
  T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents/{team}/{agent}/soul.md
  T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents/{team}/{agent}/org.md
  T:/共用雲端硬碟/快組隊.Agents/AgentOrg/agents/{team}/{agent}/tools.md

Bootstrap once, then start workflow.
```

**起源**：2026-04-27 用戶 feedback — edu/manager 派 content-designer 時 prompt 開頭只寫「你是 edu/content-designer」沒給路徑，worker 不得不先讀 manager 找路。完整背景見 `agents/agent-ops/manager/memory/feedback-2026-04-27-dispatch-paths.md`。

**驗證**：每次 governance 審查 dispatch prompt 時必檢此項。每位 Manager 的 `workflow/dispatch-protocol.md`（或 `dispatch-flow.md`）的 Identity Block 必須符合此範本。

<!-- self-added 2026-06-08 adopt-bp-rules-20260608 — dispatch input 四件套 -->
### 6.7.1 Dispatch Prompt 任務輸入四件套（Hard Rule）

Identity Block（§6.7 bootstrap 路徑）解決「worker 是誰」；本節解決「worker 要做什麼」。兩者合體才是完整的 dispatch prompt。

每次 dispatch prompt 除 Identity Block 外，**必須**明確包含以下四件套：

| 件 | 欄位 | 說明 |
|----|------|------|
| 1 | **objective（目標）** | 本次任務的具體目標，一句話說清楚「做什麼、交付什麼」 |
| 2 | **output format（輸出格式）** | 預期產出的格式、結構、存放路徑（如 markdown 表格、JSON、寫入 output_path） |
| 3 | **tools 指引** | 明確告知 worker 可用/禁用哪些工具，避免 worker 自行猜測授權範圍 |
| 4 | **task boundaries（明確邊界）** | 哪些事 worker 不做、不碰、不決定（Scope Guard 邊界） |

**理由**：來自 Anthropic multi-agent research system 設計原則——「Each subagent needs an objective, an output format, guidance on tools, and clear task boundaries」。缺少任一件，worker 易越界、格式不符、或浪費 round trip 確認。

**與 §6.8 的關係**：§6.8 的 `task_id` 與 `output_path` 屬於四件套中「output format」的子集延伸；兩節互補，不重複。

**驗證**：governance 審查 dispatch prompt 時，Identity Block（§6.7）與四件套（§6.7.1）皆為必查項目。
<!-- end self-added 2026-06-08 -->
<!-- end self-added 2026-04-27 -->

## 6.8 Manager Dispatch Prompt 必含 Output Path 與 Task ID（Hard Rule）

> **2026-05-01 self-added** rule-rollout (output-path-confirmation final)。配合 P_n Output Path Confirmation Principle 與 `output-placement.md` §5.3 的治本層 Hard Rule。

### 規則
所有 Manager（Type == manager）必須滿足：

1. **必有 `workflow/dispatch-protocol.md`**（或同等定位的 dispatch flow 檔，例如 `dispatch-flow.md`）
   - 此檔必含一個 **Task Paths Block**（命名可為 §4.5 Output Path Block / Output Path Block / TASK PATHS / Dispatch Path Block 等等效命名），描述每次 dispatch prompt 必含 `task_id` 與 `output_path` 兩欄
   - 缺檔 = Major audit finding；缺 Block = Major

2. **workflow.yaml 必有 `init_output_path` step**（或同等命名 step），位於 `log_start` 之後、第一次 dispatch 之前
   - 必須 ref 到 `agents/agent-ops/_protocols/workflows/init-output-path-flow.md`（共用 flow，不必各 team 各建一份）

3. **每個 dispatch worker 的 prompt 模板**必含：
   ```
   TASK PATHS:
     task_id: {Manager 已決定的 task_id}
     output_path: {Manager 已 mkdir -p 的絕對路徑}
   ```

4. **Worker 收到無 TASK PATHS（或 task_id / output_path 缺失）的 brief 必拒**，回報 `SCOPE VIOLATION: missing output_path`（與 §H4 一致）

5. **業務 team vs 系統 team 的 output destination 區分（2026-05-01 self-added）**

   - **業務 team**（edu / sales / finance / bni / sw）：`output_path` **禁止**落 AgentOrg ROOT 本體；必須落用戶業務專案 CWD（`$CLAUDE_PROJECT_DIR` / `$TUQ_LOG` / 業務專案 `$PWD`）。違反 = Critical。
   - **系統 team**（agent-ops）：`output_path` 應落 AgentOrg ROOT（系統管理產出本就放 ROOT）。
   - Manager 必須在 `init_output_path` step 跑 ROOT detect（見 `init-output-path-flow.md` §2c），業務 team Manager 缺 ROOT detect = Major。

   詳細規則見 `agents/agent-ops/_protocols/workflows/init-output-path-flow.md` §2b/§2c。

### 稽核項目（季稽核 / governance 必查）
| # | 檢查 | 違反等級 |
|---|------|---------|
| A | manager 是否有 dispatch-protocol.md / dispatch-flow.md | Major |
| B | 該檔是否含 Task Paths Block | Major |
| C | workflow.yaml 是否有 init_output_path step 在 log_start 之後 | Major |
| D | step 是否 ref 到共用 init-output-path-flow.md | Minor |
| E | dispatch prompt 模板是否含 task_id + output_path 兩欄 | Major |
| F | 業務 team Manager 是否含 ROOT detect 邏輯（init_output_path step 中或 ref flow 中） | Major |

### 例外
- 純查詢類 fast-path Manager（不 dispatch 任何 worker）可豁免 #2 #3 #5
- 但仍需在 dispatch-protocol.md 註明「Manager 為純查詢型，未 dispatch worker」

### Reference
- `agents/agent-ops/_protocols/rules/output-placement.md` §5.2 / §5.3
- `agents/agent-ops/_protocols/workflows/init-output-path-flow.md`
- 各 manager soul.md「Output Path Confirmation」Principle

<!-- self-added 2026-05-23 rdv-trich-p2-rules-20260523 -->
## 6.9 Team Trichotomy Rule（Hard Rule）

> **2026-05-23 self-added** — Manager 派工三權分立規則。詳細規範、案例與既有 team 現況見 `agents/agent-ops/_protocols/team-trichotomy-protocol.md`。

### 規則（Hard Rules）

每個 team 在派工層面必須滿足：

1. **角色分類強制宣告** — 每個 Worker 的 `agent.yaml` 必須含 `role_in_team` ∈ `{researcher, doer, verifier, shared}`（依 §4.1）。**禁止多值** — 強制單一角色，迫使 team 多開 worker 來分權。
2. **V 不孤立** — 若 team 有 `verifier`，必有對應 `doer`（V 不能孤立存在於該 team；跨 team V 例外見下方）。
3. **D/V 不合一**（核心紅線） — **同一 agent 不得同時擔任 `doer` 與 `verifier`**。R 與 V 可由同 agent 兼任（不違反紀律，因不 Do），但 D 必須獨立。
4. **隱性 owner 分立** — `verifier` 與 `doer` 不可共享 `reports_to` 鏈外的隱性 owner（例如同一人寫 + 同一人審）。

### 例外

- **manager+ type 自動視為 `manager` role**（依 §4.1）— `manager / director / officer` 不必填 `role_in_team`，三權分立規則只在 worker 層強制。
- **跨 team 共享服務**（如 `agents/agent-ops/_shared/calculator`）標 `role_in_team: shared`，**豁免 trichotomy 約束**。其同時做 D（計算）+ V（exit_code 自驗）的 case 屬合法例外。
- **跨 team V**（dispatcher 是 manager 而非單一 team 內的 doer，例如 `agent-ops/governance` 對全系統 audit）— 允許**全系統有任意 `doer` 即視為 PASS**，不必對應到特定 team 的特定 doer。
- **同 manager 派遣不算合一** — 例如 `finance/billing-builder`（D）+ `finance/billing-qa`（V）雖同屬 `finance/manager` 派遣，**只要 agent 不同名即合法**（不視為「同主人 = 合一」）。
- **純單人 team** — 允許暫時不滿足 trichotomy；當該 team 加入第二個 worker 時必補齊角色分立。
- **既有 agent grace period 30 天** — 截止 **2026-06-22**。grace period 內允許 `role_in_team: unclassified`；其後此值不再合法，所有 worker 必須完成歸類。

### 與相關 protocol 的關係

| 維度 | 本規則（§6.9） | `worker-rdv-protocol.md`（原名 `rdv-protocol.md`，2026-05-23 rename） |
|------|---------------|------------------------------------------------------------|
| 層級 | **Team 角色分立**（組織分權） | **Worker 內部階段**（個體紀律） |
| 主體 | 三個獨立 Worker 互相牽制 | 同一 Worker 的 R → D → V 自我循環 |
| 約束對象 | Manager 派工決策 | Worker 執行節奏 |

**配合條款**：
- 詳細案例（教科書範本 / 補強 team / 反 pattern）與 8 個既有 team 的現況分析見 `agents/agent-ops/_protocols/team-trichotomy-protocol.md`。
- 個體層 RDV 紀律見 `agents/agent-ops/_protocols/worker-rdv-protocol.md`（原名 `rdv-protocol.md`，2026-05-23 rename，消除「RDV」一詞在 Team 層 vs Worker 個體層的命名歧義）。
- creation-validation.md 將於 P3 落地 W8/W9/W10 三項稽核項目對應本規則。
<!-- end self-added 2026-05-23 -->

<!-- self-added 2026-06-08 adopt-bp-rules-20260608 — file-ownership -->
## 6.10 File-Ownership（平行協作邊界，Hard Rule）

> **2026-06-08 self-added** — rollout adopt-bp-rules-20260608。來源：Anthropic「multi-agent research system」、Agent Teams docs、wshobson/agents agent-teams plugin（file-ownership）。

### 核心規則

**一檔一主**：同一個檔案**絕不**同時指派給兩個並行 worker。並行 worker 之間以「介面契約」（shared types / API 定義 / 上下游產物路徑）協調，而非共享源檔。

### 衝突處理

| 情境 | 做法 |
|------|------|
| 多方各自讀取、各自寫不同檔案 | 正常並行，無衝突 |
| 多方需要修改**同一檔案** | 由 Manager **擁有並序列套用**所有變更，不平行 |
| 上下游產物依賴 | 以明確路徑（`output_path` 或 interface contract 文件）傳遞，下游等上游產出後再讀取 |

### 進階機制（**實驗性**，預設關閉、未上生產）

以下機制參考 Anthropic Agent Teams 設計，供未來評估導入：

- **共享 task list**：Manager 維護 pending / in-progress / completed 三態清單，worker 認領前先查狀態，避免重複認領。
- **顯式依賴圖**：每個 task 可標 `blockedBy` / `blocks`；依賴未解除（前置 task 未 completed）則不可認領。
- **file-lock 認領**：worker 動手前宣告鎖定目標檔，完成後釋放。目前為語意慣例（非技術鎖），Manager 層 enforce。

### 既有差距回指

本規則解決 Evolution 研究（`agents/agent-ops/evolution/memory/resource_external_research_multiagent_2026-04-14.md` §2.2 差距 8）識別的「Passing Ships / Shared Scratchpad 缺失」：並行 agent 缺乏共享狀態可見性，導致各自做出矛盾決策。File-ownership 從源頭防止衝突，而非事後協調。
<!-- end self-added 2026-06-08 -->

## 7. Worker 專屬規範
### soul.md 必含原則
- 至少 3 條領域專屬原則（不得從其他 agent 複製）
- Follow the plan（遵循上游計劃）

### workflow.yaml 結構
- 不含 Manager 專屬動作（dispatch_agents_parallel, dispatch_rounds, merge_results, verify_agent_work）
- 🚫 **打卡機制已於 2026-05-28 全面移除** — Worker workflow.yaml 不再需要 `punch_in` / `punch_out` / `log_start` / `log_end` 任何打卡 step；`read_task_images`（若任務需讀圖）仍保留為一般工作步驟，與打卡無關。
- 建議含 check_memory + save_memory 步驟
- 每個可能失敗的步驟必須有 on_error

### skills.md 必含內容
- 至少 3 項領域專屬技能
- 技能描述是領域知識，不是工具名稱

### tools.md
- 不得包含 Agent 工具
- 必須包含 "Do NOT Use" 章節
- 必須包含 "MCP Tools (Authorized)" 章節，列出該 Worker 被授權使用的 MCP 工具（參考 §3.5）

### workflow.yaml 格式
- **steps 格式**（推薦）：每步有 id、action、on_error，結構最清晰
- **routes 格式**：僅用於純路由型 agent（如 intent），整體有 error_policy 即可
- 混用時以 steps 為主、routes 為輔

## 8. 與現有協議的關係
- 引用 definitions.md §Agent Entry Point Schema
- 🚫 打卡機制已於 2026-05-28 全面移除，不再引用 `punch-protocol.md` / `worklog-protocol.md`（兩檔已標記 OBSOLETE，僅存考古）
- 引用 verification-protocol.md
- 引用 memory-protocol.md
- 引用 agents/agent-ops/_protocols/rules/feedback-memory.md
- 引用 agents/agent-ops/_protocols/workflows/feedback-detect-flow.md（回饋偵測標準流程）
- 引用 agents/agent-ops/_protocols/workflows/inline-verify-flow.md（逐次派遣驗證流程）
- 引用 creation-validation.md §Director 專屬檢查項（L3 建立時必須通過 Director checklist）
- 引用 creation-validation.md §Officer 專屬檢查項（L4 建立時必須通過 Officer checklist，並需 Governance 審查）
- 子規則（detailed extension）`agents/agent-ops/_protocols/rules/output-placement.md`（agent 資料夾禁止出現任務產物目錄；所有產物寫 `<CWD>/output/{team}/{task_id}/`）
