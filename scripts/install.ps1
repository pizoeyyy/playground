# Build the playground and install the /playground skill for Claude Code on Windows.
# Run from PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\install.ps1
# Needs Node.js 20+ (https://nodejs.org). The skill folder gets SKILL.md plus the built
# tool (dist\), so it runs without this repo.
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error 'Node.js 20+ is required: https://nodejs.org'
}
$major = [int](node -p "process.versions.node.split('.')[0]")
if ($major -lt 20) {
  Write-Error "Node.js 20+ is required (found $(node -v))"
}

npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { Write-Error 'npm install failed' }
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error 'npm run build failed' }

if ($env:CLAUDE_SKILLS_DIR) { $skills = $env:CLAUDE_SKILLS_DIR } else { $skills = Join-Path $env:USERPROFILE '.claude\skills' }
$dest = Join-Path $skills 'playground'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$destDist = Join-Path $dest 'dist'
if (Test-Path $destDist) { Remove-Item -Recurse -Force $destDist }
Copy-Item -Force 'skill\SKILL.md' (Join-Path $dest 'SKILL.md')
Copy-Item -Recurse 'dist' $destDist
Write-Host "Installed skill to $dest"
Write-Host 'Try: /playground path\to\page.html'
