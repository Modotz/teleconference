# One-shot setup for HTTPS + LAN/phone testing.
# - Detects your LAN IP
# - Runs mkcert to generate certs covering localhost + LAN IP
# - Updates backend/.env MEDIASOUP_ANNOUNCED_IP to "127.0.0.1,<lan-ip>"
#
# The frontend needs NO env changes — it auto-derives the backend URL from
# whatever address you open (localhost or LAN IP).

$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$backendEnv = Join-Path $root 'backend\.env'

# 1. Detect LAN IP
$lanIp = & "$PSScriptRoot\get-lan-ip.ps1"
Write-Host "Detected LAN IP: $lanIp" -ForegroundColor Cyan

# 2. Generate certs (mkcert) covering localhost + this LAN IP
& "$PSScriptRoot\generate-certs.ps1"
if ($LASTEXITCODE -ne 0) { exit 1 }

# 3. Update backend/.env — keep 127.0.0.1 AND add the LAN IP
if (Test-Path $backendEnv) {
  $content = Get-Content $backendEnv -Raw
  $content = $content -replace '(?m)^MEDIASOUP_ANNOUNCED_IP=.*$', "MEDIASOUP_ANNOUNCED_IP=127.0.0.1,$lanIp"
  Set-Content -Path $backendEnv -Value $content -Encoding utf8 -NoNewline
  Write-Host "Updated backend/.env (MEDIASOUP_ANNOUNCED_IP=127.0.0.1,$lanIp)" -ForegroundColor Green
}
else {
  Write-Warning "backend/.env not found - copy backend/.env.example to backend/.env first"
}

# 4. Summary
Write-Host ""
Write-Host "==============================================" -ForegroundColor Yellow
Write-Host "Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "LOCALHOST (HTTP, quick dev):" -ForegroundColor Yellow
Write-Host "  Terminal 1:  cd backend  ; npm run dev"
Write-Host "  Terminal 2:  cd frontend ; npm run dev"
Write-Host "  Open:        http://localhost:3000"
Write-Host ""
Write-Host "LAN / PHONE (HTTPS):" -ForegroundColor Yellow
Write-Host "  Terminal 1:  cd backend  ; npm run dev:https"
Write-Host "  Terminal 2:  cd frontend ; npm run dev:https"
Write-Host "  Open laptop: https://localhost:3000"
Write-Host "  Open phone:  https://${lanIp}:3000"
Write-Host ""
Write-Host "Firewall must allow ports 3000, 4000, and UDP 40000-40100" -ForegroundColor Yellow
Write-Host "(run scripts\open-firewall.ps1 as administrator once)" -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Yellow
