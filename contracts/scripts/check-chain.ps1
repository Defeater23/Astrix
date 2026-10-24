<#
  Read-only chain check for the Module 03 setup. Requires Foundry's `cast` on PATH.
  Never needs a private key. Usage (PowerShell):

    .\scripts\check-chain.ps1 -RpcUrl http://127.0.0.1:8545
    .\scripts\check-chain.ps1 -RpcUrl https://<your-sepolia-rpc> -SmartAccount 0x...

  It prints the chain ID, whether code exists at the EntryPoint v0.7 address, and, if given,
  whether code exists at the smart-account address. Presence of code does not prove the bytecode
  is the canonical release; compare it against the official deployment separately.
#>
param(
  [Parameter(Mandatory = $true)][string]$RpcUrl,
  [string]$SmartAccount = ""
)

$ErrorActionPreference = "Stop"
$EntryPoint = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"

function Test-HasCode([string]$Address) {
  $code = (cast code $Address --rpc-url $RpcUrl).Trim()
  return ($code -ne "0x" -and $code.Length -gt 2)
}

Write-Host ("Chain ID: " + (cast chain-id --rpc-url $RpcUrl))
Write-Host ("EntryPoint v0.7 code present: " + (Test-HasCode $EntryPoint))
if ($SmartAccount -ne "") {
  Write-Host ("Smart account code present:   " + (Test-HasCode $SmartAccount))
}
