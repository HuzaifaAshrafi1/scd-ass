from datetime import datetime

from extensions import db
from time_utils import utc_now


class Conversation(db.Model):
    __tablename__ = "conversations"

    id = db.Column(db.Integer, primary_key=True)
    type = db.Column(db.String(20), nullable=False, index=True)
    title = db.Column(db.String(140))
    user_one_id = db.Column(db.Integer, db.ForeignKey("users.id"), index=True)
    user_two_id = db.Column(db.Integer, db.ForeignKey("users.id"), index=True)
    group_id = db.Column(db.Integer, db.ForeignKey("groups.id"), unique=True, index=True)
    user_one_last_read_at = db.Column(db.DateTime, default=utc_now, nullable=False)
    user_two_last_read_at = db.Column(db.DateTime, default=utc_now, nullable=False)
    created_at = db.Column(db.DateTime, default=utc_now, nullable=False)
    updated_at = db.Column(
        db.DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )
    last_message_at = db.Column(db.DateTime, default=utc_now, nullable=False, index=True)

    user_one = db.relationship("User", foreign_keys=[user_one_id])
    user_two = db.relationship("User", foreign_keys=[user_two_id])
    group = db.relationship("Group")
    messages = db.relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at.asc()",
    )

    __table_args__ = (
        db.CheckConstraint(
            "(type = 'direct' AND user_one_id IS NOT NULL AND user_two_id IS NOT NULL AND group_id IS NULL) "
            "OR (type = 'group' AND group_id IS NOT NULL)",
            name="ck_conversation_shape",
        ),
        db.UniqueConstraint("user_one_id", "user_two_id", name="uq_direct_conversation"),
    )


class Message(db.Model):
    __tablename__ = "messages"

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(
        db.Integer, db.ForeignKey("conversations.id"), nullable=False, index=True
    )
    sender_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    body = db.Column(db.Text, default="")
    message_type = db.Column(db.String(20), default="text", nullable=False)
    status = db.Column(db.String(20), default="sent", nullable=False, index=True)
    delivered_at = db.Column(db.DateTime)
    read_at = db.Column(db.DateTime)
    is_deleted = db.Column(db.Boolean, default=False, nullable=False)
    deleted_for_everyone = db.Column(db.Boolean, default=False, nullable=False)
    edited_at = db.Column(db.DateTime)
    is_forwarded = db.Column(db.Boolean, default=False, nullable=False)
    forward_from_name = db.Column(db.String(120))
    created_at = db.Column(db.DateTime, default=utc_now, nullable=False, index=True)
    updated_at = db.Column(
        db.DateTime, default=utc_now, onupdate=utc_now, nullable=False
    )

    conversation = db.relationship("Conversation", back_populates="messages")
    sender = db.relationship("User")
    attachment = db.relationship(
        "Attachment", back_populates="message", cascade="all, delete-orphan", uselist=False
    )


class Attachment(db.Model):
    __tablename__ = "attachments"

    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("messages.id"), unique=True, index=True)
    uploaded_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    filename = db.Column(db.String(255), nullable=False)
    original_filename = db.Column(db.String(255), nullable=False)
    storage_path = db.Column(db.String(500), nullable=False)
    url_path = db.Column(db.String(500), nullable=False)
    mimetype = db.Column(db.String(120), nullable=False)
    file_size = db.Column(db.Integer, nullable=False)
    created_at = db.Column(db.DateTime, default=utc_now, nullable=False)

    message = db.relationship("Message", back_populates="attachment")
    uploaded_by = db.relationship("User")

    def to_dict(self):
        return {
            "id": self.id,
            "filename": self.filename,
            "original_filename": self.original_filename,
            "url": self.url_path,
            "mimetype": self.mimetype,
            "file_size": self.file_size,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
