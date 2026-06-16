# Team Trichotomy Protocol — Manager 派工三權分立

> 版本：v1.0-FINAL
> 狀態：**v1.0-FINAL** — Governance approved 2026-05-23（task `rdv-trich-p5-audit-20260523`）
> 建立日期：2026-05-23
> 升 FINAL 日期：2026-05-23（task `rdv-trich-final-20260523`）
> 作者：agent-ops/agent-builder（依 agent-ops/manager P2 派遣，task_id: `rdv-trich-p2-rules-20260523`，trace_id: `rdv-trich-20260523-1`）
> 適用範圍：所有 team manager 的派工決策 + agent-builder 的 create / enhance / delete flow
> 上層規範參照：`agents/agent-ops/_protocols/rules/agent-anatomy.md` §4.1 + §6.9

---

## 1. Purpose

### 1.1 問題背景

AgentOrg 既有規範針對「Worker 個體紀律」與「Manager 跨層驗收」已有完整覆蓋（見 §6.2），但**團隊層面的角色分立**——「Manager 派工時是否把 R / D / V 三類角色分派給三個不同 worker」——目前**沒有結構化規範**。

實務上 8 個 team 中已有 6 個 team 形成事實上的 R/D/V 三權分立（見 §5），但缺乏統一規則導致：

1. **角色模糊** — 沒有結構化欄位宣告 worker 在 team 內的角色，新建 agent 時容易誤造「D-worker 自驗」反 pattern（platform/goose-ops 即為案例，見 §7）。
2. **重複建構風險** — 沒有 trichotomy check，agent-builder 收到「建立新 V-worker」請求時，無從判斷該 team 是否已有可 enhance 的 V-worker。
3. **跨 team 對話困難** — Manager 之間談「派 V 給誰」沒有共同語彙，每個 team 用不同稱呼（reviewer / qa / referee / validator / governance）。

### 1.2 本 protocol vs `worker-rdv-protocol.md`（個體層 RDV）

本 protocol 約束 **Team 層的角色分立**（誰來做 V），與既有 `agents/agent-ops/_protocols/worker-rdv-protocol.md` 規範的 **Worker 個體層 RDV**（每個 Worker 自己 R → D → V 的執行紀律）**是雙層架構，互補不重疊**：

| 維度 | 本 protocol（Team Trichotomy） | `worker-rdv-protocol.md`（Worker-internal RDV） |
|------|-------------------------------|------------------------------------------|
| 層級 | Team 角色分立（組織分權） | Worker **內部**階段（個體紀律） |
| 主體 | 三個獨立 Worker 互相牽制 | 同一 Worker 的 R → D → V 自我循環 |
| 約束對象 | Manager 派工決策、agent-builder 創建決策 | Worker 執行節奏 |
| 核心問題 | 「誰來做 V？」 | 「Worker 內部怎麼跑？」 |
| 來源 | 2026-05-23 用戶提案 | 2026-04-24 fast-track 起草 |

**用語對齊宣告**（critical — 避免歧義）：因兩 protocol 名稱皆含「RDV」概念，2026-05-23（task `rdv-trich-p2b-rename-20260523`）已執行以下 rename：
- `rdv-protocol.md` → `worker-rdv-protocol.md`（明確標示「個體層」）
- 本 protocol（`team-trichotomy-protocol.md`）採新名，與 worker-rdv-protocol 分層分立

本 protocol 一律引用 `agents/agent-ops/_protocols/worker-rdv-protocol.md`，命名歧義已消除。

完整背景與用語對齊段見 `output/agent-ops/rdv-trichotomy-p1-scan-20260523/agent-builder-hooks.md` §0。

### 1.3 本 protocol 在 protocol 階層中的位置

```
Protocol Stack（由下而上）
└── worklog-protocol.md          (全層通用紀律)
└── verification-protocol.md     (Manager 驗 Worker，跨層由上而下)
└── dual-audit-protocol.md       (Manager 對 Doer/Reviewer 雙軌稽核)
└── hitl-protocol.md             (L1↔User 高風險暫停)
└── worker-rdv-protocol.md      (Worker 個體紀律)
└── ★ team-trichotomy-protocol.md (本 protocol — Team 派工三權分立)
    └── 上承：agent-anatomy.md §4.1 + §6.9 Hard Rules
    └── 下接：creation-validation.md W8/W9/W10（P3 落地）
    └── 下接：manager dispatch-protocol.md 必填 role_in_team（P4 落地）
```

---

## 2. Scope

### 2.1 適用

