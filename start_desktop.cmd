@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

echo ========================================
echo  WeChat Cloned - Desktop Mode
echo ========================================
echo.
echo  Electron provides the desktop shell; it starts Flask automatically.
echo  Backend logs are written under your Electron userData folder.
echo.

call "%ROOT%project_support\scripts\_backend_setup.cmd"
if errorlevel 1 (
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js was not found. Install Node.js 18 or newer for the desktop app.
    pause
    exit /b 1
)

cd /d "%ROOT%desktop"

if not exist "node_modules\electron\package.json" (
    echo Installing desktop dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed.
        cd /d "%ROOT%"
        pause
        exit /b 1
    )
)

cd /d "%ROOT%"

echo Setup complete. Starting desktop app...
echo.

start "WeChat Cloned - Desktop" cmd /k "cd /d ""%ROOT%desktop"" && echo [Desktop] Starting Electron... && echo [Desktop] Flask backend is spawned automatically by Electron. && echo. && npm start"

echo.
echo Desktop window: "WeChat Cloned - Desktop"
echo Close the Electron window to stop the app.
echo.
pause
