> 🚫 **OBSOLETE — 2026-05-28**
>
> 打卡機制已於 2026-05-28 全面移除。本文件保留作歷史考古，agent 系統不再使用任何打卡（TeamUQ 或 local worklog）。Agent 工作記錄改由外部 log 處理。
>
> **請勿**依本文件建立新的打卡流程。
>
> 移除記錄：`agents/agent-ops/manager/memory/punch_migration_state_20260527.md`

---

# Punch Protocol

> **TeamUQ AppSync 打卡權威規範** — 所有 agent 必須以 `scripts/appsync-client.sh` 對 TeamUQ subtask 進行 PUNCH-IN / PUNCH-OUT，取代 local `worklog.sh` 系統。

| 欄位 | 值 |
|------|----|
| 文件版本 | v1.0 |
| Last-updated | 2026-05-27 |
| 取代 | `agents/agent-ops/_protocols/worklog-protocol.md`（Phase 5 標記 DEPRECATED） |
| 適用對象 | 全 agent 系統（Manager / Worker / Shared，71 agent） |
| 上位法 | `agents/agent-ops/_protocols/rules/agent-anatomy.md` Principle 12（引用本檔） |
| Migration trace | `punch-migration-20260527-064500`（Phase 0–6） |

---

## §1. 文件定位

### 取代誰
- **舊**：`agents/agent-ops/_protocols/worklog-protocol.md` — local `scripts/worklog.sh` + `agents/{team}/{agent}/worklog/*.json` + `agents/worklogs/index.jsonl` 體系
- **新**：本檔 + `scripts/appsync-client.sh` + TeamUQ AppSync GraphQL 後端
- **過渡**：Phase 1–4 期間舊系統暫保留（fallback 兜底），**Phase 5 才將 `worklog-protocol.md` 全文標記 DEPRECATED 並把 `worklog.sh` 改為 stub**

### 與 anatomy 主憲法的關係
- `agents/agent-ops/_protocols/rules/agent-anatomy.md` §6（Manager soul.md 必備原則）與 §3（通用必備檔案）由 Phase 1B 改寫，引用本檔為「打卡天條」實作來源
- agent-anatomy.md 是主憲法；**本檔是執行細則**

### 適用對象
- **Manager**（含 director、sub-manager）— 必執行 `ensure_login`、PUNCH-IN、PUNCH-OUT、工時表合成（§10）、POLL 模式（§11，可選）
- **Worker**（含 V-worker QA / reviewer / validator）— 必執行 PUNCH-IN、PUNCH-OUT
- **Shared agent**（`agents/agent-ops/_shared/calculator`、`agents/agent-ops/_shared/intent`）— 同 Worker 規則
- **例外**：以 subagent 形式被呼叫但 cwd 不在 AgentOrg 的 cross-project dispatch — 仍須 PUNCH（用 Manager 已 warm 的 token cache）

---

## §2. 系統前提（環境就緒檢查）

### 2.1 必備工具

| 工具 | 用途 | Windows / Git Bash 取得方式 |
|------|------|--------------------------|
| `bash` (≥4.0) | 主 shell | Git for Windows / WSL |
| `jq` | JSON 處理 | Phase 0.5 已 portable 進 `AgentOrg/bin/jq.exe` |
| `curl` | HTTPS calls | Git for Windows 內建 |
| `python3` | OAuth callback server | `winget install Python.Python.3.12` |
| `clip.exe` (Windows) / `pbcopy` (macOS) | URL → 剪貼簿 | OS 內建 |

### 2.2 PATH 補強（必看）

`scripts/appsync-client.sh` 與 `scripts/appsync-env-check.sh` 開頭都已加 PATH bootstrap，會自動把 `AgentOrg/bin/` 加進 PATH（Phase 0.5 完成）：

```bash
# Phase 0.5 PATH bootstrap（已嵌入 appsync-client.sh 開頭）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="${SCRIPT_DIR}/../bin:$PATH"
```

agent 自己呼叫 CLI 時若**不**透過 `scripts/appsync-client.sh`，必須手動補：
```bash
export PATH="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/bin:$PATH"
```

### 2.3 OS 差異

| 項目 | Windows (Git Bash) | macOS | Linux |
|------|--------------------|-------|-------|
| Token cache 路徑 | `/tmp/.teamuq-cognito-token`（Cygwin 映射到 `C:\Users\<user>\AppData\Local\Temp` 或 `~/tmp`） | `/tmp/.teamuq-cognito-token` | `/tmp/.teamuq-cognito-token` |
| `chmod 600` | NTFS 上為 no-op（token 等於明文可讀，記在環境警告） | 有效 | 有效 |
| OAuth callback | port 8765，首次需允許 Defender 防火牆 | 同 port | 同 port |
| 瀏覽器開啟 | `powershell.exe Start-Process` + fallback `cmd.exe` / `rundll32`（Phase 0.5+ patch） | `open` | `xdg-open` |
| URL → 剪貼簿 | `clip.exe` | `pbcopy` | `xclip` / `xsel` |

### 2.4 環境健檢

新機器或懷疑環境異常時跑：
```bash
bash scripts/appsync-env-check.sh
```
輸出 PASS/FAIL 報告，列出缺失工具與修復建議。

---

## §3. Configuration Binding

### 3.1 `~/.teamuq/assignee.txt` 格式

每台 agent 機器需要一份 user-level config 告訴系統「我是誰、預設打到哪個 task」。檔案格式為 bash-source 風格 key=value：

```bash
# ~/.teamuq/assignee.txt — David Huang on AgentOrg Windows host
TEAMUQ_TASK_ID=1681                # 驅動撰寫（IN_PROGRESS）
TEAMUQ_MILESTONE_ID=1265           # 集成MCU版本
TEAMUQ_ASSIGNEE_ID=1556            # milestoneMember.id（NOT userId / companyUserId）
TEAMUQ_IDENTITY_ID=150             # David Huang 黃嘉和（從 JWT 解析得到）
```

> ⚠️ **`TEAMUQ_ASSIGNEE_ID` 必為 `find-milestone-members` 回傳的 `id` 欄位**（即 milestoneMember.id），不是 `userId` 或 `companyUserId`。用錯欄位會打卡到別人頭上。

### 3.2 Lookup Precedence（agent runtime 解析順序）

agent 取 `TEAMUQ_TASK_ID` / `TEAMUQ_ASSIGNEE_ID` 時依以下優先序：

| 優先級 | 來源 | 範例 |
|-------|------|------|
| 1 (最高) | CLI flag 或 dispatch prompt 環境變數 | `TEAMUQ_TASK_ID=1681 bash ...` |
| 2 | shell session env 已設 | `export TEAMUQ_TASK_ID=1681` 已存在 |
| 3 | `~/.teamuq/assignee.txt`（user-level） | `source ~/.teamuq/assignee.txt` |
| 4 | `AgentOrg/.teamuq-assignee.txt`（project-level，可選） | repo 內 fallback |
| 5 | **Skip + warn**（見 §9） | 印 warning、設 `TEAMUQ_PUNCH_DISABLED=1`、繼續主流程 |

實作（每個 agent 在 PUNCH-IN 前的 prelude）：
```bash
# 不覆寫已 export 的 env（precedence 2 > 3）
[[ -z "${TEAMUQ_TASK_ID:-}" ]] && source ~/.teamuq/assignee.txt 2>/dev/null || true
[[ -z "${TEAMUQ_TASK_ID:-}" ]] && source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/.teamuq-assignee.txt" 2>/dev/null || true
if [[ -z "${TEAMUQ_TASK_ID:-}" || -z "${TEAMUQ_ASSIGNEE_ID:-}" ]]; then
  echo "[PUNCH-IN] missing TEAMUQ_TASK_ID/ASSIGNEE_ID — assignee.txt not found, skipping PUNCH" >&2
  export TEAMUQ_PUNCH_DISABLED=1
fi
```

### 3.3 安全規範

- `~/.teamuq/assignee.txt` mode 必為 `0600`（Windows NTFS 上 chmod 為 no-op，記在環境警告）
- **不可 commit 進 git** — `.gitignore` 必含：
  ```
  .teamuq-assignee.txt
  ~/.teamuq/
  ```
- Phase 0.6 已完成 David Huang 機器寫入；其他人員機器接入時各自寫入自己版本（不是共用）

---

## §4. ensure_login（Manager 第一步）

### 4.1 規則

> **每個 Manager workflow 的第一個 step 必為 `ensure_login`**。取代既有 `log_start` 的位置（但 `log_start` 仍在 Phase 1-4 期間並存，作為 fallback worklog 寫入）。