- **所有 team manager 的派工決策**（含 sw / edu / sales / finance / bni / agent-ops，以及未來新建 team）
- **agent-builder 的 create / enhance / delete flow**（P3 落地後）
- 所有 `type == worker` 的 agent（必須宣告 `role_in_team`）

### 2.2 不適用（豁免條款）

- **manager+ type**（`manager` / `director` / `officer`）自動視為 `role_in_team: manager`，trichotomy 約束僅在 worker 層強制
- **跨 team 共享服務**（如 `agents/agent-ops/_shared/calculator`，標 `role_in_team: shared`）— 角色模糊的合法例外，豁免本 protocol 約束
- **純單人 team** — 允許暫時不滿足三權分立；當第二個 worker 加入時必補齊
- **既有 agent grace period**（截止 **2026-06-22**）— grace period 內允許 `role_in_team: unclassified`

### 2.3 與其他 protocol 的層級邊界

- 不約束 Manager 對 Worker 的驗收動作本身（屬 `verification-protocol.md`）
- 不約束 Worker 個體的 R/D/V 自我循環（屬 `worker-rdv-protocol.md`）
- 不約束打卡、HITL、output_path 等通用機制（各自 protocol 已覆蓋）

---

## 3. Definitions

### 3.1 R-worker (researcher)

**定義**：在 Doer 動手前負責資訊蒐集 / 規格訂定 / 驗收 checklist 設計的 worker。

**典型命名**：`researcher` / `{domain}-researcher` / `inspector` / `{domain}-knowledge` / `architect` / `industry-researcher`

**職責邊界**：
- ✅ 蒐集事實、調研外部知識、整理 schema、寫規格、訂 V 階段 checklist
- ✅ 可獨立存在（不強制配對 D 或 V）
- ❌ 不直接產出最終 artifact（產出限於「規格 / 報告 / checklist」這類 R-flavor 文件）

**反 pattern**：
- R-worker 同時包辦 D（即既研究又寫最終文件） → 應拆兩 agent
- R-worker 不寫下 checklist 就讓 D 開始（V 階段沒有對照基準）

### 3.2 D-worker (doer)

**定義**：實際產出 artifact 的 worker。

**典型命名**：`developer` / `builder` / `designer` / `generator` / `extract-{thing}` / `label-{thing}` / `sketch-builder` / `proposal-designer` / `billing-builder`

**職責邊界**：
- ✅ 產出可交付的最終 artifact（程式、文件、xlsx、簡報、3D 草圖、PDF 等）
- ✅ 同 team 可有多個 D-worker，各管產出鏈一段（如 finance 的 builder → renderer）
- ❌ **絕對不得自驗**（核心紅線）— D-worker 不能同時擔任 V-worker

**反 pattern**：
- D-worker self-verify（platform/goose-ops org.md:67 是現存反例，見 §7）
- 同 team 多個 D-worker 但 reports_to 鏈外共享同一隱性 owner（同人扮演兩角）

### 3.3 V-worker (verifier)

**定義**：第三方驗收 / QA / Audit / Code Review 的 worker。

**典型命名**：`reviewer` / `evaluator` / `qa` / `qa-referee` / `qa-reviewer` / `validator` / `governance` / `tester` / `e2e-tester`

**職責邊界**：
- ✅ 驗收其他 worker（特別是 D-worker）的產出，下 PASS / REVISE / FAIL 判定
- ✅ V 可多軌（如 SW 的 reviewer + tester + e2e-tester，sales 的 content-reviewer + qa-reviewer）
- ✅ 跨 team V 允許（如 `agent-ops/governance` 對全系統 audit）
- ❌ 不得自己同時是該 team 的 D-worker

**反 pattern**：
- V-worker 孤立存在於 team（沒有對應的 D-worker）— 除「跨 team V」例外
- V-worker 名稱與該 team 既有 D-worker 同名 / 同人扮演

**趨勢觀察**（非強制）：V-worker 模型 ≥ D-worker 模型是 5/8 team 的隱性共識（bni/qa-referee 用 opus、agent-ops/governance 用 opus）。本 protocol 不強制此項，留待後續 phase 評估。

### 3.4 Shared service（豁免）

**定義**：跨 team 共享的純功能服務，本身角色模糊（同時做 D 與 V）的合法例外。

**典型命名**：`shared/{utility}`（如 `agents/agent-ops/_shared/calculator`）

**職責邊界**：
- ✅ 標 `role_in_team: shared` 即豁免 trichotomy 約束
- ✅ 可同時做 D（執行運算）與 V（exit_code 自驗）
- ❌ 不應放在某個 team 內（必須在 `agents/agent-ops/_shared/` 目錄下）
- ❌ 不應有領域專屬職責（一旦變專屬，應改為該 team 的 worker 並重新歸類）

