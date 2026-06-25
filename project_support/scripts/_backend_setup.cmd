@echo off
setlocal

set "BACKEND_DIR=%~dp0..\..\backend"
cd /d "%BACKEND_DIR%"

where python >nul 2>nul
if errorlevel 1 (
    echo Python was not found. Install Python 3.11 or newer and try again.
    exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
    echo Creating virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo Failed to create virtual environment.
        exit /b 1
    )
)

call ".venv\Scripts\activate.bat"

set "DEPS_MARKER=.venv\.deps-ready"
set "INSTALL_DEPS=1"
if exist "%DEPS_MARKER%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-Item '%DEPS_MARKER%').LastWriteTimeUtc -ge (Get-Item 'requirements.txt').LastWriteTimeUtc) { exit 0 } else { exit 1 }" >nul 2>&1
    if not errorlevel 1 set "INSTALL_DEPS=0"
)

if "%INSTALL_DEPS%"=="1" (
    echo Installing backend dependencies...
    python -m pip install --upgrade pip >nul
    pip install -r requirements.txt
    if errorlevel 1 (
        echo Dependency installation failed.
        exit /b 1
    )
    echo ready>"%DEPS_MARKER%"
) else (
    echo Backend dependencies already installed.
)

set FLASK_APP=app.py
python -m flask init-db
if errorlevel 1 (
    echo Database initialization failed.
    exit /b 1
)

exit /b 0
