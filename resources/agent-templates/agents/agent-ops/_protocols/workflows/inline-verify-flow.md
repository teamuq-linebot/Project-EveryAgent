# 逐次派遣驗證流程（Inline Dispatch Verification）

## 目的
每個 worker agent 完成後，Manager 立即驗證其產出是否與聲稱一致，通過才進入下一步。不再等所有 agent 跑完才批次驗證。

## 適用角色
Manager (L2)、Director (L3)、Officer (L4) — 任何使用 Agent tool 派遣的角色。

## 觸發時機
每次 Agent tool 呼叫返回結果後，立即執行。

## 驗證步驟

```
Agent 返回結果
  │
  ▼
[1] 解析聲稱（Parse Claims）
  從 agent 回報中提取所有具體聲稱：
  - "已建立 {file_path}" → 記錄為 file_created
  - "已修改 {file_path}" → 記錄為 file_modified
  - "已刪除 {file_path}" → 記錄為 file_deleted
  - "已更新 {section} 在 {file}" → 記錄為 content_updated
  - "搜尋結果為 {result}" → 記錄為 search_result
  │
  ▼
[2] 逐項驗證（Verify Each Claim）
  對每個聲稱執行對應檢查：

  | 聲稱類型 | 驗證方式 |
  |---------|---------|
  | file_created | Glob 確認檔案存在 + Read 確認非空 |
  | file_modified | Read 確認關鍵修改內容確實存在 |
  | file_deleted | Glob 確認檔案不存在 |
  | content_updated | Grep 在指定檔案中搜尋關鍵內容 |
  | search_result | Grep 抽查 1-2 個結果確認正確 |
  │
  ▼
[3] 判定結果

  全部通過 → PASS，繼續下一步驟
  部分失敗 → PARTIAL
    - 失敗項 < 30% → 記錄差異，繼續（附警告）
    - 失敗項 ≥ 30% → 重新派遣該 agent（一次機會）
  全部失敗 → FAIL
    - 重新派遣，精煉 prompt（一次機會）
    - 二次失敗 → 報告 gap 給用戶
  │
  ▼
[4] 記錄驗證結果
  在 dispatch 結果中附加驗證摘要：
  ```
  VERIFY: {agent_name}
  Claims: {n} | Verified: {n} | Failed: {n}
  Status: PASS | PARTIAL | FAIL
  Failed items: {list if any}
  ```
```

## Manager 整合方式

在 workflow.yaml 的 execute 步驟中，每次 dispatch 後加入 inline verify：

```yaml
- id: execute
  action: dispatch_rounds
  ref: workflow/execute-flow.md
  inline_verify: agents/agent-ops/_protocols/workflows/inline-verify-flow.md  # ← 引用此流程
  note: "每次 agent 返回後立即驗證，通過才派下一個"
```

或者在 dispatch prompt 的最後提醒自己：

```
INLINE VERIFY: Agent 返回後，依 agents/agent-ops/_protocols/workflows/inline-verify-flow.md
逐項驗證其聲稱。全部通過才繼續下一步。
```

## 與現有 verification-protocol.md 的關係
- inline-verify 是「每次 dispatch 後」的即時驗證
- verification-protocol.md 的 verify 步驟是「全部完成後」的最終審查
- 兩者互補，不互斥：inline verify 確保每步正確，final verify 確保整體一致
- 有 inline verify 後，final verify 可以更輕量（只做交叉檢查和整體一致性）

## 備註
- 驗證應使用 Glob、Grep、Read 等輕量工具，不派遣新 agent
- 驗證失敗的重新派遣只允許一次（防止無限迴圈）
- 並行派遣的多個 agent：等全部返回後逐一驗證

<!-- self-added 2026-05-09 phase2-rollout-prep -->
## A. Pre-dispatch：Estimate-Split-Verify 估算（呼應 SW Manager Principle #23）

