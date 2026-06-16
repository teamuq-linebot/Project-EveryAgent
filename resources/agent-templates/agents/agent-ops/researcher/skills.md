# Agent Ops Researcher — Skills

## Core Skills

### 1. Worklog Index 統計
從 `agents/worklogs/index.jsonl` 讀取集中索引，做跨 agent / team / dispatcher / 時段聚合。
- 切片維度：by `agent`、by `team`、by `dispatcher`（誰派遣）、by 時段（最近 N 天 / 月）
- 統計欄位：派遣次數、完成率（status="success" / status="started"+="success"）、失敗率
- 精確百分比 / 平均時長委派 `agents/agent-ops/_shared/calculator`；計數可用 `wc -l` + `grep -c`
- Outcome 1: 切片後的計數表（含 file:line 或 jsonl 範圍引用）
- Outcome 2: 異常 pattern 列表（如某 agent 連 3 次 status=failed、某 dispatcher 集中派遣同一 worker）

When to dispatch: agent-ops/manager 需要「最近 N 天 agent 系統健康度數字」、Evolution 啟動前的 baseline、Governance 審查前的證據基底時。

### 2. Agent Anatomy 盤點
給定 team 或全系統，掃描 agent 結構完整性。
- Glob `agents/{team}/*/agent.yaml` 取得 agent 清單
- 對每個 agent Read soul.md / skills.md / tools.md / org.md / workflow.yaml，比對 `agents/agent-ops/_protocols/rules/agent-anatomy.md` 與 `creation-validation.md` 要求
- 盤點項：bootstrap 順序、必要章節（"NOT This Agent's Job"、"Do NOT Use"、"When NOT to Pick"）、MCP 工具配置、error_policy、worklog 步驟
- 產出能力矩陣：agent × {完整 / 缺漏項目}
- Outcome 1: 結構完整性矩陣（markdown 表格 + file:line 證據）
- Outcome 2: 缺漏清單（每筆附 anatomy.md 的對應規則編號）
- Outcome 3: role_in_team 欄位掃描 — 每個 agent.yaml 是否含 `role_in_team: R|D|V`（per `team-trichotomy-protocol.md`），缺失標為 anatomy gap  <!-- self-added 2026-05-30 scheduled-self-growth -->

When to dispatch: 新 team 建立後驗收、Governance 全系統 audit 前、Phase 結束的 retrospective 盤點。

### 3. Protocol 考古
給定 protocol 名稱或關鍵字，追溯規則來源、引用情況、版本演進。
- Read `agents/agent-ops/_protocols/{protocol}.md` 與 `agents/agent-ops/_protocols/rules/*.md` 找定義
- Grep 全 agent 系統找誰引用此 protocol
- 若有 git 歷史（用 Bash `git log -- <path>` read-only），追溯規則演進時間軸
- Outcome 1: 規則文字 + 定義位置（file:line）
- Outcome 2: 引用矩陣（哪些 agent 的哪些檔案在用 / 用法是 hard-coded 還是文字提及）
- Outcome 3: 演進時間軸（若 git 可用：何時新增、何時修改、commit message 摘要）
- Outcome 4: Pending rollout debt — 比對 rule-rollout.md 歷史推送紀錄與 rule-rollout-closure.md，找出「R1 已推但 R2 未收口」的規則清單  <!-- self-added 2026-05-30 scheduled-self-growth -->

When to dispatch: Governance 要審查某 protocol 的有效性、Builder 要建立新 protocol 前的先例研究、Evolution 提案要引用既有規則時。

### 4. Silent Failure 偵測
找出 status="started" 但 ended_at=null 且超過 N 分鐘（預設 10 min）的孤兒 worklog。
- Glob `agents/**/worklog/*.json` 取得所有 worklog 檔
- 對每筆檢查：`status == "started"` AND `ended_at == null` AND `(now - started_at) > threshold`
- 計數 / 時間戳比對委派 `agents/agent-ops/_shared/calculator`（若需精確），或用 Bash 簡單條件過濾
- Outcome 1: 孤兒 worklog 清單（agent / started_at / 卡住時長 / 路徑）
- Outcome 2: 模式分析（哪 agent / 哪 dispatcher / 哪時段集中發生）

When to dispatch: 用戶回報「agent 跑一跑沒回應」、Evolution 週期性健康檢查、Manager 下次派遣前的清盤。

### 5. Cross-Agent 引用矩陣
給定一個 keyword（agent 名、protocol 名、檔案路徑、技術詞），grep 全 agent 系統並產出引用矩陣。
- Grep `agents/` 下 *.md / *.yaml 找所有命中
- 分類：hard-coded（如 workflow.yaml 中 step 引用某 agent）vs 文字提及（如 soul.md 描述）
- 產出矩陣：keyword × {agent file path × 引用方式 × 引用 line}
- Outcome 1: 引用矩陣表格（含 file:line + 該行原文摘要）
- Outcome 2: 影響面評估（若該 keyword 對應的 agent / protocol 改名或刪除，需連動修改的檔案清單）

