> 🚫 **OBSOLETE — 2026-05-28**
>
> 打卡機制已於 2026-05-28 全面移除。本文件保留作歷史考古，agent 系統不再使用任何打卡（TeamUQ 或 local worklog）。Agent 工作記錄改由外部 log 處理。
>
> **請勿**依本文件建立新的打卡流程。
>
> 移除記錄：`agents/agent-ops/manager/memory/punch_migration_state_20260527.md`
>
> ---
> （以下為 2026-05-27 升級為 OBSOLETE 前的 DEPRECATED 標記，保留作歷史考古）
>
> ⚠️ **DEPRECATED — Phase 1D 2026-05-27**
>
> 本文件描述的 `scripts/worklog.sh` 本地 JSON 打卡系統，由 [`punch-protocol.md`](punch-protocol.md) 定義的 TeamUQ AppSync 打卡系統取代（兩者皆已於 2026-05-28 移除）。

---

# Worklog Protocol

Every agent MUST follow this protocol. Worklog is the **first** and **last** action.

## Canonical Status Enum

> **Canonical** — 任何 worklog `status` 欄位或 `worklog.sh end <status>` 的 status 引數，**必須**使用以下三值之一。撰寫 dispatch prompt / workflow.yaml / 文件範例時也只能用 canonical 值。

### Allowed Values (Hard Rule — only 3)

| 值 | 語意 | 適用情境 |
|----|------|----------|
| `success` | 完整達成所有目標 | 所有 deliverable 完成、無錯誤、無 scope 縮減 |
| `partial` | 達成主要目標但有缺口 | 部分 deliverable 缺、scope 縮減、有 known gap |
| `failed` | 未達成主要目標 | crash、scope violation、無法完成核心任務 |

額外保留：`started` 為 On-Start 階段使用（open state），不會出現在 On-End。

### Legacy Auto-Coerce Table

`worklog.sh end` 收到下列 legacy 值時，自動 coerce + stderr warn + 寫入 `coerced_status: true` / `original_status: <原值>`。**新撰寫的程式/文件不得使用 legacy 值**，但既有 caller 暫時容錯：

| Legacy 值 | Coerce 為 |
|-----------|-----------|
| `completed` | `success` |
| `done` | `success` |
| `ok` | `success` |
| `pass` | `success` |
| `passed` | `success` |
| `partial_success` | `partial` |
| `partial-success` | `partial` |
| `pass-with-warning` | `partial` |
| `ok-with-warning` | `partial` |
| `fail` | `failed` |
| `error` | `failed` |
| 其他任意字串 | `failed` (+ `coerce_reason`) |

完整 mapping 以 `scripts/_worklog_helper.py:LEGACY_STATUS_MAP` 為單一事實來源（Single Source of Truth）；本表為 protocol 公開副本，新增 mapping 必須同步更新兩處。

### Canonical Dispatch / workflow.yaml 範例

```yaml
# workflow.yaml step — 主流程末端顯式呼叫（見 §Orphan Detection 收尾保證說明）
- id: finally_log_end
  command: 'bash scripts/worklog.sh end "$WORKLOG_FILE" success "$OUTPUT_SUMMARY"'
```

```bash
# Dispatch prompt 中 worker 收尾範例（用 stdin 避免 $ 展開）
bash scripts/worklog.sh end "$WORKLOG_FILE" success - <<'EOF'
建立 6 檔，路徑 output/.../report.md
EOF

# 部分成功
bash scripts/worklog.sh end "$WORKLOG_FILE" partial - <<'EOF'
完成 5/7 deliverable；2 項 scope-cut 已記錄
EOF

# 失敗
bash scripts/worklog.sh end "$WORKLOG_FILE" failed - <<'EOF'
interrupted: tool permission denied at step 3
EOF
```

**不要再寫 `completed`** — 它會 coerce，並在統計面板留 WARN 紀錄。Agent 自我檢查清單：
- [ ] workflow.yaml 步驟用 `success` / `partial` / `failed`
- [ ] dispatch prompt 範例用 canonical 值
- [ ] tools.md / soul.md 文件範例用 canonical 值

