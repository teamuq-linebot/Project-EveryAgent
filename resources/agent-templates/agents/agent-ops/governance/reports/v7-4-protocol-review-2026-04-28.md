---
report_id: v7-4-protocol-review-2026-04-28
auditor: agent-ops/governance
date: 2026-04-28
scope: 3 protocol + 2 scripts (v7.4 batch)
verdict: CONDITIONAL APPROVE
---

# v7.4 Protocol + Scripts Governance Review

## Decision: **CONDITIONAL APPROVE**

3 protocol + 2 scripts 在「設計層」品質高，內部一致，並已用實證（一跑就抓到 edu/manager 真 bug，而且額外揪出 goose-ops/manager 同型 bug、44 / 54 schema 缺失）證明對齊真實狀況。但**不可一鍵推送到全 team**——validate-soul-md.py 的嚴格 schema 與既有 80% agent 不相容，必須先做 schema reconciliation 或退化為 WARN，否則第一輪 rollout 會把多數 agent 變「不合規」並阻擋寫入。

通過條件：

1. v7.4.1 必補：validate-soul-md.py 的 `Decision-Making Style` 與 `Anti-patterns to Avoid` 兩項，先降為 WARN（或加 worker/manager profile 區分），不得 BLOCK。
2. 先用 edu team 試跑 7 日（含 evolution 退化偵測），通過後再推 sw / agent-ops，最後 bni / sales / finance。
3. 既有 2 manager 編號 bug 必須在啟用 lint enforcement 之前修掉，否則 edu/manager 與 goose-ops/manager 自己就無法寫入 soul.md。

---

## A. Protocol 內容（3 份逐項）

### A1. inter-agent-feedback.md（177 行）

| 項目 | 評估 |
|------|------|
| 規則目的清楚 | YES — 行號幻覺 + 退件不結構化兩大痛點明確列出 |
| Schema 可執行 | YES — issue_id / rubric / severity / locator / fix 五大欄位齊全，content_snippet ≥ 30 字元 + grep -F 流程具體 |
| 與既有衝突 | NO — 與 evaluator-rerun（流程）、feedback-memory（user→agent）、soul-md-edit-policy（套用 fix 前過 3 層）邊界清楚 |
| Worked example | YES — P30 案例真實（line 312 hint 但 grep 出 line 315，正好示範 hint 不可靠） |

**亮點**：以 `content_snippet` 為 ground truth，line 為 hint，這是解 LLM 幻覺的正確設計。**ESCALATE 三條件（zero / multi / 過短）量化合理**。

**小缺漏**：

- `incoming/` 目錄統一建立、`grep_snippet.sh` 接收方輔助腳本、ESCALATE 模板都還沒實作（自承 5/5 implementation 待做）。
- 沒指定 issue_id 的全域唯一性如何保證（兩 team 同日各自寫 ISSUE-20260428-001 怎麼辦），雖然作用域是「該檔案」，但 cross-team escalate 時可能撞號。**建議補一行：issue_id 在 `<from-team>/<to-team>` 配對下唯一。**

### A2. soul-md-edit-policy.md（185 行）

| 項目 | 評估 |
|------|------|
| 規則目的清楚 | YES — FDE 直改權限 + 3 層攔截 + post-write audit |
| Schema 可執行 | YES — Layer 1（lint 13 條） / Layer 2（schema 必要 sections） / Layer 3（atomic write + audit JSONL）三層具體 |
| 與既有衝突 | **PARTIAL** — Layer 3 備份命名 `.bak.<YYYY-MM-DD-HHMMSS>` 與 rollback-sop.md 的 `.bak.<YYYY-MM-DD>` / `.bakN.<YYYY-MM-DD>` 不同格式，雖都以 `.bak.` 開頭但排序規則不同（HHMMSS vs N），rollback SOP 「規則 1 — 序號大的是新狀態」要更新為「序號或時間戳大的是新狀態」 |
| Worked example | YES — FDE 加 P6 + lint fail 範例都實際 |

**亮點**：

- 「Principles 級 FDE 直改 / Architecture 級派 Builder」的權限分層界線清楚，**正中 feedback_fde_focus_architecture_not_prompt 的精神**。
- Async governance audit 走非阻擋路徑，避免「審查阻塞編輯」反模式。

