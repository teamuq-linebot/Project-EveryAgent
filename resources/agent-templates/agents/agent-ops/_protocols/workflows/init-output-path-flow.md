# Init Output Path Flow

**用途**：Manager `init_output_path` step 的詳細流程定義。
**對應 Principle**：Output Path Confirmation — 接案必確認、派遣必告知
**對應 Protocol**：`agents/agent-ops/_protocols/rules/output-placement.md` §5.2

## 觸發時機
- 每次 Manager workflow 在 `log_start` 完成後、`feedback_detect` 之前必跑
- Fast-path 查詢類任務（intent_result.task_type == "query" 且無檔案輸出）可豁免

## 流程

### Step 1：決定 task_id
- 格式：`{business-context}-YYYYMMDD`
- `business-context`：kebab-case，描述業務語境（不是 agent 名）
  - 範例：`knowledge-satellite-20260422`、`asrock-partnership-20260422`、`bni-update-20260423`
- 衝突處理：同日同 context 第二次任務 → `-r2`、第三次 → `-r3`、依此類推

### Step 2：組合 output_path

#### 2a. 取值優先級
```bash
# 優先序：CLAUDE_PROJECT_DIR > TUQ_LOG > PWD（fallback 並警告）
PROJECT_BASE="${CLAUDE_PROJECT_DIR:-${TUQ_LOG:-$PWD}}"

OUTPUT_PATH="${PROJECT_BASE}/output/${TEAM}/${TASK_ID}/"
```

- session 開始時取值一次後固定為常數，不重新解析
- worker 收到的 `output_path` 必為 Manager 固定好的絕對路徑

#### 2b. ROOT vs CWD 區分（Hard Rule，2026-05-01 self-added）

`PROJECT_BASE` 的取值若**等於 AGENTORG_ROOT 自身**（即 Claude Code 是從 AgentOrg 啟動的），需依 team 性質決定：

| Team 性質 | 行為 |
|---|---|
| **系統 team**（agent-ops） | ✅ **允許**：output 落 AgentOrg ROOT 屬合規（agent 系統管理產出本就放 ROOT） |
| **業務 team**（edu, sales, finance, bni, sw 及未來新業務 team） | ❌ **禁止**：必須警告或停工 |

#### 2c. 業務 team 的 ROOT detect 強制動作

業務 team Manager 在組完 `output_path` 後**必須**檢查：
```bash
# 業務 team Manager 必跑此 check
if [[ "$OUTPUT_PATH" == "$AGENTORG_ROOT"* ]] || [[ "$PROJECT_BASE" == "$AGENTORG_ROOT" ]]; then
  cat <<EOF >&2
[ROOT-VIOLATION] 業務 team output 不可落 AgentOrg 本體。
  PROJECT_BASE: $PROJECT_BASE
  AGENTORG_ROOT: $AGENTORG_ROOT

  Claude Code 似乎從 AgentOrg 啟動。請選一：
    A. 從業務專案 CWD（如 Training_AgentOrg/）重啟 Claude Code
    B. 設定環境變數 export CLAUDE_PROJECT_DIR=<業務專案絕對路徑>
    C. 設定環境變數 export TUQ_LOG=<業務專案絕對路徑>

  業務 team 包含：edu, sales, finance, bni, sw（產出教材 / 提案 / 請款單 / 會員資料 / 程式碼）
EOF
  exit 1  # report_and_stop
fi
```

系統 team Manager（agent-ops 等）跳過此 check。

#### 2d. AGENTORG_ROOT 取值
- 優先讀環境變數 `$AGENTORG_ROOT`
- 否則由 SKILL.md Step 0 同樣的反查邏輯定位（global symlink 反推 / definitions.md 上溯）

### Step 3：建立目錄
```bash
mkdir -p "$OUTPUT_PATH"
```

Manager 自身產出寫到 `$OUTPUT_PATH/manager/`（brief / summary / report 加前綴）。

### Step 4：寫入 worklog task_context
更新自己 worklog JSON 的 `task_context` 欄位（補欄位，不覆寫整個 JSON）：
```json
{
  ...,
  "task_context": {
    "task_id": "{business-context}-YYYYMMDD",
    "output_path": "/abs/path/output/{team}/{task_id}/"
  }
}
```

可用 `python3 -c "..."` 修改 worklog JSON，或直接附加到 work summary 欄位。

