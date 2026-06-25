from pathlib import Path

from flask import Blueprint, abort, current_app, g, jsonify, render_template, request, send_file, session
from flask_socketio import disconnect, emit, join_room

from extensions import db, socketio
from models import (
    Attachment,
    Conversation,
    Friend,
    Group,
    GroupMember,
    Message,
    MessageHidden,
    MessageReaction,
    PinnedMessage,
    User,
)
from controllers.friends_controller import are_friends
from controllers.helpers import json_error, login_required, parse_int, sanitize_text, save_upload
from services.conversation_service import ConversationService
from services.message_service import MessageService
from time_utils import utc_now


chat_bp = Blueprint("chat", __name__)
online_sids = {}


@chat_bp.get("/chat")
@login_required
def chat():
    return render_template("chat.html")


def _user_room(user_id):
    return f"user_{user_id}"


def _conversation_room(conversation_id):
    return f"conversation_{conversation_id}"


def _socket_user():
    user_id = session.get("user_id")
    return db.session.get(User, user_id) if user_id else None


def _get_online_count(user_id):
    return len(online_sids.get(user_id, set()))


def _direct_conversation_ids_for_user(user_id):
    return ConversationService.direct_ids_for_user(user_id)


def _group_conversation_ids_for_user(user_id):
    return ConversationService.group_ids_for_user(user_id)


def _conversation_for_user(conversation_id, user_id):
    return ConversationService.for_user(conversation_id, user_id)


def _conversation_participant_ids(conversation):
    return ConversationService.participant_ids(conversation)


def _set_last_read_for(conversation, user_id):
    return ConversationService.set_last_read_for(conversation, user_id, utc_now())


def _conversation_title(conversation, user_id):
    return ConversationService.title(conversation, user_id)


def _message_to_dict(message, viewer_id=None):
    return MessageService.to_dict(message, viewer_id)


def _conversation_to_dict(conversation, user_id):
    return ConversationService.to_dict(conversation, user_id)


def _serialize_conversations(user_id):
    return ConversationService.serialize_for_user(user_id)


def _friend_payloads(user_id):
    return ConversationService.friend_payloads(user_id)


def _mark_direct_messages_delivered(user_id):
    conversation_ids = _direct_conversation_ids_for_user(user_id)
    if not conversation_ids:
        return
    now = utc_now()
    messages = Message.query.filter(
        Message.conversation_id.in_(conversation_ids),
        Message.sender_id != user_id,
        Message.status == "sent",
    ).all()
    for message in messages:
        message.status = "delivered"
        message.delivered_at = now
        socketio.emit(
            "message:status",
            {
                "message_id": message.id,
                "conversation_id": message.conversation_id,
                "status": message.status,
                "delivered_at": message.delivered_at.isoformat(),
                "read_at": None,
            },
            to=_conversation_room(message.conversation_id),
        )
    if messages:
        db.session.commit()


def _broadcast_status(user_id, is_online):
    friend_ids = [row.friend_id for row in Friend.query.filter_by(user_id=user_id).all()]
    payload = {
        "user_id": user_id,
        "is_online": is_online,
        "last_seen": utc_now().isoformat(),
    }
    for friend_id in friend_ids:
        socketio.emit("user:status", payload, to=_user_room(friend_id))


def _create_message(
    conversation,
    sender,
    body,
    attachment_data=None,
    *,
    is_forwarded=False,
    forward_from_name=None,
):
    return MessageService.create(
        conversation,
        sender,
        body,
        attachment_data,
        is_forwarded=is_forwarded,
        forward_from_name=forward_from_name,
        get_online_count=_get_online_count,
    )


def _broadcast_message(message, viewer_id=None):
    payload = _message_to_dict(message, viewer_id or message.sender_id)
    socketio.emit("message:new", payload, to=_conversation_room(message.conversation_id))

    conversation = message.conversation
    for user_id in _conversation_participant_ids(conversation):
        if user_id != message.sender_id:
            socketio.emit(
                "notification:new",
                {
                    "type": "message",
                    "conversation_id": conversation.id,
                    "message": f"New message in {_conversation_title(conversation, user_id)}",
                },
                to=_user_room(user_id),
            )


