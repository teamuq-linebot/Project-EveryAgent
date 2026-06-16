# Memory Protocol

Each agent has a persistent memory at `agents/{team}/{agent}/memory/`. This memory survives across sessions and helps the agent avoid repeating mistakes or re-discovering known facts.

> <!-- 2026-06-07 added (trace-memory-overhaul-20260607) -->在記憶金字塔中，本層為 L3「長期層」；其上由 L0 log → L1 每日 → L2 每週彙整餵養，瘦身見 `agents/agent-ops/_protocols/rules/memory-hygiene.md` §4。分層與淨減量總綱見 `agents/agent-ops/_protocols/tier-protocol.md`（本層為金字塔頂，**不新建層、不改格式**）。

## Project-Scoped vs Shared Memory（記憶置放邊界）

寫入任何 memory 前，先界定這條知識屬於**共用**還是**專案限定**，放錯地方會造成跨專案噪音與膨脹。

### 共用記憶（Shared Memory）
- **位置**：`agents/{team}/{agent}/memory/`（共用雲端硬碟）。
- **載入範圍**：**所有專案**的該 agent 都會載入。
- **只放跨專案皆成立的內容**：編排教訓、dispatch 紀律、驗證方法論、agent 系統事實。

### 專案記憶（Project Memory）
- **位置**：`C:\Users\david\.claude\projects\{project-slug}\memory\`（Claude Code 每專案記憶）。
- **載入範圍**：**只在該專案**載入。
- **放專案限定的內容**：專案限定的領域知識、專案現況、待辦、特定 repo·產品·環境事實。
- **格式**：每筆 `.md` 帶 frontmatter（`name` / `description` / `metadata.type`），並以 `MEMORY.md` 作為索引。

### 判斷法（必須套用）
寫入共用記憶前自問：**「換一個專案這條還成立嗎？」**
- **不成立** → 屬於 project memory，寫到該專案的 harness memory。
- **混合型條目**（專案事件 ＋ 通用教訓）→ 把通用教訓蒸餾成一句留在共用記憶，其餘細節進 project memory。

### 違規處理
發現置放錯誤時，**遷移（migrate）而非複製**，避免同一知識存在兩處造成雙源漂移（dual-source drift）。

### 強制閘門
**本分類在每次 save_memory / memory_check / 派遣 Memory Block 都必須套用，非建議；違反＝memory protocol 違規。**

### 起源
2026-06-04 用戶糾正（jsonl-viewer 案）：sw/manager 把專案限定知識寫進共用的 `agents/sw/manager/memory/`。原則參照 `agents/sw/manager/memory/feedback_memory_scope_20260604.md`。

## What to Remember

| Category | Example |
|----------|---------|
| **Codebase patterns** | "This project uses Zustand for state management, not Redux" |
| **User preferences** | "User prefers functional components over class components" |
| **Lessons learned** | "The test database needs to be reset between integration tests" |
| **Known issues** | "Build fails on Node 18 due to native module incompatibility" |
| **Decisions made** | "Chose PostgreSQL over SQLite for the session store (decision date: 2026-04-13)" |
| **User feedback** | "用戶說程式碼缺少錯誤處理 → 下次 dispatch 時明確要求" |

## What NOT to Remember

- Raw worklog data (that goes in worklog/)
- Temporary debugging state
- Information already in the codebase itself
- <!-- 2026-06-07 added (trace-memory-overhaul-20260607) -->事件 log（誰派誰、outcome、access 訊號等 raw log）走 `agents/_log/`（見 `agents/agent-ops/_protocols/log-protocol.md`），**不寫進 memory/**。memory 只放蒸餾後的教訓/決策/偏好，不放逐筆事件流。
- <!-- 2026-06-07 added (trace-memory-overhaul-20260607) -->`last_accessed` / `access_count` 兩個 frontmatter 欄位由 access 增量腳本自動維護，**agent 不得手填**。手填會與腳本累計衝突；agent 收尾只需如實列出本輪讀過的 memory 到 log 的 `memories_referenced`，後續累計交給腳本。

<!-- 2026-06-06 schema extended (Tier3 approved, trace-memory-improvement-20260606): +last_update/keywords/importance/para, backward-compatible additive -->
## Memory File Format

Save each memory as a separate `.md` file in `agents/{team}/{agent}/memory/`.
Frontmatter schema 為「只加不改」：以下三欄為現行必填欄位（保留），其餘為 2026-06 新增欄位。

```markdown
---
topic: {descriptive topic}          # 必填（現行）
created: {ISO date}                  # 必填（現行）建立日期
agent: {team}/{agent-name}          # 必填（現行）
last_update: {ISO date}             # 必填 最後實質編輯日；每次 touch 更新
keywords: [{kw1}, {kw2}]           # 建議 2–5 個檢索關鍵字
importance: {1-5}                   # 必填 重要度；預設 3，紀律/回饋類 5，已修 issue 1-2
para: {project|area|resource|archive}  # 建議 PARA 分類，對齊 memory-hygiene §3
last_accessed: {ISO date}           # 自動 最後被讀取/引用日（真實使用訊號）；由 access 增量腳本維護，agent 不手填
access_count: {int}                 # 自動 累計被引用次數；由 access 增量腳本維護，agent 不手填
---

