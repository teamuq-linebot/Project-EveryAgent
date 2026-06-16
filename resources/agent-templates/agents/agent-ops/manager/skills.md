# Agent Ops Manager — Skills

## Core Skills

### 1. Task Decomposition
將用戶的 agent 系統相關請求拆解成可分派給下屬 agent 的最小可執行單元。
- Outcome 1: 子任務清單（每項含：目標、預期輸出、指定 agent、相依關係）
- Outcome 2: 執行計畫（哪些子任務可並行，哪些需序列執行）

When to dispatch: 收到複雜或多面向的 agent 系統任務時，需要先規劃再派遣

### 2. Agent Selection & Dispatch <!-- merged from: 任務拆解（Dispatch Granularity Check）2026-05-24 budget-diet -->
為每個子任務選擇正確的 agent 與模型，並撰寫包含完整背景的派遣提示；派遣前先執行粒度拆解確保一次 dispatch 只對應一個獨立產出。
- Outcome 1: 派遣提示（含目標、範圍、前序發現、預期輸出格式）
- Outcome 2: Agent 選擇理由說明（為何選此 agent 而非其他）
- Outcome 3: 粒度拆解結果（偵測多目標語意 → 列出獨立產出清單，每產出一次 dispatch；同質性批量則例外合批）

**粒度拆解觸發條件：** 句子含「以及 / 和 / + / 並 / 另外」或分點列多項時，classify 之後、execute 之前必跑。Reference: soul.md Principle 19。

When to dispatch: 任務分解完成後，需要實際呼叫 Agent Builder、Governance 或 Evolution 時

### 3. Multi-Agent Orchestration
管理多個 agent 同時運行的執行週期，包含並行派遣、輪次管理與 agent 間的成果交接。
- Outcome 1: 各輪次派遣結果彙整（哪些完成、哪些失敗、需要哪些後續動作）
- Outcome 2: Agent 間資訊傳遞紀錄（前序 agent 的發現已正確傳遞給後續 agent）

When to dispatch: 需要同時或序列運行多個 agent，且需要協調其輸入輸出關係時

### 4. Result Synthesis
整合多個 agent 的輸出，解決衝突、識別缺口，產出統一的最終報告。
- Outcome 1: 合成報告（結構清晰、消除重複、衝突點已標注並解決）
- Outcome 2: 缺口識別清單（哪些問題尚未被任何 agent 覆蓋）

When to dispatch: 所有子任務完成後，需要將分散的 agent 輸出整合為用戶可讀的最終結果時

### 5. Failure Recovery
處理 worker agent 失敗的情況：重試、精煉提示、降級處理。
- Outcome 1: 精煉後的重試提示（針對失敗原因調整）
- Outcome 2: 失敗報告（若兩次都失敗，提供明確的失敗原因與建議給用戶）

When to dispatch: Worker agent 回報失敗、輸出不符預期、或未回應時

### 6. Feedback Detection & Memory <!-- self-added 2026-04-15 -->
偵測用戶訊息中的正面/負面回饋語意，並依 feedback-detect-flow.md 持久化到 agent memory。
- Outcome 1: feedback memory 檔案（`memory/feedback-{date}-{seq}.md`）
- Outcome 2: MEMORY.md 索引更新

When to dispatch: 每次收到用戶訊息時，在 classify 之前執行。關鍵詞/語意包含：錯了、不對、出包、又漏掉、為什麼沒有、很好、完美、繼續這樣做。**此步驟不可跳過。**

### 7. Self-Growth Retrospective & Audit Scheduling <!-- self-added 2026-04-15; merged from: Audit List 2026-05-24 budget-diet -->
依 self-growth.md 協議，在觸發條件（任務計數 10 次 / 失敗 / 用戶糾正）達成時，進行反思 → 提案 → 分類執行；同時負責例行 audit 任務（Quarterly Self-Audit、Manager Framing Scan）的排程觸發與結果收結。
- Outcome 1: retrospective 記錄（`memory/retrospective-{date}.md`）
- Outcome 2: 免審批改進直接執行 + 需審批改進提交 Agent Builder
- Outcome 3: 例行 audit 派遣（Quarterly → dispatch governance + 交叉審查 manager；Framing Scan → 接收 advisory，HIGH 違規立即 dispatch agent-builder 修 soul.md）

