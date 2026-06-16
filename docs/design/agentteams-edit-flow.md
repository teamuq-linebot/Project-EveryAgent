# AgentTeams 修改流程設計文件

> 版本：v1.0.0
> 日期：2026-06-10
> 狀態：定案（尚未實作）
> 定案歷程：五輪設計討論（2026-06-10），最終審核納入 Persona Gate（非工程師用戶）

---

## 1. 背景與目標用戶

### 1.1 目標 Persona

AgentTeams（AI 助手團隊）頁面的目標用戶是**不會寫程式的人**。這與 AgentOrg 規範 `agent-introduction.md §1` 一致：「introduction.json 給不會寫程式的人看」。

設計與實作此頁面任何功能時，**技術細節穿透到 UI 是不合格的**。以下詞彙/概念一律不可出現在任何可見 UI 元素：

- 檔名（`agent.yaml`、`soul.md`、`workflow.yaml`）
- 欄位鍵名（`dispatch.not_for`、`capabilities[0]`）
- 指令名（`/tuq-agent`）
- JSON 語法、hash 值、hostname 字串
- git 風格紅綠 diff

### 1.2 現況痛點（已確認）

使用者在 AgentTeams 頁點擊 ✏️ 修改時，遭遇三個交互破壞問題：

| 痛點 | 根因 | 位置 |
|------|------|------|
| 點修改後抽屜立刻被關 | `onOpenAgentOpsSession` 回呼內先呼叫 `handleCloseDrawer()` | `AgentTeamsView.tsx:644-648` |
| AI 對話搶占右欄 Pane，原有對話丟失 | `open()` 成功後無條件 `setActiveId(conversationId)` | `useAgentConversation.ts:208` |
| 在 Pane 輸入框打到一半的文字丟失 | 輸入框文字為 local state，Pane 重排時不保留 | Pane 元件內部 |

**根因程式碼（已驗證行號）**

`AgentTeamsView.tsx:644-648`：
```tsx
onOpenAgentOpsSession={(label, prompt) => {
  // 抽屜是 overlay，啟動嵌入前先關抽屜，避免蓋住右欄對話（plan §8 風險 2）
  handleCloseDrawer();
  openAgentSession(label, prompt);
}}
```

`useAgentConversation.ts:208`（`open()` 函式尾段）：
```ts
setActiveId(conversationId);
```
此行在每次 `open()` 時無條件設定 activeId，即使右欄已有進行中對話。

---

## 2. 定案一：抽屜 Dock 化並存

### 2.1 設計方向

將抽屜從 **overlay（浮層覆蓋）** 改為 **docked 固定側欄**，與組織圖和 AI 對話並存。

**三欄佈局**：

```
┌──────────────┬──────────────────────┬───────────────┐
│  組織圖       │  AI 對話（ConvPane）  │  詳情（抽屜）  │
│  (AgentOrgList) │                    │  (Drawer)     │
└──────────────┴──────────────────────┴───────────────┘
```

- 各欄寬度可拖拉
- 詳情欄以 `flex: 0 0 <w>px` 固定寬；畫布區域用 `flex: 1`（參見 MEMORY: AgentTeams splitter 坑）

### 2.2 小視窗降級（< 1200px）

螢幕寬度 < 1200px 時自動收起左側組織圖欄，並留一個「返回團隊列表」固定入口（例如頂部麵包屑或浮動按鈕），讓用戶能重新開啟組織圖。

### 2.3 setActiveId 不搶 Pane

`useAgentConversation.ts open()` 改為：

- 若右欄**已有對話且非 pending**：新開對話加入清單但**不切換 activeId**
- 若右欄**無對話**（Map 為空）：照常 `setActiveId(newId)`

### 2.4 輸入草稿狀態提升

Pane 輸入框的草稿文字從元件 local state 提升至上層，以 `Map<conversationId, string>` 儲存，防止 Pane 重排時丟失。

---

## 3. 定案二：健診/回顧搬至團隊層級

### 3.1 語意依據

AgentOrg 的 audit（健診）和 review（回顧）在協議設計上都是 **team 層級**操作：

