# Agent SRE Protocol

## 1. 設計原則
Agent 系統和軟體系統一樣需要可靠性工程。本協議定義如何偵測、預防、回應 agent 失敗，確保系統整體可用性。

## 2. Circuit Breaker（熔斷器）

### 2.1 概念
當 agent 連續失敗超過閾值，暫時停止派遣，避免浪費資源和連鎖失敗。

### 2.2 狀態機
```
CLOSED (正常) → 失敗次數 >= threshold → OPEN (熔斷)
OPEN (熔斷) → 冷卻期結束 → HALF-OPEN (試探)
HALF-OPEN (試探) → 成功 → CLOSED / 失敗 → OPEN
```

### 2.3 閾值設定
| Agent 類型 | 連續失敗閾值 | 冷卻期 | 試探任務數 |
|-----------|------------|--------|-----------|
| Manager | 2 | 不適用（Manager 失敗直接報告用戶） | - |
| Worker (opus) | 3 | 下一個任務（即 retry_once 後） | 1 |
| Worker (sonnet) | 3 | 跳過當前任務，下次可用 | 1 |
<!-- 2026-04-27: Worker (haiku) 列已移除（user policy: ban haiku）。詳見 agents/agent-ops/_protocols/rules/no-haiku-policy.md。 -->

### 2.4 Manager 如何執行 Circuit Breaker
Manager 在派遣前檢查：
1. 讀取目標 agent 最近 N 筆 worklog（N = 閾值）
2. 如果最近 N 筆全部 failed → agent 處於 OPEN 狀態
3. OPEN 狀態時，Manager 應：
   - 嘗試使用替代 agent（如果有）
   - 升級模型（sonnet→opus；2026-04-27: haiku 已禁用）
   - 報告用戶 agent 不可用

## 3. Error Budget（錯誤預算）

### 3.1 概念
基於 agent-slo.md 的 SLO 目標，計算允許的失敗次數。

### 3.2 計算方式
```
error_budget = total_tasks × (1 - SLO_target)
remaining_budget = error_budget - actual_failures
```

### 3.3 Error Budget 耗盡時的動作
| 剩餘預算 | 動作 |
|---------|------|
| > 50% | 正常運作 |
| 25-50% | Evolution 分析（為什麼在消耗預算？） |
| < 25% | 凍結非必要變更，專注穩定性 |
| 0% | 暫停 agent 的新任務，強制 Evolution + Governance 審查 |

## 4. Failure Classification（失敗分類）

| 分類 | 定義 | 範例 | 回應方式 |
|------|------|------|---------|
| Transient | 暫時性，重試可解 | 模型 timeout、工具暫時不可用 | 自動 retry_once |
| Systematic | 系統性，重複出現 | 技能缺口、prompt 不夠好 | Evolution 分析 + 改善 |
| Catastrophic | 不可恢復 | 模型拒絕執行、scope violation | 報告用戶 + 停止 |
| Silent | 沒有錯誤但沒有結果 | Agent 打卡 start 但永遠沒有 end | worklog-report.sh 偵測 |

## 5. Cascade Prevention（連鎖失敗預防）

### 5.1 規則
- 單一 dispatch round 失敗 ≥ 50% agents → 停止後續 round，報告用戶
- Governance 拒絕（reject）→ 不自動重試，報告用戶
- 同一任務累計失敗 ≥ 3 agents → 停止任務，報告用戶

### 5.2 Blast Radius 限制
- 單一 dispatch round 最多 4 個並行 agent（限制爆炸半徑）
- 修改 agent 系統檔案時，每批最多 5-6 個 Edit 操作（已在 soul.md 定義）

## 6. Observability（可觀測性）

### 6.1 監控指標
| 指標 | 來源 | 閾值 |
|------|------|------|
| Success Rate | index.jsonl | agent-slo.md 定義 |
| Avg Duration | index.jsonl | agent-slo.md 定義 |
| Silent Failures | worklog-report.sh | 0 |
| Circuit Breaker 觸發次數 | Manager worklog | 追蹤但無閾值 |
| Error Budget 消耗率 | 計算值 | < 75% |

### 6.2 健康報告
- `scripts/worklog-report.sh` 產出健康報告
- Evolution agent 在 team-review 時引用報告
- 連續 2 週低於 SLO → 強制 Evolution 分析

## 7. 與現有協議的關係
- 基於 agent-slo.md（SLO 目標值）
- 引用 worklog-protocol.md（失敗數據來源）
- 引用 soul.md Principle 6（Fail gracefully）
- 引用 evaluation-protocol.md（retry 策略的模型升級邏輯）
- 擴展 workflow.yaml error_policy（circuit breaker 是 error_policy 的系統級版本）
