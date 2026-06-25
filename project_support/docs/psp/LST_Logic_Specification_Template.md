# Logic Specification Template (LST)

| Field | Value |
|-------|-------|
| **Project** | WeChat Cloned |
| **Module/Component** | *(see procedures below)* |
| **Author** | *[Student Name]* |
| **Date** | 2026-06-25 |
| **Version** | 1.0 |

---

## Template Structure

Use this template to describe internal program logic: pseudocode for key methods and algorithms.

### Section Labels (PSP Standard)

1. Procedure/function name  
2. Purpose  
3. Inputs/Outputs  
4. Pseudocode (structured, implementation-ready)  
5. Complexity notes (if relevant)  

---

## Procedure 1: `_create_message`

### Procedure/Function Name

`_create_message` — `backend/controllers/chat_controller.py`

### Purpose

Create and persist a chat message (text and/or attachment), set initial delivery status for direct conversations based on recipient online presence, update conversation `last_message_at`, and return the committed `Message` entity.

### Inputs/Outputs

| Direction | Name | Type | Description |
|-----------|------|------|-------------|
| Input | `conversation` | `Conversation` | Target conversation (direct or group) |
| Input | `sender` | `User` | Message author |
| Input | `body` | `str` | Raw message text (sanitized internally) |
| Input | `attachment_data` | `dict \| None` | Optional upload metadata from `save_upload()` |
| Input | `is_forwarded` | `bool` | Forward flag (default False) |
| Input | `forward_from_name` | `str \| None` | Original sender display name when forwarded |
| Output | return | `Message` | Committed message with id and timestamps |
| Output | side effect | DB commit | Inserts `Message`, optional `Attachment`, updates `Conversation` |

### Pseudocode

```
FUNCTION _create_message(conversation, sender, body, attachment_data=None, is_forwarded=False, forward_from_name=None):
    body ← sanitize_text(body, max_length=4000)

    IF body is empty AND attachment_data is None:
        RAISE ValueError("Message cannot be empty.")

    message_type ← "text"
    IF attachment_data is not None:
        IF attachment_data.mimetype starts with "image/":
            message_type ← "image"
        ELSE:
            message_type ← "document"

    status ← "delivered"
    delivered_at ← utc_now()

    IF conversation.type == "direct":
        receiver_id ← the participant id in {user_one_id, user_two_id} that is not sender.id
        IF _get_online_count(receiver_id) == 0:
            status ← "sent"
            delivered_at ← None

    message ← new Message(
        conversation_id=conversation.id,
        sender_id=sender.id,
        body=body,
        message_type=message_type,
        status=status,
        delivered_at=delivered_at,
        is_forwarded=is_forwarded,
        forward_from_name=forward_from_name
    )
    db.session.add(message)
    db.session.flush()   // obtain message.id

    IF attachment_data is not None:
        db.session.add(Attachment(message_id=message.id, uploaded_by_id=sender.id, **attachment_data))

    conversation.last_message_at ← message.created_at
    db.session.commit()
    RETURN message
END FUNCTION
```

### Complexity Notes

- Time: **O(1)** for message insert; online check is **O(1)** average (set size per user in `online_sids`).
- Space: **O(1)** per message (attachment file stored on disk separately).

---

## Procedure 2: `_mark_conversation_read`

### Procedure/Function Name

`_mark_conversation_read` — `backend/controllers/chat_controller.py`

### Purpose

Record that the current user has read a conversation: update per-user last-read timestamp (direct or group membership), mark all unread peer messages as `seen`, commit, and broadcast read receipt to conversation room.

### Inputs/Outputs

| Direction | Name | Type | Description |
|-----------|------|------|-------------|
| Input | `conversation` | `Conversation` | Conversation being viewed |
| Input | `user_id` | `int` | Reader's user id |
| Output | return | `list[int]` | IDs of messages updated to `seen` |
| Output | emit | `message:read` | Socket event to `conversation_{id}` |

### Pseudocode