- `dual-audit-protocol.md`：設計為整組稽核
- `team-review-protocol.md`：設計為每週整組回顧
- `/tuq-agent review {team}/{agentName}` 的 `agentName` 參數在現行 `/tuq-agent` 指令中**無接收邏輯**，傳入 agent 名稱實際無效

### 3.2 UI 落點調整

| 按鈕 | 現況位置 | 調整後位置 | 說明 |
|------|---------|-----------|------|
| 健診 | `AgentDetailDrawer.tsx:464-476` | `AgentOrgList.tsx TeamSection` 標頭或 TeamNode ops 列 | 整組健診 |
| 改善/回顧（原「成長」） | `AgentDetailDrawer.tsx:477-489` | 同上 | 整組回顧；按鈕標籤改為「改善/回顧」 |
| ✏️ 修改 | `AgentDetailDrawer.tsx:490-502` | 保留 agent 層級（不動） | 修改個別 agent 的介紹 |

**現況程式碼位置（已驗證）**：

- 健診按鈕：`AgentDetailDrawer.tsx:464-476`（`🔍 健診`，onClick 呼叫 `/tuq-agent audit ${teamId}/${agentName}`）
- 成長按鈕：`AgentDetailDrawer.tsx:477-489`（`📋 成長`，onClick 呼叫 `/tuq-agent review ${teamId}/${agentName}`）
- TeamSection 標頭：`AgentOrgList.tsx:208-257`（團隊標頭按鈕區，含現有 💬 對話、上線 switch）

---

## 4. 定案三：Introduction 草稿 Draft → Diff → Apply

### 4.1 狀態機

```
VIEW
 └─[點 ✏️ 修改]→ EDITING
                    ├─[手動或 AI 修改存稿]→ DRAFT_PENDING
                    │                          ├─[點查看改了什麼]→ APPLY_CONFIRM
                    │                          │                     ├─[確認套用]→ APPLYING
                    │                          │                     │               ├─[成功]→ APPLIED → VIEW（清除草稿）
                    │                          │                     │               └─[失敗]→ APPLY_FAILED（保留草稿）
                    │                          │                     └─[取消]→ DRAFT_PENDING
                    │                          └─[偵測上游衝突]→ DRAFT_CONFLICT（三選一）
                    └─[放棄]→ VIEW
```

**狀態說明**：

| 狀態 | 用戶可見文案 |
|------|------------|
| `VIEW` | 正常顯示介紹內容 |
| `EDITING` | 編輯模式，欄位可修改 |
| `DRAFT_PENDING` | 「有未套用的草稿修改」（DraftStatusBanner 顯示） |
| `APPLY_CONFIRM` | 「查看這次改了什麼」預覽介面（IntroductionDiffViewer） |
| `APPLYING` | 「AI 正在幫你修改，通常需要 10～30 秒」（進度提示） |
| `APPLIED` | 「修改完成！助手的設定已更新。」（明確完成通知） |
| `APPLY_FAILED` | 「修改沒有成功，助手的設定沒有改變。你可以再試一次。」 |
| `DRAFT_CONFLICT` | 「這份草稿的基礎已過期...」（DraftConflictBanner + 三選一） |

### 4.2 編輯控件

| 欄位類型 | 控件 |
|---------|------|
| 字串欄位（`summary`、`when_to_use`、`not_for`、`inputs`、`outputs`） | `<textarea>` 多行文字輸入 |
| 陣列欄位（`capabilities`、`manages`、`callable_by`、`flags`） | Pill 標籤（可增刪改、可拖拉排序） |
| `workflows` | 情境卡片（每張卡片含 scenario 文字 + steps 陣列編輯） |
| 唯讀欄位（`id`、`display_name`、`team`、`role`） | 純顯示，不可編輯（底部灰色說明「這些欄位由系統管理」） |

### 4.3 草稿存放

草稿檔案名稱：`introduction.draft.{hostname}.json`，與 `introduction.json` 同層目錄（即 agent 目錄內）。