def _mark_conversation_read(conversation, user_id):
    return MessageService.mark_conversation_read(
        conversation,
        user_id,
        _set_last_read_for,
        _conversation_room,
    )


@chat_bp.get("/api/bootstrap")
@login_required
def bootstrap():
    return jsonify(
        {
            "current_user": g.user.to_public_dict(),
            "friends": _friend_payloads(g.user.id),
            "conversations": _serialize_conversations(g.user.id),
        }
    )


@chat_bp.get("/api/conversations")
@login_required
def conversations():
    return jsonify({"conversations": _serialize_conversations(g.user.id)})


@chat_bp.post("/api/conversations/direct")
@login_required
def direct_conversation():
    data = request.get_json(silent=True) or {}
    other_id = data.get("user_id")
    if not isinstance(other_id, int):
        return json_error("A valid user_id is required.")
    if other_id == g.user.id:
        return json_error("You cannot start a conversation with yourself.")
    other = db.session.get(User, other_id)
    if not other:
        return json_error("User was not found.", 404)
    if not are_friends(g.user.id, other_id):
        return json_error("You can only message friends.", 403)

    one, two = sorted([g.user.id, other_id])
    conversation = Conversation.query.filter_by(
        type="direct", user_one_id=one, user_two_id=two
    ).first()
    if not conversation:
        conversation = Conversation(type="direct", user_one_id=one, user_two_id=two)
        db.session.add(conversation)
        db.session.commit()
    return jsonify({"conversation": _conversation_to_dict(conversation, g.user.id)})


@chat_bp.get("/api/conversations/<int:conversation_id>/messages")
@login_required
def conversation_messages(conversation_id):
    conversation = _conversation_for_user(conversation_id, g.user.id)
    if not conversation:
        return json_error("Conversation was not found.", 404)

    query = sanitize_text(request.args.get("q"), 100) or None
    limit = parse_int(request.args.get("limit"), 300, minimum=1, maximum=500)
    before_id = parse_int(request.args.get("before_id"), None, minimum=1)
    payload = MessageService.list_for_conversation(
        conversation.id,
        g.user.id,
        query,
        limit=limit,
        before_id=before_id,
    )
    return jsonify(payload)


@chat_bp.post("/api/conversations/<int:conversation_id>/messages")
@login_required
def upload_message(conversation_id):
    conversation = _conversation_for_user(conversation_id, g.user.id)
    if not conversation:
        return json_error("Conversation was not found.", 404)

    body = request.form.get("body", "")
    attachment_data = None
    upload = request.files.get("attachment")
    if upload and upload.filename:
        attachment_data = save_upload(upload, "ATTACHMENT_UPLOAD_FOLDER")

    try:
        message = _create_message(conversation, g.user, body, attachment_data)
    except ValueError as exc:
        return json_error(str(exc))

    _broadcast_message(message, g.user.id)
    return jsonify({"message": _message_to_dict(message, g.user.id)}), 201


@chat_bp.patch("/api/messages/<int:message_id>")
@login_required
def edit_message(message_id):
    message = db.session.get(Message, message_id)
    if not message or message.is_deleted:
        return json_error("Message was not found.", 404)
    conversation = _conversation_for_user(message.conversation_id, g.user.id)
    if not conversation:
        return json_error("Message was not found.", 404)
    if message.sender_id != g.user.id:
        return json_error("You can only edit your own messages.", 403)
    data = request.get_json(silent=True) or {}
    body = sanitize_text(data.get("body"), 4000)
    if not body:
        return json_error("Message cannot be empty.")
    message.body = body
    message.edited_at = utc_now()
    db.session.commit()
    payload = _message_to_dict(message, g.user.id)
    socketio.emit(
        "message:edited",
        payload,
        to=_conversation_room(message.conversation_id),
    )
    return jsonify({"message": payload})


