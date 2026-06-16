# Researcher Pattern Catalog（跨 team 通用）

> **建立日期：** 2026-05-01
> **來源：** 從原 `agents/agent-ops/_shared/researcher/memory/research-patterns-catalog.md` 拆出（方案 B）
> **適用 agent：**
> - `agents/agent-ops/researcher`
> - `agents/sw/researcher`
> - `agents/bni/researcher`
> - `agents/finance/researcher`
> - `agents/edu/edu-researcher`
> - `agents/sales/industry-researcher`

本檔為**所有 researcher 共識**的 pattern 基底。各 team researcher 應以此為起點，再依領域累積各自的 memory pattern。

## Query → Strategy → Output Mapping（通用層）

| 需求類型 | 策略 | 輸出格式 | 實例 |
|---|---|---|---|
| Risky-ops scan | grep 敏感 pattern 清單 + 人工複審 | list + severity | 2026-04-22_10-17-57 |
| Config audit | read 所有 config + diff 預期 baseline | table of deltas | 2026-04-22_10-18-12 |

### Pattern 1 — Risky-ops scan
- **觸發：** 需要在 codebase / agent system 內掃描高風險操作（force-push、rm -rf、未驗證 migration、權限放寬等）
- **策略：** 用 grep 搭配敏感 pattern 清單做廣面掃描，命中後人工複審 severity
- **輸出：** 風險清單 + severity 分級（HIGH / MEDIUM / LOW）
- **適用：** 所有 team 在 governance / pre-flight check 場景

### Pattern 2 — Config audit
- **觸發：** 需要驗證設定檔（agent.yaml / workflow.yaml / settings.json / 其他 config）是否偏離預期 baseline
- **策略：** Read 所有相關 config → diff 預期 baseline → 列出所有 delta
- **輸出：** Delta table（欄位：path、current、expected、severity）
- **適用：** 所有 team 在 evolution / governance / 例行體檢場景

## 通用規則（所有 researcher 適用）

- **追加原則：** 每次任務結束後，若觸發新 pattern → 追加到該 researcher 自己的 memory catalog（不要寫回此通用檔）
- **升格門檻：** 同 pattern 在同一 researcher 重複 ≥ 3 次 → 升格為該 researcher 的 `skills.md` 條目（從 memory 提升到 stable skill）
- **跨 team 提取：** 若多個 researcher 都收斂出同一 pattern，並各自升格成功，應由 agent-ops/manager 評估是否回灌此通用檔，擴充共識基底
