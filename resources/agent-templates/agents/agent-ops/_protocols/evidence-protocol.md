# Evidence Protocol（證據化產出協議）

> 版本：v1.0
> 建立日期：2026-04-24
> 作者：agent-ops/agent-builder（gap-analysis 階段 1 rule-rollout）

## Purpose

規範 **Doer agent**（實際動手改 code / config / infra 的 agent）每次任務收工時，除 `worklog/*.json` 外另產出 `evidence.yaml`，提供 Manager 進行事實稽核（fact audit）所需的客觀證據。

**核心宣告**：任何 agent 宣稱「已完成 / 已修改 / 已驗證 / 已測試」而無對應 evidence_bundle 者，一律視為未完工。Manager 必須標記為 BLOCKED 並要求補交。

## 適用 Agent

目前必須遵守：
- `sw/developer`

未來將逐步擴充至：
- `sw/tester`
- `sw/devops`
- 任何被 Manager 歸類為「Doer 角色」的新增 agent

## Evidence Bundle 必填欄位

每份 `evidence.yaml` 必須包含以下頂層 key：`trace_id`、`task_id`、`agent`、`started_at`、`ended_at`、`files_touched`、`ephemeral_artifacts`、`commands_run`、`assertions`、`unknowns`。

### trace_id
- 型別：string
- 來源：Manager dispatch 時給定
- 用途：跨 agent/cross-worklog 追蹤同一次用戶請求

### task_id
- 型別：string
- 來源：Manager dispatch 時給定（通常對應一個 workflow step 或 sub-task）
- 用途：區分同一 trace 下的多次 dispatch

### files_touched
- 型別：list of object
- 子欄位：
  - `path`：absolute path（禁止相對路徑）
  - `action`：`create` | `modify` | `delete`
  - `lines`：受影響行號範圍，如 `"L12-L45"`（action=create 時可為 `"L1-L<last>"`；delete 時可為 `"ALL"`）
  - `before_sha256`：修改前 hash（action=create 時為 null）
  - `after_sha256`：修改後 hash（action=delete 時為 null）
  - `diff_excerpt`：最多 20 行 git-style unified diff，超過請截斷並註明

### ephemeral_artifacts
- 型別：list of object
- 用途：worker 主動申報本任務建立的「一次性 scratch」——非生產碼、未 commit 進 repo 的驗證/測試/探查腳本（如 `verify_*` / `repro_*` / `rv_*` 等），供 Manager 的 `cleanup_ephemeral_artifacts` step 可靠歸屬「哪些 scratch 是本任務產生、可安全刪」
- **必填**：凡 worker 任務中建立、非生產碼、未 commit 的一次性腳本都**必須**列入；無則填空 list `[]`
  - ⚠️ **rollout 過渡期**：此欄缺漏暫不判 BLOCKED（視為 `[]` 並記 warning），詳見「失效條款 → ephemeral_artifacts rollout 過渡相容條款」
- 子欄位：
  - `path`：repo 相對或絕對路徑
  - `purpose`：一句話說明這檔幹嘛
  - `disposition`：`keep` | `delete_ok`——worker 建議（`keep`=可重跑/應保留；`delete_ok`=用完可刪）
  - `reason`：為何 `keep` 或 `delete_ok`
- YAML 範例：

```yaml
ephemeral_artifacts:   # worker 必填：申報本任務建立的一次性 scratch（非生產碼、未 commit 進 repo 的驗證/測試/探查腳本）
  - path: <repo 相對或絕對路徑>
    purpose: <一句話這檔幹嘛>
    disposition: keep | delete_ok    # worker 建議：keep=可重跑/應保留；delete_ok=用完可刪
    reason: <為何 keep 或 delete_ok>
# 規則：凡 worker 任務中建立、非生產碼、未 commit 的一次性腳本都「必須」列入；無則填 ephemeral_artifacts: []
# 用途：供 Manager 的 cleanup_ephemeral_artifacts step 可靠歸屬「哪些 scratch 是本任務產生、可安全刪」
```

### commands_run
- 型別：list of object
- 子欄位：
  - `cmd`：實際指令字串（含參數）
  - `cwd`：執行目錄（absolute path）
  - `exit_code`：整數
  - `stdout_excerpt`：≤ 30 行
  - `stderr_excerpt`：≤ 30 行
- 若任務未執行任何指令（純文件修改），此欄位可為空 list `[]`，但 assertions 中不得出現「已執行 / 已測試」類聲明

### assertions
- 型別：list of object
- 子欄位：
  - `claim`：agent 的客觀聲明（如「unit test 全綠」「Principle 9 已插入 soul.md」）
  - `evidence_ref`：指向 `files_touched[*]` 或 `commands_run[*]` 的索引 + 行範圍（如 `"commands_run[0].stdout_excerpt 行 5-8"`）