授權依據：用戶 2026-05-27 HITL 覆寫 AGENT-TASK-COMMANDS.md §1.1「agent 不可代登入」條款 — 允許 Manager 自動偵測 token 過期並 trigger `appsync-client.sh login`。OAuth 流程本身（用戶選 Google / LINE provider）仍由用戶在瀏覽器完成，agent 不代選。

### 4.2 實作（workflow.yaml 標準 snippet）

```yaml
- id: ensure_login
  action: shell
  command: |
    export PATH="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/bin:$PATH"

    # Cheap cache probe — query a lightweight endpoint
    if ! bash scripts/appsync-client.sh find-subtasks-timer >/dev/null 2>&1; then
      echo "[ensure_login] token expired/missing, triggering OAuth..." >&2
      LOGIN_TIMEOUT_SEC=300 bash scripts/appsync-client.sh login || {
        echo "[ensure_login] OAuth failed/timeout — fall back to TEAMUQ_PUNCH_DISABLED mode" >&2
        export TEAMUQ_PUNCH_DISABLED=1
      }
    else
      echo "[ensure_login] token cache valid, skip login"
    fi
  timeout: 600000   # 10 min Bash tool ceiling; LOGIN_TIMEOUT_SEC=300s ensures inner OAuth 5 min cap
  on_error: continue  # ensure_login 失敗不阻斷主流程，後續 PUNCH-IN 會走 fallback
```

### 4.3 何時 trigger login

`ensure_login` 的 probe 失敗時（任一條件成立）即 trigger `login`：
- `/tmp/.teamuq-cognito-token` 不存在
- token 存在但 JWT `exp` 已過 now
- `find-subtasks-timer` query 回 401 / 403 / network error

### 4.4 Provider 選擇

OAuth 是 Cognito Hosted UI，**provider 由用戶在瀏覽器 UI 點選 Google / LINE**，agent 不代選（這層第三方流程不可繞）。`appsync-client.sh login` 內：
1. 開瀏覽器（Windows 走 `powershell.exe Start-Process`，失敗 fallback `cmd.exe` / `rundll32`）
2. 把 URL 複製到剪貼簿（`clip.exe` / `pbcopy`）— 用戶若瀏覽器自動開啟失敗也能手動貼
3. 起 Python http.server 監聽 `localhost:8765/cb` 接 OAuth callback
4. 收到 token 後寫入 `/tmp/.teamuq-cognito-token`、解析 `identityId` 寫入 cache
5. `LOGIN_TIMEOUT_SEC`（預設 300s）超過則 exit 1

### 4.5 Worker 不重複 ensure_login

Worker（含 V-worker）的 workflow.yaml **不**含 `ensure_login` step — 假設 Manager 已 warm cache：
- Cache 有效 → worker `create-subtask` 直接成功
- Cache 在 worker 跑到時剛好過期 → `create-subtask` 失敗 → worker 走 Skip + warn fallback（不自己 trigger login，避免多 worker 並行同時開瀏覽器混亂）

### 4.6 失敗 fallback

`ensure_login` 失敗（OAuth timeout 或用戶關瀏覽器）→ 設 `export TEAMUQ_PUNCH_DISABLED=1` env var → Manager 主流程繼續跑，但所有後續 PUNCH-IN/OUT 都會走 Skip + warn（見 §9）。此舉確保**打卡失敗不阻斷業務**，與舊 `worklog.sh` 失敗 fallback 同等級。

---

## §5. PUNCH-IN（第一個 tool call）

### 5.1 時序強制

> **時序硬規範**：Manager / Worker 收到任務後，PUNCH-IN 的 `create-subtask` 必須是**第一個非 `ensure_login` 的 Bash 指令**。在它之前不可 Read / Grep / Glob 任何業務檔案。

**唯一例外**：PUNCH-IN 前置 CLI 查詢（agent 自己需要 lookup `--task-id` / `--assignee-id` 時）— 允許先跑 `find-all-tasks` 與 `find-milestone-members`，但不可跑業務檔案讀取。**多數 agent 直接 source `~/.teamuq/assignee.txt` 即取得兩個 ID，無需前置查詢**。

違反時序的後果：`startTime` 反映「規劃完才打卡」而非真實開工時間，工時統計失準。

### 5.2 完整 bash pattern（標準範本）

```bash
# Step 0: prelude — source assignee config, set defaults
export PATH="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/bin:$PATH"
[[ -z "${TEAMUQ_TASK_ID:-}" ]] && source ~/.teamuq/assignee.txt 2>/dev/null || true
[[ -z "${TEAMUQ_TASK_ID:-}" ]] && source "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)/.teamuq-assignee.txt" 2>/dev/null || true

# Step 1: gate — required env vars
if [[ -z "${TEAMUQ_TASK_ID:-}" || -z "${TEAMUQ_ASSIGNEE_ID:-}" || -n "${TEAMUQ_PUNCH_DISABLED:-}" ]]; then
  echo "[PUNCH-IN] disabled — TEAMUQ_TASK_ID/ASSIGNEE_ID missing or punch disabled, skipping" >&2
  SUBTASK_ID=""
else
  # Step 2: create-subtask (PUNCH-IN)
  SUBTASK_ID=$(bash scripts/appsync-client.sh create-subtask \
    --task-id   "$TEAMUQ_TASK_ID" \
    --name      "[trace=${TRACE_ID}] ${TASK_BRIEF}" \
    --assignee-id   "$TEAMUQ_ASSIGNEE_ID" \
    --category-name "Agent_${AGENT_DISPLAY_NAME}" \
    --start-time    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
    2>/dev/null \
    | jq -r '.data.createSubtask.data.id // empty')

  if [[ -z "$SUBTASK_ID" ]]; then
    echo "[PUNCH-IN] create-subtask failed — skip PUNCH-OUT, continue work without timer" >&2
  else
    echo "[PUNCH-IN] subtask=$SUBTASK_ID category=Agent_${AGENT_DISPLAY_NAME}"
  fi
fi
```

### 5.3 變數來源

| 變數 | 來源 |
|------|------|
| `TEAMUQ_TASK_ID` | `~/.teamuq/assignee.txt` 或 dispatch prompt env |
| `TEAMUQ_ASSIGNEE_ID` | 同上 |
| `TRACE_ID` | Manager 在 dispatch prompt 中傳給 worker；Manager 自身的 trace_id 在 `ensure_login` 後生成（UUID 或 `YYYYMMDD-HHMMSS-shortuuid`） |
| `TASK_BRIEF` | 本輪工作一句話描述（≤ 60 字，避免 single quote） |
| `AGENT_DISPLAY_NAME` | 各 agent 自己的顯示名稱（PascalCase / snake_case 皆可，見 §5.4） |

### 5.4 Category 命名規則 `Agent_<AgentName>`

**所有 agent 自動打卡 subtask category 一律以 `Agent_` 為前綴**，便於後端查詢與對帳。後端會自動建立或重用同名 category，runtime 不需呼叫 `find-categories` / `create-category`。

| Agent | categoryName 範例 |
|-------|------------------|
| agent-ops/manager | `Agent_Manager` |
| agent-ops/agent-builder | `Agent_AgentBuilder` |
| agent-ops/governance | `Agent_Governance` |
| sw/manager | `Agent_SWManager` |
| sw/developer | `Agent_Developer` |
| sw/reviewer | `Agent_Reviewer` |
| edu/content-designer | `Agent_ContentDesigner` |
| bni/qa-referee | `Agent_QAReferee` |
| platform/goose-ops/manager | `Agent_GooseManager` |
| agents/agent-ops/_shared/calculator | `Agent_Calculator` |

**命名一致性**：同一 agent 在所有 dispatch 用同一 `--category-name`，避免拼錯造成 category 暴增。完整 agent → category 對照表由 Phase 1B 寫入 `agents/agent-ops/_protocols/teamuq-category-map.yaml`（本檔不維護，避免重複）。

### 5.5 trace_id 編碼

> 用戶決策：trace_id **編碼進 subtask name**，格式 `[trace=<id>] <brief>`。

- TeamUQ subtask schema 無原生 trace 欄位
- 工時表合成（§10）用 `find-all-subtasks --search "trace=$TRACE_ID"` 過濾
- Manager 在自己 PUNCH-IN 時生成 trace_id；dispatch prompt 中以 `TRACE_ID=...` 傳給 worker
- 範例：`[trace=20260527-1145-a3f9] 撰寫 punch-protocol.md`

