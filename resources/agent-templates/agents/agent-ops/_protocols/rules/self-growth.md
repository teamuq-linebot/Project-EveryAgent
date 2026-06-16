# Self-Growth Protocol

## 1. 設計原則
Agent 可以透過「反思 → 提案 → 核准 → 應用」的閉環實現自我改進。
遵守 Cardinal Rule：加法自己來，減法和擴權要審批。

## 2. 觸發條件（四選一即觸發）
| 觸發類型 | 條件 | 說明 |
|---------|------|------|
| 任務計數 | 每完成 10 次任務 | 從 worklog 統計 |
| 失敗觸發 | 當次任務 status = failed | 立即反思 |
| 使用者糾正 | 使用者指出錯誤 | 記錄並反思 |
| scheduled cron | 每週六上午 9:00（用戶設置的 Claude Code scheduled task）| 自動全系統 self-growth 掃描，觸發來源：`/tuq-agent 請為每一個 agents 做自我成長`（self-added 2026-05-13）|

## 3. 自我反思流程（Retrospective Loop）

### Phase 0: Eligibility Check（前置篩選）<!-- self-added 2026-04-26 -->
在對任何 agent 執行 self-growth 分析之前，先確認其 eligibility：

1. 若 agent 目錄下存在 `notes.md`，讀取其 frontmatter
2. 若 frontmatter 包含 `self_growth_eligible: false`，則**跳過**此 agent 的所有 self-growth 步驟
3. 記錄跳過的 agent（在 dispatch 報告中列出 `skipped_agents`）

**適用案例：** `agents/paperclip-imported/*/notes.md` 的 5 個 agent 均標記 `self_growth_eligible: false`，Evolution 執行 self-growth scan 時應自動跳過這些 agent。

### Step 1: 收集數據
- 讀取 L2 / 月度 digest ＋ log-protocol §6.2 組織健康指標（worklog 已於 2026-05-28 移除，改吃 log 層）<!-- self-added 2026-06-07 phase3-org-review -->
  - per-agent 反思：讀該 agent 自上次反思以來的 digest 區段（events / outcomes / 重複失敗）
  - 【月度全系統 scan 限定】另讀 `agents/_log/digest/monthly/{YYYY-MM}.md` ＋ log §6.2 指標（精確值委派 `agents/agent-ops/_shared/calculator`）
- 統計：completed 率、平均 duration、failed 任務的 input 摘要（皆從 digest 聚合，不重掃 raw log）
- **若無 log 資料**（digest 不存在 / 指標全空）→ 報告標「資料不足，本月略過組織提案」→ no-op 退出（休眠分支，依 §8 禁止無證據提案）

### Step 2: 識別模式
- 是否有反覆出現的 failed 任務類型？
- 是否有特定任務耗時異常（> 2x 平均）？
- 是否有使用者糾正紀錄？

**【月度全系統 scan 限定】組織層模式（多帶一頂「組織帽子」，per-agent 維度不變）** <!-- self-added 2026-06-07 phase3-org-review -->
同一次月度 scan 在 per-agent 模式之外，額外識別系統組織層模式（指標來源：log §6.2，由 `p3-org-metrics-spec.md` 腳本算，精確值委派 calculator）：
- **(a) 裁閒置 / 過勞**：worker 使用率清單 → 長期 0 = 裁撤候選；異常高 = 過勞 / 拆分候選
- **(b) 能力缺口**：既有 skills gap 分析（接週檢討確認的升級提名）→ 長新角色候選
- **分工正確性**：dispatch 落點 vs scope；feedback 落對率（target ≠ 收回饋 manager 卻沒進 worker incoming/ = 落錯）
- **manager 派活比**：每 manager 真派活 vs 自己下海的比例 → 偏低 = 「自己下海太多」提醒
- **長期 memory 瘦身**：觸發既有月度 hygiene（與 monthly-rollup §3.4 共用同一瘦身，**不重跑**；importance==5 豁免、只標不刪）

### Step 3: 提出改進
每個改進點必須有：
- 問題描述（引用具體證據：digest 區段 / log §6.2 指標 / task 紀錄）
- 改進方向
- 預期效果

**【月度全系統 scan 限定】組織層提案** <!-- self-added 2026-06-07 phase3-org-review -->
依 Step 2 的組織層模式，額外產出系統組織提案（用 §7 提案模板）：裁 / 併 / 長新角色 / 調分工。
- 提案永遠是**分析，不改檔**；改組織的執行由 Agent Builder 在 HITL 後進行。
- 組織提案分類於 Step 5 處理（一律走 §5 審批 = Tier 3 HITL）。

### Step 4: Budget Check & Reduction Proposal（self-added 2026-05-13）

每次提出 self-growth 改進前，**必須檢查 instruction surface budget**：

1. **量化現況**：對目標 agent 取下列數字：
   - `wc -l` soul.md、MEMORY.md、skills.md
   - count `^- ` / `^### ` 條目數（依檔案類型）
   - 對照 `agents/agent-ops/_protocols/rules/instruction-surface-budget.md` §2 預算上限