### A.1 估算公式
```
預估 work_units = 待動檔案/章節數 × 平均每件 work_unit 數（含 helper / diagnose / import 整理 / cross-link）
```

### A.2 計量單位 abstraction（適用各 team manager）
| Team | work_unit |
|------|-----------|
| sw | Edit 數（檔案修改次數） |
| edu | 課程章節數 / slide 數 |
| sales | report sections 數 |
| finance | 報表 section 數 / journal entry 數 |
| agent-ops | protocol clauses 變更數 / agent file 變更數 |

> 各 team manager 應在自身 dispatch protocol 註明本 team 的 work_unit 定義。

### A.3 拆批決策樹
| 估算 work_units | 派遣策略 |
|-----------------|---------|
| ≤ 5 | 1 dispatch（單一 worker 1 棒）|
| 6 ~ 10 | 拆 2 dispatch（每批 ≤ 5）|
| > 10 | 重評是否「1 handler / 1 dispatch」過度集中；考慮拆給 2+ workers |

### A.4 估算結果落地
- Manager 必把估算結果寫入自身 worklog 的 `task_context.batch_plan` 欄位（陣列）：
  ```json
  "batch_plan": [
    {"batch_id": 1, "worker": "agent-builder", "estimated_units": 4, "scope": "..."},
    {"batch_id": 2, "worker": "governance", "estimated_units": 3, "scope": "..."}
  ]
  ```
- 缺欄位 = 違反 Principle #23，governance 季稽核 Major finding。

---

## B. Per-dispatch：Inline Verify 必檢 4 項（核心強化）

> 取代或補強原 Step [2] 的「逐項驗證」表。本節是 Principle #23 的 machine-checkable 落地。

每次 worker 返回後，Manager **必須**逐項核對 4 件事，全部 PASS 才能派下一棒。

| # | 檢查項 | 來源（worker evidence_bundle 欄位）| 通過標準 | 違反處理 |
|---|--------|-----------------------------------|---------|---------|
| 1 | **Work-unit count**（sw=Edit 數）| `files_touched[]` 內 action=`create`/`modify` 的數量；或 `assertions` 中宣稱的 work_unit | 實際數 ≤ dispatch prompt 限額（預估 + 容差 0~+1）| FAIL → 重派並縮 scope |
| 2 | **tsc / build exit_code**（sw 適用；其他 team 換對應 lint/build）| `commands_run[]` 中 cmd 含 `tsc --noEmit`（或同等）那筆的 `exit_code` | == 0；或剩餘錯誤 == 已知 baseline | FAIL → 重派 fix 該 batch |
| 3 | **Touched files vs scope**（scope creep 偵測）| `files_touched[].path` 全列表 | 全在 dispatch prompt 宣告 scope 內，無範圍外檔案 | FAIL → 重派並明文列入 do-not-touch |
| 4 | **Brief scope match**（worker 宣稱 vs dispatch goal）| worker output_summary / `assertions[].claim` | 宣稱目標與 dispatch prompt Goal 對得上、無遺漏項 | FAIL → 重派補漏項 |

### B.1 計量單位換算指引
- 非 sw team 套用本表時，將「Edit 數」改讀本 team 的 work_unit（見 §A.2）；「tsc exit_code」改讀本 team 的 lint/render/QA 命令 exit_code（如 edu 的 PPT render、finance 的試算表 lint）。
- 若該 team 無對應命令（例如純文件修改），#2 可為 N/A，但需在 worklog 註明 `tsc_check: "N/A: documentation-only batch"`。

### B.2 失敗處理階梯
1. 任一項 FAIL → Manager 必執行 `block_next_dispatch_and_resplit`：暫停下一批，重派當批 with refined prompt。
2. **連續 2 次 FAIL（同一批）** → 升級給 user 決策，不得無限重派。
3. 同一輪 dispatch 中，4 項任一 FAIL 都視為整體 FAIL；不存在「3/4 PASS 算過」。

