# Enhance Agent

## When to Enhance
- Agent self-evaluated high but still failed the task
- Agent's skills.md doesn't cover a needed capability within its domain
- User feedback indicates the agent's output quality is lacking
- A new tool becomes available that this agent should use

## Who Does What

| Step | Who |
|------|-----|
| Identify the weakness | Manager |
| Decide enhance vs. create vs. reject | Manager (via `decision-guide.md`) |
| Apply the enhancement | **Agent Builder** |
| Verify and log | Agent Builder + Manager |

## Manager → Agent Builder Dispatch

Manager sends Agent Builder this structured request:
```json
{
  "action": "enhance_agent",
  "agent": "agent-name",
  "enhancement_type": "skill | tool | principle | workflow_step",
  "description": "what to add or change",
  "reason": "why this enhancement is needed"
}
```

Agent Builder then follows `agents/agent-ops/agent-builder/workflow/enhance.md`.
