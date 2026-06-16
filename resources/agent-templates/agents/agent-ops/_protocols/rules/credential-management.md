<!-- created 2026-05-08 by agent-ops/agent-builder, trace=agentops-20260508-0359-credential-rule-build, parent=agentops-20260508-0221-playwright-consult, requested by david@HITL-Tier-3-confirm -->

# Credential Management Rule — Secret / Credential 處理規範

<!-- metadata
last_updated: 2026-05-08
revision_reason: 系統層 gap 補齊；Governance 於 playwright-consult 任務揭示全系統 protocols/rules/ 完全無 credential 管理規則
rule_number: 29
revisions:
  - r1.0 (2026-05-08): initial creation
  - r1.5 (2026-05-08): 補 P3 Business OAuth carve-out + P4 fixture 落點明確化（Gov MEDIUM 修補）
-->

**地位**：橫切關注點規則（Cross-cutting concern），適用於所有 agent，與 `shell-preference.md`、`output-placement.md` 同等級。

---

## 1. 適用範圍

所有 `agents/` 目錄下的 agent（Worker / Manager / Director / Officer），凡涉及下列任一機敏資料：

- API key（OpenAI、Anthropic、Stripe、Google、AWS 等）
- OAuth token / JWT / refresh token
- Password / passphrase
- Cookie / session token
- Browser storageState（auth.json、cookies.json 等 Playwright fixture）
- TLS 憑證 / SSH private key
- DB connection string（含 username:password@host）
- 雲端 credential（AWS access key、GCP service account JSON、Azure client secret）
- MCP `authenticate` / `complete_authentication` 流程中的任何 token

**皆受本規則約束**，不得以任何形式明文出現於 worklog、memory、output、agent prompt 中。

---

## 2. 機敏資料分類（Tier）

| Tier | 範例 | 處置強度 |
|------|------|---------|
| **T1 生產級** | 生產 DB / AWS root / GCP project owner key、生產 OAuth client secret、MCP authenticate token | 絕不進 worklog / memory / output；vault-only |
| **T2 服務級** | 第三方 API key（OpenAI `sk-...`、Anthropic `sk-ant-...`、Stripe）| reference-only，禁明文；worklog 內只寫 `[REDACTED:T2]` |
| **T3 測試級** | E2E test user 憑證、staging key、Playwright storageState | reference-only，可短期儲存（最長 24h TTL，須含 expires 註解） |
| **T4 公開** | 公開 anon key（受 RLS 保護）、已發佈的 public API endpoint | 可入 config，但仍標記 `# public-key` 以便稽核識別 |

---

## 3. 核心原則

### P1 — Reference, never inline（引用，絕不內嵌）
一律使用 `${VAULT.X}` / `${ENV.Y}` / `${SECRETS_DIR}/x.json` 等引用形式；禁止將明文 secret 寫入 prompt、worklog、memory、output 檔案。

**為什麼**：明文 secret 一旦進入任何可搜尋的文字記錄，攻擊面立即擴大到所有能讀取該記錄的系統（Google Drive 同步、log 收集、memory indexer）。

### P2 — Worklog 收工前必須執行 redact 自檢
Manager 與 Worker 在呼叫 `worklog.sh end` 前，必須掃描 `input_summary`、`output_summary`、`brief` 欄位，使用附錄 A 定義的 redact regex 自檢。命中任何 pattern → 將命中字串替換為 `[REDACTED:T?]`（T? 為對應 Tier）並寫 incident note 到 `agents/agent-ops/governance/memory/`。

**為什麼**：worklog 是系統最主要的可搜尋記錄，是 secret 外洩最高機率的通道。

### P3 — 生產帳號禁用（Production account isolation）
E2E 測試與所有自動化任務必須使用專屬隔離帳號（命名規範：`{app}-e2e-test-user`、`{app}-staging-user`），**禁止使用真實用戶帳號或 admin 帳號**。

**為什麼**：生產帳號一旦在自動化流程中被操作，真實資料面臨不可逆風險，且 audit trail 會被測試行為污染。

**例外（Business OAuth Flow Carve-out）**：以下情境**不適用** P3，但仍受 P7（MCP token 屬 T1）約束：
- 業務型 agent 整合需要 end-user 本人 OAuth 授權的 SaaS（如 sales/hubspot、operations/slack、operations/notion、operations/atlassian 等），其 `mcp__*__authenticate` 流程使用真實 user 帳號是合規的——因為 token 屬於該 user 本人、權限不超過其本身已有權限
- 識別特徵：(a) OAuth flow 由 user 在主對話中明確同意；(b) token 用於存取「user 自己的資料」而非他人資料；(c) 流程中無法用 e2e-test-user 替代（SaaS 不開放 service account）
- **仍須遵守**：token 不入 worklog（P2/P7）、不在 dispatch prompt 明文（P6）、session 結束視為過期（P7）

