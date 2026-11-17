# Installs Infimeety on Windows, as a normal app that updates itself. In PowerShell:
#   irm https://infimeety.pages.dev/install.ps1 | iex
# Running it again installs the newest version over the old one (your sign-in and settings stay).
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # the progress bar makes downloads many times slower

Write-Host 'Installing Infimeety...'
$setup = Join-Path $env:TEMP 'Infimeety-Setup.exe'
Invoke-WebRequest 'https://github.com/teamcreatovert/infimeety/releases/latest/download/Infimeety-Setup.exe' -OutFile $setup -UseBasicParsing

# /S: the installer's quiet mode. It installs for you only, so it never asks for an admin password.
Start-Process $setup -ArgumentList '/S' -Wait
Remove-Item $setup -ErrorAction SilentlyContinue

$app = Join-Path $env:LOCALAPPDATA 'Infimeety\infimeety.exe'
if (Test-Path $app) {
  Start-Process $app
  Write-Host 'Done. Infimeety is in your Start menu and updates itself.'
} else {
  Write-Host 'Installed. Open Infimeety from your Start menu.'
}