---

## §6. 工作期間

PUNCH-IN 成功（取得 `SUBTASK_ID`）後，agent 自由執行：
- Read / Edit / Write 業務檔案
- Bash 業務指令
- Agent dispatch（Manager 才有）
- mcp__* 工具

**期間禁止呼叫的 CLI**（只有 PUNCH-IN / PUNCH-OUT 才碰）：
- `create-subtask`（同一輪只能 PUNCH-IN 一次）
- `update-subtask` 與 `--end-time`（屬於 PUNCH-OUT）

**期間允許的「打卡相關」CLI（5.1–5.3 附加功能，見 §12–§14）**：
- `mark-description-item` — 自動勾選 description checklist（5.1）
- `download-description-images` — 下載任務參考圖片（5.2，Manager 端在 dispatch 前；worker 端在 PUNCH-IN 之後第二件事）
- `upload-image` — 上傳工作截圖（5.3）

**期間建議 agent 自行記錄每個關鍵步驟的成敗**（成功 / 失敗 / 略過），PUNCH-OUT 寫 Lexical JSON checklist 時用得到。

---

## §7. PUNCH-OUT（最後一個 Bash）

### 7.1 時序強制

> **時序硬規範**：PUNCH-OUT 必為本輪**最後一個 Bash 指令**。之後不可再 Read / Edit / Write / Bash 任何東西，否則 `endTime` 早於真實完工時間。

唯一例外：PUNCH-OUT 後 agent 仍可寫純文字回應（不觸發 Bash）給 dispatcher。

### 7.2 完整 bash pattern（標準範本）

```bash
if [[ -z "$SUBTASK_ID" ]]; then
  echo "[PUNCH-OUT] no SUBTASK_ID (punch was disabled) — skip" >&2
else
  # Step 1: build items array (representing work checklist)
  ITEMS='[
    {"text":"任務 prelude（讀 bootstrap、source assignee.txt）","checked":true},
    {"text":"PUNCH-IN（create-subtask）","checked":true},
    {"text":"主要工作 1（具體動作）","checked":true,"children":[
      {"text":"子項 1.1","checked":true},
      {"text":"子項 1.2","checked":true}
    ]},
    {"text":"主要工作 2（具體動作）","checked":true},
    {"text":"inline_verify 6 項通過","checked":true},
    {"text":"PUNCH-OUT","checked":true}
  ]'

  # Step 2: transform to Lexical JSON（見 §8）
  DESC=$(echo "$ITEMS" | jq -c '
    def t(s): {type:"text",text:s,detail:0,format:0,mode:"normal",style:"",version:1};
    def li(it; v; ind): {type:"listitem",checked:(it.checked//false),value:v,version:1,direction:null,format:"",indent:ind,children:[t(it.text)]};
    def wrap(kids; ind): [{type:"listitem",checked:false,value:1,version:1,direction:null,format:"",indent:ind,children:[{type:"list",listType:"check",start:1,tag:"ul",version:1,direction:null,format:"",indent:ind,children:[kids|to_entries[]|li(.value;(.key+1);ind+1)]}]}];
    def render(it; v): [li(it;v;0)] + (if (it.children//[])|length>0 then wrap(it.children;0) else [] end);
    {root:{children:[{type:"list",listType:"check",start:1,tag:"ul",version:1,direction:null,format:"",indent:0,children:[to_entries[]|render(.value;(.key+1))]|flatten}],direction:null,format:"",indent:0,type:"root",version:1}}
  ')

  # Step 3: update-subtask (PUNCH-OUT) with retry x1
  if ! bash scripts/appsync-client.sh update-subtask \
       --subtask-id "$SUBTASK_ID" \
       --task-id    "$TEAMUQ_TASK_ID" \
       --end-time   "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
       --description "$DESC" >/dev/null 2>&1; then
    echo "[PUNCH-OUT] update-subtask failed, retry once..." >&2
    sleep 2
    bash scripts/appsync-client.sh update-subtask \
       --subtask-id "$SUBTASK_ID" \
       --task-id    "$TEAMUQ_TASK_ID" \
       --end-time   "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
       --description "$DESC" || echo "[PUNCH-OUT] failed twice, abandoning — check TeamUQ manually" >&2
  fi
fi
```

### 7.3 失敗 retry 規則

- **第一次失敗**：sleep 2 秒後重試 1 次（相同 `SUBTASK_ID` + 同樣參數）
- **第二次失敗**：放棄；若 Phase 1-4 期間還有 local worklog，記到 worklog `output_summary` 加註「PUNCH-OUT failed, subtask=$SUBTASK_ID」
- **不再 retry**：避免阻塞下游 agent / dispatcher 過久

### 7.4 PUNCH-IN 失敗時

若 PUNCH-IN 沒抓到 `SUBTASK_ID`（為空），**不要呼叫 PUNCH-OUT**（會用空字串當 `--subtask-id` 報錯）。直接 skip 並印 warning。

---

## §8. Lexical JSON checklist 規範

### 8.1 為何需要 Lexical JSON

TeamUQ 後端的 description 編輯器（Lexical-based）需要結構化 JSON 才能渲染 checkbox。純文字會被當成 raw string，前端看不到勾選框。

### 8.2 items 設計原則

| 規則 | 說明 |
|------|------|
| **頂層項目**：3–6 個 | 代表主要工作階段。超過 6 個通常表示 subtask 顆粒度過大，應拆 |
| **子項**：每個頂層 ≤ 5 個 | 細節（檔案路徑、子任務、驗證結果） |
| **嵌套**：最多 1 層（頂層 + children） | 超過請壓平到子項的 text |
| **checked 語意** | `true` = 完成；`false` = 未完成 / 失敗 / 略過，**text 內必加註原因** |
| **text 避開的字元** | 單引號 `'`（破 bash quoting）、未跳脫的 JSON 特殊字元（換行、tab、`"`）。建議用全形或描述性文字替代 |

### 8.3 jq transform（標準程式碼）

```jq
def t(s): {type:"text",text:s,detail:0,format:0,mode:"normal",style:"",version:1};
def li(it; v; ind): {type:"listitem",checked:(it.checked//false),value:v,version:1,direction:null,format:"",indent:ind,children:[t(it.text)]};
def wrap(kids; ind): [{type:"listitem",checked:false,value:1,version:1,direction:null,format:"",indent:ind,children:[{type:"list",listType:"check",start:1,tag:"ul",version:1,direction:null,format:"",indent:ind,children:[kids|to_entries[]|li(.value;(.key+1);ind+1)]}]}];
def render(it; v): [li(it;v;0)] + (if (it.children//[])|length>0 then wrap(it.children;0) else [] end);
{root:{children:[{type:"list",listType:"check",start:1,tag:"ul",version:1,direction:null,format:"",indent:0,children:[to_entries[]|render(.value;(.key+1))]|flatten}],direction:null,format:"",indent:0,type:"root",version:1}}
```

### 8.4 範例 — 簡單 checklist（無子項）

```bash
ITEMS='[
  {"text":"研究現行 worklog protocol","checked":true},
  {"text":"撰寫 punch-protocol.md 草稿","checked":true},
  {"text":"inline_verify 6 項通過","checked":true},
  {"text":"同步 draft 副本到 output/","checked":true}
]'
```

### 8.5 範例 — 含 children（推薦結構）

```bash
ITEMS='[
  {"text":"Bootstrap 與必讀材料","checked":true,"children":[
    {"text":"讀 agent.yaml / soul.md / tools.md","checked":true},
    {"text":"讀 AGENT-TASK-COMMANDS.md 全文","checked":true},
    {"text":"讀 migration-plan + state","checked":true}
  ]},
  {"text":"撰寫 punch-protocol.md（18 章節）","checked":true,"children":[
    {"text":"§1-§4 文件定位 / 環境 / config / ensure_login","checked":true},
    {"text":"§5-§9 PUNCH-IN/OUT / Lexical / fallback","checked":true},
    {"text":"§10-§17 工時表 / POLL / 5.1-5.3 / 失敗處理 / CLI / 注意事項","checked":true},
    {"text":"§18 Rollout Phase Tracker","checked":true}
  ]},
  {"text":"同步 draft 副本 + inline_verify","checked":true},
  {"text":"Memory 寫入學到的撰寫共通模式","checked":true}
]'
```

### 8.6 Iteration（同一 subtask 多次更新）

