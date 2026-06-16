---
name: inter-agent-feedback
type: protocol
priority: MANDATORY (Tier 1)
date: 2026-04-28
source: 用戶 2026-04-28 對 v7.3.2 教材的 4 點批評（隱憂 1 / 隱憂 2 / 主動 reflect）
scope: 全 team
related:
  - soul-md-edit-policy.md
  - soul-md-rollback.md
  - evaluator-rerun.md
  - feedback-memory.md
---

# Inter-Agent Feedback Protocol（跨 agent 結構化回饋）

> 版本：v1.0
> 適用：所有 evaluator → designer / qa-reviewer → doc-generator / Manager → worker 的退件回饋

## 1. 規則目的

解決兩大實務問題：

1. **行號幻覺（line ref hallucination）**：LLM 引用 `line 47` 時常常數錯，下游 worker 找不到、或改錯地方。
2. **退件理由不結構化**：自由文字回饋（「P30 寫得不好，請修」）讓接收方猜不到要改什麼，反覆來回。

本協議強制以 **content_snippet 為 ground truth**，line/section 僅作 hint，並要求 issue 必含 rubric / severity / fix。

## 2. 適用範圍

| 場景 | 寄送方 | 接收方 |
|------|--------|--------|
| 教材評估退件 | edu/evaluator | edu/content-designer |
| 文件 QA 退件 | edu/qa-reviewer | edu/doc-generator |
| 程式碼審查 | sw/reviewer | sw/developer |
| Manager 主動退件 | 任意 Manager | 任意 worker |
| 用戶回饋轉派（user→manager→worker） | 任意 Manager（代用戶轉發） | 該產出的 worker |   <!-- 2026-06-07 feedback-routing Phase 0.1 新增 -->

<!-- 2026-06-07 feedback-routing Phase 0.1 新增說明 -->
> **用戶回饋轉派情境特例**：寄送方非「審查者」而是「代用戶轉發的 Manager」。
> - `frontmatter.source` 標 `user-feedback-relay`，並保留用戶原話於 issue 的 `fix.reason` 或新增 `user_quote` 欄。
> - `content_snippet` 來源：Manager 從**該 worker 的產出檔**逐字複製用戶不滿的片段（≥30 字元規則照舊）；若用戶回饋為泛論無法定位具體 snippet，severity 降 `MINOR` 並於 `hints.section` 寫「泛論回饋，無精確 snippet」，由 worker 的 `ingest_incoming` 自行內化為通則而非定點修補。

## 3. Issue Schema v2

每筆 issue 必含以下欄位：

```yaml
issue_id: ISSUE-<YYYYMMDD>-<seq>      # 唯一 ID
rubric_violated: <rubric-key>          # 對應 rubric 編號，例如 R3.2
severity: BLOCKER | MAJOR | MINOR      # 阻擋類別
locator:
  content_snippet: |                   # 30 chars 以上原文片段（PRIMARY）
    <從目標檔案逐字複製的片段>
  hints:                               # SECONDARY，僅供加速搜尋
    line: 47                           # 可選，可能幻覺
    section: "P30 範例段落"             # 可選
    file: agents/edu/content-designer/output/v7.3.2/04_design.md
fix:
  suggested_action: REWRITE | DELETE | INSERT_BEFORE | INSERT_AFTER | REPLACE
  reason: <為什麼這樣改>
  example: |                           # 可選，建議改寫範例
    <修改後的版本>
```

### 欄位規範

- `content_snippet` 必須 ≥ 30 字元，且為從目標檔案 **逐字複製** 的原文（含標點、空白、換行）。
- `hints.line` 為「LLM 估計」，接收方不得當成 ground truth。
- `severity` 三級：BLOCKER（必修，否則拒收）、MAJOR（建議修，可協商）、MINOR（可選改善）。

## 4. 寄送/接收檔案位置

```
agents/<team>/<receiver-worker>/memory/incoming/
  └── <YYYY-MM-DD>_<from-agent>_<topic>.md
```

範例：

```
agents/edu/content-designer/memory/incoming/
  └── 2026-04-28_evaluator_v7.3.2-revision.md
```

檔案 frontmatter：

```yaml
---
from: edu/evaluator
to: edu/content-designer
date: 2026-04-28
topic: v7.3.2 第二輪評估退件
issue_count: 5
---
```

## 5. 接收方 SOP（grep snippet 三分支）

接收方收到 incoming 後，對每筆 issue 執行：

```
grep -F "<content_snippet>" <hints.file>
```

依 hit 數量分支：

| hit 數 | 處理 |
|--------|------|
| **1（unique）** | 鎖定該位置 → 套用 `fix.suggested_action` |
| **0（zero）** | ESCALATE（snippet 對不上，可能 stale 或寄送方筆誤） |
| **≥2（multi）** | ESCALATE（snippet 不夠唯一，需寄送方加長 snippet） |

