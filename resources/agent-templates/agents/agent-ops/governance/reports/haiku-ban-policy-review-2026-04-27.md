# Haiku Ban Policy Governance Review

**Reviewer**: agent-ops/governance
**Date**: 2026-04-27
**Trace**: rule-rollout: feedback_no_haiku_default_sonnet_or_opus
**Scope**: 用戶 2026-04-27「另外都不要 haiku，統一使用 sonnet 或 opus」全系統規則 + Tier 3 變更（soul.md, checklist.md）

---

## Decision: **CONDITIONAL APPROVE**

Tier 3 兩處變更（soul.md anti-pattern + agent-builder checklist）**內容正確、符合用戶意圖、可立即生效**。

但 **bulk update 嚴重不完整**：規則文檔宣稱已修 11 處，實際全系統仍有 **15+ 處活檔案 / 2 處 protocol 仍含 `model: haiku`**，違反 Principle 18「規則推送不落地不算完」。

> Tier 3 文字變更 **APPROVE**，但整個 rule-rollout 必須繼續推進至完整落地才能結案。Governance 不放行「規則寫了但系統一半 agent 仍用 haiku」這種半成品狀態。

---

## A. 規則合理性

- [x] **用戶明確 ack**：source 欄位記錄為「用戶 2026-04-27『另外都不要 haiku，統一使用 sonnet 或 opus』」原話引用，符合 Tier 1 Mandatory 條件
- [x] **規則範圍清楚**：scope = 全 team（agent-ops / edu / sales / finance / bni / sw / agent-training / shared），例外條款明確（目前無例外，需用戶 ack + Governance Tier 3 審才能新增例外）
- [⚠] **與既有規則衝突**：發現衝突 — `agents/agent-ops/_protocols/evaluation-protocol.md:80-90` 仍保留「Haiku Eligibility（降用 haiku 的唯一條件）」整段，明列 `agents/agent-ops/_shared/intent`、`agents/agent-ops/_shared/calculator`、`*/doc-generator`、`test-agent` 為「保留 haiku」白名單。**這直接與新規則矛盾**，必須一併刪除或改寫為「廢止：2026-04-27 全系統 ban haiku」
- [⚠] `agents/agent-ops/_protocols/definitions.md:233` agent.yaml schema 範本仍寫 `model: haiku | sonnet | opus`，需移除 haiku 選項

**結論**：規則本身合理且有用戶授權，但**規則文檔未完成 protocol 層 propagation**，存在邏輯矛盾源。

---

## B. 變更執行品質

### Tier 3 兩處變更逐項驗證

| 變更 | 檔案 | 結果 |
|-----|------|------|
| 1 | `agent-ops/manager/soul.md:77` anti-pattern 改寫 | ✅ 已落地，文字準確（含日期+來源標註） |
| 2 | `agent-ops/agent-builder/workflow/checklist.md:13` haiku 禁用 | ✅ 已落地，標註 `2026-04-27 user policy` |

兩處 Tier 3 文字變更品質合格。

### bulk update 覆蓋率

- [❌] **未覆蓋所有命中位置**：以下為未處理的活檔案 `model: haiku` 殘留（已排除 `.bak.*` 備份檔與 worklog 歷史紀錄）：

| # | 檔案 | 行 | 狀態 |
|---|------|----|------|
| 1 | `agents/agent-ops/_shared/intent/agent.yaml` | 16 | 活檔，違反規則 |
| 2 | `agents/agent-ops/_shared/intent/README.md` | 15 | 文檔說明仍寫 haiku |
| 3 | `agents/agent-ops/_shared/calculator/agent.yaml` | 16 | 活檔，違反規則 |
| 4 | `finance/billing-renderer/agent.yaml` | 16 | 活檔，違反規則 |
| 5 | `sales/doc-generator/agent.yaml` | 16 | 活檔，違反規則 |
| 6 | `bni/doc-generator/agent.yaml` | 16 | 活檔，違反規則 |
| 7 | `test-agent/agent.yaml` | 16 | 活檔，違反規則 |
| 8 | `sales/manager/workflow.yaml` | 31 | classify step 仍用 haiku |
| 9 | `sw/manager/workflow.yaml` | 34 | classify step 仍用 haiku |
| 10 | `sw/manager/workflow.yaml` | 52 | evaluate step 仍用 haiku |
| 11 | `finance/manager/workflow/execute-flow.md` | 18 | 文檔指引仍寫 haiku |
| 12 | `protocols/evaluation-protocol.md` | 71, 75, 80-90 | Haiku Eligibility 整段未廢止 |
| 13 | `protocols/definitions.md` | 233 | schema 範本未移除 haiku 選項 |

排除項（acceptable）：
- `*.bak.*` 備份檔案（保留歷史不需修改）
- `worklogs/index.jsonl` 歷史 worklog（model 欄位記錄當時實際用模型，不可改）
- `agent-ops/governance/reports/*.md` 既有審查報告（記錄當時狀態，不可改）
- `agent-ops/manager/memory/feedback_no_haiku_default_sonnet_or_opus.md` 規則文檔本身的「違反案例」表格（為說明用途）

- [x] **保留歷史追溯**：兩處 Tier 3 變更皆含 `2026-04-27 user policy: ban haiku` 標註
- [⚠] **schema validation**：`protocols/definitions.md` 仍允許 `model: haiku`，agent.yaml 通過 schema 驗證並不會擋住 haiku 寫入，schema 層無強制力

