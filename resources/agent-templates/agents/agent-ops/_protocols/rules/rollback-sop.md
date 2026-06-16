# Rollback SOP（備份還原標準流程）

> 版本：v1.1
> 建立日期：2026-04-24
> 最後更新：2026-04-28（v1.1：與 soul-md-edit-policy.md reconcile 命名）
> 作者：agent-ops/agent-builder（gap-analysis 收斂 Batch D，補 Gov 路 3 警告）
> 適用：所有 agent 系統檔案的備份還原操作
> 相關 protocol：`agents/agent-ops/_protocols/rules/soul-md-edit-policy.md`（Layer 3 Atomic Write）

## 命名慣例

**新格式（2026-04-28 起首選）**：

- `{file}.bak.<YYYY-MM-DD-HHMMSS>` = 寫入前的精確時間戳快照
- 採用理由：時間戳精確到秒，序號比較與時間順序一致；與 `soul-md-edit-policy.md` Layer 3 對齊

**舊格式（2026-04-24 之前的歷史備份）**：

- `{file}.bak.<YYYY-MM-DD>` = 該日期「第一次修改之前」的快照
- `{file}.bakN.<YYYY-MM-DD>` = 該日期「第 N 次修改之前」的快照（N 值大者較新）

**2026-04-28 update**：與 `soul-md-edit-policy.md` 對齊，新建備份統一用 `.bak.<YYYY-MM-DD-HHMMSS>` 時間戳格式；既有 `.bak.<date>` / `.bakN.<date>` 流水號備份保留可用，但**不再新增**該格式。Rollback 時兩種格式並存，依時間排序判斷新舊。

## 還原規則（黃金法則）

**規則 1 — 較新的版本是「序號或時間戳值較大者」**：

- 時間戳格式：`.bak.2026-04-28-143511` 比 `.bak.2026-04-28-101200` 新
- 流水號格式：`.bak3` 比 `.bak2` 新，`.bak2` 比 `.bak` 新
- 混用時：依檔案 mtime 或字典序排序（時間戳是 ISO 8601-like，可直接字典序排）

**規則 2 — 一路還原從新到舊**：要退回 N 代前，順序為「最新備份 → 次新 → … → 目標備份」。
**規則 3 — 永遠不直接跳**：除非要完全退到第一次改動前，否則不得跳過中間備份。

## 新建檔連帶刪除清單（Dangling Reference 防護）

以下新建檔若要刪除 rollback，必須連帶 revert 引用它的檔案：

| 刪除目標 | 必須同時 revert | 理由 |
|---|---|---|
| `agents/agent-ops/_protocols/evidence-protocol.md` | `agents/sw/developer/soul.md`（移除 P9）/ `agents/sw/developer/skills.md`（移除 skill 6）/ `agents/sw/manager/workflow.yaml`（移除 references 區）/ `agents/agent-ops/_protocols/dual-audit-protocol.md`（移除 reference） | Developer 與 Manager 文件明確 reference 此 protocol |
| `agents/agent-ops/_protocols/dual-audit-protocol.md` | `agents/sw/manager/soul.md`（移除 P17 reference）/ `agents/sw/reviewer/soul.md`（移除 P9 reference）| Manager 與 Reviewer soul 引用 |
| `agents/sw/manager/workflow/dual-audit-flow.md` | `agents/sw/manager/workflow.yaml`（移除 `audit_doer_facts` 與 `audit_reviewer_process` 兩 step + references 區）/ `agents/agent-ops/_protocols/dual-audit-protocol.md`（移除「參考實作」引用）| workflow 兩個新 step 直接 ref 此 flow |

## 完全 Rollback 順序（退回 gap-analysis 階段 1-3 前）

**前置**：盤點哪幾個 batch 要退。

**Batch D 回退**（若只退 Batch D）：
1. `cp reviewer/skills.md.bak2.2026-04-24 reviewer/skills.md`
2. `cp manager/workflow.yaml.bak3.2026-04-24 manager/workflow.yaml`
3. `rm protocols/rules/rollback-sop.md`
4. （若 evidence-protocol.md、dual-audit-protocol.md、dual-audit-flow.md 有 .bak2 也用 .bak2 覆蓋 current）

**Batch C 回退**（接續 D 或單獨）：
1. `cp reviewer/soul.md.bak.2026-04-24 reviewer/soul.md`
2. `cp reviewer/skills.md.bak.2026-04-24 reviewer/skills.md`
3. `cp manager/workflow.yaml.bak2.2026-04-24 manager/workflow.yaml`
4. `cp manager/workflow/dual-audit-flow.md.bak.2026-04-24 manager/workflow/dual-audit-flow.md`
5. `rm protocols/dual-audit-protocol.md`

**Batch B 回退**：
1. `cp manager/soul.md.bak.2026-04-24 manager/soul.md`
2. `cp manager/workflow.yaml.bak.2026-04-24 manager/workflow.yaml`
3. `rm manager/workflow/dual-audit-flow.md`

**Batch A 回退**：
1. `cp developer/soul.md.bak.2026-04-24 developer/soul.md`
2. `cp developer/skills.md.bak.2026-04-24 developer/skills.md`
3. `rm protocols/evidence-protocol.md`

## Rollback 後必做驗證

1. `grep -r "self-added 2026-04-24" agents/sw/ agents/agent-ops/_protocols/` 應回 0 匹配（完全 rollback 情境）
2. `grep -r "evidence-protocol\|dual-audit" agents/sw/ agents/agent-ops/_protocols/` 應全無匹配（完全 rollback 情境）
3. `python -c "import yaml; yaml.safe_load(open('agents/sw/manager/workflow.yaml'))"` 必須 exit 0
4. Manager 重新 dispatch 一次測試任務，確認 workflow 能跑完（不觸發 block_and_report）

## 版本歷程

| 版本 | 日期 | 作者 | 變更 |
|---|---|---|---|
| v1.0 | 2026-04-24 | agent-ops/agent-builder | 初版建立（gap-analysis Batch D，補 Gov 路 3 警告） |
| v1.1 | 2026-04-28 | agent-ops/agent-builder | 與 `soul-md-edit-policy.md` 對齊命名，新建備份統一用 `.bak.<YYYY-MM-DD-HHMMSS>` 時間戳格式；舊有 `.bakN.<date>` 序號備份保留但不再新增（governance v7.4.1 reconcile） |