@chat_bp.delete("/api/messages/<int:message_id>")
@login_required
def delete_message(message_id):
    message = db.session.get(Message, message_id)
    if not message:
        return json_error("Message was not found.", 404)
    conversation = _conversation_for_user(message.conversation_id, g.user.id)
    if not conversation:
        return json_error("Message was not found.", 404)

    scope = request.args.get("scope", "everyone")
    is_admin = False
    if conversation.type == "group":
        membership = GroupMember.query.filter_by(
            group_id=conversation.group_id, user_id=g.user.id, is_active=True
        ).first()
        is_admin = bool(membership and membership.role == "admin")

    if scope == "me":
        existing = MessageHidden.query.filter_by(
            message_id=message.id, user_id=g.user.id
        ).first()
        if not existing:
            db.session.add(MessageHidden(message_id=message.id, user_id=g.user.id))
            db.session.commit()
        return jsonify({"ok": True, "scope": "me"})

    if message.sender_id != g.user.id and not is_admin:
        return json_error("You can only delete your own messages.", 403)

    message.is_deleted = True
    message.deleted_for_everyone = True
    message.body = ""
    db.session.commit()
    socketio.emit(
        "message:deleted",
        {
            "message_id": message.id,
            "conversation_id": message.conversation_id,
            "deleted_for_everyone": True,
        },
        to=_conversation_room(message.conversation_id),
    )
    return jsonify({"ok": True, "scope": "everyone"})


@chat_bp.post("/api/messages/<int:message_id>/reactions")
@login_required
def toggle_reaction(message_id):
    message = db.session.get(Message, message_id)
    if not message or message.is_deleted:
        return json_error("Message was not found.", 404)
    if not _conversation_for_user(message.conversation_id, g.user.id):
        return json_error("Message was not found.", 404)
    data = request.get_json(silent=True) or {}
    emoji = (data.get("emoji") or "").strip()
    if not MessageService.supported_emoji(emoji):
        return json_error("Reaction is not supported.")
    existing = MessageReaction.query.filter_by(
        message_id=message.id, user_id=g.user.id, emoji=emoji
    ).first()
    if existing:
        db.session.delete(existing)
    else:
        db.session.add(
            MessageReaction(message_id=message.id, user_id=g.user.id, emoji=emoji)
        )
    db.session.commit()
    payload = {
        "message_id": message.id,
        "conversation_id": message.conversation_id,
        "reactions": MessageService.reaction_summary(message.id, g.user.id),
    }
    socketio.emit("message:reaction", payload, to=_conversation_room(message.conversation_id))
    return jsonify(payload)


@chat_bp.get("/api/conversations/<int:conversation_id>/pin")
@login_required
def get_pinned_message(conversation_id):
    conversation = _conversation_for_user(conversation_id, g.user.id)
    if not conversation:
        return json_error("Conversation was not found.", 404)
    pin = PinnedMessage.query.filter_by(conversation_id=conversation.id).first()
    if not pin:
        return jsonify({"pinned": None})
    return jsonify(
        {
            "pinned": {
                "message": _message_to_dict(pin.message, g.user.id),
                "pinned_at": pin.pinned_at.isoformat() if pin.pinned_at else None,
                "pinned_by": pin.pinned_by.display_name,
            }
        }
    )