### B.3 跨批 reviewer 一致性原則（呼應 Principle #23 第 4 點）
- inline_verify **不能取代**最終 reviewer。
- 全部 dispatch 結束後仍派 1 個 cross-batch reviewer（**1 reviewer 跨 N batch**，不要 N reviewer 對 N batch）。
- 理由：inline_verify 是逐批快速稽核（4 項機械檢查），最終 reviewer 才能抓「跨批一致性 / 跨 handler 邏輯衝突 / 整體 scope creep」。

---

## C. Manager 自身 worklog 落地

### C.1 必填欄位
Manager worklog 必含 `inline_verify_log` 陣列，每次 inline_verify 一筆紀錄：

```json
"inline_verify_log": [
  {
    "batch_id": 1,
    "worker": "agent-builder",
    "verified_at": "2026-05-09T04:50:00Z",
    "checks": {
      "work_unit_count":  {"actual": 4, "limit": 5, "status": "PASS"},
      "tsc_exit_code":    {"value": 0, "status": "PASS"},
      "touched_files":    {"in_scope": true, "out_of_scope": [], "status": "PASS"},
      "brief_scope_match":{"status": "PASS", "note": "..."}
    },
    "overall": "PASS"
  }
]
```

### C.2 inline_verify_gate step 對應
- workflow.yaml 的 `inline_verify_gate` step（位於 audit_doer_facts 之前）讀此欄位驗證：
  ```
  len(inline_verify_log) == dispatch_rounds.batches_executed
  且 所有 batch 的 overall == "PASS"
  ```
- 不等 → step FAIL → 阻擋進入 audit_doer_facts。

---

## D. 適用範圍（manager-universal）

本流程適用所有 manager（不限 sw）：
- **覆蓋對象**：sw / edu / sales / finance / agent-ops / bni 等所有 Type == manager 的 agent。
- **Director / Officer 同樣適用**：dispatch_managers / dispatch_directors 後也須對 Manager 自身產出（dispatch_summary）做 inline_verify（檢查 4 項換算為「子任務數 / 整體 status / 涉及 team / 是否符合派遣意圖」）。

---

## E. 與既有 protocol 的關係（避免重複造輪）

| 既有 protocol | 關係 | 衝突處理 |
|--------------|------|---------|
| `agents/agent-ops/_protocols/evidence-protocol.md` | evidence_bundle schema 的權威來源（`files_touched` / `commands_run` / `assertions` 欄位定義） | 本流程**直接讀取**該 schema，不重新定義欄位 |
| `agents/agent-ops/_protocols/verification-protocol.md` | 全任務最終驗證的通用協議 | 本流程是「逐批快速稽核」，verification-protocol 是「全部完成後的最終審查」，**互補不互斥** |
| `agents/agent-ops/_protocols/workflows/init-output-path-flow.md` | 派遣前 output_path 初始化 | 本流程在 init_output_path 之**後**執行，每次 dispatch 完返回再啟動 |
| `agents/agent-ops/_protocols/workflows/feedback-detect-flow.md` | 用戶回饋偵測 | 無耦合 |

> 若 §B 表中欄位名與 evidence-protocol.md 不一致，**以 evidence-protocol.md 為準**，本檔需同步更新（不要分叉）。
<!-- end self-added 2026-05-09 phase2-rollout-prep -->

---

## Changelog
- **2026-05-09 phase2-rollout-prep**：補強 §A pre-dispatch estimate / §B per-dispatch 4 項必檢 / §C manager worklog 落地 / §D manager-universal 適用範圍 / §E 與既有 protocol 關係。原因：Principle #23（Estimate-Split-Verify）Phase 2 rollout 前，governance 發現本協議比 #23 寬鬆，缺 Edit count / tsc exit_code / touched files / brief scope 四項明文機械稽核，恐讓 manager 即使呼叫 inline_verify 也掛羊頭賣狗肉。本次補齊 actionable + machine-checkable 指引，並抽象 work_unit 概念以服務所有 team manager。
