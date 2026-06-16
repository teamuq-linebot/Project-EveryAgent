# Memory Hygiene Protocol

## 1. 設計原則
memory-protocol.md 定義了如何寫入記憶，本協議補充如何管理記憶的生命週期。
每個 agent 負責自己的 memory/ 目錄衛生。

<!-- 2026-06-06 hygiene upgraded (Tier3 approved, trace-memory-improvement-20260606): >20 → importance×recency 2D; monthly full-system scan owner=Evolution; prune-candidate threshold=5; §9 unchanged -->
## 2. 觸發條件
判準由「單一檔數門檻」升級為 `importance × recency`（見 §4 keep_score）。
過渡期 recency 維度依 last_update 普及度分階段啟用（見 §4 過渡辦法）。

| 觸發類型 | 條件 | 誰執行 | 啟用維度 |
|---------|------|-------|----------|
| 定期 | 每 30 個任務（worklog 計數） | Agent 自身 | importance + consolidate |
| 空間 | memory/ 超過 20 檔 **或** prune 候選 ≥ 5 | Agent 自身 | importance + consolidate |
| 月度全系統 | 每月一次全 repo 掃描 | Evolution | 全維度（recency 自 2026-06-06 起啟用） |
| 按需 | Evolution 分析時要求 | Evolution | 全維度 |
| 自我反思時 | self-growth retrospective 觸發 | Agent 自身 | importance + consolidate |

## 3. Memory 分類標準
| 分類 | 定義 | 保留標準 |
|------|------|---------|
| Projects | 有截止日的進行中項目 | 截止日前保留，完成後移至 Archives |
| Areas | 持續監控的領域知識 | 6 個月內使用過 → 保留 |
| Resources | 外部研究摘要、工具說明 | 1 年內引用過 → 保留 |
| Archives | 已完成或停用的知識 | 永久保留（壓縮格式） |

## 4. 記憶老化規則（Staleness Rules）
老化判定 keep_score 改以 **access 為主訊號**（真實使用價值），無 access 資料時退回 last_update（過渡 fallback，不誤砍）：

```
recency_factor = 1 / (1 + months_since_last_accessed)   # 有 access 資料：被引用越近分越高
freq_factor    = 1 + log10(1 + access_count)            # 常被引用的加分（log 壓縮）
keep_score     = importance × recency_factor × freq_factor
```

- **importance == 5 → 永久豁免**，不受 access/recency 影響，永不 prune。
- **prune 候選（三條件全中才標 stale）**：`importance ≤ 2` **且** `access_count ≤ 1`（幾乎沒被引用）**且** `months_since_last_accessed > 6`（>6 月沒被用到）→ 標記 stale。
- 標記 stale 後 30 天未確認仍有效 → 移至 Archives（**不自動刪除**，見 §9）。
- 已知過時的 Known Issues（已修復 bug、過時工具版本）→ 標記待刪，由 agent 自身確認後刪。
- **access 資料來源**：`last_accessed` / `access_count` 兩個 frontmatter 欄位，由 access 增量腳本自動維護（見 `agents/agent-ops/_protocols/memory-protocol.md` Access 欄位段 + `agents/agent-ops/_protocols/log-protocol.md` §6.1）。agent 不手填。
- **過渡 fallback（關鍵，保證不誤砍）**：當某檔 `has_access_data = (last_accessed 非空) 或 (access_count > 0)` 為 **false**（log 尚未累積到該檔）→ **位元級退回現行行為**：`recency_factor = 1/(1+months_since_last_update)`、`freq_factor = 1`，prune 候選只用「`importance ≤ 2` 且 `months_since_last_update > 6`」雙條件（與本次升級前完全一致）。`last_update` 取值優先序：**last_update → 檔內最舊 ISO 日期 → created；絕不採用 Google Drive mtime**。
- **不誤砍的根據**：(1) 無 access 資料時退回的是已驗證的現行邏輯，落地當天行為不變；(2) 有 access 資料只會替「被引用過的檔」加分（keep_score 上升、更不會被砍），access 是加保護不是加風險；(3) importance==5 全程豁免、全程只標記不自動刪（§9）、30 天確認窗 + 移 Archives 不刪的安全網不變。隨 log 累積系統自動從 fallback 過渡到 access 主訊號，無需手動切換或一次性回填。