**問題**：

- 命名格式與 rollback-sop.md 重疊但不相容，需在 Layer 3 一節補一句「此格式為 rollback-sop.md 的 superset，序號制 `.bakN` 仍可用於同秒內多次寫入」或直接 deprecate `.bakN` 並要求 rollback-sop.md v1.1 更新。
- 13 條 lint 規則順序在文件裡與 lint-soul-md.sh 內順序略不同（文件第 4 條「末尾換行」對應 script 第 4 條，但 12/13 在文件叫「Principles 編號 / TODO placeholder」，script 是「Principles / placeholder / 空檔」），無功能影響但對應表會稍有 mismatch — 建議下次 sync 改齊。

### A3. soul-md-rollback.md（163 行）

| 項目 | 評估 |
|------|------|
| 規則目的清楚 | YES — 補 edit-policy 漏掉的「寫入後行為退化」 |
| Schema 可執行 | YES — 4 條退化指標都有閾值（連續失敗 ≥3、SLO 跌幅 ≥20%、REVISE 突增 ≥2x、qa FAIL ≥3）+ 時間關聯 ≤3 日 |
| 與既有衝突 | NO — 「Evolution 提案，FDE 決策，Governance 審查」三權分立，不踩 self-growth.md / agent-slo.md 的腳 |
| Worked example | YES — content-designer P6 vs P3 衝突案例真實，FDE 選 partial 是好示範 |

**亮點**：

- **Evolution 只提案，不擅自 rollback** 的關鍵原則清楚 — 避免「自動化吃掉人類決策權」反模式。
- FDE 決策樹三選一（採納 / 拒絕 / 部分採納）覆蓋完整 — 拒絕路徑寫 lesson 讓 Evolution 學習，閉環設計。
- Governance 對 rollback 結果做事後審查，能抓 Evolution 的 false_positive。

**問題**：

- 「7 日滑動 vs 變更前 7 日」需要 ≥ 2 週連續工作量才能算數，新 agent 上線首 14 日無法觸發 SLO drop 偵測 — 文件未提及這個 cold-start 限制。**建議補一行：上線首 14 日改用 absolute SLO（< 70%）而非 drop。**
- proposal 走 `incoming/` 套 inter-agent-feedback schema 的設計優雅，但 `proposal_id` 與 `issue_id` 的命名空間應明確區分（前綴 ROLLBACK- vs ISSUE-），文件已做但建議在 inter-agent-feedback.md 也提一句 cross-reference。

---

## B. Schema 設計品質

### B1. snippet ground truth — 能解行號幻覺嗎？YES

`content_snippet ≥ 30 chars` 配合 `grep -F`（fixed string，不解析 regex）+ 三分支（unique / zero / multi），是業界對 LLM 行號幻覺最有效的 mitigation。對比直接信 `line: 312` 的設計，這套：

- 容錯位移（檔案有插入 / 刪除行不受影響）
- 容錯版本飄移（snippet 對不上自動 escalate，不會默默改錯地方）
- 量化失敗條件（< 30 char 自動退件）

**唯一小漏洞**：30 char 閾值對英文夠長，對中文（每字 3 byte）才約 10 字元，可能仍不唯一。建議加註：「中文檔案建議 snippet ≥ 50 字元（≈ 17 中文字）」。

### B2. 三層攔截順序合理性 — Lint → Schema → Atomic Write，YES

- Lint（grep 級語法）是最快、最便宜，先擋掉 90% noise。
- Schema（Python 級結構檢查）是中等成本，檢必要 sections。
- Atomic Write（cp + tmp + mv + JSONL）是最重的 disk I/O，放最後最對。

**Backwards compat 隱憂**：第一次跑就會擋掉 80% 既有 agent（見 D2 / E2），順序對但**啟用門檻不對**。

### B3. 退化偵測量化 — YES，但 cold-start 未處理

4 個閾值都明確，但：

- 「7 日滑動 vs 變更前 7 日」需 14 日資料 — 新 agent 不適用。
- 「evaluator REVISE ≥ 2x」對母數小的 worker 易被噪訊觸發（5 次中 2 次 vs 5 次中 4 次都是 2x）— 建議加 minimum sample N ≥ 10。

