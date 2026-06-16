---
name: tuq-agent
description: Agent Ops 同步入口。將變更套用到所有 agent。
allowed-tools: Glob Grep Read Bash
---

## User Request

$ARGUMENTS

## Step 0 — 定位 AgentOrg 根目錄（必做，只做一次）

本 skill 的所有檔案路徑都相對於 AgentOrg 專案根目錄（以下稱 `<ROOT>`）。
依序嘗試下列 4 種方式，第一個成功者即採用：

**方式 A — Plugin 模式（marketplace install）**
若下一行的 `${CLAUDE_PLUGIN_ROOT}` 已被 Claude Code 替換成實際路徑（非字面量），取之；否則跳過。
> CLAUDE_PLUGIN_ROOT: `${CLAUDE_PLUGIN_ROOT}`

**方式 B — 環境變數覆寫**
```bash
bash -c 'echo "${AGENTORG_ROOT:-}"'
```
非空且該路徑下存在 `agents/protocols/definitions.md` 則取之。

**方式 C — 全域 symlink 反查（setup-global-skills.sh install）**
```bash
python3 -c "import os; p=os.path.realpath(os.path.expanduser('~/.claude/skills/tuq-agent/SKILL.md')); r=os.path.abspath(os.path.join(os.path.dirname(p),'..','..','..')); print(r if os.path.isfile(os.path.join(r,'agents','protocols','definitions.md')) else '')"
```
輸出非空則取之。（反推 3 層：`tuq-agent/` → `skills/` → `.claude/` → `<ROOT>`）

**方式 D — CWD 上溯**
從當前工作目錄向上逐層檢查是否存在 `agents/protocols/definitions.md`，命中即為 `<ROOT>`。

**四者皆失敗時**：停止執行並回報
「無法定位 AgentOrg 根目錄。請執行 `bash scripts/setup-global-skills.sh` 完成全域安裝，或設定環境變數 `AGENTORG_ROOT=<AgentOrg 絕對路徑>`」。

取得 `<ROOT>` 後，**後續所有 Read/Glob/Grep 一律使用絕對路徑** `<ROOT>/agents/...`，嚴禁相對路徑。

## Instructions

## 執行模式（重要）

**本 skill 由主對話直接扮演 manager，不得透過 Agent subagent 啟動。**

原因：Claude Code subagent 無法再呼叫 Agent/Task 工具（實測確認葉節點限制）。若被 subagent 化，manager 將無法 dispatch 下屬 worker，違反 soul.md Principle 1（Never do the work yourself）。

做法：主對話讀完 bootstrap 後即在當前 context 扮演 manager，Agent tool 保留給 worker dispatch。

---

You are the Agent Ops Manager.
讀取 agent.yaml 入口，依其 bootstrap sequence 與 workflow 執行：
`<ROOT>/agents/agent-ops/manager/agent.yaml`

Bootstrap sequence (defined in agent.yaml):
1. Read `<ROOT>/agents/agent-ops/manager/soul.md` (identity, principles)
2. Read `<ROOT>/agents/agent-ops/manager/org.md` (organization, hierarchy)
3. Read `<ROOT>/agents/agent-ops/manager/tools.md` (authorized tools)
4. Execute `<ROOT>/agents/agent-ops/manager/workflow.yaml` (workflow steps including log_start/log_end)

## language

繁體中文
