# Edu Team Workflow 審查報告

**日期**：2026-04-16
**審查員**：Evolution Agent (sonnet) @ Agent Ops Team
**審查對象**：Edu Manager 於 2026-04-13 ~ 2026-04-16 執行「AgentOrg Training Workshop」教材生成任務
**觸發原因**：用戶舉報「Edu Team 又在隨便亂派了，完全沒有按照 workflow」

---

## Executive Summary

Edu Manager 的核心四步流程（Research -> Design -> Evaluate -> Generate）在 v1/v2 全流程執行中基本遵循，但在 v2.1 以後的增量修改（新增 Ch0、排版修正、Officer 概念修正）中，幾乎全部跳過了 Research / Design / Evaluate 三步，直接進入 Generate 階段，屬於嚴重的 workflow 違規。workflow.yaml 本身缺少「增量變更時的一致性檢查」和「品牌資產前置確認」步驟，屬於設計缺陷。20 筆 Edu Manager worklog 中有 8 筆（40%）處於 "started" 狀態未收工，違反「打卡是天條」原則。

---

## A. Workflow 遵循度分析

### workflow.yaml 定義步驟 vs 實際執行

| # | 步驟 ID | workflow.yaml 定義 | v1 (04-13) | v2 全流程 (04-15 02:52) | v2.1 排版修正 (04-15 10:29) | v2.2 Ch0 新增 (04-15 12:46) | v2.3 Ch0 v2 擴展 (04-15 12:48) | v2.4 Officer 修正 (04-15 13:09) |
|---|---------|-------------------|:----------:|:----------------------:|:--------------------------:|:--------------------------:|:------------------------------:|:------------------------------:|
| 1 | log_start | 打卡開工 | PASS | PASS | PASS | PASS | PASS | PASS |
| 2 | feedback_detect | 偵測用戶回饋語意 | SKIP | SKIP | SKIP | SKIP | SKIP | SKIP |
| 3 | parse_request | 解析需求 | PASS | PASS | SKIP | SKIP | SKIP | SKIP |
| 4 | research | 平行研究 | PASS | PASS | SKIP | SKIP | SKIP | SKIP |
| 5 | design_content | 內容設計 | PASS | PASS | SKIP | SKIP | SKIP | SKIP |
| 6 | evaluate_content | 內容評估 | PASS | PASS | SKIP | SKIP | SKIP | SKIP |
| 7 | visual_styling | 視覺風格 | PASS | PASS | PASS | SKIP | SKIP | SKIP |
| 8 | pre_generate_routing | 章節拆分 | N/A | PASS | SKIP | SKIP | SKIP | SKIP |
| 9 | generate_docs_parallel | 並行生成 | PASS | PASS | PASS | PASS | PASS | PASS |
| 10 | merge_docs | 合併文件 | N/A | PASS | PASS | PASS | PASS | PASS |
| 11 | qa_review | QA 審查 | PASS | PASS | SKIP | SKIP | SKIP | SKIP |
| 12 | verify | 驗證產出 | FAIL | PASS | SKIP | SKIP | SKIP | SKIP |
| 13 | synthesize | 合成結果 | PASS | PASS | PASS | SKIP | PASS | SKIP |
| 14 | deliver | 交付用戶 | PASS | PASS | PASS | SKIP | PASS | SKIP |
| 15 | log_end | 打卡收工 | PASS | PASS | PASS | **FAIL** | PASS | **FAIL** |

### session_init 步驟

workflow/edu-flow.md 定義了 session_init 步驟（建立 `sessions/YYYY-MM-DD_{topic_short}` 目錄），但在所有 20 筆 worklog 中，沒有任何一筆包含 session_dir 參考。Training_AgentOrg 專案下也不存在 `sessions/` 目錄。**session_init 步驟在整個任務中從未被執行。**

### 關鍵發現

1. **增量修改時 workflow 全面崩潰**：v2.1 ~ v2.4 的四輪修改中，Manager 只執行了 generate（直接派 doc-generator 修改 PPTX/DOCX），跳過了 Research / Design / Evaluate / QA Review 全部品質把關步驟。
2. **feedback_detect 步驟從未執行**：6 輪執行中無一觸發，疑似此步驟對應的 `feedback-detect-flow.md` 尚未被正確整合。
3. **打卡違規嚴重**：8/20 筆 worklog 為 "started" 未收工（40% 未結案率）。

