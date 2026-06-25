@echo off
setlocal

set "MODE=%~1"

if /I "%MODE%"=="desktop" (
    call "%~dp0start_desktop.cmd"
    exit /b %ERRORLEVEL%
)

if /I "%MODE%"=="web" (
    call "%~dp0start_app.cmd"
    exit /b %ERRORLEVEL%
)

if not "%MODE%"=="" (
    echo Unknown mode: %MODE%
    echo Usage: start_all.cmd [web^|desktop]
    echo   web     - browser + Flask server ^(default^)
    echo   desktop - Electron desktop app
    pause
    exit /b 1
)

call "%~dp0start_app.cmd"
exit /b %ERRORLEVEL%
