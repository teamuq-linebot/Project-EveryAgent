# 內建預設 AgentOrg 範本

此目錄為快組隊應用程式隨附的內建預設 AgentOrg 範本。

## 用途

當使用者首次啟動應用程式，且：

1. 尚未設定 AgentOrg 根路徑（app_settings 中無 agentOrgRootPath）
2. 且公司版 AgentOrg 雲端路徑（T: 磁碟）無法存取

系統會自動將此目錄內容複製到使用者本機的 `~/.teamuq/AgentOrg/` 作為起始範本，讓 AI 助手團隊功能可以立即使用。

## 結構說明

```
agents/
  general/             一般通用團隊（預設示範）
    manager/           組長（負責接收並分派任務）
      agent.yaml       角色定義
      soul.md          角色個性說明（白話文）
    assistant/         萬用助理（負責實際協助使用者）
      agent.yaml       角色定義
      soul.md          角色個性說明（白話文）
```

## 重要說明

- **此範本為最小可用設定**，僅供示範與首次體驗使用。
- **正式使用請由公司管理員提供完整的 AgentOrg 設定**，並透過應用程式「AI 助手團隊」頁面設定根路徑。
- 複製後的本機範本可自由修改，不影響其他使用者。
