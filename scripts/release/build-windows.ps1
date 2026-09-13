param(
    [Parameter(Mandatory = $true)][string]$RunId,
    [switch]$SkipGates
)

$ErrorActionPreference = "Stop"
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
. (Join-Path $workspace "scripts\qa\common.ps1")
$runRoot = Get-RunRoot -RunId $RunId -Create

if (-not $SkipGates) {
    & (Join-Path $workspace "scripts\qa\invoke-all-gates.ps1") -RunId $RunId
}

$frontendDist = Join-Path $runRoot "frontend-dist"
$cargoTarget = Join-Path $runRoot "cargo-target"
$log = Join-Path $runRoot "logs\windows-release.log"
$overlay = Join-Path $runRoot "tauri.release.conf.json"
$relativeFrontend = "../artifacts/runs/$RunId/frontend-dist"

[ordered]@{
    build = [ordered]@{
        beforeBuildCommand = ""
        frontendDist = $relativeFrontend
    }
    bundle = [ordered]@{
        active = $true
        targets = @("msi", "nsis")
    }
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $overlay -Encoding utf8

$previousTarget = $env:CARGO_TARGET_DIR
$previousTemp = $env:TEMP
$previousTmp = $env:TMP
$env:CARGO_TARGET_DIR = $cargoTarget
$env:TEMP = Join-Path $runRoot "temp"
$env:TMP = $env:TEMP
Push-Location $workspace
try {
    Invoke-LoggedNative "isolated frontend build" $log {
        node node_modules/vite/bin/vite.js build --outDir $frontendDist --emptyOutDir
    }
    Invoke-LoggedNative "Tauri Windows release" $log {
        pnpm tauri build --config $overlay
    }
} finally {
    Pop-Location
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:TEMP = $previousTemp
    $env:TMP = $previousTmp
}

$tauriConfig = Get-Content -LiteralPath (Join-Path $workspace "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$releaseDirectory = Join-Path $workspace "releases\$($tauriConfig.version)\windows-x64"
New-Item -ItemType Directory -Path $releaseDirectory -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $cargoTarget "release\lens-cycle.exe") -Destination $releaseDirectory -Force
Get-ChildItem -LiteralPath (Join-Path $cargoTarget "release\bundle\msi") -Filter *.msi -File | Copy-Item -Destination $releaseDirectory -Force
Get-ChildItem -LiteralPath (Join-Path $cargoTarget "release\bundle\nsis") -Filter *.exe -File | Copy-Item -Destination $releaseDirectory -Force

Write-Output "Windows release copied to $releaseDirectory"
