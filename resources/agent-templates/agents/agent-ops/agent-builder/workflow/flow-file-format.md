# Flow 檔格式規範

> **適用範圍**：agent-ops 內部。由 Agent Builder 建立 flow 檔時遵守，由 Governance 審查時驗證。

## 什麼是 Flow 檔

Flow 檔是 workflow.yaml 中 `ref:` 欄位指向的 Markdown 檔案，定義某個步驟或某個操作模式的完整細節。

每個 flow 檔**必須有至少兩個 step**。只有一個 step 的不叫 flow。

---

## 格式 A — Step 定義型

**適用場景**：Manager/Orchestrator agent 的 workflow.yaml 每個 step 各有一個 `ref:`。
每個 flow 檔描述**一個 step** 的輸入、動作、輸出與錯誤處理。

### 模板

```markdown
### Step 1: {step_id}（{action_type}）

{此步驟的一句話說明}

**Actions:**
- {動作 1}
- {動作 2}

---

### Step 2: {step_id}（{action_type}）

{此步驟的一句話說明}

**{分析維度 | Input | 判斷邏輯}：**
- {維度/輸入 1}
- {維度/輸入 2}

**Output:** `{output_variable_name}`
```json
{
  "field1": "型別 — 說明",
  "field2": "型別 — 說明"
}
```
**on_error:** {continue | abort | report_and_continue}（說明為何選此策略）
```

### 規則
- 標題格式固定：`### Step N: step_id（action_type）`
- 步驟間用 `---` 分隔
- 每個 step 必須有 `**on_error:**`
- 有輸出的 step 必須有 `**Output:**` 與 JSON schema
- step_id 使用 snake_case，與 workflow.yaml 中的 `id:` 對應

---

## 格式 B — 程序指南型

**適用場景**：Worker agent 的 workflow.yaml 用 detect_mode + route，每個 mode 各有一個 `ref:`。
每個 flow 檔描述**整個 mode** 從頭到尾的所有子步驟。

### 模板

```markdown
# {操作名稱}工作流程

## Manager 輸入
```json
{
  "action": "{action_name}",
  "field1": "說明",
  "field2": "說明（選填）"
}
```

## 執行步驟

```
[1] {步驟名稱}
  {具體動作說明}
  │
  ▼
[2] {步驟名稱}
  {具體動作說明}
  若 {條件} → 停止，向 Manager 回報
  │
  ▼
...
  │
  ▼
回傳摘要給 Manager
```

## 安全規則（危險操作才需要此區塊）
- {規則 1}
- {規則 2}
```

### 規則
- 標題格式固定：`# {操作名稱}工作流程`
- 必須有 `## Manager 輸入` 與 JSON schema
- 步驟用 `[N]` 編號 + `│ ▼` 視覺串接
- 最後一步固定為回傳摘要給 Manager
- 有不可逆操作時必須加 `## 安全規則` 區塊

---

## 選哪種格式？

| 我的 agent 是... | 使用格式 |
|-----------------|---------|
| Manager/Orchestrator（多步 workflow，各 step 有 `ref:`）| 格式 A |
| Worker（detect_mode + route，各 mode 有 `ref:`）| 格式 B |

---

## 檔案命名慣例

| 格式 | 命名範例 |
|------|---------|
| 格式 A | `insight-flow.md`、`feasibility-flow.md`、`deliver-flow.md` |
| 格式 B | `create.md`、`enhance.md`、`delete.md`、`bulk-update.md` |

格式 A 用 `{step-name}-flow.md`；格式 B 用 `{mode-name}.md`。
