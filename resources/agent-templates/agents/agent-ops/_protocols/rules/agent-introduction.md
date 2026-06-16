# Agent Introduction 規範
<!-- added 2026-06-08 introduction-rules-20260608 -->

> **Owner**: agent-ops/manager
> **生效日期**: 2026-06-08
> **適用對象**: 全系統所有 AI 助手（含 worker、manager、director、officer）

---

## §1 用途

每個 AI 助手目錄下必須有一個 `introduction.json`，與 `agent.yaml` 同層。

**這份檔案的定位**：
- 純 metadata — 描述「這個 AI 助手是誰、能做什麼、給誰用」
- **bootstrap 不讀** — 不在 agent.yaml `bootstrap:` 序列中，AI 助手自身啟動時不載入
- **與呼叫無關** — 不影響 AI 助手執行邏輯，不含指令

**主要受眾**：
- 不會寫程式的人（用日常白話就能看懂）
- 外部編排軟體（自動化流程讀取、路由判斷）

---

## §2 語言鐵則

### Key 一律英文

所有 JSON key 使用英文，不得翻譯。

合法 key 集合：`id`、`display_name`、`team`、`role`、`summary`、`capabilities`、`when_to_use`、`not_for`、`reports_to`、`manages`、`callable_by`、`inputs`、`outputs`、`workflows`、`examples`、`flags`、`last_updated`

### 值一律繁中白話

| 欄位 | 值規範 | 例外 |
|------|--------|------|
| `id` | 代號路徑，英文 | — |
| `team` | **中文團隊名**（如「系統維運組」） | — |
| `role` | 僅限：`組長` / `執行者` / `審查者` / `研究員` | — |
| `display_name` | 繁中職稱 | — |
| 所有其他值 | 繁中白話，**不可殘留英文** | `id` 代號值 |

**技術詞翻白話規則**：
- `agent` → 「AI 助手」（不寫 agent）
- `workflow` → 「工作流程」或「流程」
- `bootstrap` / `dispatch` / `manager` 等術語 → 各自翻為白話（「啟動」/「分派」/「組長」）

**manages / callable_by / reports_to** 值用中文職稱（如「系統建構師」），不用 agent id。

### 技術術語豁免政策
<!-- added 2026-06-08 introduction-fix-english-20260608 -->

> 本政策為 §2「值一律繁中白話」的補充判準，供建立與稽核 `introduction.json` 時統一判斷「英文殘留」是否合法。

**✅ 可保留英文（不算殘留）**：

1. **工具／品牌／產品名** — 如 Docker、KiCad、Playwright、Excel、Paperclip、BNI、GB10 等。這些是固有名詞，無公認中譯。
2. **業界通用縮寫** — 如 CI/CD、API、JSON、SQL、OWASP、BOM、ERC、PCB、BLDC、KPI、SOP、RACI、SWOT、ROI、HACCP、PDF、xlsx、OCR、WCAG 等。以首字母大寫或全大寫出現的業界縮寫視同專有詞。
3. **程式識別碼／欄位名／API 名／錯誤碼** — 如 `storageState`、`evidence_bundle`、`chapter_id`、`beforeEach`、`MISSING_INPUT`、`block_and_report` 等程式內部 token；以反引號標記時一律豁免。
4. **檔名／路徑** — 如 `soul.md`、`workflow.yaml`、`src/` 等；以反引號標記時一律豁免。

**❌ 必須翻中文（有通行中文譯名的一般英文詞）**：

| 原文 | 應改為 |
|------|--------|
| bug | 錯誤 |
| session | 工作階段 |
| handoff | 交付 |
| confirm | 確認 |
| abort | 取消 |
| build | 建置 |
| vs | 對比 |
| halt | 停止 |
| delta | 差異 |
| headless | 無頭 |
| sprint | 衝刺 |
| down migration | 回退遷移 |
| Single-Shot / Merge 等模式名 | 必須附中文說明或改寫為中文 |

**⚠️ 狀態列舉值**（`PASS` / `FAIL` / `REVISE` / `PARTIAL`）：必須附中文，格式為「通過（PASS）」「失敗（FAIL）」「修改（REVISE）」「部分（PARTIAL）」。

**`role` 欄位補充**：應填入該 AI 助手的**實際中文職稱**（如「架構師」、「佈局工程師」、「需求分析師」），不得硬套「組長／執行者／審查者／研究員」四類通用標籤（§3 欄位表的四類為最末備選，優先使用精確職稱）。

