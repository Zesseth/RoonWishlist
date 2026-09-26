#!/bin/bash
# LEGACY — Vibe does not execute this file (see hooks.md in this directory).
# Kept only so a manual run still works. The live automation is the user-level
# post_agent hook: ~/.vibe/hooks.toml -> ~/.vibe/scripts/ai-memory-publish.sh.

# The ai-memory repo always lives in the same repos folder as the project being
# worked on, as a sibling: walk up from the current directory until a directory
# named "ai-memory" (with a .git inside) appears.
REPO=""
if [ -n "${AI_MEMORY_DIR:-}" ] && [ -d "${AI_MEMORY_DIR}/.git" ]; then
  REPO="$AI_MEMORY_DIR"
else
  dir="$PWD"
  while :; do
    parent="$(dirname "$dir")"
    if [ -d "$parent/ai-memory/.git" ]; then
      REPO="$parent/ai-memory"
      break
    fi
    [ "$dir" = "/" ] || [ "$dir" = "$parent" ] && break
    dir="$parent"
  done
fi

if [ -n "$REPO" ]; then
    echo "[AI-Memory] Paivitetaan repositorio ($REPO)..."
    git -C "$REPO" pull || git -C "$REPO" -c credential.helper= -c credential.helper=store pull
    echo "[AI-Memory] Repositorio päivitetty!"
fi
