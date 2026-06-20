# Opens Windows Firewall ports needed for LAN teleconference testing.
# Must run as Administrator. Right-click PowerShell -> Run as administrator.

$ErrorActionPreference = 'Stop'

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Error "This script must be run as Administrator."
  exit 1
}

$rules = @(
  @{ Name = 'Teleconference-Frontend-3000';   Port = 3000;          Proto = 'TCP' },
  @{ Name = 'Teleconference-Backend-4000';    Port = 4000;          Proto = 'TCP' },
  @{ Name = 'Teleconference-Mediasoup-UDP';   Port = '40000-40100'; Proto = 'UDP' }
)

foreach ($r in $rules) {
  Remove-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue
  New-NetFirewallRule `
    -DisplayName $r.Name `
    -Direction Inbound `
    -Action Allow `
    -Protocol $r.Proto `
    -LocalPort $r.Port `
    -Profile Private,Domain | Out-Null
  Write-Host ("Opened " + $r.Proto + " " + $r.Port + " (" + $r.Name + ")") -ForegroundColor Green
}

Write-Host ""
Write-Host "Firewall rules added (Private + Domain profiles only)." -ForegroundColor Green
Write-Host "To remove later, run: Remove-NetFirewallRule -DisplayName 'Teleconference-*'" -ForegroundColor Yellow