@chat_bp.put("/api/conversations/<int:conversation_id>/pin")
@login_required
def pin_message(conversation_id):
    conversation = _conversation_for_user(conversation_id, g.user.id)
    if not conversation:
        return json_error("Conversation was not found.", 404)
    data = request.get_json(silent=True) or {}
    message_id = data.get("message_id")
    if not isinstance(message_id, int):
        return json_error("message_id is required.")
    message = db.session.get(Message, message_id)
    if not message or message.conversation_id != conversation.id:
        return json_error("Message was not found.", 404)
    pin = PinnedMessage.query.filter_by(conversation_id=conversation.id).first()
    if pin:
        pin.message_id = message.id
        pin.pinned_by_id = g.user.id
        pin.pinned_at = utc_now()
    else:
        pin = PinnedMessage(
            conversation_id=conversation.id,
            message_id=message.id,
            pinned_by_id=g.user.id,
        )
        db.session.add(pin)
    db.session.commit()
    payload = {
        "conversation_id": conversation.id,
        "pinned": {
            "message": _message_to_dict(message, g.user.id),
            "pinned_at": pin.pinned_at.isoformat(),
            "pinned_by": g.user.display_name,
        },
    }
    socketio.emit("message:pinned", payload, to=_conversation_room(conversation.id))
    return jsonify(payload)


@chat_bp.delete("/api/conversations/<int:conversation_id>/pin")
@login_required
def unpin_message(conversation_id):
    conversation = _conversation_for_user(conversation_id, g.user.id)
    if not conversation:
        return json_error("Conversation was not found.", 404)
    PinnedMessage.query.filter_by(conversation_id=conversation.id).delete()
    db.session.commit()
    socketio.emit(
        "message:unpinned",
        {"conversation_id": conversation.id},
        to=_conversation_room(conversation.id),
    )
    return jsonify({"ok": True})


@chat_bp.post("/api/messages/<int:message_id>/forward")
@login_required
def forward_message(message_id):
    message = db.session.get(Message, message_id)
    if not message or message.is_deleted:
        return json_error("Message was not found.", 404)
    if not _conversation_for_user(message.conversation_id, g.user.id):
        return json_error("Message was not found.", 404)
    data = request.get_json(silent=True) or {}
    conversation_ids = data.get("conversation_ids", [])
    if not isinstance(conversation_ids, list) or not conversation_ids:
        return json_error("conversation_ids must be a non-empty list.")
    created = []
    forward_name = message.sender.display_name
    body = message.body or ""
    for conversation_id in conversation_ids:
        if not isinstance(conversation_id, int):
            continue
        conversation = _conversation_for_user(conversation_id, g.user.id)
        if not conversation:
            continue
        try:
            new_message = _create_message(
                conversation,
                g.user,
                body,
                is_forwarded=True,
                forward_from_name=forward_name,
            )
            created.append(_message_to_dict(new_message, g.user.id))
            _broadcast_message(new_message, g.user.id)
        except ValueError:
            continue
    if not created:
        return json_error("No valid conversations to forward to.", 400)
    return jsonify({"messages": created}), 201


@chat_bp.post("/api/conversations/<int:conversation_id>/read")
@login_required
def read_conversation(conversation_id):
    conversation = _conversation_for_user(conversation_id, g.user.id)
    if not conversation:
        return json_error("Conversation was not found.", 404)
    changed = _mark_conversation_read(conversation, g.user.id)
    return jsonify({"ok": True, "message_ids": changed})


@chat_bp.post("/api/groups")
@login_required
def create_group():
    data = request.get_json(silent=True) or {}
    name = sanitize_text(data.get("name"), 120)
    description = sanitize_text(data.get("description"), 300)
    member_ids = data.get("member_ids", [])
    if not name:
        return json_error("Group name is required.")
    if not isinstance(member_ids, list):
        return json_error("member_ids must be a list.")

    valid_members = {g.user.id}
    for member_id in member_ids:
        if isinstance(member_id, int) and are_friends(g.user.id, member_id):
            valid_members.add(member_id)
    if len(valid_members) < 2:
        return json_error("Add at least one friend to create a group.")

    group = Group(name=name, description=description, created_by_id=g.user.id)
    db.session.add(group)
    db.session.flush()
    db.session.add(GroupMember(group_id=group.id, user_id=g.user.id, role="admin"))
    for member_id in valid_members:
        if member_id != g.user.id:
            db.session.add(GroupMember(group_id=group.id, user_id=member_id, role="member"))
    db.session.flush()
    conversation = Conversation(type="group", group_id=group.id, title=name)
    db.session.add(conversation)
    db.session.commit()

    for member_id in valid_members:
        socketio.emit(
            "notification:new",
            {
                "type": "group",
                "message": f"You were added to {group.name}.",
                "conversation": _conversation_to_dict(conversation, member_id),
            },
            to=_user_room(member_id),
        )
    return jsonify({"conversation": _conversation_to_dict(conversation, g.user.id)}), 201