2. **預算評估**：
   - 若目標檔案**未達**警戒上限 → 改進可直接加法（依 §4 免審批範圍）
   - 若**已達**警戒上限 → 必須**同步提出 reduction 提案**（合併同主題條目 / 降級為 protocol reference / 移歷史條目到 archive/），不得單純加法
   - 若**已過硬上限** → 加法**不允許**，必先 reduce 到上限以下才能再加

3. **加法時的同步義務**（依 instruction-surface-budget.md §5）：
   - 新 self-added 條目註解中標明：「budget-check: passed | warning | over-limit」
   - 若 warning 或 over-limit，附 reduction 提案 ID

**Why this step exists**：self-growth 原設計只有加法、無減法評估，導致 instruction surface 半年累積過載（2026-05-12 用戶反饋「Claude 忽略指令頻率上升」事件起源）。本 step 把減法評估內建在每次成長動作中，自然平衡加減。

**Reference**：`agents/agent-ops/_protocols/rules/instruction-surface-budget.md`

### Step 5: 分類執行
- 免審批 → 直接執行（見第 4 節）
- 需審批 → 提案給 Agent Builder + Governance（見第 5 節）
- **【月度組織層提案】一律走 §5 審批 = Tier 3 HITL** <!-- self-added 2026-06-07 phase3-org-review -->
  - 凡「改組織」動作（建 / 廢 agent、改 soul、改 protocol）均屬 Tier 3：標記後交 `agents/agent-ops/manager`，由 Manager 帶用戶 HITL（嚴格 token：confirm / abort / modify）後，方由 Agent Builder 執行。
  - Evolution **不自行執行**任何改組織動作（只提案）；加法類組織調整（調參 / 補 skill）仍依第 4 節自走。

### Step 6: 記錄反思
存入 agents/{team}/{agent}/memory/retrospective-{YYYY-MM-DD}.md
- **【月度全系統 scan 限定】另產系統組織檢討報告** `agents/agent-ops/evolution/memory/org-review-{YYYY-MM}.md`（6 維分析 + 證據 + 組織提案清單）<!-- self-added 2026-06-07 phase3-org-review -->

> **Phase 3 併入說明（不重造排程）**：每月系統組織檢討 = 在本既有月度 self-growth scan 流程內**新增「組織層分析」維度**（Step 1 改吃 log 層、Step 2/3 月度限定組織模式與提案、Step 5 組織提案走 Tier 3、Step 6 另產 org-review），**不新建獨立月度 cron 或 flow 排程殼**。同一次掃描既做 per-agent skills gap（既有），又做系統組織健康（新增）。團隊級輕量對應見 `agents/agent-ops/_protocols/workflows/weekly-team-review-flow.md`。

## 4. 可自行改進的範圍（免審批）
遵循 definitions.md Self-Update Rules：
- 新增 skill 到 skills.md — 標記 <!-- self-added {date} -->
- 新增 workflow step 到 workflow.yaml — 標記 # self-added {date}
- 新增/更新 memory/ 中的記憶
- 移動「已 done / 已 superseded」歷史條目到 `memory/archive/` — 純位置變更不刪內容，不需審批（self-added 2026-05-13）
- 合併**同主題且同來源** self-added 條目並保留歷史 ID 引用 — 不需審批（self-added 2026-05-13）
- 跨主題或跨來源合併 → 升為 §5 審批

## 5. 需要審批的改進
提交給 Agent Builder + Governance：
- 修改現有 soul.md 原則
- 修改 tools.md
- 刪除現有 skills
- 修改或刪除現有 workflow steps

### 提案格式
（見下方模板）

## 6. 成長指標（以 worklog 數據衡量）
| 指標 | 計算方式 | 目標方向 |
|------|---------|---------|
| 任務完成率 | completed / total | ↑ 升高 |
| 平均耗時 | avg(duration_seconds) | ↓ 降低 |
| 失敗恢復率 | recovered / total_failures | ↑ 升高 |
| 技能覆蓋度 | skills used / skills requested | ↑ 升高 |

## 7. 提案模板

---
type: self-growth-proposal
agent: {agent-name}
date: {YYYY-MM-DD}
trigger: task_count | failure | user_correction
evidence: [worklog task_ids]
---

### 問題描述
{具體描述，引用 worklog 數據}

### 改進方案
{改什麼、怎麼改}

### 預期效果
{可量化的改進指標}

### 影響範圍
{影響哪些其他 agent 或流程}

## 8. 禁止行為
- 在沒有 worklog 證據的情況下提案
- 將一次性反饋擴大為系統性改進
- 繞過審批直接修改受保護檔案

## 9. 與現有協議的關係
- 引用 definitions.md §Self-Update Rules
- 引用 memory-protocol.md（反思記錄格式）
- 引用 worklog-protocol.md（觸發計數來源）
- 引用 evolution-protocol.md（需 Agent Builder 的改進路徑）
