# Tier Protocol（記憶金字塔分層與淨減量總綱）

> 建立：2026-06-07（trace-memory-overhaul-20260607，Phase 2+3 Batch A）
> 權威設計：`output/agent-ops/memory-improvement-20260606/phase2-3/p2-tier-definitions-draft.md`
> 定位：橫跨 **log + memory + hygiene** 三個既有 protocol 的「**節律與淨減量總綱**」。本協議**以引用接既有三者，不重複定義** schema / 格式 / 瘦身算法。
> 引用（已上線地基，不重做）：`log-protocol.md`（L0 + §4 retention + §6.1 access 接口）、`memory-protocol.md`（L3 = 長期層）、`memory-hygiene.md` §4（L3 keep_score 瘦身）+ §9（archive 永久保留）。

---

## 0. 一句話

把「事件 log → 每日 → 每週 → 長期 → archive」定義成**五層金字塔**；**每層被上層彙整後必須收掉下層（淨減量）**，否則只是把 1 種 bloat 變 5 種。本協議定義各層的內容/格式/retention/誰生成/收下層的硬規則。

**休眠原則貫穿全層**：任何層在「下層無新資料」時 graceful no-op，不產空檔、不報錯。資料未累積前，整座金字塔安靜地什麼都不做（行為等同落地前）。

### 與既有 protocol 的關係（先講清楚不重複）

| 層 | 由誰定義 | 本協議做什麼 |
|----|----------|--------------|
| **L0 事件 log** | `log-protocol.md`（schema / 落點 / retention / access 接口，已上線） | **不重定義**，只納入金字塔語彙 |
| **L1 每日 digest** | **本協議新增**（§2.1） | 定義內容/格式/retention/休眠 |
| **L2 每週彙整** | **本協議新增**（§2.2） | 定義內容/格式/retention/休眠 |
| **L3 長期記憶** | `memory-protocol.md`（格式 / frontmatter）+ `memory-hygiene.md` §4（瘦身），**即現行 memory，不新建層、不改格式** | **不重定義**，只定義「L2 如何升級進 L3」的接點（§2.3） |
| **L4 archive** | `memory-hygiene.md` §9（memory archive 永久不刪）+ `log-protocol.md` §4（log/digest archive），已上線 | **不重定義**，只納入金字塔語彙 |

> **L0 與 L4 已由既有 protocol 完整定義並上線**，本協議不重定義，只把它們納入金字塔並補 **L1 daily digest + L2 weekly + L3 升級接點**這三段「中間層」。
> **L3 = 現行 memory，不新建第四個目錄、不改 frontmatter。** 金字塔頂就是 `agents/{team}/{agent}/memory/`。

---

## 1. 五層定義（總覽）

| 層 | 代號 | 內容 | 落點 | 格式 | retention | 誰生成 | 上層彙整後如何收掉本層 |
|----|------|------|------|------|-----------|--------|------------------------|
| L0 事件 log | `log` | 每棒事件（誰派誰 / outcome / files_touched / memories_referenced / user_feedback） | `agents/_log/YYYY-MM-DD.jsonl` | JSONL（log-protocol §1） | 當天（熱），rollup 消化後壓 archive | 各 agent 收尾自報 + transcript 探勘補 | **已定義**（log-protocol §4）：daily-rollup 完成 + SHA256 驗證 → gzip 併入 `archive/YYYY-MM.jsonl.gz` → **刪當日明文** |
| L1 每日 digest | `daily` | 當日跨 agent 摘要：事件數、各 outcome 計數、top dispatch 對、feedback-routing 命中、access 增量已落袋確認 | `agents/_log/digest/daily/YYYY-MM-DD.md` | MD（小表格 + 數行 bullet，≤30 行） | 7 天（被 weekly 彙整後收） | daily-rollup（半自動 runner） | weekly-rollup 生成當週後 → 把該週 7 個 daily digest 壓進 `digest/archive/weekly-{ISO週}.daily.tar.gz` 或直接刪（內容已被 weekly 吸收）→ **刪明文 daily** |
| L2 每週彙整 | `weekly` | 當週跨 agent：outcome 趨勢、重複失敗 top、scope 違規數、各 agent 活躍度、值得升長期的 lesson 候選 | `agents/_log/digest/weekly/YYYY-Www.md` | MD（趨勢表 + lesson 候選清單） | 5 週（被 monthly 彙整後收） | weekly-rollup | monthly-rollup 生成當月後 → 把該月 ~4 個 weekly 壓進 `digest/archive/monthly-{YYYY-MM}.weekly.tar.gz` → **刪明文 weekly** |
| L3 長期記憶 | `longterm` | 蒸餾後的教訓 / 決策 / 偏好 / 紀律（**現行 memory 系統**：各 agent `memory/*.md` + `MEMORY.md` 索引） | `agents/{team}/{agent}/memory/` | MD + frontmatter（memory-protocol） | 由 hygiene §4 keep_score 管理（**非時間硬砍**） | monthly-rollup 把 L2 lesson 候選**提名升級**；實際寫入仍走既有 save_memory / Agent Builder | **不被自動收**——金字塔頂的活躍知識層。瘦身靠 hygiene §4（importance==5 豁免、低 keep_score 標 stale→30 天確認→移 archive，**不自動刪**） |
| L4 archive | `archive` | 已 superseded / stale / 低頻的歷史知識（壓縮保存） | `agents/{team}/{agent}/memory/archive/` + `agents/_log/archive/` + `agents/_log/digest/archive/` | 壓縮或原樣 | memory archive **永久不刪**（hygiene §9）；log archive 明細 3 月後只留月聚合（log-protocol §4.2 規則 3） | hygiene（memory）、rollup retention（log / digest） | 終點層，不再往上彙整 |

