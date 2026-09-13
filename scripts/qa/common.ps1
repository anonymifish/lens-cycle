$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-WorkspaceRoot {
    return [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
}

function Get-RunRoot {
    param(
        [Parameter(Mandatory = $true)][string]$RunId,
        [switch]$Create
    )

    if ($RunId -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
        throw "Invalid run id: $RunId"
    }

    $workspace = Get-WorkspaceRoot
    $runsRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace "artifacts\runs"))
    $runRoot = [System.IO.Path]::GetFullPath((Join-Path $runsRoot $RunId))
    $prefix = $runsRoot.TrimEnd('\') + '\'
    if (-not $runRoot.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe run path: $runRoot"
    }

    if ($Create) {
        foreach ($name in @("data", "logs", "evidence", "reports", "coverage", "frontend-dist", "cargo-target", "temp")) {
            New-Item -ItemType Directory -Path (Join-Path $runRoot $name) -Force | Out-Null
        }
    } elseif (-not (Test-Path -LiteralPath $runRoot -PathType Container)) {
        throw "Run does not exist: $runRoot"
    }

    return $runRoot
}

function Invoke-LoggedNative {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )

    "[$((Get-Date).ToString('o'))] START $Name" | Tee-Object -FilePath $LogPath -Append
    & $Command 2>&1 | Tee-Object -FilePath $LogPath -Append
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) { $exitCode = 0 }
    "[$((Get-Date).ToString('o'))] END $Name exit=$exitCode" | Tee-Object -FilePath $LogPath -Append
    if ($exitCode -ne 0) {
        throw "$Name failed with exit code $exitCode. See $LogPath"
    }
}
