# Human-in-the-Loop (HITL) Protocol

## 1. 設計原則
並非所有操作都需要人類確認。HITL 只在高風險操作前暫停，避免不可逆錯誤。
低風險操作（查詢、新增記憶、新增技能）直接執行，不中斷流程。

## 2. 風險分級

### Tier 1 — 自動執行（無需確認）
| 操作 | 範例 |
|------|------|
| 查詢/分析 | 讀取 agent 檔案、外部 log 統計 |
| 新增記憶 | 寫入 memory/ |
| 新增技能 | 在 skills.md 標記 self-added |
| 新增 workflow step | 在 workflow.yaml 標記 self-added |

### Tier 2 — 告知後執行（inform-then-act）
Manager 在報告中告知用戶已執行的操作，但不等待確認。
| 操作 | 範例 |
|------|------|
| 建立新 agent | Agent Builder 新建完整目錄 |
| 修改 skills.md（刪除） | 移除技能 |
| 修改 tools.md | 改變工具授權 |

### Tier 3 — 暫停等待確認（mandatory pause）
Manager 必須暫停，向用戶說明即將執行的操作，等待明確確認後才繼續。
| 操作 | 觸發條件 |
|------|---------|
| 修改 soul.md | 任何 agent 的身份/原則變更 |
| 修改 Governance agent 自身 | 自我修改是最高風險 |
| 刪除 agent | 整個 agent 目錄刪除 |
| 修改 protocol | 跨團隊影響 |
| 同時修改 5+ agent 檔案 | 大規模變更 |
| 修改 CLAUDE.md | 系統級變更 |
| 修改 workflow.yaml（刪除/修改步驟）| 流程變更 |
| 生產環境部署且含未驗證 assertion <!-- self-added 2026-05-25 G4 --> | Manager 派出的 worker `evidence_bundle` 含 `verified: false` 的 assertion，且 `task_context.risk_hint` 含 `production_deploy` / `prod_deploy` / `deploy_to_main` 任一 |

## 3. 暫停流程

### Step 1: Manager 偵測高風險操作
在 feasibility 步驟中，根據 insight_result.target_files 判斷風險等級。

### Step 2: 暫停並報告
Manager 向用戶輸出：
```
⚠️ 高風險操作需要確認

即將執行：
- [操作描述]
- 影響檔案：[檔案列表]
- 影響 agent：[agent 列表]
- 風險原因：[為什麼這是 Tier 3]

請回覆下列之一：
- `confirm`          → 執行
- `abort`            → 取消
- `modify: <描述>`   → 要求改計畫
```

### Step 3: 等待確認（嚴格 token）
只接受下列明確 token（大小寫不敏感）：

| 用戶回覆              | 行為                                                           |
|----------------------|---------------------------------------------------------------|
| `confirm`            | 繼續執行                                                        |
| `abort`              | 停止流程，記錄 log status = "cancelled_by_user"                 |
| `modify: <描述>`     | 停止流程，帶修改意見回上一步（plan / feasibility）重產計畫       |
| 其他任何回覆 / 無回應 | 視為 `abort`；**不得**推斷為 confirm                            |

**超時**：10 分鐘無回應 → 視為 `abort`，記錄 log status = "timeout"。

此嚴格語意與 `agents/platform/gb10-sysadmin/workflow/execute-flow.md §3c` 的 Tier 3 gate 一致，
確保 firmware flash、SED key 變更等不可逆操作不會因模糊回覆而誤執行。

## 3a. Sample Dialogue：Deploy + Unverified Assertion <!-- self-added 2026-05-25 G4 -->

當偵測到「生產環境部署且含未驗證 assertion」時，Manager 不得自行宣稱 deploy 完成。
應於 deliver 前暫停，向用戶輸出下列範例對話格式（三選一）：

```
⚠️ Deploy 已執行（commit pushed）但 {N} 項驗證未獨立完成

執行紀要：
- Commit: {sha}
- 推進動作：git push origin {branch} ✅
- 未獨立完成的 assertion：
  - {assertion_id}: {claim}（verified: false，note: {why_not_verified}）

請選擇下列之一：
- `A` / `confirm`           → 我已手動確認 build / 服務狀態成功，同意交付
- `B` / `wait_verify`       → 等待 verify，改派 manager-verify-deploy 任務（Manager 將等待 build 完成後再獨立驗證）
- `C` / `abort`             → 取消本輪交付，重新規劃
```

**用戶回覆對應行為：**

| 用戶回覆                | 對應行為                                                                |
|------------------------|------------------------------------------------------------------------|
| `A` / `confirm`        | approved → 用戶承擔驗證責任；Manager 在 deliver 中註明「用戶已手動驗證」 |
| `B` / `wait_verify`    | hold → Manager 改派後續 verify 任務（例如 manager-verify-deploy 或重派 devops 補 verify），於 verify 通過後再 deliver |
| `C` / `abort`          | cancelled → 不交付給用戶，log status = cancelled_by_user                 |
| 其他 / 無回應          | 視為 `abort`（不得推斷為 confirm）                                       |

> 本 sample dialogue 為 Tier 3 觸發「生產環境部署且含未驗證 assertion」時的標準模板。
> SW Manager 對應實作見 `agents/sw/manager/workflow/hitl-gate-flow.md` §Deploy + Unverified Assertion 子流程。

## 4. Governance 自我保護規則
Governance agent 的自身檔案修改（soul.md、tools.md、workflow.yaml）永遠是 Tier 3。
即使用戶已預先授權大規模變更，Governance 自身的修改仍需獨立確認。

## 5. 與 Feasibility Rules 的整合
在 org.md Feasibility Rules 中：
- "直接執行" → 對應 Tier 1
- "需告知用戶後執行" → 對應 Tier 2
- "直接拒絕並轉介" → 不變（scope violation）
- 新增 "暫停等待確認" → 對應 Tier 3

## 6. 記錄要求
所有 Tier 3 操作必須在外部 log 中記錄：
- `hitl_tier`: 3
- `hitl_action`: "approved" | "cancelled" | "timeout"
- `hitl_wait_seconds`: 等待時間

> 🚫 打卡機制已於 2026-05-28 全面移除，HITL Tier 3 記錄改寫入外部 log（不再透過 TeamUQ subtask description / local worklog）。

## 7. 與現有協議的關係
- 擴展 feasibility-flow.md（新增 Tier 3 判斷）
- 引用 agent-anatomy.md（哪些檔案屬於哪個 Tier）
- 引用 definitions.md §Self-Update Rules
