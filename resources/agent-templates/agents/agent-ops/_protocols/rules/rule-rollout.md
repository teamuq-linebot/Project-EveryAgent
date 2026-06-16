<!-- 本版本為 agent-ops team-local 版（scope: agents/agent-ops/）；全系統版見 agents/protocols/rules/rule-rollout.md -->

# 規則推送協議（Rule Rollout Protocol）— agent-ops team-local 版

## 適用時機
當 `agent-anatomy.md`、`creation-validation.md` 或 `definitions.md` 新增「必含原則」或「必備檔案」時，必須同步推送到 **agent-ops team 全 5 個 agent**（manager / agent-builder / governance / evolution / researcher）。

## 流程

1. **Governance 審查新規則** — 確認規則合理性和影響範圍
2. **Manager 評估影響面** — 列出需要更新的 agent 清單
3. **Pre-flight Lint（2026-04-28 新增，governance 教訓）** — bulk-update **前**必跑：
   ```bash
   bash .claude/scripts/lint_all_managers.sh > /tmp/lint_baseline_pre.txt
   bash .claude/scripts/validate_all_souls.sh > /tmp/val_baseline_pre.txt
   ```
   存基線（baseline），bulk-update 後重跑同兩腳本並 diff：
   - **必須**只新增規則行，**不可**引入新的 syntax/schema FAIL。
   - 若 bulk-update 引入新 FAIL → **ROLLBACK** + 修正 update spec 後重做。
   - 起源：2026-04-22 P18 rollout 同型 bug 在 edu/manager + goose-ops/manager 兩處同時出現（line 41/74 P 編號 sandwich），governance v7-4-protocol-review 揭示根因為「rule-rollout 缺 lint pre-flight」歷史共業。
4. **Agent Builder 執行 bulk-update** — 依 `bulk-update.md` 流程分批更新
5. **每批次跑 validate-agent.sh** — 確保更新後合規
6. **Manager 合成報告** — 確認推送完成率 100% + 附 baseline diff

## 規則

- **不可只寫規則不推送** — 新增 `_protocols/` 必含原則後，Manager 必須在同一任務中觸發 bulk-update
- **推送範圍** — 僅限 `agents/agent-ops/` 下的全 5 個 agent（manager / agent-builder / governance / evolution / researcher）；不跨出 agent-ops team
- **推送紀錄** — 每次推送在 rule-rollout.md 末尾追加紀錄：
  ```
  ### {date} — {規則名稱}
  - 影響 agent 數：{N}
  - 推送狀態：完成/部分完成
  - 未推送原因（如有）：...
  ```

## 歷史推送紀錄

### 2026-04-14 — 計算委派原則
- 影響 agent 數：17（不含 calculator 自身）
- 推送狀態：完成
- 備註：全系統 21 agent 驗證通過

### 2026-04-22 — P18 任務粒度拆解（Dispatch Granularity）<!-- self-added -->

- **Trace ID**：20260422-p18-rollout
- **起源**：sales/manager（Principle 18），因「知識衛星」提案出現 138 分鐘 / 76 分鐘大包任務
- **觸發者**：david（user）
- **決策**：全面推廣（用戶選 B）
- **涵蓋 5 manager 的新編號**：
  - sw/manager → Principle 16
  - edu/manager → Principle 19
  - bni/manager → Principle 22
  - agent-ops/manager → Principle 22
- **加上原 sales/manager 的 Principle 18** → 共 5 manager 全覆蓋
- **連動檔案**：每個 manager 的 skills.md 都加對應 skill；詳細 feedback 在 `agents/sales/manager/memory/feedback_task_granularity.md`
- **後續義務**：未來新建 manager 時需預設含此 Principle（建議寫進 `creation-validation.md`）

## Rollout History

| Date | Policy | Trace | Closure |
|------|--------|-------|---------|
| 2026-05-01 | ban-haiku (round 3 closure) | haiku-audit-20260501 | PASS — 第二輪 rollout 全清 24 Class A 違規（17 檔 / 41 Edit），新增 nightly_policy_grep.sh 自動化 + governance rollout_closure_check step + 2 protocol（rule-rollout-closure / manager-dispatch-source）。詳見 `agent-ops/manager/memory/retrospective_haiku_rollout_round2_2026-05-01.md`。|
| 2026-05-08 | rule #30 self-review-visibility | agentops-20260508-0550-rule30-rollout | PASS_WITH_NOTE → R2D 完成 — 8 manager soul.md 加 visibility bullet（7 EDIT + 1 ADD finance P21）；R2C Governance NOTE（finance visibility 字面對齊）已於 R2D 修正。|

### 2026-05-08 — rule #30 self-review-visibility rollout <!-- self-added -->

- **Trace ID**：agentops-20260508-0550-rule30-rollout
- **起源**：rule #30 self-review-visibility.md（user 反饋「self-review 要做但不顯示」）
- **觸發者**：david（user）
- **R2 範圍**：8 manager soul.md 加 visibility bullet（7 EDIT + 1 ADD finance P21）
- **gb10-sysadmin SKIP**：屬 worker 類 platform agent，無 manager soul.md（rule #1 不適用 worker）
- **覆蓋 8 manager 的 Principle 編號**：
  - agent-ops/manager → P20
  - sw/manager → P14
  - sales/manager → P16
  - edu/manager → P16
  - bni/manager → P20
  - finance/manager → P21（**ADD**，原缺 self-review Principle）
- **執行模式**：3 batch 並行（zero 越界）
- **Lint post-state**：lint_all_managers PASS 8/8、validate_all_souls PASS 52/0
- **Process violation**：Manager 漏跑 lint baseline pre-flight（已記入 follow-up，補做 post-state lint 確認 zero new FAIL）
- **Governance**：PASS_WITH_NOTE（finance visibility 字面對齊已 R2D 修）
- **推送狀態**：完成
- **未推送原因（如有）**：N/A
- **新 follow-up**:
  - lint baseline 強制紅線（rule-rollout.md 加註）
  - rollback-sop 隨 protocol 同批建（gap-analysis learning 待補）
  - R3 行為抽檢（1 週內驗 8 manager 真的不顯示 self-review）
  - gb10-sysadmin 將來升 manager 必補 rule #30
