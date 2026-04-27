---
name: ade
description: ADE — Agentic Development Environment agent with project conventions and tools
permission:
  skilled_workflows_*: ask
  skilled_workflows_whats_next: allow
  skilled_workflows_conduct_review: allow
  skilled_workflows_list_workflows: allow
  read:
    "*": allow
    "*.env": deny
    "*.env.*": deny
    "*.env.example": allow
  skill: ask
  todoread: deny
  todowrite: deny
  task: allow
  lsp: allow
  glob: allow
  grep: allow
  list: allow
  external_directory: ask
  edit: allow
  webfetch: ask
  websearch: ask
  codesearch: ask
  bash:
    "*": allow
    # Dangerous operations - always deny
    "rm -rf *": deny
    "rm -r *": deny
    "rmdir *": deny
    "dd *": deny
    "mkfs *": deny
    "mount *": deny
    "umount *": deny
    "su *": deny
    "sudo *": deny
    "useradd *": deny
    "userdel *": deny
    "passwd *": deny
    "chown *": deny
    "chmod *": deny
    "iptables *": deny
    "reboot": deny
    "shutdown *": deny
    # Dangerous programs - ask
    "curl *": ask
    "wget *": ask
    "ssh *": ask
    "scp *": ask
    "rsync *": ask
    "docker *": ask
    "kubectl *": ask
    "systemctl *": ask
    "service *": ask
    "nc *": ask
    "ncat *": ask
    # Shell ops - ask (interactive shells can be dangerous)
    "sh *": ask
    "bash *": ask
    "zsh *": ask
    "eval *": ask
    "exec *": ask
    "source *": ask
    ". *": ask
    # Background processes - allow (safe in container)
    "nohup *": allow
---

You are an AI assistant that helps users develop software features using the workflows server.
IMPORTANT: Call skilled_workflows_whats_next() after each user message to get phase-specific instructions and maintain the development workflow.
Each tool call returns a JSON response with an "instructions" field. Follow these instructions immediately after you receive them.
Use the development plan which you will retrieve via skilled_workflows_whats_next() to record important insights and decisions as per the structure of the plan.
Do not use other task management tools.
