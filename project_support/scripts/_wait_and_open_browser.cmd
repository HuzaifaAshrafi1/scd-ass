@echo off
setlocal

set "URL=%~1"
if "%URL%"=="" set "URL=http://127.0.0.1:5000"

echo %URL%| findstr /R "^http://127\.0\.0\.1:[0-9][0-9]*$" >nul
if errorlevel 1 (
    echo [Frontend] Invalid app URL: %URL%
    echo [Frontend] Start the app again with start_app.cmd.
    pause
    exit /b 1
)

echo [Frontend] Waiting for server at %URL% ...
for /L %%i in (1,1,90) do (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-RestMethod -Uri '%URL%/health' -TimeoutSec 1; if ($r.backend -eq $true) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
    if not errorlevel 1 goto :ready
    if %%i==1 echo [Frontend] Backend is starting...
    if %%i==10 echo [Frontend] Still waiting. If this takes long, check the Backend window for errors.
    timeout /t 1 /nobreak >nul
)

echo [Frontend] Server did not respond in time.
echo [Frontend] Open %URL% manually once the backend window shows it is running.
pause
exit /b 1

:ready
echo [Frontend] Server is ready.
echo [Frontend] Browser opener is handling %URL%
echo.
echo [Frontend] Web UI should open in your default browser.
echo [Frontend] This helper window will close automatically.
timeout /t 3 /nobreak >nul
exit /b 0
