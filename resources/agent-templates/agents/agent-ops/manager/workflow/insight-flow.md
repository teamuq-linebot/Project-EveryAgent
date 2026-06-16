### Step 1: context_load（manager_self）

上游 `/tuq` 已完成路由分類。此步驟載入分析所需的背景資料。

**Actions:**
- 讀取 `agents/agent-ops/_protocols/definitions.md`，了解當前 agent 版圖與 scope 規則
- 若請求中已識別 target_agent，讀取該 agent 的 `README.md` 與 `soul.md`，掌握現況
- 掃描 `agents/agent-ops/manager/memory/` 目錄，注意近期記憶中是否有相關前例或注意事項

**on_error:** continue（略過無法讀取的檔案，繼續下一步）

---

### Step 2: needs_analysis（manager_self）

根據 context_load 載入的資料，深度理解用戶在 agent-ops 領域的真實需求。

**分析維度：**
- **任務類型**：查詢/說明 | 新建 agent | 修改現有 agent | 刪除 | 診斷/分析
- **影響範圍**：哪個 agent？哪些檔案？跨 team 影響？
- **風險等級**：核心檔案（soul.md、workflow.yaml）| 輕量（tools.md、skills.md）| 無修改（查詢）
- **資訊完整性**：目標 agent 明確？修改規格足夠？

**Output:** `insight_result`
```json
{
  "task_type": "query | create | modify | delete | analyze",
  "target_agent": "目標 agent 名稱（若有）",
  "target_files": ["預期會影響的檔案"],
  "risk_level": "none | lightweight | full_review",
  "info_complete": true
}
```
**on_error:** continue（Manager 依原始請求繼續）
