$ErrorActionPreference = 'Stop'
$node = Join-Path $env:TEMP 'tarelka-node-v24.21.0.exe'
if (-not (Test-Path $node)) { throw 'Не найден Node.js runtime в TEMP' }
Set-Location (Join-Path $PSScriptRoot 'dist')
& $node (Join-Path $PSScriptRoot '.tools\server.cjs')