---

## 2. 各層內容/格式細節

### 2.1 L1 每日 digest（本協議新增）

- **目的**：把當日 L0 raw 事件壓成人類可讀的一頁，並**確認 access 增量已落袋**（log-protocol §4.2 規則 4 的放行訊號之一）。
- **內容（MVP）**：
  - header：date、總事件數、各 outcome 計數（success / partial / fail）。
  - top dispatch 對（dispatcher→worker 出現次數前 5）。
  - feedback 命中：`user_feedback.present` 事件數 + 其中 `target ≠ 收回饋 manager` 的數（餵 Phase 3 feedback-routing 率）。
  - access 落袋確認：`agents/_log/.access/YYYY-MM-DD.access.json` 已由 `apply-access-increments.js` 標 done（是 / 否）。
- **格式**：MD，≤ 30 行。**不複製 raw 事件**（raw 還在 L0，digest 只放聚合數 — 見 R4）。
- **nice-to-have**：異常標記（fail 比例 > 30% 當日 → ⚠️）。

### 2.2 L2 每週彙整（本協議新增）

- **目的**：team 級檢討（Phase 3.1）+ 系統趨勢的輸入；標出「值得升長期的 lesson 候選」。
- **內容（MVP）**：
  - outcome 趨勢：本週 vs 上週各 outcome 比例（**精確百分比委派 `agents/agent-ops/_shared/calculator`**）。
  - 重複失敗 top：同類 task 出現 ≥ 2 次 fail 的清單（給 team manager 看）。
  - scope 違規數：log 中標記 scope violation 的事件（log 無此訊號則標「本週無 scope 訊號」）。
  - 各 agent 活躍度：本週為 worker 的事件數（餵 Phase 3 worker 使用率 / 閒置）。
  - **lesson 候選**：本週反覆出現的 user_feedback / 修正模式，列為「建議升 L3」候選（**rollup 只提名，不自動寫 memory**）。
- **格式**：MD，趨勢小表 + lesson 候選 bullet 清單。
- **nice-to-have**：跨 team 對比（接現有 Cross-Team Workflow Diff skill）。

### 2.3 L3 長期（現行 memory，不新建層）

- **就是現在的 `agents/{team}/{agent}/memory/`。** Phase 2 不改其格式（沿用 memory-protocol frontmatter，含已轉正的 `last_accessed` / `access_count`）。**不新建第四個目錄、不改 frontmatter。**
- monthly-rollup 對 L3 做兩件事，**兩者都不繞過既有機制**：
  1. **提名升級**：把 L2 的 lesson 候選交給對應 agent 的 save_memory 流程（rollup **不直接跨 agent 寫 memory** — 避免違反 hygiene §9；實際寫入由該 agent 或 Agent Builder 執行）。
  2. **觸發瘦身**：呼叫既有月度 hygiene 全系統掃描（owner = Evolution），用 keep_score 標 stale。**這不是新機制**，是把現有月度掃描掛進金字塔節律。

### 2.4 L4 archive（現行，不改）

- **memory archive**：hygiene §9（永久保留、不刪、壓縮）。
- **log / digest archive**：log-protocol §4.2 + §1 表的 digest archive 規則。

---

## 3. 淨減量硬規則 R1–R7

> 金字塔只有在「上層生成、下層收掉」時才淨減量。以下為**硬規則**，落地時逐條遵守。

