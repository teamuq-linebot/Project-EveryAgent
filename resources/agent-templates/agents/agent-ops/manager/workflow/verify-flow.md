### verify

確認 agent 系統一致性與正確性。

**Input:**
```json
{
  "agent_outputs": "所有 worker 的回報",
  "changed_files": "變更的檔案列表"
}
```

---

### Step 1: structure_check（manager_self）

驗證所有已變更或新建 agent 的必要檔案是否完整。

**Checklist（每個受影響的 agent）：**
- `agent.yaml` 存在
- `soul.md` 存在
- `tools.md` 存在
- `skills.md` 存在（若 agent.yaml 中有宣告）
- `workflow.yaml` 存在
- `org.md` 存在
- `memory/MEMORY.md` 存在

回報任何缺失的檔案。

**on_error:** continue

---

### Step 2: consistency_check（manager_self）

驗證跨檔案的路徑引用與組織一致性。

**Checklist:**
- 所有 workflow `ref:` 指標指向實際存在的 `workflow/*.md` 檔案
- `org.md` 中的跨 agent 引用與實際 agent 目錄一致
- 各 agent 的 `org.md` hierarchy 描述無衝突

回報任何不一致之處。

**Expected Output:**
```json
{
  "structure_check": "所有必要檔案存在 / 缺失清單",
  "consistency_check": "路徑引用正確性 / 不一致清單",
  "issues": []
}
```
**on_error:** continue
