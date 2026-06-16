# Classification Principles

Every agent in the system MUST follow these rules. No exceptions — not for new agents, not for enhanced agents.

## 1. Single Responsibility
One agent = one clear domain. If you can't describe the agent's job in one sentence, it's too broad.

- Good: "Writes and runs tests" (Tester)
- Bad: "Handles testing, deployment, and monitoring" (too many concerns)

## 2. No Overlap
Two agents must NOT have overlapping responsibilities. Before creating a new agent, verify it doesn't duplicate an existing one.

| If the new capability... | Then... |
|--------------------------|---------|
| Falls entirely within an existing agent's domain | Enhance that agent |
| Spans two existing agents equally | Create a new agent with a narrower, unique scope |
| Is completely new territory | Create a new agent |

## 3. Standard Structure
Every agent folder MUST contain:

```
agents/{agent-name}/
  ├── README.md      ← entry point, dispatch config
  ├── soul.md        ← identity, principles, anti-patterns
  ├── tools.md       ← available tools, usage rules
  ├── skills.md      ← capability list (domain knowledge, not tools)
  ├── workflow.yaml   ← process in YAML (machine-readable)
  ├── org.md         ← hierarchy, collaboration patterns
  ├── worklog/       ← JSON execution logs
  │   └── .gitkeep
  └── memory/        ← persistent knowledge
      └── MEMORY.md
```

No files may be omitted. No extra top-level files without reason.

## 4. Naming
- Folder name: lowercase, single word or hyphenated (`data-engineer`, not `DataEngineer`)
- Agent name in docs: capitalized (`Data Engineer`)
- Name must clearly imply the agent's domain

## 5. Hierarchy Compliance
- All agents report to Manager
- No agent dispatches other agents (only Manager does)
- New agents must be added to Manager's org.md and CLAUDE.md registry

## 6. Protocol Compliance
Every agent must follow:
- `agents/worklog-protocol.md` — log every execution
- `agents/memory-protocol.md` — persist learnings
- `agents/evaluation-protocol.md` — support self-evaluation scoring

## 7. Format Rules
- Workflow: **YAML** (machine-readable). Supplementary docs in `workflow/` subfolder as `.md`.
- Tools/Skills: **Markdown** (human-readable definitions).
- Worklog: **JSON** (machine-readable execution logs).
- No single `.md` file exceeds ~60 lines. Split into folder + router if needed.

## 8. Self-Update Rules

**加法自己來，減法和擴權要審批。**

Agent 可以自己做：
- 寫 `worklog/` 和 `memory/`
- **新增** skill 到 `skills.md`（限自己領域內，標記 `<!-- self-added {date} -->`）
- **新增** step 到 `workflow.yaml`（只加不刪，標記 `# self-added {date}`）

必須經過 Agent Builder：
- 修改 `tools.md`（擴權/縮權）
- 修改 `soul.md`（行為原則）
- 刪除 skill 或 workflow step
- 修改 `org.md`、`README.md`、`CLAUDE.md`

完整規則：`agents/definitions.md`
