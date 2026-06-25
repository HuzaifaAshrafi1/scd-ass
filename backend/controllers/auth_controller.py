from time import monotonic

from flask import Blueprint, current_app, flash, g, redirect, render_template, request, session, url_for

from extensions import db
from models import User
from controllers.helpers import USERNAME_PATTERN, get_csrf_token, sanitize_text


auth_bp = Blueprint("auth", __name__)
_failed_login_attempts = {}


def _login_throttle_key(username):
    remote_addr = request.headers.get("X-Forwarded-For", request.remote_addr or "local")
    return f"{remote_addr.split(',')[0].strip()}:{username or 'unknown'}"


def _prune_login_attempts(key, now):
    window_seconds = current_app.config["LOGIN_RATE_LIMIT_WINDOW_SECONDS"]
    attempts = [
        timestamp
        for timestamp in _failed_login_attempts.get(key, [])
        if now - timestamp <= window_seconds
    ]
    if attempts:
        _failed_login_attempts[key] = attempts
    else:
        _failed_login_attempts.pop(key, None)
    return attempts


def _is_login_limited(key):
    now = monotonic()
    attempts = _prune_login_attempts(key, now)
    max_attempts = current_app.config["LOGIN_RATE_LIMIT_ATTEMPTS"]
    lock_seconds = current_app.config["LOGIN_RATE_LIMIT_LOCK_SECONDS"]
    return len(attempts) >= max_attempts and now - attempts[-1] <= lock_seconds


def _record_failed_login(key):
    now = monotonic()
    attempts = _prune_login_attempts(key, now)
    attempts.append(now)
    _failed_login_attempts[key] = attempts


def _clear_failed_logins(key):
    _failed_login_attempts.pop(key, None)


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("chat.chat"))

    if request.method == "POST":
        username = sanitize_text(request.form.get("username"), 40).lower()
        password = request.form.get("password", "")
        throttle_key = _login_throttle_key(username)

        if _is_login_limited(throttle_key):
            flash("Too many login attempts. Please wait a few minutes and try again.", "error")
            return render_template("login.html"), 429

        user = User.query.filter_by(username=username).first()

        if not user or not user.check_password(password):
            _record_failed_login(throttle_key)
            flash("Invalid username or password.", "error")
            return render_template("login.html")

        _clear_failed_logins(throttle_key)
        session.clear()
        session["user_id"] = user.id
        get_csrf_token()
        return redirect(url_for("chat.chat"))

    get_csrf_token()
    return render_template("login.html")


@auth_bp.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(url_for("chat.chat"))

    if request.method == "POST":
        username = sanitize_text(request.form.get("username"), 40).lower()
        display_name = sanitize_text(request.form.get("display_name"), 80)
        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")

        if not USERNAME_PATTERN.match(username):
            flash("Use 3-40 letters, numbers, or underscores for the username.", "error")
            return render_template("register.html")
        if len(password) < 8:
            flash("Password must be at least 8 characters.", "error")
            return render_template("register.html")
        if password != confirm_password:
            flash("Passwords do not match.", "error")
            return render_template("register.html")
        if User.query.filter_by(username=username).first():
            flash("That username is already taken.", "error")
            return render_template("register.html")

        user = User(username=username, display_name=display_name or username)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()

        session.clear()
        session["user_id"] = user.id
        get_csrf_token()
        return redirect(url_for("chat.chat"))

    get_csrf_token()
    return render_template("register.html")


@auth_bp.post("/logout")
def logout():
    session.clear()
    return redirect(url_for("auth.login"))
