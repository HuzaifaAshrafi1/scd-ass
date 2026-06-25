@echo off
setlocal

cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
    echo Run start_app.cmd once first so the virtual environment is created.
    pause
    exit /b 1
)

call ".venv\Scripts\activate.bat"
python seed.py
pause