## Schema (JSON)

### Canonical Worklog Schema（單一事實來源 — 欄位名 + 型別）

> **Origin**：2026-05-27 self-growth-20260527 — 跨歷史 worklog 偵測到至少 **3 種 schema 並存**，導致孤兒偵測器（`worklog-sweep.sh`）誤判（16 候選中真孤兒僅 1）。本節定義**唯一 canonical schema**，所有新寫入 worklog **必須**使用以下 canonical 欄位名與型別。`worklog.sh` / `_worklog_helper.py` 為實作事實來源；本表為 protocol 公開規範。

#### Canonical 欄位（時間/狀態相關，型別）

| Canonical 欄位 | 型別 | 語意 |
|----------------|------|------|
| `started_at` | ISO 8601 string | agent 開工時間（On Start 必填） |
| `ended_at` | ISO 8601 string \| `null` | agent 收工時間（On Start 為 `null`，On End 必填） |
| `status` | string enum | `started`（open）/ `success` / `partial` / `failed` |
| `duration_seconds` | number \| `null` | `ended_at − started_at`（秒） |

（其餘 canonical 欄位見下方 §Required Fields 全表。）

#### Legacy 變體 → Canonical 欄位對應表（偵測器須容錯三變體）

歷史 worklog 存在以下 3 種 legacy schema 變體。**新寫入禁用 legacy 欄位名**，但偵測器（sweep / report / dashboard）讀取時**必須容錯這三變體**，將其 normalize 到 canonical 欄位後再判斷孤兒/狀態：

| Legacy 變體 | Legacy 欄位 | → Canonical 欄位 | 備註 |
|-------------|-------------|------------------|------|
| 變體 A（canonical 本體） | `started_at` / `ended_at` | `started_at` / `ended_at` | 現行 canonical，無需轉換 |
| 變體 B（timestamp_ 前綴） | `timestamp_start` / `timestamp_end` | `started_at` / `ended_at` | 舊 schema；`timestamp_end` 非空即視為已收尾 |
| 變體 C（completed_at 單欄） | `completed_at` | `ended_at` | 只有結束欄無 `ended_at`；`completed_at` 非空即視為已收尾，**不得**因缺 `ended_at` 誤判為孤兒 |

> **偵測器容錯規則（Hard Rule for detectors）**：判斷一筆 worklog 是否「已收尾」時，須檢查 `ended_at` **OR** `timestamp_end` **OR** `completed_at` 任一非空；三者皆空且 `status=started`（或 legacy 等義）才進入孤兒到期判斷。僅讀 `ended_at` 會把變體 B/C 的已收尾 worklog 誤判為孤兒（即 16 候選 vs 1 真孤兒的成因）。

### On Start (FIRST action)

```json
{
  "agent": "{agent-name}",
  "task_id": "{YYYY-MM-DD}_{HH-MM-SS-mmm}_{agent-name}",
  "status": "started",
  "started_at": "ISO 8601 timestamp",
  "ended_at": null,
  "duration_seconds": null,
  "model": "haiku | sonnet | opus",
  "dispatched_by": "manager",
  "trace_id": "UUID — same for all agents in one Manager task",
  "parent_task_id": "task_id of the dispatching Manager, or null for top-level",
  "input_summary": "one-line: what was this agent asked to do",
  "output_summary": null,
  "brief": "one-line: what this agent is doing"
}
```

### On End (LAST action)

Update the **same file** — fill in `ended_at`, `duration_seconds`, `output_summary`, set `status`:

```json
{
  "agent": "developer",
  "task_id": "2026-04-13_14-30-00_developer",
  "status": "completed | failed",
  "started_at": "2026-04-13T14:30:00+08:00",
  "ended_at": "2026-04-13T14:35:42+08:00",
  "duration_seconds": 342,
  "model": "sonnet",
  "dispatched_by": "manager",
  "trace_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "parent_task_id": "2026-04-13_14-29-55-000_sw-manager",
  "input_summary": "Implement login form with validation per Architect plan",
  "output_summary": "Created src/pages/login.tsx, src/lib/validate.ts. All tests pass.",
  "brief": "Implement login page"
}
```

