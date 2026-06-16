# Log Protocol

> 建立：2026-06-07（trace-memory-overhaul-20260607，Phase 0 Batch A）
> 權威設計：`output/agent-ops/memory-improvement-20260606/phase0/log-layer-mvp-design.md`
> 定位：記憶金字塔最底層 — 每完成一棒任務寫一筆**輕量 JSONL 事件**，餵下游 access-frequency 價值模型、每日 rollup、組織健康指標。

---

## 0. 目的與界線（這不是打卡）

本 protocol 定義 AgentOrg 的**事件 log 層**：每個 agent 在**任務收尾**寫一筆事件（誰派誰、做了什麼、結果、動到哪些檔、引用了哪些 memory、有無用戶回饋）。

### 與已 OBSOLETE 的 worklog / punch 明確劃界

2026-05-28 移除的 worklog（`worklog-protocol.md`）/ punch（`punch-protocol.md`）是「**每 agent 開工＋收工兩次寫入、含 duration 計時、孤兒偵測 sweep、status legacy coerce 表、TeamUQ AppSync 上報**」的重機制。本 log 層**不是**它的復活：

| 舊 worklog / punch（已移除） | 本 log 層 |
|---|---|
| 開工卡 + 收工卡（兩次寫入） | **只在收尾寫一筆** |
| `started_at` / `ended_at` / `duration_seconds` 計時 | **無計時**，只記事件寫入時刻 `ts` |
| orphan 偵測器 + cron sweep + heartbeat | **無孤兒偵測、無 sweep、無 heartbeat** |
| status legacy auto-coerce 表 | **無 coerce 表**（直接用 canonical 三值） |
| TeamUQ AppSync 上報 | **無上報**，純本地 JSONL |
| `agents/{team}/{agent}/worklog/*.json` | `agents/_log/YYYY-MM-DD.jsonl`（中央按日） |

> **看到 `agents/_log/` 請勿誤認打卡回來了**。本 log 不沿用 `worklog.sh`、不做開工卡 / 計時 / 孤兒偵測 / 上報。OBSOLETE 文件僅存考古，**不得**據此在 log 層疊加任何打卡語義。

---

## 1. 事件 Schema v1（單一事實來源）

每筆 log 是一個 JSON 物件，**獨立一行**（JSONL）。

### 1.1 欄位定義（9 欄）

| 欄位 | 型別 | 必填 | 語意 | 來源 |
|------|------|:---:|------|------|
| `schema` | int | ✅ | schema 版本，v1 = `1`（只加不改，演進相容） | 固定 |
| `ts` | ISO 8601 string | ✅ | 事件寫入時間（任務收尾時刻；**非**開工，無 duration） | 自報 |
| `trace_id` | string | ✅ | 跨 agent 串接同一使用者請求（manager 產生並下傳） | 自報 |
| `task_id` | string \| null | ⬜ | 子任務 ID（單一 worker 這一棒） | 自報 |
| `dispatcher` | string | ✅ | 派工方，`{team}/{agent}` 或 `user`（用戶直接對 manager 講話時） | 自報 |
| `worker` | string | ✅ | 執行方，`{team}/{agent}`（自己） | 自報 |
| `task` | string | ✅ | 任務一句話摘要（≤ 120 字，純描述「做了什麼」） | 自報 |
| `outcome` | enum | ✅ | `success` \| `partial` \| `fail`（沿用 canonical 三值語意，**不引入** legacy coerce 表） | 自報 |
| `files_touched` | string[] | ⬜ | 本棒實際寫/改的檔案相對路徑（不含唯讀 Read） | 自報＋探勘可補 |
| `memories_referenced` | string[] | ✅(可空 `[]`) | 本棒**讀取或引用**到的 memory 檔路徑（access-frequency 的核心燃料） | 自報為主、探勘補 |
| `user_feedback` | object \| null | ⬜ | 用戶回饋訊號（見 1.2），無則 `null` | 自報 |
| `src` | enum | ✅ | `self`（自報）\| `mined`（探勘補）\| `merged`（兩者合併） | 寫入端標 |

> MVP 必填最小集：`schema, ts, trace_id, dispatcher, worker, task, outcome, memories_referenced, src`。其餘（`task_id, files_touched, user_feedback`）MVP 可選填。

