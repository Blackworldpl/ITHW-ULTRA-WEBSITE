param([string]$NodeDirectory = '', [string]$LanAddress = '')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if ($NodeDirectory) {
  $nodePath = Join-Path $NodeDirectory 'node.exe'
  if (!(Test-Path -LiteralPath $nodePath)) { throw 'Nie znaleziono node.exe we wskazanym katalogu.' }
  $env:PATH = $NodeDirectory + ';' + $env:PATH
} elseif (!(Get-Command node -ErrorAction SilentlyContinue)) {
  $portableRoot = Join-Path $env:USERPROFILE '.codex\tmp\it-hardware-tools'
  $portableNode = Get-ChildItem -LiteralPath $portableRoot -Filter 'node-v24*-win-x64' -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
  if (!$portableNode) { throw 'Zainstaluj Node.js 24 LTS lub podaj -NodeDirectory ze zweryfikowaną wersją przenośną.' }
  $env:PATH = $portableNode.FullName + ';' + $env:PATH
}
if (!(Test-Path -LiteralPath 'node_modules')) {
  & npm.cmd ci --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Instalacja zależności nie powiodła się.' }
}
$launcherArguments = @('--import', 'tsx', 'scripts/local-postgres.ts', '--with-app')
if ($LanAddress) { $launcherArguments += @('--lan-address', $LanAddress) }
& node @launcherArguments
exit $LASTEXITCODE
