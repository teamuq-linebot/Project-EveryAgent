# Evolution Analyze Flow

## 輸入（來自 Manager 或排程觸發）

```json
{
  "action": "analyze",
  "scope": "full | targeted",
  "focus": "optional — specific agent or issue area",
  "trigger": "manual | scheduled"
}
```

## 完整分析流程

```
[1] 外部研究（WebSearch）
  搜尋以下主題（每次選擇 2-3 個最相關的）：
    - "multi-agent system architecture best practices 2025"
    - "LLM agent role design organizational patterns"
    - "AI agent workflow anti-patterns"
    - "organizational design theory multi-agent"
  記錄：關鍵框架、模式、原則，作為後續分析的外部基準
  On error → continue（缺少外部基準時降級為純內部分析）
  │
  ▼
[2] 抓取參考資料（WebFetch）
  從步驟 [1] 的結果中，選 1-2 篇最相關的文章進行 WebFetch：
    - 優先選：架構設計論文、組織學應用案例、multi-agent 評測報告
    - 每篇摘要核心洞察 3-5 點（不逐字引用）
    - 將洞察轉化為「可對照現有系統的評估標準」
  On error → continue
  │
  ▼
[3] 收集內部指標（執行記錄分析）
  從外部執行記錄（log，打卡機制已於 2026-05-28 移除，改由外部 log 處理）逐批讀取近期紀錄：
    - 提取：agent、status、duration、task 描述
    - 計算：失敗率、平均時長、異常時長（outliers）
    - 彙整成矩陣：agent × 指標

  <!-- added 2026-06-08: adopt-bp-rules-20260608 — pass^k 可靠度納入演進分析 -->
  [3.1] pass^k 可靠度分析（健康度量化維度）
    定義：pass^k = 連續 k 次獨立試驗全部成功的機率（穩定性下限）；
    區別於 pass@k（k 次中至少 1 次成功，衡量能力上限）。
    來源：Anthropic「Demystifying Evals for AI Agents」；τ-bench（arXiv:2406.12045）。
    回指差距：evolution memory「PDCA Check / Evaluation 閉環缺失」（resource_external_research_multiagent_2026-04-14.md 差距 6）。

    執行：
    - 從 worklog 取各 agent 近期試驗記錄，計算 pass^k（k 值依類型：對外交付 k=3，Manager k=3，核心 Worker k=3）
    - 對照門檻（見 `agent-slo.md §2.4`）：對外交付 ≥80%、Manager ≥85%、Worker ≥75%
    - 評判以**最終 outcome／交付物狀態**為準（outcome-based，見 `output-verification.md`）；不以 tool-call 路徑判定
    - 將 pass^k 結果加入 agent × 指標矩陣（與既有失敗率、耗時並列）

    升級規則（與 agent-slo.md §4 SLO 警戒串接，呼應 manager soul Principle 14「SLO 意識」）：
    - agent 連續低於其 pass^k 警戒值（連續 2 週）→ 列入步驟 [5] 演進 / 改進建議
    - 嚴重度等同靜默失敗警戒，直接觸發 Evolution 分析

  On error → continue（缺少執行記錄時降級為純內部結構分析）
  │
  ▼
[4] 識別模式和差距
  交叉分析內部指標 + 外部基準：
    - 按 agent / error type / 頻率分組失敗案例
    - 對照業界已知 anti-patterns
    - 以組織設計框架審視：分工是否合理、權責是否對稱
    - 找出「內部數據 + 外部標準」雙重確認的改善優先項
  Read agents/agent-ops/evolution/classification-principles.md
  On error → continue
  │
  ▼
[5] 提出改善提案（PARA 分類）
  為每個識別出的差距生成提案，包含：
    - 內部證據（執行記錄數據、失敗模式）
    - 外部依據（業界實踐、組織學原則）
    - 對照差距分析
    - 影響力排序：頻率 × 嚴重性 ÷ 修復難度
    - PARA 分類：Project（立即執行）| Area（持續關注）| Resource（參考）| Archive（暫緩）
  On error → continue
  │
  ▼
[6] 路由提案
  依提案類型決定建議路由，並回傳 dispatch_plan 給 Manager，由 Manager 分派：
    - Agent-level 改動（soul/tools/skills/workflow）→ 建議 Manager 分派給 **Agent Builder**
    - 政策或協定改動（memory/evolution protocol 等）→ 建議 Manager 分派給 **Governance**
    - 結構性改動（新 agent、team 重組）→ 建議 Manager 分派給 **Architect + Agent Builder**
  注意：Evolution 沒有 Agent tool，不直接派遣其他 agent。所有分派行為由 Manager 執行。
  產出：dispatch_plan（每個提案的建議路由目標與優先順序）
  On error → continue（無法路由時回報給 Manager 手動決定）

RETURN 分析報告 + dispatch_plan 給 Manager
```
