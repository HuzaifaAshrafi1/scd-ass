import os
import secrets
import sys
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
APP_NAME = "WeChat Cloned"
APP_VERSION = os.environ.get("WECHAT_CLONED_VERSION", "1.0.0")
FRONTEND_VERSION = os.environ.get("WECHAT_CLONED_FRONTEND_VERSION", "1.0.0")
DESKTOP_MODE = os.environ.get("WECHAT_CLONED_DESKTOP", "0") == "1"


def env_path(name):
    value = os.environ.get(name)
    return Path(value) if value else None


def resource_path(*parts):
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS, *parts)
    return PROJECT_ROOT.joinpath(*parts)


def default_app_data_dir():
    base = os.environ.get("WECHAT_CLONED_DATA_DIR")
    if base:
        return Path(base)
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / APP_NAME
    return BASE_DIR / "desktop_data"


FRONTEND_DIR = resource_path("frontend")
APP_DATA_DIR = default_app_data_dir() if DESKTOP_MODE else BASE_DIR
DATA_DIR = env_path("WECHAT_CLONED_DATA_DIR") or (APP_DATA_DIR / "data" if DESKTOP_MODE else BASE_DIR)
SETTINGS_DIR = APP_DATA_DIR / "settings" if DESKTOP_MODE else BASE_DIR
LOG_DIR = env_path("WECHAT_CLONED_LOG_DIR") or (APP_DATA_DIR / "logs" if DESKTOP_MODE else BASE_DIR)
UPLOAD_ROOT = env_path("WECHAT_CLONED_UPLOAD_ROOT") or (
    APP_DATA_DIR / "uploads" if DESKTOP_MODE else FRONTEND_DIR / "static" / "uploads"
)


def desktop_secret_key():
    if not DESKTOP_MODE:
        return "change-this-secret-key-before-deploying"
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    secret_file = SETTINGS_DIR / "secret.key"
    if not secret_file.exists():
        secret_file.write_text(secrets.token_urlsafe(48), encoding="utf-8")
    return secret_file.read_text(encoding="utf-8").strip()


class Config:
    APP_NAME = APP_NAME
    APP_VERSION = APP_VERSION
    FRONTEND_VERSION = FRONTEND_VERSION
    DESKTOP_MODE = DESKTOP_MODE
    FRONTEND_DIR = FRONTEND_DIR
    APP_DATA_DIR = APP_DATA_DIR
    DATA_DIR = DATA_DIR
    SETTINGS_DIR = SETTINGS_DIR
    LOG_FOLDER = LOG_DIR
    SECRET_KEY = os.environ.get("SECRET_KEY", desktop_secret_key())
    if DESKTOP_MODE and os.environ.get("WECHAT_CLONED_ALLOW_EXTERNAL_DB", "0") != "1":
        SQLALCHEMY_DATABASE_URI = f"sqlite:///{DATA_DIR / 'database.db'}"
    else:
        SQLALCHEMY_DATABASE_URI = os.environ.get(
            "DATABASE_URL", f"sqlite:///{DATA_DIR / 'database.db'}"
        )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    UPLOAD_FOLDER = UPLOAD_ROOT
    AVATAR_UPLOAD_FOLDER = UPLOAD_FOLDER / "avatars"
    ATTACHMENT_UPLOAD_FOLDER = UPLOAD_FOLDER / "attachments"
    MAX_CONTENT_LENGTH = 12 * 1024 * 1024
    LOGIN_RATE_LIMIT_ATTEMPTS = 5
    LOGIN_RATE_LIMIT_WINDOW_SECONDS = 15 * 60
    LOGIN_RATE_LIMIT_LOCK_SECONDS = 5 * 60

    ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
    ALLOWED_DOCUMENT_EXTENSIONS = {
        "pdf",
        "doc",
        "docx",
        "xls",
        "xlsx",
        "ppt",
        "pptx",
        "txt",
        "csv",
        "zip",
    }

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "false").lower() == "true"