若需追加新 checklist 項目（例：跨多輪工作的同一 subtask）：
1. 先用 `find-subtask --subtask-id <id> --task-id <task>` 取既有 description
2. 將新 listitems 追加到 `root.children[0].children` 之後再寫回
3. Merge 困難時，直接覆寫一份完整新 JSON（agent 自己有 trace，不會丟資料）

---

## §9. No-task fallback（Skip + warning）

### 9.1 觸發條件（任一成立即 fallback）

| 條件 | 訊息 |
|------|------|
| `TEAMUQ_PUNCH_DISABLED=1` 已設（`ensure_login` 失敗 / OAuth timeout） | `ensure_login fell back` |
| `TEAMUQ_TASK_ID` 未設（assignee.txt 不存在或缺欄位） | `assignee.txt not found` |
| `TEAMUQ_ASSIGNEE_ID` 未設 | 同上 |
| `create-subtask` 回 `success: false` 或 HTTP 4xx/5xx | `create-subtask failed: <reason>` |
| Login timeout 300s | `OAuth timeout` |
| 找不到 `~/.teamuq/assignee.txt` 也找不到 `AgentOrg/.teamuq-assignee.txt` | 同 `assignee.txt not found` |

### 9.2 Fallback 行為

1. **跳過** PUNCH-IN 與 PUNCH-OUT（不打卡）
2. **stderr 印 warning**（必有，給人類觀察用）：
   ```
   [WARN] 本輪 <agent-name> 未在 TeamUQ 打卡 — 原因：<reason>
   ```
3. **繼續主流程**（fallback 不阻斷業務）
4. **Phase 1-4 並存期**：仍寫 local `worklog.sh` 作為紀錄兜底；fallback 時 worklog `output_summary` 必加註 `[PUNCH-FALLBACK: <reason>]`
5. **Phase 5+**：只印 warning，無 local 紀錄。本輪在 TeamUQ 系統上完全不見

### 9.3 Manager 對 Worker fallback 的處理

Worker fallback 時（worker 自己印 warning，並未 PUNCH），Manager 工時表（§10）合成時：
- `find-all-subtasks --search "trace=$TRACE_ID"` 查不到該 worker → 該 worker 列為「⚠️ 未在 TeamUQ 打卡」
- Manager 不為 worker 補打卡（worker 的 fallback 是 worker 的事）

---

## §10. Manager Principle 10 工時表新實作

### 10.1 舊實作（將廢棄）

Manager soul.md Principle 10 原文：
> 合成報告的最後，讀取所有被派遣 agent 的 worklog JSON，產出打卡明細表（| Agent | input_summary | output_summary | started_at | ended_at | duration_s | status |）

**舊資料源**：`agents/{team}/{agent}/worklog/*.json`（Phase 5 廢棄）

### 10.2 新實作（必看）

**新資料源**：`appsync-client.sh find-all-subtasks` API 搭配 `trace=` 過濾。

完整實作（Manager 在 deliver step 內呼叫）：

```bash
# Step 1: 找出本輪所有 subtask（用 trace_id 搜尋 name 內 [trace=...] 標記）
START_WINDOW=$(date -u -d '2 hour ago' +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null \
            || date -u -v-2H +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null \
            || python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)-timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%S.000Z'))")

SUBTASKS=$(bash scripts/appsync-client.sh find-all-subtasks \
  --start-date "$START_WINDOW" \
  --search     "trace=${TRACE_ID}" \
  2>/dev/null)

# Step 2: 用 jq 壓平成 markdown table
TABLE=$(echo "$SUBTASKS" | jq -r '
  .data.findAllSubTasks.data.subTasks
  | map({
      agent:      (.typeCategory.name // "Unknown" | sub("^Agent_"; "")),
      name:       (.name | sub("^\\[trace=[^\\]]+\\]\\s*"; "")),
      startTime:  .startTime,
      endTime:    (.endTime // "—"),
      duration_s: (if .duration then ((.duration * 3600) | round) else 0 end),
      status:     (if .endTime then "✅" else "⚠️ 未 PUNCH-OUT" end)
    })
  | (["Agent","input_summary","started_at","ended_at","duration_s","status"]
    | "| " + join(" | ") + " |"),
    "|---|---|---|---|---|---|",
    (.[] | "| \(.agent) | \(.name) | \(.startTime) | \(.endTime) | \(.duration_s) | \(.status) |"),
    "| **總計** | \(length) subtasks | | | | |"
')

# Step 3: 若 query 失敗則 fallback message
if [[ -z "$TABLE" || "$TABLE" == *"null"* ]]; then
  TABLE='（工時表無法載入 — TeamUQ API 失敗 / 本輪 PUNCH 全 skip / 無 trace=${TRACE_ID} 命中）'
fi

echo "$TABLE"
```

### 10.3 表格輸出規範

Manager 在 deliver 階段必輸出（取代舊 worklog table）：

```markdown
## 本輪打卡明細

| Agent | input_summary | started_at | ended_at | duration_s | status |
|---|---|---|---|---|---|
| AgentBuilder | Phase 1A: write punch-protocol.md | 2026-05-27T10:48Z | 2026-05-27T11:32Z | 2640 | ✅ |
| ... | ... | ... | ... | ... | ... |
| **總計** | N subtasks | | | total_seconds | k/N pass |
```

### 10.4 Fallback 規則

- API query 失敗（401 / network）→ 印 fallback 訊息（見 10.2 step 3）
- 本輪 PUNCH 全 skip（無 trace=$TRACE_ID 命中）→ 印「本輪所有 agent fallback 至 skip，無 TeamUQ 紀錄」
- Manager 本身 fallback（自己沒 PUNCH-IN）→ 無 trace_id，整段不輸出，retro memory 記「本輪未打卡，無法產工時表」

### 10.5 與 Anti-pattern 的關係

Manager soul.md「不在 output_summary 點名下游 agent」原則照舊適用 — 工時表只列 Agent name + input_summary（subtask 的 `.name`），不指派下游處置。

---

## §11. POLL 模式（Manager-level only）

### 11.1 適用範圍

POLL 模式讓 Manager-level agent 跨專案輪詢 `IN_PROGRESS` task、配對專案資料夾、自動分派。**僅 7 個 team manager（+ 2 個 platform sub-manager）適用**；一般 worker / V-worker / 非 POLL Manager 不適用本章節。

### 11.2 觸發旗標

| 旗標 | 觸發來源 | 阻塞點行為 |
|------|---------|-----------|
| `interactive=true` | 用戶訊息含 `poll mode` / `輪詢` / `輪詢模式` / `自動分派` / `自動輪詢` 等關鍵字 | 等待用戶選擇，5 分鐘 timeout 後 fallback 到「跳過此任務」（SKIPPED） |
| `interactive=false` | `CronCreate` 定期觸發（無互動環境） | 所有阻塞點直接 fallback SKIPPED，不阻塞 |

### 11.3 6 步 runtime flow

```
[POLL 啟動]
   │
   ▼
1. FETCH TASKS         ── find-all-tasks --statuses "IN_PROGRESS"
2. FILTER & DEDUP      ── 比對 Manager 自維護的全域去重表
3. PROJECT MATCH       ── 依 task name + description 配對專案資料夾
4. PREPARE PUNCH CTX   ── 取 task-id / milestone-id / assignee-id
5. CLASSIFY + DISPATCH ── 切換工作目錄，啟動下屬 worker（各自 PUNCH-IN/OUT）
6. RECORD COMPLETION   ── 回寫去重表 +（視結果）update-task
   │
   └─→ [POLL] 下一輪
```

### 11.4 各階段 CLI 用法

#### Step 1: FETCH TASKS

```bash
bash scripts/appsync-client.sh find-all-tasks --statuses "IN_PROGRESS"
```

#### Step 2: FILTER & DEDUP

去重表 schema（建議放 `agents/{team}/manager/memory/poll_dedup.tsv`，跨專案共用）：

| task-id | task-name | status | project_path | match_reason | timestamp | subtask-ids | reason |
|---------|-----------|--------|--------------|--------------|-----------|-------------|--------|
| 2438 | 任務 A | COMPLETED | `<projects-root>/foo` | auto-pick | 2026-05-22T08:20:00Z | planner=7878,coder=7880 | - |
| 2401 | 任務 B | SKIPPED | - | - | 2026-05-22T07:15:00Z | - | 無匹配-用戶跳過 |
| 2399 | 任務 C | FAILED | `<projects-root>/bar` | auto-pick | 2026-05-22T06:30:00Z | planner=7870 | Reviewer 卡關 >2 次 |

