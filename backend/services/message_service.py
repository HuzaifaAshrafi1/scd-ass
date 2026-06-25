from datetime import datetime

from sqlalchemy import and_, func, or_

from extensions import db, socketio
from models import Attachment, Message, MessageHidden, MessageReaction
from models.message_features import REACTION_EMOJIS
from time_utils import utc_now
from controllers.helpers import sanitize_text


class MessageService:
  @staticmethod
  def reaction_summary(message_id, viewer_id):
    rows = MessageReaction.query.filter_by(message_id=message_id).all()
    return MessageService._summarize_reactions(rows, viewer_id)

  @staticmethod
  def batch_reaction_summaries(message_ids, viewer_id):
    if not message_ids:
      return {}
    rows = MessageReaction.query.filter(MessageReaction.message_id.in_(message_ids)).all()
    grouped = {}
    for row in rows:
      grouped.setdefault(row.message_id, []).append(row)
    return {
      message_id: MessageService._summarize_reactions(reaction_rows, viewer_id)
      for message_id, reaction_rows in grouped.items()
    }

  @staticmethod
  def _summarize_reactions(rows, viewer_id):
    summary = {}
    for row in rows:
      bucket = summary.setdefault(
        row.emoji,
        {"emoji": row.emoji, "count": 0, "users": [], "mine": False},
      )
      bucket["count"] += 1
      bucket["users"].append({"id": row.user.id, "display_name": row.user.display_name})
      if row.user_id == viewer_id:
        bucket["mine"] = True
    return list(summary.values())

  @staticmethod
  def hidden_message_ids(user_id, message_ids):
    if not message_ids:
      return set()
    rows = MessageHidden.query.filter(
      MessageHidden.user_id == user_id,
      MessageHidden.message_id.in_(message_ids),
    ).all()
    return {row.message_id for row in rows}

  @staticmethod
  def group_read_count(conversation, message):
    if conversation.type != "group":
      return None
    from models import GroupMember

    members = GroupMember.query.filter_by(
      group_id=conversation.group_id, is_active=True
    ).all()
    count = 0
    for member in members:
      if member.user_id == message.sender_id:
        continue
      if member.last_read_at and member.last_read_at >= message.created_at:
        count += 1
    return count

  @staticmethod
  def to_dict(message, viewer_id=None, reactions=None):
    conversation = message.conversation
    deleted_for_everyone = bool(message.is_deleted and message.deleted_for_everyone)
    show_placeholder = deleted_for_everyone or (
      message.is_deleted and viewer_id and message.sender_id != viewer_id
    )
    payload = {
      "id": message.id,
      "conversation_id": message.conversation_id,
      "sender": message.sender.to_public_dict(),
      "body": "" if show_placeholder else message.body,
      "message_type": "deleted" if show_placeholder else message.message_type,
      "status": message.status,
      "delivered_at": message.delivered_at.isoformat() if message.delivered_at else None,
      "read_at": message.read_at.isoformat() if message.read_at else None,
      "is_deleted": show_placeholder,
      "deleted_for_everyone": deleted_for_everyone,
      "edited_at": message.edited_at.isoformat() if message.edited_at else None,
      "is_forwarded": bool(message.is_forwarded),
      "forward_from_name": message.forward_from_name,
      "created_at": message.created_at.isoformat() if message.created_at else None,
      "attachment": message.attachment.to_dict()
      if message.attachment and not show_placeholder
      else None,
      "reactions": reactions if reactions is not None else (
        MessageService.reaction_summary(message.id, viewer_id) if viewer_id else []
      ),
    }
    if viewer_id and conversation.type == "group" and message.sender_id == viewer_id:
      payload["read_count"] = MessageService.group_read_count(conversation, message)
    return payload

  @staticmethod
  def list_for_conversation(conversation_id, viewer_id, query=None, limit=300, before_id=None):
    messages_query = Message.query.filter_by(conversation_id=conversation_id)
    if query:
      messages_query = messages_query.filter(Message.body.ilike(f"%{query}%"))
    if before_id:
      messages_query = messages_query.filter(Message.id < before_id)
    rows = (
      messages_query
      .order_by(Message.created_at.desc(), Message.id.desc())
      .limit(limit + 1)
      .all()
    )
    has_more = len(rows) > limit
    messages = list(reversed(rows[:limit]))
    message_ids = [message.id for message in messages]
    hidden_ids = MessageService.hidden_message_ids(viewer_id, message_ids)
    reaction_map = MessageService.batch_reaction_summaries(message_ids, viewer_id)
    visible = [message for message in messages if message.id not in hidden_ids]
    return {
      "messages": [
        MessageService.to_dict(
          message,
          viewer_id,
          reactions=reaction_map.get(message.id, []),
        )
        for message in visible
      ],
      "pagination": {
        "has_more": has_more,
        "limit": limit,
        "oldest_id": visible[0].id if visible else None,
      },
    }

  @staticmethod
  def create(
    conversation,
    sender,
    body,
    attachment_data=None,
    *,
    is_forwarded=False,
    forward_from_name=None,
    get_online_count=None,
  ):
    body = sanitize_text(body, 4000)
    if not body and not attachment_data:
      raise ValueError("Message cannot be empty.")

    message_type = "text"
    if attachment_data:
      message_type = "image" if attachment_data["mimetype"].startswith("image/") else "document"

    status = "delivered"
    delivered_at = utc_now()
    if conversation.type == "direct" and get_online_count:
      receiver_id = (
        conversation.user_two_id
        if conversation.user_one_id == sender.id
        else conversation.user_one_id
      )
      if get_online_count(receiver_id) == 0:
        status = "sent"
        delivered_at = None

    message = Message(
      conversation_id=conversation.id,
      sender_id=sender.id,
      body=body,
      message_type=message_type,
      status=status,
      delivered_at=delivered_at,
      is_forwarded=is_forwarded,
      forward_from_name=forward_from_name,
    )
    db.session.add(message)
    db.session.flush()

    if attachment_data:
      db.session.add(
        Attachment(message_id=message.id, uploaded_by_id=sender.id, **attachment_data)
      )

    conversation.last_message_at = message.created_at
    db.session.commit()
    return message

  @staticmethod
  def mark_conversation_read(conversation, user_id, set_last_read_for, conversation_room):
    now = set_last_read_for(conversation, user_id)
    changed = []
    for message in Message.query.filter(
      Message.conversation_id == conversation.id,
      Message.sender_id != user_id,
      Message.is_deleted.is_(False),
      Message.read_at.is_(None),
    ).all():
      message.status = "seen"
      message.read_at = now
      changed.append(message.id)
    db.session.commit()

    if changed:
      socketio.emit(
        "message:read",
        {
          "conversation_id": conversation.id,
          "message_ids": changed,
          "read_at": now.isoformat(),
        },
        to=conversation_room(conversation.id),
      )
    return changed

  @staticmethod
  def supported_emoji(emoji):
    return emoji in REACTION_EMOJIS
