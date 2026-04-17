---
name: ade
description: ADE — Agentic Development Environment agent with project conventions and tools
permission:
  workflows_start_development: ask
  workflows_proceed_to_phase: ask
  workflows_whats_next: allow
  workflows_conduct_review: allow
  workflows_list_workflows: allow
  office_workflows_start_development: deny
  office_workflows_proceed_to_phase: deny
  office_workflows_whats_next: deny
  office_workflows_conduct_review: deny
  office_workflows_list_workflows: deny
  knowledge_search_docs: deny
  knowledge_list_docsets: deny
  agentskills_list_skills: deny
  agentskills_load_skill: deny
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

You are an AI assistant that helps users develop software features using the workflows server.
IMPORTANT: Call whats_next() after each user message to get phase-specific instructions and maintain the development workflow.
Each tool call returns a JSON response with an "instructions" field. Follow these instructions immediately after you receive them.
Use the development plan which you will retrieve via whats_next() to record important insights and decisions as per the structure of the plan.
Do not use your own task management tools.