---

## B. 重做根因分析

### 版本時間軸

| 版本 | 時間 (UTC) | 觸發原因 | 耗時 (s) | 可避免？ | 說明 |
|------|-----------|----------|---------|---------|------|
| v1 | 04-13 07:55 ~ 09:30 | 初版教材生成（AI training for beginners） | ~190 | N/A | 初始需求，非 Workshop 主題 |
| v2 全流程 | 04-15 02:52 ~ 03:07 | Workshop 重做：完整四步流程 | 898 | No | 主題變更，需要全新流程 |
| v2 品牌視覺重做 | 04-15 08:04 ~ 10:13 | 品牌色不對，需以 AI Expo DM 為範本 | ~7700 (含多段) | **Yes** | 若 visual_styling 前有「品牌資產確認」步驟，可在第一輪就正確 |
| v2.1 排版修正 | 04-15 10:29 ~ 10:48 | 排版語義層級不符規範 | 1182 | **Yes** | 排版規則（企業色+粗體 > 企業色 > 黑粗 > 灰）應在 visual_styling 階段就套入 |
| v2.2 Ch0 新增 | 04-15 12:46 ~ 12:56 | 用戶要求新增 Ch0「開始之前」5 頁 | ~517 | No | 新需求，但缺一致性檢查 |
| v2.3 Ch0 擴展 | 04-15 12:48 ~ 13:05 | Ch0 擴展至 7 頁（加 Director/Officer） | 1049+555 | **Partial** | Officer 概念搞錯，導致 v2.4 |
| v2.4 Officer 修正 | 04-15 13:09 ~ 13:14 | Officer 誤解為「帶執照的審核者」需修正為 CXO | 262+315 | **Yes** | 若 Research 步驟有確認 Agent 階層概念，不會搞錯 |

### 可避免重做統計

- **v2 品牌重做**：可避免。缺少「品牌資產前置確認」步驟。
- **v2.1 排版修正**：可避免。排版規則已存在於 memory（feedback_typography_emphasis.md），但 visual_styling 未讀取。
- **v2.4 Officer 修正**：可避免。若 Ch0 新增時有走 Research 步驟（讀取 org.md 確認 Agent 階層定義），不會把 Officer 誤解為「帶執照的審核者」。

**可避免重做佔比**：5 輪重做中 3 輪可避免（60%）。

### 累計成本估算

基於 worklog 數據，04-15 當天 Edu Team 總計產生：
- Manager worklogs：12 筆
- doc-generator worklogs：26 筆
- visual-stylist worklogs：6 筆
- content-designer worklogs：3 筆
- content-evaluator worklogs：3 筆
- edu-researcher worklogs：2 筆
- qa-reviewer worklogs：3 筆

**共 55 筆 agent dispatch**。其中可避免的重做（品牌重做 + 排版修正 + Officer 修正）涉及約 20 筆 dispatch（~36%），估計浪費 ~4,000 秒 agent 執行時間。

---

## C. 知識品質問題

### C1. Officer 概念搞錯

- **問題**：Ch0 P6 將 Officer 描述為「帶執照的審核者」而非組織學中的 CXO（CEO/CTO/CFO 等最高決策層）。
- **追因**：**Research 步驟缺失**。Ch0 新增時，Manager 直接派 doc-generator 生成，跳過了 Research 和 Design 步驟。若有走 Research，edu-researcher 會讀取 `agents/` 樹狀結構中的 org.md 和 soul.md，其中明確定義了 Agent 階層（Officer > Director > Manager > Worker）。
- **根因歸屬**：70% workflow 違規（跳過 Research）+ 30% workflow 設計缺陷（無「增量變更也要 Research」的規則）。

### C2. 品牌風格錯誤

