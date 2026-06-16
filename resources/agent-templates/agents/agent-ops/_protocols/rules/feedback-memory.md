# Feedback Memory Protocol（用戶回饋觸發記憶）

## 1. 目的
當用戶對 agent 的產出表達正面或負面回饋時，自動觸發記憶保存，讓 agent 持續學習改進。

## 2. 適用範圍
所有 type 為 Manager、Director、Officer 的 agent 必須實作此協議。
Worker 不直接面對用戶，不適用。

## 3. 回饋偵測規則

### 3.1 負面回饋關鍵語意（Negative Feedback Signals）

偵測到以下語意時，判定為負面回饋：

| 類別 | 關鍵詞/片語（中文） | 關鍵詞/片語（英文） |
|------|-------------------|-------------------|
| 品質差 | 寫得很爛、太差了、品質不好、不及格 | terrible, bad quality, awful, poor |
| 錯誤 | 錯了、不對、搞錯了、有問題 | wrong, incorrect, mistake, error |
| 重做 | 重來、重做、重新、再做一次 | redo, start over, do it again |
| 不滿 | 不是我要的、不是這樣、偏了 | not what I wanted, off track, missed the point |
| 拒絕 | 不要這個、這不行、退回 | reject, not acceptable, won't work |

### 3.2 正面回饋關鍵語意（Positive Feedback Signals）

偵測到以下語意時，判定為正面回饋：

| 類別 | 關鍵詞/片語（中文） | 關鍵詞/片語（英文） |
|------|-------------------|-------------------|
| 肯定 | 很好、不錯、讚、厲害、做得好 | great, good job, nice, excellent, well done |
| 正確 | 對、正確、沒錯、就是這樣 | correct, right, exactly, that's it |
| 滿意 | 完美、滿意、超讚、漂亮 | perfect, satisfied, awesome, beautiful |
| 繼續 | 繼續這樣做、保持、就照這個方向 | keep it up, continue this way, more of this |

### 3.3 偵測邏輯

```
IF user_message contains negative_signal:
  sentiment = "negative"
  action = save_negative_feedback_memory
ELSE IF user_message contains positive_signal:
  sentiment = "positive"
  action = save_positive_feedback_memory
ELSE:
  sentiment = "neutral"
  action = proceed_normally
```

**注意**：語意偵測不僅限於精確關鍵字比對，agent 應理解上下文語意。例如「這什麼東西」雖不在列表中，但語意明顯是負面回饋。

## 4. Memory 保存格式

保存到 `agents/{team}/{agent}/memory/feedback-{YYYY-MM-DD}-{seq}.md`：

```markdown
---
topic: user-feedback
created: {ISO date}
agent: {agent-name}
trigger: user_feedback
sentiment: positive | negative
---

## 用戶原話
> "{用戶的回饋訊息}"

## 當時任務
{簡述正在執行什麼任務}

## 分析
{為什麼用戶這樣說？哪裡做對/做錯了？}

## 教訓
{正面：繼續什麼做法 / 負面：下次應該怎麼改}
```

## 5. Workflow 整合

### 5.1 回饋偵測步驟

在所有 Manager/Director/Officer 的 workflow.yaml 中，`classify` 步驟應包含回饋偵測：

```yaml
- id: classify
  action: dispatch_agent | manager_self
  note: "分類任務意圖，同時偵測用戶回饋語意"
  # 若偵測到回饋 → 先保存 memory，再繼續處理任務
```

### 5.2 處理流程

```
偵測到回饋
  ↓
[1] 保存 feedback memory（寫入 memory/ 目錄）
[2] 更新 MEMORY.md 索引
[3] 如果是負面回饋且用戶要求重做 → 重新執行任務
[3] 如果只是評價（無後續任務）→ 回覆確認已記錄
```

## 6. 回饋聚合與升級

### 6.1 聚合規則
- 同一類型的負面回饋出現 3+ 次 → 合併為 pattern memory
- 同一類型的正面回饋出現 3+ 次 → 升級為 skill（參考 memory-hygiene.md §7）

### 6.2 升級路徑
```
單次回饋 → feedback memory
  ↓ 3+ 次同類
pattern memory（合併）
  ↓ 被驗證有效
skill（新增到 skills.md）
```

## 7. 範例

### 負面回饋範例
用戶：「這個程式碼寫得太爛了，完全沒考慮到錯誤處理」

```markdown
---
topic: user-feedback
created: 2026-04-15
agent: sw/manager
trigger: user_feedback
sentiment: negative
---

## 用戶原話
> "這個程式碼寫得太爛了，完全沒考慮到錯誤處理"

## 當時任務
為 API endpoint 新增 CRUD 功能

## 分析
Developer 在實作時沒有加入 try-catch 和輸入驗證，導致程式碼缺少錯誤處理。

## 教訓
派遣 Developer 時，dispatch prompt 中必須明確要求「包含完整的錯誤處理：輸入驗證、try-catch、有意義的錯誤訊息」。
```

### 正面回饋範例
用戶：「這次的架構設計很好，分層很清楚」

```markdown
---
topic: user-feedback
created: 2026-04-15
agent: sw/manager
trigger: user_feedback
sentiment: positive
---

## 用戶原話
> "這次的架構設計很好，分層很清楚"

## 當時任務
設計新 microservice 的架構

## 分析
Architect 使用了 clean architecture 分層，用戶認可這個方向。

## 教訓
繼續使用 clean architecture 分層模式。派遣 Architect 時可引用此偏好。
```

## 8. 禁止行為
- 不可忽略負面回饋（不存就是不學）
- 不可存入無分析的原始回饋（必須有教訓）
- 不可操作其他 agent 的 feedback memory
- 不可將正面回饋曲解為「不需要改進」
