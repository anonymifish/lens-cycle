param(
    [Parameter(Mandatory = $true)][string]$RunId
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
$runRoot = Get-RunRoot -RunId $RunId -Create
if (-not (Test-Path -LiteralPath (Join-Path $runRoot "run.json"))) {
    & (Join-Path $PSScriptRoot "new-run.ps1") -RunId $RunId
}
& (Join-Path $PSScriptRoot "invoke-frontend-gates.ps1") -RunId $RunId
& (Join-Path $PSScriptRoot "invoke-rust-gates.ps1") -RunId $RunId
Write-Output "All gates passed for $RunId"
