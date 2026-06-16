# Dispatch Description Naming（派遣描述命名規則）

**生效日期**：2026-05-31  
**適用範圍**：所有 `type: manager` 的 agent（目前 11 個）  
**制定者**：agent-ops/agent-builder  

---

## 1. 核心規則

當 Manager 在 **Claude runtime** 使用 **Agent tool** 派遣 sub-agent 時，Agent tool 的 `description` 參數**必須**填入「被派遣 sub-agent 的 bare agent name」。

**Bare agent name** 定義：該 agent 的 `agent.yaml` 中 `agent:` 欄位的值。

### 正例 ✅
```json
{"agentType": "general-purpose", "description": "developer", "toolUseId": "toolu_…"}
{"agentType": "general-purpose", "description": "researcher", "toolUseId": "toolu_…"}
{"agentType": "general-purpose", "description": "calculator", "toolUseId": "toolu_…"}
{"agentType": "general-purpose", "description": "reviewer",   "toolUseId": "toolu_…"}
```

### 反例 ❌
```json
{"agentType": "general-purpose", "description": "研究收尾步驟盤點",    "toolUseId": "toolu_…"}
{"agentType": "general-purpose", "description": "agent-ops/researcher","toolUseId": "toolu_…"}
{"agentType": "general-purpose", "description": "執行 BOM 彙整任務",   "toolUseId": "toolu_…"}
```

---

## 2. Rationale（為什麼）

Claude runtime 的 Agent tool 一律以 `agentType: "general-purpose"` 呈現所有 AgentOrg 派遣。從工具呼叫紀錄 `{"agentType":"general-purpose","description":"...","toolUseId":"toolu_…"}` 無法分辨派的究竟是哪個 AgentOrg agent。

將 `description` 設為 sub-agent 的 bare name，可達成：
- **Log 可讀性**：每個 `toolUseId` 一眼對應到實際 agent，方便追蹤與除錯
- **UI 識別**：Claude Code UI 以 description 顯示 sub-task，使用 agent name 讓開發者即時掌握派遣狀況
- **Audit 支援**：governance / agent-sre 事後查閱 dispatch log 時，無需反查 prompt 才知道派了誰

---

## 3. 格式規範

| 規範項目 | 要求 |
|---------|------|
| 內容 | 純 bare name，即 `agent.yaml` 的 `agent:` 欄位值 |
| Team 前綴 | **禁止**（唯一例外見 §4 Edge Cases） |
| 任務描述 | **禁止**（description 不是 prompt 摘要） |
| 大小寫 | 小寫 kebab-case，與 `agent.yaml` 一致 |
| 長度 | 越短越好；agent name 通常 1–3 個英文詞 |

---

## 4. Edge Cases（邊界情況）

### 4.1 同 Team 內派遣自家 Worker
直接使用 bare name。同一 Manager 的 log 內，bare name 不會混淆。

```json
{"description": "schematic-engineer"}   // hw-design/manager 派遣
{"description": "billing-builder"}      // finance/manager 派遣
```

### 4.2 派遣共享服務
共享服務同樣使用 bare name。

```json
{"description": "calculator"}   // 任何 Manager 呼叫 agents/agent-ops/_shared/calculator
```

### 4.3 跨 Team 派遣另一個 Manager（唯一允許加前綴的情況）
依 `agents/agent-ops/_protocols/rules/hierarchical-dispatch.md` §Manager-to-Manager 直接派遣規則，當 Manager A 直接派遣 Manager B 時，bare name `manager` 在同一 log 中會多次出現並混淆。

此情況使用 **`{team}-manager`** 消歧：

```json
{"description": "sw-manager"}        // 派遣 sw/manager
{"description": "edu-manager"}       // 派遣 edu/manager
{"description": "agent-ops-manager"} // 派遣 agent-ops/manager
{"description": "finance-manager"}   // 派遣 finance/manager
```

> ⚠️ 這是**唯一允許加前綴**的情況。Worker 派遣一律不加前綴。

### 4.4 Team 路徑中含斜線的 Manager（如 platform/{team}）
取 `agent.yaml` 的 `agent:` 欄位值。若路徑為 `platform/gb10-sysadmin`，對應 `agent: gb10-sysadmin-manager`（或依 agent.yaml 實際 agent 欄位），則用 `gb10-sysadmin-manager`。規則：凡路徑含斜線，一律取 agent 欄位值，不拼接路徑。

---

## 5. 適用 Manager 清單（截至 2026-05-31）

| Team | Agent Path | bare name | 跨 team 消歧名 |
|------|-----------|-----------|---------------|
| sw | `agents/sw/manager` | `manager` | `sw-manager` |
| edu | `agents/edu/manager` | `manager` | `edu-manager` |
| sales | `agents/sales/manager` | `manager` | `sales-manager` |
| agent-ops | `agents/agent-ops/manager` | `manager` | `agent-ops-manager` |
| bni | `agents/bni/manager` | `manager` | `bni-manager` |
| finance | `agents/finance/manager` | `manager` | `finance-manager` |
| hw-design | `agents/hw-design/manager` | `manager` | `hw-design-manager` |
| 1997-factory | `agents/1997-factory/manager` | `manager` | `1997-factory-manager` |

---

## 6. Rollout 狀態

| 階段 | 內容 | 狀態 |
|------|------|------|
| R1（本規則） | 建立 canonical 規則檔 | ✅ 完成 2026-05-31 |
| R2（soul.md 更新） | 11 個 Manager soul.md 各加一條 Principle 引用本規則 | ✅ 完成 2026-05-31（11/11 manager，Governance GATE PASS） |

---

## 7. 與相關規則的關係

| 規則 | 關係 |
|------|------|
| `agents/agent-ops/_protocols/rules/hierarchical-dispatch.md` | 定義跨 Team Manager 派遣流程；本規則 §4.3 edge case 引用其「Manager-to-Manager 直接派遣」條款 |
| `agents/agent-ops/_protocols/rules/agent-anatomy.md` §6 | Manager 派遣行為的整體規範；本規則是其 `description` 欄位的具體實作要求 |
| `agents/agent-ops/_protocols/rules/agent-sre.md` | Log 可觀測性要求；本規則落實 dispatch log 中 agent 可識別性 |