**反 pattern**：
- 把領域專屬 worker 標 `shared` 來規避 trichotomy 約束（這是濫用例外）

---

## 4. Rules（Hard Rules）

本章節為 hard rules 的完整版（agent-anatomy.md §6.9 為精簡版）。

### Rule 1：角色分類強制宣告

每個 Worker 的 `agent.yaml` **必須**含 `role_in_team` 欄位，取值 ∈ `{researcher, doer, verifier, shared}`。

- **禁止多值**（依 Q7 用戶決策）— 強制單一角色，迫使 team 多開 worker 來分權。違反 trichotomy 精神的多角色 worker 必須拆分。
- 違反 → P3 落地後 W8 阻斷 PASS（HIGH）

### Rule 2：V 不孤立

若 team 有 `verifier`，**必有對應的 `doer`**（V 不能孤立存在於該 team）。

- **跨 team V 例外**：dispatcher 是 manager 而非單一 team 內 doer（如 `agent-ops/governance` 對全系統 audit）— 允許全系統有任意 `doer` 即視為 PASS，不必對應到該 team 的特定 doer（依 Q3 用戶決策）。
- 違反 → P3 落地後 W9 阻斷 PASS（HIGH）

### Rule 3：D/V 不合一（核心紅線）

**同一 agent 不得同時擔任 `doer` 與 `verifier`**（杜絕三權合一）。

- R 與 V 可由同 agent 兼任（不違反紀律，因不 Do）— 例：`edu/editorial-director` 第一輪 R-flavor、第二輪 V-flavor，合法。
- D 必須獨立 — 同 agent 跨 D+V 是核心紅線，必須拆。
- 違反 → P3 落地後 W9 阻斷 PASS（HIGH）

### Rule 4：隱性 owner 分立

`verifier` 與 `doer` 不可共享 `reports_to` 鏈外的隱性 owner（例如同一人寫 + 同一人審）。

- 此規則目的：防止結構上分立但實質上同人扮演的情況。
- 判定方式：governance 在 P5 audit 時透過 dispatch 紀錄 + worklog 交叉比對。

### Rule 5：同 manager 派遣不算合一（澄清規則）

例如 `finance/billing-builder`（D）+ `finance/billing-qa`（V）雖同屬 `finance/manager` 派遣，**只要 agent 不同名即合法**（依 Q1 用戶決策）— 不視為「同主人 = 合一」。

- 此規則防止過度嚴格的解讀阻擋合法的 RDV pipeline。
- 真正的「合一」是 agent 名稱或實體相同，不是派遣 manager 相同。

### Rule 6：role_in_team 變更需審批

`role_in_team` 變更視同職責變更，需 Agent Builder 審批並重跑 Team Trichotomy Check。

- 自我新增（自加 doer 變 verifier）一律拒絕，必須走 Builder。
- 對應 definitions.md §Self-Update Rules 的「必須經過 Agent Builder 的」條款。

---

## 5. 既有 team 現況（事實基底）

> 完整盤點見 `output/agent-ops/rdv-trichotomy-p1-scan-20260523/team-rdv-mapping.md`（Phase 1 researcher 報告）。

### 5.1 三權分立判定總表

| Team | R-worker | D-worker | V-worker | 判定 |
|------|---------|---------|---------|------|
| **sw** | researcher + architect | developer + devops + seo-geo + claude-map | reviewer + tester + e2e-tester | ✅ 三權分立（教科書範本） |
| **edu** | edu-researcher + editorial-director(雙身 R+V) | content-designer + doc-generator + visual-stylist | content-evaluator + qa-reviewer | ✅ 三權分立 |
| **sales** | industry-researcher + knowledge-base + partnership-strategist | proposal-designer + visual-stylist + doc-generator | content-reviewer + qa-reviewer | ✅ 三權分立 |
| **finance** | researcher（條件觸發） | billing-builder + billing-renderer + invoice-ocr | billing-qa | ✅ 三權分立（教科書範本） |
| **bni** | researcher（未在 flow 內） | update-members + extract-members + label-members + industry-groups + organize-members + visual-stylist + doc-generator | qa-referee | ⚠️ 部分分離（R 未進 flow） |
| **agent-ops** | researcher | agent-builder | governance + evolution | ✅ 三權分立（教科書範本） |
| **platform/gb10-sysadmin** <!-- self-added 2026-05-25 P8 audit --> | — | gb10-sysadmin（系統 worker，單人 team） | — （cross-team via agent-ops/governance） | ⚠️ 單人 team（§2.2 第三條豁免），cross-team V 兼任 |

