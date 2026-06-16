# 每週 Team 檢討流程（Weekly Team Review Flow）

## 目的
Team Manager 每週對自己 team 做一次**輕量**的自我檢討：讀一份 L2 weekly digest（不自己掃 raw log），檢視本週任務概覽、重複失敗、scope 違規，並把 worker 值得升級為長期記憶的學習提名確認下來。檢討產出是**紀要 + 升級提名**，不直接跨改 worker 的 soul/skills（那是 Tier 3）。

## 適用角色
Team Manager (L2) — 各 team 的 manager（sw / edu / sales / finance / agent-ops / bni / platform / hw-design / 1997-factory / web-to-db 等）。
> 這是 team 級**輕量**檢討，與每月系統級**深度**組織檢討（Evolution 跑，併入 self-growth scan）互補。月度檢討見 `agents/agent-ops/_protocols/rules/self-growth.md` §3 組織維度。

## 觸發時機
- 建議每週觸發一次（cron 或下次任務收尾順帶執行）。
- 屬**加法**：各 team manager 在 workflow.yaml 加一個 `weekly_team_review` step（標 `# self-added`），不改現有 step。

## 輸入 / 輸出

| 項 | 內容 |
|----|------|
| 輸入 | `agents/_log/digest/weekly/{YYYY-Www}.md`（L2，weekly-rollup 產出）＋ `.promote.json`（lesson 升級候選） |
| 輸出 | `agents/{team}/manager/memory/team-review-{YYYY-Www}.md`（本週檢討紀要 ＋ 升級提名確認清單） |

## 執行步驟

```
[週檢討 step]（team manager workflow；weekly 觸發或下次任務收尾順帶）
  │
  ▼
[1] 讀本週 weekly digest
  檔案：agents/_log/digest/weekly/{YYYY-Www}.md
  │
  ├─ digest 不存在（該 team 本週無活動 / rollup 尚未產出）
  │     → 印 "no weekly digest for {YYYY-Www}, skip"
  │     → no-op 退出（不產空紀要）          ← 休眠分支
  │
  └─ digest 存在 → 繼續 [2]
  │
  ▼
[2] 本週任務概覽
  直接引用 digest 的聚合數字（events / outcomes），不重算、不掃 raw log。
  記入紀要「本週任務概覽」段。
  │
  ▼
[3] 重複失敗檢視
  讀 digest 的「重複失敗 top」清單，逐項判斷：
    - 是否系統性（反覆出現 vs 一次性）？
    - 該怎麼改（重試策略 / prompt / 補 skill / 是否需上呈月度系統檢討）？
  記入紀要「重複失敗」段。
  │
  ▼
[4] scope 違規檢視
  讀 digest 的「scope 違規數」：
    - == 0 → 記「本週無 scope 違規」
    - > 0  → 記入紀要 + 提醒對應 worker（哪個 worker、違規型態）
  │
  ▼
[5] worker 學習升級（提名確認）
  讀 .promote.json 的 lesson 升級候選：
    - Manager 確認哪些候選值得升為該 worker 的長期記憶（L3）
    - 確認的候選 → 走既有 inter-agent-feedback / save_memory，
      寫進該 worker 的 memory/（或 memory/incoming/）
    - 不直接跨改 worker 的 soul.md / skills.md（那是 Tier 3，本步驟只做「提名 + 確認」）
  記入紀要「升級提名確認清單」段。
  │
  ▼
[6] 寫紀要
  檔案：agents/{team}/manager/memory/team-review-{YYYY-Www}.md
  內容：[2] 任務概覽 + [3] 重複失敗 + [4] scope 違規 + [5] 確認的升級清單
  並在 manager 的 memory/MEMORY.md 追加一行索引。
```

## 休眠 / 邊界
- **無 weekly digest**（該 team 本週無活動，或 weekly-rollup 尚未產出）→ step [1] no-op，**不產空紀要**。落地當天若 log 尚未累積，週檢討安靜地略過，不報錯。
- **輕量原則**：只讀一份 weekly digest + 幾個判斷，不做系統級分析（裁閒置/過勞、派活比、feedback 落對率、能力缺口等屬月度系統檢討範疇，由 Evolution 在 self-growth scan 內處理，本 flow 不重做）。
- **不執行改組織動作**：worker 學習升級只到「提名 + 寫 worker memory」；任何「建/廢 agent、改 soul/skills」屬 Tier 3，由 Evolution 月度提案 → Agent Builder 在 HITL 後執行，不在週檢討內發生。

## 週 → 月 銜接
本 flow [5] 確認的「升級提名」是每月系統檢討（self-growth scan 組織維度）「能力缺口 → 長新角色」分析的輸入訊號之一。週檢討做 team 級自我修正（輕），月檢討做系統級組織演進（深），兩節律銜接。

## 與既有 protocol 的關係（避免重複造輪）

| 既有 protocol / flow | 關係 |
|----------------------|------|
| `agents/agent-ops/_protocols/rules/self-growth.md` §3 | 月度系統組織檢討（深度），本 flow 是其 team 級輕量對應；週提名餵月分析 |
| `agents/agent-ops/_protocols/workflows/feedback-detect-flow.md` | [5] 升級確認走 inter-agent-feedback 路由，與該 flow 的 worker 路由共用機制 |
| log-protocol（weekly-rollup §digest）| [1] 輸入來源；digest 由 rollup 產，本 flow 只讀不算 |
| `agents/agent-ops/_protocols/rules/memory-hygiene.md` | [5] 升級寫入 worker memory 時遵循記憶生命週期規則 |

> 本 flow 是 Phase 3 組織檢討雙節律的「每週 team 級」一半；「每月系統級」併入 self-growth scan，見 self-growth.md §3。

## 備註
- 紀要寫入失敗不應阻斷正常 workflow（建議 `on_error: continue`）。
- 本 flow 為純加法擴展，不改各 manager 現有 step。

## Changelog
- **2026-06-07 memory-overhaul Phase 3 Batch C**：新建。組織檢討雙節律之「每週 team 級輕量檢討」。依 `output/agent-ops/memory-improvement-20260606/phase2-3/p3-org-review-flows-draft.md` §1。team manager 讀 L2 weekly digest 做輕量檢討（本週任務 / 重複失敗 / scope 違規 / worker 學習升級提名）；無 weekly digest 走休眠 no-op 分支。
