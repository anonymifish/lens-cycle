param(
    [string]$RunId,
    [switch]$Execute
)

$ErrorActionPreference = "Stop"
$workspace = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$workRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace "artifacts\work"))

if (Test-Path -LiteralPath $workRoot) {
    Get-ChildItem -LiteralPath $workRoot -Force | ForEach-Object {
        $resolved = [System.IO.Path]::GetFullPath($_.FullName)
        $prefix = $workRoot.TrimEnd('\') + '\'
        if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            throw "Unsafe cleanup target: $resolved"
        }
        if ($Execute) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
            Write-Output "Removed $resolved"
        } else {
            Write-Output "Would remove $resolved"
        }
    }
}

if ($RunId) {
    & (Join-Path $PSScriptRoot "compact-run.ps1") -RunId $RunId -Execute:$Execute
} elseif (-not $Execute) {
    Write-Output "Dry run only. Pass -RunId to preview one formal Run, and add -Execute to delete."
}
