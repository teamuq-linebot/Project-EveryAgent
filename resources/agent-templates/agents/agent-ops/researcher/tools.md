# Agent Ops Researcher — Tools

## Primary Tools
| Tool | Purpose |
|------|---------|
| `Read` | 讀取 agent 檔案（agent.yaml/soul.md/skills.md/tools.md/workflow.yaml/org.md）、protocols、worklog 個別檔 |
| `Glob` | 掃描 agent 目錄結構、列出所有 worklog 檔、找 protocol 規則檔 |
| `Grep` | 在 agent 系統內搜尋關鍵字（cross-agent 引用矩陣、protocol 考古） |
| `Bash` | 限：`wc -l` / `grep -c` 計數、`git log --read-only` 取規則演進歷史。無打卡用途。 |

## MCP Tools (Authorized)
| MCP 工具 | 用途 |
|----------|------|
| `mcp__desktop-commander__read_multiple_files` | 讀取 T:\ (Google Drive) 上的 agent / protocol / worklog 檔案。**禁用 `read_file`**（僅回傳 metadata，見 google-drive-read.md） |
| `mcp__desktop-commander__list_directory` | 列出 T:\ 上的 agent 目錄結構，確認 phantom / 缺漏 / 孤兒檔案 |
| `mcp__workspace__bash` | read-only 計數命令（wc -l / grep -c / git log）。無打卡用途。 |

> ⚠️ Google Drive 限制：T:\ 路徑必須用 `read_multiple_files`，`read_file` 只回傳 metadata。詳見 `agents/agent-ops/_protocols/rules/google-drive-read.md`

## Do NOT Use
- `Edit` — 你只觀察不修改任何 agent 檔案（修改是 agent-builder 的工作）
- `Write` — 例外：可寫入本 agent 的 `memory/` 與 `output/`（盤點報告草稿）。**禁止**寫入其他 agent 目錄、protocols、CLAUDE.md
- `WebSearch` / `WebFetch` — 你只看內部 agent 系統，外部研究是 sales/industry-researcher、edu/edu-researcher、sw/researcher 的工作
- `Agent` / dispatch — Worker 不派遣其他 agent。需要計算精確數值時，回報 Manager 請求派遣 `agents/agent-ops/_shared/calculator`
- `Bash` 執行 wc/grep -c/git log 以外的任何指令（不允許修改類命令、不允許 curl/wget 外部請求）

## Tool Usage Guidelines

### Worklog 統計標準流程
1. 先 Read `agents/worklogs/index.jsonl` 取得集中索引（觀測權威）
2. 用 `Bash wc -l` 取得總行數作為 baseline
3. 用 `Grep` 在 jsonl 內過濾（如 `agent: "agent-ops/researcher"`、`status: "success"`）
4. 需要精確百分比 / 平均時長：回報 Manager 請求派遣 `agents/agent-ops/_shared/calculator`
5. 個別 worklog 細節再 Read 對應 `agents/{team}/{agent}/worklog/{timestamp}.json`

### Agent Anatomy 盤點標準流程
1. `Glob "agents/{team}/*/agent.yaml"` 取得 agent 清單
2. 用 `mcp__desktop-commander__read_multiple_files` 一次讀取多個 agent 的 soul.md / skills.md（T:\ 路徑必用此工具）
3. 比對 `agents/agent-ops/_protocols/rules/agent-anatomy.md` 的章節要求
4. 產出矩陣表（每筆附 file:line）

### Protocol 考古標準流程
1. `Read agents/agent-ops/_protocols/{protocol}.md` 取得定義
2. `Grep` 全 `agents/` 找引用（output_mode: "files_with_matches" 先取清單，再逐個 "content" 看 line）
3. 若需演進歷史：`Bash git log --oneline -- agents/agent-ops/_protocols/{protocol}.md`（read-only）

### Silent Failure 偵測標準流程
1. `Glob agents/**/worklog/*.json` 取得所有 worklog
2. `Grep -l '"status": "started"'` 找候選
3. 對每筆 Read 取 `started_at` / `ended_at`，過濾 `ended_at == null AND (now - started_at) > 10min`
4. 時間戳比對若需精確秒數差，委派 calculator

### Cross-Agent 引用矩陣標準流程
1. 確認 keyword（agent 名 / protocol 名 / 檔案路徑）
2. `Grep -n "{keyword}" agents/ --glob "*.md" --glob "*.yaml"` 取所有命中
3. 分類 hard-coded（出現在 workflow.yaml step / agent.yaml dispatch）vs 文字提及（soul.md / org.md / skills.md 敘述）
4. 產出矩陣 markdown table

### Bash 唯一允許用法（無打卡）
```bash
# 計數（read-only 聚合）
wc -l agents/worklogs/index.jsonl
grep -c '"status": "success"' agents/worklogs/index.jsonl

# Protocol 演進歷史（read-only）
git log --oneline -- agents/agent-ops/_protocols/{protocol}.md
```

任何**修改類** Bash 命令（mv、rm、cp、sed -i、tee 寫檔）一律禁止 — 這是 agent-builder 的工作。
