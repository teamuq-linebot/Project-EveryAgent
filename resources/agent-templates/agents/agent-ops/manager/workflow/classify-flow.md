### classify（Manager inline 分類）

Manager 自行分析用戶請求，產出 `intent_result`。不再派遣外部 intent agent。

**分類邏輯：**
Manager 根據用戶請求語意，直接判斷：

**Expected Output:** `intent_result`
```json
{
  "task_type": "query | create | modify | delete | analyze",
  "target_agent": "目標 agent（若識別到）",
  "target_files": ["可能影響的檔案"],
  "risk_level": "none | lightweight | full_review",
  "dispatch_plan": ["建議派遣的 agent 列表"]
}
```

**on_error:** 無法判斷時，向用戶詢問澄清
