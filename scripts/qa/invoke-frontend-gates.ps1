param(
    [Parameter(Mandatory = $true)][string]$RunId
)

. (Join-Path $PSScriptRoot "common.ps1")

$workspace = Get-WorkspaceRoot
$runRoot = Get-RunRoot -RunId $RunId -Create
$coverage = Join-Path $runRoot "coverage"
$log = Join-Path $runRoot "logs\frontend-gates.log"
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$env:TEMP = Join-Path $runRoot "temp"
$env:TMP = $env:TEMP

Push-Location $workspace
try {
    Invoke-LoggedNative "environment" $log { pnpm check:environment }
    Invoke-LoggedNative "typecheck" $log { pnpm typecheck }
    Invoke-LoggedNative "eslint" $log { pnpm lint }
    Invoke-LoggedNative "frontend coverage" $log {
        pnpm exec vitest run --coverage --coverage.provider=v8 --coverage.reporter=text --coverage.reporter=json-summary `
            "--coverage.reportsDirectory=$coverage" '--coverage.include=src/**/*.{ts,tsx}' `
            '--coverage.exclude=src/**/*.test.{ts,tsx}' '--coverage.exclude=src/vite-env.d.ts' `
            --coverage.thresholds.lines=90 --coverage.thresholds.branches=85
    }
    Invoke-LoggedNative "storage architecture" $log { pnpm check:storage-architecture }
} finally {
    Pop-Location
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}

Write-Output "Frontend gates passed. Log: $log"
