---
name: adr-nygard
description: Architecture Decision Records following Nygard's lightweight template
---

# Architecture Decision Records (Nygard)

## When to Write an ADR
- When making a significant architectural decision
- When choosing between multiple viable options
- When the decision will be hard to reverse
- When future developers will ask "why did we do this?"

## Template
Store ADRs in `docs/adr/` as numbered markdown files: `NNNN-title-with-dashes.md`

```markdown
# N. Title

## Status
Proposed | Accepted | Deprecated | Superseded by [ADR-NNNN]

## Context
What is the issue that we're seeing that is motivating this decision or change?

## Decision
What is the change that we're proposing and/or doing?

## Consequences
What becomes easier or more difficult to do because of this change?
```

## Rules
- ADRs are immutable once accepted — supersede, don't edit
- Keep context focused on forces at play at the time of the decision
- Write consequences as both positive and negative impacts
- Number sequentially, never reuse numbers
- Title should be a short noun phrase (e.g. "Use PostgreSQL for persistence")