---

## C. Scripts 與 protocol 對齊

### C1. lint-soul-md.sh（256 行）

| 對齊度 | 評估 |
|--------|------|
| 13 條 check vs protocol Layer 1 | 對應一致，但**編號不完全 match**（script 第 13 條是「空檔案」，protocol 第 13 條是「placeholder TODO/FIXME」；script 第 12 是「placeholder」，protocol 第 12 是「Principles 編號連續」）— 功能對得上，編號需 sync |
| 既有檔執行行為 | **正確**——edu/manager/soul.md 跑出 3 行 FAIL（line 41 / 43 / 49），且額外抓到 goose-ops/manager 完全相同 pattern（line 74 / 80 / 84），兩個都是 rule-rollout 中插入新 P 條時 sandwich 既有 P 條的 merge bug |
| 性能 | **單一 awk pass + 一次 tail/od subprocess**，毫秒級。設計優秀 |
| Edge case | 空檔提早退出 / Windows MSYS 兼容 / 全形空白 awk regex / CRLF 偵測，覆蓋完整 |

**小問題**：

- Comment（line 16-19）寫「max line length（> 200 字元）」但實際 code（line 155）用 `length(line) > 600`（換算 200 中文字元）— 註解與 code 一致但說明不清楚，最好註解寫 `> 600 byte ≈ 200 中文字元`。
- Check 8（encoding UTF-8）原計劃用 Python 驗證，最後改為「awk 沒崩 + BOM 已檢就視為 UTF-8」（line 220-222）— 對 Latin-1 / GBK 等不會抓出來，僅 BOM-based 檢查。**建議改用 `python3 -c "open('$f', encoding='utf-8').read()"` 或保留現狀但補 doc 說明限制**。

### C2. validate-soul-md.py（343 行）

| 對齊度 | 評估 |
|--------|------|
| 5 條 check vs protocol Layer 2 | **對應一致**（H1 / 必要 sections / Principles 連續 / Anti-patterns 統一 / frontmatter） |
| 既有檔執行行為 | **過嚴** — 54 個 soul.md 中只 10 個 PASS，44 個 FAIL，主因是 80% worker 沒有 `## Decision-Making Style`，且 H1 格式分歧（`# Soul — XXX` vs `# XXX — Soul`）|
| 程式品質 | 純標準庫、無依賴、Report class 累積、frontmatter 解析穩 |
| Edge case | 空檔 / 非 UTF-8 / frontmatter 未閉合 都有處理 |

**核心問題**：**Schema 與既有現實脫節**

```
44 / 54 = 81.5% FAIL rate
原因分布（抽樣 6 個）：
  - 6/6 missing "## Decision-Making Style"   ← 普遍缺
  - 1/6 H1 format reversed                    ← 寫法分歧
  - 1/6 missing "## Anti-patterns to Avoid"   ← 缺或叫不同名
```

**這不是 script bug，是 protocol schema 太嚴 + 既有檔沒對齊 schema 寫**。如果直接啟用，下次任何 worker 編輯自己的 soul.md 都會被卡住。

---

## D. Tier 級風險

### D1. Tier 分類

| Protocol | Tier | 理由 |
|----------|------|------|
| inter-agent-feedback.md | **Tier 3** | 影響全 team 退件流程，schema 變動會造成大規模重寫 |
| soul-md-edit-policy.md | **Tier 3** | 影響全 team agent 定義檔寫入路徑，3 層攔截若誤判會卡住所有 FDE |
| soul-md-rollback.md | **Tier 3** | Evolution worker 若誤判會逼 FDE 處理 false-positive proposal，但因「只提案不執行」屬可控 Tier 3 |
| lint-soul-md.sh | Tier 2 | 工具，BLOCK 會擋寫入但不會誤改檔 |
| validate-soul-md.py | Tier 2 | 同上 |

3 protocol 全屬 Tier 3，**必須走 rule-rollout.md**：governance 審查 → manager 評估影響面 → agent-builder bulk-update → 每批跑 validate → 100% 推送率報告。

