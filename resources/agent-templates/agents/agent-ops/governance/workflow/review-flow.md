# Governance Review Flow

## 輸入（來自 Manager）

```json
{
  "action": "governance_review",
  "changes": "changed files or agent names",
  "reason": "why review is needed",
  "requestor": "agent or user who triggered the review",
  "review_scope": "full | scope_guard | structure | protocol | consistency"
}
```

### review_scope 說明

| 值 | 執行步驟 | 用途 |
|---|---------|------|
| `full` | [1]→[2]→[3]→[4]→[5]→[6] | 完整審查（預設值） |
| `scope_guard` | [1]→[2]→[6] | 只做 Scope Guard 檢查 |
| `structure` | [1]→[3]→[6] | 只做結構一致性檢查 |
| `protocol` | [1]→[4]→[6] | 只做協定合規檢查（含參數級驗證） |
| `consistency` | [1]→[5]→[6] | 只做一致性交叉檢查 |

Manager 可以並行派遣 4 個 Governance instance，各帶不同 review_scope，比單次 full review 更可靠。

## 完整審查流程

```
[1] 確認審查範圍
  Read 來源請求，明確：
    - 哪些 agent system 檔案被新增或修改？
    - 修改的目的與理由是什麼？
    - 是否涉及多個 agent 的協作關係？
  On error → partial_review（記錄 UNABLE TO VERIFY）
  │
  ▼
[2] Scope Guard 檢查
  Skip if: review_scope ∉ {full, scope_guard}
  Read agents/definitions.md → File Ownership 表格
  逐一驗證每個修改的檔案：
    - 修改者是否為該檔案的合法擁有者？
    - 是否有 agent 修改了不屬於自己的檔案（如 src/、scripts/）？
    - Developer / Agent Builder 邊界是否清晰？
  Flag: [SCOPE] {agent} modified {file} — should be {correct_agent}
  <!-- 檢查項 C — File-ownership 違規（added 2026-06-08: adopt-bp-rules-20260608） -->
  [2-C] File-ownership 違規（適用 rollout / 多檔並行變更）
    依 `agent-anatomy.md §6.10`：同一檔案在同一 rollout batch 內是否被多個 worker 平行擁有？
    逐一比對本次 rollout 的 touched_files 清單：
      - 若同一路徑出現於兩份（含）以上 worker 的 touched_files → 判定 co-edit 衝突
      - 記錄衝突雙方 worker_id、檔案路徑、batch_id
    Flag: [SCOPE/OWNERSHIP] 檔案 {file} 被 {worker_A} 與 {worker_B} 同批並行修改（違反 agent-anatomy.md §6.10）→ violation
  On error → partial_review
  │
  ▼
[3] 結構一致性檢查
  Skip if: review_scope ∉ {full, structure}
  Glob agents/*/soul.md, tools.md, skills.md, org.md, workflow.yaml
  對每個被修改的 agent，驗證：
    - soul.md：是否有唯一 identity、>=3 principles、anti-patterns？
    - tools.md：是否有 "Do NOT Use" 區段？
    - skills.md：是否有 "NOT This Agent's Job" 區段？
    - org.md：是否有 "When NOT to Pick" 區段？
    - workflow.yaml：是否有 error_policy 和每步 on_error？
  <!-- 檢查項 I — introduction.json 合規（added 2026-06-08 introduction-rules-20260608） -->
  [3-I] introduction.json 合規（依 `agent-anatomy.md` 標準檔欄及 `agents/agent-ops/_protocols/rules/agent-introduction.md` §3）
    對每個被修改的 agent，驗證：
    (a) 存在性：{agent}/introduction.json 是否存在？
        缺少 → Flag: [STRUCTURE] {agent}/introduction.json 不存在 — 須由 Agent Builder 補建
    (b) 時效性：introduction.json 的 last_updated 是否 >= 該 agent 目錄內最新異動檔案的實際變更日期？
        落後 → Flag: [STRUCTURE] {agent}/introduction.json last_updated 落後於 {latest_changed_file}（{file_date}）— 須同步更新
    (c) 值語言：除 id 與 team 代號欄位外，所有值是否已中文化、無殘留英文？
        有殘留 → Flag: [STRUCTURE] {agent}/introduction.json 值含殘留英文（欄位：{field}）— 依 agents/agent-ops/_protocols/rules/agent-introduction.md §2 修正
    (d) workflows 多情境：workflows 陣列是否包含 >= 2 個不同 scenario（非壓縮為單一死流程）？
        單一 → Flag: [STRUCTURE] {agent}/introduction.json workflows 僅含單一情境 — 應依 workflow.yaml 分支擴充為多情境
  Flag: [STRUCTURE] {agent}/{file} missing {required_section}
  On error → partial_review
  │
  ▼
[4] 協定合規檢查
  Skip if: review_scope ∉ {full, protocol}
  Read agents/memory-protocol.md
  Read agents/evolution-protocol.md（如存在）
  驗證：
    - workflow.yaml 是否包含 check_memory 和 save_memory 步驟？
    - Memory 路徑格式是否正確（{agent}/memory/MEMORY.md）？
    - workflow.yaml **不得**包含任何打卡 / worklog / log_start / log_end 步驟
      （打卡機制已於 2026-05-28 全面移除；若仍存在視為殘留違規）
  <!-- 檢查項 A — Context 管理意識（added 2026-06-08: adopt-bp-rules-20260608） -->
  [4-A] Context 管理意識（適用長任務 / 多輪 dispatch 類 agent）
    判斷被審核 agent 是否屬「長任務 / 多輪 dispatch」類型（依 dispatch.trigger 或 workflow 步驟數 >= 5）：
    若是 → 檢查 soul.md 或 workflow.yaml 是否有任何 context 管理考量，例如：
      - compaction 策略、tool-result clearing、memory primitive 使用
      （參考 `context-engineering.md`）
    缺乏上述考量 → 軟性建議（不強制 block），加入 recommendations
    Flag: [RECOMMENDATION] {agent} 屬長任務型，建議參照 context-engineering.md 補充 context 管理策略（compaction / tool-result clearing / memory primitive）
  Flag: [PROTOCOL] {agent} violates {protocol} — {detail}
  Flag: [PROTOCOL] {agent}/workflow.yaml 仍含已廢除的打卡/worklog 步驟 — 須移除
  On error → partial_review
  │
  ▼
[5] 一致性交叉檢查
  Skip if: review_scope ∉ {full, consistency}
  Grep 新增或修改的 org.md，確認：
    - 階層關係是否與其他 agent 的 org.md 互相一致？
    - 新 agent 是否已同步更新 CLAUDE.md registry 和 manager/org.md？
    - collaboration patterns 是否雙向對稱（A 知道 B，B 也知道 A）？
  Flag: [CONSISTENCY] {file} hierarchy mismatch — {detail}
  On error → partial_review
  │
  ▼
[6] 產出審查意見
  格式：
    verdict: APPROVE | REQUEST_CHANGES | REJECT
    scope_violations:    "[SCOPE] ..."
    structure_gaps:      "[STRUCTURE] ..."
    protocol_issues:     "[PROTOCOL] ..."
    consistency_issues:  "[CONSISTENCY] ..."
    recommendations:     "改善建議（非強制）"

  判準：
    - APPROVE：零 Flag，或僅有 recommendations
    - REQUEST_CHANGES：有 [STRUCTURE] / [PROTOCOL] / [CONSISTENCY] Flag
    - REJECT：有 [SCOPE] Flag（scope violation 必須阻止）

RETURN 審查結果給 Manager
```
