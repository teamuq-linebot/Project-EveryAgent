# Edu Team Governance 審查報告

**審查日期**：2026-04-16
**審查者**：Governance Agent (opus)
**觸發事由**：Edu Manager Training Workshop 教材生成歷經 5 輪重做 (v1-v2.4)，暴露多項 workflow 違規與結構缺陷
**派遣來源**：Agent Ops Manager

---

## 判定

- **違規嚴重性：HIGH**
- **改善緊迫性：P1**

**判定理由**：
1. 7 項缺陷中有 4 項屬於 workflow 結構性缺失（非人為疏忽），表示 workflow.yaml 本身存在系統性設計不足
2. 5 輪重做造成顯著效率損失，且問題類型具高度可重現性（任何「新增章節」操作都會觸發相同缺陷）
3. 未達 CRITICAL 的原因：無安全性風險、無資料損失、未違反 HITL 協議、最終產出品質達標

---

## Workflow 差異分析表

### Edu Manager workflow.yaml 定義步驟 vs 實際執行

| # | Step ID | workflow.yaml 定義 | 實際執行情況 | 差異描述 | 嚴重性 |
|---|---------|-------------------|-------------|---------|--------|
| 1 | `log_start` | 打卡開工 | 正常執行 | 無差異 | -- |
| 2 | `feedback_detect` | 偵測用戶回饋語意 | 正常執行 | 無差異 | -- |
| 3 | `parse_request` | 解析教材需求 | 正常執行 | 無差異 | -- |
| 4 | `research` | 平行派遣 edu-researcher + shared/researcher | 正常執行 | 無差異 | -- |
| 5 | `design_content` | 派遣 content-designer 設計內容結構 | 執行但產出含概念錯誤（Officer 定義錯誤） | **缺少 concept_validation 閘門**：Designer 對「Officer」的理解錯誤（誤認為帶執照審核者，實為 CXO），但無機制在 Design 後驗證概念正確性 | HIGH |
| 6 | `evaluate_content` | 派遣 content-evaluator 評估 | 執行但未攔截概念錯誤與結構重疊 | Evaluator 未偵測到 Ch0 與 Ch1/Ch2 的內容重疊問題，顯示評估維度不完整 | MEDIUM |
| 7 | `visual_styling` | 派遣 visual-stylist | 執行但首版品牌風格錯誤 | **缺少 brand_asset_confirm 前置檢查**：未確認品牌參考資料齊全就直接產出，導致風格錯誤需重做 | HIGH |
| 8 | `pre_generate_routing` | 拆分章節清單 | 正常執行 | 無差異 | -- |
| 9 | `generate_docs_parallel` | 平行生成各章 PPTX | 執行多輪（v1-v2.4） | 因上游問題導致反覆重做 5 次 | HIGH |
| 10 | `merge_docs` | 合併章節 PPTX | 正常執行 | 無差異 | -- |
| 11 | `qa_review` | 派遣 qa-reviewer | 執行但未攔截頁碼偏移和跨檔不一致 | QA 範圍不含跨 deliverable 一致性檢查 | MEDIUM |
| 12 | `governance` | Agent 系統檔案修改時觸發 | 因 `skip_if: no_agent_system_files_modified` 被跳過 | 符合定義（本次無 agent 系統檔案修改） | -- |
| 13 | `verify` | 驗證 worker 產出完整性 | 執行但驗證範圍不足 | 未涵蓋「新增章節後的全局一致性」 | MEDIUM |
| 14 | `synthesize` | 整合結果 | 正常執行 | 無差異 | -- |
| 15 | `deliver` | 回覆使用者 | 正常執行 | 無差異 | -- |
| 16 | `log_end` | 打卡收工 | 正常執行 | 無差異 | -- |

### 未被定義但應該存在的步驟（workflow.yaml 結構缺失）