### P4 — Fixture 檔案位置紀律（storageState / auth.json）
Playwright storageState 等 auth fixture 必須遵守：
- (a) **不進 git**（`.gitignore` 必含 `*.storageState.json`、`auth.json`、`cookies.json`）
- (b) **不放 Google Drive 共用區**（T:\ 路徑下禁止儲存 fixture 明文）。**正確落點**：
  - **Windows**：`%USERPROFILE%\.agentorg-secrets\fixtures\`（即 `C:\Users\{user}\.agentorg-secrets\fixtures\`）
  - **macOS / Linux**：`$HOME/.agentorg-secrets/fixtures/`
  - **環境變數覆寫**：若設定 `$AGENTORG_SECRETS_DIR`，以該值為準
  - **Worker 取得方式**：Manager dispatch prompt 用 `${SECRETS_DIR}/{app}-{env}-{user}.storageState.json` 引用，由 worker 在執行時解開為實際絕對路徑
- (c) 預設 **24h TTL**，檔案第一行必須有 `# expires: {ISO8601}` 註解
- (d) 命名規範：`{app}-{env}-{user}.storageState.json`（例：`tuq-staging-e2e-test.storageState.json`）

**為什麼**：fixture 檔含完整 session token，等同帳號憑證；放進共用雲端即等於公開。

### P5 — Secret 外洩 incident response（即時處置）
偵測到 secret 明文外洩（worklog / memory / output 中出現 regex 命中）立即：
1. **停止** worklog 寫入（不再追加任何內容）
2. **通知 user**（回報 session 中的外洩位置與 Tier）
3. **觸發 secret rotation**（提示 user 立即輪換該 secret）
4. 將 incident note 寫到 `agents/agent-ops/governance/memory/incident-{date}.md`，記錄：外洩 Tier、出現位置、已採取措施

**為什麼**：外洩後每延遲一分鐘，未輪換的 secret 仍可被惡意利用；立即回應是最低成本的止損手段。

### P6 — 跨 agent 傳遞只傳 reference（No secret in dispatch prompt）
Manager **不得**在 dispatch prompt 中明文塞入任何 credential；只能傳遞 reference（如 `auth_fixture_path: ${SECRETS_DIR}/tuq-staging-e2e-test.storageState.json`），由 Worker 在執行時從 vault / env / secrets dir 自行解開。

**為什麼**：dispatch prompt 會出現在 Manager 的 worklog 中；明文 credential 進 dispatch = 必然進 worklog。

### P7 — MCP authenticate 流程屬 T1
所有 `mcp__*__authenticate` / `mcp__*__complete_authentication` 流程中獲得的 token 屬 **T1 生產級**，不得進 worklog，不得進 memory，session 結束後視為已過期。

**為什麼**：MCP token 通常是 OAuth access token，有效期內等同完整帳號存取權。

---

## 4. 強制 / 禁止 / 例外

### ❌ 禁止
- 明文 secret 出現於 worklog 的 `input_summary`、`output_summary`、`brief` 任何欄位
- 明文 secret 出現於 agent memory（`memory/*.md`）
- 明文 secret 出現於 output 產物檔案（`output/{team}/{task}/`）
- 明文 secret 出現於 agent dispatch prompt
- 將 storageState / auth.json / cookies.json 提交 git 或上傳 Google Drive 共用區（T:\ 路徑）
- 使用生產帳號執行 E2E 測試或任何自動化任務
- fixture 檔案缺少 `# expires:` TTL 註解

### ✅ 強制
- 每次 `worklog.sh end` 前執行附錄 A 的 redact regex 自檢
- fixture 檔案第一行必須有 `# expires: {ISO8601}` 註解
- dispatch prompt 中的 credential 一律用 reference 形式（`${VAULT.X}` / path reference）
- 偵測外洩立即執行 §3-P5 的 incident response 四步驟
- E2E 測試帳號命名遵守 `{app}-e2e-test-user` / `{app}-staging-user` 慣例

### ⚠️ 例外
**User 在 main session 主動貼入 credential**：
- 視為一次性使用，在該 session 內可用於完成任務
- session 結束後，manager 必須在 memory 中記錄：`used credential at session {session_id}, 已過期，請輪換` （**不存明文**，只記行為事實）
- 不得將該 credential 寫入任何 worklog、memory、output 檔案

---

