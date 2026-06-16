# Starts Hardhat node (new window), waits for RPC, deploys NINK registry.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "Starting Hardhat node in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; npx hardhat node"

function Test-HardhatRpc {
  try {
    $body = '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}'
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:8545" -Method POST -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 2
    $json = $r.Content | ConvertFrom-Json
    return ([int]::Parse($json.result, [System.Globalization.NumberStyles]::HexNumber) -eq 31337)
  } catch {
    return $false
  }
}

Write-Host "Waiting for http://127.0.0.1:8545 ..."
for ($i = 0; $i -lt 30; $i++) {
  if (Test-HardhatRpc) { break }
  Start-Sleep -Seconds 1
}

if (-not (Test-HardhatRpc)) {
  Write-Error "Hardhat node did not become ready in time."
}

Write-Host "Deploying NinkAnchorRegistry to localhost..."
npx hardhat run scripts/deploy.js --network localhost

Write-Host ""
Write-Host "Local stack is ready."
Write-Host "  RPC:      http://127.0.0.1:8545"
Write-Host "  Chain ID: 31337"
Write-Host ""
Write-Host "In NINK extension: turn Mock mode OFF, reload extension, sign off."
