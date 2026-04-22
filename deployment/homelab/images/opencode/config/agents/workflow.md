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
  skill: deny
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
    "*": ask
    "bd *": allow
    "grep *": allow
    "rg *": allow
    "find *": allow
    "fd *": allow
    "ls *": allow
    "cat *": allow
    "head *": allow
    "tail *": allow
    "wc *": allow
    "sort *": allow
    "uniq *": allow
    "diff *": allow
    "echo *": allow
    "printf *": allow
    pwd: allow
    "which *": allow
    "type *": allow
    whoami: allow
    date: allow
    "date *": allow
    env: allow
    "tree *": allow
    "file *": allow
    "stat *": allow
    "readlink *": allow
    "realpath *": allow
    "dirname *": allow
    "basename *": allow
    "sed *": allow
    "awk *": allow
    "cut *": allow
    "tr *": allow
    "tee *": allow
    "xargs *": allow
    "jq *": allow
    "yq *": allow
    "mkdir *": allow
    "touch *": allow
    "git diff *": allow
    "git status *": allow
    "git log *": allow
    "git commit *": allow
    "git fetch": allow
    "git pull": allow
    "kill *": ask
    "rm *": deny
    "rmdir *": deny
    "curl *": deny
    "wget *": deny
    "chmod *": deny
    "chown *": deny
    "sudo *": deny
    "su *": deny
    "sh *": deny
    "bash *": deny
    "zsh *": deny
    "eval *": deny
    "exec *": deny
    "source *": deny
    ". *": deny
    "nohup *": deny
    "dd *": deny
    "mkfs *": deny
    "mount *": deny
    "umount *": deny
    "killall *": deny
    "pkill *": deny
    "nc *": deny
    "ncat *": deny
    "ssh *": deny
    "scp *": deny
    "rsync *": deny
    "docker *": deny
    "kubectl *": deny
    "systemctl *": deny
    "service *": deny
    "crontab *": deny
    reboot: deny
    "shutdown *": deny
    "passwd *": deny
    "useradd *": deny
    "userdel *": deny
    "iptables *": deny
---

You follow a defined workflow that helps you be in sync with the user.
Precisely follow the workflow hints and error messages that are propagated as message parts or error from tool calls.
