---
name: coding
description: Code style, patterns, and implementation conventions
---

# Coding

## Style
- Follow the project's existing code style and linter rules unconditionally
- Write self-documenting code: prefer expressive names over comments that explain *what*
- Use comments only to explain *why* when the reason is non-obvious

## Patterns
- Prefer pure functions and immutable data structures
- Keep functions small and focused on a single responsibility
- Avoid deep nesting — use early returns, guard clauses, and extraction
- Prefer composition over inheritance

## Quality Gates
- Run the linter and type-checker before declaring a task done
- Fix all warnings, not just errors
- Ensure the build passes end-to-end before moving on