- **問題**：v2 的品牌色不符快組隊企業風格，需要以 AI Expo DM 為範本重做。
- **追因**：**Visual Styling 的 input 缺失**。visual-stylist 沒有收到品牌範本（如 DM 檔案、brand-colors-guide.md），只能自行推測配色。
- **根因歸屬**：50% workflow 設計缺陷（visual_styling 步驟的 input 定義未要求「品牌資產路徑」為必填欄位）+ 50% Manager parse_request 缺失（未在需求解析階段確認品牌資產來源）。

### C3. 排版語義層級錯誤

- **問題**：文字強調層級不符「企業色+粗體 > 企業色 > 黑色粗體 > 灰色」規範。
- **追因**：排版規範已存在於 Edu Manager 的 memory（`feedback_typography_emphasis.md`），但在 visual_styling dispatch 時未將此 memory 作為 input 傳遞給 visual-stylist。
- **根因歸屬**：Manager dispatch 缺失（未帶入已知的 styling memory）。

---

## D. 一致性缺口清單

以下為 Ch0（7 頁）加入後，Ch1-Ch6 及周邊文件中需要同步修改但未處理的項目：

| # | 缺口類型 | 具體位置 | 問題描述 | 嚴重性 |
|---|---------|---------|---------|--------|
| D1 | **內容重疊** | Ch0 P3「5 檔結構」vs Ch2 整章 | Ch0 P3 介紹 agent.yaml/soul.md/org.md/tools.md/workflow.yaml 五檔結構，與 Ch2（原本就是「五檔解剖」主題）大幅重疊。學員會在 Ch0 先看到概述，到 Ch2 再看一次詳細版，但兩處的描述角度和深度未做差異化設計。 | High |
| D2 | **內容重疊** | Ch0 P5「Manager + Worker」vs Ch1 | Ch0 P5 介紹 Manager/Worker 分工模式，與 Ch1（原本就是「Manager-Worker 架構」主題）重疊。未設計「Ch0 = 預覽 / Ch1 = 深入」的遞進關係。 | High |
| D3 | **頁碼偏移** | 原 Ch1 P1 -> 現在 P8 | Ch0 加入 7 頁後，原始 Ch1-Ch6 的頁碼全部後移 7 頁。PPTX 內的跨頁引用（如「見第 X 頁」）是否全面更新未經驗證。 | Medium |
| D4 | **XLSX 缺 Ch0** | Timing_Control.xlsx Sheet1 | QA Report 顯示 XLSX 3 個 Sheet 的結構基於 Ch1-Ch6。Ch0 加入後，Master Timeline 未新增 Ch0 的時段分配（安裝環境 + 五檔概覽應需 15-20 分鐘）。 | High |
| D5 | **Instructor Guide 缺 Ch0** | Instructor_Guide.docx | QA Report 確認 Guide 含 Ch1-Ch6 + 附錄共 7 部分。Ch0 加入後，Guide 未新增 Ch0 的講師腳本、Timing Cue、開場引導語。 | High |
| D6 | **Workbook 部分更新** | Participant_Workbook.docx | v2.2 版 Workbook 已新增 Ch0 區塊（環境檢核 / 5檔3紀律 / 四階層分工），但 Workbook 目錄結構是否含 Ch0 索引未驗證。 | Low |
| D7 | **QA Report 過時** | deliverables/QA_Report.md | QA Report 基於 v1 版本（46 頁 PPTX），Ch0 加入後變為 53 頁，但 QA Report 未重跑。現存 QA Report 的 PASS 判定不適用於 v2.4 版本。 | High |
| D8 | **章首頁編號** | PPTX Ch1-Ch6 章首頁 | 原 QA Report 記錄章首頁為 P4/P10/P17/P25/P32/P37。加入 Ch0 後應為 P11/P17/P24/P32/P39/P44，但未驗證是否有章節標號更新。 | Medium |

---

## E. Workflow 設計缺陷

### E1. 缺少「增量變更一致性檢查」步驟

**現狀**：workflow.yaml 的步驟設計假設每次執行都是「全新教材生成」（從 parse_request 到 deliver 的完整流程）。當用戶要求「新增一個章節」或「修改某頁內容」時，workflow 沒有定義增量變更的處理路徑。

