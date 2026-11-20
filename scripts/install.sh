#!/usr/bin/env bash
# Build the playground and install the /playground skill for Claude Code.
# Run inside WSL (or Linux/macOS). On WSL the skill goes to the Windows user's ~/.claude,
# because that's where the Claude desktop app reads skills from.
set -euo pipefail
cd "$(dirname "$0")/.."

npm install --no-audit --no-fund
npm run build

if grep -qi microsoft /proc/version 2>/dev/null && command -v cmd.exe >/dev/null; then
  win_home=$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')
  claude_dir="$(wslpath -u "$win_home")/.claude"
else
  claude_dir="$HOME/.claude"
fi

dest="$claude_dir/skills/playground"
mkdir -p "$dest"
cp skill/SKILL.md "$dest/SKILL.md"
echo "Installed skill to $dest"
echo "Try: /playground path/to/page.html"
