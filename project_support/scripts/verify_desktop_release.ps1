param(
    [string]$Version = "1.0.0",
    [int]$TimeoutSeconds = 30,
    [switch]$RunInstallerCheck,
    [switch]$RunInstalledLaunchCheck
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$BackendExe = Join-Path $Root "project_support\build_output\dist\WeChatClonedBackend\WeChatClonedBackend.exe"
$ReleaseDir = Join-Path $Root "project_support\build_output\release"
$Installer = Join-Path $ReleaseDir "WeChat Cloned-Setup-$Version.exe"
$UnpackedBackend = Join-Path $ReleaseDir "win-unpacked\resources\backend\WeChatClonedBackend.exe"

function Assert-File {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (!(Test-Path $Path -PathType Leaf)) {
        throw "Required file is missing: $Path"
    }
}

function Get-FreePort {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), 0)
    $listener.Start()
    $port = $listener.LocalEndpoint.Port
    $listener.Stop()
    return $port
}

function Wait-ForHealth {
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 2
            if ($health.status -eq "ok") {
                return $health
            }
        } catch {
            Start-Sleep -Milliseconds 400
        }
    } while ((Get-Date) -lt $deadline)
    throw "Backend health endpoint did not respond within $TimeoutSeconds seconds."
}

function Wait-ForDesktopPort {
    param(
        [Parameter(Mandatory = $true)][string]$DesktopLog,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (Test-Path $DesktopLog) {
            $content = Get-Content -Path $DesktopLog -Raw
            $match = [regex]::Match($content, "Starting backend on port (\d+):")
            if ($match.Success) {
                return [int]$match.Groups[1].Value
            }
        }
        Start-Sleep -Milliseconds 400
    } while ((Get-Date) -lt $deadline)
    throw "Installed app did not write a backend startup port to $DesktopLog."
}

function Stop-AppProcess {
    param([Parameter(Mandatory = $true)]$Process)
    if ($Process.HasExited) {
        return
    }
    try {
        if ($Process.MainWindowHandle -ne 0) {
            [void]$Process.CloseMainWindow()
            if ($Process.WaitForExit(10000)) {
                return
            }
        }
    } catch {
    }
    if (!$Process.HasExited) {
        Stop-Process -Id $Process.Id -Force
        $Process.WaitForExit()
    }
}

function Invoke-InstalledLaunchCheck {
    param(
        [Parameter(Mandatory = $true)][string]$AppExe,
        [Parameter(Mandatory = $true)][string]$TempRoot,
        [Parameter(Mandatory = $true)][int]$TimeoutSeconds
    )

    $userDataDir = Join-Path $TempRoot "installed-user-data"
    New-Item -ItemType Directory -Force -Path $userDataDir | Out-Null
    $oldUserData = $env:WECHAT_CLONED_USER_DATA_DIR
    $env:WECHAT_CLONED_USER_DATA_DIR = $userDataDir
    $appProcess = $null
    try {
        $appProcess = Start-Process -FilePath $AppExe -PassThru
        $desktopLog = Join-Path $userDataDir "logs\desktop.log"
        $port = Wait-ForDesktopPort -DesktopLog $desktopLog -TimeoutSeconds $TimeoutSeconds
        $health = Wait-ForHealth -Port $port -TimeoutSeconds $TimeoutSeconds
        if ($health.desktop -ne $true) {
            throw "Installed backend did not report desktop mode."
        }

        $loginPage = Invoke-WebRequest -Uri "http://127.0.0.1:$port/login" -UseBasicParsing -TimeoutSec 5
        if ($loginPage.StatusCode -ne 200 -or $loginPage.Content -notmatch "WeChat Cloned") {
            throw "Installed app frontend did not load correctly."
        }
    } finally {
        if ($appProcess) {
            Stop-AppProcess -Process $appProcess
        }
        $env:WECHAT_CLONED_USER_DATA_DIR = $oldUserData
    }
}