@chat_bp.get("/api/groups/<int:group_id>")
@login_required
def group_info(group_id):
    membership = GroupMember.query.filter_by(
        group_id=group_id, user_id=g.user.id, is_active=True
    ).first()
    if not membership:
        return json_error("Group was not found.", 404)
    group = db.session.get(Group, group_id)
    members = GroupMember.query.filter_by(group_id=group_id, is_active=True).all()
    return jsonify(
        {
            "group": group.to_dict(),
            "current_role": membership.role,
            "members": [member.to_dict() for member in members],
        }
    )


@chat_bp.post("/api/groups/<int:group_id>/members")
@login_required
def add_group_members(group_id):
    admin = GroupMember.query.filter_by(
        group_id=group_id, user_id=g.user.id, role="admin", is_active=True
    ).first()
    if not admin:
        return json_error("Only group admins can add members.", 403)
    data = request.get_json(silent=True) or {}
    user_ids = data.get("user_ids", [])
    if not isinstance(user_ids, list):
        return json_error("user_ids must be a list.")

    group = db.session.get(Group, group_id)
    added = []
    for user_id in user_ids:
        if not isinstance(user_id, int) or not are_friends(g.user.id, user_id):
            continue
        existing = GroupMember.query.filter_by(group_id=group_id, user_id=user_id).first()
        if existing:
            existing.is_active = True
            existing.joined_at = utc_now()
        else:
            db.session.add(GroupMember(group_id=group_id, user_id=user_id, role="member"))
        added.append(user_id)
    db.session.commit()

    conversation = Conversation.query.filter_by(type="group", group_id=group_id).first()
    for user_id in added:
        socketio.emit(
            "notification:new",
            {
                "type": "group",
                "message": f"You were added to {group.name}.",
                "conversation": _conversation_to_dict(conversation, user_id),
            },
            to=_user_room(user_id),
        )
    return jsonify({"added": added})


@chat_bp.delete("/api/groups/<int:group_id>/members/<int:user_id>")
@login_required
def remove_group_member(group_id, user_id):
    admin = GroupMember.query.filter_by(
        group_id=group_id, user_id=g.user.id, role="admin", is_active=True
    ).first()
    if not admin:
        return json_error("Only group admins can remove members.", 403)
    if user_id == g.user.id:
        return json_error("Admins cannot remove themselves with this action.")
    membership = GroupMember.query.filter_by(
        group_id=group_id, user_id=user_id, is_active=True
    ).first()
    if not membership:
        return json_error("Member was not found.", 404)
    membership.is_active = False
    db.session.commit()
    conversation = Conversation.query.filter_by(type="group", group_id=group_id).first()
    socketio.emit("group:removed", {"group_id": group_id}, to=_user_room(user_id))
    return jsonify({"ok": True})


@chat_bp.post("/api/groups/<int:group_id>/leave")
@login_required
def leave_group(group_id):
    membership = GroupMember.query.filter_by(
        group_id=group_id, user_id=g.user.id, is_active=True
    ).first()
    if not membership:
        return json_error("Group was not found.", 404)
    active_admins = GroupMember.query.filter_by(
        group_id=group_id, role="admin", is_active=True
    ).count()
    if membership.role == "admin" and active_admins == 1:
        return json_error("Assign another admin before leaving.", 400)
    membership.is_active = False
    db.session.commit()
    return jsonify({"ok": True})


