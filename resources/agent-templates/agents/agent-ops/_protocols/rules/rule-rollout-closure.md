---
name: rule-rollout-closure
description: 政策推送後的「收尾 closure」強制步驟，防止「規則寫了但沒落地」的失效模式
type: protocol
priority: MANDATORY
date: 2026-05-01
source: Gov-C P0+P1 haiku-audit-20260501 retrospective
scope: agent-ops team-local — 凡 agents/agent-ops/ 內的規則推送必須遵守（全系統版見 agents/protocols/rules/rule-rollout-closure.md）
---

# Rule Rollout Closure Protocol

## Purpose

規範政策（policy / rule）推送後的「收尾 closure」步驟，避免「規則寫了但沒落地」的失效模式。

**歷史根因**：2026-04-27 ban haiku 第一次 rollout 只改 `agent.yaml`，未擴散至 `tools.md`、`org.md`、Manager skills.md、SKILL.md 等 Tier 2/3/4 文件，导致 Governance 第一輪審查標出殘留，但未觸發第二輪 Builder 修補，造成 rollout 實際未完成即被視為完成。完整事件紀錄：`agent-ops/manager/memory/retrospective_haiku_rollout_round2_2026-05-01.md`。

---

## 適用情境

任何跨 team / 跨 agent 的規則推送，包含但不限於：

| 類型 | 範例 |
|------|------|
| 模型 ban policy | ban haiku、棄用某 model |
| 工具 ban policy | ban PowerShell tool、限制 shell 指令集 |
| soul.md Principle 新增 / 修訂 | 新增 P22 任務粒度拆解 |
| protocol 新增 / 修訂 | 本文件本身上線時也適用 |
| dispatch reference 結構變更 | 新增 Tier、重命名欄位 |
| 全系統 schema 變更 | `agent.yaml` 新增必填欄位 |

---

## Closure 必做四步

### Step 1 — Identify Dispatch Reference 文件清單

依 `agents/agent-ops/_protocols/rules/manager-dispatch-source.md` 枚舉所有需同步的檔案，按 Tier 1 → Tier 4 逐層掃描，**不得跳過任何 Tier**。

```
Tier 1：<agent>/agent.yaml（dispatch.model / trigger / not_for）
Tier 2：<manager>/tools.md、org.md、skills.md、workflow.yaml、workflow/*.md
Tier 3：skills/tuq*/SKILL.md、<worker>/README.md
Tier 4：CLAUDE.md、agents/agent-ops/_protocols/definitions.md
```

輸出格式（在 Manager worklog 記錄）：
```
[CLOSURE-STEP1] 受影響檔案清單：
  Tier1: N 檔  Tier2: N 檔  Tier3: N 檔  Tier4: N 檔
  總計: N 檔（估計 Edit 數: N，建議 Batch 數: ⌈N/5⌉）
```

### Step 2 — Bulk Update（Builder 多 Batch 並行）

- **每 batch ≤ 5 個 Edit**，嚴格執行（參見歷史根因：大 batch 容易漏改）
- Manager 預先切分 Batch 清單，一次 dispatch 多個並行 Builder sub-agent
- 每個 Builder 完成後**自報修改清單 + line count**

```yaml
# 範例 Batch 切分（ban haiku 案例，Tier 2 共 18 檔 → 4 batch）
Batch-A: sw/manager tools.md, org.md, skills.md, workflow.yaml, workflow/dispatch-flow.md
Batch-B: edu/manager tools.md, org.md, skills.md, workflow.yaml, workflow/dispatch-flow.md
Batch-C: bni/manager tools.md, org.md, sales/manager tools.md, org.md
Batch-D: agent-ops/manager skills.md, finance/manager tools.md, org.md ...
```

### Step 3 — Independent Verification（Manager 獨立驗收）

Builder 完成自報後，Manager **必須**用 Grep/Glob 工具獨立確認 filesystem 實際狀態，**不得只憑 Builder 自報視為完成**。

