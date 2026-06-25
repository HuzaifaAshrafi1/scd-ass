import os
import re
import secrets
from functools import wraps
from pathlib import Path
from uuid import uuid4

from flask import abort, current_app, g, jsonify, redirect, request, session, url_for
from werkzeug.utils import secure_filename


USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{3,40}$")
IMAGE_SIGNATURES = {
    "png": ((b"\x89PNG\r\n\x1a\n",), "image/png"),
    "jpg": ((b"\xff\xd8\xff",), "image/jpeg"),
    "jpeg": ((b"\xff\xd8\xff",), "image/jpeg"),
    "gif": ((b"GIF87a", b"GIF89a"), "image/gif"),
    "webp": ((b"RIFF",), "image/webp"),
}
DOCUMENT_SIGNATURES = {
    "pdf": ((b"%PDF-",), "application/pdf"),
    "zip": ((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"), "application/zip"),
    "docx": ((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    "xlsx": ((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    "pptx": ((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"), "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    "doc": ((b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",), "application/msword"),
    "xls": ((b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",), "application/vnd.ms-excel"),
    "ppt": ((b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",), "application/vnd.ms-powerpoint"),
}
TEXT_EXTENSIONS = {"txt": "text/plain", "csv": "text/csv"}


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.user:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Authentication required."}), 401
            return redirect(url_for("auth.login"))
        return view(*args, **kwargs)

    return wrapped


def get_csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


def validate_csrf():
    token = request.headers.get("X-CSRFToken") or request.form.get("csrf_token")
    expected = session.get("csrf_token")
    if not expected or not token or not secrets.compare_digest(expected, token):
        abort(400, "Invalid CSRF token.")


def json_error(message, status=400):
    return jsonify({"error": message}), status


def sanitize_text(value, max_length):
    value = (value or "").strip()
    if len(value) > max_length:
        value = value[:max_length]
    return value


def parse_int(value, default=None, *, minimum=None, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if minimum is not None and parsed < minimum:
        return default
    if maximum is not None and parsed > maximum:
        return maximum
    return parsed


def allowed_extension(filename, image_only=False):
    if "." not in filename:
        return False
    extension = filename.rsplit(".", 1)[1].lower()
    image_extensions = current_app.config["ALLOWED_IMAGE_EXTENSIONS"]
    document_extensions = current_app.config["ALLOWED_DOCUMENT_EXTENSIONS"]
    if image_only:
        return extension in image_extensions
    return extension in image_extensions or extension in document_extensions


def _read_upload_head(file_storage, length=4096):
    stream = file_storage.stream
    position = stream.tell()
    head = stream.read(length)
    stream.seek(position)
    return head


def _matches_signature(head, signatures):
    return any(head.startswith(signature) for signature in signatures)


def _looks_like_webp(head):
    return head.startswith(b"RIFF") and len(head) >= 12 and head[8:12] == b"WEBP"


def _looks_like_text(head):
    if b"\x00" in head:
        return False
    try:
        head.decode("utf-8")
    except UnicodeDecodeError:
        try:
            head.decode("cp1252")
        except UnicodeDecodeError:
            return False
    control_bytes = [byte for byte in head if byte < 32 and byte not in {9, 10, 13}]
    return len(control_bytes) <= max(4, len(head) // 100)


def detect_upload_mimetype(file_storage, extension, image_only=False):
    head = _read_upload_head(file_storage)
    if not head:
        abort(400, "Uploaded file is empty.")

    if extension in IMAGE_SIGNATURES:
        signatures, mimetype = IMAGE_SIGNATURES[extension]
        if extension == "webp":
            valid = _looks_like_webp(head)
        else:
            valid = _matches_signature(head, signatures)
        if valid:
            return mimetype
        abort(400, "Uploaded image contents do not match the file extension.")

    if image_only:
        abort(400, "Only image uploads are allowed.")

    if extension in DOCUMENT_SIGNATURES:
        signatures, mimetype = DOCUMENT_SIGNATURES[extension]
        if _matches_signature(head, signatures):
            return mimetype
        abort(400, "Uploaded file contents do not match the file extension.")

    if extension in TEXT_EXTENSIONS:
        if _looks_like_text(head):
            return TEXT_EXTENSIONS[extension]
        abort(400, "Uploaded text file appears to contain binary data.")

    abort(400, "File type is not allowed.")


def save_upload(file_storage, folder_config_key, image_only=False):
    if not file_storage or not file_storage.filename:
        return None
    if not allowed_extension(file_storage.filename, image_only=image_only):
        abort(400, "File type is not allowed.")

    upload_folder = Path(current_app.config[folder_config_key])
    upload_folder.mkdir(parents=True, exist_ok=True)

    original_name = secure_filename(file_storage.filename)
    if not original_name or "." not in original_name:
        abort(400, "File name is not valid.")
    extension = original_name.rsplit(".", 1)[1].lower()
    mimetype = detect_upload_mimetype(file_storage, extension, image_only=image_only)
    filename = f"{uuid4().hex}.{extension}"
    destination = upload_folder / filename
    file_storage.save(destination)
    size = os.path.getsize(destination)
    if size <= 0:
        destination.unlink(missing_ok=True)
        abort(400, "Uploaded file is empty.")
    if size > current_app.config["MAX_CONTENT_LENGTH"]:
        destination.unlink(missing_ok=True)
        abort(413, "Uploaded file is too large.")

    base_upload = Path(current_app.config["UPLOAD_FOLDER"])
    relative_path = destination.relative_to(base_upload).as_posix()
    if current_app.config.get("DESKTOP_MODE"):
        url_path = f"/user-data/uploads/{relative_path}"
    else:
        url_path = f"/static/uploads/{relative_path}"
    return {
        "filename": filename,
        "original_filename": original_name,
        "storage_path": str(destination),
        "url_path": url_path,
        "mimetype": mimetype,
        "file_size": size,
    }
