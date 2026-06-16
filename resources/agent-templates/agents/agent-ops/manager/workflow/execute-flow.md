### Step 1: plan_dispatch（manager_self）

根據 `feasibility_result` 與任務類型，決定要派遣哪些 agent：

| 任務類型 | 派遣目標 |
|---------|---------|
| 建立/修改 agent 系統檔案 | agent-builder |
| 審查策略/合規/風險 | governance（通常在 execute 後的獨立 governance step 處理） |
| 分析演進/改善建議 | evolution |
| 需事實基底/現狀盤點 | agent-ops/researcher（on-demand） | <!-- added 2026-06-08 introduction-rules-20260608 -->
| 建立/修改 + 立即審查 | agent-builder → governance（串行） |
| 建立 + 同步分析現況 | agent-builder + evolution（並行） |

參照 `dispatch-protocol.md` 構建每個 agent 的派遣提示。

**on_error:** retry_once

---

### Step 2: dispatch（dispatch_rounds）

依 plan_dispatch 結果，按 `dispatch-protocol.md` 派遣。以下為各 agent 的 I/O 規格：

#### agent-builder
**Input:**
```json
{
  "goal": "任務目標",
  "target_files": "要建立/修改的檔案列表",
  "reference_agent": "參考哪個現有 agent 作為範本（如果建新 agent）",
  "change_spec": "精確的修改規格"
}
```
**Expected Output:**
```json
{
  "status": "completed | failed",
  "files_created": ["新建的檔案路徑"],
  "files_modified": ["修改的檔案路徑"],
  "summary": "變更摘要"
}
```

**Post-Dispatch Verification（Manager 自執行）：**
- `files_created` 列表：Glob 每個路徑，確認存在且非空
- `files_modified` 列表：Read/Grep 確認關鍵新增內容存在
- 遵循：`agents/agent-ops/_protocols/rules/output-verification.md`

#### governance
**Input:**
```json
{
  "changed_files": "agent-builder 修改的檔案列表",
  "change_description": "變更說明",
  "review_tier": "auto_approve | lightweight | full_review"
}
```
**Expected Output:**
```json
{
  "verdict": "approve | request_changes | reject",
  "findings": "審查發現列表",
  "required_actions": "需要修改的項目（如果 request_changes）"
}
```
**Routing:**
| verdict | 下一步 |
|---------|--------|
| approve | verify |
| request_changes | 重新派遣 agent-builder（帶入 required_actions） |
| reject | report_to_user |

#### evolution
**Input:**
```json
{
  "analysis_target": "要分析的對象（team name 或 system-wide）",
  "research_scope": "internal | external | both",
  "framework": "陳宗賢組織學六要素"
}
```
**Expected Output:**
```json
{
  "current_state": "現況分析",
  "external_research": "外部研究摘要",
  "gap_analysis": "差距分析",
  "proposals": "改善提案列表",
  "para_classification": "每個提案的 PARA 分類"
}
```

**Post-Dispatch Verification（Manager 自執行）：**
- `proposals` 非空：確認回傳 JSON 包含至少 1 條提案
- `gap_analysis` 有內容：非空字串
- 遵循：`agents/agent-ops/_protocols/rules/output-verification.md`

#### researcher <!-- added 2026-06-08 introduction-rules-20260608 -->
**Input:**
```json
{
  "observation_goal": "需要取得的事實或現狀描述",
  "scope": "agent 系統現狀盤點 | worklog 統計 | protocol 考古 | cross-agent 引用 | silent-failure 偵測",
  "output_format": "summary | structured_data"
}
```
**Expected Output:**
```json
{
  "status": "completed | failed",
  "findings": "觀測結果摘要",
  "evidence_paths": ["引用的檔案路徑或 worklog 條目"],
  "ready_for": "evolution | governance | manager_decision"
}
```

**on_error:** retry_once