驗收腳本邏輯（以 ban haiku 為例）：
```bash
# 僅掃 agents/agent-ops/ 內的違禁 pattern（team-local 範圍）
bash scripts/nightly_policy_grep.sh --path agents/agent-ops/
# 若 exit code != 0 → 有殘留，回派 Builder 補修
```

Manager 須在自身 worklog 記錄：
```
[CLOSURE-STEP3] Grep 驗收結果：
  violations: 0  （或列出殘留檔案）
  verdict: PASS / FAIL
```

### Step 4 — Governance Closure Check（Governance 最終簽核）

- Governance agent 執行 `scripts/nightly_policy_grep.sh --path agents/agent-ops/`，掃描 `banned-patterns.json` 所列全部 pattern（僅限 agent-ops team 範圍）
- **所有 rule exit 0** 才視為 rollout 完成，允許在 governance worklog 記錄「CLOSURE: CONFIRMED」
- 任何 violation → Governance 回報 Manager，**禁止宣判 PASS**，Manager 必須觸發第 N+1 輪 Builder 修補

```
[CLOSURE-STEP4] Governance 簽核：
  script: scripts/nightly_policy_grep.sh
  exit_code: 0
  verdict: CLOSURE CONFIRMED  ← 此行寫入後 rollout 才正式結束
```

---

## 失敗模式（歷史教訓）

### 失敗模式 A：只改 Tier 1，遺漏 Tier 2/3/4

- **發生時間**：2026-04-27（ban haiku 第一次 rollout）
- **根因**：未依 `manager-dispatch-source.md` 枚舉清單，只改 `agent.yaml` 即認為完成
- **後果**：全系統 20+ 個 `model: haiku` 殘留，Governance 第一輪審查標出但未觸發修補，rollout 事實上未完成
- **教訓**：Step 1 的清單枚舉是強制的，不能靠「大致知道哪些要改」取代

### 失敗模式 B：Governance 審查後未派 Builder 第二輪

- **發生時間**：2026-04-27 → 2026-05-01 之間
- **根因**：Governance workflow 無 `rollout_closure_check` step，發現 violation 後只記錄在報告，未強制回派
- **後果**：P0 殘留跨越多天未修補
- **教訓**：Governance workflow.yaml 加入 `rollout_closure_check` step（已於 2026-05-01 完成）

### 失敗模式 C：Builder 自報但 Manager 未獨立驗證

- **一般風險**：Builder 可能漏改而自報「完成」，Manager 若不驗證則失效
- **教訓**：Step 3 是 Manager 自身義務，不可省略

### 失敗模式 D：banned-patterns.json 未同步更新

- **一般風險**：新政策上線但 `banned-patterns.json` 未加對應 rule，`nightly_policy_grep.sh` 等於未 gate 新政策
- **教訓**：Step 1 枚舉清單必須包含 `banned-patterns.json` 的更新

---

## 自動化機制

| 機制 | 路徑 | 觸發方式 |
|------|------|----------|
| 夜間 Grep Gate | `scripts/nightly_policy_grep.sh` | Windows Task Scheduler 每日 02:00 |
| Rule 庫 | `agents/agent-ops/_protocols/rules/banned-patterns.json` | 新政策上線時同步追加 rule |
| Pre-push Hook | `.git/hooks/pre-push` | 呼叫同 script 即時 gate |
| Governance Closure Step | `governance/workflow.yaml` step `rollout_closure_check` | Governance 每次執行時自動觸發 |

新政策上線**必須**同步執行：
1. 寫 policy 文件（如 `no-haiku-policy.md`）
2. 在 `banned-patterns.json` 加對應 rule
3. 跑 `scripts/nightly_policy_grep.sh` 驗證 rule 有效
4. 執行本 closure 四步

---

## Rollout 完成判定標準

以下全部滿足，rollout 才視為正式完成：

