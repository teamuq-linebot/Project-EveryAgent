# Output Placement Rules

> **地位**：與 `agent-anatomy.md` 同等級，是 agent-anatomy 的補充規範（agent 資料夾只能放身份／行為定義；任務產物由本規則決定落點）。

## 1. 適用範圍
所有 `agents/` 目錄下的 agent（Worker / Manager / Director / Officer）都必須遵守此規範。本規則針對的是「任務產物（output / deliverable / artifact）」的儲存位置，不涉及 worklog、memory、skills、tools 等身份檔案。

## 2. Hard Rules（四條鐵律）

| # | Hard Rule | 違反後果 |
|---|-----------|---------|
| H1 | **agent 資料夾禁止出現** `output/`、`deliverables/`、`artifacts/`、`products/` 等任務產物目錄 | 違反 agent-anatomy，agent 身份與任務產物混雜，審計時視為 critical bug |
| H2 | 所有任務產物必須寫到 **`<CWD>/output/{team}/{task_id}/`**（`<CWD>` = Claude Code 啟動時的工作目錄，通常為 `$PWD` 或 `$CLAUDE_PROJECT_DIR`） | 違反時稽核腳本會告警並要求搬遷 |
| H3 | Manager 派遣 worker 時 **必須**傳遞 `output_path` 參數（完整絕對路徑），由 Manager 負責組合 `<CWD>/output/{team}/{task_id}/` 並確保目錄存在 | 缺 `output_path` 的派遣視為 incomplete brief |
| H4 | Worker **不得寫死路徑**；收到沒有 `output_path` 的派遣必須拒絕並回報 `SCOPE VIOLATION: missing output_path` | Worker 若自行猜測或寫回自己資料夾，視為 soul.md 違反 |

## 3. 路徑規範

### 3.1 路徑模板
```
<CWD>/output/{team}/{task_id}/
```

- **`<CWD>`**：以 `$CLAUDE_PROJECT_DIR` 為準（若已設定），否則 fallback 到 `$PWD`（shell 啟動時的工作目錄快照，非 runtime 動態取值）。Manager 在 session 開始時取值一次後固定為常數，整個任務生命週期不再重新取值。後續 worker 收到的 `output_path` 必為 Manager 固定好的絕對路徑，worker 不得自行重新解析 `<CWD>`。
- **`{team}`**：對應 `agents/{team}/` 的 team 名稱，如 `sales`、`edu`、`bni`、`platform` 等。
- **`{task_id}`**：Manager 依命名慣例（§5）產生，一次任務使用同一個 task_id。

### 3.2 子結構（同一 task 同一資料夾 + 檔名前綴區分 agent）
```
<CWD>/output/sales/knowledge-satellite-20260422/
├── strategy_v1.md           # partnership-strategist 產出
├── proposal_v1.md           # proposal-designer 產出
├── style_v1.md              # visual-stylist 產出
├── style_tokens_v1.json     # visual-stylist 產出
├── proposal_v1.pptx         # doc-generator 最終輸出
└── qa_report_v1.md          # qa-reviewer 產出
```

**Manager 自身產出**：Manager 若產生任務級 brief、summary、最終報告，一律寫入 `<CWD>/output/{team}/{task_id}/manager/` 子目錄，檔名前綴 `brief_` / `summary_` / `report_` 識別。

**原則**：
- 同一個 `task_id` 下，**該 team 的所有 agent 都寫進同一資料夾**
- 靠**檔名前綴**區分 agent（`strategy_*`、`proposal_*`、`style_*`、`doc_*`、`qa_*`）
- 多版本用 `_v1`、`_v2`、`_v3` 後綴，避免覆蓋既有草稿
- 檔名允許中文（遵循 `naming-convention.md` — 用戶可見檔案用中文，中間產物用英文）

## 4. Worker 行為規範

Worker 收到 Manager 派遣訊息時：

1. **檢查 `output_path` 是否存在於派遣訊息中**
   - 缺少 → 立即回報以下格式，停止執行，不猜測路徑：
     ```
     SCOPE VIOLATION: missing output_path
     Reason: Worker cannot determine safe output location without Manager-provided output_path.
     Recommended action: Re-dispatch with output_path set to <CWD>/output/{team}/{task_id}/ (Manager to create directory first).
     ```
   - 回報方式：return message 首行，同時寫入 worklog errors 欄位
2. **檢查目錄是否存在**
   - 不存在 → `mkdir -p "$output_path"` 建立（Manager 理論上應已建好，此為 fallback）
3. **確認 task_id 正確**
   - 從 `output_path` 反推 task_id（取倒數第二段 path segment），與 brief 中 task_id 比對
   - 不一致 → 回報 Manager 要求澄清
4. **寫入時使用檔名區分自己**
   - 檔名前綴 = agent role（例：partnership-strategist 寫 `strategy_*.md`）
   - 不得寫入 `agents/{team}/{self}/output/` 或任何 agent 內部資料夾
5. **不得建立子目錄除非 Manager 明確授權**
   - 禁止自行 `mkdir output/sales/xxx/strategy/`

## 5. Manager 行為規範

### 5.1 task_id 命名慣例
格式：`{business-context}-{YYYYMMDD}`

- `business-context`：kebab-case，描述該次任務的業務語境（不是 agent 名）
- `YYYYMMDD`：任務發起日（Manager 的 worklog `started_at` 日期）

**範例**：
- `knowledge-satellite-20260422`（為 knowledge-satellite 寫合作提案）
- `asrock-partnership-20260422`（華擎三方合作提案）
- `gb10-setup-guide-20260422`（gb10-sysadmin 寫設定指南）
- `transformer-basics-20260422`（edu/manager 做 transformer 基礎教材）