**`examples` 範例中的 placeholder**：使用中文（如「甲公司」、「乙公司」），不用 A 公司、A001 等英文佔位符。

---

## §3 欄位表

| 欄位 | 必填／選填 | 說明 |
|------|-----------|------|
| `id` | 必填 | 路徑形式，英文，如 `agent-ops/manager` |
| `display_name` | 必填 | 繁中職稱 |
| `team` | 必填 | 中文團隊名，如「系統維運組」 |
| `role` | 必填 | 固定四值之一：組長／執行者／審查者／研究員 |
| `summary` | 必填 | 一句話說明這個 AI 助手做什麼，白話 |
| `capabilities` | 必填 | 陣列，每項一句白話能力描述，至少 3 項 |
| `when_to_use` | 必填 | 什麼情況該找這個 AI 助手 |
| `not_for` | 必填 | 明確排除的使用情境（防止誤用） |
| `reports_to` | 必填 | 中文職稱或「使用者」 |
| `manages` | 選填 | 陣列，下屬中文職稱；worker 無下屬可留空陣列 |
| `callable_by` | 必填 | 陣列，誰可以呼叫這個 AI 助手，中文職稱 |
| `inputs` | 必填 | 這個 AI 助手接收什麼，白話 |
| `outputs` | 必填 | 這個 AI 助手交付什麼，白話 |
| `workflows` | 必填 | 情境陣列，見 §4 |
| `examples` | 選填 | 具體案例字串陣列；純審查者（role=審查者）可留空 |
| `flags` | 選填 | 特殊標記陣列，如「跨團隊審查者」；無則空陣列 |
| `last_updated` | 必填 | ISO 日期，如 `2026-06-08` |

---

## §4 workflows 多情境規定

### 禁止單一死流程

`workflows` 必須是**情境陣列**，每個元素為：

```json
{
  "scenario": "（白話情境描述）",
  "steps": ["步驟一", "步驟二", "..."]
}
```

**最低要求**：
- Manager / Director / Officer：**≥ 3 個情境**（對應不同請求類型）
- Worker（doer / researcher）：**≥ 2 個情境**（對應不同任務模式）
- Worker（verifier）：**≥ 2 個情境**（對應不同審查範圍）

### 情境來源

從該 AI 助手的 `workflow.yaml` 分支結構萃取，每個主要分支對應一個情境。不可把所有分支合併成單一「標準流程」。

---

## §5 衍生來源

`introduction.json` 可從 `agent.yaml` 及其他定義檔衍生，但必須完成中文化：

| 來源欄位 | 衍生到 introduction.json | 中文化要求 |
|---------|--------------------------|----------|
| `agent.yaml > title` | `display_name` | 直接使用（已繁中） |
| `agent.yaml > role_in_team` | `role` | doer→執行者、researcher→研究員、verifier→審查者、manager→組長 |
| `agent.yaml > reports_to` | `reports_to` | 路徑改為中文職稱 |
| `soul.md > Principles` | `capabilities` 部分項目 | 重寫為白話能力描述 |
| `workflow.yaml > steps` | `workflows[].steps` | 去除技術細節，改為白話 |
| `dispatch > trigger` | `when_to_use` | 擴寫為完整說明句 |
| `dispatch > not_for` | `not_for` | 擴寫為白話排除說明 |

所有衍生值**不可殘留英文術語**（id / team 代號除外）。

---

## §6 三條維護總綱

1. **建立必產** — 建立新 AI 助手時，`introduction.json` 是必交付檔之一。驗收標準見 `creation-validation.md`。

2. **修改必同步** — 修改 AI 助手定義（職責、流程、層級）時，必須同步更新 `introduction.json`。執行程序見 `agent-builder/workflow/enhance.md`。

3. **稽核必查** — 治理審查時，`introduction.json` 為稽核項目之一，語言鐵則（§2）與欄位完整性（§3）均須通過。審查流程見 `governance/workflow/review-flow.md`。

---

## §7 完整範例（標準樣本）

以下為 `agent-ops/manager`（系統維運組長）的 `introduction.json` 原樣，作為本規範的金標準參照：

