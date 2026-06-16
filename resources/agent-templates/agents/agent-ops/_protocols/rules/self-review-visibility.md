<!-- created 2026-05-08 by agent-ops/agent-builder, trace=agentops-20260508-0518-self-review-visibility-rule, parent=agent-ops/manager, requested by david @ 2026-05-08 -->

# Self-Review Visibility Rule — 自我回顧可見性規範

<!-- metadata
last_updated: 2026-05-08
revision_reason: User 反饋 (2026-05-08)：self-review 段落在 deliver 回應中屬雜訊，要求保留動作但移除可見性
rule_number: 30
revisions:
  - r1.0 (2026-05-08): initial creation — trace agentops-20260508-0518-self-review-visibility-rule
-->

**地位**：Manager 行為規範（Manager Behavior Rule），適用於所有具有 self-review Principle 的 Manager / Director / Officer。與 `shell-preference.md`、`credential-management.md` 同等級。

---

## 1. 適用範圍

所有 Manager / Director / Officer 在 workflow 結束時的 self-review 動作，包含但不限於：

| Agent | 對應 Principle（r1.0 時已知） |
|-------|------------------------------|
| `agents/agent-ops/manager` | P20「Self-review every task」 |
| `agents/sw/manager` | P14「Self-review every task」 |
| `agents/edu/manager` | （R2 rollout 時動態 grep 確認） |
| `agents/sales/manager` | （R2 rollout 時動態 grep 確認） |
| `agents/bni/manager` | （R2 rollout 時動態 grep 確認） |
| `agents/finance/manager` | （R2 rollout 時動態 grep 確認） |
| 其他具備 self-review Principle 的 Manager | （R2 rollout 時動態 grep 確認） |

**不適用**：Worker agent（非 Manager）的工作總結不屬於本規則，不受約束。

---

## 2. 核心規則

### 2.1 Self-review 仍是天條（不可省）

每次 task 結束前，Manager 必須執行 retrospective，涵蓋三個面向：
1. **做對什麼** — 本次執行的亮點與正確決策
2. **做錯什麼** — 偏差、遺漏、品質問題
3. **下次改進建議** — 具體可操作的改善方向

**內容仍須完整產出**，本規則僅改變輸出地點，不得以「規則禁止顯示」為由省略 self-review 實質內容。

### 2.2 輸出地點：memory-only

Self-review 結果必須寫入 `agents/{team}/manager/memory/`，例如：

- `memory/retrospective-{date}-{task_id}.md`
- `memory/learning_{topic}_{date}.md`

命名應含 `trace_id` 或 `task_id`，方便 Governance 稽核回溯。命名細節依 `memory-protocol.md` 規範執行。

### 2.3 禁止顯示在最終 user 回應中

deliver step 的最終回應**不得**包含 self-review 內容，禁止形式包括：
- 展開「做對 / 做錯 / 改進建議」三段落
- 以「Self-Review」「Retrospective」「自我回顧」等顯眼標題呈現
- 用 bullet list 或表格嵌入 self-review 內容
- 以 `<details>`/`<summary>` collapsible 標籤收起但仍嵌入回應

### 2.4 例外（三種情境可提及，但僅限摘要形式）

以下情況**可以**在最終回應中提及 self-review，但**仍須以最小化摘要形式**（不展開三段完整內容）：

| 情境 | 允許形式 |
|------|---------|
| User 主動要求（明確問「這次做得怎樣？」）| 展開完整三段，但仍建議同步寫 memory |
| 重大事故（severity HIGH+）需告知改進方向 | 一行摘要 + 事故 ID，完整三段仍寫 memory |
| Open TODOs 中有需要 user 決定的 self-review follow-up | 一行說明 + 具體待確認事項 |

**最小化摘要形式範例**：
```
（self-review 已寫入 memory，含 3 條改進，無需 user action）
```

---

## 3. 為什麼

User 反饋（2026-05-08）：每次最終回應都顯示 self-review 三段是對話雜訊，影響可讀性與信噪比。但 self-review 對 agent 自我改進循環不可或缺，不可省略。