設計理由：
- **同層路徑**：PTY 內執行的 claude CLI 可直接 Read/Edit 此路徑（agent 目錄在 agents/ 根下，claude 有存取權）
- **hostname 後綴**：防止 Google Drive 多機同步衝突（不同機器各自維護自己的草稿）
- **`_base_hash` 欄位**：儲存草稿建立時 `introduction.json` 的 sha256，用於上游衝突偵測（原始檔被其他人修改後，`_base_hash` 與目前檔案 hash 不符即觸發 `DRAFT_CONFLICT`）

草稿檔案結構（示意）：
```json
{
  "_meta": {
    "_base_hash": "<sha256 of introduction.json at draft creation time>",
    "_created_at": "2026-06-10T10:00:00Z",
    "_hostname": "DESKTOP-XXXX"
  },
  "summary": "（編輯中的摘要）",
  "capabilities": ["..."],
  "..."
}
```

### 4.4 AI 共編流程

1. 用戶在 AI 對話 Pane 說明想要的修改
2. App 把 `introduction.draft.{hostname}.json` 的絕對路徑注入對話 context（系統提示或初始訊息）
3. AI（claude CLI）使用 Edit 工具直接修改草稿檔
4. Main process 以 `fs.watch` 監看草稿檔
5. 檔案變動時 → Main process 以 `draftUpdated` IPC push 通知 Renderer
6. Renderer 重新載入草稿 → 抽屜自動更新顯示
7. **AI 寫壞 JSON 時**：JSON.parse 失敗 → 忽略此次更新，保留上一個有效版本；對話 Pane 顯示友善錯誤文案（見 M5）

### 4.5 欄位級 Diff

使用純函式 `diffIntroduction(base, draft): DiffResult[]` 手寫欄位級比對，**不引入外部 diff 函式庫**（package.json 現無 diff lib，不新增依賴）。

比對邏輯：
- 字串欄位：直接比對 `before !== after`
- 陣列欄位：逐元素比對（偵測新增/刪除/修改）
- `workflows`：以 `scenario` 為鍵比對，偵測情境新增/刪除及 steps 變動

UI 呈現（IntroductionDiffViewer）：
- 使用「**修改前 / 修改後**」並列（Word 修訂模式心智模型）
- 不使用 git 紅綠顏色或 +/- 符號（參見 Persona Gate M3）
- 無差異欄位不顯示

### 4.6 套用流程（Apply Chain）

套用的目的是**把草稿意圖傳遞給 `/tuq-agent` 改真正的原始檔**，而非逐字 patch JSON。

1. 呼叫 `buildApplyPrompt(base, draft): string`
   - 以欄位差異組成自然語言描述（例：「請將助手的摘要從『...』改為『...』；同時把能力列表第 2 項改為『...』」）
   - 附上 `inferSourceFiles(field)` 對應的原始檔提示（僅在 `/tuq-agent` 的 context 中，不在 UI 顯示）
2. App 以此 prompt 啟動 `/tuq-agent` 工作階段
3. `/tuq-agent` 依指示修改 `agent.yaml`、`soul.md`、`workflow.yaml` 等原始檔
4. 修改完成後，`/tuq-agent` 依 `agent-introduction.md §5` 正向同步 `introduction.json`（單向回流）
5. App 偵測到 `introduction.json` 更新 → 清除草稿檔 `introduction.draft.{hostname}.json`
6. 狀態機切換至 `APPLIED`，顯示完成通知

**套用前自動備份**：套用前 App 複製一份 `introduction.json` 為 `introduction.json.bak`，套用失敗時告知用戶備份存在。

**欄位 ↔ 原始檔對應（`inferSourceFiles` 依據）**：

| introduction.json 欄位 | 對應原始檔 |
|----------------------|-----------|
| `capabilities` | `soul.md` Principles 段落 |
| `workflows[].steps` | `workflow.yaml` steps |
| `when_to_use` | `agent.yaml` dispatch.trigger |
| `not_for` | `agent.yaml` dispatch.not_for |
| `summary`、`inputs`、`outputs` | `soul.md` Identity / Anti-patterns |

---

## 5. Persona Gate（非工程師 7 條 Must-Fix）

