param(
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$ReleaseDir = Join-Path $Root "project_support\build_output\release"
$Installer = Join-Path $ReleaseDir "WeChat Cloned-Setup-$Version.exe"
$UnpackedApp = Join-Path $ReleaseDir "win-unpacked\WeChat Cloned.exe"
$UnpackedBackend = Join-Path $ReleaseDir "win-unpacked\resources\backend\WeChatClonedBackend.exe"
$ManifestPath = Join-Path $ReleaseDir "WeChat Cloned-Release-$Version.json"

function Get-ReleaseFileInfo {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (!(Test-Path $Path -PathType Leaf)) {
        throw "Release file is missing: $Path"
    }
    $item = Get-Item $Path
    $hash = Get-FileHash -Algorithm SHA256 -Path $Path
    return [ordered]@{
        path = $item.FullName
        sizeBytes = $item.Length
        sha256 = $hash.Hash
        lastWriteTimeUtc = $item.LastWriteTimeUtc.ToString("o")
    }
}

$manifest = [ordered]@{
    product = "WeChat Cloned"
    version = $Version
    generatedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
    installer = Get-ReleaseFileInfo -Path $Installer
    unpackedApp = Get-ReleaseFileInfo -Path $UnpackedApp
    bundledBackend = Get-ReleaseFileInfo -Path $UnpackedBackend
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path $ManifestPath -Encoding UTF8
Write-Host "Release manifest written: $ManifestPath"
