### Step 1: tier_classify（manager_self）

檢查 execute 步驟的輸出，對所有已變更的檔案進行 tier 分類。

**Tiers:**
| 類型 | 路徑 |
|------|------|
| auto_approve | `memory/*` |
| lightweight | `skills.md`、`tools.md` |
| full_review | `soul.md`、`workflow.yaml`、`definitions.md`、`protocols`、`SKILL.md`、`org.md` |

**Actions:**
- 讀取 execute 步驟的 `files_modified` 清單
- 將每個檔案對應到上方 Tiers 表
- 取所有檔案中最高的 tier 作為本次的 effective_review_tier

**on_error:** report_and_continue

---

### Step 2: parallel_dispatch（4 路並行審查）

以 effective_review_tier 決定是否需要完整審查。

**full_review tier → 4 路並行派發：**

同時派發 4 個 `agent-ops/governance` instance，各帶不同的 `review_scope`：

| Instance | review_scope | 審查重點 |
|----------|-------------|---------|
| G1 | `scope_guard` | File ownership, 越權修改 |
| G2 | `structure` | 必要檔案、必要 section 存在性 |
| G3 | `protocol` | memory 步驟格式、workflow.yaml 不得含打卡步驟、dispatch-protocol 完整性 |
| G4 | `consistency` | org.md 雙向對稱、registry 同步 |

Dispatch prompt 中每個 instance 的 input JSON 包含：
```json
{
  "action": "governance_review",
  "changes": "{changed_files}",
  "reason": "{reason}",
  "requestor": "{requestor}",
  "review_scope": "{scope}"
}
```

**lightweight / auto_approve tier → 單次 full dispatch（向後相容）：**

低風險變更仍用單次 dispatch，`review_scope: "full"`，節省 token。

---

### Step 3: merge_verdicts（Manager 合成最終判決）

收到 4 個 sub-report 後，Manager 合成為一個 verdict：

**合成規則：**
| 任一 sub-report | 最終 verdict |
|----------------|-------------|
| REJECT | REJECT（附上 REJECT 原因） |
| REQUEST_CHANGES | REQUEST_CHANGES（合併所有 required_actions） |
| 全部 APPROVE | APPROVE |

**合成格式：**
```
verdict: APPROVE | REQUEST_CHANGES | REJECT
sub_reports:
  scope_guard: {verdict, flags}
  structure: {verdict, flags}
  protocol: {verdict, flags}
  consistency: {verdict, flags}
scope_violations:    "合併自 G1"
structure_gaps:      "合併自 G2"
protocol_issues:     "合併自 G3"
consistency_issues:  "合併自 G4"
recommendations:     "合併所有建議"
```

**Routing:**
| Verdict | Action |
|---------|--------|
| `approve` | 繼續 verify 步驟 |
| `request_changes` | 將合併的 `required_actions` 回傳給 agent-builder 重新執行 |
| `reject` | 向用戶回報拒絕原因，停止流程 |

**on_error:** report_and_continue