<!-- 2026-06-09 delete-mcad：mcad team 已刪除 -->
**統計（2026-06-09 delete-mcad rollout 後更新）**：6 team — 6/6 教科書三權分立，0/6 V-worker 缺，1/6 部分分離（bni — R 未進 flow，仍計入 trichotomy 範本），1/6 單人 team（gb10-sysadmin — §2.2 豁免，仍透過 cross-team V 兼任）。0/6 完全合一（D/V 紅線零違反）。

> **P8 audit 註（歷史）**：全系統 62 worker 100% 含 `role_in_team`（W8 全通過）；當時角色分布 R=14 / D=31 / V=14 / shared=3。完整 audit 見 `output/agent-ops/rdv-trich-p8-final-audit-20260525/governance_audit.md` §3.1。
>
> **2026-06-09 delete-goose-paperclip rollout**：goose-ops / tuq-paperclip 兩個 platform team 已刪除，team 數從 9 降為 7。
>
> **2026-06-09 delete-mcad rollout**：mcad team（manager + 5 worker）已刪除，team 數從 7 降為 6。

### 5.2 教科書範本（本 protocol 推薦學習對象）

- **sw** — R/D/V 全面分離 + V 三軌（reviewer + tester + e2e-tester）
- **finance** — 線性 RDV pipeline + Conditional R + Mandatory V
- **agent-ops** — Builder（D）/ Governance（V）互鎖，自舉示範

### 5.3 需補強 team / cross-team V 兼任機制（明文化）

#### 5.3.1 cross_team_verifier 名單（2026-05-25 P8 audit 補強明文）

依 §4 Rule 2 例外條款，agent.yaml 標 `cross_team_verifier: true` 的 V-worker 視為「全系統可派 V」，不必對應到某 team 內的特定 doer。本表為目前全系統 cross-team V 完整名單：

| Agent | 角色定位 | 兼任覆蓋對象 |
|-------|----------|--------------|
| `agent-ops/governance` | 系統審查 V（opus） | 全系統現行 team — protocol / rule / agent.yaml / dispatch-protocol 等系統層審查；gb10-sysadmin 缺 V 時兼任 domain V |
| `agent-ops/evolution` | 系統分析 V（opus） | 全系統現行 team — agent 演化分析、anatomy audit、worklog stats 派生洞察 |

**規則**：
- 其他 V-worker（`sw/reviewer`、`edu/qa-reviewer`、`finance/billing-qa`、`bni/qa-referee` 等）皆為 **domain-specific**，正確未設 `cross_team_verifier: true` 旗標
- 新增 cross_team_verifier 旗標屬 Rule 6 變更（職責變更），需 agent-builder 審批
- 過度發放此旗標會稀釋「跨 team V」例外的嚴肅性 — 應保持名單精簡

#### 5.3.2 各 team 補強進度

- **bni** — researcher 已存在但未進入 Update/Compile flow，建議 P6+ 補強
- **platform/gb10-sysadmin** <!-- self-added 2026-05-25 P8 audit --> — 單人 team（僅 gb10-sysadmin 一個 worker），依 §2.2 第三條「純單人 team 允許暫時不滿足三權分立；當第二個 worker 加入時必補齊」豁免。V 由 `agent-ops/governance` cross-team 兼任（§5.3.1 已涵蓋）。

---

## 6. Integration with Other Protocols

### 6.1 vs `worker-rdv-protocol.md`（個體層 RDV）

- **層級不同**：本 protocol = team 層；worker-rdv-protocol.md = worker 個體層
- **互補關係**：trichotomy 確保「誰來做 V」（組織分權），worker-rdv-protocol 確保「Worker 自己怎麼跑」（個體紀律）
- **rename 紀錄**：原 `rdv-protocol.md` 於 2026-05-23（task `rdv-trich-p2b-rename-20260523`）rename 為 `worker-rdv-protocol.md`，全系統 cross-reference 同步更新；命名歧義已消除
- 詳見 §1.2

### 6.2 vs `verification-protocol.md`（Manager 跨層驗收）

- **本 protocol** 規範 Manager 在 worker 層的派工結構（誰是 V）
- **verification-protocol.md** 規範 Manager 對 Worker 產出的驗收動作
- 兩者疊加：Manager 既要派 V-worker（trichotomy），也要在 V-worker 回來後做自己的驗收（verification-protocol）

### 6.3 vs `dual-audit-protocol.md`（Doer/Reviewer 雙軌稽核）

