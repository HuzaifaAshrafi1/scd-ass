@echo off
setlocal

call "%~dp0stop_app.cmd"
call "%~dp0stop_desktop.cmd"
exit /b 0
