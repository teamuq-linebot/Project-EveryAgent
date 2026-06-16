### Step 1: respond_to_user（manager_self）

將 synthesize 結果以用戶語言回覆。

- 彙整各被派遣 agent 的 return payload 重點：完成了什麼、交付路徑、狀態
- failed 或缺漏回報的 agent 標註原因
- 打卡明細表已於 2026-05-28 移除（打卡機制全面廢止；工作記錄改由外部 log 處理）

**on_error:** respond_partial（用現有資料回覆，說明有部分資料缺失）