**折衷原則**：保留動作，移除可見性。Self-review 繼續產生完整價值，但僅流向 memory（供未來 evolution/governance 使用），不進入 user 的對話視野。

---

## 4. 強制 / 禁止

### ❌ 禁止
- 在最終 user 回應的任何段落（含「總結」「附錄」「注意事項」等）展開 self-review 三段內容
- 把 self-review 包裝成「Self-Review」「Retrospective」「回顧」「自我檢討」等顯眼段落標題
- 以 collapsible 標籤（`<details>`/HTML comment）把 self-review 收起但仍嵌入回應——user 仍可見
- 以「規則要求不顯示 self-review」為由，跳過 self-review 的實質產出

### ✅ 強制
- 每次 task 仍寫完整 self-review（三面向）到 memory，不得省略實質內容
- Memory 檔名應含 trace_id 或 task_id，方便 Governance 稽核回溯
- 重大事故（severity HIGH+）的 self-review 必須在 incident note 中保留完整三段，供未來 governance 稽核
- 發生例外情境（§2.4）時，以最小化摘要形式呈現，不展開完整三段

---

## 5. 與既有 rules / protocols 關聯

| 既有規則 / 協議 | 關聯說明 |
|----------------|---------|
| `agents/agent-ops/manager/soul.md` P20 | 本規則明確該 Principle 的 visibility 限制；R2 rollout 將在 P20 加註引用 |
| `agents/sw/manager/soul.md` P14 | 同上 |
| 其他 manager 對應 Principle | R2 rollout 以動態 grep 確認各 manager 的 self-review Principle 編號，再加註引用 |
| `self-growth.md` | Self-review 是 self-growth loop 的 input source；本規則不斷 self-review，只改輸出地點 |
| `memory-protocol.md` | Self-review 寫入 memory 的命名、格式、TTL 規範依 memory-protocol.md 執行 |
| `evaluation-protocol.md` | Governance 稽核時可讀 self-review memory，但不要求 user 接收 self-review 可見性 |
| `agent-sre.md` | 重大事故的 self-review 同步觸發 incident note，需在 incident note 保留完整三段 |

---

## 6. Rollout 計畫（本輪 scope 外，R2+）

**R2 執行原則**：必須以動態 `grep -n "self-review\|Self-review\|retrospective" {soul.md}` 取得各 manager 的實際 Principle 編號，**禁止使用硬編號**（避免重蹈 credential rule rollout 的編號錯誤）。

| Manager | Principle 編號（R2 時動態查） | 修改內容 |
|---------|------------------------------|---------|
| `agent-ops/manager` | 動態 grep | 加註 `visibility: memory-only, see protocols/rules/self-review-visibility.md` |
| `sw/manager` | 動態 grep | 同上 |
| `edu/manager` | 動態 grep | 同上 |
| `sales/manager` | 動態 grep | 同上 |
| `bni/manager` | 動態 grep | 同上 |
| `finance/manager` | 動態 grep | 同上 |
| 其他具 self-review Principle 者 | 動態 grep | 同上 |

R2 rollout 觸發條件：本規則（rule #30）建立後，由 agent-ops/manager 排程 R2 任務。

---

## 7. 例外申請流程

**無** — 本規則不設例外申請流程。Self-review visibility 是 user 明確偏好設定（2026-05-08 反饋），無業務理由違反。

若未來有特殊需求，直接修訂本規則（需 Agent Builder + Manager HITL 確認），而非個案例外。

---

## 8. 規則生效時間

**即時生效**（rule 建立當下，2026-05-08）。

- **已執行的 task**：不溯及既往，不修改或清理過去已寫入 deliver 回應中的 self-review 內容
- **本規則建立後的所有 task**：所有具 self-review Principle 的 Manager 從本規則生效起即應遵守
- **soul.md 加註**：R2 rollout 完成前，各 manager 以本規則為準（rules 目錄優先）；R2 完成後 soul.md 同步更新

---

*本規則為系統層 Manager 行為規範（rule #30），由 agent-ops/agent-builder 建立，agent-ops/manager 透過 R2 rule-rollout 機制推送至各 manager soul.md。*