欄位語意：
- `status` ∈ { `COMPLETED`, `SKIPPED`, `FAILED` }
- `match_reason` ∈ { `auto-pick`, `user-pick`, `manual-input`, `new-folder`, `-` }
- `subtask-ids` 以 `agent=id,agent=id` 格式記錄
- `reason` 僅在 SKIPPED / FAILED 時填寫

#### Step 3: PROJECT MATCH

**不直接呼叫 CLI**；以本機 `ls <projects-root>/*/` + 讀取各專案的 `CLAUDE.md` 評分。完整 5 子階段（候選蒐集 → STOPWORDS 過濾 → 評分 → 分支判斷 → 路徑合法性 guard）由 Manager 實作端定義。

無匹配時的 4 個選項：
- `[A] 跳過`、`[B] 手動輸入路徑`、`[C] 新建專案`、`[D] 標記人工指派`
- `interactive=true` → 等用戶選擇，5 分鐘 timeout 後選 `[A]`
- `interactive=false` → 直接選 `[A]`

#### Step 4: PREPARE PUNCH CONTEXT

```bash
bash scripts/appsync-client.sh find-milestone-members --milestone-id "$MILESTONE_ID"
# 取 milestoneMember.id 作為 assignee-id（NOT userId / companyUserId）
```

組合 `punch_context = { task-id, milestone-id, assignee-id }`，category 由各 sub-agent 在 DISPATCH 後自行填 `Agent_<名稱>`。

#### Step 5: DISPATCH

**無 CLI 動作**。切換工作目錄到匹配的 `project_path`，在每個 sub-agent prompt 附帶 `punch_context` + `TRACE_ID` + 工作目錄指示。sub-agent 自行依 §5 / §7 執行 PUNCH-IN / PUNCH-OUT。

#### Step 6: RECORD COMPLETION

**所有經過 PROJECT MATCH 的任務都必須寫入去重表**（POLL 下一輪才不會重複處理）。

**[A] COMPLETED** — 全 PHASE 通過、無未解決 🔴
```bash
bash scripts/appsync-client.sh update-task --task-id "$TASK_ID" --status COMPLETED
# 去重表：status=COMPLETED, subtask-ids=<各 PHASE 回傳>, reason=-
```

**[B] SKIPPED** — 跳過 / 待人工 / guard 失敗 / cron 無互動
- 不更新 TeamUQ 任務狀態（保留 `IN_PROGRESS`）
- 去重表：`status=SKIPPED`, `project_path=-`, `match_reason=-`, `subtask-ids=-`
- `reason` 必填：`無匹配-用戶跳過` / `白名單 guard 失敗` / `cron 模式無互動` 等

**[C] FAILED** — PHASE 卡關 >2 次 / Reviewer 連續打回 / build 失敗無法修正
```bash
# update-task --description 為「覆寫」非「追加」— 必須先 get-task 取原值再串接
ORIG=$(bash scripts/appsync-client.sh get-task --task-id "$TASK_ID" | jq -r '.data.getTask.data.description')
bash scripts/appsync-client.sh update-task \
  --task-id "$TASK_ID" \
  --description "$ORIG

[Manager 註記 $(date -u +%Y-%m-%dT%H:%M:%SZ)] Reviewer 卡關 3 次於 X 檔案"
# 去重表：status=FAILED, subtask-ids=<已跑 PHASE>, reason=<卡關點>
```

### 11.5 POLL 特有注意事項

1. 同一 task-id 在去重表只能有一列；重試需用戶手動移除該列
2. SKIPPED / FAILED 不更新 TeamUQ status，只有 COMPLETED 才呼叫 `update-task --status COMPLETED`
3. 去重表 vs 專案 session memory 別搞混
4. `interactive=false` 下所有阻塞點 fallback 到 `[A] SKIPPED`

---

## §12. 5.1 描述匹配與自動勾選

### 12.1 用途

讓 agent 完成被分派的工作項後，自動把 task description（Lexical JSON）中對應的 checklist `listitem` 從 `checked: false` 改成 `checked: true`，再 `update-task` 寫回。實現「任務做完 → 前端 checkbox 自動打勾」閉環。

### 12.2 觸發時機

| 觸發點 | 由誰執行 | 備註 |
|--------|---------|------|
| **Manager REPORT 階段（權威來源）** | Manager | 統一在本輪結束時一次勾選所有完成的子項。**推薦預設做法** |
| sub-agent PUNCH-OUT 時 | sub-agent 自己（可選） | 僅在 sub-agent 的工作明確 1:1 對應某個 listitem 時才執行，避免重複勾選 |

> 建議：sub-agent 預設**不**自行勾選。只有當 sub-agent 與某個 listitem 是無爭議的一對一關係（例：listitem 寫「跑 unit test」、sub-agent 就是 Tester）才在 PUNCH-OUT 階段順手勾掉。

### 12.3 CLI 寫法

#### A. 直接子命令（推薦）
```bash
bash scripts/appsync-client.sh mark-description-item \
  --task-id "$TASK_ID" \
  --pattern "圖片的讀取" \
  --checked true
```

#### B. Inline jq（self-contained）
```bash
TASK_ID="$TEAMUQ_TASK_ID"
PATTERN="圖片的讀取"

DESC=$(bash scripts/appsync-client.sh get-task --task-id "$TASK_ID" 2>/dev/null \
  | jq -r '.data.getTask.data.description')

NEW_DESC=$(echo "$DESC" | jq -c --arg pattern "$PATTERN" '
  def mark_checked:
    if type == "object" and .type == "listitem"
       and ((.children // []) | map(select(.type == "text") | .text) | join("") | test($pattern; "i"))
    then .checked = true
    else . end;
  walk(mark_checked)
')

bash scripts/appsync-client.sh update-task --task-id "$TASK_ID" --description "$NEW_DESC"
```

### 12.4 Pattern 寫法建議

- **精確比對**：用完整字串（例：`圖片的讀取`），搭配 jq `test(...; "i")` case-insensitive
- **多項一次勾選**：合併成 alternation regex（例：`圖片的讀取|description如果有圖片|S3 上傳`）
- **避免誤勾**：不夠精確會勾到不相關 listitem，必要時加 anchor（`^...$`）或更長的關鍵字片段

### 12.5 失敗處理

- description 為空 / 無對應 listitem → 不更新，記錄 warning，不阻塞主流程
- `update-task` 失敗（token 過期）→ 走 §15 ensure_login 失敗 fallback
- **規則：勾選失敗不阻塞主流程**（與打卡同層級的 best-effort 動作）

---

## §13. 5.2 描述圖片下載與參考

### 13.1 用途

當用戶在 TeamUQ task description 中夾帶圖片（Lexical `type: "image"` node），Manager 自動下載到本地暫存目錄，並把路徑塞進 sub-agent prompt。sub-agent 用 `Read` 工具讀圖（Claude 支援 image input），讓圖片內容以視覺 token 參與推理，避免「用戶在描述放圖、agent 看不到」的尷尬。

### 13.2 觸發時機

| 端 | 時機 | 行為 |
|----|------|------|
| **Manager 端** | AUTO PUNCH MATCH 取得 `punch_context` 之後、CLASSIFY TASK 之前 | 一次性下載，供整輪 session 重用；在每個 sub-agent prompt 開頭附帶圖片路徑段 |
| **sub-agent 端** | **PUNCH-IN 之後的第二件事**（在 Read 業務檔案之前） | 用 `Read` 逐一讀取 prompt 中列出的圖片路徑 |

> sub-agent 端的圖片 `Read` 不違反「PUNCH-IN 必為第一個 tool call」— PUNCH-IN 是第一個 Bash，圖片 Read 是緊接其後的「任務 context 載入」，與讀既有業務檔案同層級。

### 13.3 CLI 範例

```bash
TASK_ID="$TEAMUQ_TASK_ID"
SESSION_IMG_DIR="/tmp/teamuq-task-${TASK_ID}-images"

# 下載 description 中所有 image node 到指定目錄（失敗不阻塞）
bash scripts/appsync-client.sh download-description-images \
  --task-id "$TASK_ID" \
  --out-dir "$SESSION_IMG_DIR" \
  2>&1 || true

# 列出實際下載成功的檔案
DOWNLOADED=$(ls -1 "$SESSION_IMG_DIR" 2>/dev/null || true)
```

### 13.4 Sub-agent prompt 注入段

Manager 在 `$DOWNLOADED` 非空時，把以下段落注入到每個 sub-agent 的 prompt 開頭：