**後果**：Manager 面對增量需求時，只能自行決定跳過哪些步驟。在本案中，Manager 選擇跳過 Research / Design / Evaluate / QA，直接 dispatch doc-generator，導致知識錯誤（Officer）和一致性破壞（Ch0 vs Ch1-Ch6 重疊）。

**建議**：在 workflow.yaml 中新增 `incremental_change` 路徑：
```yaml
- id: consistency_check
  action: inline
  trigger: when_chapters_added_or_removed
  note: "檢查新章節 vs 現有章節的內容重疊、頁碼偏移、周邊文件同步"
```

### E2. 缺少「品牌資產確認」步驟

**現狀**：visual_styling 步驟的 input 定義中沒有要求「品牌資產路徑」為必填。Manager 可以在不提供任何品牌範本的情況下派出 visual-stylist。

**後果**：visual-stylist 只能自行猜測配色，導致品牌色不符而需要重做（v2 -> v2 品牌重做）。

**建議**：在 visual_styling 之前新增品牌確認步驟，或在 parse_request 中新增 `brand_assets` 欄位：
```yaml
- id: brand_asset_check
  action: inline
  note: "確認品牌資產（色彩指南、logo、範本）可用，否則向用戶索取"
```

### E3. 缺少「用戶概念確認」步驟

**現狀**：Research 步驟產出後，Manager 直接派 Design，沒有中間步驟讓 Manager 確認自己理解的關鍵概念是否正確。

**後果**：Officer 概念被 Manager 或 doc-generator 誤解為「帶執照的審核者」，在生成階段才被發現。

**建議**：在 Research 之後、Design 之前新增概念確認：
```yaml
- id: concept_validation
  action: inline
  note: "Manager 列出本次教材的關鍵概念清單，交叉比對 research 產出，有疑義時向用戶確認"
```

### E4. 缺少「增量變更也要走 Evaluate」的強制規則

**現狀**：evaluator-rerun.md 規則只要求「REVISE 後必須重跑 evaluator」，但沒有規定「新增章節後必須重跑 evaluator」。

**後果**：Ch0 加入後，Manager 認為「只是新增」不需要 evaluate，但新增的內容可能與既有內容衝突。

### E5. session_init 從未被執行

**現狀**：edu-flow.md 定義了 session_init（建立 session 目錄），但 workflow.yaml 的 steps 列表中沒有 session_init 步驟。

**後果**：所有 worker 的中間產出沒有統一的 session 目錄，無法追溯每個版本的完整決策鏈。

---

## F. 改善建議

### F1. [P0] 新增「增量變更一致性檢查」步驟

- **問題**：新增/刪除章節時無一致性檢查，導致內容重疊和周邊文件脫節
- **建議改法**：在 workflow.yaml 新增 `consistency_check` 步驟，定義為：(1) 新章節 vs 現有章節的內容重疊掃描，(2) 頁碼偏移重編，(3) XLSX/DOCX/Guide 同步更新清單
- **影響的 workflow 步驟 / 檔案**：`workflow.yaml`（新增步驟）、`workflow/edu-flow.md`（新增 handshake 定義）
- **優先度**：P0（必修）-- 這是本案所有重做的結構性根因

### F2. [P0] 新增「品牌資產前置確認」步驟

- **問題**：visual-stylist 未收到品牌範本，導致整套教材配色重做
- **建議改法**：在 parse_request 中新增 `brand_assets` 欄位（品牌色彩指南路徑、logo 路徑、參考範本路徑），若為空則 Manager 必須向用戶索取或使用預設品牌指南
- **影響的 workflow 步驟 / 檔案**：`workflow/edu-flow.md#parse_request`（新增欄位）、`workflow/edu-flow.md#visual_styling`（input 新增必填欄位）
- **優先度**：P0（必修）-- 品牌重做是本案最大的時間浪費

### F3. [P0] 強制增量變更走完整 Evaluate + QA

- **問題**：增量修改時跳過 Evaluate 和 QA，品質無保障
- **建議改法**：在 edu-flow.md 明確規定：「任何修改（含增量新增、頁面修正）完成後，必須重新執行 evaluate_content（可限縮為變更範圍）和 qa_review」。在 workflow.yaml 的 evaluate_content 步驟加入 `skip_if: never`
- **影響的 workflow 步驟 / 檔案**：`workflow.yaml#evaluate_content`、`workflow.yaml#qa_review`、`workflow/edu-flow.md`
- **優先度**：P0（必修）-- Officer 錯誤和一致性問題都因跳過 Evaluate 而未被攔截