### D2. 推送策略

**禁止**：直接 commit + 全 team 啟用。原因見 C2 — 啟用即破壞 81% agent 寫入路徑。

**推薦：3 階段 rollout**

| 階段 | 範圍 | 時程 | 退出條件 |
|------|------|------|---------|
| Phase 1（試跑） | edu team（manager + 6 worker，共 7 個 soul.md） | 2026-04-28 ~ 2026-05-05（7 日） | 0 false-positive lint，1 個 evolution proposal 完整 round-trip |
| Phase 2（擴試） | sw + agent-ops（5 + 4 = 9 agent） | 2026-05-05 ~ 2026-05-12 | 兩 team 加總 lint pass 率 ≥ 95%，schema validate ≥ 90% |
| Phase 3（全推） | bni / sales / finance / platform / shared / agent-training（其餘 ~38 agent） | 2026-05-12 ~ 2026-05-19 | 全推完 + bulk-update 100% 完成 |

**前置條件（v7.4.1 必須先做）**：

1. `validate-soul-md.py` 補 worker / manager profile 區分：worker 不強制 `## Decision-Making Style`（降為 WARN），manager 才 BLOCK。
2. H1 格式 — 現有兩種寫法（`# X — Soul` vs `# Soul — X`）二擇一，protocol 補一行明確指定，再做 bulk-update 統一。
3. 修掉 edu/manager + goose-ops/manager 的編號 bug（避免 phase 1 試跑就被自家 lint 擋住）。

### D3. Backward compatibility

**目前狀態**：**NO** — 啟用 lint enforcement 後：

- 3 個 agent 的 soul.md 無法被自己編輯（lint FAIL）
- 44 個 agent 的 soul.md 無法被自己編輯（schema FAIL）

**修補後（v7.4.1）**：YES — 只要修上述 3 個 + 把 schema 降 worker 級為 WARN，剩餘破口在 Phase 1-3 漸進補齊，啟用前每 phase 須先過 100% 該 phase 的 agent。

---

## E. 既有 bug 處理建議

### E1. edu/manager/soul.md 編號錯誤修復策略

實際狀況（line 41-49）：

```
P10 (line 39) → P14 (line 41) → P11 (line 43) → P12, P13, P15, P16, ...
```

**修復策略 A（Renumber，建議）**：把 P14 移回正確位置（P13 之後），全段重新編號 P10 → P11 → P12 → P13 → P14（原 P14 內容）→ P15（原 P15 內容）...

**修復策略 B（Hold-stable）**：把 P14 內容（產出格式原則）改為 P14a/P14b 等小數編號 — **不建議**，與 lint 規則 #11「Principles 編號連續」衝突。

**最佳作法**：

1. 派 agent-ops/agent-builder 跑 minimal patch：
   - 把目前 line 41 的 P14（產出格式原則）下移至 line 49 後，編號改為 P15
   - 把目前 line 43-49 的 P11/P12/P13/P15 升一格編號為 P11/P12/P13/P14（這部分不變動內容，只動編號）
2. 過 lint + validate 驗證 PASS
3. 寫 audit log（actor=agent-builder, source=governance-report-v7.4）
4. 通知 edu/manager FDE：你的 soul.md P14 編號已修復

### E2. 全 team manager soul.md pre-flight 結果

跑了全部 8 個 manager + 全部 54 個 soul.md：

**Lint 結果（13 條語法）**：

| 結果 | 數量 | 檔案 |
|------|------|------|
| PASS | 51 | （多數）|
| FAIL | 3 | edu/manager（編號錯）/ goose-ops/manager（**新發現相同型錯**：line 74, 80, 84）/ sales/doc-generator（line 37 trailing whitespace）|

**Schema validate 結果**：

| 結果 | 數量 | 主因 |
|------|------|------|
| PASS | 10 | bni/manager / sales/manager / finance/manager / sw/manager / platform/tuq-paperclip/manager / agent-ops/manager / agent-ops/agent-builder + 3 |
| FAIL | 44 | 80% missing `## Decision-Making Style`（worker 普遍缺）+ H1 格式分歧 + Anti-patterns 章節名稱不統一 |

