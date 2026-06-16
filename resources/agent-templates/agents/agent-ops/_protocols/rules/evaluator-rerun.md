# Rule: Evaluator 必須重新確認（evaluator-rerun）

**版本**：1.0  
**生效日期**：2026-04-15  
**適用範圍**：所有 Manager、所有包含 evaluate 步驟的 flow  

---

## 規則

任何 flow 中，當 Evaluator 回傳 REVISE，且 worker 完成修訂後：

**Manager 必須重新派遣 Evaluator 確認**，不得自行判定修訂已通過。

```
正確流程：
content-designer 修訂 → evaluate_content（再次）→ PASS → 進下一步
                                                   ↓ REVISE（最多2次）→ 退回修訂
```

## 違規行為（禁止）

- ❌ Manager 審閱修訂清單後自行宣告「PASS，進下一步」
- ❌ 以「節省 token」為由跳過 re-evaluate
- ❌ Manager 對比 revision_notes 後自行判定「問題都解決了」

## 理由

Manager 沒有能力替代 Evaluator 做品質判定。Evaluator 的存在就是為了提供獨立的品質把關。跳過這一步會讓 REVISE 循環的設計形同虛設。

## 適用 flow

- `agents/edu/manager/workflow/edu-flow.md` — evaluate_content 步驟
- `agents/sw/manager/workflow/` — 任何包含 evaluate 的步驟
- `agents/bni/manager/workflow/` — 任何包含 evaluate 的步驟
- 所有未來新建的 Manager flow

## REVISE 循環上限

最多循環 **2 次**。第 2 次仍回傳 REVISE 時，Manager 回報用戶並交付現有最佳草稿，不繼續強制循環。「最佳草稿」= 最後一次 content-designer 完成的修訂版（即 session directory 中最新的 design_revised 檔案）。

## Evaluator 補充說明退回（特殊機制）

當 Manager 判定 Evaluator 的 revision_notes 不夠具體時，可退回 Evaluator 要求補充說明（最多 1 次）。此退回**不計入** REVISE 循環次數，屬於獨立的品質把關機制。

循環計數僅記錄「content-designer 完成修訂 → Evaluator 再次確認」的完整循環。
