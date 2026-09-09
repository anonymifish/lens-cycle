param(
    [Parameter(Mandatory = $true)][string]$RunId,
    [switch]$Execute
)

$ErrorActionPreference = "Stop"
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $workspace "scripts\qa\common.ps1")
$runRoot = Get-RunRoot -RunId $RunId
$targets = @(
    "cargo-target",
    "release-target",
    "rust-coverage-target",
    "frontend-dist",
    "frontend-coverage",
    "frontend-coverage-final",
    "frontend-coverage-after-fix",
    "coverage"
) |
    ForEach-Object { Join-Path $runRoot $_ } |
    Where-Object { Test-Path -LiteralPath $_ }

$bundleRoot = Join-Path $runRoot "cargo-target\release\bundle"
if (Test-Path -LiteralPath $bundleRoot) {
    $tauriConfig = Get-Content -LiteralPath (Join-Path $workspace "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
    $releaseRoot = Join-Path $workspace "releases\$($tauriConfig.version)\windows-x64"
    if (-not (Test-Path -LiteralPath (Join-Path $releaseRoot "lens-cycle.exe")) -or
        -not (Get-ChildItem -LiteralPath $releaseRoot -Filter *.msi -File -ErrorAction SilentlyContinue) -or
        -not (Get-ChildItem -LiteralPath $releaseRoot -Filter *setup.exe -File -ErrorAction SilentlyContinue)) {
        throw "Release files have not been preserved in $releaseRoot"
    }
}

foreach ($target in $targets) {
    $resolved = [System.IO.Path]::GetFullPath($target)
    $runPrefix = $runRoot.TrimEnd('\') + '\'
    if (-not $resolved.StartsWith($runPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe cleanup target: $resolved"
    }
    if ($Execute) {
        Remove-Item -LiteralPath $resolved -Recurse -Force
        Write-Output "Removed $resolved"
    } else {
        Write-Output "Would remove $resolved"
    }
}

if (-not $Execute) {
    Write-Output "Dry run only. Add -Execute to remove the listed directories."
}