```markdown
## 任務參考圖片（用戶在 task description 中提供）

下列圖片已下載到本地，請在 PUNCH-IN 之後**第二件事**就是 Read 它們作為任務參考：

- /tmp/teamuq-task-<task-id>-images/<file1>
- /tmp/teamuq-task-<task-id>-images/<file2>

⚠️ Claude 支援 image Read。直接 Read 圖片路徑即可，內容會以視覺 token 帶入。
```

### 13.5 Session 目錄約定

- **路徑**：`/tmp/teamuq-task-<task-id>-images/`
- **清理**：由用戶或 cron job 負責；agent 不做清理
- **衝突**：若同 task-id 在不同 session 跑，後者會覆蓋前者（預期行為）

### 13.6 失敗處理

- 下載失敗（網路 / 連結消失）→ 跳過，繼續走 CLASSIFY；sub-agent prompt 不附路徑段
- 圖片格式不支援（Claude 僅支援 PNG / JPEG / GIF / WebP）→ sub-agent `Read` 時自然失敗，記錄但不中止
- **規則：圖片下載失敗不阻塞主流程**

---

## §14. 5.3 工作中上傳圖片

### 14.1 用途

sub-agent 在工作過程中產生**視覺資料**（UI 測試截圖、E2E playwright snapshot、build log 截圖、架構 diagram、結果預覽 chart 等）時，用 `upload-image` 上傳到 S3 取得公開 URL，再嵌入 PUNCH-OUT description listitem 或最終 Markdown 回報。讓用戶在 TeamUQ 介面上直接看圖。

### 14.2 觸發時機

依任務本質決定，常見場景：

| 場景 | 建議 sub-agent |
|------|--------------|
| UI 測試 / E2E 截圖 | `sw/tester`、`sw/e2e-tester` |
| Build log 摘要圖、deploy 結果頁 | `sw/devops`、`platform/gb10-sysadmin` |
| 架構圖 / 流程 diagram | `sw/architect`、`platform/*` 系列 |
| 程式碼 diff 截圖、IDE highlight | `sw/reviewer` |
| 視覺設計成品（PPT / poster preview） | `edu/visual-stylist`、`sales/visual-stylist`、`bni/visual-stylist` |
| 一般工作不產出視覺資料 | **不用觸發** |

「該不該截圖」由 sub-agent 自己依任務本質決定；不是每個任務都需要。

### 14.3 自動執行授權

`upload-image` 與 `download-description-images` 視為**打卡相關工具**，所有 sub-agent 預設允許執行（與 `create-subtask` / `update-subtask` 同等級），**不需要在個別 agent 的 `tools.md` 宣告**。

### 14.4 CLI 範例（完整 3 步）

```bash
# 1. 產生截圖（路徑由各 sub-agent 自行決定）
SHOT="/tmp/tester-e2e-login-$(date +%s).png"
# ... 用 playwright / screencapture / 其他工具產生 SHOT ...

# 2. 上傳並取得 URL（--output 三種格式擇一）
IMG_URL=$(bash scripts/appsync-client.sh upload-image \
  --file "$SHOT" \
  --output url 2>/dev/null || true)

# 3. 嵌入最終 Markdown 回報
echo "本次 E2E 測試截圖：$IMG_URL"

# 4.（可選）塞進 PUNCH-OUT description 的 listitem 字串
# 例：{"text":"E2E 登入流程通過（截圖: $IMG_URL）","checked":true}
```

### 14.5 `--output` 三種格式

| 值 | 回傳內容 | 適用情境 |
|----|---------|---------|
| `url` | 純 S3 URL 字串 | 最常用，直接放進 Markdown 連結或 listitem 文字 |
| `node` | Lexical `type: "image"` node JSON | 嵌入到 description Lexical JSON 中（非僅放連結） |
| `json` | 完整 API 回應 JSON（含 metadata） | 除錯、需 S3 key / size / mime 等欄位 |

### 14.6 多檔批次上傳（可選）

```bash
bash scripts/appsync-client.sh upload-description-images-from-dir \
  --task-id "$TASK_ID" \
  --dir     "$SHOT_DIR" \
  --append-to-description true   # 自動嵌入到 task description 結尾
```

### 14.7 失敗處理

- 上傳失敗（檔案過大 / 網路 / API 5xx）→ `|| true` 兜底，`IMG_URL` 為空
- sub-agent 在回報中誠實說明「上傳失敗，截圖留在本地路徑 $SHOT」
- **規則：上傳失敗不阻塞 PUNCH-OUT**

---

## §15. 失敗處理綜合表

| 情境 | 偵測方式 | 處理 | 阻塞主流程？ |
|------|---------|------|---------|
| Token 過期（401） | `find-subtasks-timer` 回 401 | Manager 由 `ensure_login` 自動 trigger login；worker 跑到時若過期，走 Skip + warn fallback | 否 |
| Login OAuth timeout 300s | `LOGIN_TIMEOUT_SEC` 超時 | 設 `TEAMUQ_PUNCH_DISABLED=1`，後續 PUNCH 全 fallback | 否 |
| 用戶關瀏覽器拒絕登入 | OAuth callback 收不到 token | 同上 | 否 |
| `create-subtask` 失敗（PUNCH-IN） | jq 回傳空字串 | 不阻塞主流程，記錄錯誤；**跳過 PUNCH-OUT**（避免空 SUBTASK_ID） | 否 |
| `update-subtask` 失敗（PUNCH-OUT） | exit code != 0 或回 `success: false` | 重試 1 次（相同參數）；仍失敗則記到 worklog（Phase 1-4 並存期） | 否 |
| `assignee-id` 用錯欄位 | 後端建立失敗或記錯人 | agent 必須在 PUNCH-IN 前確認用 `milestoneMember.id`，不是 `userId` / `companyUserId` | 否（但會打到錯人） |
| `SUBTASK_ID` 沒抓到（為空） | jq output `null` 或 `""` | 表示 PUNCH-IN 失敗 — **不要呼叫 PUNCH-OUT**，記錄到 worklog | 否 |
| `~/.teamuq/assignee.txt` 不存在 | `[[ -z "${TEAMUQ_TASK_ID:-}" ]]` 為真 | 走 Skip + warn fallback（§9） | 否 |
| Windows port 8765 被 Defender 擋 | OAuth callback timeout | 提示用戶在 Defender 允許 — 一次性設定；之後正常 | 是（首次 login 卡住） |
| jq.exe 不在 PATH | `command -v jq` 失敗 | Phase 0.5 已 bootstrap；若仍失敗檢查 `AgentOrg/bin/jq.exe` 存在 | 是 |
| `python3` 不在 PATH | login 流程啟動 callback server 失敗 | 提示用戶 `winget install Python.Python.3.12` | 是 |
| `mark-description-item` 失敗 | exit code != 0 | 印 warning，不阻塞 | 否 |
| `download-description-images` 失敗 | exit code != 0 | 印 warning，不阻塞，prompt 不附路徑段 | 否 |
| `upload-image` 失敗 | exit code != 0 | `IMG_URL` 為空，誠實在回報中說明 | 否 |
| `find-all-subtasks` 失敗（Manager 工時表） | exit code != 0 或 empty | 印 fallback 訊息「工時表無法載入」，不阻塞 deliver | 否 |
| 多 worker 並行剛好 token 過期 | worker `create-subtask` 都 401 | 每個 worker 各自走 Skip + warn fallback（不自己 trigger login，避免多瀏覽器混亂） | 否 |
| TeamUQ API rate limit | HTTP 429 | retry 1 次後 fallback | 否 |

---

## §16. CLI Reference

### 16.1 完整 operation 表

