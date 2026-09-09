param(
    [string]$RunId = (Get-Date -Format "yyyyMMdd-HHmmss")
)

. (Join-Path $PSScriptRoot "common.ps1")

$runRoot = Get-RunRoot -RunId $RunId -Create
$manifestPath = Join-Path $runRoot "run.json"
if (Test-Path -LiteralPath $manifestPath) {
    throw "Run already exists: $runRoot"
}
$manifest = [ordered]@{
    runId = $RunId
    createdAt = (Get-Date).ToString("o")
    status = "created"
    dataDirectory = "data"
    cargoTargetDirectory = "cargo-target"
    frontendDirectory = "frontend-dist"
    coverageDirectory = "coverage"
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Output "RunId=$RunId"
Write-Output "RunRoot=$runRoot"