**第二個 manager bug 細節（goose-ops/manager）**：

```
line 70 → P15
line 72 → P16 (Verify before plan)
line 74 → P20 (Research before act)            ← 跳！
line 80 → P17 (Self-review every task)
line 82 → P18 (主對話扮演原則)
line 84 → P21 (任務粒度拆解)
```

與 edu/manager 完全同型：rule-rollout 把新規則塞進中間，原 P17/P18 沒重編號 → numbering scrambled。**這是 rule-rollout 流程缺 lint pre-flight 的歷史共業**。

---

## 推送策略

### 立即（今日 2026-04-28）

- 本報告 commit 到 governance/reports/
- 標記 protocol 三份為「DRAFT v1.0 — pending v7.4.1 fixes」
- 暫不啟用 Edit hook 強制過 pipeline（protocol 第 6 段「Edit 工具 hook 待實作」）

### v7.4.1（48 小時內）

- 派 agent-ops/agent-builder 修兩個 manager 編號 bug + sales/doc-generator trailing whitespace
- 補 validate-soul-md.py 的 worker / manager profile 區分（`## Decision-Making Style` 對 worker 降為 WARN）
- Protocol 補三處小漏洞：
  - inter-agent-feedback.md：issue_id 命名空間說明 + 中文 snippet ≥ 50 字元
  - soul-md-edit-policy.md：與 rollback-sop.md 命名格式 reconcile
  - soul-md-rollback.md：cold-start（首 14 日）改用 absolute SLO + min sample N ≥ 10

### Phase 1（2026-04-28 ~ 2026-05-05）

- 在 edu team 啟用 lint + validate（含 7 個 agent）
- 開始 evolution worker 退化偵測試跑（dry-run 模式，只寫 proposal 不通知）
- Governance 每日抽查 audit JSONL

### Phase 2（2026-05-05 ~ 2026-05-12）

- 通過 Phase 1 退出條件後，擴到 sw + agent-ops
- evolution 改為正式模式（會通知 FDE）

### Phase 3（2026-05-12 ~ 2026-05-19）

- 通過 Phase 2 後，bulk-update 全 team
- rule-rollout 紀錄追加 v7.4 條目

---

## 後續必做動作

1. **agent-builder 第二輪修補（v7.4.1）**：是。優先順序：
   1. 修 edu/manager/soul.md 編號（P14 重排）
   2. 修 goose-ops/manager/soul.md 編號（P20/P21 重排）
   3. 修 sales/doc-generator/soul.md trailing whitespace
   4. 補 validate-soul-md.py worker/manager profile
   5. Reconcile soul-md-edit-policy.md 與 rollback-sop.md 命名

2. **agent-ops/manager 同步推 rule-rollout**：本批 3 protocol 走 rule-rollout.md 流程，agent-ops/manager 起 trace ID `20260428-v7.4-rollout`。

3. **更新既有 protocol 索引**：在 `agents/agent-ops/_protocols/rules/` 索引（如有 README）補 3 新條目。

4. **Schema reconcile 任務**：派 agent-ops/agent-builder 對全 54 個 soul.md 做 schema 補全（補 Decision-Making Style、統一 H1、統一 Anti-patterns 章節名）— 這是大工程，建議拆成各 team 一個獨立 dispatch。

5. **lint hook 啟用時機**：Phase 3 完成後再啟用（不是現在）。期間先靠 manual run。

6. **rule-rollout.md 自身要補一條**：所有 rule rollout 在「執行 bulk-update 前」**必須先跑 lint pre-flight**，避免再次發生 edu/goose-ops/manager 編號型 bug。本次 review 算是這條規則的反向實證。

---

## 附錄：本次 review 用到的資料

- 全 team lint summary：8 manager / 54 soul.md
- 抽樣 schema validate：6 個 soul.md（覆蓋 manager / worker / shared / specialty）
- 既有 protocol 對照：rule-rollout.md / rollback-sop.md / evaluator-rerun.md / feedback-memory.md
- 工具腳本：`.claude/scripts/lint_all_managers.sh`、`.claude/scripts/validate_all_souls.sh`、`.claude/scripts/sample_validate_failures.sh`
