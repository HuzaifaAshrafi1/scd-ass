from datetime import datetime

from sqlalchemy import and_, func, or_

from extensions import db
from models import Conversation, Friend, GroupMember, Message
from services.message_service import MessageService


class ConversationService:
  @staticmethod
  def direct_ids_for_user(user_id):
    rows = Conversation.query.filter(
      Conversation.type == "direct",
      or_(Conversation.user_one_id == user_id, Conversation.user_two_id == user_id),
    ).all()
    return [row.id for row in rows]

  @staticmethod
  def group_ids_for_user(user_id):
    rows = (
      Conversation.query.join(GroupMember, GroupMember.group_id == Conversation.group_id)
      .filter(
        Conversation.type == "group",
        GroupMember.user_id == user_id,
        GroupMember.is_active.is_(True),
      )
      .all()
    )
    return [row.id for row in rows]

  @staticmethod
  def for_user(conversation_id, user_id):
    conversation = db.session.get(Conversation, conversation_id)
    if not conversation:
      return None
    if conversation.type == "direct":
      if user_id in {conversation.user_one_id, conversation.user_two_id}:
        return conversation
      return None
    member = GroupMember.query.filter_by(
      group_id=conversation.group_id, user_id=user_id, is_active=True
    ).first()
    return conversation if member else None

  @staticmethod
  def participant_ids(conversation):
    if conversation.type == "direct":
      return [conversation.user_one_id, conversation.user_two_id]
    members = GroupMember.query.filter_by(
      group_id=conversation.group_id, is_active=True
    ).all()
    return [member.user_id for member in members]

  @staticmethod
  def last_read_for(conversation, user_id):
    if conversation.type == "group":
      membership = GroupMember.query.filter_by(
        group_id=conversation.group_id, user_id=user_id
      ).first()
      return membership.last_read_at if membership else datetime.min
    if conversation.user_one_id == user_id:
      return conversation.user_one_last_read_at
    return conversation.user_two_last_read_at

  @staticmethod
  def set_last_read_for(conversation, user_id, now):
    if conversation.type == "group":
      membership = GroupMember.query.filter_by(
        group_id=conversation.group_id, user_id=user_id
      ).first()
      if membership:
        membership.last_read_at = now
    elif conversation.user_one_id == user_id:
      conversation.user_one_last_read_at = now
    else:
      conversation.user_two_last_read_at = now
    return now

  @staticmethod
  def title(conversation, user_id):
    if conversation.type == "group":
      return conversation.group.name
    other_user = (
      conversation.user_two
      if conversation.user_one_id == user_id
      else conversation.user_one
    )
    return other_user.display_name

  @staticmethod
  def photo(conversation, user_id):
    if conversation.type == "group":
      return conversation.group.photo
    other_user = (
      conversation.user_two
      if conversation.user_one_id == user_id
      else conversation.user_one
    )
    return other_user.profile_photo

  @staticmethod
  def _batch_last_messages(conversation_ids):
    if not conversation_ids:
      return {}
    subq = (
      db.session.query(
        Message.conversation_id,
        func.max(Message.created_at).label("max_created"),
      )
      .filter(Message.conversation_id.in_(conversation_ids))
      .group_by(Message.conversation_id)
      .subquery()
    )
    rows = (
      Message.query.join(
        subq,
        and_(
          Message.conversation_id == subq.c.conversation_id,
          Message.created_at == subq.c.max_created,
        ),
      ).all()
    )
    return {row.conversation_id: row for row in rows}

  @staticmethod
  def _batch_unread_counts(conversations, user_id):
    if not conversations:
      return {}
    last_reads = {
      conversation.id: ConversationService.last_read_for(conversation, user_id) or datetime.min
      for conversation in conversations
    }
    filters = [
      and_(
        Message.conversation_id == conversation.id,
        Message.sender_id != user_id,
        Message.is_deleted.is_(False),
        Message.created_at > last_reads[conversation.id],
      )
      for conversation in conversations
    ]
    counts = {conversation.id: 0 for conversation in conversations}
    if not filters:
      return counts
    rows = (
      db.session.query(Message.conversation_id, func.count(Message.id))
      .filter(or_(*filters))
      .group_by(Message.conversation_id)
      .all()
    )
    for conversation_id, count in rows:
      counts[conversation_id] = count
    return counts

  @staticmethod
  def to_dict(conversation, user_id, *, last_message=None, unread_count=None, reactions=None):
    if last_message is None:
      last_message = (
        Message.query.filter_by(conversation_id=conversation.id)
        .order_by(Message.created_at.desc())
        .first()
      )
    if unread_count is None:
      last_read_at = ConversationService.last_read_for(conversation, user_id) or datetime.min
      unread_count = Message.query.filter(
        Message.conversation_id == conversation.id,
        Message.sender_id != user_id,
        Message.is_deleted.is_(False),
        Message.created_at > last_read_at,
      ).count()

    payload = {
      "id": conversation.id,
      "type": conversation.type,
      "title": ConversationService.title(conversation, user_id),
      "photo": ConversationService.photo(conversation, user_id),
      "unread_count": unread_count,
      "last_message": (
        MessageService.to_dict(last_message, user_id, reactions=reactions or [])
        if last_message
        else None
      ),
      "last_message_at": conversation.last_message_at.isoformat()
      if conversation.last_message_at
      else None,
      "created_at": conversation.created_at.isoformat() if conversation.created_at else None,
    }
    if conversation.type == "direct":
      other_user = (
        conversation.user_two
        if conversation.user_one_id == user_id
        else conversation.user_one
      )
      payload["other_user"] = other_user.to_public_dict()
    else:
      payload["group"] = conversation.group.to_dict()
    return payload

  @staticmethod
  def serialize_for_user(user_id):
    direct_ids = ConversationService.direct_ids_for_user(user_id)
    group_ids = ConversationService.group_ids_for_user(user_id)
    conversation_ids = direct_ids + group_ids
    if not conversation_ids:
      return []

    conversations = Conversation.query.filter(
      Conversation.id.in_(conversation_ids)
    ).order_by(Conversation.last_message_at.desc()).all()

    last_by_id = ConversationService._batch_last_messages(conversation_ids)
    unread_by_id = ConversationService._batch_unread_counts(conversations, user_id)
    last_message_ids = [message.id for message in last_by_id.values()]
    reaction_map = MessageService.batch_reaction_summaries(last_message_ids, user_id)

    return [
      ConversationService.to_dict(
        conversation,
        user_id,
        last_message=last_by_id.get(conversation.id),
        unread_count=unread_by_id.get(conversation.id, 0),
        reactions=reaction_map.get(last_by_id[conversation.id].id, [])
        if conversation.id in last_by_id
        else [],
      )
      for conversation in conversations
    ]

  @staticmethod
  def friend_payloads(user_id):
    rows = Friend.query.filter_by(user_id=user_id).order_by(Friend.created_at.asc()).all()
    return [row.friend.to_public_dict() for row in rows]
