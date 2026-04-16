---
name: application-design
description: Design patterns for authentication, routing, error handling, and forms
---

# Application Design

## Authentication & Authorization
- Authenticate at the edge (middleware/guard) — never inside business logic
- Use short-lived tokens (JWT or session) with refresh strategies
- Apply the principle of least privilege for all role/permission checks

## Routing
- Use declarative, file-based or configuration-driven routing where available
- Protect routes with auth guards rather than ad-hoc checks
- Keep route handlers thin — delegate to services immediately

## Error Handling
- Distinguish between operational errors (expected) and programmer errors (bugs)
- Return structured error responses with consistent shape (code, message, details)
- Log errors with context (request id, user id, stack trace) for observability
- Never expose internal stack traces or sensitive data to clients

## Forms & Validation
- Validate input at the boundary (schema-first with Zod, Yup, Joi, etc.)
- Show inline, field-level validation errors in the UI
- Prevent double-submission by disabling submit controls during in-flight requests
