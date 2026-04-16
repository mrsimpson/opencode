---
name: conventional-commits
description: Conventional Commits specification for structured commit messages
---

# Conventional Commits

## Format
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Types
- `feat`: A new feature (correlates with MINOR in SemVer)
- `fix`: A bug fix (correlates with PATCH in SemVer)
- `docs`: Documentation only changes
- `style`: Changes that do not affect the meaning of the code
- `refactor`: A code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

## Rules
- Subject line must not exceed 72 characters
- Use imperative mood in the subject line ("add" not "added")
- Do not end the subject line with a period
- Separate subject from body with a blank line
- Use the body to explain what and why, not how
- `BREAKING CHANGE:` footer or `!` after type/scope for breaking changes
