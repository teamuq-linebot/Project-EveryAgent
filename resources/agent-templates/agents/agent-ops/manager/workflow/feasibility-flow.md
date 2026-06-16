### Step 1: rule_check（manager_self）

依據 `org.md#Feasibility Rules` 逐條評估任務是否可執行。

**Input:** `insight_result`

**判斷邏輯（依序評估，第一條觸發即停止）：**
| 條件 | 觸發結果 |
|------|----------|
| task_type == query | `proceed_query` |
| info_complete == false | `need_clarification` |
| target_files 超出 scope | `out_of_scope` |
| risk_level == full_review | `proceed_with_warning` |
| 其他 | `proceed` |

記錄觸發的條件（或「無條件觸發，預設 proceed」）。

**on_error:** continue

---

### Step 2: decision（manager_self）

根據 rule_check 結果，設定決策欄位並組成向用戶說明的訊息。

**Actions:**
- 將 rule_check 觸發結果對應到 `decision` 欄位值
- 若非 `proceed`，撰寫清楚的 `message` 說明原因與下一步行動
- 若為 `out_of_scope`，填入 `referral` 轉介對象

**Output:** `feasibility_result`
```json
{
  "decision": "proceed | proceed_query | proceed_with_warning | need_clarification | out_of_scope",
  "message": "向用戶說明的訊息（若非 proceed）",
  "referral": "轉介對象（若 out_of_scope）"
}
```
**on_error:** continue
