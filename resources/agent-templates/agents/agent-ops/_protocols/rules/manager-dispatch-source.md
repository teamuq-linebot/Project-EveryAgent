---
name: manager-dispatch-source
description: 規格化 Manager 派工時實際參考的 reference 文件清單，政策推送必須依此清單擴散
type: protocol
priority: MANDATORY
date: 2026-05-01
source: Gov-C P1 haiku-audit-20260501 retrospective
scope: 全 team Manager + Agent Builder
---

# Manager Dispatch Source Protocol

## Purpose

規格化「Manager 派工時實際參考的 reference 文件清單」，每次政策推送都依此清單擴散，避免漏改。

**歷史根因**：2026-04-27 ban haiku rollout 只改 Tier 1（`agent.yaml`），遺漏 Tier 2/3/4 共 20+ 個檔案，導致 rollout 失效。完整事件：`agent-ops/manager/memory/retrospective_haiku_rollout_round2_2026-05-01.md`。

---

## Reference 文件清單（依優先級排序）

### Tier 1 — Authoritative Source（單一真相）

**這裡是政策的 Ground Truth，必定第一個改。**

| 檔案 | 關鍵欄位 |
|------|----------|
| `<agent>/agent.yaml` | `dispatch.model`、`dispatch.trigger`、`dispatch.not_for` |

- 所有 agent 的 `agent.yaml` 都在 Tier 1 範疇
- 含 Manager、Worker、所有 team 的 agent

---

### Tier 2 — Manager 派工時實際讀的 Reference

**Manager 在決定派哪個 sub-agent 用哪個 model 前，會實際查閱這些檔案。Tier 1 改完必接著改 Tier 2。**

| 檔案路徑 | 說明 |
|----------|------|
| `<manager>/tools.md` | Subagent Type Mapping 表（含 Default Model 欄） |
| `<manager>/org.md` | Hierarchy 圖（含模型標註） |
| `<manager>/skills.md` | Model Decision skill、score-band 表、model 選型邏輯 |
| `<manager>/workflow.yaml` | 各 step 的 `model:` 欄位 |
| `<manager>/workflow/*.md` | 細部 flow 內若 hardcode model 也算（grep 確認） |
| `<manager>/dispatch-templates.md` | 若存在，dispatch 範本內的 model 參數 |

- `<manager>` 指所有 team 的 Manager：sw/manager、edu/manager、bni/manager、sales/manager、agent-ops/manager 等
- 新增 team 時，新 Manager 的這些檔案也納入 Tier 2

---

### Tier 3 — 用戶 / Manager 入口讀的 SKILL / README

**這是使用者或頂層 Manager 在派工前會看的入口文件，若含 model 指定，也須同步。**

| 檔案路徑 | 說明 |
|----------|------|
| `skills/tuq*/SKILL.md` | AgentOrg 頂層 SKILL（tuq、tuq-dev、tuq-agent 等）若 dispatch 指定 model |
| `.claude/skills/tuq*/SKILL.md` | 同名雙份（Junction/symlink 另一端），實際路徑可能不同，兩份都要確認 |
| `<worker>/README.md` | Worker README 通常含「Complexity → Model」表，若有 model 選型規則就納入 |

- 僅在 SKILL.md / README.md **含有 model 欄位或 model 選型描述**時才需修改
- 若無相關欄位可跳過，但**必須 grep 確認**（不能靠直覺跳過）

---

### Tier 4 — 全域 / 系統入口

**影響最廣、最少修改，但一旦有 model policy 說明就必須同步。**

| 檔案路徑 | 說明 |
|----------|------|
| `CLAUDE.md` | 若提到模型政策（如 "Default: sonnet"、"Ban: haiku"） |
| `agents/agent-ops/_protocols/definitions.md` | 若 schema 範本含 `model:` 欄位預設值 |
| `agents/agent-ops/_protocols/evaluation-protocol.md` | Score → Model Mapping 表（如 haiku/sonnet/opus 分段） |

---

## 枚舉 SOP（每次 rollout 必跑）