### 1.2 `user_feedback` 子物件

```jsonc
"user_feedback": {
  "present": true,                 // 有無回饋
  "sentiment": "negative",         // positive | negative | neutral
  "target": "sw/developer",        // 回饋對象：manager 自己的事 → manager；worker 產出的事 → 該 worker
  "snippet": "錯了，應該用 X"      // 用戶原話片段（≤ 80 字，供回饋路由器分類）
}
```

`target` 是與 **feedback 路由（inter-agent-feedback）的接點**（見 §7）：路由器的「分類回饋對象」步驟可直接吃這個欄位，把 worker 相關回饋以 inter-agent-feedback 格式寫進該 worker 的 `memory/incoming/`。

### 1.3 JSONL 範例（三筆，同一 trace）

```jsonl
{"schema":1,"ts":"2026-06-07T10:32:11+08:00","trace_id":"trace-x9","task_id":null,"dispatcher":"user","worker":"sw/manager","task":"接收『修登入 bug』請求，拆解並派遣 developer","outcome":"success","files_touched":[],"memories_referenced":["agents/sw/manager/memory/MEMORY.md","agents/sw/manager/memory/feedback_dispatch_discipline.md"],"user_feedback":null,"src":"self"}
{"schema":1,"ts":"2026-06-07T10:48:03+08:00","trace_id":"trace-x9","task_id":"x9-dev-1","dispatcher":"sw/manager","worker":"sw/developer","task":"修復 login 422：補 token 空值檢查","outcome":"success","files_touched":["src/auth/login.ts"],"memories_referenced":["agents/sw/developer/memory/MEMORY.md","agents/sw/developer/memory/known_login_pitfalls.md"],"user_feedback":null,"src":"self"}
{"schema":1,"ts":"2026-06-07T10:55:20+08:00","trace_id":"trace-x9","task_id":null,"dispatcher":"user","worker":"sw/manager","task":"回報修復結果給用戶","outcome":"partial","files_touched":[],"memories_referenced":[],"user_feedback":{"present":true,"sentiment":"negative","target":"sw/developer","snippet":"還有一個 case 沒處理到，空字串也要擋"},"src":"self"}
```

---

## 2. 落點與併發政策

### 2.1 落點：中央按日單檔

```
agents/_log/
├── YYYY-MM-DD.jsonl          # 當日活躍事件（append-only，熱）
├── archive/
│   └── YYYY-MM.jsonl.gz      # 已被 rollup 消化、壓縮歸檔（按月聚合，冷）
├── .access/                  # rollup 產出的「當日 access 增量」中間檔（§6.1）
└── README.md                 # 用途說明，schema 指向本 protocol
```

採**中央按日單檔**（而非各 agent `memory/_log/`）：log 層的三個下游（access、rollup、組織指標）都是**跨 agent 彙整**，中央單檔讓彙整變成「掃一個檔」而非遍歷全 agent 目錄；retention 也只需處理一份/天。並避免把 `_log/` 塞進 `memory/` 而違反「raw log 不進 memory」邊界（見 memory-protocol §「What NOT to Remember」）。

### 2.2 併發寫入政策（Google Drive / Windows 現實）

- **單行 append + 換行結尾**：每筆獨立一行，JSONL 天然容忍部分行損毀（壞行跳過即可，不毀整檔）。
- **只 append，永不重寫整檔**：避免讀-改-寫，降低 Google Drive 同步覆蓋風險。
- **不追求即時強一致**：log 是事後分析用，非交易系統。偶發漏寫由 §3.2 transcript 探勘補回（標 `src:"mined"`）。
- MVP 不做 per-worker `.staging/`；若實測有掉行再引入由 rollup 合併。

---

## 3. Population（自報為主 + 探勘為輔）

### 3.1 Agent 自報（主來源）

寫一筆 log 的責任**綁在每一棒的收尾**，不另設開工卡（與舊打卡的關鍵差異）。