- **禁止只寫自然語言斷言而無 evidence_ref**

### unknowns
- 型別：list of object
- 子欄位：
  - `description`：未能驗證的項目描述
  - `reason`：為何無法驗證（缺環境 / 依賴外部服務 / 無測試涵蓋 / ...）
- **鼓勵誠實列出**：未知項 > 假裝完成

## 儲存位置

```
<agent_dir>/worklog/<timestamp>/evidence.yaml
```

與該次任務的 `worklog/*.json` 同目錄。`<timestamp>` 對齊 worklog 的時間戳（ISO8601 compact form，如 `2026-04-24_08-10-58-713`）。

## Cleanup Log Schema（Manager 收尾清理審計記錄）

Manager 在 `cleanup_ephemeral_artifacts` step 處理完各 worker 申報的 `ephemeral_artifacts` 後，**必須**將清理決策寫入 `task_context.cleanup_log`，作為事後 governance 機械稽核「刪了什麼、為何」的審計依據。

- 型別：list of object
- 每筆對應一個被評估的 ephemeral artifact
- 子欄位：
  - `path`：檔路徑
  - `decision`：`deleted` | `kept`
  - `reason`：清理決策理由
  - `attribution_evidence_ref`：歸屬依據——指向哪個 worker 的 `ephemeral_artifacts` / `task_id`（連回證據來源）
  - `before_sha256`：刪除前檔案 sha256；`decision=deleted` 時**必填**，供事後可重建「刪了什麼」（`decision=kept` 時可為 null）
- YAML 範例：

```yaml
cleanup_log:   # Manager 在 cleanup_ephemeral_artifacts step 寫入；供日後 governance 機械稽核「刪了什麼、為何」
  - path: <檔路徑>
    decision: deleted | kept
    reason: <理由>
    attribution_evidence_ref: <歸屬依據：哪個 worker 的 ephemeral_artifacts / task_id>
    before_sha256: <刪除前檔案 sha256；decision=deleted 必填，供事後可重建「刪了什麼」>
```

## Reference

- 上位規範：`agents/agent-ops/_protocols/rules/output-verification.md`（Manager 側的 Post-Dispatch Verification 流程）
- 本協議是 output-verification 的**前置條件**：Doer 先產 evidence_bundle → Manager 再據此稽核
- 不重複規範 Manager 驗證動作，見該檔 Step 1-3

## Manager 稽核入口

Manager 依本協議執行事實稽核的 flow：
- `agents/sw/manager/workflow/dual-audit-flow.md#audit_doer_facts`

> **註**：該 flow 檔實作於 `agents/sw/manager/workflow/dual-audit-flow.md`（Batch B 已建立），並於 Batch C 補完 `audit_reviewer_process` 區塊。

## 失效條款

Agent dispatch 回報中若出現以下情形之一，Manager **必須標記為 BLOCKED**：
1. 無 `evidence.yaml` 檔存在於指定位置
2. `evidence.yaml` 缺任一必填頂層 key
3. `assertions` 中任一 claim 缺對應 `evidence_ref`
4. `commands_run` 中 `exit_code != 0` 但 `assertions` 仍宣稱成功

駁回（BLOCKED 狀態）時 Manager 應引用本協議條號，並指示 agent 補交。

### ephemeral_artifacts rollout 過渡相容條款（暫行）

> **背景**：`ephemeral_artifacts` 於 phase-2 列為必填頂層 key（見「Evidence Bundle 必填欄位」L25），但 worker-facing 的申報契約（`dispatch-protocol.md §4` / `dispatch-flow.md §execute`）係近期才補上。rollout 過渡期會有舊/在途 worker 回傳尚未含此欄。

- **過渡處理**：在 worker-facing 契約（`dispatch-protocol.md §4` / `dispatch-flow.md §execute`）完成推送並穩定前，若 worker 回傳**缺** `ephemeral_artifacts`，稽核**視為 `[]` 並記 warning（不依失效條款 #2 判 BLOCKED）**。
- **不影響其他必填 key**：本過渡豁免**僅限** `ephemeral_artifacts` 此單一欄位；其餘必填頂層 key 缺漏時，失效條款 #2「缺任一必填頂層 key → BLOCKED」**照常生效**，失效條款 #1/#3/#4 亦不受影響。
- **退場條件**：待 worker 契約推送穩定後，移除本過渡條款，`ephemeral_artifacts` 升為硬必填，缺漏回歸失效條款 #2 判 BLOCKED。

## 版本歷程

| 版本 | 日期 | 作者 | 變更 |
|------|------|------|------|
| v1.0 | 2026-04-24 | agent-ops/agent-builder | 初版建立（gap-analysis 階段 1 Batch A） |