- **dual-audit** 是 Manager 對 Doer + Reviewer 兩軌的事實 + 程序稽核（跨層）
- **本 protocol** 是組織分權層（同層）
- 關係：本 protocol 的 V-worker 多軌 pattern（如 SW reviewer + tester + e2e-tester）與 dual-audit 的雙軌精神共振，但不重疊

### 6.4 vs `creation-validation.md`（W8/W9/W10 — 待 P3 落地）

P3 將在 `creation-validation.md` §5 Worker 專屬檢查項新增：
- W8 — agent.yaml 含 `role_in_team` 且 ∈ 合法值（HIGH，阻斷 PASS）
- W9 — `verifier` 對應 `doer` 規則（Rule 2 + Rule 3）（HIGH，阻斷 PASS）
- W10 — 新建 D-worker 時 dispatch brief 含「為何不 enhance 既有 D-worker」說明（MED，CONDITIONAL_PASS）

本 P2 不執行 W8/W9/W10 落地（屬 P3 scope）。

### 6.5 vs `manager soul.md Principle 25-28`（rule rollout）

本 protocol 屬 rule rollout 範疇，遵循：
- Principle 25：rule 建立必派 agent-builder（本 P2 即為此派遣）
- Principle 26：多 phase rollout 各 phase 獨立 task_id（P2 / P3 / P4 / P5 / P6）
- Principle 28：Edit 數 ≤ 5（本 P2 共 4 ops）

---

## 7. Anti-patterns

### 7.1 D-worker 自驗（核心紅線）

**通用反 pattern 定義**：D-worker 同時擔任 V-worker — 自己驗自己等於沒驗，違反 Rule 3（核心紅線）。任何 team 在派工或建立 worker 時都應避免此 pattern。

**歷史反例（已 mitigated）**：`agents/platform/goose-ops/manager/org.md:67`（舊版）
```
Tier 2: "Manager 派 worker，worker 執行並 self-verify"
```

此 pattern 於 2026-05-24 由 goose-ops 自建 V-worker `platform/goose-ops/config-auditor` 解決（task `rdv-trich-p7-A-...`，依 Q8 長期方案落地）。同步更新 `goose-ops/manager` 5 個檔（org/soul/skills/workflow/README）將 self-verify 改為 dispatch config-auditor。**goose-ops 不再屬於當前反 pattern 範例**；保留歷史脈絡僅供 audit 追溯。

其他 team 若出現等價的 D-worker self-verify pattern，仍按本節通用定義判定為反 pattern。

### 7.2 V-worker 孤立存在於 team

team 有 V 但無對應 D，違反 Rule 2。例外只有「跨 team V」（如 agent-ops/governance）— 必須在 V-worker 的 README.md 或 dispatch trigger 中明確標示跨 team 性質。

### 7.3 `role_in_team` 多值

例如試圖宣告 `role_in_team: [researcher, doer]`，違反 Rule 1（依 Q7 用戶決策禁止多值）— 強制單一角色，迫使 team 多開 worker 分權。

正確做法：拆成兩個 worker，一個 `researcher`、一個 `doer`。

### 7.4 同 agent 跨 D+V

最大紅線 — 同一個 agent 既 do 又 verify，違反 Rule 3。

正確做法：拆成兩個 agent。R+V 雙身合法（不 Do），但 D 必須獨立。

### 7.5 用 `shared` 規避 trichotomy

把領域專屬 worker 標 `role_in_team: shared` 來繞過約束。例如把 `finance/billing-qa` 改標 shared 並丟給 `shared/billing-validator` — 這是濫用例外。

判定方式：`shared` 必須在 `agents/agent-ops/_shared/` 目錄下，且職責跨 team 無領域偏向。

### 7.6 Manager dispatch-protocol §4.6 Schema Variance（歷史：mcad strict-mode vs 其他 manager lenient-mode）<!-- self-added 2026-05-25 P8 audit F-new-1 -->
<!-- 2026-06-09 delete-mcad：mcad team 已刪除，本節保留為歷史脈絡，不再作為 live 規則 -->

> **歷史脈絡（mcad team 已於 2026-06-09 刪除）**：mcad/manager 曾是唯一採 strict-mode dispatch-protocol §4.6 的 manager（強制每次 dispatch 必填 `ROLE_IN_TEAM:`）。其餘 manager 採 lenient-mode（僅規範派 agent-builder 時的 brief schema）。兩種 mode 皆合規，差異屬文件規範範圍選擇。mcad team 刪除後，全系統僅剩 lenient-mode manager（agent-ops / sw / edu / sales / finance / bni）。