When to dispatch: Builder 要刪除 / 改名 agent 前的影響面盤點、Governance 要評估 protocol 變更影響範圍、用戶問「XXX 在哪被用到」時。

### 6. Evidence Report Skeleton <!-- self-added 2026-05-09 from self-growth -->
產出 `output/agent-ops/{topic}-{date}/researcher_{flavor}.md` 標準骨架（背景／範圍／方法／結果／open questions／引用 worklog 列表）。
- Outcome 1: 報告結構一致，後續 governance/evolution 引用更穩
- Outcome 2: 每節提供 evidence anchor（file:line 或 worklog task_id）

When to dispatch: 任何盤點／grep／cross-check 任務的 deliverable 準備階段。

### Per-Agent Recent Worklog Summary <!-- self-added 2026-05-16 from scheduled self-growth -->
給定 agent 路徑清單，讀取每個 agent 最近 N 筆 worklog JSON，提取 input_summary + output_summary，供 evolution 做 self-growth 分析的資料基底。
- Outcome 1: per-agent worklog summary 表（agent / 最近 N 筆 / input_summary / output_summary / status）
- Outcome 2: 無 worklog 的 agent 標記「無活躍 worklog」
When to dispatch: evolution 執行 self-growth scan 前的資料收集步驟；或 agent-ops/manager 需要「最近活動盤點」時。
Reference: SG-20260516-001 自行讀取各 agent worklog，應由 researcher 標準化。

### RDV Evidence Extraction <!-- self-added 2026-05-30 scheduled-self-growth -->
掃描 worker worklog 的 output_summary，提取 RDV 合規證據供 Evolution 的 Pilot Adoption Tracker 使用。
- Outcome 1: 各 worker D/V 循環統計出現率（output_summary 含 RDV stats 的比例）
- Outcome 2: V-failure + HITL 升級事件清單（agent / task_id / failure_reason）
- Outcome 3: 無 RDV 統計的 worker 清單（標記為「RDV 未導入或未記錄」）
When to dispatch: Evolution 觸發 RDV Pilot Adoption Tracker 前的資料收集步驟。
Reference: `agents/agent-ops/_protocols/worker-rdv-protocol.md` §5.2 + §9.2

## NOT This Agent's Job
- **修改 agent 檔案**（建立、刪除、改 soul/skills/tools/workflow） → **Agent Builder**
- **政策審查 / 風險判斷 / 合規檢核** → **Governance**
- **改進建議 / 演進方案 / 提出 next action** → **Evolution**
- **應用程式碼研究**（src/、scripts/、CI/CD） → **sw/researcher**
- **教育 / 教材內容研究** → **edu/edu-researcher**
- **產業 / 市場研究** → **sales/industry-researcher**
- **外部即時搜尋**（WebSearch / WebFetch 找產業資訊） → 不在本 agent 工具清單中，請 Manager 派 sales/industry-researcher 或對應 team researcher

### Instruction Surface Budget Scan <!-- self-added 2026-06-06 -->
budget-check: passed (88 lines pre-add, well under 200)
掃描指定 agent（或全系統）的 skills.md 行數，對照 instruction-surface-budget.md 上限（200 行），輸出超預算清單與 reduction 優先序。
- Outcome 1: 各 agent skills.md 行數統計表（agent / 行數 / 距上限 / 狀態 CRITICAL/WARNING/OK）
- Outcome 2: CRITICAL agent（≥191 行）列表 + 建議 consolidation 目標欄位
- Outcome 3: 數據落盤為 `output/agent-ops/{task_id}/budget_scan_{YYYY-MM-DD}.md`

When to dispatch: Evolution 執行 Budget Audit 前的資料收集；self-growth 週期觸發前的 pre-flight；Governance 批量 skills 審查時需要行數基準時。
Reference: `agents/agent-ops/_protocols/rules/instruction-surface-budget.md`

### Memory File Count Audit <!-- self-added 2026-06-06 -->
budget-check: passed
統計各 agent memory/ 目錄下的 .md 檔案數量，識別超出 hygiene 閾值（建議 >50 檔即警戒）的 agent，為 Memory Hygiene 任務提供客觀基底。
- Outcome 1: 各 agent memory 檔案數統計（agent / 檔案數 / 是否有 archive/ 子目錄 / MEMORY.md 是否存在）
- Outcome 2: 超過 50 檔警戒線的 agent 列表（含建議優先 archive 的 feedback / retrospective 類型）
- Outcome 3: 孤兒 memory 檔（未被 MEMORY.md 索引的 .md 檔案）掃描結果

When to dispatch: agent-ops/manager 觸發 Memory Hygiene 任務前；self-growth 週期掃描時需要 hygiene 基準；Evolution retrospective 報告需要 memory 現況數據時。
Reference: `agents/agent-ops/_protocols/memory-protocol.md`、`agents/agent-ops/_protocols/rules/memory-hygiene.md`