<!-- 2026-06-07 Phase 1 access-frequency keep_score; fallback to last_update when no access data; §9 unchanged -->

## 5. 記憶驗證規則（Accuracy Rules）
對以下類型進行主動驗證：
| 類型 | 驗證方式 |
|------|---------|
| Known issues | Glob/Read 確認問題是否仍存在 |
| Codebase patterns | Grep 確認 pattern 仍一致 |
| Decisions made | 查 worklog 確認決策未被推翻 |

## 6. 記憶整合規則（Consolidation Rules）
- 同一主題出現 3+ 個 memory 檔案 → 合併為一個
- 合併時保留最新 created 日期
- 標記：<!-- consolidated from {n} files on {date} -->
- 合併後更新 MEMORY.md 索引

## 7. 記憶升級路徑（Upgrade Path）

記憶不只是保存——有價值的記憶應該升級為更正式的 agent 能力。

### 7.1 升級層級

```
memory/ （原始學習）
  ↓ 出現 3+ 次且每次有效
skill （skills.md 新增技能）
  ↓ 被 3+ 不同 agent 需要
protocol （agents/agent-ops/_protocols/ 新增協議）
  ↓ 跨團隊共通
system rule （definitions.md 或 CLAUDE.md 更新）
```

### 7.2 Memory → Skill 升級條件
| 條件 | 說明 |
|------|------|
| 被引用 3+ 次 | 在不同任務中反覆使用 |
| 每次都有效 | 沒有導致失敗或需要修正 |
| 可模式化 | 能寫成 "When X, do Y" 的標準格式 |
| 屬於該 agent 的領域 | 不超出 scope |

**執行方式：**
- Agent 自行在 skills.md 新增，標記 `<!-- self-added {date}, upgraded from memory/{filename} -->`
- 原始 memory 移至 Archives（不刪除，保留溯源）

### 7.3 Skill → Protocol 升級條件
| 條件 | 說明 |
|------|------|
| 3+ agent 都需要 | 跨 agent 共通知識 |
| 非領域專屬 | 是通用流程而非特定技能 |
| 可標準化 | 能定義明確的輸入/輸出/步驟 |

**執行方式：**
- 需要 Agent Builder + Governance 審批
- Agent Builder 建立新 protocol
- 各 agent 的 skills.md 引用 protocol（取代重複的 skill）

### 7.4 Protocol → System Rule 升級條件
| 條件 | 說明 |
|------|------|
| 全系統適用 | 所有 team 都需要遵守 |
| 不可違反 | 違反會導致系統失敗 |
| 經 Governance 確認 | 已經過至少 1 個月的 protocol 驗證期 |

**執行方式：**
- Governance 提案 → 用戶確認 → Agent Builder 更新 definitions.md 或 CLAUDE.md

### 7.5 降級規則
升級不是單向的——不再有效的知識應該降級：
- Skill 連續 3 次任務未使用 → 考慮降級回 memory
- Protocol 連續 2 個 review 週期無使用 → 歸檔
- 降級需 Governance 確認（防止誤刪有價值的標準化知識）

## 8. 審查紀錄格式
存入 memory/review-log-{YYYY-MM-DD}.md：

---
topic: memory-review-log
created: {YYYY-MM-DD}
agent: {agent-name}
trigger: scheduled | space_limit | on_demand
---

### 審查摘要
- 審查時 memory 數量：{n} 個
- 標記 stale：{n} 個
- 已刪除：{n} 個
- 已整合：{n} 組 → {n} 個
- 審查後 memory 數量：{n} 個

### 處置詳情
| 檔案名 | 操作 | 原因 |
|-------|------|------|

## 9. 禁止行為
- 刪除 Archives 類 memory
- 操作其他 agent 的 memory/
- 合併時刪除有歧義的部分（標記 <!-- needs_verification --> 保留）

## 10. 與現有協議的關係
- 擴展 memory-protocol.md（不修改現有格式定義）
- 引用 self-growth.md（同目錄，retrospective 觸發 memory review）
- 引用 worklog-protocol.md（計數觸發來源）

## 11. 長任務 In-Context 管理
長任務或多輪 dispatch 中的 in-context 管理（Compaction / Tool-result Clearing / Memory Tool）
見 `context-engineering.md`（同目錄）。本協議管理跨 session 的記憶生命週期；`context-engineering.md` 管理單次執行的 context 用量優化，兩者互補。
