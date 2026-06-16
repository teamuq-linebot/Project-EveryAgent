# Instruction Surface Budget — 指令表面積預算

> **起源**：2026-05-12 用戶觀察「Claude 忽略指令頻率上升」，agent-ops 量化 instruction surface 達 50-80KB 後設立此規則。
> 詳見 `output/agent-ops/instruction-diet-plan-20260513/instruction-diet-plan-v1.md`。
>
> **Owner**: agent-ops/manager + agent-ops/evolution
> **Cadence**: 由 self-growth.md Step 4 觸發（每次 self-growth 反思自動帶 budget check），無獨立 quarterly cron
> **生效日期**: 2026-05-13

---

## 1. 為什麼要管 instruction surface

模型的 attention budget 有限。當 system prompt 累積過多規則、歷史紀錄、重複條目，模型對關鍵指令的遵循率會下降 — 不是「不想遵守」，而是訊號在雜訊中稀釋了。

**Self-growth 的副作用**：agent-ops 本身倡導「加法自己來、減法要審批」，這有效避免了誤刪重要規則，但也造成 soul.md / MEMORY.md 持續膨脹、從未收縮。

**核心矛盾**：用更多指令解決「指令被忽略」的問題 = 反效果。正確方法是縮減指令總量、提升每條指令的訊噪比。

本文件是對 self-growth 機制的補充約束：加法有上限，超限觸發季度 diet。

---

## 2. 預算上限（per manager / per memory）

| 對象 | 上限 | 警戒（觸發 review） | 硬觸發（立即排入下一 diet） |
|------|-----:|--------------------:|---------------------------:|
| 任一 manager `soul.md` | 行數 ≤ 150 / Principles ≤ 20 | > 150 行 OR > 20 條 | > 200 行 OR > 30 條 |
| 任一 manager `MEMORY.md` | 行數 ≤ 130 | > 130 行 | > 180 行 |
| 專案 `CLAUDE.md` | 行數 ≤ 250 | > 250 行 | > 350 行 |
| 全域用戶 `CLAUDE.md` | 行數 ≤ 50（用戶主導） | 不主動干預，僅報告 | — |
| 任一 agent `skills.md` | 條目 ≤ 12 | > 12 | > 18 |
| 任一 agent `workflow.yaml` | step 數 ≤ 18 | > 18 | > 25 |

> 上限數值可隨演進修訂，但每次調整須附理由並記錄於 `output/agent-ops/instruction-diet-Q{N}-{YYYY}/budget-changelog.md`。

---

## 3. 觸發機制（依 self-growth.md 整合）

本檔的預算上限（§2）由 `agents/agent-ops/_protocols/rules/self-growth.md` Step 4「Budget Check & Reduction Proposal」在每次 self-growth 觸發時自動查詢使用。

**不需獨立的 quarterly cron routine** — self-growth.md 的三個既有觸發條件（任務計數 / 失敗觸發 / 用戶糾正）已是自然頻率，每次觸發都會自動帶 budget check + 必要時的 reduction 提案。

**例外手動觸發**：用戶觀察到「規則忽略頻率上升」類訊號時，可 ad-hoc 派 agent-ops/evolution 跑全 team budget audit（一次性，非排程）。

---

## 4. Anti-overcorrection 保護

以下原則**在任何情況下不得違反**：

- **不刪 worklog 機制**：worklog 天條（start/end 義務）永遠保留
- **不刪 Scope Guard**：每個 agent 的 domain 邊界定義
- **不刪 HITL Gate**：Tier 2 / Tier 3 檢查點
- **不刪 Principle 1**（每個 agent 的核心識別原則）
- **不為縮短而合併語意不同的條目**：寧可行數多，也不混淆指令
- **不一輪全推**：破壞 baseline 觀察，必須分批
- **每 Batch 前建立 .bak 快照**：確保可回滾

---

## 5. 加法時的同步義務（Self-growth Coupling）

每次新增規則到 `soul.md` 或 `MEMORY.md` 時，執行者**必須**在 `<!-- self-added YYYY-MM-DD -->` 標記旁附加以下三項自我審查：

```
<!-- self-added YYYY-MM-DD
  budget-check: 目前 [soul.md|MEMORY.md] = X 行，上限 Y 行，[OK|⚠️ 警戒|🚨 硬觸發]
  merge-check: 是否可合併至既有條目？[否，語意獨立|是，已合併至 L{N}]
  level-check: 是否應降為 protocol reference？[否，操作型 hard rule|是，已改為引用]
-->
```

若 `budget-check` 標示為 🚨，agent 必須在同一 session 內觸發下次 self-growth.md Step 4 重新評估（更新 agent-ops/manager MEMORY.md 的 Open TODOs）。

> `self-growth.md` 將在未來版本中引用本文件 §5 作為加法的審查條款。

---

## 6. Reference

| 文件 | 用途 |
|------|------|
| `output/agent-ops/instruction-diet-plan-20260513/instruction-diet-plan-v1.md` | 首次 diet 起源文件 |
| `agents/agent-ops/manager/memory/retrospective_doer_framing_relapse_20260512.md` | 過載副作用的具體 incident |
| `agents/agent-ops/_protocols/rules/self-growth.md` | 加法自治規則（本文件 §5 補充之） |
| `agents/agent-ops/_protocols/rules/memory-hygiene.md` | Memory 生命週期管理 |
| `agents/agent-ops/_protocols/rules/agent-slo.md` | Agent 服務水準目標 |
