# MCP Server Registry

## 1. 目的
集中列出所有可用的 MCP 伺服器及其用途，讓 Manager 在 dispatch 時能為 agent 選擇正確的工具。

## 2. 如何使用此 Registry
- Manager 在 dispatch 前查閱此表，決定 agent 是否需要額外 MCP 工具
- Agent Builder 在建立新 agent 的 tools.md 時參考此表
- 新增 MCP 伺服器時必須更新此 registry

## 3. 已註冊的 MCP 伺服器

| Server Name | 用途 | 提供的工具 | 適用 Agent | 狀態 |
|------------|------|-----------|-----------|------|
| claude_ai_Gmail | Gmail 信箱操作 | gmail_create_draft, gmail_get_profile, gmail_list_drafts, gmail_list_labels, gmail_read_message, gmail_read_thread, gmail_search_messages | 需要處理電子郵件的 agent | 已啟用 |
| claude_ai_Google_Calendar | Google 日曆管理 | gcal_create_event, gcal_delete_event, gcal_find_meeting_times, gcal_find_my_free_time, gcal_get_event, gcal_list_calendars, gcal_list_events, gcal_respond_to_event, gcal_update_event | 需要排程或會議管理的 agent | 已啟用 |
| claude_in_chrome | 瀏覽器自動化（DOM-aware）— 探索期手動走 flow 確認 selector | mcp__Claude_in_Chrome__navigate, mcp__Claude_in_Chrome__find, mcp__Claude_in_Chrome__form_input, mcp__Claude_in_Chrome__get_page_text, mcp__Claude_in_Chrome__javascript_tool, mcp__Claude_in_Chrome__read_page, mcp__Claude_in_Chrome__read_console_messages, mcp__Claude_in_Chrome__read_network_requests, mcp__Claude_in_Chrome__list_connected_browsers, mcp__Claude_in_Chrome__select_browser, mcp__Claude_in_Chrome__switch_browser, mcp__Claude_in_Chrome__resize_window, mcp__Claude_in_Chrome__shortcuts_list, mcp__Claude_in_Chrome__shortcuts_execute, mcp__Claude_in_Chrome__tabs_create_mcp, mcp__Claude_in_Chrome__tabs_close_mcp, mcp__Claude_in_Chrome__tabs_context_mcp, mcp__Claude_in_Chrome__file_upload, mcp__Claude_in_Chrome__upload_image, mcp__Claude_in_Chrome__gif_creator, mcp__Claude_in_Chrome__browser_batch | sw/e2e-tester（探索期 only，正式跑 E2E 用 Playwright spec）；其他 agent 需 Governance 審批 | 已啟用（受 credential-management.md §3-P3 OAuth carve-out 與 §3-P7 約束）|
| FreeCAD MCP | FreeCAD 3D 幾何與 Python 腳本執行 | mcp__freecad__execute_code（在 FreeCAD 中執行 Python 程式碼，回傳執行結果與當前視圖截圖） | （mcad team 已於 2026-06-09 刪除，目前無已配置的適用 agent） | 已啟用 |

> 備註：以上 MCP 伺服器來自 `.claude/settings.local.json` 中的 permissions allow 清單（工具名稱前綴為 `mcp__`）。

### sw/e2e-tester 使用須知（claude_in_chrome）

依 credential-management.md：
- **探索期**（開發新 spec 時手動走過一次 flow 確認 selector 穩定）：可使用 Chrome MCP，但 OAuth 流程受 §3-P3 carve-out 約束（業務型 SaaS OAuth 用 user 本人帳號合規；E2E 測試帳號仍須走 `{app}-e2e-test-user`）
- **正式 run 不用此 MCP**：以 Playwright spec + storageState fixture 為主（依 §3-P4(b) 落點）
- token 屬 T1（依 §3-P7），不入 worklog / memory / output

### 已連接但尚未在 §3 登記的 MCP 伺服器（Hygiene Backlog）

實際 `.claude/settings.local.json` / harness deferred tools 中已連接但未在本表登記的 MCP 包含：
mcp__computer-use, mcp__plugin_*, mcp__Claude_Preview, mcp__desktop-commander, mcp__memory, mcp__server-memory, mcp__sequential-thinking, mcp__mcp-installer, mcp__mcp-registry, mcp__scheduled-tasks, mcp__kicad, mcp__pdf-viewer 等共 50+ 個。
（注意：mcp__freecad__execute_code 已在 2026-05-09 由 mcad-register-20260509 任務正式登記至 §3 主表。）

**狀態**：屬 Hygiene backlog，由 agent-ops/manager 安排另一輪批次補登（trace 待定，本輪 R3 scope 外，不在此一次補完以避免單次 Edit 過大失控）。

| 已連接但未登記的 MCP 群 | 預估數量 | 補登計畫 |
|---|---|---|
| mcp__computer-use__* | ~30 | 另派 R5 |
| mcp__plugin_*__authenticate / __complete_authentication | ~30+ | 另派 R5 |
| mcp__Claude_Preview__* | ~12 | 另派 R5 |
| mcp__desktop-commander__* | ~25 | 另派 R5 |
| mcp__pdf-viewer / freecad / kicad | ~250+ | 另派 R5（kicad 工具特別多）|

## 4. 如何新增 MCP 伺服器
1. 在 `.claude/settings.json` 或 `.claude/settings.local.json` 中設定 MCP 伺服器
2. 更新此 registry（在 §3 表格中新增一列）
3. 更新相關 agent 的 tools.md（如果 agent 需要使用）
4. Governance 審查

## 5. MCP 與 tools.md 的關係
- tools.md 列出 agent 被授權使用的「系統能力」
- MCP 伺服器提供的工具是額外的擴展能力
- Agent 使用 MCP 工具前，其 tools.md 必須明確授權

## 6. 與現有協議的關係
- 引用 agent-anatomy.md §tools.md 規範
- 引用 definitions.md §Tool 定義
