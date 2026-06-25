param(
    [string]$Version = "1.0.0",
    [switch]$SkipNpmInstall
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Backend = Join-Path $Root "backend"
$Desktop = Join-Path $Root "desktop"
$VendorDir = Join-Path $Root "frontend\static\vendor"
$OutputRoot = Join-Path $Root "project_support\build_output"
$DistDir = Join-Path $OutputRoot "dist"
$BuildDir = Join-Path $OutputRoot "build"
$ReleaseDir = Join-Path $OutputRoot "release"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

function Remove-GeneratedPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (!(Test-Path $Path)) {
        return
    }
    $resolved = Resolve-Path $Path
    if (!$resolved.Path.StartsWith($Root.Path, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove path outside workspace: $($resolved.Path)"
    }
    Remove-Item -LiteralPath $resolved.Path -Recurse -Force
}

Write-Host "== WeChat Cloned desktop build =="
Write-Host "Root: $Root"

Write-Host "Cleaning stale desktop build artifacts..."
Remove-GeneratedPath (Join-Path $Root "dist\WeChatClonedBackend")
Remove-GeneratedPath (Join-Path $Root "build\backend_desktop")
Remove-GeneratedPath (Join-Path $Root "release\win-unpacked")
Remove-GeneratedPath (Join-Path $DistDir "WeChatClonedBackend")
Remove-GeneratedPath (Join-Path $BuildDir "backend_desktop")
Remove-GeneratedPath (Join-Path $ReleaseDir "win-unpacked")
if (Test-Path $ReleaseDir) {
    Get-ChildItem $ReleaseDir -Filter "WeChat Cloned-Setup-$Version.exe*" |
        Remove-Item -Force
}

if (!(Test-Path (Join-Path $Backend ".venv\Scripts\python.exe"))) {
    Write-Host "Creating backend virtual environment..."
    python -m venv (Join-Path $Backend ".venv")
}

$Python = Join-Path $Backend ".venv\Scripts\python.exe"
Invoke-Checked $Python -m pip install --upgrade pip
Invoke-Checked $Python -m pip install -r (Join-Path $Backend "requirements.txt")
Invoke-Checked $Python -m pip install "pyinstaller>=6.15,<7"

Write-Host "Generating application icon..."
Invoke-Checked $Python (Join-Path $Root "project_support\scripts\generate_icon.py")

if (!$SkipNpmInstall) {
    Write-Host "Installing Electron build dependencies..."
    Push-Location $Desktop
    Invoke-Checked "npm" install
    Pop-Location
}

Write-Host "Copying local Socket.IO client for offline desktop runtime..."
New-Item -ItemType Directory -Force -Path $VendorDir | Out-Null
Copy-Item -Force `
    (Join-Path $Desktop "node_modules\socket.io-client\dist\socket.io.min.js") `
    (Join-Path $VendorDir "socket.io.min.js")

Write-Host "Building bundled Flask backend..."
$env:WECHAT_CLONED_VERSION = $Version
Push-Location $Root
New-Item -ItemType Directory -Force -Path $DistDir, $BuildDir | Out-Null
Invoke-Checked $Python -m PyInstaller --noconfirm `
    --distpath $DistDir `
    --workpath $BuildDir `
    (Join-Path $Root "project_support\packaging\backend_desktop.spec")
Pop-Location

Write-Host "Building NSIS installer..."
Push-Location $Desktop
Invoke-Checked "npm" run dist
Pop-Location

Write-Host ""
Write-Host "Build complete. Installer output:"
Get-ChildItem $ReleaseDir -Filter "*.exe" | Select-Object FullName, Length, LastWriteTime
