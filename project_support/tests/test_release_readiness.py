import io
import re
import tempfile
import unittest
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import create_app
from config import Config
from extensions import db
from models import Attachment, Conversation, Message, User
from controllers.auth_controller import _failed_login_attempts


class ReleaseReadinessTests(unittest.TestCase):
    def setUp(self):
        _failed_login_attempts.clear()
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)

        class TestConfig(Config):
            TESTING = True
            SECRET_KEY = "release-test-secret"
            DESKTOP_MODE = True
            APP_DATA_DIR = root
            DATA_DIR = root / "data"
            LOG_FOLDER = root / "logs"
            UPLOAD_FOLDER = root / "uploads"
            AVATAR_UPLOAD_FOLDER = UPLOAD_FOLDER / "avatars"
            ATTACHMENT_UPLOAD_FOLDER = UPLOAD_FOLDER / "attachments"
            SQLALCHEMY_DATABASE_URI = f"sqlite:///{root / 'data' / 'database.db'}"
            LOGIN_RATE_LIMIT_ATTEMPTS = 3
            LOGIN_RATE_LIMIT_WINDOW_SECONDS = 60
            LOGIN_RATE_LIMIT_LOCK_SECONDS = 60

        self.app = create_app(TestConfig)
        self.client = self.app.test_client()
        with self.app.app_context():
            db.create_all()
            self.ahmed = User(username="ahmed", display_name="Ahmed Khan")
            self.ahmed.set_password("Password123!")
            self.ayesha = User(username="ayesha", display_name="Ayesha Siddiqui")
            self.ayesha.set_password("Password123!")
            self.usman = User(username="usman", display_name="Usman Tariq")
            self.usman.set_password("Password123!")
            db.session.add_all([self.ahmed, self.ayesha, self.usman])
            db.session.flush()
            self.conversation = Conversation(
                type="direct",
                user_one_id=self.ahmed.id,
                user_two_id=self.ayesha.id,
            )
            db.session.add(self.conversation)
            db.session.flush()
            self.message = Message(
                conversation_id=self.conversation.id,
                sender_id=self.ahmed.id,
                body="Release test attachment.",
            )
            db.session.add(self.message)
            db.session.commit()
            self.ahmed_id = self.ahmed.id
            self.ayesha_id = self.ayesha.id
            self.usman_id = self.usman.id
            self.conversation_id = self.conversation.id
            self.message_id = self.message.id

    def tearDown(self):
        with self.app.app_context():
            db.session.remove()
            db.drop_all()
            db.engine.dispose()
        for handler in list(self.app.logger.handlers):
            handler.close()
            self.app.logger.removeHandler(handler)
        self.temp_dir.cleanup()

    def csrf_token(self, path="/login"):
        response = self.client.get(path)
        match = re.search(r'name="csrf_token" value="([^"]+)"', response.get_data(as_text=True))
        self.assertIsNotNone(match)
        return match.group(1)

    def login(self, username="ahmed", password="Password123!"):
        token = self.csrf_token("/login")
        return self.client.post(
            "/login",
            data={"username": username, "password": password, "csrf_token": token},
            follow_redirects=False,
        )

    def test_health_endpoint_is_available(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["status"], "ok")
        self.assertTrue(payload["backend"])
        self.assertTrue(payload["database"])

    def test_login_rate_limit_blocks_repeated_failures(self):
        token = self.csrf_token("/login")
        for _ in range(3):
            response = self.client.post(
                "/login",
                data={"username": "ahmed", "password": "wrong", "csrf_token": token},
            )
            self.assertEqual(response.status_code, 200)

        response = self.client.post(
            "/login",
            data={"username": "ahmed", "password": "wrong", "csrf_token": token},
        )
        self.assertEqual(response.status_code, 429)
        self.assertIn("Too many login attempts", response.get_data(as_text=True))

    def test_spoofed_image_upload_is_rejected(self):
        self.login()
        token = self.csrf_token("/chat")
        response = self.client.post(
            f"/api/conversations/{self.conversation_id}/messages",
            data={
                "body": "bad upload",
                "csrf_token": token,
                "attachment": (io.BytesIO(b"not really a png"), "spoof.png"),
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 400)

    def test_desktop_upload_route_requires_auth_and_conversation_membership(self):
        with self.app.app_context():
            attachment_dir = Path(self.app.config["ATTACHMENT_UPLOAD_FOLDER"])
            attachment_dir.mkdir(parents=True, exist_ok=True)
            attachment_path = attachment_dir / "release-note.txt"
            attachment_path.write_text("hello", encoding="utf-8")
            db.session.add(
                Attachment(
                    message_id=self.message_id,
                    uploaded_by_id=self.ahmed_id,
                    filename=attachment_path.name,
                    original_filename="release-note.txt",
                    storage_path=str(attachment_path),
                    url_path="/user-data/uploads/attachments/release-note.txt",
                    mimetype="text/plain",
                    file_size=5,
                )
            )
            db.session.commit()

        unauthenticated = self.client.get("/user-data/uploads/attachments/release-note.txt")
        self.assertEqual(unauthenticated.status_code, 302)

        self.login("ahmed")
        allowed = self.client.get("/user-data/uploads/attachments/release-note.txt")
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.data, b"hello")
        allowed.close()

        self.client.post("/logout", data={"csrf_token": self.csrf_token("/chat")})
        self.login("usman")
        denied = self.client.get("/user-data/uploads/attachments/release-note.txt")
        self.assertEqual(denied.status_code, 404)

    def test_attachment_download_rejects_storage_path_outside_upload_root(self):
        with self.app.app_context():
            outside_path = Path(self.temp_dir.name) / "outside.txt"
            outside_path.write_text("do not expose", encoding="utf-8")
            attachment = Attachment(
                message_id=self.message_id,
                uploaded_by_id=self.ahmed_id,
                filename="outside.txt",
                original_filename="outside.txt",
                storage_path=str(outside_path),
                url_path="/user-data/uploads/attachments/outside.txt",
                mimetype="text/plain",
                file_size=13,
            )
            db.session.add(attachment)
            db.session.commit()
            attachment_id = attachment.id

        self.login("ahmed")
        response = self.client.get(f"/api/attachments/{attachment_id}/download")
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