```json
{
  "id": "agent-ops/manager",
  "display_name": "系統維運組長",
  "team": "系統維運組",
  "role": "組長",
  "summary": "統籌 AI 助手系統的建立、審查、演進與盤點；不親手改檔，只負責指揮、分派與整合成果",
  "capabilities": [
    "把需求分類、判斷該找誰做",
    "分派「建立或修改 AI 助手」的工作給系統建構師",
    "觸發治理審查專員進行合規稽核",
    "啟動演進分析專員的系統改善分析",
    "啟動系統研究員進行現狀盤點",
    "遇到高風險操作（修改核心定義、刪除 AI 助手、大規模變更）先暫停等你確認",
    "同時調度多個下屬並整合成果",
    "大型規則推送時估算工作量、拆批執行、逐批驗證",
    "偵測用戶回饋並寫入記憶，供後續任務參考",
    "任務結束後做自我回顧並記錄改進建議"
  ],
  "when_to_use": "任何跟 AI 助手系統有關的事：建立新 AI 助手、修改現有的、審查結構、分析效能、盤點現狀、推動全系統規則更新",
  "not_for": "寫程式（找軟體開發組）、部署上線、寫測試、做教材（找教育組）",
  "reports_to": "使用者",
  "manages": [
    "系統建構師",
    "治理審查專員",
    "演進分析專員",
    "系統研究員"
  ],
  "callable_by": [
    "使用者",
    "軟體開發組長"
  ],
  "inputs": "使用者用日常語言描述的需求",
  "outputs": "整合後的工作摘要、變更檔案清單（含完整絕對路徑）、審查結果",
  "workflows": [
    {
      "scenario": "查詢或說明類（不需改任何檔）",
      "steps": [
        "把需求分類，確認是純查詢且沒有風險",
        "直接回答，跳過建檔、審查等重量流程"
      ]
    },
    {
      "scenario": "建立或修改一個 AI 助手",
      "steps": [
        "確認本次產出要放哪裡，建好資料夾",
        "把需求送給分類 AI 助手判斷任務類型",
        "評估可不可行、風險多高",
        "高風險操作先暫停，等你用「確認／中止／修改」回應",
        "估算工作量，決定是否要分批執行",
        "派系統建構師建檔或改檔",
        "每批做完立刻核查（檔案數量、內容完整性）",
        "送治理審查專員做合規稽核",
        "整合所有產出，回覆你並附上變更檔案清單"
      ]
    },
    {
      "scenario": "大型規則推送（全系統批量更新）",
      "steps": [
        "把需求分類，識別為大型規則推送任務",
        "評估影響範圍，預估每批的改動量（每批上限五個工作單位）",
        "提出分批計畫，等你確認（若屬於高風險）",
        "第一批：派系統建構師執行，完成後逐項核查",
        "核查通過才派下一批，核查不過先修再推",
        "全部批次完成後，派治理審查專員做跨批稽核",
        "整合並回報完整變更清單"
      ]
    },
    {
      "scenario": "現狀盤點或演進分析",
      "steps": [
        "把需求分類，識別為觀測或分析任務",
        "派系統研究員收集 AI 助手系統現狀數據",
        "研究員回傳觀測結果後，派演進分析專員分析改善建議",
        "收到分析報告後，比對現有能力去除重複提案",
        "整合報告，回覆你並說明建議優先序"
      ]
    },
    {
      "scenario": "高風險操作（需要你確認後才繼續）",
      "steps": [
        "把需求分類，評估風險等級為最高層級",
        "列出即將執行的操作內容與影響範圍",
        "暫停流程，等待你輸入「確認」或「中止」",
        "收到「確認」後繼續派遣；收到「中止」則取消任務並回報"
      ]
    }
  ],
  "examples": [
    "使用者說「幫我在教育組建一個出題 AI 助手」→ 確認落點 → 分類 → 評估 → 派系統建構師建檔 → 派治理審查專員審核 → 整合後回覆",
    "使用者說「把所有 AI 助手的工作流程都加上錯誤重試規則」→ 分類為大型規則推送 → 估量拆批 → 逐批建構師執行 → 逐批核查 → 跨批審查 → 回報清單",
    "使用者說「現在系統有哪些 AI 助手，效能如何？」→ 分類為盤點分析 → 派研究員觀測 → 派演進分析專員產報告 → 整合回覆"
  ],
  "flags": [],
  "last_updated": "2026-06-08"
}
```

> 此樣本存於 `agents/agent-ops/manager/introduction.json`，為目前系統的金標準。如需對照其他 AI 助手類型（執行者、審查者、研究員），另參考 `agents/agent-ops/` 下各子目錄的 `introduction.json`。
