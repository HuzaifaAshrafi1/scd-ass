import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

from flask import Flask, abort, g, jsonify, redirect, request, send_from_directory, session, url_for

from sqlalchemy import text

from config import Config
from extensions import db, socketio
from models import Attachment, Conversation, GroupMember, User
from messaging_upgrade import upgrade_messaging_schema
from controllers import auth_bp, chat_bp, friends_bp, profile_bp
from controllers.helpers import get_csrf_token, login_required, validate_csrf


def create_app(config_class=Config):
    frontend_dir = config_class.FRONTEND_DIR
    app = Flask(
        __name__,
        template_folder=str(frontend_dir / "templates"),
        static_folder=str(frontend_dir / "static"),
    )
    app.config.from_object(config_class)

    configure_logging(app)
    app.config["UPLOAD_FOLDER"].mkdir(parents=True, exist_ok=True)
    app.config["AVATAR_UPLOAD_FOLDER"].mkdir(parents=True, exist_ok=True)
    app.config["ATTACHMENT_UPLOAD_FOLDER"].mkdir(parents=True, exist_ok=True)
    app.config["DATA_DIR"].mkdir(parents=True, exist_ok=True)
    app.config["LOG_FOLDER"].mkdir(parents=True, exist_ok=True)

    db.init_app(app)
    socketio.init_app(app)

    with app.app_context():
        upgrade_messaging_schema()

    app.register_blueprint(auth_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(friends_bp)
    app.register_blueprint(profile_bp)

    @app.before_request
    def load_current_user_and_protect_csrf():
        user_id = session.get("user_id")
        g.user = db.session.get(User, user_id) if user_id else None
        if request.path.startswith("/socket.io/"):
            return
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            validate_csrf()

    @app.context_processor
    def inject_globals():
        return {
            "csrf_token": get_csrf_token,
            "current_user": g.get("user"),
            "app_version": app.config["APP_VERSION"],
            "frontend_version": app.config["FRONTEND_VERSION"],
            "desktop_mode": app.config["DESKTOP_MODE"],
            "app_name": app.config["APP_NAME"],
        }

    @app.get("/")
    def index():
        if g.user:
            return redirect(url_for("chat.chat"))
        return redirect(url_for("auth.login"))

    @app.get("/health")
    def health():
        database_ok = _database_is_healthy()
        return jsonify(
            {
                "status": "ok" if database_ok else "degraded",
                "backend": True,
                "database": database_ok,
                "app": app.config["APP_NAME"],
                "version": app.config["APP_VERSION"],
                "desktop": app.config["DESKTOP_MODE"],
                "environment": "desktop" if app.config["DESKTOP_MODE"] else "web",
            }
        )

    @app.get("/user-data/uploads/<path:filename>")
    @login_required
    def user_uploads(filename):
        upload_path = _resolve_upload_path(app.config["UPLOAD_FOLDER"], filename)
        if not _can_access_upload(upload_path, g.user.id, app.config):
            abort(404)
        return send_from_directory(upload_path.parent, upload_path.name)

    @app.cli.command("init-db")
    def init_db_command():
        db.create_all()
        upgrade_messaging_schema()
        print("Initialized SQLite database.")

    @app.cli.command("upgrade-messaging")
    def upgrade_messaging_command():
        upgrade_messaging_schema()
        print("Messaging schema upgraded.")

    return app


def _database_is_healthy():
    try:
        db.session.execute(text("SELECT 1"))
        db.session.rollback()
        return True
    except Exception:
        db.session.rollback()
        return False


def _is_relative_to(path, root):
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _resolve_upload_path(upload_root, filename):
    root = Path(upload_root).resolve()
    candidate = (root / filename).resolve()
    if not _is_relative_to(candidate, root) or not candidate.is_file():
        abort(404)
    return candidate


def _can_access_upload(upload_path, user_id, app_config):
    avatar_root = Path(app_config["AVATAR_UPLOAD_FOLDER"]).resolve()
    if _is_relative_to(upload_path, avatar_root):
        return True

    attachment_root = Path(app_config["ATTACHMENT_UPLOAD_FOLDER"]).resolve()
    if not _is_relative_to(upload_path, attachment_root):
        return False

    attachments = Attachment.query.filter_by(filename=upload_path.name).all()
    for attachment in attachments:
        stored_path = Path(attachment.storage_path).resolve()
        if stored_path == upload_path and _conversation_allows_user(attachment.message.conversation, user_id):
            return True
    return False


def _conversation_allows_user(conversation, user_id):
    if not conversation:
        return False
    if conversation.type == "direct":
        return user_id in {conversation.user_one_id, conversation.user_two_id}
    if conversation.type == "group":
        return (
            GroupMember.query.filter_by(
                group_id=conversation.group_id,
                user_id=user_id,
                is_active=True,
            ).first()
            is not None
        )
    return False


def configure_logging(app):
    log_folder = app.config.get("LOG_FOLDER")
    if not log_folder:
        return
    log_folder.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        log_folder / "backend.log",
        maxBytes=1_000_000,
        backupCount=5,
        encoding="utf-8",
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    )
    handler.setLevel(logging.INFO)
    app.logger.addHandler(handler)
    app.logger.setLevel(logging.INFO)


app = create_app()


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        upgrade_messaging_schema()
    host = os.environ.get("WECHAT_CLONED_HOST", "127.0.0.1")
    port = int(os.environ.get("WECHAT_CLONED_PORT", os.environ.get("PORT", "5000")))
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.logger.info("Starting %s on %s:%s", app.config["APP_NAME"], host, port)
    socketio.run(app, host=host, port=port, debug=debug, allow_unsafe_werkzeug=True)