| 缺失步驟 | 應在哪個步驟之後 | 缺失影響 | 此次事件對應 |
|----------|----------------|---------|-------------|
| `brand_asset_confirm` | `design_content` 之後、`visual_styling` 之前 | 品牌風格無參考就直接產出 | 違規 #6：品牌風格初版錯誤 |
| `concept_validation` | `design_content` 之後、`generate_docs_parallel` 之前 | 關鍵概念錯誤流入生成階段 | 違規 #5：Officer 概念搞錯 |
| `consistency_check` | `generate_docs_parallel` 之後、`qa_review` 之前（且在任何章節新增/刪除/重排時觸發） | 章節重疊、頁碼偏移、衍生檔不同步 | 違規 #1 #2 #3 #4 |
| `cross_deliverable_sync` | `merge_docs` 之後、`qa_review` 之前 | XLSX Timing、Instructor Guide、Workbook 未同步更新 | 違規 #3 #4 |
| `hitl_gate` | 缺失（對比金標準） | 無 Tier 3 暫停機制 | 雖本次無 Tier 3 操作，但結構不完整 |

---

## 缺失步驟建議

以下 YAML 可直接插入 `agents/edu/manager/workflow.yaml` 的 `steps` 陣列中。

### 1. brand_asset_confirm（插入 `design_content` 與 `visual_styling` 之間）

```yaml
  - id: brand_asset_confirm
    action: manager_self
    trigger: "visual_styling 步驟啟動前"
    note: >
      品牌資產確認閘門：確認以下資料齊全後才進入 visual_styling —
      (1) 品牌色彩參考檔已存在且可讀
      (2) 字型規範已確認
      (3) Logo/圖示素材路徑有效
      若任一缺失 → 暫停並向 User 請求補充，不進入 visual_styling。
    on_error: report_and_stop
```

### 2. concept_validation（插入 `evaluate_content` 與 `visual_styling` 之間）

```yaml
  - id: concept_validation
    action: dispatch_agent
    agent: edu/content-evaluator
    model: sonnet
    trigger: "design_content 完成後、generate 之前"
    note: >
      概念驗證閘門：針對 design_draft 中的關鍵術語/概念，
      由 content-evaluator 交叉比對 research 結果，確認 Manager 和 Designer
      對核心概念的理解正確。輸出 PASS/FAIL + 錯誤概念清單。
      FAIL 時退回 design_content 並附上正確定義。
    on_error: report_and_stop
```

### 3. consistency_check（插入 `merge_docs` 與 `qa_review` 之間）

```yaml
  - id: consistency_check
    action: dispatch_agent
    agent: edu/qa-reviewer
    model: haiku
    trigger: "新增/刪除/重排章節時（偵測條件：chapter_count 變更）"
    note: >
      全局一致性掃描 —
      (1) 章節內容重疊檢測：任兩章之間的主題/段落不得重複超過 30%
      (2) 頁碼連續性驗證：從 Ch0 開始逐章驗證頁碼是否連續
      (3) 目錄 vs 實際章節標題一致性
      (4) 投影片編號連續性
      輸出：一致性報告（PASS / FAIL + 具體差異列表）
    on_error: report_and_stop
```

### 4. cross_deliverable_sync（插入 `consistency_check` 與 `qa_review` 之間）

```yaml
  - id: cross_deliverable_sync
    action: dispatch_agent
    agent: edu/doc-generator
    model: haiku
    trigger: "主檔（PPTX）結構變更後"
    note: >
      跨 Deliverable 同步 —
      主檔章節結構變更時，同步更新所有衍生檔：
      (1) XLSX Timing：新增/移除對應章節時段
      (2) Instructor Guide：新增/移除對應章節腳本
      (3) Workbook：新增/移除對應章節練習
      輸出：同步報告（列出每個衍生檔的變更項目）
    on_error: retry_once
```

### 5. hitl_gate（插入 `evaluate_content` 與 `visual_styling` 之間，建議在 `concept_validation` 之後）

```yaml
  - id: hitl_gate
    action: manager_self
    condition: "content_scope_change == 'major' OR chapter_structure_change == true"
    ref: workflow/hitl-gate-flow.md
    protocol: agents/agent-ops/_protocols/hitl-protocol.md
    note: >
      Tier 3 暫停閘門：當內容結構發生重大變更（新增/刪除章節、大幅改動章節順序）時，
      暫停流程等待用戶 confirm/abort/modify。
      防止大規模重做未經用戶確認。
    on_error: report_and_stop
```