@chat_bp.get("/api/attachments/<int:attachment_id>/download")
@login_required
def download_attachment(attachment_id):
    attachment = db.session.get(Attachment, attachment_id)
    if not attachment or not attachment.message:
        return json_error("Attachment was not found.", 404)
    if not _conversation_for_user(attachment.message.conversation_id, g.user.id):
        return json_error("Attachment was not found.", 404)
    storage_path = _safe_attachment_path(attachment.storage_path)
    return send_file(
        storage_path,
        as_attachment=True,
        download_name=attachment.original_filename,
        mimetype=attachment.mimetype,
    )


def _safe_attachment_path(storage_path):
    upload_root = Path(current_app.config["UPLOAD_FOLDER"]).resolve()
    candidate = Path(storage_path).resolve()
    try:
        candidate.relative_to(upload_root)
    except ValueError:
        abort(404)
    if not candidate.is_file():
        abort(404)
    return candidate


@socketio.on("connect")
def socket_connect():
    user = _socket_user()
    if not user:
        disconnect()
        return
    user_id = user.id
    online_sids.setdefault(user_id, set()).add(request.sid)
    join_room(_user_room(user_id))
    for conversation_id in _direct_conversation_ids_for_user(user_id) + _group_conversation_ids_for_user(user_id):
        join_room(_conversation_room(conversation_id))
    user.is_online = True
    user.last_seen = utc_now()
    db.session.commit()
    _mark_direct_messages_delivered(user_id)
    _broadcast_status(user_id, True)
    emit("socket:ready", {"user_id": user_id})


@socketio.on("disconnect")
def socket_disconnect():
    user = _socket_user()
    if not user:
        return
    user_id = user.id
    sids = online_sids.get(user_id, set())
    sids.discard(request.sid)
    if not sids:
        online_sids.pop(user_id, None)
        user.is_online = False
        user.last_seen = utc_now()
        db.session.commit()
        _broadcast_status(user_id, False)


@socketio.on("join_conversation")
def socket_join_conversation(data):
    user = _socket_user()
    user_id = user.id if user else None
    conversation_id = parse_int(data.get("conversation_id") if data else None, 0, minimum=1)
    conversation = _conversation_for_user(conversation_id, user_id)
    if not conversation:
        return {"error": "Conversation was not found."}
    join_room(_conversation_room(conversation.id))
    return {"ok": True}


@socketio.on("send_message")
def socket_send_message(data):
    user = _socket_user()
    conversation_id = parse_int(data.get("conversation_id") if data else None, 0, minimum=1)
    conversation = _conversation_for_user(conversation_id, user.id if user else None)
    if not user or not conversation:
        return {"error": "Conversation was not found."}
    try:
        message = _create_message(conversation, user, data.get("body", ""))
    except ValueError as exc:
        return {"error": str(exc)}
    _broadcast_message(message)
    return {"ok": True, "message": _message_to_dict(message, user.id)}


@socketio.on("typing")
def socket_typing(data):
    user = _socket_user()
    conversation_id = parse_int(data.get("conversation_id") if data else None, 0, minimum=1)
    conversation = _conversation_for_user(conversation_id, user.id if user else None)
    if not user or not conversation:
        return
    emit(
        "typing:update",
        {
            "conversation_id": conversation.id,
            "user_id": user.id,
            "display_name": user.display_name,
            "is_typing": bool(data.get("is_typing")),
        },
        to=_conversation_room(conversation.id),
        include_self=False,
    )


@socketio.on("conversation_read")
def socket_conversation_read(data):
    user = _socket_user()
    conversation_id = parse_int(data.get("conversation_id") if data else None, 0, minimum=1)
    conversation = _conversation_for_user(conversation_id, user.id if user else None)
    if not user or not conversation:
        return {"error": "Conversation was not found."}
    changed = _mark_conversation_read(conversation, user.id)
    return {"ok": True, "message_ids": changed}
