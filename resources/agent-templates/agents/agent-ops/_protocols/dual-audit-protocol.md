# Dual-Audit Protocol（雙軌稽核協定）

> 版本：v1.0
> 建立日期：2026-04-24
> 作者：agent-ops/agent-builder（gap-analysis 階段 3 Batch C）
> 適用範圍：跨 team Manager（SW / Edu / Sales / BNI / Platform / Agent Ops 等）

## Purpose

定義**所有 team Manager** 對下屬 worker 的雙軌稽核規範，確保：

1. **動手型 worker（Doer）** 的產出宣稱與事實一致
2. **審查型 worker（Reviewer / QA）** 的審查程序確實執行、非形式上蓋章

核心宣告：**Manager 只稽核（audit）不評判（judge）**。品質由領域 worker（Developer/Reviewer/Tester/QA）負責；Manager 的職責是驗事實、驗程序，不是當第二審的品質評審。

## 適用範圍

本 protocol 適用於所有 team 的 Manager，包括但不限於：

- `agents/sw/manager`（軟體開發團隊）— 已於 Batch B/C 導入
- `agents/edu/manager`（教育內容團隊）
- `agents/sales/manager`（業務團隊）
- `agents/bni/manager`（BNI 分析團隊）
- `agents/agent-ops/manager`（Agent 系統運維團隊）

各 team 的 `workflow.yaml` 應加入 `audit_doer_facts` 與 `audit_reviewer_process` 兩個 step，並於各自 `workflow/dual-audit-flow.md` 定義細節。SW team 為參考實作。

## 雙軌稽核定義

### 軌一：Doer Audit（事實層）

對「動手產出檔案/執行指令/改系統狀態」的 worker 進行事實稽核。

**輸入**：Doer 依 `agents/agent-ops/_protocols/evidence-protocol.md` 產出的 `evidence_bundle.yaml`。

**必驗項**：

| # | 驗證項 | BLOCK 條件 |
|---|--------|------------|
| 1 | evidence_bundle 格式完整 | 缺 required 欄位（trace_id / agent / files_touched / commands_run / assertions / unknowns）|
| 2 | 檔案 hash 相符 | `files_touched[i].after_sha256` 與當前檔 hash 不符 |
| 3 | 指令 exit_code 相符 | `commands_run[i].exit_code != 0` 但有 assertion 宣稱「已執行/已通過」|
| 4 | assertions 有證據指向 | `assertions[i].evidence_ref` 指向不存在或不相符的內容 |
| 5 | unknowns 誠實 | 高風險任務卻 unknowns 為空，或 reason 為「不知道/沒空查」等非結構化文字 |

**輸出**：`doer_audit_report.yaml`（overall = PASS/BLOCKED）

**參考實作**：`agents/sw/manager/workflow/dual-audit-flow.md#audit_doer_facts`

### 軌二：Reviewer Audit（程序層）

對「審查他人產出」的 worker 進行程序稽核。不評判審查結論好壞，只驗審查程序是否確實執行。

**輸入**：Reviewer 產出的 `review_report.yaml`，須含 `adversarial_checks` 區塊。

**必驗項**：

| # | 驗證項 | BLOCK 條件 |
|---|--------|------------|
| 1 | 覆蓋率 | `adversarial_checks` 陣列長度 < 3 |
| 2 | 四欄齊備 | 任一 check 缺 `hypothesis / verification_method / result / evidence_ref` |
| 3 | unknowns 全覆蓋 | Doer evidence_bundle.unknowns 有項目未被 `unknowns_coverage` 涵蓋 |
| 4 | 方法有效性 | 抽樣 1 條 check，verification_method 無法重現或與 result 矛盾 |
| 5 | 時間合理性 | `duration_seconds < (Doer 產出行數 / 200)` |
| 6 | 結論一致性 | 有 `result == confirmed_bug` 卻 `overall_verdict == PASS` |
| 7 | 抽樣深度 | 隨機 1 條 `evidence_ref` 指向不存在位置 |

**輸出**：`reviewer_audit_report.yaml`（result = PASS/BLOCKED）

**參考實作**：`agents/sw/manager/workflow/dual-audit-flow.md#audit_reviewer_process`

## BLOCK 條件（跨軌彙整）

任一軌出現 BLOCKED → Manager 必須：

1. 停止流程（不進 governance、不進 synthesize、不回覆 user）
2. 產出具體 blocker 清單（指明 agent / check id / evidence_ref）
3. 選擇動作之一：
   - 駁回 worker（BLOCKED 狀態），要求補交 evidence / 重跑審查
   - 重新 dispatch 該 sub-task
   - 升級為用戶 HITL 決策
4. **不 retry**：`error_policy: block_and_report`（not `retry_once`）

> 備註：「駁回」= Manager 對 BLOCKED 後的處置動作之一（退回 Doer/Reviewer 修正）；本 protocol 主述狀態用 BLOCKED，動作用「駁回」以區分。

## 禁令（所有 team Manager 共通）

- ❌ 不做品質判斷 — 不評「code 好不好」「內容深不深」「設計美不美」
- ❌ 不推翻業務結論 — Reviewer 若已 PASS，Manager 不得改判 FAIL（反之亦然）
- ❌ 不靠描述 grep 關鍵字 — 不能只因 stdout 出現 "success" 字串就認為成功；必須對 exit_code、hash、excerpt 內容做結構化比對
- ❌ 不替 worker 補評估 — evidence 不足不代為推論，直接回 BLOCK
- ❌ 不 retry 事實不符的任務 — 退回 worker 才是正確路徑，retry 等於蓋過事實
- ✅ 只比對、不判斷
- ✅ 硬性門檻、不靠感覺
- ✅ 發現程序造假才可推翻 worker 結論（僅限此例外）

## Manager 職責邊界：audit ≠ judge

| 角色 | 職責 | 非職責 |
|------|------|--------|
| Doer（Developer / Tester / DevOps / ...） | 產出 evidence_bundle | 不自我審查品質 |
| Reviewer（Reviewer / QA / Evaluator） | 做對抗式審查，產出 review_report | 不動手改 code、不替 Manager 做事實稽核 |
| Manager | 雙軌稽核（事實 + 程序） | 不做品質判斷、不評內容好壞、不推翻業務結論 |
| Governance | 全局政策、跨 team 審視 | 不取代 Manager 的稽核 |

詳見 `agents/sw/manager/soul.md` Principle 17（Audit ≠ Judge）。

## Reference

- `agents/agent-ops/_protocols/evidence-protocol.md` — Doer 產出 evidence_bundle 的格式與失效條款
- `agents/agent-ops/_protocols/verification-protocol.md` — Manager 對 agent 聲稱做 post-dispatch 驗證的上位規則
- `agents/agent-ops/_protocols/rules/output-verification.md` — Manager 稽核的上位規則
- `agents/sw/manager/workflow/dual-audit-flow.md` — SW team 的雙軌稽核實作（參考範本）
- `agents/sw/manager/soul.md` Principle 17 — Audit ≠ Judge 原則
- `agents/sw/reviewer/soul.md` Principle 9 — 對抗式審查原則
- `agents/sw/reviewer/skills.md` §Adversarial Hypothesis Generation — Reviewer 產出規格

## 版本歷程

| 版本 | 日期 | 作者 | 變更 |
|------|------|------|------|
| v1.0 | 2026-04-24 | agent-ops/agent-builder | 初版建立（gap-analysis 階段 3 Batch C）— 含雙軌稽核定義、適用範圍、BLOCK 條件、禁令、職責邊界 |
