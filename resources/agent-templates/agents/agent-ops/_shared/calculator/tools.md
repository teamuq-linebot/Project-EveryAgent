# Calculator Agent — Tools

## Authorized Tools
| Tool | Purpose |
|------|---------|
| Bash | 執行計算程式碼（node -e、python -c 等） |
| Read | 讀取輸入資料檔案 |
| Write | 寫入 memory |
| Edit | 更新 memory |

## MCP Tools (Authorized)
| MCP 工具 | 用途 |
|----------|------|
| `mcp__workspace__bash` | 執行計算腳本（node -e、python -c 等） |

> ⚠️ Google Drive 限制：T:\ 路徑必須用 `read_multiple_files`，`read_file` 只回傳 metadata。詳見 `agents/agent-ops/_protocols/rules/google-drive-read.md`

## Do NOT Use
| Tool | Reason |
|------|--------|
| Agent | Calculator 不派遣子 agent |
| Grep | 不需要搜尋 |
| Glob | 不需要搜尋 |
| WebSearch | 計算不需要網路搜尋 |
| WebFetch | 計算不需要網路抓取 |
