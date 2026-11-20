#!/usr/bin/env bash
# Build the playground and install the /playground skill for Claude Code.
# Works on macOS, Linux, WSL and Git Bash on Windows. Needs Node.js 20+.
# The skill folder gets SKILL.md plus the built tool (dist/), so it runs without this repo.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required: https://nodejs.org" >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo "Node.js 20+ is required (found $(node -v))" >&2
  exit 1
fi

npm install --no-audit --no-fund
npm run build

install_to() {
  local dest="$1/playground"
  mkdir -p "$dest"
  rm -rf "$dest/dist"
  cp skill/SKILL.md "$dest/SKILL.md"
  cp -R dist "$dest/dist"
  echo "Installed skill to $dest"
}

if [ -n "${CLAUDE_SKILLS_DIR:-}" ]; then
  install_to "$CLAUDE_SKILLS_DIR"
else
  install_to "$HOME/.claude/skills"
  # In WSL, also install for Claude Code on the Windows side (the desktop app reads skills there).
  # It runs the tool through WSL's Node unless Windows has Node of its own.
  if grep -qi microsoft /proc/version 2>/dev/null && command -v cmd.exe >/dev/null 2>&1; then
    win_home=$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')
    [ -n "$win_home" ] && install_to "$(wslpath -u "$win_home")/.claude/skills"
  fi
fi
echo "Try: /playground path/to/page.html"