**結論**：Tier 3 兩處 OK，但宣稱「11 處 bulk update」與實際命中數量（含 protocol 與 shared/* 至少 13 處活檔）不符。

---

## C. 後續傳播建議

- [✅] **寫 protocol（建議）**：建議建立 `agents/agent-ops/_protocols/rules/no-haiku-policy.md`
  - 內容：MANDATORY 規則陳述 + 例外申請流程（用戶 ack + Governance Tier 3 審 + soul.md 例外條款）+ 違反處置（Governance flag）
  - 同時必須廢止 `evaluation-protocol.md` 的 Haiku Eligibility 段落，改為 `← 廢止：見 no-haiku-policy.md`
  - 同時更新 `definitions.md:233` 移除 haiku 選項

- [✅] **全 team manager memory 同步加 mandatory 提醒**：
  - 目前僅 `agent-ops/manager/memory/` 有 feedback 檔
  - 需同步建立：`edu/manager/memory/`, `sales/manager/memory/`, `sw/manager/memory/`, `finance/manager/memory/`, `bni/manager/memory/`, `agent-training/manager/memory/` 各一份 feedback 檔（簡短：「全系統禁用 haiku，預設 sonnet。完整規則見 protocols/rules/no-haiku-policy.md」）

- [✅] **Builder template 更新**：
  - `agent-builder` 已更新 checklist.md（Tier 3 變更 2 已 OK）
  - 但 agent.yaml 模板（`protocols/definitions.md:233`）仍含 haiku 選項，**必須**移除以杜絕未來新建 agent 預設帶 haiku
  - 建議追加：在 `checklist.md` For Create 區塊加一條 `[ ] dispatch.model 不為 haiku`

---

## 風險評估

### 短期（1 週內）
- **規則矛盾風險**：`evaluation-protocol.md` 的 Haiku Eligibility 仍合法化 4 個白名單 agent 用 haiku，與新規則直接衝突。任何 Manager 派工時讀 protocol 會被誤導，認定 `agents/agent-ops/_shared/intent` 等仍可用 haiku。
- **行為實際違規**：`sw/manager`、`sales/manager` 兩個 manager workflow.yaml 仍硬編 `model: haiku` 派 intent step，每次任務都在「規則禁止但實際使用 haiku」。
- **新建 agent 風險**：Builder 雖然 checklist 已更新，但 schema 範本仍允許 haiku，新 agent 若沒人 review 會直接帶 haiku 上線。

### 長期（1 個月以上）
- **governance 信任侵蝕**：規則寫了但系統一半 agent 仍用 haiku，會逐漸讓 team 認為「規則是寫好看的，實際隨意」。Principle 18「規則推送不落地不算完」會被削弱。
- **rule-rollout 機制可信度下降**：未來 cross-team 規則推送都會被質疑「真的全推了嗎？還是又只推一半？」
- **隱性成本不確定性**：原本指望 ban haiku 帶來「品質一致 + 成本可預測」的好處，若一半 agent 仍用 haiku，效果稀釋，無法驗證規則是否真的有用。

### 紅旗
- **無**重大不可逆風險。所有殘留 haiku 用法皆為純 model 字串設定，可由 Builder 一次 bulk update 全部修正，無資料破壞風險。

---

## 建議後續動作

> Governance 建議由 agent-ops/manager 立即派 Agent Builder 執行第二輪 bulk update，**不結案**直到所有殘留消滅。

### 立即執行（P0，今日內）

1. **Manager 派 Builder 第二輪 bulk update**，目標檔案 13 處（見 B 區清單），全部 `model: haiku` → `model: sonnet`，每處加註 `# 2026-04-27 ban-haiku-policy`
2. **Manager 派 Builder 廢止 `protocols/evaluation-protocol.md` Haiku Eligibility 段落**：第 71-90 行整段改寫為「← 2026-04-27 廢止：全系統禁用 haiku，見 protocols/rules/no-haiku-policy.md」
3. **Manager 派 Builder 修正 `protocols/definitions.md:233`**：`model: haiku | sonnet | opus` → `model: sonnet | opus`

### 短期執行（P1，本週內）

4. **Manager 派 Builder 新建 `protocols/rules/no-haiku-policy.md`**：MANDATORY 規則 + 例外流程 + 違反處置
5. **Manager 派 Builder 同步全 team manager memory**：6 份 feedback 檔（edu/sales/sw/finance/bni/agent-training）
6. **Manager 派 Builder 強化 checklist**：For Create 區塊加 `[ ] dispatch.model != haiku`

### 中期（本月內）

7. **Governance 第二次審查**：第二輪 bulk update 完成後，由 agent-ops/governance 重審，確認 `grep -r "model: haiku"` 在活檔案中歸零
8. **Evolution 分析**：1 個月後評估規則生效後的品質 / 成本變化，回饋給用戶

---

## 結論

Tier 3 兩處文字變更：**APPROVE**（內容正確、有用戶授權、有時間戳追溯）。

整體 rule-rollout：**CONDITIONAL APPROVE** — 必須完成 P0 三項行動（補完 13 處殘留 + 廢止 protocol Haiku Eligibility + 修 schema 範本）才算規則真正落地。

**Governance flag**：本案目前不允許結案。請 Manager 立即派 Agent Builder 執行第二輪 bulk update，並排程 Governance 二審。