function Invoke-SilentInstallerCheck {
    param(
        [Parameter(Mandatory = $true)][string]$InstallerPath,
        [Parameter(Mandatory = $true)][string]$TempRoot
    )
    $installDir = Join-Path $TempRoot "installed"
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null

    $installArgs = "/S /D=$installDir"
    $install = Start-Process -FilePath $InstallerPath -ArgumentList $installArgs -Wait -PassThru -WindowStyle Hidden
    if ($install.ExitCode -ne 0) {
        throw "Installer failed with exit code $($install.ExitCode)."
    }

    $appExe = Join-Path $installDir "WeChat Cloned.exe"
    Assert-File $appExe
    $uninstaller = Get-ChildItem -Path $installDir -Filter "Uninstall*.exe" | Select-Object -First 1
    if (!$uninstaller) {
        throw "Installed app is missing an uninstaller."
    }

    try {
        if ($RunInstalledLaunchCheck) {
            Invoke-InstalledLaunchCheck -AppExe $appExe -TempRoot $TempRoot -TimeoutSeconds $TimeoutSeconds
            Write-Host "Installed app launch OK."
        }
    } finally {
        $uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
        if ($uninstall.ExitCode -ne 0) {
            throw "Uninstaller failed with exit code $($uninstall.ExitCode)."
        }
    }
}

Write-Host "== WeChat Cloned release verification =="
Write-Host "Root: $Root"

Assert-File $BackendExe
Assert-File $Installer

if (Test-Path (Join-Path $ReleaseDir "win-unpacked")) {
    Assert-File $UnpackedBackend
}

$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) "WeChatClonedReleaseVerify-$([guid]::NewGuid().ToString('N'))"
$dataDir = Join-Path $tempRoot "data"
$logDir = Join-Path $tempRoot "logs"
New-Item -ItemType Directory -Force -Path $dataDir, $logDir | Out-Null

$port = Get-FreePort
$oldDesktop = $env:WECHAT_CLONED_DESKTOP
$oldPort = $env:WECHAT_CLONED_PORT
$oldDataDir = $env:WECHAT_CLONED_DATA_DIR
$oldDebug = $env:FLASK_DEBUG

$env:WECHAT_CLONED_DESKTOP = "1"
$env:WECHAT_CLONED_PORT = "$port"
$env:WECHAT_CLONED_DATA_DIR = $dataDir
$env:FLASK_DEBUG = "0"

$stdout = Join-Path $logDir "backend.stdout.log"
$stderr = Join-Path $logDir "backend.stderr.log"
$backend = $null

try {
    $backend = Start-Process -FilePath $BackendExe `
        -WorkingDirectory (Split-Path $BackendExe) `
        -RedirectStandardOutput $stdout `
        -RedirectStandardError $stderr `
        -PassThru `
        -WindowStyle Hidden

    $health = Wait-ForHealth -Port $port -TimeoutSeconds $TimeoutSeconds
    Write-Host "Health endpoint OK: $($health.app) $($health.version)"

    $loginPage = Invoke-WebRequest -Uri "http://127.0.0.1:$port/login" -UseBasicParsing -TimeoutSec 5
    if ($loginPage.StatusCode -ne 200 -or $loginPage.Content -notmatch "WeChat Cloned") {
        throw "Frontend login page did not load correctly."
    }
    Write-Host "Frontend load OK."
} finally {
    if ($backend -and !$backend.HasExited) {
        Stop-Process -Id $backend.Id -Force
        $backend.WaitForExit()
    }
    $env:WECHAT_CLONED_DESKTOP = $oldDesktop
    $env:WECHAT_CLONED_PORT = $oldPort
    $env:WECHAT_CLONED_DATA_DIR = $oldDataDir
    $env:FLASK_DEBUG = $oldDebug
}

if ($RunInstallerCheck) {
    Invoke-SilentInstallerCheck -InstallerPath $Installer -TempRoot $tempRoot
    Write-Host "Silent install/uninstall OK."
} else {
    Write-Host "Installer file exists. Run with -RunInstallerCheck for silent install/uninstall verification."
}

Write-Host "Release verification complete."
