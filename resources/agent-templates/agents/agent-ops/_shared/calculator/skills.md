# Calculator Agent — Skills

### 1. Arithmetic Calculation（基本算術）
基本四則運算、百分比、比率計算。
- Outcome 1: 精確計算結果（含程式碼佐證）
- Outcome 2: 計算過程的結構化紀錄

When to dispatch: 任何需要加減乘除、百分比、比率的場景

### 2. Statistical Analysis（統計分析）
平均值、中位數、標準差、變異數等統計量計算。
- Outcome 1: 統計量結果（含程式碼）
- Outcome 2: 資料摘要（最大值、最小值、樣本數）

When to dispatch: 需要統計分析的場景

### 3. Date & Time Calculation（日期時間計算）
日期差、工作天計算、時區轉換。
- Outcome 1: 日期/時間計算結果
- Outcome 2: 計算邏輯說明

When to dispatch: 需要日期運算（如 worklog 工時統計、deadline 計算）

### 4. Unit Conversion（單位換算）
單位換算（長度、重量、溫度、貨幣等）。
- Outcome 1: 換算結果（含公式和程式碼）
- Outcome 2: 精確度說明

When to dispatch: 需要單位換算的場景

### 5. Financial Calculation（財務計算）
利率、折現、ROI、成本分析等財務計算。
- Outcome 1: 財務指標結果
- Outcome 2: 計算假設和公式說明

When to dispatch: 需要財務數值計算的場景

## NOT This Agent's Job

- 資料視覺化（圖表製作）→ **Visual Stylist** 或 **Doc Generator**
- 資料庫查詢 → **SW Developer**
- 機器學習模型訓練 → 超出系統範圍
- 不需要精確數字的文字描述 → 各 agent 自行處理

### Worklog Duration Statistics <!-- self-added 2026-05-16 from scheduled self-growth -->
計算 worklog JSON 集合的時長統計（平均、P50、P95、最長、最短），支援 by-agent / by-team 切片。
- Outcome 1: 統計結果（avg / P50 / P95 / max / min duration_seconds，含樣本數）
- Outcome 2: 失敗率（status=failed 或 status=abandoned 佔比）
- Outcome 3: Python 計算代碼（附計算過程供驗算）
When to dispatch: agent-ops/researcher 或 evolution 需要 worklog 時長分析時。
Reference: evolution skills「SLO Trend Detection」需要此計算。

### Token Budget Estimation <!-- self-added 2026-06-06 -->
budget-check: passed (51 lines → well under 150)
估算 LLM prompt 的 token 使用量（system prompt + tools schema + history + user message），協助 platform agents 在 model 切換 / context overflow 診斷時做精確預算。
- Outcome 1: 各 section 的 token 計數（tiktoken / anthropic token counter 結果）
- Outcome 2: 整體 token 佔用率（used / context_window × 100%）+ headroom
- Outcome 3: Python 計算代碼（含公式、假設、邊界條件說明）

When to dispatch: platform agent 需要精確 context budget 計算時；或 recipe-context 評估 hints + recipe + MOIM token 總和時。
Reference: Skill 5 Financial Calculation（cost 計算）；Skill 2 Statistical Analysis（批量 token 統計）。
