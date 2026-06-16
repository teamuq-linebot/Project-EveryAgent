### hitl_gate（Human-in-the-Loop checkpoint）

依 `agents/agent-ops/_protocols/hitl-protocol.md` 判斷是否需要暫停等待用戶確認。

**Input:** `feasibility_result`

**判斷邏輯：**
1. 從 feasibility_result.target_files 判斷風險等級
2. 對照 hitl-protocol.md Tier 分類
3. Tier 1 → 自動通過
4. Tier 2 → 記錄後通過（deliver 時告知用戶）
5. Tier 3 → 暫停，向用戶輸出確認訊息，等待回覆

**Tier 3 暫停訊息格式：**
```
⚠️ 高風險操作需要確認

即將執行：
- {操作描述}
- 影響檔案：{列表}
- 風險原因：{原因}

請回覆下列之一：
- `confirm`          → 執行
- `abort`            → 取消
- `modify: <描述>`   → 要求改計畫
```

**用戶回覆判斷（嚴格 token，大小寫不敏感，依 `agents/agent-ops/_protocols/hitl-protocol.md` §3）：**
| 用戶回覆         | 對應 Output                                |
|-----------------|--------------------------------------------|
| `confirm`       | approved → 繼續 execute                     |
| `abort`         | cancelled → 回報取消，停止流程              |
| `modify: ...`   | modified → 帶修改意見回 feasibility 重判斷   |
| 其他 / 無回應    | 視為 `abort`（不推斷為 confirm）            |
| 10 分鐘無回應    | timeout → 通知用戶後停止                    |

**on_error:** report_and_stop（寧可停止也不冒險）
