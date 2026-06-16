<!-- created 2026-04-27 — agent-ops/agent-builder, dispatched by agent-ops/manager -->

# Deliverable Internal Structure Rules

> **地位**：與 `output-placement.md` 並列為「任務產物」治理規範。
> - `output-placement.md` 規範**檔案放在哪裡**（位置 / 路徑 / 目錄結構）
> - 本規則規範**檔案內部長什麼樣**（frontmatter / TOC / 章節 / 版本）

## 1. 適用範圍

任何由 worker agent 產出、放於 `<CWD>/output/{team}/{task_id}/` 下、預計被人類審閱或下游 agent 消費的 deliverable / artifact 檔案，包括但不限於：
- 教材設計稿（design-draft）
- 業務提案（proposal）
- 研究報告（research-report）
- QA 報告（qa-report）
- 規格 / patch-spec
- 簡報腳本

**不適用**：
- agent 定義檔（受 `agent-anatomy.md` 規範）
- worklog / memory（受對應 protocol 規範）
- 機器可讀中間產物（JSON / CSV — 受結構化 schema 規範，但 frontmatter 可豁免）

## 2. 為什麼 deliverable 不套 agent-anatomy.md 的行數閾值

| 維度 | Agent 定義檔 | Deliverable |
|---|---|---|
| 「大」的代價 | dispatch 邏輯複雜難維護，影響 context window | 內容豐富正常 — 教材本來就要 1500+ 行 |
| 解法 | router 化（拆 sub-flow） | 章節化（依語意拆 chapter） |
| 切割原則 | 行數閾值（200/300/250） | **語意自然斷點**（章 / 步驟 / 階段），無行數上限 |

→ 因此 deliverable **不設行數閾值**，但仍需「結構規範」確保可讀、可檢索、可版本控制。

## 3. Hard Rules（四條鐵律）

| # | Rule | 違反後果 |
|---|---|---|
| H1 | 每個 deliverable **必有 frontmatter**，至少包含：`title` / `version` / `revision_date` / `audience`（若適用）/ `language` | 缺 frontmatter 視為不合格交付，QA 應退件 |
| H2 | > 800 行的 deliverable **必有 Table of Contents anchor**（章節 anchor link） | 缺 TOC 視為不合格交付 |
| H3 | 同一 task 多版本（v1/v2/v3...）：**最新版**留 task_id 根目錄，**舊版本**移到 `archive/` 子目錄；每版必有 `revision_notes` 區段（描述本版相對前版的變動） | 多版並存於根目錄視為違規，QA 巡檢應告警 |
| H4 | 檔名版本後綴一律用 `_v{N}.md`（N 為整數）；最新版可省略 `_v` 但**新增版本時必須先把無 `_v` 那份重新命名為 `_v{N}` 移到 archive/** | 命名混亂導致版本順序不可追溯 |

## 4. 結構規範（建議遵守）

### 4.1 frontmatter 範本

````yaml
---
title: 把你的職業自動化（FDE 培訓）
title_en: Automate Your Profession
version: v7.3
revision_date: 2026-04-27
revision_notes: |
  - 主要變動 1
  - 主要變動 2
audience: developer | executive | power-user | FDE
language: zh-TW
course_code: EDU-FDE-001  # 可選
---
````

### 4.2 TOC anchor 範本

當 deliverable > 800 行（或 > 50KB）時：

````markdown
## 目錄

- [前言](#前言)
- [第 1 章 — XXX](#第-1-章--xxx)
  - [1.1 …](#11-)
  - [1.2 …](#12-)
- [第 2 章 — XXX](#第-2-章--xxx)
- ...
- [附錄](#附錄)
````

### 4.3 章節切分（建議，非強制）

當 deliverable > 1500 行：建議**依自然語意切章**為多個檔案，並在 task_id 根目錄保留 `index.md`：

```
output/edu/fde-training-20260427/
├── index.md                        # frontmatter + TOC + 各 chapter 引導
├── ch01-opening.md                 # A 開場
├── ch02-step1-monitoring.md        # Step 1 — 監測
├── ch03-step2-...
├── ch04-step3-...
├── ch05-step4-...
├── ch06-step5-architecture.md
├── ch07-closing.md
└── archive/                        # 舊版本完整文件
    ├── fde-training-design-draft-v1.md
    └── ...
```

**章節切分原則**：
- 依**自然語意斷點**（章 / 步驟 / 階段 / 主題），不依行數
- 每章維持完整可讀（不切到敘事中斷）
- index.md 必含 TOC + 跨章引用 link

## 5. revision_notes 格式

每次新版必含 `revision_notes:` 段，使用條列說明：

- 對前一版做了什麼改動（新增 / 刪除 / 重組）
- 為何改動（如：用戶 feedback / QA 發現 / 方向調整）
- 影響範圍（哪些章節 / slide / step）

範例：

````yaml
revision_notes: |
  - 標題改回「把你的職業自動化」（v7.2 為「FDE 培訓教材」）
  - A 開場 FDE 篇幅由 8 張縮為 5 張（刪 P6 對比表 / P8 day-to-day / P9 stack）
  - Step 5 重定位：從「教學員寫 prompt」改為「派 agent-ops 修改 agent」
  - 不動 pptx/docx/xlsx（僅 .md）
````

## 6. QA 驗收 checklist

QA / Governance 巡檢 deliverable 時，至少檢查：

- [ ] frontmatter 存在且必填欄位齊（H1）
- [ ] > 800 行有 TOC（H2）
- [ ] 同 task 多版本：最新版在根目錄、舊版本在 `archive/`（H3）
- [ ] 檔名 `_v{N}` 規則（H4）
- [ ] revision_notes 描述明確（§5）
- [ ] 章節敘事連貫（無切斷感）
- [ ] 內部連結（TOC anchor / cross-ref）正常
- [ ] 與相關 deliverable 的版本對齊（例：design-draft v7 → ppt v7 → qa-report v7）

## 7. 與其他 protocol 的關係

- `output-placement.md`：規範**位置**（agent 資料夾禁止 output/ + `<CWD>/output/{team}/{task_id}/` 結構）
- 本規則：規範**內部結構**（frontmatter / TOC / 切章 / 版本歸檔）
- `agent-anatomy.md`：規範 **agent 定義檔**（不規範 deliverable）

三者互補，不重疊。

## 8. 起源

- 2026-04-27 用戶提問：「`fde-training-design-draft-v1.md` 1945 行很大，這個該被規範嗎？」
- Manager 答：「位置該規範（已有 protocol），但內容大小不該套 agent 閾值；deliverable 內部治理是另一維度，目前 protocol 缺口 — 補本檔。」
- 完整背景見 `agents/agent-ops/manager/memory/feedback-2026-04-27-dispatch-paths.md`（同日的 dispatch-paths feedback）+ 後續 retrospective。
