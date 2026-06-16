# Hierarchical Dispatch Rule（直屬 Manager 原則）

**生效日期**：2026-04-15  
**適用範圍**：所有 AgentOrg worker agents

## 規則

Worker agents 只接受來自**直屬 Manager** 的任務派遣。

## 任務來源判斷

| 來源 | 是否接受 |
|------|---------|
| 直屬 Manager | ✅ 接受並執行 |
| 其他 Team Manager | ❌ 轉交直屬 Manager |
| 使用者直接派遣 | ❌ 轉交直屬 Manager |
| 其他 Worker | ❌ 轉交直屬 Manager |
| Shared agents (任何 Manager) | ✅ 接受（Shared 變體） |

## 轉交流程

1. 停止：不執行任務
2. 轉交：將任務完整轉發給直屬 Manager（原始描述 + 來源 + 優先級）
3. 回報：告知原發送者任務已轉交

## 跨 Team 派遣的正確流程

當 Team A 的 Manager 需要使用 Team B 的 Worker（如 Edu Manager 需要用 Agent Builder）：

```
Team A Manager（如 Edu Manager）
  ↓ 提交申請（變更內容 + 理由 + 影響評估）
Team B Manager（如 Agent Ops Manager）審批
  ↓ 通過後
Team B Manager 派遣 Team B Worker（如 Agent Builder）執行
  ↓
Team B Worker 回報 Team B Manager
  ↓
Team B Manager 回報 Team A Manager
```

**錯誤做法**：Team A Manager 直接呼叫 Team B Worker → 違反直屬 Manager 原則。

### 常見跨 Team 場景

| 需求 | 發起方 | 正確路由 |
|------|--------|---------|
| 修改 agent 系統檔案（soul/workflow/tools） | 任何 Team Manager | → Agent Ops Manager → Agent Builder |
| 需要外部研究資料 | 任何 Team Manager | → 派遣**自己 team 的 researcher**（per-team 模式，2026-05-01 起） |
| 跨 team 通用計算 | 任何 Team Manager | → 直接呼叫 agents/agent-ops/_shared/calculator（Shared 例外） |
| 程式碼開發需求 | 任何 Team Manager | → SW Manager → SW Developer |

## Manager-to-Manager 直接派遣

當 Manager A 碰到超出自身 scope 的任務，且該任務明確屬於 Manager B 的管轄範圍時：

1. **直接派遣**：Manager A 用 Agent tool 派遣 Manager B，附帶完整的任務說明（變更內容 + 理由 + 影響評估）
2. **不踢回用戶**：用戶不應該成為 Manager 之間轉介的中繼站
3. **接收方可拒絕**：Manager B 收到後若判斷不在自己範圍，應回報 Manager A 並說明正確的路由

### 循環派遣防護

禁止 Manager A → Manager B → Manager A 的無限迴圈。

規則：
1. 每次跨 Team 派遣必須在 prompt 中帶入 `dispatch_chain`（已經過的 Manager 列表）
2. 若 Manager B 發現自己已在 `dispatch_chain` 中 → **停止並回報用戶**，說明任務無法在現有 team 之間路由
3. `dispatch_chain` 最大長度 = 3（超過 3 層轉介代表路由設計有問題）

範例：
```
dispatch_chain: ["edu/manager", "agent-ops/manager"]
```
若 Agent Ops Manager 又要轉回 edu/manager → 偵測到循環 → 停止並回報用戶

### 跨 Team 執行失敗處理

當 Manager B 接受任務但執行失敗時：

| 失敗類型 | Manager B 動作 | Manager A 動作 |
|---------|---------------|---------------|
| Worker 執行失敗（已重試） | 回報 Manager A：失敗原因 + 已完成的部分 | 決定是否帶著部分結果回報用戶 |
| Scope 判斷錯誤（不在 B 範圍） | 回報 Manager A：建議正確路由 | 轉派正確的 Manager（帶入 dispatch_chain） |
| Governance 審查不通過 | 回報 Manager A：審查意見 | 決定修正後重試或回報用戶 |

**關鍵原則：** Manager B 失敗時必須回報 Manager A，不得自行回報用戶。用戶只跟發起方 Manager A 互動。

### 派遣模板

Manager A 在 Agent tool prompt 中必須包含：
- 來源：哪個 Manager 轉介
- 任務說明：要做什麼
- 影響評估：涉及哪些檔案
- 用戶原始需求：用戶說了什麼

## 設計理由

所有任務透過 Manager 路由，確保：
- Manager 掌握全隊負載狀況
- 任務優先級由 Manager 統一決策
- 避免 Worker 被繞過 Manager 直接超載
- 工時 worklog 鏈條完整可追溯
