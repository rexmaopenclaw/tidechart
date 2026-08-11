# Tidechart Deploy Script - one command: edit -> deploy
# Usage: .\deploy.ps1 "commit message"
# Steps: syntax check -> git commit+push -> wrangler deploy -> verify

param(
    [string]$msg = "update"
)

Set-Location $PSScriptRoot
Write-Host "=== 1. Syntax check ===" -ForegroundColor Cyan
node --check public/app.js
if ($LASTEXITCODE -ne 0) { Write-Host "app.js syntax ERROR - abort" -ForegroundColor Red; exit 1 }
node --check worker/index.js
if ($LASTEXITCODE -ne 0) { Write-Host "worker/index.js syntax ERROR - abort" -ForegroundColor Red; exit 1 }
Write-Host "Syntax OK" -ForegroundColor Green

Write-Host "`n=== 2. Git commit + push ===" -ForegroundColor Cyan
git add -A
git commit -m $msg
git push origin main
if ($LASTEXITCODE -ne 0) { Write-Host "git push FAILED" -ForegroundColor Red; exit 1 }
Write-Host "Pushed to GitHub" -ForegroundColor Green

Write-Host "`n=== 3. Deploy Cloudflare ===" -ForegroundColor Cyan
npx wrangler deploy
if ($LASTEXITCODE -ne 0) { Write-Host "deploy FAILED" -ForegroundColor Red; exit 1 }

Write-Host "`n=== 4. Verify ===" -ForegroundColor Cyan
$site = curl.exe -s -o NUL -w "%{http_code}" https://tidechart.rexmaopenclaw.workers.dev/
Write-Host "Site: $site"
if ($site -eq "200") { Write-Host "DONE! Live at https://tidechart.rexmaopenclaw.workers.dev/" -ForegroundColor Green }
else { Write-Host "Site check failed: $site" -ForegroundColor Red }