```bash
# Step A：列出所有 Tier 1 對象（所有 agent.yaml）
find agents/ -name "agent.yaml" | sort

# Step B：列出所有 Tier 2 對象（所有 Manager 的相關檔）
for mgr in sw edu bni sales agent-ops; do
  ls agents/$mgr/manager/tools.md agents/$mgr/manager/org.md \
     agents/$mgr/manager/skills.md agents/$mgr/manager/workflow.yaml \
     agents/$mgr/manager/workflow/*.md 2>/dev/null
done

# Step C：grep Tier 3 是否含 model 字串（只需改含 model 的）
grep -rl "model:" skills/ .claude/skills/ agents/*/*/README.md 2>/dev/null

# Step D：grep Tier 4
grep -n "model\|haiku\|sonnet\|opus" CLAUDE.md agents/agent-ops/_protocols/definitions.md \
     agents/agent-ops/_protocols/evaluation-protocol.md 2>/dev/null
```

輸出清單後，**交由 `rule-rollout-closure.md` Step 1 格式記錄**，再切分 Batch 派 Builder 執行。

---

## Rule

任何 dispatch model 政策變更（含 ban policy、新增 model、棄用 model）**必須掃 Tier 1 + Tier 2 + Tier 3 + Tier 4 全部檔案，缺一視為 rollout 不完整**。

- 「大致知道哪些要改」不等於執行本清單 — 必須實際 grep/glob 枚舉
- 枚舉結果必須記錄在 Manager worklog（`[CLOSURE-STEP1]` 格式）
- 若某個 Tier 下的某檔確認無相關欄位，記錄「已確認無需修改」即可跳過

---

## 對照範例（ban haiku 案例）

### 第一次（2026-04-27）— 失敗

| Tier | 實際修改 | 應修改 | 狀態 |
|------|----------|--------|------|
| Tier 1 | 部分 agent.yaml | 全部 agent.yaml | PARTIAL |
| Tier 2 | 0 檔 | 6 manager × 5 檔 = ~30 檔 | MISS |
| Tier 3 | 0 檔 | tuq SKILL.md 等 | MISS |
| Tier 4 | 0 檔 | evaluation-protocol.md | MISS |
| **結果** | **FAIL** — rollout 未完成 | | |

### 第二次（2026-05-01）— PASS（Round 3 完成）

| Tier | 實際修改 | 狀態 |
|------|----------|------|
| Tier 1 | 所有 agent.yaml | DONE |
| Tier 2 | 所有 Manager tools.md / org.md / skills.md / workflow | DONE |
| Tier 3 | skills/tuq* SKILL.md | DONE |
| Tier 4 | evaluation-protocol.md、definitions.md | DONE |
| **結果** | **PASS** — Governance CLOSURE CONFIRMED | |

---

## Batch 切分建議

根據 `rule-rollout-closure.md` Step 2 規定（每 batch ≤ 5 Edit），本清單的典型 ban-model rollout 切分如下：

| Batch | 內容 | Edit 數 |
|-------|------|---------|
| Batch-T1 | 所有 agent.yaml（逐一或多 agent 同 batch） | ≤ 5 |
| Batch-T2a | sw/manager × 5 檔 | 5 |
| Batch-T2b | edu/manager × 5 檔 | 5 |
| Batch-T2c | bni/manager + sales/manager 各部分 | 5 |
| Batch-T2d | agent-ops/manager + sw/manager 各部分 | 5 |
| Batch-T3 | tuq*/SKILL.md + worker README.md | ≤ 5 |
| Batch-T4 | CLAUDE.md + definitions.md + evaluation-protocol.md | 3 |

---

## 整合

- `rule-rollout-closure.md` Step 1 **引用本清單**作為枚舉依據
- `scripts/nightly_policy_grep.sh` 的 `glob` 欄位應對應 Tier 1~3 的檔案路徑模式
- `agents/agent-ops/_protocols/rules/banned-patterns.json` 的 `scope` 欄位可引用本清單的 Tier 標記

---

## 參考

- `agents/agent-ops/_protocols/rules/rule-rollout-closure.md` — Closure 四步 SOP（本清單為其 Step 1 的依據）
- `agents/agent-ops/_protocols/rules/no-haiku-policy.md` — 範例政策（ban haiku 事件主角）
- `agents/agent-ops/_protocols/rules/rule-rollout.md` — 規則推送協議（bulk-update 流程與歷史紀錄）
- `scripts/nightly_policy_grep.sh` — 自動化 grep gate（驗收工具）
- `agents/agent-ops/_protocols/rules/banned-patterns.json` — Rule 庫