### 建議插入後的步驟順序

```
log_start → feedback_detect → parse_request → research → design_content
→ evaluate_content → concept_validation → brand_asset_confirm → hitl_gate
→ visual_styling → pre_generate_routing → generate_docs_parallel → merge_docs
→ consistency_check → cross_deliverable_sync → qa_review → governance
→ verify → synthesize → deliver → log_end
```

---

## Edu Manager soul.md 修改建議

建議在 `## Principles` 區塊新增以下原則：

### 新增原則 15：品牌資產前置確認

```markdown
15. **品牌資產前置確認** — 進入 visual_styling 前，必須確認品牌色彩、字型、Logo 等參考資料齊全且可讀。缺失時暫停並向用戶請求，不得以預設值替代。
```

### 新增原則 16：概念交叉驗證

```markdown
16. **概念交叉驗證** — Design 完成後、Generate 前，關鍵術語/概念必須與 Research 結果交叉比對。概念理解錯誤必須在生成前攔截，不得帶入下游。
```

### 新增原則 17：章節變更全局一致性

```markdown
17. **章節變更觸發全局一致性檢查** — 任何章節新增、刪除、重排操作後，必須執行全局一致性掃描（內容重疊、頁碼連續、衍生檔同步）。跳過此檢查視為流程違規。
```

### 新增 Anti-pattern

```markdown
- 新增章節後未重新檢查全局一致性（頁碼、目錄、衍生檔）
- 未取得品牌參考就進入 visual_styling
- 對關鍵術語的理解未經驗證就進入生成階段
```

---

## 跨團隊影響

### SW Team (`agents/sw/manager/workflow.yaml`)

**發現類似缺陷**：SW Manager workflow 同樣缺少 `hitl_gate` 步驟。對比金標準（Agent Ops Manager），SW Manager 在高風險操作前無暫停確認機制。

| 缺失項目 | SW Manager | BNI Manager | Edu Manager |
|----------|-----------|-------------|-------------|
| `hitl_gate` | 缺失 | 已有 | 缺失 |
| `consistency_check` | N/A（非文件生成型） | N/A | 缺失 |
| `brand_asset_confirm` | N/A | N/A | 缺失 |
| `concept_validation` | N/A | N/A | 缺失 |
| `cross_deliverable_sync` | N/A | N/A | 缺失 |

**建議**：SW Manager 應補上 `hitl_gate`，但 `consistency_check` 等步驟為 Edu 特有需求，不需跨團隊推廣。

### Protocol 修改需求

**不需要修改 protocol**。原因：
1. `hitl-protocol.md` 本身定義完備（Tier 1/2/3 分級清晰）
2. 問題根源在 Edu Manager workflow.yaml 未引用 hitl-protocol.md，而非 protocol 本身不足
3. `verification-protocol.md` 的 Check 項目已涵蓋本次問題的偵測維度，但 Edu Manager 的 QA 流程未完整實作

### Tier 3 HITL 判定

**修改 Edu Manager workflow.yaml = Tier 3 操作**（依 hitl-protocol.md：「修改 workflow.yaml（刪除/修改步驟）」為 Tier 3）。
因此，本報告建議的所有 workflow.yaml 修改，均需由 Agent Ops Manager 暫停並等待用戶 `confirm` 後才可執行。

---

## 行動項目 (Action Items)

### AI-1：新增 `consistency_check` 步驟至 Edu Manager workflow.yaml
- **問題描述**：新增 Ch0 後未觸發全局一致性掃描，導致章節重疊、頁碼偏移
- **修改對象**：`agents/edu/manager/workflow.yaml`
- **修改內容**：插入上述 `consistency_check` YAML 定義於 `merge_docs` 與 `qa_review` 之間
- **責任人**：Agent Builder（執行）→ Governance（審查）
- **風險等級**：Tier 3（修改 workflow.yaml）
- **優先序**：P1 — 最高，因為此缺陷影響面最廣（4 項違規的根因）