## Required Fields

| Field | On Start | On End | Description |
|-------|----------|--------|-------------|
| `agent` | required | same | Agent name |
| `task_id` | required | same | Unique ID (timestamp + agent name) |
| `status` | `"started"` | `"completed"` or `"failed"` | Current state |
| `started_at` | required | same | ISO 8601 timestamp when agent began |
| `ended_at` | `null` | **required** | ISO 8601 timestamp when agent finished |
| `duration_seconds` | `null` | **required** | Total seconds from start to end |
| `model` | required | same | Which model was used (haiku/sonnet/opus) |
| `dispatched_by` | required | same | Who dispatched this agent |
| `trace_id` | required | same | UUID generated by the top-level Manager at task start. All dispatched agents inherit this same trace_id. |
| `parent_task_id` | optional | same | The task_id of the agent that dispatched this one. null for top-level Manager. |
| `input_summary` | required | same | What was the agent asked to do |
| `output_summary` | `null` | **required** | What the agent produced |
| `brief` | required | same | One-line label |

## Status Vocabulary（標準化）

> **Origin**：2026-05-09 self-growth-followup — 跨 team 統計顯示 status 欄位混用 `completed` / `success` / `partial_success` / `done` / `ok` 等多種詞彙，導致 worklog-report.sh 統計失準與 Manager 驗證邏輯誤判。

### Hard Rule — 只允許 3 個值

`status` 欄位（On End）**只允許**以下三個值：

| 值 | 語意 | 適用情境 |
|----|------|----------|
| `success` | 完整達成所有目標 | 所有 deliverable 完成、無錯誤、無 scope 縮減 |
| `partial` | 達成主要目標但有缺口 | 部分 deliverable 缺、scope 縮減、有 known gap |
| `failed` | 未達成主要目標 | crash、scope violation、無法完成核心任務 |

### Legacy 對應（向後相容）

舊 worklog 中以下值由 `worklog.sh` 寫入時自動 coerce：

| Legacy 值 | Coerce 為 | 行為 |
|-----------|-----------|------|
| `completed` | `success` | warn + coerce |
| `partial_success` | `partial` | warn + coerce |
| `done` / `ok` / `pass` | `success` | warn + coerce |
| 其他非允許值 | `failed` | warn + coerce + 標 `coerce_reason` |

`worklog.sh end` 接到非允許值時必須：
1. stderr 印 `WARN: status "<input>" not in {success,partial,failed}, coercing to "<mapped>"`
2. JSON 寫入兩個欄位以利稽核與查詢：
   - `coerced_status: true`（布林，標示本筆 status 是否經過 coerce；未 coerce 時欄位可省略或為 `false`）
   - `original_status: "<原值>"`（字串，保留 caller 原始傳入值供回溯）
3. 仍允許執行（不阻斷 agent 收工）

### 為何嚴格

- worklog-report.sh / dashboard 統計需要固定詞彙
- Manager 的 Post-Dispatch Verification 邏輯依 status 判斷是否需追補
- governance / SLO 報表計算 success rate 需可比口徑

## Heartbeat / Orphan Detection

> **Origin**：2026-05-09 self-growth-followup — 跨 team 發現多筆 worklog 卡在 `status=started` 數天無 end，推測為 agent 中途崩潰或 harness 中斷未收尾，導致 `dispatch_summary` 失真與 trace tree 殘缺。

### Orphan 定義

符合以下條件的 worklog 視為 **orphan**：
- `status = "started"`
- `ended_at` 仍為 `null`
- 以下任一條件成立：
  - `expires_at` 欄位存在且 `expires_at < now`
  - `expires_at` 缺失（舊格式）且 `started_at` 距今 **超過 24 小時**（fallback）

