# RDV Protocol — Worker 自我紀律

> 版本：v1.1-FINAL
> 狀態：**v1.1-FINAL** — Governance approved 2026-05-25（task `rdv-trich-p8-final-audit-20260525`，verdict PASS_WITH_REMARKS / 0 FAIL / 0 HIGH 新發現）
> 建立日期：2026-04-24
> 升 FINAL 日期：2026-05-25（task `rdv-trich-alpha-v11final-20260525`）
> 作者：agent-ops/agent-builder（fast-track，申請方 edu/manager）
> 適用範圍：所有 Worker 型 agent（L1）

## 1. Purpose

### 1.0 文件範圍與命名（2026-05-23 self-added — rdv-trich-p2b-rename-20260523）

本檔記錄 **Worker 個體層** RDV 紀律（單一 Worker 自己的 R → D → V 自我循環）。

**Team 層**的 R / D / V 角色分立（誰來做 V — 三權分立、隱性 owner 分立、D/V 不合一等組織分權規範）請見 `agents/agent-ops/_protocols/team-trichotomy-protocol.md`。

**命名脈絡**：本檔原名 `rdv-protocol.md`，於 2026-05-23（task `rdv-trich-p2b-rename-20260523`）rename 為 `worker-rdv-protocol.md`，以區隔 Team 層 trichotomy protocol，消除「RDV」一詞在兩個層級間的命名歧義。標題保留原樣（Worker 自我紀律）以維護內容語意連貫性。

---

定義 **Worker 層**（L1）在執行每一個任務時必須遵循的自我循環節奏：**Research → Do → Verify**（簡稱 **RDV**）。

### 1.1 問題背景

目前既有 protocol 覆蓋的是**跨層級**規範：

- `verification-protocol.md`：Manager 驗收 Worker（**跨層**，由上而下）
- `dual-audit-protocol.md`：Manager 對 Doer/Reviewer 做雙軌稽核（**跨層**，事實+程序）
- `hitl-protocol.md`：高風險操作暫停等待用戶（**跨層**，L1↔User）
- `worklog-protocol.md`：所有 agent 打卡（**跨層**，通用紀律）

但 **Worker 自己內部**怎麼跑沒有統一規範。結果常見三種失敗：

1. **沒 R 直接 D**：拿到任務就動手，方向完全錯（產出廢掉）
2. **沒 V 連續 D**：批次任務一路做完才檢查，錯誤累積（80 份履歷都搞壞）
3. **V 太寬鬆**：有做 V 但只看表面（檔案存在就通過，沒看內容）

### 1.2 本 protocol 的定位

RDV 是 **Worker 層的自我紀律**，不是新執行引擎。它和既有 protocol 的關係是：

| 協定 | 層級 | 主體 | 作用 |
|------|------|------|------|
| **RDV（本）** | **L1 內部** | **Worker 自己** | **每個任務的自我循環節奏** |
| verification-protocol | L2↔L1 | Manager 驗 Worker | 產出後的驗收 |
| dual-audit-protocol | L2↔L1 | Manager 稽核 Doer/Reviewer | 跨軌（事實 + 程序）稽核 |
| hitl-protocol | L1↔User | Worker/Manager 暫停 | 高風險操作的人類確認 |
| worklog-protocol | 全層 | 所有 agent | 打卡留痕 |

核心宣告：**RDV 是 Worker 內部紀律，Manager 驗收是外部檢查，兩者互補不重疊。**

---

## 2. Scope

### 2.1 適用

- 所有 **Worker 型**（L1）agent — `type: worker`
- 不論單 Do 任務（審一份 draft）或多 Do 任務（處理 80 份履歷）
- 不論模型層級（sonnet / opus；2026-04-27: haiku 已禁用，user policy）

### 2.2 不適用

- **Manager 型**（L2+）agent — Manager 走 `verification-protocol` + `dual-audit-protocol`，不走 RDV
- **Intent classifier** — 輸出為 schema-validated JSON，驗證由 schema 處理
- **純 shell 包裝型 worker**（如 `agents/agent-ops/_shared/calculator` 只跑 `node -e`）— V 已由 exit_code 提供
- **Worklog 打卡動作本身** — 打卡不需要再 R/V（會無窮遞迴）

---

## 3. Definition

### 3.1 Research (R)

**定義**：動手前的準備階段 — 搞清楚需求、讀相關檔案、規劃路徑。

**最小合格標準**（任一缺失 = R 未合格）：

