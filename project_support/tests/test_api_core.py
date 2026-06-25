import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app import create_app
from config import Config
from extensions import db
from models import Conversation, Friend, FriendRequest, Message, User
from controllers.friends_controller import add_friendship
from controllers.auth_controller import _failed_login_attempts


class ApiCoreTests(unittest.TestCase):
    def setUp(self):
        _failed_login_attempts.clear()
        self.temp_dir = tempfile.TemporaryDirectory()
        root = Path(self.temp_dir.name)

        class TestConfig(Config):
            TESTING = True
            SECRET_KEY = "api-core-test-secret"
            DESKTOP_MODE = False
            SQLALCHEMY_DATABASE_URI = f"sqlite:///{root / 'test.db'}"
            UPLOAD_FOLDER = root / "uploads"
            AVATAR_UPLOAD_FOLDER = UPLOAD_FOLDER / "avatars"
            ATTACHMENT_UPLOAD_FOLDER = UPLOAD_FOLDER / "attachments"
            DATA_DIR = root / "data"
            LOG_FOLDER = root / "logs"
            WTF_CSRF_ENABLED = False

        self.app = create_app(TestConfig)
        self.client = self.app.test_client()
        with self.app.app_context():
            db.create_all()
            self.alice = User(username="alice", display_name="Alice")
            self.alice.set_password("Password123!")
            self.bob = User(username="bob", display_name="Bob")
            self.bob.set_password("Password123!")
            db.session.add_all([self.alice, self.bob])
            db.session.commit()
            self.alice_id = self.alice.id
            self.bob_id = self.bob.id

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

    def login(self, username="alice", password="Password123!"):
        token = self.csrf_token("/login")
        return self.client.post(
            "/login",
            data={"username": username, "password": password, "csrf_token": token},
            follow_redirects=True,
        )

    def api_headers(self):
        return {"X-CSRFToken": self.csrf_token("/chat")}

    def test_register_and_login(self):
        token = self.csrf_token("/register")
        response = self.client.post(
            "/register",
            data={
                "username": "carol",
                "display_name": "Carol",
                "password": "Password123!",
                "confirm_password": "Password123!",
                "csrf_token": token,
            },
            follow_redirects=True,
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("/chat", response.request.path)

        self.client.post("/logout", data={"csrf_token": self.csrf_token("/chat")}, follow_redirects=True)
        login_response = self.login("carol", "Password123!")
        self.assertEqual(login_response.status_code, 200)

    def test_health_endpoint(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["backend"])
        self.assertTrue(payload["database"])

    def test_direct_conversation_and_message_lifecycle(self):
        with self.app.app_context():
            add_friendship(self.alice_id, self.bob_id)
            db.session.commit()

        self.login("alice")
        headers = self.api_headers()
        create_response = self.client.post(
            "/api/conversations/direct",
            json={"user_id": self.bob_id},
            headers=headers,
        )
        self.assertEqual(create_response.status_code, 200)
        conversation_id = create_response.get_json()["conversation"]["id"]

        send_response = self.client.post(
            f"/api/conversations/{conversation_id}/messages",
            data={"body": "Hello Bob"},
            headers=headers,
        )
        self.assertEqual(send_response.status_code, 201)
        message_id = send_response.get_json()["message"]["id"]

        list_response = self.client.get(
            f"/api/conversations/{conversation_id}/messages",
            headers=headers,
        )
        self.assertEqual(list_response.status_code, 200)
        bodies = [item["body"] for item in list_response.get_json()["messages"]]
        self.assertIn("Hello Bob", bodies)

        delete_response = self.client.delete(
            f"/api/messages/{message_id}?scope=everyone",
            headers=headers,
        )
        self.assertEqual(delete_response.status_code, 200)

        after_delete = self.client.get(
            f"/api/conversations/{conversation_id}/messages",
            headers=headers,
        )
        deleted = after_delete.get_json()["messages"][0]
        self.assertTrue(deleted["is_deleted"])

    def test_messages_are_paginated_from_latest_page(self):
        with self.app.app_context():
            conversation = Conversation(
                type="direct",
                user_one_id=self.alice_id,
                user_two_id=self.bob_id,
            )
            db.session.add(conversation)
            db.session.flush()
            conversation_id = conversation.id
            for index in range(5):
                db.session.add(
                    Message(
                        conversation_id=conversation_id,
                        sender_id=self.alice_id,
                        body=f"msg {index}",
                    )
                )
            db.session.commit()

        self.login("alice")
        headers = self.api_headers()
        response = self.client.get(
            f"/api/conversations/{conversation_id}/messages?limit=2",
            headers=headers,
        )
        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual([item["body"] for item in payload["messages"]], ["msg 3", "msg 4"])
        self.assertTrue(payload["pagination"]["has_more"])

        before_id = payload["pagination"]["oldest_id"]
        previous = self.client.get(
            f"/api/conversations/{conversation_id}/messages?limit=2&before_id={before_id}",
            headers=headers,
        )
        self.assertEqual(previous.status_code, 200)
        self.assertEqual(
            [item["body"] for item in previous.get_json()["messages"]],
            ["msg 1", "msg 2"],
        )

    def test_socket_connect_uses_session_user(self):
        self.login("alice")
        socket_client = self.app.extensions["socketio"].test_client(
            self.app,
            flask_test_client=self.client,
        )
        self.assertTrue(socket_client.is_connected())
        received = socket_client.get_received()
        self.assertTrue(any(item["name"] == "socket:ready" for item in received))
        socket_client.disconnect()

    def test_friend_request_flow(self):
        self.login("alice")
        headers = self.api_headers()
        request_response = self.client.post(
            "/api/friends/request",
            json={"user_id": self.bob_id},
            headers=headers,
        )
        self.assertEqual(request_response.status_code, 201)

        self.client.post("/logout", data={"csrf_token": self.csrf_token("/chat")}, follow_redirects=True)
        self.login("bob")
        bob_headers = self.api_headers()
        requests_response = self.client.get("/api/friends/requests", headers=bob_headers)
        received = requests_response.get_json()["received"]
        self.assertEqual(len(received), 1)

        accept_response = self.client.post(
            f"/api/friends/requests/{received[0]['id']}/accept",
            headers=bob_headers,
        )
        self.assertEqual(accept_response.status_code, 200)

        friends_response = self.client.get("/api/friends", headers=bob_headers)
        friend_ids = [friend["id"] for friend in friends_response.get_json()["friends"]]
        self.assertIn(self.alice_id, friend_ids)


if __name__ == "__main__":
    unittest.main()