```
FUNCTION _mark_conversation_read(conversation, user_id):
    now ← _set_last_read_for(conversation, user_id)
    // Direct: updates user_one_last_read_at or user_two_last_read_at
    // Group: updates GroupMember.last_read_at

    changed ← empty list
    FOR EACH message IN Message.query.filter(
        conversation_id = conversation.id,
        sender_id ≠ user_id,
        is_deleted = False,
        read_at IS NULL
    ):
        message.status ← "seen"
        message.read_at ← now
        changed.append(message.id)

    db.session.commit()

    IF changed is not empty:
        socketio.emit("message:read", {
            conversation_id: conversation.id,
            message_ids: changed,
            read_at: now.isoformat()
        }, to=conversation_room(conversation.id))

    RETURN changed
END FUNCTION
```

### Complexity Notes

- Time: **O(m)** where *m* = unread messages in conversation (unbounded in theory; UI loads max 300 per fetch).
- Index use: `conversation_id`, `sender_id`, `read_at` columns benefit query plans.

---

## Procedure 3: Login Rate Limiting (`_is_login_limited`)

### Procedure/Function Name

`_login_throttle_key`, `_prune_login_attempts`, `_is_login_limited`, `_record_failed_login` — `backend/controllers/auth_controller.py`

### Purpose

Mitigate brute-force login by tracking failed attempts per client IP + username within a sliding window and enforcing a temporary lock after configurable max attempts.

### Inputs/Outputs

| Direction | Name | Type | Description |
|-----------|------|------|-------------|
| Input | `username` | `str` | Attempted username (from login form) |
| Config | `LOGIN_RATE_LIMIT_ATTEMPTS` | `int` | Default 5 |
| Config | `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `int` | Default 900 (15 min) |
| Config | `LOGIN_RATE_LIMIT_LOCK_SECONDS` | `int` | Default 300 (5 min) |
| Output | `_is_login_limited` | `bool` | True if login should be rejected |

### Pseudocode

```
GLOBAL _failed_login_attempts : map string → list of monotonic timestamps

FUNCTION _login_throttle_key(username):
    remote ← first IP from X-Forwarded-For or request.remote_addr or "local"
    RETURN remote + ":" + (username or "unknown")

FUNCTION _prune_login_attempts(key, now):
    window ← config.LOGIN_RATE_LIMIT_WINDOW_SECONDS
    attempts ← [t for t in _failed_login_attempts[key] if now - t ≤ window]
    IF attempts not empty:
        _failed_login_attempts[key] ← attempts
    ELSE:
        DELETE _failed_login_attempts[key]
    RETURN attempts

FUNCTION _is_login_limited(key):
    now ← monotonic()
    attempts ← _prune_login_attempts(key, now)
    max ← config.LOGIN_RATE_LIMIT_ATTEMPTS
    lock ← config.LOGIN_RATE_LIMIT_LOCK_SECONDS
  RETURN length(attempts) ≥ max AND (now - attempts[last]) ≤ lock

FUNCTION _record_failed_login(key):
    now ← monotonic()
    attempts ← _prune_login_attempts(key, now)
    attempts.append(now)
    _failed_login_attempts[key] ← attempts

// In login() POST:
throttle_key ← _login_throttle_key(username)
IF _is_login_limited(throttle_key):
    RETURN render login with 429
IF user not found OR NOT user.check_password(password):
    _record_failed_login(throttle_key)
    RETURN error flash
_clear_failed_logins(throttle_key)
// proceed with session setup
```

### Complexity Notes

- Time: **O(k)** per check where *k* = attempts in window (bounded by max attempts before lock).
- Storage: In-memory only; resets on server restart (documented limitation).

---

## Procedure 4: `send_friend_request` (with friendship check)

### Procedure/Function Name

`send_friend_request`, `are_friends`, `add_friendship` — `backend/controllers/friends_controller.py`

### Purpose

Validate and create a pending friend request, preventing duplicates, self-requests, and requests between existing friends; notify receiver in realtime.

### Inputs/Outputs

| Direction | Name | Type | Description |
|-----------|------|------|-------------|
| Input | `user_id` (JSON) | `int` | Prospective friend id |
| Input | `g.user` | `User` | Authenticated sender |
| Output | HTTP | 201 + JSON | `{ request: FriendRequest.to_dict() }` |
| Output | Socket | `notification:new` | To `user_{receiver_id}` |

### Pseudocode

```
FUNCTION are_friends(user_id, friend_id):
    RETURN EXISTS Friend WHERE user_id=user_id AND friend_id=friend_id