| # | 項目 | 說明 |
|---|------|------|
| 1 | 需求解析 | 從 Manager 派遣訊息中解析必要欄位，缺失則 `stop_and_report` |
| 2 | 讀 memory | `memory/MEMORY.md` 至少讀一次，確認是否有可繼承的經驗 |
| 3 | 讀相關檔案 | 任務涉及的既有檔案（範本、前一版輸出、相關 protocol）至少讀一遍 |
| 4 | 產出計畫 | 心中（或輸出中）有明確「要做什麼 / 不做什麼 / V 階段要驗什麼」 |

**反模式**：
- ❌ 收到任務直接跳到 Do（沒讀 memory、沒讀相關檔案）
- ❌ R 階段讀了一堆資料但沒規劃 V 要驗什麼（等於沒讀）

### 3.2 Do (D)

**定義**：實際執行產出 — 寫檔、算數、呼叫工具、搜尋資料。

**最小合格標準**：

| # | 項目 | 說明 |
|---|------|------|
| 1 | 有明確產出 | 至少一個 artifact（檔案、數據、回傳訊息） |
| 2 | 標明邊界 | 清楚「這一次 Do 做了什麼、沒做什麼」，不混雜下一次 Do 的工作 |
| 3 | 不心算 | 精確數值計算必須委派 `agents/agent-ops/_shared/calculator`（見 `definitions.md` §計算委派規則） |
| 4 | 不越權 | 只動自己 scope 內的檔案（見 `definitions.md` §File Ownership） |

**反模式**：
- ❌ 一次 Do 把 5 個獨立子任務混在一起（應拆成 5 次 D）
- ❌ Do 的過程中順手改了 scope 外的檔案

### 3.3 Verify (V)

**定義**：每次 Do 後立即進行的自我驗證 — 確認產出符合需求品質標準。

**最小合格標準**：

| # | 項目 | 說明 |
|---|------|------|
| 1 | Checklist 檢查 | 對照 R 階段定義的驗收條件逐項檢核（schema / 格式 / 必要欄位） |
| 2 | 內容實際打開 | 寫了檔 → 重讀一次；跑了指令 → 看 exit_code 與 stdout；查了資料 → 驗證來源可達 |
| 3 | 結構性比對 | 不靠描述字串判斷（不是看到 "success" 就通過），要對結構化欄位做比對 |
| 4 | 記錄結果 | V 通過 / 不通過都記錄，不通過要記 reason |

**V 的兩種結果**：

- ✅ **PASS**：進入下一個 D 或結束任務
- ❌ **FAIL**：回到 D（最多 retry 3 次；連續 3 次失敗 → 升級 HITL，見 §5.3）

**反模式**：
- ❌ V 只看「檔案存在」不看內容 — 空檔案也過（V 太寬鬆）
- ❌ V 通過但其實 D 的產出和需求無關（V 沒對照 R 的驗收條件）
- ❌ V 失敗但繼續做下一個 D（錯誤累積）

---

## 4. Multi-Do Pattern

### 4.1 何時該拆成多 Do

任務只要**滿足以下任一條件**，就應拆成多 Do 循環：

| 判準 | 範例 |
|------|------|
| 每個子項目**獨立可交付** | 80 份履歷篩選（每份獨立分數） |
| 每個子項目**失敗隔離** | 10 家公司研究（A 查不到不影響 B） |
| 每個子項目**產出格式相同** | 30 張圖片壓縮（輸入輸出同類型） |
| 數量 ≥ 5 且**可重複節奏** | 20 條 BNI 會員資料分類 |

反之，若子步驟**高度耦合**（前一步輸出 = 下一步輸入），則是單 Do 任務（可能內部多階段，但只需要一次 V 在最後）。

### 4.2 循環規則

**多 Do 任務的標準節奏**：

```
R (一次)
  → D1 → V1
  → D2 → V2
  → D3 → V3
  → ...
  → Dn → Vn
  → 結束
```

**關鍵規則**：

1. **R 只做一次**（除非某個 V 失敗且原因是 R 當初沒想到 → 重做 R）
2. **每個 D 後必須立即 V**（不可攢到最後才統一 V）
3. **某個 Vi 失敗**：先局部 retry Di 最多 3 次；仍失敗 → 升 HITL（不繼續跑 D(i+1)）
4. **部分完成可接受**：n 個子任務做完 k 個成功、k+1 個卡住，回報 Manager k 個已完成 + k+1 個 blocker，不硬跑完剩下的