| # | 規則 | 適用層 | 與既有對齊 |
|---|------|--------|-----------|
| **R1** | **上層未生成且未驗證，不收下層** | 全層 | 同 log-protocol §4.2 規則 1（rollup 未完成不收 log） |
| **R2** | **上層生成後，下層明文必須收掉**（壓 archive 或刪）——禁多層明文並存同一份資料 | L0→L1→L2 | 同 log-protocol §4.2 規則 2（歸檔即收明文） |
| **R3** | **access 訊號先落袋再收 L0**：當日 `memories_referenced` 必須已被 `apply-access-increments.js` 消化（標 done）才可收 L0 | L0 | log-protocol §4.2 規則 4，已上線 |
| **R4** | **digest 只存聚合、不複製 raw**：L1 / L2 不得逐筆複製下層明細（複製 = 沒淨減量） | L1, L2 | **本協議新增** |
| **R5** | **L3 不被自動收**：長期層只由 hygiene §4 keep_score 管理，**只標記不自動刪**（標 stale→30 天確認→移 archive） | L3 | hygiene §4 + §9，已上線 |
| **R6** | **importance == 5 永久豁免**：紀律 / 安全 / 回饋鐵律全程不淘汰、不被 rollup 降級 | L3 | hygiene §4，已上線 |
| **R7** | **休眠 no-op 也算合規**：下層無新資料時，上層不生成、不收，不報錯、不產空檔 | 全層 | **本協議新增**——見 §4 |

**淨減量的量化定義**：一個 rollup 週期後，
`明文資料總量(after) ≤ 明文資料總量(before) − 被收掉的下層明文 + 新生成的上層聚合`，
且因 R4（聚合 << 明細），總量**單調下降或持平**（持平 = 休眠 no-op）。

---

## 4. 休眠機制（graceful no-op）——逐層保證

| 層 | 「無資料」判定 | no-op 行為 | 不會壞的根據 |
|----|---------------|-----------|-------------|
| L1 daily | 當日 `agents/_log/YYYY-MM-DD.jsonl` 不存在或 0 行 | 不產 daily digest、不產 access 增量、印「no log for {date}」exit 0 | 無下游消費空 digest；`apply-access-increments` 已定義「當天無 log → exit 0」 |
| L2 weekly | 當週 7 天無任一 daily digest | 不產 weekly、印「no daily digests for week {Www}」exit 0 | weekly 無輸入即無輸出，下游（team 檢討）讀不到檔時自行 skip |
| L3 升級 | L2 無 lesson 候選 | 不提名、不觸發 save_memory | 提名為空集合，自然 no-op |
| L3 瘦身 | hygiene 掃描無 stale 候選 | 既有月度掃描本就「無候選不動作」 | hygiene §4 現行行為，已驗證 |
| L4 | 無新 archive 輸入 | 不動 | 終點層 |

**全局保證**：金字塔在「系統還沒開始寫 log / log 還沒累積」時，**每一層都是 no-op**，落地當天系統行為 = 落地前（memory 系統照常、hygiene 照常 fallback 到 last_update）。資料一旦開始累積，金字塔自下而上逐層「醒來」，**無需手動切換**。

---

## 5. rollup 節律

三段 rollup 的觸發頻率、半自動 runner、腳本規格與落點，見 `output/agent-ops/memory-improvement-20260606/phase2-3/p2-rollup-scripts-spec.md`（daily-rollup / weekly-rollup / monthly-rollup）。本協議只規範**節律與淨減量規則**，腳本實作由 rollup spec 定義。

- **daily-rollup**：消化 L0 → 產 L1 digest + access 增量落袋（R3）→ 條件滿足後收 L0（R1/R2）。
- **weekly-rollup**：彙整 7 個 L1 → 產 L2 weekly → 收 L1 明文（R2）。
- **monthly-rollup**：彙整 ~4 個 L2 → 提名 L3 升級（§2.3）+ 觸發 hygiene 月掃描 → 收 L2 明文（R2）。

---

## 6. 流量分級

不同流量規模下各層的觸發 / 批次策略（低流量休眠、中高流量分批），見 `output/agent-ops/memory-improvement-20260606/phase2-3/p2-traffic-tiering.md`。R7 休眠 no-op 是流量分級的下界（零流量 = 全層靜默）。

---

## Cross-References

- 權威設計：`output/agent-ops/memory-improvement-20260606/phase2-3/p2-tier-definitions-draft.md`
- L0 事件 log（schema / 落點 / retention / access 接口）：`agents/agent-ops/_protocols/log-protocol.md`
- L3 長期記憶（格式 / frontmatter / 收尾 Memory Check）：`agents/agent-ops/_protocols/memory-protocol.md`
- L3 瘦身（keep_score / importance==5 豁免）+ L4 memory archive（永久不刪）：`agents/agent-ops/_protocols/rules/memory-hygiene.md` §4、§9
- rollup 腳本規格：`output/agent-ops/memory-improvement-20260606/phase2-3/p2-rollup-scripts-spec.md`
- 流量分級：`output/agent-ops/memory-improvement-20260606/phase2-3/p2-traffic-tiering.md`
- 升級路徑（memory→skill→protocol→system rule）：`agents/agent-ops/_protocols/rules/memory-hygiene.md` §7
- 已 OBSOLETE 的打卡（勿據此疊加打卡語義）：`agents/agent-ops/_protocols/worklog-protocol.md`、`agents/agent-ops/_protocols/punch-protocol.md`