### AI-2：新增 `cross_deliverable_sync` 步驟至 Edu Manager workflow.yaml
- **問題描述**：主檔變更後 XLSX Timing、Instructor Guide 未同步
- **修改對象**：`agents/edu/manager/workflow.yaml`
- **修改內容**：插入上述 `cross_deliverable_sync` YAML 定義於 `consistency_check` 與 `qa_review` 之間
- **責任人**：Agent Builder（執行）→ Governance（審查）
- **風險等級**：Tier 3（修改 workflow.yaml）
- **優先序**：P1

### AI-3：新增 `brand_asset_confirm` 步驟至 Edu Manager workflow.yaml
- **問題描述**：未取得品牌參考就直接進入 visual_styling
- **修改對象**：`agents/edu/manager/workflow.yaml`
- **修改內容**：插入上述 `brand_asset_confirm` YAML 定義於 `design_content` 與 `visual_styling` 之間
- **責任人**：Agent Builder（執行）→ Governance（審查）
- **風險等級**：Tier 3（修改 workflow.yaml）
- **優先序**：P1

### AI-4：新增 `concept_validation` 步驟至 Edu Manager workflow.yaml
- **問題描述**：Officer 概念錯誤未在 Design 階段被攔截
- **修改對象**：`agents/edu/manager/workflow.yaml`
- **修改內容**：插入上述 `concept_validation` YAML 定義於 `evaluate_content` 與 `visual_styling` 之間
- **責任人**：Agent Builder（執行）→ Governance（審查）
- **風險等級**：Tier 3（修改 workflow.yaml）
- **優先序**：P1

### AI-5：新增 `hitl_gate` 步驟至 Edu Manager workflow.yaml
- **問題描述**：缺少 Tier 3 暫停閘門（對比金標準）
- **修改對象**：`agents/edu/manager/workflow.yaml`
- **修改內容**：插入上述 `hitl_gate` YAML 定義
- **責任人**：Agent Builder（執行）→ Governance（審查）
- **風險等級**：Tier 3（修改 workflow.yaml）
- **優先序**：P2 — 本次事件未直接因缺少 HITL 造成損害，但結構合規需要補齊

### AI-6：更新 Edu Manager soul.md — 新增原則 15/16/17 + Anti-patterns
- **問題描述**：soul.md 缺少品牌前置確認、概念驗證、全局一致性的行為準則
- **修改對象**：`agents/edu/manager/soul.md`
- **修改內容**：新增上述三條原則 + Anti-pattern 條目
- **責任人**：Agent Builder（執行）→ Governance（審查）
- **風險等級**：Tier 3（修改 soul.md）
- **優先序**：P1

### AI-7：補齊 SW Manager workflow.yaml 的 `hitl_gate` 步驟
- **問題描述**：SW Manager 同樣缺少 Tier 3 暫停閘門
- **修改對象**：`agents/sw/manager/workflow.yaml`
- **修改內容**：參照金標準新增 `hitl_gate` 步驟
- **責任人**：Agent Builder（執行）→ Governance（審查）
- **風險等級**：Tier 3（修改 workflow.yaml）
- **優先序**：P2

---

## Worklog

| 欄位 | 值 |
|------|-----|
| Agent | agent-ops/governance |
| Model | opus |
| Task | Governance 審查 Edu Team workflow 違規 |
| 審查檔案 | edu/manager/workflow.yaml, edu/manager/soul.md, agent-ops/manager/workflow.yaml (金標準), sw/manager/workflow.yaml, bni/manager/workflow.yaml, protocols/verification-protocol.md, protocols/evaluation-protocol.md, protocols/hitl-protocol.md, protocols/team-review-protocol.md |
| 發現數 | 5 項 workflow 結構缺失、2 項 soul.md 缺失、1 項跨團隊缺陷 |
| 行動項目 | 7 項（AI-1 至 AI-7） |
| 判定 | HIGH / P1 |