以下 7 條已全部併入上述定案，此節列出以便實作時逐項驗收。

| 編號 | 規則 | 具體要求 |
|------|------|---------|
| **M1** | 套用確認畫面移除技術資訊 | ApplyConfirmSheet 不顯示 `agent.yaml`、`soul.md`、`dispatch.not_for`、`capabilities[0]` 等技術識別字；改為純白話修改摘要（例：「助手的工作範圍描述將從『...』改為『...』」） |
| **M2** | 指令名不可見 | `/tuq-agent` 一律不出現在任何可見 UI 元素（文案、tooltip、進度訊息、log 預覽） |
| **M3** | Diff 改用白話並列 | 「查看差異」按鈕改標籤為「**查看這次改了什麼**」；Diff 介面用「修改前」/「修改後」並列，不用 git 風格 +/- 紅綠 |
| **M4** | 套用中顯示自然語言進度 | 套用中狀態預設顯示：「AI 正在幫你修改，通常需要 10～30 秒」；CLI 原始輸出收進預設**關閉**的摺疊區（例：「查看詳細過程」展開） |
| **M5** | AI 寫壞草稿的錯誤文案 | 「AI 這次沒有正確理解你的修改，草稿沒有更新。你可以再試一次，或換個方式說明你想改什麼。」（不顯示「JSON 格式有誤」等技術詞） |
| **M6** | 衝突三選一附後果說明 | DraftConflictBanner 每個選項附後果：「使用我的草稿（會覆蓋別人剛做的修改）」/「使用最新版本（我的草稿修改將遺失）」/「先不動（保留草稿，等我決定）」 |
| **M7** | 失敗安全保證 + 完成通知 | 套用前自動備份；失敗時明示「**修改沒有成功，助手的設定沒有改變。**你的修改草稿還保留著，你可以再試一次。」；成功時明確通知「**修改完成！助手的設定已更新。**」 |

### Should-Fix（建議但非阻塞）

| 編號 | 規則 |
|------|------|
| **S1** | hostname 字串和 hash 值不得出現在任何可見文字（DraftStatusBanner 只顯示「有一份未套用的草稿修改」） |
| **S2** | 抽屜內「成長」按鈕搬至團隊層級後，標籤改為「**改善/回顧**」 |
| **S3** | 視窗 < 1200px 時組織圖自動收起，留明顯「返回團隊列表」入口 |

---

## 6. 新建項盤點

### 6.1 IPC Channels

| Channel | 方向 | 說明 |
|---------|------|------|
| `agentOrg:saveDraft` | Renderer → Main | 儲存草稿（傳入 agentDir、hostname、草稿內容） |
| `agentOrg:getDraft` | Renderer → Main | 讀取草稿（含 `_base_hash` 比對結果） |
| `agentOrg:clearDraft` | Renderer → Main | 套用成功後清除草稿檔 |
| `agentOrg:draftUpdated` | Main → Renderer（push） | `fs.watch` 偵測草稿變動後推播，附最新草稿內容 |

### 6.2 新增 React 元件

| 元件 | 職責 |
|------|------|
| `IntroductionEditor` | 草稿編輯介面（textarea / pill / 情境卡片），含唯讀欄位顯示 |
| `IntroductionDiffViewer` | 欄位級差異預覽（修改前/修改後並列，符合 M3） |
| `ApplyConfirmSheet` | 套用確認面板（純白話摘要，符合 M1；含失敗安全提示 M7） |
| `DraftStatusBanner` | 頂部提示條（顯示「有未套用的草稿修改」，符合 S1） |
| `DraftConflictBanner` | 衝突警示條（三選一附後果說明，符合 M6） |

### 6.3 新增 Service 方法（agentOrgService.ts）

| 方法 | 說明 |
|------|------|
| `saveDraft(agentDir, hostname, draft)` | 寫入 `introduction.draft.{hostname}.json` |
| `getDraft(agentDir, hostname)` | 讀取草稿並回傳（含上游衝突偵測結果） |
| `clearDraft(agentDir, hostname)` | 刪除草稿檔 |