| Operation | 用途 | 必要參數 | 觸發時機 |
|-----------|------|---------|---------|
| `login` | OAuth 登入並快取 token | `--provider google\|line`（可選，無時 Cognito Hosted UI 讓用戶選） | `ensure_login` cache probe 失敗 |
| `logout` | 清除快取 token | — | 切換帳號（罕用） |
| `find-all-tasks` | 列出任務（支援篩選、分頁、排序） | — | POLL Step 1 / agent 前置查詢 |
| `get-task` | 查單一任務 | `--task-id` | 5.1 取 description 前置 / POLL FAILED 取原 desc |
| `update-task` | 改 status 或追加 description 註記（POLL RECORD COMPLETION） | `--task-id` | POLL Step 6 |
| `find-milestone-members` | 取 assignee-id | `--milestone-id` | POLL Step 4 / 初次設 assignee.txt |
| **`create-subtask`** | **PUNCH-IN** | `--task-id`, `--name`, `--assignee-id` | §5 |
| **`update-subtask`** | **PUNCH-OUT** 或事後修改 | `--subtask-id` | §7 |
| `find-all-subtasks` | 列出 subtask（驗證 / 工時表合成 / 對帳） | — | §10 Manager 工時表 |
| `find-subtask` | 查單一 subtask | `--subtask-id`, `--task-id` | §8.6 iteration |
| `find-subtasks-timer` | 查當前計時中的 subtask（輕量 probe） | — | §4.2 `ensure_login` cache probe |
| `find-categories` | 列分類（**除錯用**，runtime 不需呼叫） | `--level`, `--company-id` | 除錯 |
| `create-category` | 手動建分類（**除錯用**，runtime 用 `--category-name` 即可） | `--name`, `--level`, `--company-id` | 除錯 |
| `update-category` | 更新分類 | `--category-id` | 除錯 |
| `get-category` | 查分類 | `--category-id` | 除錯 |
| `mark-description-item` | 自動勾選 description listitem（5.1） | `--task-id`, `--pattern`, `--checked` | §12 |
| `download-description-images` | 下載 description 圖片到本地（5.2） | `--task-id`, `--out-dir` | §13 |
| `upload-image` | 上傳本地圖片到 S3 取 URL（5.3） | `--file`, `--output url\|node\|json` | §14 |
| `upload-description-images-from-dir` | 批次上傳目錄圖片（5.3 進階） | `--task-id`, `--dir` | §14.6 |

### 16.2 全域選項

| 選項 | 說明 |
|------|------|
| `--token <jwt>` | 手動指定 token，跳過快取與自動登入（給 CI / 非互動環境用） |
| `--identity-id <id>` | 覆寫 identityId（除錯用） |
| `--identity-type <type>` | 覆寫 identityType，預設 `USER`（除錯用） |

### 16.3 可用任務狀態

`PENDING`、`IN_PROGRESS`、`COMPLETED`、`CANCELLED`

### 16.4 常用查詢範例

```bash
# 列出進行中任務
bash scripts/appsync-client.sh find-all-tasks --statuses "IN_PROGRESS"

# 搜尋 + 分頁 + 排序
bash scripts/appsync-client.sh find-all-tasks \
  --search "設計" --limit 10 --offset 0 \
  --sort-field "startDate" --sort-dir DESC

# 列出某段時間內的 subtask
bash scripts/appsync-client.sh find-all-subtasks \
  --start-date "2026-05-01" --end-date "2026-05-31"

# 查當前計時中 subtask（cache probe 用）
bash scripts/appsync-client.sh find-subtasks-timer
```

### 16.5 環境

| 項目 | 值 |
|------|-----|
| API 端點 | `https://staging.teamuq.com/graphql/` |
| 登入端點 | `login.teamuq.com`（Cognito Hosted UI） |
| Token cache | `/tmp/.teamuq-cognito-token`（Windows 由 Git Bash 映射） |
| OAuth callback port | 8765（localhost） |

### 16.6 Manager Phase 0.5+ 對腳本的本地擴充

`scripts/appsync-client.sh` 已包含以下 patch（Phase 0/0.5/0.5+ 由 manager inline patch 加入，不需 user 介入）：

- **PATH bootstrap**（§2.2）— 自動把 `AgentOrg/bin/` 加進 PATH，portable jq.exe 立即可用
- **Windows browser-open**（§4.4）— `powershell.exe Start-Process` `%-safe` 處理；失敗 fallback `cmd.exe`（含 `%%` escape）/ `rundll32`
- **URL → 剪貼簿** — Windows `clip.exe` / macOS `pbcopy` 自動把登入 URL 放進剪貼簿
- **`LOGIN_TIMEOUT_SEC` env var** — 控制 OAuth callback 等待秒數，預設 300s

---

## §17. 注意事項（給 agent 開發者）

### 17.1 核心紀律

1. **不可向使用者顯示任何 ID**（`task-id`、`subtask-id`、`milestone-member-id`、`category-id`）— agent 內部記住即可，對外只顯示名稱
2. 所有數字型 ID 參數傳入時為純數字，不需加引號
3. **PUNCH-IN 必為「第一個 tool call」**（除 `ensure_login`、PUNCH-IN 前置 CLI 查詢之外），違反會導致 `startTime` 晚於真實開工時間
4. **PUNCH-OUT 必為「最後一個 Bash 指令」**，違反會導致 `endTime` 早於真實完工時間
5. Runtime **永遠用 `--category-name`**（後端自動建/取），不要呼叫 `find-categories` / `create-category`（除錯工具）
6. PUNCH-IN 失敗時**不要**呼叫 PUNCH-OUT（會用到空的 `SUBTASK_ID`）；改為記錄錯誤後直接結束
7. PUNCH-OUT 的 `--description` **必為 Lexical JSON**；純文字會被當成 raw string，前端看不到 checkbox

### 17.2 Manager 主對話扮演原則

- Manager 由主對話直接扮演（讀完 bootstrap 後就地執行），**不得**以 subagent 形式啟動
- 理由：Manager 必須 dispatch 下屬 worker；subagent 化會失去 dispatch 能力
- 詳見 `agents/agent-ops/_protocols/rules/agent-anatomy.md` §Manager 啟動規則

### 17.3 Worker 不重跑 ensure_login

- Worker 假設 Manager 已 warm token cache，**不**含 `ensure_login` step
- 多 worker 並行同時 trigger OAuth 會開出多個瀏覽器，混亂
- Worker `create-subtask` 失敗時直接 Skip + warn（§9）；不自己 login

### 17.4 Phase 1-5 並存期注意事項

| Phase | 行為 |
|-------|------|
| Phase 1-2 | 新 punch 系統與舊 `worklog.sh` **並存**；agent workflow.yaml 同時呼叫兩套 |
| Phase 3 | 全 worker 改用 punch；`worklog.sh` 仍作為 fallback 兜底 |
| Phase 4 | 5.1 / 5.2 / 5.3 配套落地；`worklog.sh` 仍存在 |
| **Phase 5** | **`worklog.sh` 改為 DEPRECATED stub（exit 0）**；`worklog-protocol.md` 標記 deprecated；`agents/worklogs/index.jsonl` 歸檔到 `_archive/` |
| Phase 6 | Governance cross-phase audit — 確認 `grep -r "worklog.sh start"` ≤ 5（只剩 stub + backup） |

### 17.5 不在 PUNCH-OUT description 點名下游 agent

繼承自舊 `worklog-protocol.md` 的「Output Summary 內容規範（Worker Handoff Isolation）」：

> Worker 在 PUNCH-OUT description 的 listitem text（以及任何對外文字輸出）**不得**：
> 1. **HARD** — 具名點出另一個 agent 作為下游處置單位（「待 Governance 審查」、「轉交 platform-security」、「送 QA 確認」）
> 2. **SOFT** — 暗示 hand-off 但未具名（「待後續處理」、「請 manager 後續處理」、「待人工複核」、「需上報」）

合規寫法：只描述「我做了什麼」「我發現什麼」「我交付什麼路徑」。詳見 `agents/agent-ops/_protocols/worklog-protocol.md` §Output Summary 內容規範（Phase 1-4 並存期暫保留該規範文字；Phase 5 將遷移到本檔 §17 或獨立 protocol）。

### 17.6 trace_id 編碼一致性

- Manager 自己 PUNCH-IN 時生成 `TRACE_ID`（建議格式 `YYYYMMDD-HHMM-shortuuid`）
- Dispatch prompt 必含 `TRACE_ID=<value>` 給 worker
- Worker 在自己 PUNCH-IN 時用同一 `TRACE_ID`
- 工時表合成（§10）依 `--search "trace=$TRACE_ID"` 過濾
- **同一 trace_id 跨 manager 不重用**；每個 top-level Manager dispatch 生成新 trace

### 17.7 Test before mass rollout

新規則上線前，每個 manager 對自己的 agent 跑一輪「smoke test」：
1. ensure_login → cache probe 成功
2. PUNCH-IN → SUBTASK_ID 不為空
3. PUNCH-OUT → update-subtask 回 `success: true`
4. find-all-subtasks → 能查到剛剛的 subtask

Phase 0.7 已對 `Agent_Manager` category（subtask 7966 / task 1681）完成 smoke test，全項通過。

---

## §18. Rollout Phase Tracker

> 本表隨 migration 推進不斷更新；Phase 完成時由執行 agent 寫入「狀態」與「完成日期」。

### 18.1 Phase 進度（2026-05-27 snapshot）

