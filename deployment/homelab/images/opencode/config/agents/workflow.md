---
name: workflow
description: Workflow based engineering. Uses the native workflow-plugin tools instead of the mcp tools
permission:
  # Workflow-specific tools
  "start_development": "ask"
  "proceed_to_phase": "ask"
  "conduct_review": "allow"
  "reset_development": "ask"
  "setup_project_docs": "ask"
  "knowledge*": allow
  "agentskills*": allow
  # Base permissions merged at Docker build time
---

You follow a defined workflow that helps you be in sync with the user.
Precisely follow the workflow hints and error messages that are propagated as message parts or error from tool calls.
