# Team Review Protocol

## 目的

定期或按需檢討團隊的人力配置、分工合理性、工作效能，確保團隊結構持續符合業務需求。

## 觸發方式

| 方式 | 如何觸發 | 頻率 |
|------|---------|------|
| 手動 | `/tuq-agent 檢討 {team} team` | 按需 |
| 定期 | `/schedule` 設定 cron job | 建議每月一次 |

## 執行流程

### Step 1: 收集現況
**執行者：Evolution agent**

1. 讀取目標 team 的 manager/org.md — 了解現有組織結構
2. 讀取每個 agent 的 soul.md — 了解職責範圍
3. 分析 worklog 數據 — 工作負載、完成率、平均耗時
4. 產出：現況摘要

### Step 2: 外部研究
**執行者：Evolution agent**

1. WebSearch 搜尋該行業的標準分工模式
2. 對照陳宗賢組織學六要素：
   - 專業化：角色分工是否夠細？
   - 部門化：是否需要子部門？
   - 指揮鏈：Manager 到 worker 的路徑是否清晰？
   - 控制幅度：Manager 管轄人數是否合理（建議 3-7 人）？
   - 集權 vs 分權：決策權分配是否恰當？
   - 正式化：規範文件是否完整？
3. 產出：業界對照分析

### Step 3: 差距分析
**執行者：Evolution agent**

1. 現有角色 vs 業界標準角色 — 覆蓋度
2. 識別缺口（缺失角色）和冗餘（重疊職責）
3. 產出：差距清單

### Step 4: 提出建議
**執行者：Evolution agent**

1. 精簡版方案（最小改動）
2. 完整版方案（理想狀態）
3. 每個方案標注：新增/修改的 agent、工作量估計、影響範圍
4. 優先順序 + 理由
5. 產出：改善提案

### Step 5: Governance 審查
**執行者：Governance agent**

1. 審查提案是否合理
2. 評估對現有系統的影響
3. 判斷：approve / request_changes / reject
4. 產出：審查意見

### Step 6: 執行（如果 approved）
**執行者：Agent Builder**

1. 建立新 agent（如果有）
2. 更新 manager org.md
3. 更新 CLAUDE.md registry
4. 更新 manager workflow.yaml（如果流程變更）

### Step 7: 驗證 + 報告
**執行者：Agent Ops Manager**

1. health-check.sh 確認結構完整
2. 新 agent 的 soul.md/tools.md/workflow.yaml 規範一致性
3. 產出最終報告 + 工時打卡明細

## 評估維度

| 維度 | 指標 | 數據來源 |
|------|------|---------|
| 覆蓋度 | 業界標準角色覆蓋率 | Evolution 外部研究 |
| 效率 | 平均 duration_seconds | worklog JSON |
| 完成率 | completed / (completed + failed + orphaned) | worklog JSON |
| 負載均衡 | 每個 agent 的任務數分佈 | worklog JSON |
| 組織健康 | 陳宗賢六要素評分（1-5） | Evolution 分析 |

## 輸出模板

```
## Team Review Report: {team_name}

**審查日期**：YYYY-MM-DD
**審查類型**：定期 / 按需
**審查者**：Evolution agent

### 1. 現有結構
（組織圖）

### 2. 工作負載分析
（worklog 數據表）

### 3. 業界對照
（覆蓋度表）

### 4. 差距清單
（缺失/冗餘角色）

### 5. 改善建議
#### 方案 A（精簡）
#### 方案 B（完整）

### 6. 陳宗賢六要素評分
| 要素 | 評分 | 說明 |
（1-5 分）

### 7. 決議
Governance: approve / request_changes / reject

### 8. 工時打卡明細
（標準格式）
```

## Flow 生命週期管理

### 新建 Flow 的條件
- 同一場景在 worklog 中出現 3+ 次
- 現有 flow 無法覆蓋（步驟有結構性差異）
- Evolution 提案 + Governance 核准
- 流程：Evolution 分析 worklog → 提案新 flow → Governance 審查 → Agent Builder 建立

### 歸檔 Flow 的條件
- 連續 2 個 review 週期沒有被使用（依 worklog 數據判斷）
- 被其他 flow 完全覆蓋（功能重疊）
- 移到 workflow/archived/ 而非刪除（保留歷史參考）

### 改善 Flow 的條件
- 該 flow 的 worklog 失敗率 > 20%
- 使用者回饋不滿意
- Evolution 外部研究發現更好做法
- 流程：Evolution 分析 → 提出改善方案 → Governance 核准 → Agent Builder 修改

### Review 時的 Flow 檢查清單
- [ ] 列出所有現有 flow 檔案（find workflow/ -name '*-flow.md'）
- [ ] 每個 flow 的使用次數（從 worklog 統計）
- [ ] 識別高頻場景但無專屬 flow 的情況
- [ ] 識別有 flow 但 0 使用的情況
- [ ] 產出建議：新建 / 歸檔 / 改善