**Heartbeat 豁免**：若 `last_heartbeat` 比 `expires_at` 更新，視為仍在執行，sweep 跳過。

**Sweep Helper 行為**：`scripts/worklog-sweep.sh` 每 15 分鐘掃描全域 worklog，對已到期 orphan 補寫 `status=failed` + `sweep_coerced=true` + `sweep_reason`（見 §Auto-Coercion）。

### 收尾保證（agent 端）

**Claude Code runtime 不支援 `always_run`**（P1 已驗證）。agent 端收尾應：
1. 在主流程末端顯式呼叫 `worklog.sh end "$WORKLOG_FILE" success|partial|failed`
2. 長任務（> 30 分鐘）傳入 `--expires-in-seconds N` override（見 §worklog.sh start CLI）
3. 若主流程 abort 而無法 end：由 cron sweep + manager sweep 雙保險自動補底（見 §Auto-Coercion）

> **注意（支援 always_run 的其他 runtime）**：若所用 runtime 支援 `always_run`/`finally`，仍可加入 finally 步驟呼叫 `worklog.sh end ... failed`，作為額外保障。但 Claude Code harness 不得依賴此 key。

### Heartbeat（可選，長 task 推薦）

預期執行 > 30 分鐘的 agent **可**定期更新 heartbeat：

```bash
bash scripts/worklog.sh heartbeat "$WORKLOG_FILE"
```

寫入 `last_heartbeat: <ISO8601>` 欄位。orphan 偵測可用此欄位判斷「started 超時但仍活著」vs「真的死了」。

### Orphan 列出（運維端）

`worklog-report.sh --orphans` 列出所有符合 orphan 定義的 worklog：

```bash
bash scripts/worklog-report.sh --orphans [--threshold-hours 24]
```

輸出包含：worklog path / agent / started_at / 距今 hours / last_heartbeat（若有）。建議納入 Agent Ops Manager 每日巡檢。

### 為何重要

- orphan worklog 污染 trace tree 與 dispatch_summary 統計
- governance 無法判斷 agent 是否真的失敗
- 累積過多 orphan 會讓 worklog-report.sh 性能下降

## Auto-Coercion（自動補寫機制）

> **Origin**：2026-05-17 worklog-fix-bulk-20260517 C3 — cron sweep + expires_at 為主力補底機制（P1 研究結論；設計詳見 `output/agent-ops/worklog-fix-bulk-20260517/p4_cron_sweep_design.md`）。

### 觸發來源

| 來源 | 類型 | 頻率 |
|------|------|------|
| `scripts/worklog-sweep.sh` | cron sweep（全域、time-based） | 每 15 分鐘（D1 階段安裝） |
| manager workflow `sweep_my_trace_orphans` step | manager sweep（trace-based） | manager 收尾時執行（C4 落地） |

### 觸發條件

```
status == "started"
AND ended_at == null
AND (
    expires_at < now                          # expires_at 存在時
    OR (expires_at 缺失 AND started_at + 24h < now)  # 舊格式 fallback
)
AND (last_heartbeat 缺失 OR last_heartbeat <= expires_at)  # heartbeat 豁免
```

### 寫入欄位

| 欄位 | 值 |
|------|----|
| `status` | `"failed"` |
| `ended_at` | ISO 8601 now |
| `duration_seconds` | now − started_at（秒數） |
| `sweep_coerced` | `true` |
| `sweep_reason` | `"expired_via_expires_at"` / `"expired_via_max_age_fallback"` / `"manager_sweep"` |

### F3：output_summary 覆寫保護

- `output_summary` 已有非空內容 → **保留 LLM 原文**，另寫 `coerce_note: "coerced_by_sweep"` 欄位
- `output_summary` 為 null / 空 → 填入 `"coerced_by_sweep"` 或 `"coerced_by_manager_sweep"`

> 兩組欄位語意不同、互不影響：`coerced_status`/`original_status` 為 status 詞彙 coerce 標旗（`worklog.sh end` 路徑）；`sweep_coerced`/`sweep_reason` 為整筆 worklog 被 sweep 自動補寫標旗（sweep 路徑）。