{Content of the memory — keep it concise and actionable}
```

> 新檔強制填齊全部「必填」欄位。舊檔採 lazy migration（被觸碰時補欄位）或由唯讀乾跑腳本批次補（見「遷移策略」）。
> 本次變更為**純增量**：未刪除或改名任何現行欄位，舊解析器讀新檔仍能取得 topic/created/agent。

<!-- 2026-06-07 schema extended: last_accessed/access_count 轉正式 (Tier3 approved, trace-memory-overhaul-20260607) — 由預告升級為正式欄位 -->
### Access 欄位（自動維護，agent 不手填）

`last_accessed`（ISO date）與 `access_count`（int）是 memory 的**真實使用訊號**，由 access 增量回寫腳本自動維護，**agent 在任何 save_memory / memory_check 都不得手填**：

- **資料流**：每棒收尾自報 `memories_referenced`（`agents/agent-ops/_protocols/log-protocol.md` §1.1）→ 每日 rollup 累計出「當日 access 增量」中間檔（log-protocol §6.1，落 `agents/_log/.access/`）→ 回寫腳本 `apply-access-increments.js` append/更新到對應 memory frontmatter（設計見 `output/agent-ops/memory-improvement-20260606/phase1/p1-access-writeback-design.md`）。
- **算法**：`access_count += 該檔當日被引用次數`；`last_accessed = max(現有, 當日最晚引用 ts 的日期)`（log-protocol §6.1）。
- **相容性**：兩者同屬「只加不改」，與現行欄位完全相容；新建檔可暫缺這兩欄，首次被引用後由腳本補上。
- **下游**：memory-hygiene §4 的 `recency_factor` 來源由 `last_update`（編輯日，弱訊號）改用 `last_accessed`（使用日，真實訊號）；當某檔尚無 access 資料時退回現行 `last_update→檔內最舊 ISO→created` 的 recency（過渡 fallback，見 hygiene §4 改寫草稿），行為與現在一致、不誤砍。`importance==5` 永久豁免不受影響。

## MEMORY.md Index

Each agent has a `agents/{team}/{agent}/memory/MEMORY.md` index file. When adding a new memory, append a one-line entry:

```markdown
- [{Topic}]({filename}.md) — {one-line summary}
```

## Feedback Memory（用戶回饋觸發）

當用戶對 agent 產出表達正面或負面回饋時，Manager/Director/Officer 必須自動保存 feedback memory。

詳細規則見 `agents/agent-ops/_protocols/rules/feedback-memory.md`。

### 回饋偵測觸發關鍵語意
- **負面**：錯了、寫得很爛、重來、不對、太差、不是我要的
- **正面**：很好、不錯、讚、正確、完美、繼續這樣做

### Feedback Memory 格式
保存到 `memory/feedback-{YYYY-MM-DD}-{seq}.md`，必含：
- 用戶原話
- 當時任務
- 分析（為什麼）
- 教訓（下次怎麼做）

## Instructions for Agent Manager

When dispatching an agent, include:

```
MEMORY: Before starting, check agents/{team}/{agent}/memory/MEMORY.md for relevant prior knowledge.
Before finishing, apply the §5 classification gate before saving:
【記憶置放閘門｜強制】寫入 memory 前先問：「換一個專案這條還成立嗎？」
  - 成立（跨專案編排教訓 / dispatch 紀律 / 驗證方法論 / agent 系統事實）→ agents/{team}/{agent}/memory/
  - 不成立（專案限定領域知識 / 專案現況 / 待辦 / 特定 repo·產品·環境事實）→ 該專案 harness memory：~/.claude/projects/{project-slug}/memory/（禁止寫進共用 agents/*/memory/）
  - 混合型 → 通用教訓蒸餾一句留共用、其餘細節進 project memory
違反＝memory protocol 違規。
Save new learnings to agents/{team}/{agent}/memory/ per agents/agent-ops/_protocols/memory-protocol.md.
```

<!-- 2026-06-07 renamed 打卡後→收尾 (trace-memory-overhaul-20260607)；舊標題「打卡後 Memory Check」為歷史殘留，2026-05-28 打卡機制已移除 -->
## 收尾 Memory Check（強制）

所有 Manager 在任務**收尾時**，必須執行 `memory_check` 步驟（過往標題稱「打卡後」；打卡機制已於 2026-05-28 移除，此處改稱「收尾」）：

1. 回顧本輪任務中是否有以下任一情況：
   - 用戶糾正/回饋（語句含「不對」「搞錯」「應該是」「不是這樣」等）
   - 審查結果（Evolution/Governance/QA 的發現）
   - 新學到的 lesson（工具用法、概念釐清、流程改善）
   - 跨 team 影響的決策

2. 若有，立即套分類閘門再寫：
   - **先問**：「換一個專案這條還成立嗎？」
     - 成立 → 寫入 `agents/<team>/<agent>/memory/`（共用記憶）
     - 不成立 → 寫入 `~/.claude/projects/{project-slug}/memory/`（project memory，禁止寫共用）
     - 混合型 → 蒸餾通用教訓一句放共用，其餘細節放 project memory
   - 更新對應的 `MEMORY.md` 索引

3. 若無新 memory，不做任何事（不產出空檔案）。

<!-- 2026-06-07 added (trace-memory-overhaul-20260607) -->
4. **收尾須呼叫 `log_event`（log 層銜接）**：`memory_check` 完成後，在回報用戶之前，呼叫 `log_event`（`node .claude/scripts/log-event.js`）寫一筆事件 log（見 `agents/agent-ops/_protocols/log-protocol.md` §3.1）。memory_check 本輪讀過的 memory 檔即填入該事件的 `memories_referenced`。此為 log 層的自報主來源；**事件 log 走 `agents/_log/`，不寫進 memory/**（見 §「What NOT to Remember」）。

**違反此規則 = memory protocol 違規。**
