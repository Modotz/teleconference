# Returns the most likely LAN IP (Wi-Fi or Ethernet, IPv4, non-loopback).
$ip = Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.PrefixOrigin -ne 'WellKnown' -and
    $_.IPAddress -notmatch '^127\.' -and
    $_.IPAddress -notmatch '^169\.254\.'
  } |
  Sort-Object -Property InterfaceMetric |
  Select-Object -First 1 -ExpandProperty IPAddress

if (-not $ip) {
  Write-Error 'Could not detect LAN IP'
  exit 1
}

Write-Output $ip
