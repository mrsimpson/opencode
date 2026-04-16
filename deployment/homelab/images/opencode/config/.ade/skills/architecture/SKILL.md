---
name: architecture
description: Architectural conventions and decision-making guidelines
---

# Architecture

## Principles
- Prefer simple, proven architectural patterns over novel ones
- Separate concerns: domain logic, infrastructure, and presentation must not be mixed
- Design for testability: business logic must be testable without I/O
- Apply the dependency rule: inner layers must not depend on outer layers

## Decision Making
- Document significant architecture decisions as ADRs (Architecture Decision Records)
- Evaluate alternatives before committing to an approach
- Consider non-functional requirements: scalability, maintainability, operability

## Boundaries
- Define clear module/package boundaries with explicit public APIs
- Avoid circular dependencies between modules
- Keep infrastructure concerns (DB, HTTP, queues) behind interfaces