- **Manager 端**：在 `memory_check` 之後、回報用戶之前，新增 `log_event` step（加法 / self-added），寫一筆事件：本輪 `dispatcher`（user 或上游）、自己為 `worker`、`task` 摘要、`outcome`、`memories_referenced`（本輪 memory_check 讀過的）、`user_feedback`（若本輪偵測到回饋，帶 target/sentiment/snippet）。
- **Worker 端**：收尾時新增 `log_event` step（加法 / self-added），寫一筆：`dispatcher`＝派我的 manager、`worker`＝自己、`task` 摘要、`outcome`、`files_touched`（本棒寫過的檔）、`memories_referenced`（本棒 MEMORY block 讀過的）。

**寫入方式**：呼叫 `node .claude/scripts/log-event.js`（沿用專案 Bash-First 政策，腳本邏輯極簡 = 組 JSON + append 一行，避免 inline 複雜 script 觸發權限攔截）。

dispatch prompt 需帶的最小資訊：`trace_id`（manager 產生並下傳）、`dispatcher`（誰派的）。worker 自知 `worker` / `files_touched` / `memories_referenced` / `outcome`。

### 3.2 Transcript 探勘（補來源，post-hoc 腳本）

自報靠自律會漏；用 `node .claude/scripts/mine-transcript-access.js` 事後掃本機 session transcript（`~/.claude/projects/*/*.jsonl`）補 access 訊號：

1. **Read tool 呼叫** path 命中 `agents/**/memory/**.md` 的 → 補進 `memories_referenced`（自報最易漏：worker 讀了某 memory 但收尾沒列）。
2. **Edit / Write tool 呼叫** target path → 補 `files_touched`。
3. 輸出標 `src:"mined"` 的 access 增量檔到 `agents/_log/`，由每日 rollup 在歸檔前消化。

**唯讀掃描**：transcript 在本機 `~/.claude/projects/`（非 T:\），無 Google Drive metadata 限制，標準檔讀即可，零併發風險。探勘**只補 access / files 兩個「多算無害」的欄位**，不覆寫自報的 `outcome` / `user_feedback`（避免誤配汙染關鍵欄位）。

### 3.3 自報 vs 探勘的分工

| 訊號 | 自報 | 探勘 | 採用 |
|------|:---:|:---:|------|
| dispatcher / worker / trace_id | ✅準 | ⚠️需推斷 | 自報優先 |
| task 摘要 / outcome | ✅只有自己知道 | ❌ | 僅自報 |
| user_feedback | ✅manager 當下判斷 | ⚠️難 | 僅自報 |
| `memories_referenced`（Read 命中） | ⚠️易漏 | ✅最準 | **探勘優先補全** |
| `files_touched` | ✅ | ✅ | 兩者 union |

---

## 4. Retention / 淨減量（硬規則）

log 是金字塔**最底層**，被「每日 rollup」消化後**必須收掉**，否則 `agents/_log/` 無限長大。違反金字塔守則「每層吃掉下層」。

### 4.1 生命週期

```
當日 .jsonl（append-only，熱）
  └─[每日 rollup 完成且 SHA256 驗證通過]→ gzip 壓縮 → 併入 archive/YYYY-MM.jsonl.gz（冷）→ 刪當日明文檔
       └─[archive 月檔]→ retention 3 個月後刪除明細，只留「每月聚合統計」一行
```

### 4.2 硬規則（淨減量，給 Phase 2 rollup 落地時遵守）

1. **rollup 未完成不收 log**：當日檔只有在「每日 rollup 已生成 + SHA256 驗證通過」後才壓縮歸檔。
2. **歸檔即收明文**：當日 `.jsonl` 壓進 `archive/YYYY-MM.jsonl.gz` 後刪除明文，**禁止熱檔與 archive 並存同一天的明細**（避免把 1 種 bloat 變多種）。
3. **archive 也有天花板**：archive 明細保留 3 個月（可調），逾期只留每月聚合（總事件數、各 outcome 計數、top dispatch 對、feedback-routing 率），明細刪除。
4. **access 訊號先落袋再收 log**：歸檔前，當日的 `memories_referenced` 必須已被 §6.1 累計進 access 增量檔（否則 access 訊號隨 log 被收而流失）。

> 量級：3 個月 archive 在 94-agent 規模下 gzip 後 < 數十 MB，可控。

---

## 5. log 為運行資料（不入快照）

`agents/_log/` 是**運行資料**，不入 git 快照、不入 `agents.zip`。`.access/` 中間檔同。歸檔 `.gz` 為冷資料，亦不隨 agent 定義一起版控。

