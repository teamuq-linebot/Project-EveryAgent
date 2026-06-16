# Create Agent

## When to Create
- Evaluation phase reveals a capability gap no existing agent covers
- A task domain appears repeatedly but doesn't fit any current agent
- An existing agent's scope has grown too broad (split it)

## Who Does What

| Step | Who |
|------|-----|
| Identify the gap | Manager |
| Decide create vs. enhance vs. reject | Manager (via `decision-guide.md`) |
| Build the agent | **Agent Builder** |
| Verify and log | Agent Builder + Manager |

## Manager → Agent Builder Dispatch

Manager sends Agent Builder this structured request:
```json
{
  "action": "create_agent",
  "name": "agent-name",
  "domain": "one-sentence description",
  "reason": "why existing agents can't cover this",
  "reference_agent": "existing agent to use as template (optional)"
}
```

Agent Builder then follows `agents/agent-ops/agent-builder/workflow/create.md`.
