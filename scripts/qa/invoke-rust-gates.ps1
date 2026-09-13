param(
    [Parameter(Mandatory = $true)][string]$RunId
)

. (Join-Path $PSScriptRoot "common.ps1")

$workspace = Get-WorkspaceRoot
$runRoot = Get-RunRoot -RunId $RunId -Create
$log = Join-Path $runRoot "logs\rust-gates.log"
$previousData = $env:LENS_CYCLE_DATA_DIR
$previousTarget = $env:CARGO_TARGET_DIR
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$env:LENS_CYCLE_DATA_DIR = Join-Path $runRoot "data"
$env:CARGO_TARGET_DIR = Join-Path $runRoot "cargo-target"
$env:TEMP = Join-Path $runRoot "temp"
$env:TMP = $env:TEMP

Push-Location (Join-Path $workspace "src-tauri")
try {
    Invoke-LoggedNative "rust fmt" $log { cargo fmt --all -- --check }
    Invoke-LoggedNative "rust clippy" $log { cargo clippy --all-targets --all-features -- -D warnings }
    Invoke-LoggedNative "rust tests" $log { cargo test --all-features }
} finally {
    Pop-Location
    $env:LENS_CYCLE_DATA_DIR = $previousData
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}

Write-Output "Rust gates passed. Log: $log"
