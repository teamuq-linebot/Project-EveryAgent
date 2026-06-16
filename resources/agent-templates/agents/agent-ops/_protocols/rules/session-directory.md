# Rule: Session Directory — Agent 討論串持久化

**版本**：1.0  
**生效日期**：2026-04-15  
**適用範圍**：所有 Manager，所有包含多個 agent handoff 的 flow

---

## 核心規則

**Manager 在開工時必須建立 Session Directory**，並將路徑傳遞給每個被派遣的 worker agent。所有 agent 的輸出必須寫入此目錄，不得只存在記憶體中。

## Session Directory 結構

> **project_root 定義**：指當次任務的工作根目錄。edu team 通常為 `T:\共用雲端硬碟\快組隊.Agents\AgentOrg\`；各 team 由 Manager 在 00_context.md 中明確記錄 project_root 路徑。

> 以下為 edu team 的範例結構，各 team 應依自身流程調整步驟編號與檔名。

```
{project_root}/sessions/{YYYY-MM-DD}_{task_id}/
  ├── 00_context.md          ← Manager 建立：任務簡報、受眾、格式、特殊需求
  ├── 01_research.md         ← edu-researcher / shared-researcher 寫入
  ├── 02_design_draft.md     ← content-designer 寫入
  ├── 03_evaluation.md       ← content-evaluator 寫入（含 verdict + revision_notes）
  ├── 03a_design_revised.md  ← content-designer 修訂版寫入（REVISE 循環時）
  ├── 03b_evaluation_rerun.md← content-evaluator 再次確認結果
  ├── 04_style_guide.json    ← visual-stylist 寫入
  └── 05_qa_report.md        ← qa-reviewer 寫入
```

## Manager 義務

1. **開工第一步**：建立 session directory（在 `log_start` 之後，`research` 之前）
   ```bash
   SESSION_DIR="{project}/sessions/$(date +%Y-%m-%d)_{task_short_name}"
   mkdir -p "$SESSION_DIR"
   ```

2. **寫入 context.md**：包含 topic、audience_profile、output_format、language、用戶特殊需求

3. **傳遞 session_dir 給所有 agent**：每個 dispatch prompt 必須包含：
   ```
   ## Session Directory
   路徑：{session_dir}
   請將你的輸出寫入：{session_dir}/{指定檔名}
   前序工作請讀取：{session_dir}/{前序檔名}
   ```

## Worker 義務

1. **讀取 context.md** 了解完整任務背景（不依賴 Manager 在 prompt 中重複說明）
2. **讀取前序 agent 的輸出文件**（不依賴 prompt 中的摘要）
3. **將完整輸出寫入指定檔案**（不只回傳給 Manager）

### session_init 失敗時的 Fallback

若 Manager 的 session_init 步驟失敗（目錄無法建立），Worker 被派遣時：
- Worker 應將完整產出**直接回傳**給 Manager（不嘗試寫入不存在的路徑）
- Manager 應在 context 中明確告知 Worker「session_dir 不可用，請直接回傳輸出」
- Manager 負責將 Worker 的回傳內容手動儲存

## 違規行為（禁止）

- Manager 不建立 session directory 直接開始 dispatch
- Worker 只在 prompt 回覆中產出結果，沒有寫入文件
- Manager 把前序 agent 的輸出「摘要後」帶入下一個 prompt（應讓 worker 自己讀取原文件）

## 命名規範

- task_id：任務主題縮寫，例如 `workshop_redesign`、`bni_update`
- 文件名：`{step_number}_{step_name}.{ext}`
- 步驟編號：兩位數，`00`、`01`、`02`...

## 臨時腳本存放規則

任務執行過程中產生的**一次性腳本**（如 doc-generator 生成的 gen_ch1.js、merge.py 等）必須放在 session directory 內，**不得放入** `.claude/scripts/` 或全域 `scripts/` 目錄。

```
sessions/YYYY-MM-DD_{task_id}/
  ├── 00_context.md
  ├── scripts/              ← 任務用臨時腳本放這裡
  │   ├── gen_ch1.js
  │   └── merge.py
  └── ...
```

### 各目錄的用途區分

| 目錄 | 用途 | 清理策略 |
|------|------|---------|
| `scripts/` | 永久工具腳本（worklog.sh 等），跨任務重用 | 不清理 |
| `.claude/scripts/` | Claude Code hook 專用腳本 | 不清理 |
| `sessions/{task}/scripts/` | 任務產生的一次性腳本 | 任務完成後可清理 |
| `tmp/` | 中間產出檔案（章節 PPTX 等） | 合併後清理 |

> **`scripts/` vs `.claude/scripts/` 分工說明**：`.claude/scripts/` 由 CLAUDE.md 全域規則管理，專門存放 Claude Code hook 或需要 Claude 直接執行的工具腳本（如 worklog.sh）；`scripts/` 存放專案內各 team 共用的工具腳本。兩者皆為永久性質，任務一次性腳本均不得放入這兩個目錄。

**違規行為（禁止）：**
- ❌ 把任務一次性腳本放入 `.claude/scripts/`（污染全域工具目錄）
- ❌ 把永久工具腳本放入 `tmp/`（遺失風險）

### 豁免清單（不適用本規則的 agent）

以下 agent 因工作流程不產生任何腳本（.js/.py/.sh），豁免此規則：

| Agent | 豁免理由 |
|-------|---------|
| bni/label-members | 純 AI 文字/視覺分析，不執行任何腳本 |
| edu/content-designer | Bash 明確禁止，不執行任何 shell 指令 |
| edu/content-evaluator | Bash 明確禁止，不執行任何 shell 指令 |
| edu/edu-researcher | Bash 僅唯讀操作（ls、cat） |
| edu/manager | Bash 僅限 worklog.sh 打卡 |
| edu/qa-reviewer | Bash 僅做驗證查詢 |
| sw/architect | tools.md 明確禁止 Bash/Write |
| sw/reviewer | Bash 僅做 git diff/lint |
| agent-ops/researcher | Bash 限 worklog.sh + git log read-only（內部觀測） |
| sw/researcher | Bash 限 worklog.sh + git log/blame/show/diff read-only（外部研究） |
| sales/industry-researcher | Bash 限 worklog.sh |
| edu/edu-researcher | Bash 限 worklog.sh |
| agent-ops/manager | Bash 僅限 worklog.sh |

新增 agent 時，若有腳本生成需求，應在 skills.md 中加入本規則引用並移出豁免清單。

## Session Directory 生命週期

- 任務完成後，session directory **保留不刪除**，作為歷史記錄
- 不主動歸檔或清理；各 team 可依需求自行決定保留策略
- tmp/ 暫存檔（如 doc-generator 的中間章節 PPTX）在合併完成後可清除，但 session/ 下的文件不得清除

## 相容性

現有 `workshop_v2/design_draft.md` 等已存在的輸出文件，可視為符合此協議精神的前驅實作，但未來應統一使用 `sessions/` 目錄結構。