### 4.3 反模式：一次 Do 完所有才 V

```
❌ 錯誤：
R → D1 → D2 → D3 → ... → Dn → V（統一驗）
                                   ↑
                             這裡發現 D2 就錯了，後面全廢
```

為什麼錯：

- **錯誤在 D2 就能抓到，卻浪費了 D3-Dn 的資源**
- Vn 發現問題時，中間哪一步出錯還要反查（debug 成本高）
- 部分失敗情境處理不了（全 rollback? 還是留下殘骸?）

---

## 5. Integration with Other Protocols

### 5.1 vs verification-protocol.md（Manager 驗收 vs Worker 自驗）

**互補不重疊**：

| 層級 | 誰做 | 做什麼 | 時機 |
|------|------|--------|------|
| **Worker 自驗（V）** | Worker 自己 | **格式 / schema / 必要欄位 / 結構化比對** | 每個 D 後立即 |
| **Manager 驗收** | Manager | **事實一致性 / 跨 worker cross-check / spot-check 內容** | Worker 交付後 |

**原則**：Worker 的 V 擋掉 **格式層**問題（80% 常見錯誤），Manager 驗收負責 **事實層 + 語意層**（剩下 20%，需要跨 worker 或跨文件比對的）。

這對應 edu/content-designer v5 draft P27 的核心教學：
> 「V 擋掉 80% 格式錯誤。你（HITL/Manager）只處理『意思對不對』那 20%。」

### 5.2 vs worklog-protocol.md（打卡粒度）

**建議：整體 task 打一次卡，不要每個 D/V 各打一卡**。

理由：

- Worklog 設計初衷是「agent 的一次工作單位」，不是「每個動作」
- 若每 D 都打卡，80 份履歷的任務會產生 160+ 筆 worklog，查詢成本爆炸
- RDV 的紀錄應寫入 `output_summary`，格式建議：

```
"Processed 80 items. D/V loops: 80 succeeded (78 first-try, 2 after retry).
 V failures escalated: 0. See memory/run-2026-04-24.md for per-item log."
```

**例外**：若某個 D 耗時 > 10 分鐘（長跑任務），可考慮中間打卡 checkpoint，但這屬於 agent 個別設計，不是 RDV 通則。

### 5.3 vs hitl-protocol.md（V 失敗幾次升 HITL？）

**建議規則**：

| 情境 | 動作 |
|------|------|
| V1 fail | 自動 retry D，最多 3 次 |
| 連續 3 次 V fail | **升 HITL**（Tier 2：inform-then-act 或 Tier 3：暫停等待確認，由 Manager 判斷） |
| V fail 且**根因是 R 遺漏** | 不算入 3 次 retry 計數，先重做 R 再回 D |
| V fail 且**根因是越權 / scope 不清** | 立即 stop_and_report，不 retry |

**HITL 升級時必備資訊**：

- 哪個 D 步驟失敗（D_i / 總共 D_n）
- V 驗收條件是什麼
- 3 次 retry 分別的失敗原因
- Worker 建議的解法或問題選項

### 5.4 vs dual-audit-protocol.md（本 protocol 屬 Tier 2 變更）

- 本 protocol 屬 **agent 系統 protocol 新增**，對應 dual-audit §Scope「跨 team Manager 適用」以外的新分類：**Worker 層通則**
- 與 dual-audit **不衝突**：dual-audit 是 Manager 側的稽核（輸入為 Doer 的 evidence_bundle / Reviewer 的 review_report），RDV 是 Worker 側的自我循環
- 變更等級建議：**Tier 2**（新增 protocol，影響所有 Worker workflow.yaml，但為加法非減法）
- 與 dual-audit 的 `evidence-protocol` 關係：**Worker 的 V 產出的自驗紀錄可作為 evidence_bundle 的一部份**（特別是 `assertions[i].evidence_ref` 可指向 V checklist 結果）

---

## 6. Implementation in workflow.yaml

### 6.1 建議的 Worker workflow.yaml 骨架

