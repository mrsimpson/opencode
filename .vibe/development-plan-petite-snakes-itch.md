# Development Plan: repo (petite-snakes-itch branch)

_Generated on 2026-04-26 by Vibe Feature MCP_
_Workflow: [minor](https://codemcp.github.io/workflows/workflows/minor)_

## Goal

Add autocomplete for repository and branch selection in the opencode-router-app based on the authenticated user's GitHub/GitLab accounts.

## Key Decisions

- **Custom Autocomplete Component**: Built a custom focus-triggered autocomplete dropdown in opencode-router-app instead of reusing the TUI autocomplete. This provides better UX (focus-triggered vs trigger-char) and keeps packages decoupled.
- **Backend API**: Added endpoints to opencode-router that call GitHub API using the user's stored token.
- **Lazy Loading**: Repos are loaded lazily on component mount to avoid blocking the UI.

## Explore

### Tasks

- [x] Explore codebase structure
- [x] Identify where autocomplete would fit
- [x] Find backend services for user auth

### Completed

- [x] Created development plan file

## Implement

### Tasks

- [x] Add backend API endpoints for listing repos and branches
- [x] Add API client functions in opencode-router-app
- [x] Build custom Autocomplete component
- [x] Integrate Autocomplete into SessionInputBar

### Completed

- Backend: `/api/user/repos` - list user's GitHub repos
- Backend: `/api/user/repos/branches` - list branches for a repo
- Frontend: `listUserRepos()`, `listRepoBranches()` API functions
- Frontend: `Autocomplete` component with keyboard nav
- Frontend: Updated `SessionInputBar` with Autocomplete for repo/branch

## Finalize

### Tasks

- [ ] Test the implementation
- [ ] Verify the backend API handles auth correctly

### Completed

_None yet_

---

_This plan is maintained by the LLM. Tool responses provide guidance on which section to focus on and what tasks to work on._