### 不保證

- 有最多 **15 分鐘延遲**（cron 間隔）；manager abort 前 15 分鐘內的孤兒由 cron 下輪補
- cron 未安裝（dev 環境）→ 僅 manager sweep 有效；執行 `bash scripts/worklog-sweep.sh` 可手動補底

### §Manager Sweep

每個 manager 在 `log_end` 前可加 `sweep_my_trace_orphans` step（C4 落地，詳見各 manager `workflow.yaml`）。本節僅 mention，詳細 spec 於 C4 dispatch 落地。

## File Path

```
agents/{team}/{agent}/worklog/{task_id}.json
```

## Dual-Write (Mirror)

When agents are invoked from a directory outside AgentOrg (`CWD ≠ <ROOT>`), worklogs are dual-written:

1. **Primary**: `agents/{team}/{agent}/worklog/{task_id}.json` — inside AgentOrg (for centralized index)
2. **Mirror**: `$CWD/tuq_log/worklogs/{task_id}.json` — in the calling directory (for user visibility)

The mirror is triggered by passing `--mirror-to <path>` to `scripts/worklog.sh`:

```bash
FILE=$(bash scripts/worklog.sh start agent-name model "summary" manager "$TRACE_ID" "$PARENT_TASK_ID" --mirror-to "$TUQ_LOG/worklogs")
```

The `_worklog_helper.py` script handles:
- Creating the mirror directory if needed
- Writing a copy of the worklog JSON to the mirror path on `start`
- Synchronizing `status`, `ended_at`, `duration_seconds`, `output_summary` to the mirror on `end`
- Recording `mirror_path` in the primary JSON for traceability

### tuq_log/ Structure

```
$CWD/tuq_log/
├── .gitignore          # Contains "*" — prevents git tracking
├── worklogs/           # Mirror copies of worklog JSON files
├── output/             # Agent deliverables (reports, analysis)
└── tmp/                # Scratch files (safe to delete)
```

## Distributed Tracing

This system follows OpenTelemetry conventions to link all worklogs from a single Manager task into a queryable execution tree.

### How It Works

1. **Manager** generates a UUID `trace_id` when it starts a top-level task (dispatched_by = "user")
2. **Manager** passes its own `task_id` and the `trace_id` to every dispatched agent via the Worklog Block in the dispatch prompt
3. **Each dispatched agent** records:
   - `trace_id` — the same UUID as the Manager (inherited)
   - `parent_task_id` — the Manager's `task_id` (the immediate dispatcher)
4. This creates a tree: Manager (root) → Worker A, Worker B, Worker C

### Querying the Tree

The `agents/worklogs/index.jsonl` centralized index enables querying all worklogs with the same `trace_id`:

```bash
# Find all worklogs belonging to a single Manager task:
grep '"trace_id": "abc-123"' agents/worklogs/index.jsonl
```

### Example

```
Manager (trace_id=abc-123, task_id=2026-04-14_manager, parent_task_id=null)
  ├─ Developer  (trace_id=abc-123, parent_task_id=2026-04-14_manager)
  ├─ Reviewer   (trace_id=abc-123, parent_task_id=2026-04-14_manager)
  └─ Tester     (trace_id=abc-123, parent_task_id=2026-04-14_manager)
```

### index.jsonl Schema（標準欄位）

每筆 index.jsonl entry 包含 **11 個標準欄位**（與 `_worklog_helper.py` `cmd_end()` 一致）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `agent` | string | Agent 名稱 |
| `task_id` | string | 唯一 ID（timestamp + agent） |
| `status` | string | `success` / `partial` / `failed` |
| `duration_seconds` | number | 執行秒數 |
| `model` | string | `haiku` / `sonnet` / `opus` |
| `started_at` | ISO 8601 | 開始時間 |
| `ended_at` | ISO 8601 | 結束時間 |
| `trace_id` | UUID string | 頂層 Manager 產生，所有 agent 繼承 |
| `parent_task_id` | string or null | 派遣者的 task_id；頂層為 null |
| `input_summary` | string | 任務摘要（一行） |
| `output_summary` | string or null | 產出摘要（一行） |

