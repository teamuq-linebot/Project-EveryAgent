# 回饋偵測流程（Feedback Detection Flow）

## 適用角色
Manager (L2)、Director (L3)、Officer (L4)

## 觸發時機
在 classify 步驟中執行，或作為獨立的 feedback_detect 步驟在 classify 之前執行。

## 執行步驟

```
[1] 掃描用戶訊息語意
  │
  ├─ 偵測負面回饋語意
  │   關鍵詞/語意：錯了、寫得很爛、重來、不對、太差、不是我要的、
  │               terrible, wrong, redo, not what I wanted
  │
  ├─ 偵測正面回饋語意
  │   關鍵詞/語意：很好、不錯、讚、正確、完美、繼續這樣做、
  │               great, correct, perfect, keep it up
  │
  └─ 中性（無回饋語意）→ 跳到正常流程
  │
  ▼
[1.5] 分類回饋對象（Feedback Target Classification）   <!-- 2026-06-07 feedback-routing Phase 0.1 新增 -->
  │
  │  判斷這條回饋指涉的是「誰的行為/產出」：
  │
  ├─ (a) MANAGER 自身行為
  │      → 任務分類錯了 / 派錯 agent / 漏派 / 合成（synthesis）摘要不對 /
  │        路由與排程決策不當 / 對用戶的回覆方式
  │      → 落點：Manager 自己的 memory（維持現狀，走 [2]）
  │
  └─ (b) WORKER 產出/行為問題
  │      → 某次 dispatch 出去的 worker 交付物品質差 / 內容錯 / 偏題 /
  │        遺漏需求 / 風格不符
  │      → 落點：該 worker 的 memory/incoming/（走 [2'] inter-agent-feedback 路由）
  │      → 同時在 Manager memory 留「輕量索引」一行（不存全文）
  │
  │  ＊無法明確歸屬時，預設 (a) Manager，並在分析欄註明「target 不確定」
  │  ＊可同時命中 (a)+(b)（例：派錯人＋那人也做差）→ 兩條都走
  ▼
[2] 保存 Feedback Memory（target=manager 時）
  檔案：agents/{team}/{agent}/memory/feedback-{YYYY-MM-DD}-{seq}.md
  格式：
    ---
    topic: user-feedback
    created: {ISO date}
    agent: {agent-name}
    trigger: user_feedback
    sentiment: positive | negative
    ---
    ## 用戶原話
    > "{用戶訊息}"
    ## 當時任務
    {上一次任務的摘要，可從最新 worklog 取得}
    ## 分析
    {為什麼用戶這樣說}
    ## 教訓
    {正面：繼續什麼做法 / 負面：下次怎麼改}
  │
  ▼
[2'] 路由至 Worker（target=worker 時）                  <!-- 2026-06-07 feedback-routing Phase 0.1 新增 -->
  檔案：agents/{worker-team}/{worker}/memory/incoming/{YYYY-MM-DD}_{manager}_{topic}.md
  格式：遵循 inter-agent-feedback.md §3 Issue Schema v2 + §4 frontmatter
        （from: {team}/{manager}, to: {worker-team}/{worker}, source: user-feedback-relay）
  並在 Manager memory/MEMORY.md 追加「輕量索引」一行（見 [3]），不複製全文。
  │
  ▼
[3] 更新 MEMORY.md 索引
  在 memory/MEMORY.md 追加一行：
  - target=manager：- [user-feedback-{date}](feedback-{date}-{seq}.md) — {sentiment}: {一句話摘要}
  - target=worker： - [routed→{worker}-{date}] — {sentiment}: {摘要}（全文已投遞 {worker}/memory/incoming/）  <!-- 2026-06-07 feedback-routing Phase 0.1 新增 routed 標記 -->
  │
  ▼
[4] 回覆用戶確認
  - 負面回饋 → "已記錄您的回饋，我會在後續工作中改進。" + 若有後續任務則繼續執行
  - 正面回饋 → "感謝回饋，已記錄成功做法。" + 若有後續任務則繼續執行
  │
  ▼
[5] 繼續正常 workflow（classify → execute → ...）
```

## 判斷準則：怎麼認定 target worker（[1.5] 最關鍵設計）   <!-- 2026-06-07 feedback-routing Phase 0.1 新增 -->

`[1.5]` 用以下**優先序**決定路由對象，避免靠模糊語意亂猜：

1. **最近一次 dispatch 的 worker（主要訊號）**：回饋出現在 Manager 剛 dispatch 某 worker 並把產出交還用戶之後 → 預設 target ＝**那個 worker**。Manager 本輪 context 就握有「上一個 dispatch 是誰、做了什麼、產出路徑」。
2. **回饋內容指涉的產出（次要訊號／可覆寫 1）**：用戶明確點名某交付物（檔名、章節、功能、某 team 的東西）→ target ＝該產出的**生產 worker**，即使它不是最近一次 dispatch。
3. **回饋指涉「決策層」字眼 → 判 Manager**：出現「為什麼派 X / 不該派 / 怎麼又找錯人 / 你理解錯我要什麼 / 漏了一塊沒做」等指向**分類·派遣·合成**的語意 → target ＝ Manager 自身（(a)）。
4. **兜底**：以上都對不上（純情緒、無具體指涉、或同一輪沒有任何 dispatch）→ 預設 (a) Manager，分析欄註明「target 不確定，暫存 manager 待 aggregate 釐清」。

> 一句話準則：**「上一棒是誰、用戶在嫌哪個產出」決定 target；嫌的是『派遣/理解/合成』就留 Manager，嫌的是『做出來的東西』就路由給做的人。**

## 回饋聚合檢查（Background Dispatch）

每次保存 feedback memory 後，Manager 應以 background 方式派遣 agent 進行聚合檢查，不阻斷用戶的主任務：

```yaml
- id: feedback_aggregate
  action: dispatch_agent
  agent: self  # Manager 自行處理，或委派給 Evolution
  run_in_background: true
  prompt: |
    掃描 memory/ 目錄中的 feedback-*.md 檔案。
    若同類回饋 ≥ 3：
      1. 合併為 pattern memory
      2. 考慮升級為 skill（依 memory-hygiene.md §7）
    若不足 3 → 無動作
```

**重要**：`run_in_background: true` 確保用戶任務不被阻斷。聚合結果靜默寫入 memory/，下次任務時自動生效。

## 備註
- 語意偵測不限於精確關鍵字，應理解上下文（如「這什麼東西」= 負面）
- 回饋保存失敗不應阻斷正常流程（on_error: continue）
- 此 flow 由 `agents/agent-ops/_protocols/rules/feedback-memory.md` 定義規則
