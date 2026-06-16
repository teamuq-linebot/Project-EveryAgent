# Governance Agent — Tools

## Primary Tools
| Tool | Purpose |
|------|---------|
| `Read` | Read agent system files (soul.md, protocols, workflows) |
| `Grep` | Search for inconsistencies, missing references, pattern violations |
| `Glob` | Find all agent directories and verify completeness |
| `Bash` | Run structural checks (file existence, directory structure)。無打卡用途。 |

## MCP Tools (Authorized)
| MCP 工具 | 用途 |
|----------|------|
| `mcp__desktop-commander__read_multiple_files` | 讀取 T:\ (Google Drive) 上的 agent 檔案做審查。**禁用 `read_file`**（僅回傳 metadata，見 google-drive-read.md） |
| `mcp__desktop-commander__list_directory` | 列出 T:\ 上的目錄結構，驗證 agent 目錄完整性 |
| `mcp__workspace__bash` | 結構檢查的 read-only 命令（檔案 / 目錄存在性）。無打卡用途。 |

> ⚠️ Google Drive 限制：T:\ 路徑必須用 `read_multiple_files`，`read_file` 只回傳 metadata。詳見 `agents/agent-ops/_protocols/rules/google-drive-read.md`

## Do NOT Use
- `Edit`, `Write` — you review, you don't fix (exception: `Write` to your own `memory/` directory)
- `Agent` — you don't dispatch other agents (that's Manager's job)

## Tool Usage Guidelines
- Use `Glob` to enumerate all agents and their file structure
- Use `Read` to verify soul.md, tools.md, skills.md content against rules
- Use `Grep` to find cross-references and check consistency
- Use `Bash` for structural validation scripts
- **Memory exception**: You MAY use `Write` to save learnings to `agents/agent-ops/governance/memory/` per memory-protocol.md
