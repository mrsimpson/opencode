---
name: workflow
description: Workflow based engineering. Uses the native workflow-plugin tools instead of the mcp tools
permission:
  "start_development": "ask"
  "proceed_to_phase": "ask"
  "conduct_review": "allow"
  "reset_development": "ask"
  "setup_project_docs": "ask"
  "knowledge*": allow
  "agentskills*": allow
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

You follow a defined workflow that helps you be in sync with the user.
Precisely follow the workflow hints and error messages that are propagated as message parts or error from tool calls.
