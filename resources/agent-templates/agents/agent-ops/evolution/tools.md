# Evolution Agent — Tools

## Primary Tools

| Tool | Purpose |
|------|---------|
| `WebSearch` | 搜尋最新 AI agent 架構、multi-agent 系統實踐、組織學理論 |
| `WebFetch` | 抓取特定文章、論文、部落格的完整內容供深度分析 |
| `Glob` | Find worklog JSON files across all agents |
| `Read` | Read worklog entries, soul.md, skills.md for analysis |
| `Grep` | Search for failure patterns, error keywords in worklogs |
| `Bash` | Run read-only commands: `jq` on worklogs, `wc`, `git log`。無打卡用途。 |

## External Research Tools

### WebSearch — 外部研究
- 搜尋關鍵詞範例：`multi-agent system architecture 2025`、`AI agent orchestration best practices`、`LLM agent role design patterns`
- 組織學研究：`陳宗賢 組織學`、`organizational design theory agent systems`、`role responsibility matrix AI agents`
- 每次分析前執行，確保提案反映最新業界實踐

### WebFetch — 深度參考
- 抓取 arXiv 論文、技術部落格、官方文件
- 用於驗證 WebSearch 找到的關鍵觀點
- 擷取後摘要重點，不逐字複製

## Internal Analysis Tools
- Use `Glob` with pattern `agents/*/worklog/*.json` to collect all execution logs
- Use `Bash` + `jq` to extract `status`, `duration_ms`, `error` fields from worklogs
- Use `Grep` to find recurring error messages across agent memory files

## MCP Tools (Authorized)
| MCP 工具 | 用途 |
|----------|------|
| `mcp__desktop-commander__read_multiple_files` | 讀取 T:\ (Google Drive) 上的 agent 檔案（soul.md、worklog、memory）。**禁用 `read_file`**（僅回傳 metadata，見 google-drive-read.md） |
| `mcp__desktop-commander__list_directory` | 列出 T:\ 上的目錄結構，掃描 agent 資料夾 |
| `mcp__workspace__bash` | read-only 分析命令（jq / wc / git log）。無打卡用途。 |
| `mcp__workspace__web_fetch` | 抓取特定論文、技術部落格、官方文件的完整內容做深度分析 |
| `WebSearch` | 研究 agent 設計最佳實踐、multi-agent 架構、組織學理論 |

> ⚠️ Google Drive 限制：T:\ 路徑必須用 `read_multiple_files`，`read_file` 只回傳 metadata。詳見 `agents/agent-ops/_protocols/rules/google-drive-read.md`

## Do NOT Use
- `Edit`, `Write` — you propose changes, you do not apply them
- Any tool that modifies agent files — that is Agent Builder's job
- Direct dispatching of Developer or Tester — route through Manager

## Tool Usage Guidelines
- **研究順序**：先 WebSearch → 再 WebFetch 關鍵文章 → 再分析內部 worklogs → 最後對照提案
- Read worklogs in batches: process one agent at a time to avoid context overload
- Use `Bash` with `jq` for quantitative analysis (failure counts, average duration)
- Cross-reference findings with agent `soul.md` to identify principle violations
- Never read application source code (src/) — focus only on `agents/` tree
- **Memory exception**: You MAY use `Write` to save learnings to `agents/agent-ops/evolution/memory/` per memory-protocol.md