ESCALATE 寫到 `agents/<team>/<receiver>/memory/outgoing/<date>_escalation_<issue_id>.md`，回給寄送方+Manager，附自己 grep 出的所有 hit。

## 6. ESCALATE 條件（強制）

接收方在以下三種情況 **必須 ESCALATE**，不得猜測：

1. **zero hit**：snippet 在目標檔內找不到（檔案已變動、寄送方複製錯）。
2. **multi hit**：snippet ≥ 2 處匹配，無法唯一定位。
3. **snippet 過短**：`content_snippet < 30 chars`（schema 違規，本身就是退件理由）。

ESCALATE 期間 **暫停該 issue 處理**，但不阻擋其他 issue。

## 7. Worked Example：v7.3.2 P30 修正

evaluator 退件給 content-designer，issue.md 內容：

```yaml
---
from: edu/evaluator
to: edu/content-designer
date: 2026-04-28
topic: v7.3.2 第二輪評估退件
issue_count: 1
---

issues:
  - issue_id: ISSUE-20260428-001
    rubric_violated: R3.2
    severity: BLOCKER
    locator:
      content_snippet: |
        Manager 應該主動拆解任務並派遣 worker，避免反問用戶細節
      hints:
        line: 312
        section: "P30 章節 - Manager 行為準則"
        file: output/edu/agent-org-chen-zongxian-20260428/04_design.md
    fix:
      suggested_action: REPLACE
      reason: |
        原文與 memory feedback_bias_toward_action.md 矛盾，且未說明「何時可問用戶」。
        應補充：策略性根本分歧才問用戶。
      example: |
        Manager 主動拆解任務並派遣 worker；只有當不同方向會導致根本不同的策略時，
        才反問用戶確認。執行細節由團隊決定。
```

content-designer 收到後執行 `grep -F "Manager 應該主動拆解任務並派遣 worker" 04_design.md`，假設回 1 hit（line 315，不是 312），即套用 REPLACE，無需 ESCALATE。

## 8. 與既有 protocol 的關係

- **evaluator-rerun.md**：本協議規範退件「格式」，evaluator-rerun 規範退件「流程」（必須 re-evaluate）。
- **feedback-memory.md**：本協議處理 agent ↔ agent，feedback-memory 處理 user → agent。
- **soul-md-edit-policy.md**：若退件目標是 soul.md，接收方在套用 fix 前須先過該政策的 3 層攔截。

## See also

- `agents/agent-ops/_protocols/rules/evaluator-rerun.md`
- `agents/agent-ops/_protocols/rules/feedback-memory.md`
- `agents/agent-ops/_protocols/rules/soul-md-edit-policy.md`
- memory: `feedback_fde_focus_architecture_not_prompt.md`（教材設計哲學）

## Implementation status

| 項目 | 狀態 |
|------|------|
| Schema v2 文件 | DONE（本檔） |
| `incoming/` 目錄統一建立 | DONE 2026-06-07（Phase 0.1）— 高流量 worker 先建，做法見本檔 §做法-1 |
| `grep_snippet.sh` 接收方輔助腳本 | 待實作（接收方 SOP 暫用 Grep tool 內聯執行，見 §做法-2） |
| ESCALATE 模板 | 待實作（沿用 §6，escalation 檔走 memory/outgoing/） |
| 各 worker workflow 整合 | DONE 2026-06-07（Phase 0.1）— 新增 `ingest_incoming` step，範本見 feedback-routing 落地草稿改動 3 |
| user→manager→worker 路由 | DONE 2026-06-07（Phase 0.1）— 見 feedback-detect-flow.md [1.5]/[2'] |

<!-- 2026-06-07 feedback-routing Phase 0.1 新增做法說明 -->
**§做法-1（incoming/ 目錄統一建立）**：落地時由 Agent Builder `mkdir -p agents/{team}/{worker}/memory/incoming/`，範圍先取高流量 / 活躍 worker（P0：sw/developer、sw/reviewer、edu/content-designer、edu/doc-generator），其餘待 Phase 2 流量分級後補建。每個 incoming/ 放一個 `.gitkeep`（避免空目錄在 Google Drive 同步遺失），用途：存放上游送來的結構化回饋，由本 agent 的 `ingest_incoming` step 消化。

**§做法-2（接收方 SOP）**：`grep_snippet.sh` 未建前，`ingest_incoming` step 內以 Grep tool 對 `content_snippet` 做 `-F` 字面比對，依 §5 三分支（1 hit→套用 / 0 hit→ESCALATE / ≥2→ESCALATE）。
