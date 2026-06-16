# Agent SLO Definitions

## 1. 目的

為每個 agent 類型定義服務品質目標（SLO），讓 Evolution 和 Governance 有量化基準進行監控和改善。

## 2. SLO 指標定義

### 2.1 成功率 (Success Rate)
計算：completed / (completed + failed) × 100%
數據源：agents/worklogs/index.jsonl

### 2.2 平均耗時 (Avg Duration)
計算：avg(duration_seconds) for completed tasks
數據源：agents/worklogs/index.jsonl

### 2.3 靜默失敗 (Silent Failures)
計算：started 但超過 10 分鐘無 end 的任務
數據源：各 agent worklog/ 目錄中 status="started" 的檔案

### 2.4 pass^k 可靠度指標 <!-- added 2026-06-08: adopt-bp-rules-20260608 rollout -->

**定義**：pass^k = 「k 次獨立試驗全部成功」的機率 = (單次成功率)^k。
例：單次成功率 0.75、k=3 → 0.75³ ≈ 42%。

**與 pass@k 的區別**：
- pass@k：k 次中**至少 1 次**成功即可（衡量能力上限）
- pass^k：k 次**全部**成功才通過（衡量穩定性下限）

**適用範圍**：面向用戶、需重複可靠執行的 agent（如 billing、生產線控制、對外交付類）；不適用於允許重試的探索型 agent。

**量法**：
1. 對同一任務跑 k 次獨立試驗（k 建議值：面向用戶 agent k=3；關鍵生產線 k=5）
2. 全部 PASS 才算該輪通過；任一次失敗即為 pass^k FAIL
3. 計算：pass^k = (worklog 中連續 k 次成功的輪次數) / (總試驗輪次數)

**門檻建議**：
| Agent 類型 | pass^k 目標 | k 值 | 警戒值 |
|-----------|------------|------|--------|
| 對外交付（billing 等）| ≥ 80% | 3 | < 65% |
| Manager 類 | ≥ 85% | 3 | < 70% |
| Worker 類（核心流程）| ≥ 75% | 3 | < 60% |

**與既有 SLO 串接**：pass^k 低於警戒值時，與§4 靜默失敗警戒同等級，直接觸發 Evolution 分析（連續 2 週低於門檻）。

**來源**：Anthropic「Demystifying Evals for AI Agents」；τ-bench（arXiv:2406.12045，提出 pass^k）。

**回指差距**：本節補強 `agents/agent-ops/evolution/memory/resource_external_research_multiagent_2026-04-14.md` 差距 6「PDCA Check / Evaluation 閉環缺失」——以 pass^k 將穩定度量化為可自動監控的閉環指標。

## 3. SLO 目標值

### Manager 類
| 指標 | 目標 | 警戒值 |
|------|------|--------|
| 成功率 | ≥ 95% | < 90% |
| 平均耗時 | ≤ 300s | > 450s |
| 靜默失敗 | 0 | > 0 |

### Worker 類 (opus)
| 指標 | 目標 | 警戒值 |
|------|------|--------|
| 成功率 | ≥ 90% | < 85% |
| 平均耗時 | ≤ 120s | > 180s |
| 靜默失敗 | 0 | > 0 |

### Worker 類 (sonnet)
| 指標 | 目標 | 警戒值 |
|------|------|--------|
| 成功率 | ≥ 90% | < 85% |
| 平均耗時 | ≤ 90s | > 150s |
| 靜默失敗 | 0 | > 0 |

<!-- 2026-04-27: Worker 類 (haiku) SLO 區塊已移除（user policy: ban haiku，全系統不再使用 haiku 層級）。原 SLO 標準已併入 Worker 類 (sonnet)。詳見 agents/agent-ops/_protocols/rules/no-haiku-policy.md。 -->

## 4. 監控流程

- `scripts/worklog-report.sh` 產出健康報告
- Evolution agent 在 team-review 時對照 SLO 目標
- 連續 2 週低於警戒值 → 觸發 Evolution 分析

## 5. 與現有協議的關係

- 引用 worklog-protocol.md（數據源）
- 引用 team-review-protocol.md（監控觸發）
- 引用 self-growth.md（agent 自我改善觸發）
