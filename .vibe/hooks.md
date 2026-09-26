# AI Memory — Vibe automation status (2026-09-26)

**This file documents what is actually live. Read this before touching the
scripts below.**

## What actually runs

Vibe's hook mechanism is **`hooks.toml`** (`<project>/.vibe/hooks.toml` when the
folder is trusted, plus `~/.vibe/hooks.toml` user-level), with hook types
`post_agent`, `pre_tool` and `post_tool`. See the Vibe skill or
https://docs.mistral.ai/vibe/code/overview for the wire protocol.

The AI-memory automation is configured **user-level** (so it works in every
project, not just this one):

- `~/.vibe/hooks.toml` — a `post_agent` hook that runs
  `~/.vibe/scripts/ai-memory-publish.sh` after every agent turn.
- The script pulls the `ai-memory` repo once per session, commits any notes the
  agent wrote, and pushes them to origin. The `ai-memory` repo always lives in
  the same repos folder as the project being worked on, as a sibling: the script
  walks up from the current directory until it finds a directory named
  `ai-memory` (with `.git` inside). `$AI_MEMORY_DIR` overrides the search.
- `~/.vibe/AGENTS.md` instructs every session to record durable learnings into
  `projects/<Project>/YYYY-MM-DD-<topic>.md` in the `ai-memory` repo without
  being asked.

The agent's job is only to write the note files; publishing is automatic.

## What does NOT run

The `pre-start.sh` and `post-start.sh` next to this file are **legacy**: Vibe
never executes files by those names. They were written for a Windows-only path
(`/c/Repos/Omat/ai-memory`) and describe a hook mechanism that does not exist.
They are kept only as history and are inert.

## On a new machine

1. Clone `ai-memory` into the same repos folder as your projects (it always
   lives next to the project being worked on), or point `AI_MEMORY_DIR` at it.
2. Copy `scripts/ai-memory-publish.sh` from an existing machine (or recreate it)
   to `~/.vibe/scripts/`.
3. Add the `post_agent` hook to `~/.vibe/hooks.toml`.
4. Copy `~/.vibe/AGENTS.md` from an existing machine.
