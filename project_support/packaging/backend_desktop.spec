# Run from repository root:
#   pyinstaller --noconfirm project_support/packaging/backend_desktop.spec

from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules


ROOT = Path(SPECPATH).parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"

datas = [
    (str(FRONTEND / "templates"), "frontend/templates"),
    (str(FRONTEND / "static"), "frontend/static"),
]

hiddenimports = (
    collect_submodules("engineio.async_drivers")
    + collect_submodules("socketio")
    + [
        "flask",
        "flask_socketio",
        "flask_sqlalchemy",
        "sqlalchemy",
        "werkzeug",
        "jinja2",
    ]
)

a = Analysis(
    [str(BACKEND / "app.py")],
    pathex=[str(BACKEND), str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "pandas", "PIL"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="WeChatClonedBackend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="WeChatClonedBackend",
)