**Sweep 補寫 entry 額外欄位**（由 sweep 補寫時附加，正常 end 無這兩欄）：

| 欄位 | 型別 | 說明 |
|------|------|------|
| `sweep_coerced` | bool \| null | sweep 補寫時為 `true` |
| `sweep_reason` | string \| null | `"expired_via_expires_at"` / `"expired_via_max_age_fallback"` / `"manager_sweep"` |

sweep 補寫的 entry **必須**含 `sweep_coerced` 與 `sweep_reason` 兩欄，供 dashboard filter 區分自動補寫 vs 正常收尾。

## Instructions for Agents

Every agent punches their own clock using `scripts/worklog.sh`:

```bash
# FIRST action — before starting work (top-level Manager, auto-generates trace_id):
FILE=$(bash scripts/worklog.sh start {agent-name} {model} "{input_summary}" user)

# FIRST action — before starting work (worker dispatched by Manager):
FILE=$(bash scripts/worklog.sh start {agent-name} {model} "{input_summary}" manager "$TRACE_ID" "$PARENT_TASK_ID")

# LAST action — after finishing work (use stdin to avoid $-expansion in summary):
bash scripts/worklog.sh end "$FILE" {success|failed} - <<'EOF'
{output_summary}
EOF
```

Manager 打自己的卡時傳入 "user": FILE=$(bash scripts/worklog.sh start manager opus "..." user)
Manager 派遣 worker 時須在 Worklog Block 中傳入 `$TRACE_ID`（自己的 trace_id）和 `$PARENT_TASK_ID`（自己的 task_id）。

### `worklog.sh start` — `--expires-in-seconds` flag

```bash
bash scripts/worklog.sh start <agent> <model> "<summary>" [<dispatched_by>] [<trace_id>] [<parent_task_id>] \
    [--expires-in-seconds N]
```

- **default**：1800 秒（30 分鐘）；未傳時 `expires_at = started_at + 1800s` 自動寫入
- **長任務 override**（如 researcher 跨多輪）：`--expires-in-seconds 7200`
- **短任務 override**（如 calculator）：`--expires-in-seconds 300`
- 與 `--mirror-to` 同為 named flag，不影響 positional 相容性

Manager includes these instructions in every dispatch prompt. Manager only writes its own Summary Worklog (see Manager-Specific Fields below).

## Manager-Specific Fields

Manager worklog has additional fields beyond the standard schema:

| Field | Type | Description |
|-------|------|-------------|
| `dispatch_summary.total_agents_dispatched` | number | Total agents dispatched in this orchestration |
| `dispatch_summary.rounds` | number | Number of execution rounds |
| `dispatch_summary.models_used` | object | Count of each model tier used |
| `dispatch_summary.agents` | array | Per-agent status, duration, and model |
| `verification_results.worklogs_found` | number | How many agent worklogs were verified |
| `verification_results.artifacts_verified` | number | How many file artifacts were spot-checked |
| `verification_results.spot_checks_passed` | number | How many spot-checks passed |
| `verification_results.issues` | array | Any issues found during verification |

Manager worklog is written by the Manager itself (not dispatched), with `dispatched_by: "user"`.

## Output Summary 內容規範（Worker Handoff Isolation）

> **Origin**：2026-05-01 user-mandated (Tier 3 HITL confirm L1+L2+L3) — 經 worker-handoff-violation-20260501 調查，8 件跨 3 team systemic 違規顯示 worker 在 output_summary 預判下游 agent 是規則缺漏。
> **適用對象**：所有 worker（Manager 自寫的 Summary Worklog 除外，因 Manager 本就掌握 dispatch 全圖）。

### Required Content（必含 — 2026-05-09 補強）

`output_summary` **必須**回答兩個問題：

