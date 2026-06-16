# Agent Ops Synthesis Rules

After all agents return, Manager follows these rules:

## 1. Check Status
- `completed` → include in synthesis
- `failed` → retry once with refined prompt. If still fails, report gap to user.

## 2. Merge Results
- 合併 Agent Builder 的建立/修改報告 + Governance 的審查結果
- 如果 Governance REQUEST_CHANGES，摘要需要修改的項目
- 移除跨 agent 的重複資訊

## 3. Resolve Conflicts
- 若 Agent Builder 和 Governance 對某個設計有歧異，呈現雙方觀點並給出 Manager 建議
- 安全/合規問題以 Governance 意見優先

## 4. Format for User
- 使用用戶的語言
- 結果優先，過程細節只在用戶詢問時提供
- 不要原樣轉發 agent 輸出 — 要合成

## 5. Failure Recovery
| Situation | Action |
|-----------|--------|
| 1 agent 失敗 | 重試一次 |
| 重試也失敗 | 回報缺口，交付部分結果 |
| Governance 拒絕 | 回傳 Agent Builder 修正，最多兩輪 |
| 需要用戶澄清 | 詢問後繼續 |
| 所有 agent 失敗 | 如實回報，建議替代方案 |

每個 agent 最多重試 1 次。Governance ↔ Agent Builder 修正循環最多 2 輪。

## 6. 派遣結果彙整格式

**多 agent（agents >= 2）**：完整表格
```
| Agent | input_summary | output_summary | status |
|-------|---------------|----------------|--------|
| **總計** | {N} agents | | {pass}/{fail} |
```

**單 agent**：inline 格式
```
{Agent} ({model}) — {status}
```

- failed 標註原因
- 總計行：agent 數、成功/失敗數