## 5. 附錄 A — Redact Regex（最小可用集）

worklog 收工前自檢用。命中即 redact 為 `[REDACTED:T?]`。

| 類型 | Pattern | Tier |
|------|---------|------|
| AWS access key | `AKIA[0-9A-Z]{16}` | T1 |
| AWS secret key | `[A-Za-z0-9/+=]{40}` | T1（高誤報率，配合上下文判斷） |
| OpenAI key | `sk-(proj-)?[A-Za-z0-9_-]{20,}` | T2 |
| Anthropic key | `sk-ant-[A-Za-z0-9_-]{20,}` | T2 |
| GitHub PAT（classic） | `ghp_[A-Za-z0-9]{36}` | T2 |
| GitHub PAT（fine-grained） | `github_pat_[A-Za-z0-9_]{80,}` | T2 |
| Generic high-entropy（警告級） | 連續 32+ char 的 base64/hex（`[A-Za-z0-9+/=_-]{32,}`） | T2–T3（warning，人工確認） |
| JWT | `eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+` | T1–T2 |
| DB connection string | `(postgres|mysql|mongodb)://[^@]+@` | T1 |

**實作提示**：可用 `grep -Eo '<pattern>'` 掃描 worklog JSON；命中時 `sed` 替換為 `[REDACTED:T?]`，並在 worklog 的 `notes` 欄位加一條 `"secret_redacted": true`。

---

## 6. 附錄 B — Rule Rollout 推送計畫（本輪 scope 外，R4+）

本規則建立後，依 `rule-rollout.md` 排程推送到各 manager 的 soul.md（追加為新 Principle）。

| Manager | 預期 Principle 編號 | 推送優先級 |
|---------|-------------------|-----------|
| `agent-ops/manager` | Principle 28（接續 #27 Estimate-Split-Verify Discipline） | P1（含 E2E 相關任務最多） |
| `sw/manager` | Principle 21（接續 #20 Dispatch Decomposition） | P1（sw/e2e-tester 上線前必須到位） |
| `finance/manager` | Principle 24（接續 #23 動詞型交辦 reframe） | P2（含 invoice API key） |
| `bni/manager` | Principle 25（接續 #24 Dispatch Guard） | P2 |
| `edu/manager` | Principle 21（接續 #20 Manager-as-Orchestrator） | P2 |
| `sales/manager` | Principle 21（接續 #20 Doer-Framing & Judge Boundary） | P2 |
| `test-agent`（若升格為 Manager） | Principle 1（最優先） | P3 |

**Rollout 觸發條件**：`sw/e2e-tester` agent 建立完成（R2）且通過 Governance 審查後，由 Agent Ops Manager 排程 R4 rule-rollout 任務。

---

## 7. 與既有 rules 的關聯

| 既有規則 | 關聯說明 |
|---------|---------|
| `shell-preference.md` | **互補**：shell 指令中同樣不得 `echo` / `printf` 明文 secret；`${ENV.SECRET}` 引用方式與本規則 P1 一致 |
| `output-placement.md` | **互補**：`output/{team}/{task}/` 下的 fixture 檔案仍需遵守本規則 §3-P4（TTL、命名、不進 Git） |
| `agent-anatomy.md` | **延伸**：未來 anatomy.md 可在 §3 加「§3.6 Secret 處理」引用本規則；本規則不修改 anatomy.md |
| `rule-rollout.md` | **對接**：本規則建立後排程 rule-rollout 推到 9 個 manager（見附錄 B） |
| `memory-hygiene.md` | **互補**：memory 過期清理時同步掃描是否有殘留 secret 明文（redact regex 掃描納入 hygiene checklist） |
| `worklog-timing-protocol.md` | **延伸**：本規則的 redact 自檢步驟插入 worklog end 流程之前 |

---

## 8. 例外申請流程

若某 agent 因技術限制必須短期保留明文 secret（如：第三方 SDK 不支援 env 注入）：

1. **提交 exception request** 到 `agents/agent-ops/governance/memory/exception-requests.md`，內含：
   - 理由（技術限制說明）
   - 影響範圍（哪個 agent、哪類 secret）
   - 緩解方案（如：限制 memory 讀取權限、縮短 TTL）
   - 自動失效日期（**最長 30 天**）
2. **Governance agent 審核**（或 user HITL 確認）後，該 agent 可暫時違反本規則
3. **到期前必須修復**；未修復者 Governance 季度稽核時標記為 Critical

---

*本規則為系統層橫切關注點（rule #29），建立後由 agent-ops/manager 透過 `rule-rollout.md` 機制分批推送至各 manager。*
