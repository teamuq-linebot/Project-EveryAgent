---
name: soul-md-edit-policy
type: protocol
priority: MANDATORY (Tier 1)
date: 2026-04-28
source: 用戶 2026-04-28 對 v7.3.2 教材的 4 點批評（隱憂 1 / 隱憂 2 / 主動 reflect）
scope: 全 team
related:
  - inter-agent-feedback.md
  - soul-md-rollback.md
  - rollback-sop.md
  - rule-rollout.md
---

# Soul.md Edit Policy（agent 定義檔編輯政策）

> 版本：v1.0
> 適用：所有 `soul.md`、`tools.md`、`org.md`、`skills.md`、`workflow.yaml` 等 agent 定義檔的編輯

## 1. 規則目的

FDE（Frontline Development Engineer）有權直接修改 agent 的 principles 級內容（不必每次派 Builder），但需 **3 層自動攔截 + 事後 audit** 防止：

- 格式破壞（全形空白、BOM、heading 跳級等）
- 結構錯誤（principles < 5 條、缺 anti-patterns）
- 靜默退化（改完 agent 連續失敗，見 `soul-md-rollback.md`）

## 2. 編輯權限分層

| 變更層次 | 由誰執行 | 範例 |
|----------|---------|------|
| **Principles 級**（行為原則、風格） | FDE 直改（過 3 層攔截） | 加一條 P6 principle、調整 anti-patterns |
| **Architecture 級**（agent type、role 範圍） | 派 agent-ops/agent-builder | 新增 worker、改 Manager 派遣邏輯 |
| **Tool/Skill 級**（新增 skill 或 tool 整合） | 派 Builder 或 SW Manager | 新增 MCP integration |

關鍵界線：**「改的是 agent 的判斷依據」→ FDE 可直改；「改的是 agent 的能力範圍」→ 派 Builder。**

## 3. 三層攔截（Pre-write Pipeline）

任何對 soul.md 的寫入都必須先過：

```
Layer 1: Syntax Lint  →  Layer 2: Schema Validate  →  Layer 3: Atomic Write + Auto Backup
   │                        │                              │
   └─ 13 條格式檢查         └─ 必要 sections 存在            └─ .bak.<timestamp> + audit log
```

任一層 fail → 寫入中止，回報 FDE 修正。

### Layer 1 — Syntax Lint（pre-write）

腳本：`scripts/lint-soul-md.sh <file>`

檢查 13 條：

| # | 檢查 | Fail 動作 |
|---|------|---------|
| 1 | 全形空白（`U+3000`） | BLOCK |
| 2 | BOM（`U+FEFF`） | BLOCK |
| 3 | 行尾空白 | BLOCK |
| 4 | 末尾無換行 | BLOCK |
| 5 | Tab/Space 混用 | BLOCK |
| 6 | 全半形標點混用 | WARN |
| 7 | Heading 跳級（H1→H3） | BLOCK |
| 8 | Markdown 無效語法 | BLOCK |
| 9 | Encoding 非 UTF-8 | BLOCK |
| 10 | Line ending 非 LF | BLOCK |
| 11 | 單行 > 200 字元 | WARN |
| 12 | Principles 編號不連續 | BLOCK |
| 13 | placeholder TODO/FIXME 殘留 | WARN |

Fail 訊息格式：

```
[LINT FAIL] agents/edu/content-designer/soul.md
  Rule #7 (Heading 跳級): line 23 "###" 前無 "##"
  Rule #12 (Principles 編號不連續): P3 後直接跳到 P5
Action: 修正後重試
```

Retry：FDE 修正後重新觸發 pipeline，最多 3 retry，第 3 次仍 fail → ESCALATE 給 Manager。

### Layer 2 — Schema Validate（pre-write）

腳本：`scripts/validate-soul-md.py <file>`

必要 sections（缺一即 BLOCK）：

| Section | 條件 |
|---------|------|
| `## Identity` | 存在，含 role + responsibility |
| `## Principles` | ≥ 5 條，且編號連續（P1~Pn） |
| `## Decision-Making Style` | 存在 |
| `## Anti-patterns` | ≥ 3 條 |

Fail 訊息：

```
[SCHEMA FAIL] agents/edu/content-designer/soul.md
  Missing: Anti-patterns 僅 2 條（最低 3 條）
Action: 補滿後重試
```

### Layer 3 — Atomic Write + Auto Backup

寫入流程：

1. `cp <file> <file>.bak.<YYYY-MM-DD-HHMMSS>` — 自動備份
2. Atomic write（先寫到 `<file>.tmp`，再 `mv` 覆蓋）
3. 寫 audit JSONL 到 `agents/<team>/<worker>/.audit/soul-edits.jsonl`：