```yaml
name: {Worker} Workflow
description: Worker 標準 RDV 節奏

error_policy:
  default: diagnose_and_retry
  max_retries: 3          # RDV 的 V→retry D 上限
  on_max_retries: escalate_hitl

steps:
  # ═══ 打卡 ═══
  - id: log_start
    action: shell
    command: bash scripts/worklog.sh start {team}/{worker} {model} "$TASK_SUMMARY" {parent}
    on_error: stop_and_report

  # ═══ R: Research ═══
  - id: parse_input
    action: parse_input
    description: 解析 Manager 派遣訊息，缺欄位 → stop_and_report
    on_error: stop_and_report

  - id: read_memory
    action: read_file
    path: agents/{team}/{worker}/memory/MEMORY.md
    description: R 階段 — 繼承過往經驗
    on_error: continue

  - id: research_context
    action: read_files
    description: R 階段 — 讀任務相關既有檔案（範本、protocol、前版）
    on_error: continue

  - id: plan_verify_criteria
    action: define_checklist
    description: R 階段收尾 — 明確定義 V 階段要驗什麼（寫入 scratch）
    on_error: stop_and_report

  # ═══ D + V 循環 ═══
  # 單 Do 任務：一次 do_task → verify_output
  # 多 Do 任務：for_each loop 包裹 do_task → verify_output
  - id: do_task
    action: execute
    description: D 階段 — 實際產出
    on_error: diagnose_and_retry

  - id: verify_output
    action: checklist
    description: |
      V 階段 — 對照 plan_verify_criteria 逐項檢核：
        [ ] 產出檔案存在且非空
        [ ] schema / 格式符合
        [ ] 必要欄位齊備
        [ ] 結構化比對通過（不是字串 grep）
        [ ] 無越權、無心算
    on_error:
      action: retry_do_task
      max_attempts: 3
      on_max: escalate_hitl

  # ═══ 收尾 ═══
  - id: save_memory
    action: write_memory
    path: agents/{team}/{worker}/memory/MEMORY.md
    description: 紀錄本次 RDV 經驗（有效來源、V 抓到的問題、可重用模式）
    on_error: continue

  - id: deliver
    action: return_to_manager
    on_error: stop_and_report

  - id: log_end
    action: shell
    command: |
      bash scripts/worklog.sh end "$WORKLOG_PATH" success - <<EOF
      $RESULT_SUMMARY
      EOF
    on_error: retry_once_then_report
```

### 6.2 既有 worker 改造最小變更

若 worker workflow.yaml 已有 `self_verify` 或 `checklist` step（如 `sales/industry-researcher`），最小改造是：

1. 在 R 階段加一個 `plan_verify_criteria` step（或在 `parse_input` 裡順手定義）
2. 確認 `on_error` 的 retry 上限 ≤ 3 且 `on_max` 走 HITL 升級
3. `output_summary` 補上 D/V 循環統計

不需要大改架構。

---

## 7. Anti-patterns

| 反模式 | 症狀 | 正解 |
|--------|------|------|
| 跳過 R 直接 Do | 收到任務就 write_file | 先 parse_input + read_memory + read_refs |
| 批次任務只 V 一次 | 80 份處理完才 V 統一 | 每份 D 後立即 V |
| R 階段讀資料但不規劃 | 讀了一堆 MEMORY 但 V 沒對照 | R 收尾要定義 V 的 checklist |
| V 通過但產出其實錯誤 | 只驗「檔案存在」不驗內容 | V 要 `Read` 檔案內容做結構比對 |
| V fail 繼續下一個 D | 第 3 份壞了還跑第 4-80 份 | V fail → retry → 仍失敗 → HITL，不繼續 |
| V 靠字串 grep | stdout 有 "success" 就過 | 看 exit_code、hash、結構化欄位 |
| 每 D 都打一次卡 | 80 份履歷打 160 筆 worklog | 整體 task 一次卡，D/V 紀錄寫 output_summary |
| 把心算數字當 V 結果 | 自己算「3 家市占 = 55%」當通過 | 委派 `agents/agent-ops/_shared/calculator`（見 definitions.md） |

---

## 8. Examples

### Example 1：單 Do 任務 — `edu/content-evaluator` 審核一份 draft

**任務**：Manager 派遣審核 `freelancer-onboarding-design-draft-v5.md`，產出評分與建議。

**RDV 拆解**：

| 階段 | 動作 | 時間估計 |
|------|------|----------|
| R1 解需求 | parse_input（拿到 draft 路徑、評分標準版本） | < 1 min |
| R2 讀 memory | 讀 MEMORY.md 看過往常見問題模式 | 1 min |
| R3 讀 refs | 讀評分 rubric、讀 draft 本身 | 3 min |
| R4 定 V 標準 | 列出：評分五面向齊備 / 每項有具體引用行數 / 總分合理 | 30 sec |
| D1 評分 | 跑完五面向評分，寫 evaluation_report.md | 8 min |
| V1 自驗 | 對照 R4 checklist：✓ 五面向 ✓ 引用 ✓ 總分 ✓ 格式 | 1 min |
| 收尾 | save_memory + deliver + log_end | 1 min |