FUNCTION send_friend_request():
    data ← request.get_json() or {}
    receiver_id ← data.user_id

    IF receiver_id is not integer:
        RETURN json_error("A valid user_id is required.")
    IF receiver_id == g.user.id:
        RETURN json_error("You cannot add yourself.")
    receiver ← db.get(User, receiver_id)
    IF receiver is None:
        RETURN json_error("User was not found.", 404)
    IF are_friends(g.user.id, receiver_id):
        RETURN json_error("You are already friends.")

    existing ← FriendRequest WHERE (
        (sender=g.user AND receiver=receiver_id) OR
        (sender=receiver_id AND receiver=g.user)
    ) AND status = "pending"
    IF existing:
        RETURN json_error("A pending request already exists.")

    friend_request ← new FriendRequest(sender_id=g.user.id, receiver_id=receiver_id)
    db.session.add(friend_request)
    db.session.commit()

    socketio.emit("notification:new", {
        type: "friend_request",
        message: g.user.display_name + " sent you a friend request.",
        request: friend_request.to_dict()
    }, to="user_" + receiver_id)

    RETURN jsonify({ request: friend_request.to_dict() }), 201
END FUNCTION

FUNCTION add_friendship(user_id, friend_id):
    IF NOT are_friends(user_id, friend_id):
        INSERT Friend(user_id, friend_id)
    IF NOT are_friends(friend_id, user_id):
        INSERT Friend(user_id=friend_id, friend_id=user_id)
```

### Complexity Notes

- Time: **O(1)** per validation query with indexed foreign keys.
- `add_friendship` called on accept creates two rows idempotently.

---

## Procedure 5: `checkHealth` (Connection Manager)

### Procedure/Function Name

`checkHealth`, `fetchHealth` — `frontend/static/js/connection.js`

### Purpose

Poll backend `/health` endpoint, maintain composite connection state (backend, database), drive UI pill/banner, schedule retries with exponential backoff, and dispatch browser events on outage/recovery.

### Inputs/Outputs

| Direction | Name | Type | Description |
|-----------|------|------|-------------|
| Input | `options.reason` | `string` | Optional trigger label (startup, scheduled, socket-connect) |
| Output | return | `state object` | Snapshot of `backend`, `database`, `socket`, `health` |
| Output | events | `connection:lost`, `connection:restored` | Document custom events |
| Config | `RETRY_INTERVALS_MS` | `number[]` | `[1000, 2000, 5000, 10000, 30000]` |
| Config | `HEALTHY_POLL_MS` | `number` | `30000` |
| Config | `REQUEST_TIMEOUT_MS` | `number` | `8000` |

### Pseudocode

```
CONST RETRY_INTERVALS_MS ← [1000, 2000, 5000, 10000, 30000]
CONST HEALTHY_POLL_MS ← 30000
CONST REQUEST_TIMEOUT_MS ← 8000

ASYNC FUNCTION fetchHealth():
    controller ← new AbortController()
    timeoutId ← setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    TRY:
        response ← await fetch(healthUrl, { signal: controller.signal, credentials: "same-origin" })
        IF NOT response.ok: THROW Error
        RETURN await response.json()
    FINALLY:
        clearTimeout(timeoutId)

ASYNC FUNCTION checkHealth(options):
    state.lastCheckedAt ← new Date()

    TRY:
        payload ← await fetchHealth()
        state.health ← payload
        state.backend ← "online"
        state.database ← payload.database ? "connected" : "degraded"
        state.retryIndex ← 0

        IF outage was active AND state.wasOffline:
            state.wasOffline ← false
            outageActive ← false
            dispatch document event "connection:restored"

        scheduleNextPoll(HEALTHY_POLL_MS)

    CATCH:
        state.health ← null
        state.database ← "disconnected"
        IF state.backend == "online":
            state.backend ← "reconnecting"
        state.wasOffline ← true
        delay ← RETRY_INTERVALS_MS[min(state.retryIndex, last index)]
        state.retryIndex ← state.retryIndex + 1
        IF state.retryIndex ≥ RETRY_INTERVALS_MS.length:
            state.backend ← "offline"
        IF NOT outageActive:
            outageActive ← true
            dispatch document event "connection:lost"
        scheduleNextPoll(delay)

    notify()   // listeners + renderUI + updateComposerState
    RETURN copy of state

FUNCTION canSendMessages():
    RETURN state.backend == "online" AND state.database == "connected"
