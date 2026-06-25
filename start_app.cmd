@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

if not exist "%ROOT%.runtime" mkdir "%ROOT%.runtime"

set "APP_PORT=%WECHAT_CLONED_PORT%"
if "%APP_PORT%"=="" set "APP_PORT=5000"
echo %APP_PORT%| findstr /R "^[0-9][0-9]*$" >nul
if errorlevel 1 (
    echo Invalid WECHAT_CLONED_PORT value: %APP_PORT%
    echo Falling back to port 5000.
    set "APP_PORT=5000"
)

echo ========================================
echo  WeChat Cloned - Web Mode
echo ========================================
echo.
echo  Architecture: one Flask process serves the API and web UI together.
echo  Two windows will open:
echo    1. Backend  - Flask server logs
echo    2. Frontend - waits for /health, then opens your browser
echo.

call "%ROOT%project_support\scripts\_backend_setup.cmd"
if errorlevel 1 (
    pause
    exit /b 1
)

set "BACKEND=%ROOT%backend"
set "APP_URL=http://127.0.0.1:%APP_PORT%"
>"%ROOT%.runtime\web-port.txt" echo %APP_PORT%
>"%ROOT%.runtime\web-url.txt" echo %APP_URL%

echo Setup complete. Starting backend and frontend in parallel...
echo Web URL: %APP_URL%
echo.

echo Closing any old Flask process on port %APP_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=%APP_PORT%; Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>&1

start "WeChat Cloned - Backend" cmd /k "cd /d ""%BACKEND%"" && call .venv\Scripts\activate.bat && set ""WECHAT_CLONED_HOST=127.0.0.1"" && set ""WECHAT_CLONED_PORT=%APP_PORT%"" && set ""FLASK_DEBUG=0"" && set ""FLASK_APP=app.py"" && echo [Backend] Flask API + web UI on %APP_URL% && echo [Backend] Press Ctrl+C to stop the server. && echo. && python app.py"

start "WeChat Cloned - Frontend" cmd /k "cd /d ""%ROOT%"" && call project_support\scripts\_wait_and_open_browser.cmd %APP_URL%"

start "" /min powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%ROOT%project_support\scripts\open_browser_when_ready.ps1" -Url "%APP_URL%"

echo.
echo Backend window:  "WeChat Cloned - Backend"
echo Frontend window: "WeChat Cloned - Frontend"
echo.
echo If the browser does not open automatically, open this URL:
echo %APP_URL%
echo.
echo Stop the app with stop_app.cmd.
echo.
pause