**長期方向**（原非強制，現已不適用）：mcad 刪除後，strict-mode vs lenient-mode 的 schema variance 在現有 6 team 中已不存在，可在後續 P9+ 重新評估是否引入 strict-mode。

### 7.7 test-only agent 位置與 role_in_team 例外<!-- self-added 2026-05-25 P8 audit F-new-3 -->

**現況**（依 P8 audit §5.2 F-new-3）：
- `agents/test-agent/` 位置不在任何 team 子目錄下（與 `agents/agent-ops/_shared/calculator` 在 `agents/agent-ops/_shared/` 下不同）
- agent.yaml: `reports_to: user` + `role_in_team: shared`

**合規依據**：
- test-only agent 的功能是「驗證 agent 系統本身的執行與回報機制」，不屬任何 domain team
- `reports_to: user` 表示由用戶直接派遣（非 manager dispatch），脫離 team trichotomy 派工結構
- `role_in_team: shared` 視為「框架測試例外」，與 `agents/agent-ops/_shared/calculator` 同類豁免（§2.2 第二條 + §3.4）
- 位置不在 `agents/agent-ops/_shared/` 下屬歷史結構，無 functional impact（reports_to + role_in_team 已正確標示）

**判定**：test-agent 例外合規，不視為違反 trichotomy 或位置規範。

**禁止濫用**：請勿以「test-agent 不在 team 子目錄」為先例，將其他 domain worker 放在 `agents/` 根目錄。新建 worker 必須位於對應 team 子目錄（或 `agents/agent-ops/_shared/` 若為跨 team 工具）。

---

## 8. Rollout 與 Grace Period

### 8.1 Grace Period

**截止日期：2026-06-22**（30 天，依 Q5 用戶決策）

過渡期內：
- 既有 agent.yaml 缺 `role_in_team` 不算違規
- 允許過渡值 `role_in_team: unclassified`
- 新建 agent **不受** grace period 保護 — 從 P3 落地後即強制必填

### 8.2 Rollout Phase 結構

| Phase | Task ID 範式 | 內容 | 狀態 |
|-------|------------|------|------|
| **P1** | `rdv-trichotomy-p1-scan-20260523` | researcher 盤點 8 team + agent-builder hooks 分析 | ✅ 完成 |
| **P2** | `rdv-trich-p2-rules-20260523` | **B1 規則層落地（本 task）** — anatomy §4.1/§6.9 + definitions.md + 本 protocol 新建 | ✅ 完成 |
| **P2b** | `rdv-trich-p2b-rename-20260523` | rename `rdv-protocol.md` → `worker-rdv-protocol.md` + top-level cross-ref 更新（anatomy.md / 本檔） | ✅ P2b-A (rename + top docs) 完成；✅ P2b-B1 (5 workflow.yaml，當時為 mcad team，已於 2026-06-09 刪除) 完成；⏳ P2b-B2 (demo-docs/README.md 3 ref) 待處理 |
| **P3** | `rdv-trich-p3-flow-20260523` | creation-validation.md W8/W9/W10 + agent-builder workflow（create / enhance / delete）+ Trichotomy Check skill | ✅ 完成 |
| **P4** | `rdv-trich-p4-dispatch-20260523` | manager dispatch-protocol.md 必填 role_in_team + 各 team manager 同步 | ✅ 完成 |
| **P5** | `rdv-trich-p5-audit-20260523` | Governance cross-phase audit，本 protocol 升 v1.0-FINAL | ✅ 完成（governance approved 2026-05-23，PASS_WITH_REMARKS） |
| **P6** | `rdv-trich-p6-bulk-YYYYMMDD` | 既有 agent bulk-update：批次補齊 `role_in_team`；移除 grace period；補強 bni | 未啟動 |

### 8.3 補齊計畫

- **新建 agent**：P3 落地後即強制 `role_in_team` 必填
- **既有 agent**：P6 bulk-update 統一補齊
- **bni 結構補強**：P6 階段處理（bni 補 R 進 flow）

---

## 9. Open Items（後續 phase 處理）

