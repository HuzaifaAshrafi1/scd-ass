# WeChat Cloned Desktop Release Guide

This guide packages the Flask + HTML/CSS/JS app as a true Windows desktop application.

## Recommended Architecture

Use **Electron + PyInstaller + electron-builder NSIS**.

- Electron provides a bundled Chromium desktop shell, so users do not need a browser or WebView runtime.
- PyInstaller bundles the Flask backend into a Windows executable, so users do not need Python.
- electron-builder creates a professional NSIS installer with Start Menu shortcut, desktop shortcut, versioning, upgrade support, and clean uninstall.
- SQLite is forced in desktop mode and stored under `%APPDATA%`/Electron `userData`, so SQL Server and ODBC are not required.

## Runtime Layout

Installed app:

```text
%LOCALAPPDATA%\Programs\WeChat Cloned\
├── WeChat Cloned.exe
└── project_support\resources\
    └── backend\
        ├── WeChatClonedBackend.exe
        ├── frontend\
        └── bundled Python libraries
```

User data:

```text
%APPDATA%\WeChat Cloned\
├── data\database.db
├── uploads\avatars\
├── uploads\attachments\
├── logs\backend.log
├── logs\backend.stdout.log
├── logs\backend.stderr.log
├── logs\desktop.log
└── settings\secret.key
```

## Build Prerequisites

Only the build machine needs these:

- Windows 10/11
- Python 3.11+
- Node.js 18+
- npm

End users do not need Python, Node.js, SQL Server, ODBC, or a browser.

## One-Command Build

From the repository root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\project_support\scripts\build_desktop.ps1 -Version "1.0.0"
```

Output:

```text
project_support\build_output\release\WeChat Cloned-Setup-1.0.0.exe
```

## Manual Build Steps

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m pip install pyinstaller==6.10.0

cd ..
.\backend\.venv\Scripts\python.exe .\project_support\scripts\generate_icon.py

cd desktop
npm install
cd ..

New-Item -ItemType Directory -Force frontend\static\vendor
Copy-Item desktop\node_modules\socket.io-client\dist\socket.io.min.js frontend\static\vendor\socket.io.min.js -Force

.\backend\.venv\Scripts\python.exe -m PyInstaller --noconfirm project_support\packaging\backend_desktop.spec

cd desktop
npm run dist
```

## Installer Behavior

The NSIS installer:

- Installs `WeChat Cloned.exe`
- Adds desktop shortcut
- Adds Start Menu shortcut
- Uses `project_support\resources\icon.ico`
- Supports uninstall from Windows Apps & Features
- Preserves user data on uninstall by default
- Supports upgrades when `desktop/package.json` version is increased

## Runtime Behavior

Electron:

- Finds a free localhost port starting at `53127`
- Starts the bundled Flask backend automatically
- Waits for `/health`
- Opens the app inside a desktop window
- Restarts the backend up to 3 times if it crashes
- Writes supervisor logs to `logs\desktop.log`
- Shuts down the backend when the window closes

Flask desktop mode:

- Forces SQLite unless `WECHAT_CLONED_ALLOW_EXTERNAL_DB=1`
- Stores database and uploads under Electron `userData`
- Writes rotating backend logs
- Serves uploaded user files from `/user-data/uploads/...`
- Creates database tables on startup

## Release Process

1. Update version in `desktop/package.json`.
2. Build with `.\project_support\scripts\build_desktop.ps1 -Version "x.y.z"`.
3. Install the generated `.exe` on a clean Windows test user.
4. Verify login/register, chat, uploads, profile photo, restart, uninstall.
5. Publish the installer from `project_support\build_output\release\`.

## Update Strategy

Recommended for this university/commercial-style package:

- Start with manual installer updates.
- Use semantic versions, e.g. `1.0.0`, `1.1.0`.
- Users install the newer NSIS installer over the old install.
- User data remains in `%APPDATA%\WeChat Cloned`.

Future option:

- Add `electron-updater` with signed releases and a GitHub Releases feed.

## Distribution Strategy

Recommended:

- Distribute `WeChat Cloned-Setup-x.y.z.exe`.
- Zip only if a sharing platform blocks `.exe`.
- Code-sign the installer before public release to reduce Windows SmartScreen warnings.

Optional signing command:

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a "project_support\build_output\release\WeChat Cloned-Setup-1.0.0.exe"
```

## Important Notes

- Desktop mode does not require SQL Server.
- Desktop mode ignores external `DATABASE_URL` by default and uses SQLite.
- Set `WECHAT_CLONED_ALLOW_EXTERNAL_DB=1` only for advanced internal testing.
- The installed app should not write to its installation directory.