### F4. [P1] 修復 log_end 打卡合規問題

- **問題**：40% 的 worklog 未收工（8/20 筆 "started" 未結案），違反「打卡是天條」
- **建議改法**：(1) 在 workflow.yaml 的 log_end 步驟加入 `on_error: report_and_stop`（不允許 continue），(2) 在 verification-protocol.md 新增 Check 7：Manager 自身 worklog 必須在 deliver 前結案
- **影響的 workflow 步驟 / 檔案**：`workflow.yaml#log_end`、`agents/agent-ops/_protocols/verification-protocol.md`
- **優先度**：P1（建議）-- 打卡缺失影響追溯能力但不直接影響產出品質

### F5. [P1] 將 session_init 從 edu-flow.md 提升到 workflow.yaml

- **問題**：session_init 只定義在 edu-flow.md 但未出現在 workflow.yaml 的 steps 列表中，導致從未執行
- **建議改法**：在 workflow.yaml 的 `log_start` 之後、`parse_request` 之前新增 `session_init` 步驟
- **影響的 workflow 步驟 / 檔案**：`workflow.yaml`（新增步驟）
- **優先度**：P1（建議）-- session 目錄是 worker 間檔案傳遞的關鍵基礎設施

### F6. [P1] 新增「概念交叉驗證」步驟

- **問題**：Manager 或 Worker 對關鍵概念的理解可能有誤（如 Officer = CXO），但沒有驗證機制
- **建議改法**：在 Research 之後新增 `concept_validation` 步驟，Manager 列出關鍵概念 -> 比對 research 產出 -> 有歧義時向用戶確認
- **影響的 workflow 步驟 / 檔案**：`workflow.yaml`（新增步驟）、`workflow/edu-flow.md`（新增 handshake）
- **優先度**：P1（建議）-- 可避免概念錯誤在下游放大

### F7. [P2] feedback_detect 步驟整合

- **問題**：feedback_detect 在所有 6 輪執行中均為 SKIP，疑似未正確整合
- **建議改法**：驗證 `agents/agent-ops/_protocols/workflows/feedback-detect-flow.md` 是否可正常載入；若此步驟目前非必要，應從 workflow.yaml 移除以減少混淆
- **影響的 workflow 步驟 / 檔案**：`workflow.yaml#feedback_detect`
- **優先度**：P2（加分）-- 不影響核心流程，但死步驟會降低 workflow 可讀性

### F8. [P2] 增量變更的 Memory 讀取機制

- **問題**：Manager 的 memory 中已有排版規範（feedback_typography_emphasis.md），但 dispatch visual-stylist 時未帶入
- **建議改法**：在 visual_styling 的 input 定義中新增 `style_memory` 欄位，Manager 在 dispatch 前自動掃描 memory/ 目錄中的 styling 相關檔案
- **影響的 workflow 步驟 / 檔案**：`workflow/edu-flow.md#visual_styling`
- **優先度**：P2（加分）-- 可減少重複犯錯

---

## Worklog

- **開工**：`T:\共用雲端硬碟\快組隊.Agents\AgentOrg\agents\agent-ops\evolution\worklog\2026-04-16_01-07-18-283_agent-ops-evolution.json`
- **分析範圍**：
  - Edu Manager worklogs：20 筆（04-13: 6 筆、04-15: 12 筆、04-16: 2 筆）
  - Edu Worker worklogs：43 筆（doc-generator 26、visual-stylist 6、content-designer 3、content-evaluator 3、edu-researcher 2、qa-reviewer 3）
  - Deliverables：25 個檔案（含 .bak 和 _merge_work）
- **關鍵文件已讀**：
  - `agents/edu/manager/workflow.yaml`
  - `agents/edu/manager/workflow/edu-flow.md`
  - `agents/edu/manager/soul.md`
  - `agents/edu/manager/org.md`
  - `agents/agent-ops/_protocols/verification-protocol.md`