```bash
# Canonical 範例（Manager 把 task_id 與 output_path 寫入 worklog JSON）
python3 -c "
import json, sys
WORKLOG_FILE = sys.argv[1]
TASK_ID = sys.argv[2]
OUTPUT_PATH = sys.argv[3]
with open(WORKLOG_FILE, 'r+', encoding='utf-8') as f:
    d = json.load(f)
    d.setdefault('task_context', {})
    d['task_context']['task_id'] = TASK_ID
    d['task_context']['output_path'] = OUTPUT_PATH
    f.seek(0); json.dump(d, f, ensure_ascii=False, indent=2); f.truncate()
" "$WORKLOG_FILE" "$TASK_ID" "$OUTPUT_PATH"
```

## Dispatch 時的 propagation

每次 Manager 派遣 worker 時，dispatch prompt 必含 dispatch-protocol.md §4.5 Output Path Block：
```
TASK PATHS:
  task_id: {本任務的 task_id}
  output_path: {本任務的 output_path}
```

下游 worker 必讀此 Block 才能寫檔；缺 Block 必拒。

### task_context 強制傳遞（declarative）

Manager workflow.yaml 的 `execute` / `dispatch_rounds` step（或 ref 指向的 flow 檔）**必須**明文：

1. **讀取**自己 worklog JSON 的 `task_context.task_id` 與 `task_context.output_path`（init_output_path step 已寫入）
2. **注入** dispatch prompt 的 TASK PATHS Block
3. **不得**在 dispatch prompt 中重新計算或省略這兩欄

範例（dispatch flow 文件中應有的段落）：
```
組 dispatch prompt 時：
  讀 worklog JSON: TASK_ID = $worklog.task_context.task_id
                   OUTPUT_PATH = $worklog.task_context.output_path
  prompt 必含:
    TASK PATHS:
      task_id: $TASK_ID
      output_path: $OUTPUT_PATH
```

如此 init_output_path step 寫入的值才會真正 propagate 到 worker，不是「Manager 記得就有、忘了就沒」。

## 錯誤處理
- mkdir -p 失敗（權限/磁碟滿）→ `report_and_stop`，回報用戶
- `$CLAUDE_PROJECT_DIR` 與 `$PWD` 都不可用 → `report_and_stop`
- task_id 與既存目錄衝突 → 自動加 `-r2` 後綴

## 與 session-directory.md 的關係
若 team 採 session-directory.md 流程（如 edu），`session_dir` ≡ `$OUTPUT_PATH` 同義或其子目錄（依 team 流程而定，例如 `$OUTPUT_PATH/sessions/{task_id}/`）。本規則不取代 session-directory.md，而是統一根位置至 `$CLAUDE_PROJECT_DIR/output/{team}/{task_id}/`。

## ROOT vs CWD 角色釐清（2026-05-01 self-added）

| 名稱 | 路徑來源 | 用途 |
|---|---|---|
| `AGENTORG_ROOT` / `<ROOT>` | env var or SKILL.md Step 0 反查 | agent 系統本體（agent 定義、protocol、共用 flow、系統 team 的 output） |
| `CLAUDE_PROJECT_DIR` / `TUQ_LOG` / `$PWD` | Claude Code 啟動 CWD | 用戶業務專案（教材 / 提案 / 請款單 / 程式碼產出） |

**正確使用模式**：
1. 用戶在業務專案 CWD（如 `Training_AgentOrg/`）啟動 Claude Code
2. 設環境變數 `AGENTORG_ROOT=<AgentOrg 絕對路徑>` 讓 SKILL.md 找得到 agent 系統
3. Manager 的 `init_output_path` 解析：`PROJECT_BASE = $CLAUDE_PROJECT_DIR`（= 業務專案）→ output 自動落業務專案
4. ROOT detect 通過（業務 team 不會碰 AgentOrg 本體）

**錯誤模式**（會被 ROOT detect 攔截）：
- 從 AgentOrg 啟動 Claude Code 跑業務 team 任務 → ROOT-VIOLATION
- 系統 team 任務從業務 CWD 啟動 → 系統 team 例外允許（但建議仍從 AgentOrg 啟動以對齊）

## 例外（Fast-path 豁免）
僅滿足以下**全部**條件時可豁免：
1. `intent_result.task_type == "query"`
2. 預期無檔案輸出（純文字回答）
3. 無 worker dispatch（Manager 自答）

任何 dispatch 任意 worker 的任務都必須走完 init_output_path step。
