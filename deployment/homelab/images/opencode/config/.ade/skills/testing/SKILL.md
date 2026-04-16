---
name: testing
description: Testing strategy, patterns, and execution conventions
---

# Testing

## Strategy
- Follow the test pyramid: many unit tests, fewer integration tests, fewest E2E tests
- Write tests alongside the code — not as an afterthought
- Each test must be independent: no shared mutable state between tests

## Unit Tests
- Test one unit of behavior per test case
- Use descriptive test names that read as specifications
- Mock only direct dependencies, not transitive ones

## Integration & E2E Tests
- Test real interactions between components (DB, HTTP, queue) in integration tests
- Use realistic data and environments — avoid fake setups that hide real issues
- Clean up test data after each test to keep tests isolated

## Execution
- All tests must pass before committing
- Run the full test suite after refactoring, even if only small changes were made
- Treat a flaky test as a bug — fix or delete it, never ignore it