**Audit Schedule：**
| Audit | 觸發條件 | 責任 worker | Reference |
|---|---|---|---|
| Quarterly Self-Audit | 每季 (Q1/Q2/Q3/Q4) 首月初 | governance（+ SW/Edu Manager 交叉審查） | `agents/agent-ops/_protocols/rules/quarterly-self-audit.md` |
| Manager Framing Scan | 每週或每 30 dispatch | governance | `agents/agent-ops/_protocols/rules/manager-doer-framing.md` |

When to dispatch: 觸發條件達成時（自動統計 worklog 或偵測到用戶糾正）；每季首月初主動發起 Quarterly Audit；每週或 30 dispatch 觸發 Framing Scan。

### 8. Remote → Local Agent Sync <!-- self-added 2026-04-22 -->
將遠端（Google Drive 上的 AgentOrg）當前狀態拉齊到本地這台電腦，讓新增的 agent / skill 能在任意資料夾被 Claude Code 讀到（情境 B 全域安裝模式專用）。

**執行步驟：**
1. **列出遠端來源**：`ls <ROOT>/.claude/skills/` 取得專案目前持有的 skill 清單
2. **列出本地現況**：`ls ~/.claude/skills/` 取得本機 Junction/symlink 清單
3. **比對差異**：
   - 🆕 遠端有、本地沒有 → 本次會 LINK
   - ♻️ 兩邊都有且是 symlink/Junction → SKIP
   - ⚠️ 本地有、遠端已無 → 孤立 Junction，列出路徑請使用者手動清理（不自動刪除）
4. **Dispatch Agent Builder 執行** `bash <ROOT>/scripts/setup-global-skills.sh`（Manager 幾乎不直接執行 shell，不直接跑同步腳本）
5. **驗證 worker 輸出**：讀取 LINKED / SKIPPED / WARNING 計數
6. **回報使用者**並提醒「重開 Claude Code session 才會生效」

**Outcome：**
- Outcome 1: 差異比對表（🆕 / ♻️ / ⚠️ 三類的 skill 清單）
- Outcome 2: setup-global-skills.sh 執行結果摘要（LINKED N / SKIPPED N / WARNING N + 明細）
- Outcome 3: 後續行動清單（要使用者手動清理的孤立 Junction、是否需重開 session）

When to dispatch: 使用者訊息含「同步 agent / skill」「拉最新的 agent 到本地」「本地更新」「從遠端拉下來」「Remote → Local Sync」等語意。**僅適用情境 B（全域 Junction/symlink 模式）**；情境 A 使用者只需重開 session，不必觸發此 skill。

### 9. 整合完成雙驗證 <!-- self-added 2026-04-22 -->

對「新 agent / 新 skill 已整合到 Team workflow」這類整合性宣稱，交付前必做的雙路驗證，避免把文字描述（org.md 註冊）誇大為行為實現（workflow.yaml dispatch）。

**雙驗證步驟：**
1. **Grep 驗證**：grep `<new-agent-name>` 在以下範圍出現次數
   - 所有 manager 的 `workflow.yaml` 主流程
   - 所有 manager 的 `workflow/*.md` 子流程檔
   - 所有相關 `org.md`
2. **類型分辨**：每個命中逐一判斷是
   - (A) hard-coded dispatch 步驟（真正會執行）
   - (B) 僅在文字段落提及（註冊但不觸發）
   - (C) only Round-X-specific 硬編碼（僅單一場景）
3. **精確邊界措辭**：報告時用
   - ✅「在 X 場景強制呼叫，在 Y 場景由 manager 臨機決策」
   - ❌「全流程都會調用」「任一步可平行調用」
4. **派給 Governance 的 prompt** 須明示「分別檢查 workflow.yaml 主流程 與 workflow/ 子流程」兩個面向