```json
{"ts":"2026-04-28T14:32:11+08:00","actor":"FDE/david","file":"agents/edu/content-designer/soul.md","backup":"soul.md.bak.2026-04-28-143211","diff_summary":"+P6 / +Anti-pattern #4","layers_passed":["L1","L2"]}
```

備份命名：`<file>.bak.<YYYY-MM-DD-HHMMSS>`（時間戳格式，2026-04-28 起為新建備份的統一首選格式）。

> **與 `rollback-sop.md` 的命名對齊（2026-04-28 v7.4.1 reconcile）**
>
> - 新建備份：一律用 `.bak.<YYYY-MM-DD-HHMMSS>`（時間戳）— 本協議與 `rollback-sop.md` v1.1 同步要求。
> - 既有 `.bak.<date>` / `.bakN.<date>` 序號備份：保留可用，**不再新增**。Rollback 時兩種格式並存，依字典序判斷新舊（時間戳格式可直接字典序比較）。
> - 詳細 rollback 流程見 `agents/agent-ops/_protocols/rules/rollback-sop.md` v1.1。

## 4. Async Governance Audit（post-write）

每次成功寫入後，**非同步**觸發：

- Trigger：每次成功寫入即觸發（無 throttle）
- Worker：`agent-ops/governance-auditor`（非阻擋）
- 動作：
  1. 讀 audit JSONL 最新一筆
  2. 比對 `.bak.<timestamp>` 與當前版本 diff
  3. 評估 risk（高風險 = principle 整段刪除 / Identity 大改）
  4. 若 risk = HIGH → 寫到 `agents/agent-ops/governance-auditor/memory/alerts/`，通知 Manager（不 rollback，僅警示）

不阻擋寫入，因 FDE 編輯流程不可被同步審查打斷。

## 5. Worked Example：FDE 加一條 principle

情境：FDE 想替 `agents/edu/content-designer/soul.md` 加 P6（教材必含至少 1 個 worked example）。

```
Step 1 — FDE 直接 Edit soul.md，新增 P6 行
Step 2 — 觸發 lint-soul-md.sh agents/edu/content-designer/soul.md
         ✓ Rule #1-13 全 pass
Step 3 — 觸發 validate-soul-md.py agents/edu/content-designer/soul.md
         ✓ Principles 6 條（≥5），其他 sections 完整
Step 4 — Atomic write
         - cp soul.md soul.md.bak.2026-04-28-143211
         - mv soul.md.tmp soul.md
         - 寫 audit log
Step 5 — Async governance audit
         - diff 為「+P6 教材必含至少 1 個 worked example」
         - risk = LOW（僅新增，未刪除）
         - 不通知，僅記錄
完成。FDE 看到 ✓ 提示。
```

若 Step 2 fail（例如 FDE 不小心混入全形空白）：

```
[LINT FAIL] Rule #1: line 47 col 23 全形空白 (U+3000)
寫入中止。請修正後重試（remaining retries: 2）
```

## 6. 與相關 protocol 的關係

- **soul-md-rollback.md**：本政策 **預防** 寫入錯誤，rollback 政策 **補救** 寫入後退化。
- **inter-agent-feedback.md**：若 issue 目標檔為 soul.md，接收方套用 fix 前先過本政策。
- **rollback-sop.md**：本政策的備份命名格式向下相容該 SOP（多次修改加序號）。
- **rule-rollout.md**：新規則 rollout 若涉及 soul.md 改動，每個 agent 仍須各自過 3 層攔截。

## See also

- `agents/agent-ops/_protocols/rules/soul-md-rollback.md`
- `agents/agent-ops/_protocols/rules/inter-agent-feedback.md`
- `agents/agent-ops/_protocols/rules/rollback-sop.md`
- `agents/agent-ops/_protocols/rules/rule-rollout.md`
- memory: `feedback_fde_focus_architecture_not_prompt.md`

## Implementation status

| 項目 | 狀態 |
|------|------|
| 政策文件 | DONE（本檔） |
| `scripts/lint-soul-md.sh`（13 條檢查） | 待實作（scripts 階段 2） |
| `scripts/validate-soul-md.py`（schema 檢查） | 待實作 |
| Atomic write wrapper | 待實作 |
| audit JSONL 路徑與 rotation | 待實作 |
| `agent-ops/governance-auditor` worker | 待實作 |
| Edit 工具 hook（強制過 pipeline） | 待實作 |
