---
name: soul-md-rollback
type: protocol
priority: MANDATORY (Tier 1)
date: 2026-04-28
source: 用戶 2026-04-28 對 v7.3.2 教材的 4 點批評（隱憂 1 / 隱憂 2 / 主動 reflect）
scope: 全 team
related:
  - soul-md-edit-policy.md
  - inter-agent-feedback.md
  - rollback-sop.md
  - agent-slo.md
  - self-growth.md
---

# Soul.md Rollback Protocol（soul.md 變更退化偵測與還原）

> 版本：v1.0
> 適用：所有經 `soul-md-edit-policy.md` 寫入的 agent 定義檔

## 1. 規則目的

`soul-md-edit-policy.md` 防止「寫入時」的格式/結構錯誤，但無法偵測「寫入後 agent 行為變差」。本協議由 `agent-ops/evolution` worker 自動偵測退化，產出 rollback proposal 給 FDE 一鍵採納或拒絕，避免靜默退化長期累積。

關鍵原則：**Evolution 只提案，不擅自 rollback。FDE 是最終決策者。**

## 2. 退化偵測條件（量化）

Evolution worker 持續監控以下指標，**任一條件成立** 即觸發 proposal：

| 指標 | 閾值 | 來源 |
|------|------|------|
| 任務連續失敗 | ≥ 3 次（預設 N=3） | worklog `status=FAIL` |
| qa-reviewer 連續 FAIL | ≥ 3 次 | qa-reviewer outgoing |
| SLO 達成率跌幅 | ≥ 20%（7 日滑動 vs 變更前 7 日） | `agent-slo.md` 計算 |
| evaluator REVISE 比率突增 | ≥ 2x（變更前後 7 日對比） | evaluator outgoing |

且必須 **時間關聯**：退化起點 ≤ soul.md 最近一次變更後 3 日內。

## 3. Evolution Proposal Schema

Evolution worker 寫入：

```
agents/<team>/<worker>/memory/incoming/<YYYY-MM-DD>_evolution_rollback_proposal.md
```

frontmatter + body：

```yaml
---
from: agent-ops/evolution
to: FDE/<owner>
date: 2026-04-28
topic: <worker> 連續退化建議 rollback
proposal_id: ROLLBACK-20260428-001
target_file: agents/edu/content-designer/soul.md
trigger: consecutive_fail | slo_drop | revise_spike | qa_fail
---

## 變更時間線
- 2026-04-25 14:32 — FDE 修改 soul.md（+P6 教材必含 worked example）
  - backup: soul.md.bak.2026-04-25-143211

## 退化指標
- 連續任務失敗：4 次（2026-04-26 ~ 2026-04-28）
- evaluator REVISE 率：變更前 12% → 變更後 38%（+217%）
- 失敗任務 ID：[TASK-426-A, TASK-427-B, TASK-428-A, TASK-428-C]

## 建議 rollback
- 還原至：soul.md.bak.2026-04-25-143211
- 預期效果：恢復 P6 變更前狀態
- Risk assessment: LOW（僅 1 條 principle 差異，影響範圍小）

## FDE 決策
- [ ] 採納 rollback（自動 mv 並寫 audit）
- [ ] 拒絕 rollback（請補寫 lesson 為何不 rollback）
- [ ] 部分採納（指定保留哪些變更）
```

## 4. FDE 決策樹

收到 proposal 後，FDE 三選一：

```
proposal 收到
   │
   ├─ 採納 → 觸發 apply-rollback.sh <proposal_id>
   │         - cp <bak> <file>
   │         - 寫 audit log（actor=FDE, source=evolution_proposal）
   │         - 通知 Evolution「已 rollback」
   │         - Governance audit 必審查（防 Evolution 誤判）
   │
   ├─ 拒絕 → 觸發 reject-rollback.sh <proposal_id> --reason=<text>
   │         - 寫 lesson 到 agents/agent-ops/evolution/memory/lessons/
   │         - 內容含：為何不 rollback、退化的真實原因、後續對策
   │         - Evolution 學習，下次相同 pattern 不再提案
   │
   └─ 部分採納 → 派 agent-builder 做精準修改
              - Builder 讀 proposal + .bak 內容 + 現況
              - 產出新 patch（非整檔 rollback）
              - 過 soul-md-edit-policy 三層攔截
```

## 5. Governance 審查（防 Evolution 誤判）

每次 rollback 採納後，`agent-ops/governance-auditor` **必須事後審查**：

- Trigger：FDE 採納 rollback 完成
- 檢查項目：
  1. 退化指標是否真實（比對原始 worklog/SLO 數據）
  2. rollback target（.bak）內容是否真為「退化前」狀態
  3. 是否存在其他變更同期影響（避免歸因錯誤）
- 結果：寫入 `agents/agent-ops/governance-auditor/memory/audits/<proposal_id>.md`
- 若發現 Evolution 誤判 → 標記為 false_positive，Evolution 必須學習

## 6. Worked Example：edu/content-designer 退化案例

時間線：

```
2026-04-25 14:32 — FDE 加 P6（教材必含 worked example）
2026-04-26      — 第一次任務 FAIL（content-designer 過度堆 example，違反 P3 簡潔）
2026-04-27      — 第二次任務 FAIL（同樣症狀）
2026-04-28 09:00 — 第三次任務 FAIL → Evolution 觸發
2026-04-28 09:15 — Evolution 寫 proposal ROLLBACK-20260428-001
2026-04-28 10:00 — FDE 讀 proposal，分析後發現「P6 與 P3 衝突」
                   選擇「部分採納」：派 agent-builder 改 P6 為「教材建議含 worked example，
                   但不得犧牲 P3 簡潔（每章至多 2 個範例）」
2026-04-28 10:30 — Builder 完成 patch，過 3 層攔截，寫入
2026-04-28 11:00 — Governance audit ROLLBACK-20260428-001
                   結論：退化指標真實，Evolution 提案正確（但 FDE 用 partial 更佳）
2026-04-29      — 任務恢復正常
```

## 7. 與相關 protocol 的關係

- **soul-md-edit-policy.md（預防）** vs **本協議（補救）**：
  - 編輯政策阻擋「寫得不對」的內容（格式/結構）
  - 本協議補救「寫得對但效果不好」的內容（行為退化）
- **inter-agent-feedback.md**：proposal 本質就是 evolution → FDE 的退件，套用該 schema。
- **rollback-sop.md**：採納後的實際 mv 流程依該 SOP。
- **agent-slo.md**：退化指標的 SLO 計算依該定義。

## See also

- `agents/agent-ops/_protocols/rules/soul-md-edit-policy.md`
- `agents/agent-ops/_protocols/rules/inter-agent-feedback.md`
- `agents/agent-ops/_protocols/rules/rollback-sop.md`
- `agents/agent-ops/_protocols/rules/agent-slo.md`
- `agents/agent-ops/_protocols/rules/self-growth.md`

## Implementation status

| 項目 | 狀態 |
|------|------|
| 協議文件 | DONE（本檔） |
| `agent-ops/evolution` worker（退化偵測） | 待實作（scripts 階段 2） |
| `scripts/apply-rollback.sh` | 待實作 |
| `scripts/reject-rollback.sh` | 待實作 |
| `agent-ops/governance-auditor` 事後審查 | 待實作（與 edit-policy 共用） |
| Evolution proposal 模板 | 待實作 |
| SLO 7 日滑動視窗計算 | 待實作 |
