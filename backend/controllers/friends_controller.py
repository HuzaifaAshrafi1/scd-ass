from flask import Blueprint, g, jsonify, request
from sqlalchemy import and_, or_

from extensions import db, socketio
from models import Friend, FriendRequest, User
from controllers.helpers import json_error, login_required, sanitize_text
from time_utils import utc_now


friends_bp = Blueprint("friends", __name__, url_prefix="/api")


def are_friends(user_id, friend_id):
    return (
        Friend.query.filter_by(user_id=user_id, friend_id=friend_id).first() is not None
    )


def add_friendship(user_id, friend_id):
    if not are_friends(user_id, friend_id):
        db.session.add(Friend(user_id=user_id, friend_id=friend_id))
    if not are_friends(friend_id, user_id):
        db.session.add(Friend(user_id=friend_id, friend_id=user_id))


@friends_bp.get("/users/search")
@login_required
def search_users():
    query = sanitize_text(request.args.get("q"), 80)
    if len(query) < 2:
        return jsonify({"users": []})

    users = (
        User.query.filter(
            User.id != g.user.id,
            or_(User.username.ilike(f"%{query}%"), User.display_name.ilike(f"%{query}%")),
        )
        .order_by(User.display_name.asc())
        .limit(20)
        .all()
    )

    outgoing = {
        item.receiver_id: item.status
        for item in FriendRequest.query.filter_by(sender_id=g.user.id).all()
    }
    incoming = {
        item.sender_id: item.status
        for item in FriendRequest.query.filter_by(receiver_id=g.user.id).all()
    }

    payload = []
    for user in users:
        item = user.to_public_dict()
        item["is_friend"] = are_friends(g.user.id, user.id)
        item["request_status"] = outgoing.get(user.id) or incoming.get(user.id)
        item["request_direction"] = "outgoing" if user.id in outgoing else "incoming" if user.id in incoming else None
        payload.append(item)

    return jsonify({"users": payload})


@friends_bp.get("/friends")
@login_required
def friends():
    rows = Friend.query.filter_by(user_id=g.user.id).order_by(Friend.created_at.asc()).all()
    return jsonify({"friends": [row.friend.to_public_dict() for row in rows]})


@friends_bp.get("/friends/requests")
@login_required
def friend_requests():
    received = (
        FriendRequest.query.filter_by(receiver_id=g.user.id, status="pending")
        .order_by(FriendRequest.created_at.desc())
        .all()
    )
    sent = (
        FriendRequest.query.filter_by(sender_id=g.user.id, status="pending")
        .order_by(FriendRequest.created_at.desc())
        .all()
    )
    return jsonify(
        {
            "received": [item.to_dict() for item in received],
            "sent": [item.to_dict() for item in sent],
        }
    )


@friends_bp.post("/friends/request")
@login_required
def send_friend_request():
    data = request.get_json(silent=True) or {}
    receiver_id = data.get("user_id")
    if not isinstance(receiver_id, int):
        return json_error("A valid user_id is required.")
    if receiver_id == g.user.id:
        return json_error("You cannot add yourself.")
    receiver = db.session.get(User, receiver_id)
    if not receiver:
        return json_error("User was not found.", 404)
    if are_friends(g.user.id, receiver_id):
        return json_error("You are already friends.")

    existing = FriendRequest.query.filter(
        or_(
            and_(FriendRequest.sender_id == g.user.id, FriendRequest.receiver_id == receiver_id),
            and_(FriendRequest.sender_id == receiver_id, FriendRequest.receiver_id == g.user.id),
        ),
        FriendRequest.status == "pending",
    ).first()
    if existing:
        return json_error("A pending request already exists.")

    friend_request = FriendRequest(sender_id=g.user.id, receiver_id=receiver_id)
    db.session.add(friend_request)
    db.session.commit()

    socketio.emit(
        "notification:new",
        {
            "type": "friend_request",
            "message": f"{g.user.display_name} sent you a friend request.",
            "request": friend_request.to_dict(),
        },
        to=f"user_{receiver_id}",
    )
    return jsonify({"request": friend_request.to_dict()}), 201


@friends_bp.post("/friends/requests/<int:request_id>/accept")
@login_required
def accept_friend_request(request_id):
    friend_request = FriendRequest.query.filter_by(
        id=request_id, receiver_id=g.user.id, status="pending"
    ).first()
    if not friend_request:
        return json_error("Friend request was not found.", 404)

    friend_request.status = "accepted"
    friend_request.responded_at = utc_now()
    add_friendship(friend_request.sender_id, friend_request.receiver_id)
    db.session.commit()

    socketio.emit(
        "notification:new",
        {
            "type": "friend_accept",
            "message": f"{g.user.display_name} accepted your friend request.",
            "user": g.user.to_public_dict(),
        },
        to=f"user_{friend_request.sender_id}",
    )
    return jsonify({"request": friend_request.to_dict()})


@friends_bp.post("/friends/requests/<int:request_id>/reject")
@login_required
def reject_friend_request(request_id):
    friend_request = FriendRequest.query.filter_by(
        id=request_id, receiver_id=g.user.id, status="pending"
    ).first()
    if not friend_request:
        return json_error("Friend request was not found.", 404)

    friend_request.status = "rejected"
    friend_request.responded_at = utc_now()
    db.session.commit()
    return jsonify({"request": friend_request.to_dict()})


@friends_bp.delete("/friends/<int:friend_id>")
@login_required
def remove_friend(friend_id):
    Friend.query.filter(
        or_(
            and_(Friend.user_id == g.user.id, Friend.friend_id == friend_id),
            and_(Friend.user_id == friend_id, Friend.friend_id == g.user.id),
        )
    ).delete(synchronize_session=False)
    db.session.commit()
    return jsonify({"ok": True})
