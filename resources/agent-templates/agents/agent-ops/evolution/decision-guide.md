# Decision Guide: Create vs. Enhance vs. Reject

```
Manager detects capability gap
  │
  ▼
Does this fall within an existing agent's domain?
  │
  ├─ YES → Is the agent's soul/skills already supposed to cover this?
  │         │
  │         ├─ YES, but failed → ENHANCE (refine soul or skills)
  │         └─ NO, new sub-capability → ENHANCE (add to skills)
  │
  └─ NO → Does this represent a recurring need?
           │
           ├─ YES → Does it overlap with multiple existing agents?
           │         │
           │         ├─ YES → Can scope be narrowed to avoid overlap?
           │         │         │
           │         │         ├─ YES → CREATE with narrow scope
           │         │         └─ NO → REJECT (distribute across existing agents instead)
           │         │
           │         └─ NO → CREATE
           │
           └─ NO (one-off task) → REJECT
               Manager handles it by combining existing agents creatively,
               or does it directly as an exception.
```

## Examples

| Situation | Decision | Reasoning |
|-----------|----------|-----------|
| Need database migration expertise | **Enhance** Developer | Falls within Developer's domain, add migration skill |
| Need ongoing security auditing | **Create** Security agent | Distinct domain, recurring need, doesn't overlap with Reviewer |
| Need to send a Slack notification once | **Reject** | One-off, Manager or DevOps can handle |
| Need API documentation generation | **Enhance** Developer or **Create** Documenter | Depends on frequency — if recurring, create; if occasional, enhance |
| Need data pipeline orchestration | **Create** Data Engineer | New domain, doesn't fit existing agents |
| Need both frontend and backend work | **Reject** creating "Fullstack" agent | Overlaps Developer — instead dispatch 2 Developer agents with different scopes |