---

## 6. 下游接口

### 6.1 access-frequency（給 Phase 1 價值模型）

- **算法**：每日 rollup 掃當日（合併後）事件，對每個出現在 `memories_referenced` 的 memory 檔：
  - `access_count += 該檔當日被引用次數`
  - `last_accessed = max(現有, 當日最晚引用 ts)`
- **中間產物**：log 層只負責產出「當日 access 增量」中間檔（`agents/_log/.access/YYYY-MM-DD.access.json`）。**回寫 memory frontmatter 是 Phase 1.1 的事**（新增 `last_accessed` / `access_count` 兩欄，與現行 frontmatter「只加不改」相容）。
- **與 keep_score 接點**：Phase 1.2 把 hygiene `recency_factor` 來源從 `last_update`（編輯日，弱訊號）改為 `last_accessed`（使用日，真實訊號）；`importance==5` 豁免不受影響。

### 6.2 組織健康指標（給 Phase 3，精確值委派 `agents/agent-ops/_shared/calculator`）

全部可從中央 log 純掃描算出：

| 指標 | 從 log 怎麼算 | 健康訊號 |
|------|---------------|----------|
| **dispatch 比例** | 對每個 manager：`worker≠自己且 dispatcher=自己` 事件數 ÷ 該 manager 總事件數 | 偏低＝manager 自己做太多，未善用團隊 |
| **feedback-routing 率** | `user_feedback.present 且 target≠收回饋的 manager` 的事件中，後續確有對應 worker `memory/incoming/` 寫入的比例 | 偏低＝回饋囤在 manager、worker 學不到 |
| **worker 使用率 / 閒置** | 各 worker 在期間內為 `worker` 的事件數；長期 0＝閒置 agent | 0 或極低＝候選裁撤/合併；異常高＝過勞 |
| **outcome 趨勢** | 各 agent `fail`/`partial` 佔比的時間序列 | 上升＝系統性問題 |
| **trace 跨度** | 同 trace_id 的棒次數 / 涉及 agent 數 | 異常長＝協作鏈過長、可能退件瓶頸 |

---

## 7. 與 inter-agent-feedback 的接點

- log 層只**保證 `user_feedback.target` 欄位產出**，作為 feedback 路由器的輸入。
- 路由器（feedback-detect / inter-agent-feedback）負責讀 `user_feedback.target`，把 worker 相關回饋以 inter-agent-feedback 格式寫進該 worker 的 `memory/incoming/`。
- log 層**不負責**寫 `memory/incoming/`，避免職責重疊。兩者在同一 Phase 0 落地時對齊欄位即可。

---

## 8. 協作邊界（與其他 Phase）

- **Phase 0 feedback 路由**：消費本 log 的 `user_feedback.target`；本 protocol 不寫 `memory/incoming/`。
- **Phase 1（access 追蹤 / 價值模型）**：消費本 log 產出的「當日 access 增量」中間檔，回寫 frontmatter。
- **Phase 2（金字塔 rollup）**：本 log 是金字塔最底層；rollup 消化 log 並觸發 §4 retention。
  > <!-- 2026-06-07 added (trace-memory-overhaul-20260607) -->金字塔完整分層（L0 log → L1 每日 → L2 每週 → L3 長期 → L4 archive）與淨減量總綱（R1–R7、休眠 no-op）見 `agents/agent-ops/_protocols/tier-protocol.md`（L0 即本 protocol 定義之 log 層）。
- **Phase 3（組織檢討）**：消費 §6.2 組織健康指標。

---

## Cross-References

- 權威設計：`output/agent-ops/memory-improvement-20260606/phase0/log-layer-mvp-design.md`
- 記憶邊界：`agents/agent-ops/_protocols/memory-protocol.md` §「What NOT to Remember」（raw log 走 `agents/_log/`，不進 memory）
- 已 OBSOLETE 的打卡：`agents/agent-ops/_protocols/worklog-protocol.md`、`agents/agent-ops/_protocols/punch-protocol.md`（僅存考古，勿據此建打卡流程）
- 腳本：`.claude/scripts/log-event.js`（append 事件）、`.claude/scripts/mine-transcript-access.js`（探勘補 access）
