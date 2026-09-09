param(
    [Parameter(Mandatory = $true)][string]$RunId
)

. (Join-Path $PSScriptRoot "common.ps1")

$workspace = Get-WorkspaceRoot
$runRoot = Get-RunRoot -RunId $RunId -Create
$log = Join-Path $runRoot "logs\rust-gates.log"
$previousData = $env:LENS_CYCLE_DATA_DIR
$previousTarget = $env:CARGO_TARGET_DIR
$env:LENS_CYCLE_DATA_DIR = Join-Path $runRoot "data"
$env:CARGO_TARGET_DIR = Join-Path $runRoot "cargo-target"

Push-Location (Join-Path $workspace "src-tauri")
try {
    Invoke-LoggedNative "rust fmt" $log { cargo fmt --all -- --check }
    Invoke-LoggedNative "rust clippy" $log { cargo clippy --all-targets --all-features -- -D warnings }
    Invoke-LoggedNative "rust tests" $log { cargo test --all-features }
} finally {
    Pop-Location
    $env:LENS_CYCLE_DATA_DIR = $previousData
    $env:CARGO_TARGET_DIR = $previousTarget
}

Write-Output "Rust gates passed. Log: $log"