| Phase | Task ID | 狀態 | 完成日期 | 摘要 |
|-------|---------|------|--------|------|
| 0 (env) | `punch-migration-phase0-builder-20260527` | ✅ 完成 | 2026-05-27 | 複製 `appsync-client.sh` + 新建 `appsync-env-check.sh` + env-check report |
| 0.5 (jq portable) | `punch-migration-phase0_5-jq-20260527` | ✅ 完成 | 2026-05-27 | `bin/jq.exe` portable + PATH bootstrap 進 `appsync-client.sh` 與 `appsync-env-check.sh` |
| 0.5+ (browser fix) | inline manager patch | ✅ 完成 | 2026-05-27 | `appsync-client.sh` 改 `powershell.exe Start-Process`（%-safe）+ `clip.exe` URL → 剪貼簿 + `LOGIN_TIMEOUT_SEC=300` |
| Login | — | ✅ 完成 | 2026-05-27 | Token `/tmp/.teamuq-cognito-token` + `~/.teamuq/sh-credentials`；`identityId=150` (David Huang) |
| 0.6 (assignee) | `punch-migration-phase0_6-assignee-20260527` | ✅ 完成 | 2026-05-27 | `~/.teamuq/assignee.txt`：`task=1681 / milestone=1265 / assignee=1556` |
| 0.7 (smoke test) | inline manager smoke test | ✅ 完成 | 2026-05-27 | Subtask `7966` created+updated（`categoryId=1243` Agent_Manager）— PUNCH-IN/OUT + Lexical JSON + trace_id 全驗證 |
| **1A (this)** | `punch-migration-phase1a-protocol-20260527` | 🟡 進行中 | — | **新建 `agents/agent-ops/_protocols/punch-protocol.md`**（本檔） |
| 1B (anatomy/hitl/creation) | `punch-migration-phase1b-anatomy-20260527` | ⏸ 待 | — | 改 `agent-anatomy.md` §6 Principle 12 + §3 通用檔案表 + `hitl-protocol.md` + `creation-validation.md` |
| 1C (dispatch protocols × 5) | `punch-migration-phase1c-dispatch1-20260527` | ⏸ 待 | — | sw / agent-ops / edu / sales / finance 的 `dispatch-protocol.md` §2 Worklog Block → Punch Block |
| 1D (dispatch protocols × 4 + deprecate worklog-protocol) | `punch-migration-phase1d-dispatch2-20260527` | ⏸ 待 | — | bni / mcad / platform-goose-ops / platform-tuq-paperclip + `worklog-protocol.md` 標 DEPRECATED |
| 2 (managers × 12) | `punch-migration-phase2-managers-20260527` | ⏸ 待 | — | 12 manager soul.md (Principle 10+12) + workflow.yaml + skills + tools |
| 3 (workers × 59) | `punch-migration-phase3{a-l}-workers-20260527` | ⏸ 待 | — | 59 worker × 4 檔案；每批 ≤ 5 agent |
| 4 (5.1-5.3) | `punch-migration-phase4-extras-20260527` | ⏸ 待 | — | mark-description-item / download-description-images / upload-image step 落地 |
| 5 (deprecate) | `punch-migration-phase5-deprecate-20260527` | ⏸ 待 | — | `worklog.sh` 改 DEPRECATED stub + CLAUDE.md 更新 + 30 LOW protocol 字串替換 |
| 6 (audit) | `punch-migration-phase6-audit-20260527` | ⏸ 待 | — | Cross-phase governance audit（opus） |

### 18.2 預計完工日期

- 全 migration 預估 1.5–2 個工作日（含 inline_verify 與 governance audit）
- Phase 1 完成預估：**2026-05-28**
- Phase 2-3 完成預估：**2026-05-29**
- Phase 4-6 完成預估：**2026-05-30**

### 18.3 Open Questions（已 HITL 決策）

1. **No-task fallback**：✅ Skip + warning（§9）
2. **trace_id 機制**：✅ 編碼進 subtask name `[trace=xxx] <brief>`（§5.5）
3. **assignee-id 取得**：✅ `~/.teamuq/assignee.txt` 配 lookup precedence（§3.2）
4. **jq install**：✅ Portable jq.exe 進 `AgentOrg/bin/`（Phase 0.5）
5. **Login 由 manager 自動處理**：✅ `ensure_login` step（§4）— 用戶授權覆寫原 spec §1.1 限制

---

## §19. 跨檔需協調的 TODO（後續 Phase 認領）

本檔（Phase 1A）為「打卡規範本身」的權威單一文件，下列跨檔協調點記錄於此，由後續 Phase 落地：

| TODO | 影響檔案 | 認領 Phase | 摘要 |
|------|---------|----------|------|
| Principle 12 引用本檔 | `agents/agent-ops/_protocols/rules/agent-anatomy.md` §6 | Phase 1B | 將「Every agent punches their own clock」原則改寫為引用 `punch-protocol.md` §4/§5/§7 |
| `worklog/.gitkeep` 通用必備檔案 → 刪除 | `agents/agent-ops/_protocols/rules/agent-anatomy.md` §3 | Phase 1B | 取代為「無實體目錄，所有 punch 落 TeamUQ」 |
| `creation-validation.md` 新增 `teamuq_category` check | `agents/agent-ops/_protocols/rules/creation-validation.md` | Phase 1B | W11 check：agent.yaml 已宣告 `teamuq_category` 或符合 `Agent_<DisplayName>` convention |
| HITL `worklog` 字眼 → `punch` | `agents/agent-ops/_protocols/hitl-protocol.md` §5 | Phase 1B | 6 處替換 |
| dispatch-protocol.md Worklog Block → Punch Block | 9 個 manager 的 `workflow/dispatch-protocol.md` | Phase 1C/1D | §2 整段重寫 |
| Manager workflow.yaml `log_start` → `ensure_login + punch_in` | 12 個 manager 的 `workflow.yaml` | Phase 2 | step 順序：`ensure_login → punch_in → init_output_path → feedback_detect → ...` |
| Manager soul.md Principle 10 工時表 → 用 `find-all-subtasks` | 12 個 manager 的 `soul.md` | Phase 2 | 整段重寫，參考本檔 §10 |
| Manager soul.md Principle 12「打卡是天條」字眼 worklog → punch | 12 個 manager 的 `soul.md` | Phase 2 | 引用本檔 |
| Worker workflow.yaml `log_start` → `punch_in` + 5.2 圖片 Read step | 59 個 worker 的 `workflow.yaml` | Phase 3 | step 順序：`punch_in → read_task_images → ... → punch_out` |
| Worker soul.md Principle 4「打卡是天條」字眼 worklog → punch | 59 個 worker 的 `soul.md` | Phase 3 | 引用本檔 |
| Worker tools.md 「Bash 唯一允許用法」清單更新 | 71 個 agent 的 `tools.md` | Phase 2/3 | 加入 `appsync-client.sh create-subtask / update-subtask / find-* / upload-image / download-description-images / mark-description-item` |
| 「Output Summary 不點名下游」原則遷移 | `agents/agent-ops/_protocols/worklog-protocol.md` § → 本檔 §17 或獨立 protocol | Phase 5 | Phase 1-4 並存期暫指 `worklog-protocol.md`，Phase 5 完整遷移 |
| `agent_category_map.yaml` 集中對照表 | `agents/agent-ops/_protocols/teamuq-category-map.yaml`（新建） | Phase 1B | 71 agent 對應的 `Agent_*` category 名稱集中表，避免拼錯 |
| `worklog.sh` DEPRECATED stub | `scripts/worklog.sh` | Phase 5 | `echo "DEPRECATED: use appsync-client.sh"` 並 `exit 0` |
| `agents/worklogs/index.jsonl` 歸檔 | `_archive/worklogs-pre-teamuq-20260527/` | Phase 5 | `cp -r` 保留至 Phase 6 audit pass |
| CLAUDE.md 「Worklog Requirement (天條)」更新 | `CLAUDE.md` / `.claude/scripts/demo-docs/CLAUDE.md` | Phase 5 | 改為「Punch Requirement」引用本檔 |

---

**本檔結束。**

> 本檔由 `agents/agent-ops/agent-builder` 於 2026-05-27 撰寫（task `punch-migration-phase1a-protocol-20260527`，trace `punch-migration-20260527-064500`），授權依據：用戶 2026-05-27 HITL 確認的 5 個方向決策（完全替換 / All-in / 全 71 agent / POLL+5.1-5.3 全做 / Manager 自動 ensure_login）。