**衝突處理**：同一天同一 business-context 第二次任務 → 加後綴 `-r2`（rerun 2），如 `knowledge-satellite-20260422-r2`。若同日同業務上下文需要第三、第四次重跑，依序遞增後綴：`-r2`, `-r3`, `-r4`, ...

### 5.2 派遣前必做動作
Manager 在執行 `execute` / `dispatch_agents_parallel` 前必須：

1. **決定 task_id**（依 §5.1）
2. **組合 output_path**：`output_path = "$CLAUDE_PROJECT_DIR/output/{team}/{task_id}/"`（fallback 依 §3.1 定義取值）
3. **建立目錄**：`mkdir -p "$output_path"`
4. **把 `output_path` 與 `task_id` 寫入 Manager 自身 worklog 的 `task_context` 欄位**
5. **派遣 worker 時，在 Task Block 內附 `output_path` 與 `task_id` 欄位**

### 5.3 派遣訊息 Task Block 必含欄位
```
output_path: <絕對路徑，已 mkdir -p>
task_id: {business-context}-{YYYYMMDD}
```

Worker 收到後，寫入時一律用 `output_path`，絕不寫回自己資料夾。

### 5.4 下游 agent 讀上游輸出的規範
當下游 agent（如 doc-generator）需要讀上游產物（如 proposal-designer / visual-stylist 的輸出）時：
- Manager 在 brief 中附上**上游產物的完整絕對路徑**（例：`proposal_input: $output_path/proposal_v1.md`）
- 下游 agent 不得自行推斷路徑、不得假設固定位置

## 6. 稽核與告警

### 6.1 稽核對象
- **Agent Ops Manager** 每季執行一次（依 `quarterly-self-audit.md`）
- **Agent Builder** 在審查 tools.md / workflow 變更時同步檢查

### 6.2 稽核項目
1. 是否有 agent 資料夾出現 `output/`、`deliverables/`、`artifacts/`、`products/`
2. Manager 的 workflow/flow 是否明文傳 `output_path`
3. Worker 的 tools.md 是否明文「缺 output_path 須拒絕」
4. 任務產物落點是否符合 `<CWD>/output/{team}/{task_id}/`

### 6.3 違反時的處置
| 等級 | 情境 | 處置 |
|------|------|------|
| Critical | agent 資料夾出現 `output/` 且含任務產物 | 立即開 Phase 2 搬遷任務（agent-builder 主導） |
| Major | Manager 未傳 `output_path` | 視為 brief incomplete，要求 Manager 補派 |
| Major | Worker 自行寫回自己資料夾 | 視為 soul.md 違反，追溯並修正 |
| Minor | task_id 命名不符慣例（但路徑結構正確） | 記錄警告，下次修正 |

### 6.4 已知豁免：Google Drive 空目錄 stub

Google Drive Shared Drive sync 機制會在本地 `rmdir` 空目錄後自動重建 empty stub。稽核工具發現 agent folder 下存在 `output/` 空目錄時，先用 `ls` 檢查：
- 若目錄下 0 檔案 → 記錄為 "known-benign-gdrive-stub"，不告警
- 若目錄下有任何檔案 → 觸發 Critical 告警（真實違規）

本決策依 Governance Path 3 Option C 決議（2026-04-22）。

## 7. 與現有協議的關係

- **母規則（parent rule）**：`agent-anatomy.md` §3 通用必備檔案表（本規則是對 agent-anatomy.md 在產物放置方面的詳細延伸規範，從屬補充關係）
- **延伸**：`agents/agent-ops/_protocols/rules/naming-convention.md`（task_id 與檔名規範）
- **引用**：`agents/agent-ops/_protocols/rules/output-verification.md`（Manager 派遣後的 filesystem 驗證，需讀 `output_path` 下的檔案）
- **引用**：`agents/agent-ops/_protocols/rules/session-directory.md`（edu team 已有的 session_dir 機制；本規則不取代 session_dir，而是統一 session_dir 根位置到 `<CWD>/output/{team}/{task_id}/`）

## 8. 遷移策略（Phase 劃分）

本規則分兩個 phase 落地：

| Phase | 範圍 | 負責 |
|-------|------|------|
| Phase 1 | 規範落地：新建本規則、更新 agent-anatomy、更新 6 個 worker tools.md、更新 sales/edu manager workflow | agent-builder |
| Phase 2 | 實體搬遷：把現有 `agents/{team}/{agent}/output/` 底下的檔案搬到 `<CWD>/output/{team}/archive-{YYYYMMDD}/`，並清空 agent 資料夾 | agent-builder（另一次任務） |

**Phase 2 觸發條件**：Phase 1 完成（所有 6 個 worker tools.md 及 2 個 manager workflow 已更新並通過 Governance 驗收）後，由 Agent Ops Manager 於下次季度稽核時安排。

**過渡期稽核豁免**：Phase 2 完成前，稽核腳本對 `agents/sales/{agent}/output/` 與 `agents/edu/{agent}/output/` 下創建時間早於 Phase 1 完成日的歷史目錄**豁免** Critical 告警，改為記錄 Minor 警告（含路徑與預計搬遷日）。**本次 Phase 2 已在 2026-04-22 完成，故本豁免條款即刻作廢，未來任何 agent folder 下出現 output/ 一律 Critical。**

**Phase 1 不搬檔案**；現有 `agents/sales/{partnership-strategist,proposal-designer,visual-stylist}/output/` 的歷史產物先保留，等 Phase 2 統一處理。