**特徵**：單 Do 任務一次 R + 一次 D + 一次 V，總時間 ~15 min。

---

### Example 2：多 Do 任務 — `sales/industry-researcher` 調查 50 家公司

**任務**：Manager 派遣調查 50 家法律事務所的基本資訊（公司規模、主打業務、聯絡人）。

**RDV 拆解**：

```
R (一次)
├─ parse_input：拿到 50 家清單、欄位規格
├─ read_memory：過往法律事務所研究心得
├─ read_refs：欄位 schema、資料來源優先級
└─ plan_verify_criteria：每家必須有 name/size/service/contact 四欄 + source URL

D1 研究第 1 家 → V1（四欄齊 + URL 可達 + 非機密）PASS
D2 研究第 2 家 → V2 PASS
...
D17 研究第 17 家 → V17 FAIL（contact 找不到）
    ├─ retry D17 #1：換關鍵字搜 → FAIL
    ├─ retry D17 #2：看產業協會會員名錄 → FAIL
    ├─ retry D17 #3：看 LinkedIn → FAIL
    └─ 升 HITL：回報 Manager「第 17 家 contact 查不到，已完成 16 家，
                    剩 33 家是否繼續（跳過第 17 或全停）」
```

**特徵**：

- R 只做一次，**D/V 是 50 次循環**
- 每次 V 獨立，第 17 家失敗**不影響**前 16 家的成功
- 3 次 retry 仍失敗 → 升 HITL，**不硬把 18-50 家做完**（避免在有 blocker 時累積狀態）
- 總時間估計：每家 D+V ~3 min，50 家約 2.5 hours（含 HITL 等待）

---

## 9. Rollout 建議

### 9.1 Pilot Scope

**建議先在以下 team pilot**（理由：最常遇到多 Do 任務、V 品質標準好定義）：

1. `edu/content-evaluator`、`edu/content-designer` — 內容審核高度標準化
2. `sales/industry-researcher`、`sales/account-research` — 已有 self_verify 雛形，小改即可
3. `finance/billing-qa` — 8 項驗收天然適合 V checklist

**不建議 pilot 的**（目前先不動）：

- `agents/agent-ops/_shared/calculator` — 已純 code execution，V 等於 exit_code
- `bni/*` — 資料處理流程高度耦合，多 Do 拆分需更多設計

### 9.2 Full Rollout Trigger

滿足以下**所有**條件才全系統推：

- [ ] Pilot 3 個 team 各跑 ≥ 20 次任務
- [ ] Pilot 期間 V 抓到的問題統計 ≥ 20 條（證明 V 有用）
- [ ] Pilot 期間 HITL 升級次數合理（不要因 V 太嚴格變成 HITL fatigue）
- [ ] 用戶 / Governance 簽核此 protocol 正式版

### 9.3 Worker workflow.yaml Bulk-Update 清單

推全時，Agent Builder 需對每個 worker workflow.yaml 檢核：

| 檢核項 | 動作 |
|--------|------|
| 有無 R 階段（parse_input + read_memory） | 無則補 |
| 有無明確的 V checklist step | 無則補 |
| V 的 `on_error` 有無 retry 上限 + HITL 升級 | 無則補 |
| 是否為多 Do 任務（可從 task 描述判斷） | 是則確認有 for_each 包裹 |
| `output_summary` 有無包含 D/V 統計 | 無則補格式範例 |

可由 `agents/agent-ops/agent-builder/` 批次執行（參考既有 gap-analysis 流程）。

---

## 10. Version History

