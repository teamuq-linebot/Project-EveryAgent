---
name: no-haiku-policy
description: 全系統禁用 haiku model，預設 sonnet，複雜推理升 opus
type: policy
priority: MANDATORY
date: 2026-04-27
source: user 2026-04-27
scope: 全 team
---

# No Haiku Policy

## 規則

- ✅ 預設：`sonnet`
- ✅ 複雜推理 / Tier 3 治理：`opus`
- ❌ 禁用：`haiku`

## Why

1. **品質一致性**：haiku 在涉及判斷、研究、審查、語意校對的任務上表現不穩，曾多次造成回頭重做的成本超過 haiku 節省的成本。
2. **規則簡單**：避免 Manager 派工時還要猜哪些任務「夠機械」可降 haiku。預設 sonnet 即夠用，不需特例條款。
3. **與 Tier 3 治理對齊**：governance / officer 層級已強制 opus；worker 統一 sonnet 後，全系統只剩 sonnet/opus 兩層，調度單純。

## How to apply

### A. 新建 agent

- `agent.yaml` 的 `dispatch.model` 只能填 `sonnet` 或 `opus`
- 預設 `sonnet`；若 agent 屬 governance / cross-team officer / Tier 3 critical decision，填 `opus`

### B. Manager workflow.yaml 派遣 step

- `model:` 欄位只能填 `sonnet` 或 `opus`
- 若引用既有寫 `model: haiku` 的範本，**改為 `sonnet`** 並加註 `# 2026-04-27: haiku→sonnet（user policy: ban haiku）`

### C. 既有檔案遷移

- 任何含 `model: haiku` 的活檔（`*.yaml` / `*.md`），bulk update 為 `model: sonnet` 並加註原因
- 不修：worklog 歷史 JSON（紀錄性檔案，反映當時實況）、`*.bak.*` 備份檔、archive/ output/ 內檔案、本 policy 自身與 `feedback_no_haiku_*.md`（規則文檔本身會引用 haiku 字串說明禁令）

## 例外

無。用戶 2026-04-27 明確規則：**全系統禁 haiku**。

如後續發現有特殊任務必須降 haiku（極度成本敏感 + 純機械），需走 Governance 正式變更流程，並由用戶簽核才能解禁。

## Enforcement

- **Governance 審查**：每次 agent 系統變更時，governance 對 `model: haiku` 字串做 grep gate，命中即 block
- **Agent Builder**：建檔時若用戶或上游 spec 指定 haiku，先回拒並引用本 policy
- **Manager**：派工時不得用 haiku 模型參數呼叫 sub-agent

## See also

- `agents/agent-ops/manager/memory/feedback_no_haiku_default_sonnet_or_opus.md` — 規則來源 memory（用戶 2026-04-27 直接指示）
- `agents/agent-ops/governance/reports/haiku-ban-policy-review-2026-04-27.md` — 第一輪 bulk update 後的 governance 條件批准報告，列第二輪 P0 修改清單
- `agents/agent-ops/_protocols/evaluation-protocol.md` — Score → Model Mapping（2026-04-27 已同步移除 haiku 選項）
- `agents/agent-ops/_protocols/definitions.md` — agent.yaml schema 範本（2026-04-27 已同步移除 haiku 選項）
