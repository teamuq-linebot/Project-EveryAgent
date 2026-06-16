# 建立 Skill 工作流程

## Manager 輸入

```json
{
  "action": "create_skill",
  "name": "skill-name",
  "target_manager_soul": "agents/{team}/manager/soul.md",
  "description": "用於 frontmatter 的一句話描述",
  "target_runtime": "claude | codex | both（未指定時依 Manager brief 判斷）"
}
```

<!-- self-added 2026-06-10 codex-skill-activation -->
**tuq-* manager entry skill 硬規則**：新建 `tuq-*` manager entry skill 時，若 Manager brief 未明確排除 Codex，`target_runtime` 預設必須是 `both`。若標成 `claude` only，brief 或 deliver 必須寫明排除 Codex 的理由；理由缺漏時不得宣告建立完成。

## 執行步驟

```
[2] 確認是否有現有 skill
  Glob .claude/skills/{name}/SKILL.md
  若存在 → 停止，向 Manager 回報（改為強化）
  │
  ▼
[3] 建立目錄
  Bash: mkdir -p .claude/skills/{name}
  │
  ▼
[4] 建立 SKILL.md
  範本：
  ---
  name: {name}
  description: {description}
  allowed-tools: Glob Grep Read
  ---

  ## User Request

  $ARGUMENTS

  ## Instructions

  You are the {Team} Manager. Read your soul and follow its workflow:
  `{target_manager_soul}`
  │
  ▼
[5] 驗證
  讀取已建立的檔案 — 確認 name、description、soul 路徑正確
  │
  ▼
[5.5] 建立全域 Junction（強制執行，不得跳過）
  Bash: bash scripts/setup-global-skills.sh
  驗證：ls -la "$HOME/.claude/skills/{name}" 確認 symlink 存在
  若驗證失敗：停止並回報 Manager，不得宣告完成
  （此步驟是 skill 可用性的關鍵，僅建立 SKILL.md 而不執行此步 = skill 不可用）
  │
  ▼
[5.6] Codex runtime activation（target_runtime == codex 或 both 時強制）
  <!-- self-added 2026-06-10 codex-skill-activation -->
  驗證 skill 必須可由 Codex session 載入，至少符合下列任一條件：
  - `C:/Users/david/.codex/skills/{name}/SKILL.md` 可解析
  - `C:/Users/david/.agents/skills/{name}/SKILL.md` 可解析
  - repo 內對應 `.Codex/skills/{name}/SKILL.md` 或 `.agents/skills/{name}/SKILL.md` source 已在本 session 的 skill list 載入
  只建立 `agents/{team}` 或 `.claude/skills/{name}` 不等於 Codex 上線。
  Codex skill list 在 session 啟動時讀取；補完路徑後必須提醒 Manager / user 重開 Codex session。
  若驗證失敗：停止並回報 Manager「Codex skill activation missing」，不得宣告 Codex runtime 可用
  若 Codex 路徑缺失：交由 setup/link 流程補建；補完後仍需提醒 Manager / user 重開 Codex session
  │
  ▼
回傳摘要給 Manager
```

## 備註

- SKILL.md 僅為薄層入口。流程邏輯委派給 Manager soul。
- `allowed-tools` 固定為 `Glob Grep Read`（Manager soul 定義實際權限）
- 檔案維持在 15 行以內
- 新 skill 建立後自動執行 `scripts/setup-global-skills.sh`，確保全域可用
- **步驟 [5.5] 強制執行**：不允許只建檔不執行腳本。若 Agent Builder 僅建 SKILL.md 而略過此步，skill 在 Claude Code 中將不可見，視為任務未完成。
- <!-- self-added 2026-06-10 codex-skill-activation --> 若目標執行環境包含 Codex，還必須通過 [5.6]；Claude `.claude/skills` / `~/.claude/skills` 可用不代表 Codex 已載入。
