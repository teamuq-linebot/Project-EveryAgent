# Worklog Timing Protocol（雙層計時）
<!-- self-added 2026-04-23 — 新檔 -->

## 背景
LLM agent 不是 long-running process，而是「被叫醒→做事→退出」的生命週期。
worklog.sh 記錄的 started_at / ended_at 受以下因素干擾：
- Session idle（auto-mode 等待用戶、user 離開）
- Subagent tool-layer stall（Google Drive 同步 / sandbox block / container stall）
- Claude Code 主對話被 pause 後 resume

於是 `ended_at - started_at`（=`duration_seconds`）**不等於**實際活躍時間。

## 雙層 timing 機制

### Layer 1: Raw duration（JSON 實值）
來源：`scripts/worklog.sh start/end` 寫入的 started_at / ended_at
用途：wall-clock 上的「從開工到收工的時間區間」（含任何 idle）
缺點：包含 session idle + tool stall

### Layer 2a: Event-gap-adjusted duration（idle 扣除）
來源：後處理 `.claude/scripts/worklog_adjusted.py`
邏輯：排序全局 events，連續兩事件間隔 > IDLE_THRESHOLD_S（預設 1800s）即判為 session idle；
從 worklog 區間扣除與 idle gap 的 intersection。
用途：Manager-level「session 停機」去除
IDLE_THRESHOLD_S 可調整：多人協作專案 5-10 min、單人深度工作 30-60 min

### Layer 2b: Tool duration_ms（subagent 權威）
來源：Manager 在呼叫 Agent tool 時，從返回 metadata 取得 `<usage>duration_ms:</usage>`
用途：subagent 被 dispatch 後的真正 tool-layer 執行時間（比 JSON ended_at 權威）
優勢：即使 subagent tool stall（卡在 Google Drive 同步），duration_ms 仍反映真實 wait time；
      不受 worklog.sh end 寫入延遲干擾
適用：所有透過 Manager Agent tool 派遣的 subagent 任務

## 使用規則

| 計時情境 | 使用層級 | 理由 |
|---|---|---|
| Manager 本身活躍時間 | Layer 1 + 2a | Manager 運行於主對話，有 session idle 問題 |
| Subagent 執行時間（單次 Agent tool 派遣） | **Layer 2b（權威）** | Tool-layer metadata 最貼近真實 |
| Team-level 報告 / 工時明細 | Layer 2a + 2b 混合 | 先以 2a 扣除 idle，再對單一 worker 替換為 2b |
| 粗略 wall-clock（給 PM 報表） | Layer 1 | 直接用 JSON 實值 |

## Manager SOP：派遣後記錄 duration_ms

每次 `Agent(...)` 呼叫返回後，Manager 必做：
1. 從返回的 `<usage>` block 中擷取 `duration_ms`
2. 記錄到當次 dispatch 的 context（或寫入該 dispatch 的 output_summary 尾部 `[tool_dur=${ms}ms]`）
3. 最終合成打卡明細表時：若該 worker 的 raw duration 與 tool duration_ms 差異 > 10%，採 tool duration_ms

## 工具

### 偵測 idle gap + 扣除
`.claude/scripts/worklog_adjusted.py`（支援 --threshold 參數、--tool-metadata 輸入源）

### Raw 打卡
`scripts/worklog.sh start / end`（不變）

## Self-growth 加註
- 2026-04-22 self-growth-all run 中，Gov-PathB 與 Manager 雙雙出現 13h raw duration 異常，觸發本 protocol 建立
- 參考 `agents/agent-ops/manager/memory/retrospective-2026-04-22-self-growth-all.md`