- [ ] Step 1 清單已輸出並記錄（含 Tier 1~4 檔案數）
- [ ] Step 2 全部 Batch Edit 已完成（每 batch ≤ 5）
- [ ] Step 3 Manager 獨立 Grep 驗收 exit 0
- [ ] Step 4 Governance 在 worklog 記錄「CLOSURE CONFIRMED」
- [ ] `banned-patterns.json` 已更新對應 rule
- [ ] 本次 rollout 記錄追加至 `rule-rollout.md` 末尾的「歷史推送紀錄」

---

## Open-TODO Aging SLO

> 新增 2026-05-27 self-growth-20260527。**根因**：上述四步只規範「policy rollout 何時算完成」，卻不管「掛在 Manager `MEMORY.md` Open TODOs 表的條目隨時間殭屍化」。實際發生過 `rollout_closure_check` step 與本 protocol 早已落地，但 MEMORY 仍標 `open`（殭屍 open），因為「closure 機制存在，但結案動作沒人觸發」。本節補上 aging 觸發器，把「結案動作」錨定到 Manager retro。

### 適用對象

各 Manager `memory/MEMORY.md` 的「Open TODOs」表（含 `open` / `partial` / `scheduled` 等未結案狀態）。

### SLO 定義

| 項目 | 規範 |
|------|------|
| Aging 門檻 | 任一 open TODO 自登記日起 **超過 30 天**未結案，即視為「超齡 (aged)」 |
| 觸發點 | 每次 Manager retro（`memory_check` / `memory_hygiene_check` step）必須掃描 Open TODOs 表 surface 所有超齡項 |
| 強制動作 | 對超齡項**至少推進 1 條**，且須落入以下三種終局之一，不得無限掛 `open`：<br>① **done**（已驗證完成 — 必先 grep/read 對應檔案存在才標，禁止憑空結案）<br>② **重新指派**（換負責 agent / 調整優先級並更新「負責」欄）<br>③ **明確 abandon**（標 `abandoned` + 一句理由，移入 Archived 區） |
| 殭屍 open 偵測 | 若超齡項對應的交付物 grep/read 證實**已存在**（如 protocol 檔已建、workflow step 已加），屬「殭屍 open」，立即標 done 並註明 `verified by <trace>` |

### 與四步 closure 的關係

四步 closure 管「rollout 推送的橫向擴散完整性」（Tier 1~4 是否都改到）；Aging SLO 管「open TODO 的縱向時間結案」。兩者互補：rollout 完成判定（§Rollout 完成判定標準）負責「新規則有沒有落地」，Aging SLO 負責「落地後的待辦有沒有被結掉」。

### 落地錨點

- Manager `workflow.yaml` 的 `memory_check` / `memory_hygiene_check` step note 引用本節，要求 retro 時至少推進/結案 1 條超齡項。
- **不**新增 soul.md Principle（避免 soul 再膨脹）；以 workflow note + 本 protocol 節為唯一落地點。

---

## 參考

- `agents/agent-ops/_protocols/rules/manager-dispatch-source.md` — Tier 1~4 dispatch reference 清單（Step 1 的依據）
- `agents/agent-ops/_protocols/rules/no-haiku-policy.md` — 範例政策（ban haiku 事件的主角）
- `agents/agent-ops/_protocols/rules/rule-rollout.md` — 規則推送協議（bulk-update 流程）
- `agents/agent-ops/_protocols/rules/rollback-sop.md` — 若 rollout 引入錯誤的回滾 SOP
- `scripts/nightly_policy_grep.sh` — 自動化 grep gate（Step 3 & Step 4 工具）
- `scripts/README_policy_grep.md` — 部署文件（Task Scheduler 設定說明）
- `agents/agent-ops/_protocols/rules/banned-patterns.json` — Rule 庫（所有 banned pattern 的 ground truth）
- `agents/agent-ops/governance/workflow.yaml` — Governance 的 `rollout_closure_check` step
