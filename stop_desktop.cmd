@echo off
setlocal

echo ========================================
echo  WeChat Cloned - Stop Desktop Mode
echo ========================================
echo.

taskkill /IM "WeChat Cloned.exe" /T /F >nul 2>&1
taskkill /IM "electron.exe" /T /F >nul 2>&1
taskkill /FI "WINDOWTITLE eq WeChat Cloned - Desktop*" /T /F >nul 2>&1

echo Desktop app stopped if it was running.
pause
exit /b 0
