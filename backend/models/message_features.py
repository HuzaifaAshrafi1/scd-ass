from extensions import db
from time_utils import utc_now


REACTION_EMOJIS = {"👍", "❤️", "😂", "😮", "😢", "😡", "🎉", "🔥"}


class MessageReaction(db.Model):
    __tablename__ = "message_reactions"

    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("messages.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    emoji = db.Column(db.String(8), nullable=False)
    created_at = db.Column(db.DateTime, default=utc_now, nullable=False)

    user = db.relationship("User")

    __table_args__ = (
        db.UniqueConstraint("message_id", "user_id", "emoji", name="uq_message_reaction"),
    )


class MessageHidden(db.Model):
    __tablename__ = "message_hidden"

    id = db.Column(db.Integer, primary_key=True)
    message_id = db.Column(db.Integer, db.ForeignKey("messages.id"), nullable=False, index=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=utc_now, nullable=False)

    __table_args__ = (
        db.UniqueConstraint("message_id", "user_id", name="uq_message_hidden"),
    )


class PinnedMessage(db.Model):
    __tablename__ = "pinned_messages"

    id = db.Column(db.Integer, primary_key=True)
    conversation_id = db.Column(
        db.Integer, db.ForeignKey("conversations.id"), nullable=False, unique=True, index=True
    )
    message_id = db.Column(db.Integer, db.ForeignKey("messages.id"), nullable=False, index=True)
    pinned_by_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)
    pinned_at = db.Column(db.DateTime, default=utc_now, nullable=False)

    message = db.relationship("Message")
    pinned_by = db.relationship("User")
