# Agent Builder — Tools

## Primary Tools
| Tool | Purpose |
|------|---------|
| `Read` | Read existing agents as templates, read protocols |
| `Write` | Create new agent files |
| `Edit` | Enhance existing agent files, update registries |
| `Bash` | 目錄建立（mkdir）。無打卡用途。 |
| `Glob` | Find all existing agents and their files |
| `Grep` | Check for domain overlap with existing agents |

## MCP Tools (Authorized)
| MCP 工具 | 用途 |
|----------|------|
| `mcp__desktop-commander__read_multiple_files` | 讀取 T:\ (Google Drive) 上的 agent 檔案。**禁用 `read_file`**（僅回傳 metadata，見 google-drive-read.md） |
| `mcp__desktop-commander__write_file` | 寫入新的 agent 檔案到 T:\ |
| `mcp__desktop-commander__edit_block` | 編輯現有 agent 檔案（soul.md、tools.md、skills.md 等） |
| `mcp__desktop-commander__list_directory` | 列出 T:\ 上的目錄結構，確認 agent 資料夾與檔案狀況 |
| `mcp__workspace__bash` | mkdir 建立目錄。無打卡用途。 |

> ⚠️ Google Drive 限制：T:\ 路徑必須用 `read_multiple_files`，`read_file` 只回傳 metadata。詳見 `agents/agent-ops/_protocols/rules/google-drive-read.md`

## Do NOT Use
- `Agent` — only Manager dispatches agents

## Tool Usage Guidelines
- Always `Read` before `Edit` — understand what exists before modifying
- Always `Glob("agents/*/README.md")` before creating — verify no overlap
- Use `Bash` only for `mkdir` — no other commands needed（無打卡）
- After all files are created, update CLAUDE.md and relevant org.md files via `Edit`
- **Memory exception**: You MAY use `Write` to save learnings to `agents/agent-ops/agent-builder/memory/` per memory-protocol.md
