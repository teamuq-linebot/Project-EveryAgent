---
rule_number: 31
rule_name: manager-doer-framing
created: 2026-05-09
trigger: agent-ops 跨 manager audit (sw 起點)
status: active
references:
  - agents/agent-ops/_protocols/rules/manager-dispatch-source.md
  - agents/agent-ops/_protocols/rules/hierarchical-dispatch.md
  - agents/agent-ops/_protocols/rules/quarterly-self-audit.md
---

# Rule #31 — Manager-as-Doer Framing 禁制令

## 1. 目的

收斂並消除 Manager 在 worklog / task_summary / dispatch prompt 中以「親自做事」措辭描述工作的行為偏差。Manager 角色定位是「派遣 + 驗收」，任何 framing 把 Manager 寫成 doer，即使背後實際有 dispatch worker，也會：

- 誤導後續 audit / governance 判讀
- 鼓勵 Manager 內化 doer 心態，下一次就真的不 dispatch
- 污染 worklog index 的角色資料，導致跨 manager 行為偏差難以發現

本 rule 把 framing 本身列為違規面向，**獨立於是否實際派遣**。

## 2. 定義

**Doer-framing**：worklog `input_summary` / `output_summary` / `task_id` / log_start `task_summary` / dispatch prompt 開頭，含下列動詞型 ops 措辭，且主詞為 Manager 自己時，即構成 doer-framing：

```
動詞清單（非窮舉）：
pull / merge / deploy / build / 建 / 修 / 設定 / 處理 / 寫 / 改 / 補 / 跑 /
產出 / 生成 / 整合 / 測試 / 驗證 / 排查 / 調 / 抓 / 撈 / 拉 / 推
```

判定邏輯：以「我 / Manager / {team}-manager」為主詞 + 上述動詞 + 直接受詞（檔案 / 服務 / 任務）= 違規。

**例外**（不算違規）：
- Manager 自己的「派遣 / 分派 / dispatch / 路由 / classify / 驗收 / 簽核 / 合成 / 整合報告」等元工作動詞
- 引用 worker 回報結果的轉述句（標明來源時）

## 3. 派遣前 self-check 條款

每次 `bash scripts/worklog.sh start` 前，Manager 必須對 task_summary 做 framing self-check：

**禁止格式**：`{動詞} {對象}`
- 例：「建 rule #31」「處理 27 張發票」「pull paperclip」

**正確格式**（擇一）：
- A. **派遣式**：`派 {worker} 完成 {結果}`
- B. **流程式**：`{流程名稱}`（如「rule-rollout flow」「invoice OCR 流程」）
- C. **派遣 + 驗收**：`派 {worker} {動作} + {驗收 worker} 驗收`

若 task_summary 違反 A/B/C 三式，log_start 應重寫後再執行。

## 4. 違規 / 正例對照表

下表 task_id 取自 2026-05-09 跨 manager audit 真實樣本（見 `output/agent-ops/sw-manager-overreach-20260509/research_report.md`）：

| 場景 / 來源 | 違規 framing | 正確 framing |
|---|---|---|
| paperclip 同步 (sw) | 幫用戶 git pull paperclip | 派 sw/devops 同步 paperclip 並回報衝突 |
| 進項發票 OCR (finance) | 處理 27 張進項發票 | 派 finance/invoice-ocr 抽取 27 張進項 + qa 驗收 |
| 規則建立 (agent-ops) | 建 rule #30 | 派 agent-builder 建 rule #30 + governance 審查 |
| 教材生成 v7.3.2 (edu) | v7.3.2 PPTX/XLSX/DOCX 生成 | 派 doc-generator 三檔 + qa-reviewer 驗收 |
| 套件修補 (goose) | 補 paddleocr fork | 派 platform-security 修 paddleocr 載入 |
| 提案審閱 (sales) | 審閱華擎提案 | 派 qa-reviewer 審閱華擎提案 v3 |

## 5. 與既有 rule 的關係

| Rule | 主軸 | 與 #31 關係 |
|---|---|---|
| P1 全部分派 | 行為層：禁止 Manager 親自做事 | 本 rule 是 framing 層補強 |
| P16 任務粒度 | 拆分多目標 | 並列軸：粒度與 framing 各管一面 |
| P17 Audit ≠ Judge | Manager 不下品質判決 | 並列軸：判決與 framing 各管一面 |
| P21 dispatch mode self-check | 派遣模式選擇 | 前置：先過 framing，再決 mode |
| **P31 (本 rule)** | **Framing 層** | 收斂 framing 偏差 |

三軸（P16 × P17 × P31）構成 governance 跨 manager 例行抽查的標準。

## 6. Governance 鉤子

Governance 每週**或**每 30 dispatch 隨機抽 5 筆 worklog，跑「**doer-framing × P16 × audit-judge**」三軸快檢：

- 三軸各自獨立判 PASS / FAIL
- 任一軸 FAIL → 記入該 manager memory advisory
- **同次抽樣違規 ≥ 2 軸** → 發 advisory 給該 manager + 抄送 agent-ops manager
- 連續 3 週同軸違規 → 觸發 Evolution rollout

詳細執行流程見 `agents/agent-ops/governance/skills.md` 之 `Manager Framing Scan` skill。

## 7. Adoption Checklist（rollout 優先序）

依 2026-05-09 audit 結果：

| Manager | 偏差等級 | 行動 |
|---|---|---|
| edu/manager | HIGH | 立即派 agent-builder 修 soul.md framing 段 |
| finance/manager | MEDIUM | 下次 dispatch 前自檢 |
| sales/manager | MEDIUM | 下次 dispatch 前自檢 |
| agent-ops/manager (self) | MEDIUM | 下次 dispatch 前自檢 |
| bni/manager | 免修 | framing 已合規 |
| sw/manager | 已修 | 2026-05-09 由另一 builder 完成 4 Edit |

Rollout 完成後，governance 啟動例行 `Manager Framing Scan` 持續監測。
