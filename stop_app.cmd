@echo off
setlocal

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "PORT_FILE=%ROOT%.runtime\web-port.txt"
set "APP_PORT="

if exist "%PORT_FILE%" (
    set /p APP_PORT=<"%PORT_FILE%"
)

echo ========================================
echo  WeChat Cloned - Stop Web Mode
echo ========================================
echo.

if "%APP_PORT%"=="" (
    echo No saved web port was found.
    echo Closing any window titled "WeChat Cloned - Backend" as a fallback...
    taskkill /FI "WINDOWTITLE eq WeChat Cloned - Backend*" /T /F >nul 2>&1
    taskkill /FI "WINDOWTITLE eq WeChat Cloned - Frontend*" /T /F >nul 2>&1
    echo Done.
    pause
    exit /b 0
)

echo Stopping Flask server on port %APP_PORT%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=%APP_PORT%; $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; if (!$connections) { exit 0 }; $connections | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"

taskkill /FI "WINDOWTITLE eq WeChat Cloned - Frontend*" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq WeChat Cloned - Backend*" /T /F >nul 2>&1

del "%PORT_FILE%" >nul 2>&1
del "%ROOT%.runtime\web-url.txt" >nul 2>&1

echo Web app stopped.
pause
exit /b 0
