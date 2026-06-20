# Generates HTTPS certificates for local development using mkcert.
# mkcert installs a local Certificate Authority that browsers (and phones, after
# you copy the root CA there) trust automatically — no scary warning page.
#
# Prerequisite (one-time):
#   1. Install mkcert: https://github.com/FiloSottile/mkcert/releases
#      (or via Chocolatey: choco install mkcert)
#   2. Run once as admin: mkcert -install
#
# Then run this script to generate certs that include localhost AND your LAN IP.

$ErrorActionPreference = 'Stop'

# Check mkcert is installed
$mkcert = Get-Command mkcert -ErrorAction SilentlyContinue
if (-not $mkcert) {
  Write-Error @'
mkcert is not installed.

Install options:
  1. Chocolatey:  choco install mkcert
  2. Scoop:       scoop bucket add extras; scoop install mkcert
  3. Manual:      https://github.com/FiloSottile/mkcert/releases
                  (download .exe and put it in PATH)

After installing, run ONCE as administrator:
  mkcert -install
'@
  exit 1
}

# Detect LAN IP
$lanIp = & "$PSScriptRoot\get-lan-ip.ps1"
Write-Host "Detected LAN IP: $lanIp" -ForegroundColor Cyan

$certsDir = Join-Path $PSScriptRoot '..\certs'
$certsDir = (Resolve-Path $certsDir).Path

Push-Location $certsDir
try {
  Write-Host "Generating cert for: localhost 127.0.0.1 $lanIp" -ForegroundColor Cyan
  & mkcert -key-file key.pem -cert-file cert.pem localhost 127.0.0.1 $lanIp
  if ($LASTEXITCODE -ne 0) { throw "mkcert failed" }
}
finally {
  Pop-Location
}

# Show root CA path so user can install it on their phone
$caRoot = & mkcert -CAROOT
Write-Host ""
Write-Host "Certs written to: $certsDir" -ForegroundColor Green
Write-Host "Files:"
Get-ChildItem $certsDir -Filter '*.pem' | ForEach-Object { Write-Host "  $($_.Name)" }
Write-Host ""
Write-Host "To trust certs on your phone:" -ForegroundColor Yellow
Write-Host "  1. Copy this file to your phone:"
Write-Host "       $caRoot\rootCA.pem"
Write-Host "  2. Install it as a CA certificate:"
Write-Host "       Android: Settings > Security > Install from storage > CA certificate"
Write-Host "       iOS:     Email/AirDrop the file > Install profile, then enable in"
Write-Host "                Settings > General > About > Certificate Trust Settings"
Write-Host ""
Write-Host "Then on your phone, open: https://${lanIp}:3000" -ForegroundColor Green