1. **「我做了什麼」** — 具體動作（建立/修改/分析/驗證 + 對象）
   - ✅「建立 6 檔 agent 結構：agent.yaml/soul.md/...」
   - ❌「完成任務」「按計畫執行」（過於空泛）
2. **「我交付什麼路徑」** — 至少一個絕對或專案相對路徑
   - ✅「報告寫入 `output/agent-ops/xxx/report.md`」
   - ❌「報告已產出」（無路徑無法驗證）

若任務性質純分析無檔案產出，則改為「我發現什麼結論」+ 結論摘要寫在 output_summary 本體。

### Hard Rule

Worker 在 `output_summary`（以及任何對外文字輸出，包含交付報告結語、Markdown 文件結尾等）**不得**：

1. **HARD（嚴禁）— 具名點出另一個 agent 作為下游處置單位**
   - ❌「...完成，**待 Governance 審查**」
   - ❌「...config 已準備好**轉交 platform-security**」
   - ❌「...`delegated to gb10-sysadmin`」
   - ❌「...**送 QA 確認**」「...**給 doc-generator 落地**」「...**待 SW Manager 裁決**」
   - 為什麼：worker 不該認識 sibling/上層 agent 的具名身份；寫此話 = Manager dispatch brief 中 Context 可能洩漏下游 agent name，污染 worker 的純粹性；預判 Manager 的 dispatch 決策（Pick the right agent 是 Manager 職權）

2. **SOFT（應改寫）— 暗示 hand-off 但未具名**
   - ❌「...**待後續處理**」「...**請 manager 後續處理**」「...**待人工複核**」「...**需上報**」
   - 為什麼：worker 仍跨越邊界 — output_summary 應寫「我做了什麼、發現什麼缺口」，不該預判處理路徑或指派 Manager 行動。

### NOT VIOLATION（合規寫法）

以下三類 **不算**違反：

- **(a) 描述自己發現的事實 / 缺口紀錄**：「scope 受限只動 7 檔，剩 1 處未動」「發現 1 處漏網之魚 X，已記錄在報告」「3 項開放問題已附報告」（worker 報自己發現的事實是合規的；只要不指名「請 X agent 處理」即可）
- **(b) 純業務狀態**：「待客戶補件」「待簽約前替換」「待對方 server 回應」（業務世界的真實狀態，非 agent 系統 hand-off）
- **(c) Manager 在 Shared Context Block 告知並行 worker**：並行 dispatch 時 Manager 透過官方 Shared Context Block 告知 worker「另一個 worker 在做 X」（這是 protocol 明文允許的合法資訊流，不是 worker 自己預判）

### BAD / GOOD Examples（取自實證樣本）

| # | BAD（違規）寫法 | GOOD（合規）改寫 |
|---|----------------|-------------------|
| 1 | 「editorial-director 6 檔...完成，**待 Governance 審查**」 | 「editorial-director 6 檔（agent.yaml/soul.md/org.md/tools.md/workflow.yaml/MEMORY.md）+ 4 同步修改完成，所有 Edit 通過 self-review checklist」 |
| 2 | 「方案 C 6 檔修改完成，**待 Governance**」 | 「方案 C 6 檔修改完成（路徑：A/B/C...），diff 已附 `output/.../patch.md`」 |
| 3 | 「Goose config 片段已準備好**轉交 platform-security**」 | 「pdf-to-image-mcp repo 建立完成；Goose config 片段已寫入 `output/.../goose_config_snippet.yaml`」 |
| 4 | 「整合 5 條 content-reviewer minor **給 doc-generator 落地**」 | 「整合 5 條 content-reviewer minor 修訂；最終視覺稿已落地 `output/.../v4_visual.pptx`」 |
| 5 | 「12 項開放問題**待 SW Manager 裁決**」 | 「12 項開放問題已彙整於 `output/.../open_questions.md`，每項附選項與 trade-off」 |

### 落地檢查（Self-Verification）