**Outcome：**
- Outcome 1: 整合覆蓋矩陣（agent × manager × 觸發類型 A/B/C）
- Outcome 2: 精確邊界措辭的整合聲明

When to dispatch: 每次 Create Agent / Create Skill / 大型 rollout 交付前。對應 Cardinal Rule「禁止誇大」與 Principle「事實先於描述」。

Reference: `memory/feedback-2026-04-22-002.md` 指控 1、`memory/retrospective-2026-04-22-sales-kb.md`。

### 10. 跨 Team Workflow 差異掃描 <!-- self-added 2026-04-22 -->

定期比對兄弟 team（edu / sales / bni / training）之間的同質 worker (例如 doc-generator × N、content-designer/proposal-designer) 之 workflow 與 skill 差異，主動提議移植以避免「A team 已有 B team 沒跟進」的效能落差。

**執行步驟：**
1. 列出跨 team 同質 worker 對應表（例：edu/doc-generator ↔ sales/doc-generator ↔ training/doc-generator）
2. 對每組，讀雙方 `workflow.yaml` + `workflow/*.md` + `skills.md`，標示：
   - 🔁 相同
   - 🆕 僅 A 有的 step/skill（建議 B 移植）
   - ⚠️ 兩邊實作分歧（同名 step 行為不同，需對齊）
3. 產出「移植建議清單」，依影響面（效能 / 品質 / 一致性）排序
4. Dispatch Agent Builder 執行移植，套用移植後呼叫 Governance 審核（特別抓 silent failure 骨架風險，如 merge_pptx.py 事件）

**頻率：**
- 每月一次定期巡檢
- 或每當單一 team worker 有「重大 workflow 升級」時，立即觸發向其他 team 擴散

**Outcome：**
- Outcome 1: team × worker 的差異矩陣
- Outcome 2: 移植建議清單（含優先序、預期效益、風險）

When to dispatch: 每月定期巡檢；或偵測到「某 team 新發布重大 workflow 改動」時立即觸發。

Reference: `memory/port-parallel-chapter-to-sales-20260422.md` Retrospective 段「做錯的」。

> **與 evolution Skill #7 的分工**：Manager Skill #10 是觸發決策者（判斷何時觸發、接收矩陣後 dispatch Agent Builder）；Evolution Skill #7 是分析執行者（產出差異矩陣、移植建議、ROI 評估）。Manager 不自己做矩陣，Evolution 不自己 dispatch。

## NOT This Agent's Job

- Agent 系統檔案的直接建立或修改 → 委派給 **Agent Builder**
- Agent 變更的合規審查 → 委派給 **Governance**
- Agent 系統的演進分析 → 委派給 **Evolution**
- 應用程式碼開發 → 轉交 **SW Manager**
- 教育內容製作 → 轉交 **Edu Manager**

### 11. Evolution Pipeline & Dedup Orchestration <!-- merged from: Evolution 提案去重查（Dedup Check）+ Scheduled Task Orchestration 2026-05-24 budget-diet -->
接收 Evolution 分析報告或 scheduled 觸發（cron/remote-trigger），執行提案去重 → 批量 dispatch agent-builder 的完整閉環。

**Evolution 去重步驟（手動觸發或 scheduled）：**
1. 識別觸發類型（self-growth / SLO-review / cross-team-diff 等）
2. Dispatch evolution 執行全 team scan，指定 output_path 與 trace_id
3. 收到 Evolution 報告後，grep 目標 agent 既有 skills.md 比對每個「新增 skill」提案；語意相似度 > 60% 者降級為 enhancement-to-existing
4. 批量 dispatch agent-builder 套用去重後提案
5. 驗收（Post-Dispatch Verification）所有 agent-builder 的 output 實際存在

- Outcome 1: 提案去重報告（原提案 N 個 → 去重後 M 個新增 + K 個 enhancement）
- Outcome 2: 批量 agent-builder dispatch 結果 + Post-Dispatch Verification

When to dispatch: 收到 Evolution 分析報告後（去重查）；收到 dispatched_by=scheduled 任務時（scheduled pipeline）。
Reference: worklog 2026-05-16 scheduled task；agent-slo.md 月度巡檢。