| # | 項目 | 對應 Phase |
|---|------|----------|
| 1 | rename `rdv-protocol.md` → `worker-rdv-protocol.md` + top-level cross-ref（anatomy.md / 本檔）✅ 完成；mcad 5 workflow.yaml ✅ 完成（P2b-B1，mcad team 已於 2026-06-09 刪除） | P2b-B1（完成） |
| 1b | demo-docs/README.md 3 處 `rdv-protocol` ref 替換（說明 doc，非規則層） | P2b-B2 |
| 2 | `creation-validation.md` 新增 W8 / W9 / W10 條目 | P3 |
| 3 | `agent-builder/workflow/create.md` 新增 Step 3.5 Team Trichotomy Check | P3 |
| 4 | `agent-builder/workflow/enhance.md` + `delete.md` 加 trichotomy 影響面 | P3 |
| 5 | `agent-builder/skills.md` Overlap Detection skill 升級為「Domain + Role Overlap」 | P3 |
| 6 | `agent-ops/manager/workflow/dispatch-protocol.md` §4 Task Block 加 `role_in_team` 範例 | P4 |
| 7 | 其他 team manager（sw / edu / sales 等）dispatch flow 同步 | P4 |
| 8 | `scripts/validate-agent.sh` 加 W8/W9/W10 檢查邏輯 | P3 末段 |
| 9 | Governance cross-phase audit + 本 protocol 升 v1.0-FINAL | P5 |
| 10 | 既有 agent bulk-update `role_in_team` + 移除 grace period | P6 |
| 11 | bni researcher 進 Update/Compile flow（補 R） | P6 |
| 12 | ✅ 已完成（2026-05-24）— goose-ops 自建 V-worker `platform/goose-ops/config-auditor`，依 Q8 長期方案落地（task `rdv-trich-p7-A-...` P7-A.2a~.6 共 6 個 sub-phase）；§5.3 已標 mitigated、§7.1 已列入歷史反例 | P7-A（提前完成） |
| 13 <!-- self-added 2026-05-25 P8 audit；updated 2026-05-25 β.4 --> | ✅ **已完成（2026-05-25）** — **P-tuq-paperclip-V**：tuq-paperclip 自建 V-worker `platform/tuq-paperclip/paperclip-validator`（opus，10 檔），第三方驗收 5 D/R worker 產出。從 cross-team interim → self V 落地完成；鏡像 goose-ops mitigation pattern。執行 task：`rdv-trich-beta-2a/2b/3/4` 系列（β.2a/.2b 建 V-worker 本體 + β.3 並行更新 manager 5 檔 + β.4 cross-system 補強本檔 + CLAUDE.md）。§5.3 已標 mitigated、§5.1 表已升 ✅ 三權分立。 | β（提前完成） |
| 14 <!-- self-added 2026-05-25 P8 audit；closed 2026-06-09 --> | ~~**tuq-paperclip team field 一致化**~~ — **已關閉（2026-06-09）**：tuq-paperclip team 已刪除，本 open item 不再適用。 | 已關閉 |
| 15 <!-- self-added 2026-05-25 P8 audit；closed 2026-06-09 --> | ~~**`platform` team naming policy 釐清**~~ — **已關閉（2026-06-09）**：與 #14 同根，goose-ops / tuq-paperclip 已刪除，platform team 僅剩 gb10-sysadmin，naming policy 歧義自動消除。 | 已關閉 |
| 16 <!-- self-added 2026-05-25 P8 audit；closed 2026-06-09 --> | ~~**mcad §4.6 strict-mode 文檔化**~~ — ✅ 完成（本 task `rdv-trich-alpha-v11final-20260525` 落地於本檔 §7.6）。**已關閉（2026-06-09）**：mcad team 已刪除，§7.6 保留為歷史脈絡。 | 已關閉 |
| 17 <!-- self-added 2026-05-25 P8 audit --> | **test-agent 例外文檔化** — ✅ 完成（本 task 落地於本檔 §7.7） | 完成 |

### 開放問題（已由用戶決策，記錄供 P5 audit 回溯）

| Q | 決策 |
|---|------|
| Q1：同 manager 派 D+V 算合一？ | **B — 不算**，只要 agent 不同名即合法（已寫入 Rule 5） |
| Q2：agents/agent-ops/_shared/calculator 同時做 D+V？ | **標 `shared` 豁免**（已寫入 §3.4 + §2.2） |
| Q3：跨 team V 對應的 D 是誰？ | **全系統有任意 D 即 PASS**（已寫入 Rule 2 例外） |
| Q4：role_in_team 含 manager？ | **manager+ type 自動視為 manager role，欄位只在 worker 強制**（已寫入 §2.2 + §4.1） |
| Q5：既有 agent grace period？ | **30 天，截止 2026-06-22**（已寫入 §8.1） |
| Q6：rdv-protocol 用語衝突？ | **A — rename 為 worker-rdv-protocol.md + 另開 team-trichotomy-protocol.md（本檔）**（rename 已於 2026-05-23 P2b-A 完成） |
| Q7：role_in_team 多值？ | **禁止**，強制單一（已寫入 Rule 1 + 反 pattern 7.3） |
| Q8：goose-ops 缺 V 怎麼辦？（歷史決策，team 已於 2026-06-09 刪除） | **短期 agent-ops/governance 兼任；長期 goose-ops 自建**（已寫入 §5.3；Q8 解法最終於 2026-05-24 由 goose-ops 自建 config-auditor 落地，隨後 team 刪除） |