worker 在打卡（`bash scripts/worklog.sh end`）前，**必須**自我檢查 `output_summary`：
- [ ] 不含具名 agent 名稱（agent-builder、Governance、QA、Reviewer、Tester、Designer、Stylist 等）
- [ ] 不含「待」「請」「轉交」「交給」「pending」「hand-off」「delegated」+ agent 角色詞的組合
- [ ] 只描述「我做了什麼」「我發現什麼」「我交付什麼路徑」

### Quality Warning（worklog 標記，不阻斷）

`worklog.sh end` 寫入時對 `output_summary` 做關鍵字掃描，若命中違規模式：
- 仍寫入 worklog（不阻斷 agent 收工）
- JSON 加 `quality_warning: "hand_off_predicted"` 欄位
- stderr 印 warning 提示 agent 下次改寫

掃描關鍵字（命中即標記）：「待 [A-Z][a-z]+」「轉交」「交給」「請 manager」「送 QA」「pending review」「delegated to」「hand-off to」等。

當 `quality_warning` 觸發時，`worklog.sh` 額外寫入延伸欄位：

- `warning_keywords: [...]`（陣列，列出本次 output_summary 實際命中之關鍵字，供 governance / researcher 回溯違規詞彙樣態；未命中時欄位可省略）

此欄位由 code 加碼，protocol 在此補上規範：scan 邏輯應記錄所有命中項（去重後保留原樣字串），不只記第一個。

governance / agent-ops researcher 可定期 grep `quality_warning` 欄位產生違規 trend report 回饋給對應 agent owner。

### Cross-References

- Manager 端對應規範：見各 Manager `dispatch-protocol.md` / `dispatch-flow.md` §4 Task Block — Context 欄位禁止洩漏下游 agent 名稱
- Worker 端對應規範：每個 worker `soul.md` Anti-patterns 區段含「不在 output_summary 點名下游 agent」條目
- 起源文件：`output/agent-ops/worker-handoff-violation-20260501/final_report.md`（task_id: worker-handoff-violation-20260501）

## 2026-05-09 — Heartbeat + Status Vocab + Output Summary（self-growth-followup）

整合三項跨 team 系統性問題（task_id: self-growth-followup-20260509，trace_id: 42050260-2c98-404c-a70f-18ffea897113）：

- **F2 Heartbeat / Orphan Detection** — 新增 §Heartbeat 章節定義 24h orphan、agent 端 finally 收尾、可選 heartbeat 子命令、`worklog-report.sh --orphans` 運維指令
- **F3 Status Vocabulary 標準化** — 新增 §Status Vocabulary 章節限定 3 值 `success` / `partial` / `failed`，legacy 值由 `worklog.sh` 自動 coerce + warn，原值寫入 `coerced_status` 欄位
- **F4 Output Summary 必含/品質警告** — 既有「Output Summary 內容規範」補上 §Required Content（必含「我做了什麼」「我交付什麼路徑」）+ §Quality Warning（worklog 寫入時掃描違規關鍵字標 `quality_warning: hand_off_predicted`，不阻斷）

後續 rule-rollout：
1. `worklog.sh` 實作 status coerce + heartbeat 子命令 + quality_warning 掃描（另路 task）
2. `worklog-report.sh --orphans` flag 實作（另路 task）
3. 各 agent `workflow.yaml` 加 `finally_log_end` 步驟（per-team 評估）
4. governance 加每日 orphan / quality_warning 巡檢任務

---

## Cross-reference (added Phase 1D)

- **取代文件**: `agents/agent-ops/_protocols/punch-protocol.md`（Phase 1A 2026-05-27 落地）
- **正式廢棄時程**: Phase 5（規劃中，當所有 71 agent 完成 Phase 2/3 改寫後）
- **並存期語意**: fallback only — 當 TeamUQ PUNCH-IN/OUT 因 Skip+warn 條件觸發時使用
- **Migration owner**: agent-ops/manager
- **Phase tracker**: `agents/agent-ops/manager/memory/punch_migration_state_20260527.md`