| 版本 | 日期 | 作者 | 變更 |
|------|------|------|------|
| v1.0-DRAFT | 2026-04-24 | agent-ops/agent-builder（fast-track，申請方 edu/manager） | 初版起草 — 定義 RDV 三階段、多 Do 循環、與既有 4 支 protocol 整合、Rollout 計畫。**Pending Governance review**。 |
| v1.1-DRAFT | 2026-05-23 | agent-ops/agent-builder（task `rdv-trich-p2b-rename-20260523`） | 檔名 rename：`rdv-protocol.md` → `worker-rdv-protocol.md`，消除與 `team-trichotomy-protocol.md` 的「RDV」命名歧義（Worker 個體層 vs Team 角色分立層）。新增 §1.0「文件範圍與命名」說明兩 protocol 雙層架構與命名脈絡。內容語意不變，仍 pending Governance review。 |
| v1.1-FINAL | 2026-05-25 | agent-ops/agent-builder（task `rdv-trich-alpha-v11final-20260525`） | 依 governance P8 final cross-rollout audit 結論升 FINAL（task `rdv-trich-p8-final-audit-20260525`，verdict **PASS_WITH_REMARKS** / 0 FAIL / 0 HIGH 新發現 / 3 LOW + 1 ACKNOWLEDGED-HIGH 已知）。本檔內容無實質規則變動；5 段補強（9-team 盤點 / cross_team_verifier 明文化 / mcad strict-mode schema variance / `platform/{leaf}` 命名 / test-agent 例外）落地於姊妹檔 `team-trichotomy-protocol.md` v1.1-FINAL。本檔升 FINAL 為 P8 audit 通過後的版本對齊（v1.0-DRAFT → v1.1-FINAL，跳過 v1.0-FINAL 與 team-trichotomy-protocol 升版節奏同步）。Audit 完整紀錄見 `output/agent-ops/rdv-trich-p8-final-audit-20260525/governance_audit.md` §6/§7。 |

---

## 11. References

### 11.1 既有 protocol
- `agents/agent-ops/_protocols/verification-protocol.md` — Manager 驗收 Worker（本 protocol 補 Worker 自驗那一側）
- `agents/agent-ops/_protocols/worklog-protocol.md` — 打卡通則（本 protocol §5.2 定義打卡粒度）
- `agents/agent-ops/_protocols/hitl-protocol.md` — HITL 分級（本 protocol §5.3 定義 V 失敗何時升）
- `agents/agent-ops/_protocols/dual-audit-protocol.md` — Manager 雙軌稽核（本 protocol 屬 Worker 層，互補）
- `agents/agent-ops/_protocols/definitions.md` — Worker / Manager 定義、計算委派、File Ownership

### 11.2 設計原型
- `agents/edu/content-designer/output/freelancer-onboarding-design-draft-v5.md` P27-P28 — RDV 教學設計原型（Worker 的自我紀律、V 擋 80% 格式 / HITL 處理 20% 語意）

### 11.3 現有參考實作
- `agents/sales/industry-researcher/workflow.yaml` — 已有 `research_phase → structure_findings → self_verify` 雛形，最接近 RDV 標準
- `agents/edu/content-evaluator/workflow.yaml` — 單 Do 任務的參考（check_memory → run_evaluate_flow → save_memory）

---

## Governance Review Checklist（供用戶後續透過 /tuq-agent 流程審查）

- [ ] **Definition 清楚無歧義**：R/D/V 三階段各有「最小合格標準」表，判準可驗證
- [ ] **與既有 4 支 protocol 整合合理**：§5 明列與 verification / worklog / hitl / dual-audit 的互補關係
- [ ] **Anti-patterns 覆蓋主要誤用情境**：§7 列 8 條，含跳過 R、只 V 一次、V 太寬鬆、V 靠字串 grep 等
- [ ] **Rollout 計畫可行（不破壞現有 worker workflow）**：§9 先 pilot 3 team，既有 worker 最小改造指引
- [ ] **與 dual-audit-protocol 一致**：§5.4 說明本 protocol 屬 Worker 層、不與 Manager 側雙軌稽核衝突
- [ ] **Example 可理解**：§8 兩個範例（單 Do 審 draft / 多 Do 研究 50 家）含時間估計與失敗處理
- [ ] **版本標記清楚**：檔頭 + §10 皆標 `v1.0-DRAFT` 與 `DRAFT_PENDING_GOVERNANCE_REVIEW`
- [ ] **引用路徑正確**：§11 References 連結可對應實際檔案
- [ ] **未越權設計**：本 protocol 只定義 Worker 層自我紀律，未改寫既有 protocol 內容
- [ ] **Multi-Do 拆分判準明確**：§4.1 四條判準（獨立交付 / 失敗隔離 / 格式相同 / 數量 ≥ 5）
- [ ] **HITL 升級規則明確**：§5.3 規則表 + 升級時必備資訊清單

---

> **Status reminder**：本檔為 fast-track 起草（因 agent-ops/manager subagent 化限制，由 edu/manager 直接派遣 agent-builder 產出）。檔案產出後仍需用戶透過 `/tuq-agent` 流程送 Governance 正式簽核才可推行。