---

## 10. Version History

| 版本 | 日期 | 作者 | 變更 |
|------|------|------|------|
| v1.0-DRAFT | 2026-05-23 | agent-ops/agent-builder | 初版起草（P2 B1 規則層落地）。狀態 DRAFT_PENDING_GOVERNANCE_REVIEW，P5 audit 後升 v1.0-FINAL。 |
| v1.0-FINAL | 2026-05-23 | agent-ops/agent-builder（task `rdv-trich-final-20260523`） | 依 governance P5 audit 結論升 FINAL。Audit verdict：**PASS_WITH_REMARKS**（0 FAIL / 0 HIGH / 2 LOW doc-lag）。本次落地 3 Edit：§8.2 phase 表 refresh（P2b-B1 / P3 / P4 / P5 狀態更新）、§9 Open Item #1 拆分（B1 完成 / B2 待處理）、檔頭狀態欄升 FINAL。Audit 完整紀錄見 `output/agent-ops/rdv-trich-p5-audit-20260523/governance_audit.md` §6/§7.4。 |
| v1.0-FINAL+ (maintenance) | 2026-05-25 | agent-ops/agent-builder（task `rdv-trich-alpha-v11final-20260525`） | 依 governance P8 final cross-rollout audit（task `rdv-trich-p8-final-audit-20260525`，verdict **PASS_WITH_REMARKS** / 0 FAIL / 0 HIGH 新發現）落地 5 段補強：(1) §5.1 8-team → 9-team（加 tuq-paperclip + gb10-sysadmin）+ 統計刷新；(2) §5.3 cross_team_verifier 名單明文化（governance + evolution）+ tuq-paperclip / gb10 合規依據；(3) §7.6 新增 mcad §4.6 strict-mode vs 其他 8 manager lenient-mode schema variance 章節；(4) §7.7 新增 test-only agent 位置與 role_in_team 例外條款；(5) §9 Open Items #13-#17 新增（P-tuq-paperclip-V / team field 一致化 / naming policy / mcad doc / test-agent doc）。檔頭版本保持 v1.0-FINAL（本次屬 FINAL 後維護增量，無規則層實質變動，故不升 minor 版本號）。Audit 完整紀錄見 `output/agent-ops/rdv-trich-p8-final-audit-20260525/governance_audit.md` §5-§7。 |

---

## 11. References

### 上承規範
- `agents/agent-ops/_protocols/rules/agent-anatomy.md` §4.1（`role_in_team` 欄位定義）
- `agents/agent-ops/_protocols/rules/agent-anatomy.md` §6.9（Team Trichotomy Rule 精簡版）
- `agents/agent-ops/_protocols/definitions.md` §Agent Entry Point Schema（條件必填欄位）

### 平行 protocol
- `agents/agent-ops/_protocols/worker-rdv-protocol.md`（個體層 Worker-internal RDV；原名 `rdv-protocol.md`，2026-05-23 rename）
- `agents/agent-ops/_protocols/verification-protocol.md`（Manager 跨層驗收）
- `agents/agent-ops/_protocols/dual-audit-protocol.md`（Doer/Reviewer 雙軌稽核）
- `agents/agent-ops/_protocols/hitl-protocol.md`（高風險暫停）
- `agents/agent-ops/_protocols/worklog-protocol.md`（打卡通用紀律）

### 下接（P3+ 落地）
- `agents/agent-ops/_protocols/rules/creation-validation.md`（W8/W9/W10 落地點）
- `agents/agent-ops/agent-builder/workflow/create.md`（Step 3.5 Trichotomy Check 插入點）
- `agents/agent-ops/manager/workflow/dispatch-protocol.md`（§4 Task Block role_in_team 落地點）

### Phase 1 事實基底
- `output/agent-ops/rdv-trichotomy-p1-scan-20260523/team-rdv-mapping.md`（8-team 三權盤點）
- `output/agent-ops/rdv-trichotomy-p1-scan-20260523/agent-builder-hooks.md`（agent-builder 插入點 + 8 開放問題）

### 用戶決策來源
- 2026-05-23 用戶對 P1 報告 8 個 open questions 的決策（記錄於 §9 開放問題表）