```

### Complexity Notes

- Time per poll: **O(1)** network round-trip, bounded by 8 s timeout.
- Retry schedule: at most 5 escalating intervals before `offline` state.

---

## Procedure 6: `socket_connect` (Presence and Delivery)

### Procedure/Function Name

`socket_connect`, `_mark_direct_messages_delivered`, `_broadcast_status` — `backend/controllers/chat_controller.py`

### Purpose

On authenticated Socket.IO connection: register client SID, join user and conversation rooms, mark user online, deliver pending direct messages, and notify friends of presence change.

### Inputs/Outputs

| Direction | Name | Type | Description |
|-----------|------|------|-------------|
| Input | `request.sid` | `str` | Socket.IO session id |
| Input | `g.user` | `User` | From Flask session |
| Output | emit | `socket:ready` | `{ user_id }` to connecting client |
| Output | emit | `message:status` | Per message delivered upgrade |
| Output | emit | `user:status` | To each friend's `user_{id}` room |

### Pseudocode

```
ON EVENT connect:
    user_id ← g.user.id IF g.user ELSE None
    IF user_id is None:
        disconnect()
        RETURN

    online_sids[user_id] ← online_sids[user_id] ∪ { request.sid }
    join_room("user_" + user_id)

    FOR EACH conversation_id IN direct_ids(user_id) + group_ids(user_id):
        join_room("conversation_" + conversation_id)

    g.user.is_online ← True
    g.user.last_seen ← utc_now()
    db.session.commit()

    _mark_direct_messages_delivered(user_id)
    _broadcast_status(user_id, is_online=True)

    emit("socket:ready", { user_id: user_id })

FUNCTION _mark_direct_messages_delivered(user_id):
    conversation_ids ← all direct conversation ids for user_id
    IF empty: RETURN
    now ← utc_now()
    messages ← Message WHERE conversation_id IN ids
               AND sender_id ≠ user_id AND status == "sent"
    FOR EACH message IN messages:
        message.status ← "delivered"
        message.delivered_at ← now
        emit message:status to conversation room
    IF messages not empty: db.commit()

FUNCTION _broadcast_status(user_id, is_online):
    friend_ids ← all friend_id FROM Friend WHERE user_id = user_id
    payload ← { user_id, is_online, last_seen: now ISO }
    FOR EACH friend_id IN friend_ids:
        emit "user:status" to "user_" + friend_id
```

### Complexity Notes

- Connect handler: **O(c + m + f)** where *c* = conversations, *m* = pending sent messages, *f* = friends count.
- Typical university demo scale remains sub-second.

---

## Procedure 7: Direct Conversation Get-or-Create

### Procedure/Function Name

`direct_conversation` — `backend/controllers/chat_controller.py`

### Purpose

Ensure a canonical direct conversation exists between two friends using sorted user IDs to satisfy unique constraint `uq_direct_conversation`.

### Inputs/Outputs

| Direction | Name | Type | Description |
|-----------|------|------|-------------|
| Input | `user_id` (JSON) | `int` | Friend to chat with |
| Output | JSON | `{ conversation: dict }` | Serialized conversation for current user |

### Pseudocode

```
FUNCTION direct_conversation():
    other_id ← request.json.user_id
    VALIDATE other_id is int, other_id ≠ g.user.id
    other ← db.get(User, other_id)
    IF other is None: RETURN 404
    IF NOT are_friends(g.user.id, other_id): RETURN 403

  one, two ← sorted([g.user.id, other_id])
    conversation ← Conversation.query.filter_by(
        type="direct", user_one_id=one, user_two_id=two
    ).first()

    IF conversation is None:
        conversation ← new Conversation(type="direct", user_one_id=one, user_two_id=two)
        db.session.add(conversation)
        db.session.commit()

    RETURN { conversation: _conversation_to_dict(conversation, g.user.id) }
```

### Complexity Notes

- Time: **O(1)** indexed lookup on `(user_one_id, user_two_id)`.

---

## Assumptions

- Pseudocode mirrors actual Python/JavaScript control flow; naming matches source for traceability.
- `utc_now()` and `monotonic()` are project utilities for timezone-aware DB timestamps and throttle timing respectively.
- Error paths in API handlers return early with `json_error()` rather than exceptions for expected validation failures.
