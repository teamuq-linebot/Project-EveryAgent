# Output Verification Protocol（後驗協議）

> 適用範圍：所有 Manager agent（agent-ops、edu、sw、bni）

## 核心規則

**每次 worker agent dispatch 完成後，Manager 必須執行 Post-Dispatch Verification，確認 agent 的宣稱與 filesystem 實際狀態一致，才能交棒下一步。Manager 不得單憑 agent 的文字回報判定成功。**

<!-- added 2026-06-08: adopt-bp-rules-20260608 — Outcome-based grading（落地 resource_external_research_multiagent_2026-04-14 PDCA Check / Evaluation 閉環缺失差距） -->
**Outcome-based grading（成果導向評判）**：驗證 agent 產出時，判定「合格/不合格」的主要標準是**最終 outcome／交付物的狀態是否符合目標**（例如：檔案存在且內容正確、資料庫狀態與標註目標吻合），而非 agent 走過的 tool-call 序列或執行路徑。
- ✅ 正面：以交付物最終狀態為主 gate（verify-flow、governance review、creation-validation 等所有「判定 agent 產出是否合格」的場景均適用）。
- ❌ 禁止：**不得把「tool-call 順序 / 步驟路徑完全符合預期」當作主要 pass 條件** — Anthropic 明確警告此做法會產生脆弱測試（brittle tests；見「Demystifying Evals for AI Agents」）；τ-bench（arXiv 2406.12045）亦以「比對最終資料庫狀態 vs 標註目標狀態」為標準範例。tool-call trace / trajectory 只作**補充稽核**，不作主 gate。
- 回指差距：`agents/agent-ops/evolution/memory/resource_external_research_multiagent_2026-04-14.md`「PDCA Check / Evaluation 閉環缺失」。

---

## 驗證流程（三步）

### Step 1 — 解析宣稱清單
從 agent 回報中提取所有宣稱的輸出：
- `files_created`: 宣稱新建的檔案路徑列表
- `files_modified`: 宣稱修改的檔案路徑列表
- `output_file`: 宣稱寫入 session_dir 的輸出檔
- 任何其他具體的「我完成了 X」宣稱

### Step 2 — Filesystem 對照檢查
針對每個宣稱執行以下其中一或多種檢查：

| 宣稱類型 | 驗證方法 |
|---------|---------|
| 檔案已建立 | `Glob` 確認路徑存在；`Read` 確認內容非空（size > 0，非佔位符） |
| 檔案已修改 | `Read` 或 `Grep` 確認新增的關鍵內容確實存在 |
| 目錄已建立 | `Glob` 確認目錄存在且非空 |
| 特定欄位已填寫 | `Grep` pattern 搜尋該欄位內容 |
| 記錄已更新 | `Grep` 確認新條目存在於目標檔案 |

### Step 3 — 路由決策

| 結果 | Manager 動作 |
|------|-------------|
| 全部驗證通過 | 交棒下一步 |
| 有 1+ 項不一致 | 記錄具體差異（「宣稱建立 X 但 Glob 找不到」），重派該 agent（最多 1 次），附具體修正說明 |
| 重派後仍不一致 | 停止流程，回報用戶，說明哪個 agent 無法完成宣稱工作 |

---

## 驗證模板（每個 Manager handoff 必須包含）

```
### Post-Dispatch Verification（Manager 自執行）

**驗證對象：** {worker_name} 的輸出宣稱

**驗證清單：**
- [ ] {宣稱1}：Glob `{path}` → 確認存在且非空
- [ ] {宣稱2}：Grep `{pattern}` in `{file}` → 確認關鍵內容存在
- [ ] worklog 存在：Glob `agents/{team}/{agent}/worklog/` → 確認最新 JSON

**不一致時：** 記錄差異，重派 {worker_name}（附具體差異說明），最多 1 次。
**兩次仍失敗：** 回報用戶，停止當前流程。
```

---

## 常見反模式（禁止）

- ❌ 看到 agent 說「我完成了」就直接放行，不做任何 filesystem 確認
- ❌ 只驗證 worklog 存在，不驗證實際產出檔案
- ❌ 因為「節省 token」跳過驗證
- ❌ 用 agent 的 output_summary 替代實際 Glob/Read 確認

---

## 豁免項目

以下輸出類型不需要 filesystem 驗證（只需確認 agent 有回應）：
- 純分析報告（只回傳 JSON 結論，無檔案產出）
- 分類/路由決策（plan_dispatch）
- 數學計算結果（agents/agent-ops/_shared/calculator）
