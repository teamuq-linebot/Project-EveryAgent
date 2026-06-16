# 刪除工作流程

## Manager 輸入
```json
{
  "action": "delete",
  "target": "agent-name | skill-name | file-path",
  "target_type": "agent | skill | file",
  "reason": "為何需要刪除"
}
```

## 執行步驟

```
[2] 讀取目標
  讀取目標 agent/skill 的所有檔案，了解將會失去哪些內容。
  若 target_type == agent：讀取 agents/{target}/ 下的所有檔案
  若 target_type == skill：讀取 .claude/skills/{target}/SKILL.md
  若 target_type == file：讀取該特定檔案
  │
  ▼
[3] 依賴性檢查
  在整個系統中搜尋對目標的參照：
    Grep agents/*/org.md，搜尋目標的名稱
    Grep agents/*/workflow.yaml，搜尋對目標的參照
    Grep agents/agent-ops/_protocols/definitions.md，搜尋目標的名稱
  若發現依賴關係 → 停止，向 Manager 回報依賴清單。
  Manager 必須先解決所有依賴關係，才能繼續執行刪除。
  │
  ▼
[4] 治理關卡
  停止。向 Manager 回報：
  「{target} 的刪除已準備就緒，等待 Governance 核准。
   依賴關係：{無 | 清單}
   待刪除檔案：{清單}」
  Manager 必須明確確認 Governance 已核准，才能繼續執行。
  │
  ▼
[5] 執行刪除
  移除目標檔案/目錄。
  若 target_type == agent：
    Bash: rm -rf agents/{target}/
  若 target_type == skill：
    Bash: rm -rf .claude/skills/{target}/
  若 target_type == file：
    Bash: rm {file-path}
  │
  ▼
[6] 更新登錄表
  從以下位置移除相關參照：
    CLAUDE.md agent registry 表
    agents/agent-ops/manager/org.md 層級結構
    其他參照已刪除目標的 agent 的 org.md
  │
  ▼
[7] 驗證
  確認目標已不存在。
  Grep 搜尋殘留參照（失效連結）。
  回報仍需手動清理的殘留參照。
  │
  ▼
回傳刪除摘要給 Manager
```

## 安全規則
- **絕對不可跳過步驟 3（依賴性檢查）或步驟 4（治理關卡）**
- 若有疑慮，立即停止並向 Manager 回報
- **刪除操作不可逆** — 執行步驟 5 前，務必確認目標正確
