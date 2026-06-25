# WeChat-Inspired Chat Clone

This is a full-stack real-time messaging application inspired by WeChat-style chat workflows. It does not use WeChat branding, logos, copyrighted assets, or proprietary code.

## Project Structure

```text
Ali raza Assignment/
├── frontend/              # HTML templates, CSS, JavaScript, images/uploads
├── backend/               # Flask app, controllers, services, models, database setup
├── desktop/               # Electron desktop shell
├── project_support/       # Docs, tests, scripts, packaging, icons, build output
├── start_app.cmd          # Start web/browser version
├── stop_app.cmd           # Stop web/browser version
├── start_desktop.cmd      # Start Electron desktop version
├── stop_desktop.cmd       # Stop Electron desktop version
├── start_all.cmd          # Start default web version, or desktop with argument
├── stop_all.cmd           # Stop web and desktop versions
└── seed_sample_data.cmd   # Add demo users and chats
```

## Backend MVC

- Models: SQLAlchemy ORM classes in `backend/models`.
- Views: Jinja templates and frontend assets in `frontend`.
- Controllers: Flask blueprints and Socket.IO event handlers in `backend/controllers`.

## Features

- Registration, login, logout, hashed passwords, server sessions, profile photo uploads.
- User profile fields: username, display name, bio, profile photo, online status, last seen.
- User search, friend requests, accept/reject, friend list, and friend removal.
- One-to-one real-time chat with typing indicators, timestamps, delivery status, seen receipts, unread counters, and message history.
- Group creation, admin member management, group info drawer, and group messaging.
- Image/document upload, image preview, and secure attachment download route.
- Message search, emoji picker, delete message, conversation sidebar, notifications, dark mode, and responsive UI.
- CSRF checks for mutating HTTP routes, extension-restricted uploads, SQLAlchemy queries, and Werkzeug password hashing.

## Windows Setup

1. Install Python 3.11 or newer.
2. Open this project folder in File Explorer.
3. Double-click `start_app.cmd` (or run `start_all.cmd` for the same web mode).
4. The script creates `backend\.venv`, installs dependencies only when needed, initializes SQLite, then opens two windows in parallel:
   - **Backend** — Flask server (API + web UI in one process) on a free local port
   - **Frontend** — waits for `/health`, then opens your browser
5. Stop the app with `stop_app.cmd`.

**Desktop app** (optional): install Node.js 18+, then double-click `start_desktop.cmd` or run `start_all.cmd desktop`. Electron starts Flask automatically and shows the chat UI in a desktop window. Stop it with `stop_desktop.cmd`.

Useful commands:

```text
start_app.cmd       Start web version in browser
stop_app.cmd        Stop web version
start_desktop.cmd   Start desktop version
stop_desktop.cmd    Stop desktop version
start_all.cmd       Start web version
start_all.cmd desktop
stop_all.cmd        Stop everything
```

To add sample data:

1. Stop the server with `Ctrl+C`, or open a second Command Prompt.
2. Double-click `seed_sample_data.cmd`.
3. Start the app again with `start_app.cmd`.

The seed script is idempotent — safe to re-run. It creates ~46 friends and ~50 conversations (direct + group chats) for the demo `user` account, each with multiple messages spread over recent days.

Sample users:

```text
user
ahmed
ayesha
usman
fatima
```

Recommended demo credential:

```text
Username: user
Password: 12345678
```

Password for Pakistani Muslim sample users:

```text
Password123!
```

## Manual Setup

```bat
cd backend
python -m venv .venv
call .venv\Scripts\activate.bat
pip install -r requirements.txt
set FLASK_APP=app.py
flask init-db
python seed.py
python app.py
```

## Live Deployment

The repository includes production entry points for GitHub-based hosting:

- `Procfile` for platforms that detect Python web apps.
- `render.yaml` for one-click Render deployment with a persistent SQLite database and upload storage.
- `runtime.txt` to pin Python 3.11.

Recommended Render steps:

1. Push the latest code to GitHub.
2. In Render, create a new **Blueprint** and select this repository.
3. Render will read `render.yaml`, install `backend/requirements.txt`, and start the Flask app with Gunicorn.
4. After the first deploy, open `/health` on the live URL to confirm the app and database are working.

Important environment variables:

```text
SECRET_KEY                 Required in production; Render generates it from render.yaml.
SESSION_COOKIE_SECURE      Set to true when using HTTPS.
DATABASE_URL               SQLite path or another SQLAlchemy database URL.
WECHAT_CLONED_DATA_DIR     Persistent data folder.
WECHAT_CLONED_UPLOAD_ROOT  Persistent upload folder.
WECHAT_CLONED_LOG_DIR      Persistent log folder.
```

To add demo users on the live server, run this command in the host shell after deployment:

```sh
cd backend && python seed.py
```

## SQLite Schema

The canonical schema is in `backend/schema.sql`. The app creates the SQLite database with SQLAlchemy when you run `flask init-db` or `python app.py`.

Database file:

```text
backend/database.db
```

## Notes

- The Socket.IO browser client is loaded from the official Socket.IO CDN in `frontend/templates/chat.html`.
- Uploaded files are stored under `frontend/static/uploads`.
- For deployment, set a strong `SECRET_KEY` environment variable and enable HTTPS/session secure cookies.