### 6.4 新增純函式

| 函式 | 說明 |
|------|------|
| `diffIntroduction(base, draft)` | 欄位級比對，回傳 `DiffResult[]`，不依賴外部 diff 函式庫 |
| `buildApplyPrompt(base, draft)` | 將差異組成自然語言 prompt 供 `/tuq-agent` 使用 |
| `inferSourceFiles(fieldName)` | 依欄位名回傳對應原始檔提示（agentOrgService context 用，UI 不顯示） |

---

## 7. 分期計畫

| Phase | 內容 | 依賴 |
|-------|------|------|
| **Phase 1**（最短可用） | 字串欄位 inline 編輯 + `diffIntroduction` + `buildApplyPrompt` + Apply Chain（IPC + agentOrgService saveDraft/getDraft/clearDraft） | 無 |
| **Phase 2** | 陣列欄位（pill 標籤）+ `workflows` 情境卡片編輯 + 上游衝突偵測（`_base_hash`）+ 放棄草稿確認對話框 | Phase 1 |
| **Phase 3** | AI 共編（`fs.watch` → `draftUpdated` push + 草稿路徑注入 context + AI 寫壞 JSON 防護） + 多機 hostname 後綴完整測試 | Phase 1 |

**可與 Phase 1 並行**：
- 抽屜 Dock 化三欄佈局（定案一）
- 健診/回顧按鈕搬至團隊層級（定案二）

---

## 8. 附錄

### 8.1 introduction.json 欄位表

完整欄位依據 `agent-introduction.md §3`：

| 欄位 | 必填 | 類型 | 說明 |
|------|------|------|------|
| `id` | 必填 | string | 路徑形式英文代號，如 `sw/developer` |
| `display_name` | 必填 | string | 繁中職稱 |
| `team` | 必填 | string | 中文團隊名 |
| `role` | 必填 | string | 固定四值：`組長`/`執行者`/`審查者`/`研究員` |
| `summary` | 必填 | string | 一句話白話說明 |
| `capabilities` | 必填 | string[] | 能力陣列，至少 3 項 |
| `when_to_use` | 必填 | string | 適用情境 |
| `not_for` | 必填 | string | 排除情境（防誤用） |
| `reports_to` | 必填 | string | 中文職稱或「使用者」 |
| `manages` | 選填 | string[] | 下屬職稱陣列；worker 可為空 `[]` |
| `callable_by` | 必填 | string[] | 可呼叫者職稱陣列 |
| `inputs` | 必填 | string | 接收什麼（白話） |
| `outputs` | 必填 | string | 交付什麼（白話） |
| `workflows` | 必填 | Workflow[] | 情境陣列，見下方 |
| `examples` | 選填 | string[] | 具體案例；純審查者可留 `[]` |
| `flags` | 選填 | string[] | 特殊標記，無則 `[]` |
| `last_updated` | 必填 | string | ISO 日期，如 `2026-06-10` |

`workflows` 子物件結構：
```json
{
  "scenario": "（白話情境描述）",
  "steps": ["步驟一", "步驟二"]
}
```

### 8.2 欄位 ↔ 原始檔對應表（agent-introduction.md §5）

| introduction.json 欄位 | 原始欄位/段落 | 中文化要求 |
|----------------------|-------------|----------|
| `display_name` | `agent.yaml > title` | 直接使用（已繁中） |
| `role` | `agent.yaml > role_in_team` | doer→執行者、researcher→研究員、verifier→審查者、manager→組長 |
| `reports_to` | `agent.yaml > reports_to` | 路徑改為中文職稱 |
| `capabilities` | `soul.md > Principles` | 重寫為白話能力描述 |
| `workflows[].steps` | `workflow.yaml > steps` | 去除技術細節改白話 |
| `when_to_use` | `agent.yaml > dispatch.trigger` | 擴寫為完整說明句 |
| `not_for` | `agent.yaml > dispatch.not_for` | 擴寫為白話排除說明 |

---

*本文件由 developer agent 依五輪設計討論定案整理，不含自創設計決策。如需修改請先更新設計討論記錄再同步本文件。*
