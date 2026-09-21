$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$suiteNode = Get-Command node -ErrorAction SilentlyContinue
if ($suiteNode) {
    $suiteNodePath = $suiteNode.Source
} else {
    $suiteNodePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
}
if (!(Test-Path -LiteralPath $suiteNodePath)) { throw 'Install Node.js 22.12+ and run npm ci first.' }
$suiteVitePath = Join-Path $PSScriptRoot 'node_modules/vite/bin/vite.js'
if (!(Test-Path -LiteralPath $suiteVitePath)) { throw 'Dependencies are missing. Open this folder in a terminal and run npm ci --ignore-scripts.' }
Write-Host 'Military Suite: http://127.0.0.1:5173'
Write-Host 'Keep this window open. Stop with Ctrl+C. The old HTML is unchanged.'
Write-Host 'Building the current project...'
& $suiteNodePath $suiteVitePath build --logLevel error
if ($LASTEXITCODE -ne 0) { throw 'Build failed. The old HTML backup is unchanged.' }
& $suiteNodePath $suiteVitePath preview --open
exit $LASTEXITCODE
