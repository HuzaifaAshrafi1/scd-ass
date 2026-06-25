# Functional Specification Template (FST)

| Field | Value |
|-------|-------|
| **Project** | WeChat Cloned |
| **Module/Component** | *(see sections below)* |
| **Author** | *[Student Name]* |
| **Date** | 2026-06-25 |
| **Version** | 1.0 |

---

## Template Structure

Use this template to describe static external interfaces: classes, methods, parameters, return types, inheritance, and call-return behavior.

### Section Labels (PSP Standard)

1. Module/Component name  
2. Class/Module interfaces table (Name, Type, Parameters, Returns, Description)  
3. Method specifications (preconditions, postconditions, exceptions)  
4. External dependencies/APIs  

---

## Module 1: Authentication

### Module/Component Name

Authentication — `backend/controllers/auth_controller.py`, `backend/models/user.py`

### Class/Module Interfaces

| Name | Type | Parameters | Returns | Description |
|------|------|------------|---------|-------------|
| `User` | SQLAlchemy Model | — | — | Persistent user entity with hashed credentials and profile fields |
| `User.set_password` | instance method | `password: str` | `None` | Stores Werkzeug `generate_password_hash` in `password_hash` |
| `User.check_password` | instance method | `password: str` | `bool` | Verifies password against stored hash |
| `User.to_public_dict` | instance method | — | `dict` | Safe JSON-serializable profile (no password hash) |
| `login` | Flask route | GET/POST `/login` | `Response` | Renders form or establishes session |
| `register` | Flask route | GET/POST `/register` | `Response` | Creates user and logs in |
| `logout` | Flask route | POST `/logout` | `Redirect` | Clears session |
| `login_required` | decorator | `view: Callable` | `Callable` | Guards routes; 401 for `/api/*`, redirect otherwise |
| `get_csrf_token` | function | — | `str` | Session-stored CSRF token (32-byte urlsafe) |
| `validate_csrf` | function | — | — | Compares header/form token; aborts 400 on mismatch |

### Method Specifications

#### `login()` POST handler

| Aspect | Specification |
|--------|---------------|
| **Preconditions** | `g.user` is None; form contains `username`, `password` |
| **Postconditions** | On success: `session["user_id"]` set, CSRF token issued, redirect to `chat.chat` |
| **Exceptions** | Rate limited → 429 + error flash; invalid credentials → error flash, no session |

#### `register()` POST handler

| Aspect | Specification |
|--------|---------------|
| **Preconditions** | Username matches `USERNAME_PATTERN` (`^[A-Za-z0-9_]{3,40}$`); password length ≥ 8; passwords match |
| **Postconditions** | New `User` row committed; session established |
| **Exceptions** | Validation failure → re-render with flash; duplicate username → error flash |

### External Dependencies

| Dependency | Usage |
|------------|-------|
| Flask `session` | Server-side authentication state |
| Werkzeug security | Password hashing |
| SQLAlchemy / SQLite | User persistence |

---

## Module 2: Messaging / Chat

### Module/Component Name

Messaging — `backend/controllers/chat_controller.py`, `backend/models/message.py`, `frontend/static/js/chat.js`

### Class/Module Interfaces

| Name | Type | Parameters | Returns | Description |
|------|------|------------|---------|-------------|
| `Conversation` | Model | `type`, `user_one_id`, `user_two_id`, `group_id`, … | — | Direct or group conversation container |
| `Message` | Model | `conversation_id`, `sender_id`, `body`, `message_type`, `status`, … | — | Chat message with delivery metadata |
| `Attachment` | Model | file metadata fields | — | Optional file linked 1:1 to message |
| `Attachment.to_dict` | method | — | `dict` | URL, mimetype, size for client rendering |
| `_create_message` | function | `conversation`, `sender`, `body`, `attachment_data=None`, `is_forwarded`, `forward_from_name` | `Message` | Persists message; sets initial delivery status |
| `_message_to_dict` | function | `message`, `viewer_id` | `dict` | Serializes message for API/Socket.IO |
| `_broadcast_message` | function | `message`, `viewer_id` | `None` | Emits `message:new` and per-user notifications |
| `_mark_conversation_read` | function | `conversation`, `user_id` | `list[int]` | Updates read pointers; emits `message:read` |
| `bootstrap` | GET route | — | JSON | `{ current_user, friends, conversations }` |
| `direct_conversation` | POST route | `{ user_id: int }` | JSON | Gets or creates direct conversation |
| `conversation_messages` | GET route | `conversation_id`, `?q=` | JSON | Message history (max 300) |
| `upload_message` | POST route | multipart `body`, `attachment` | JSON 201 | HTTP path for attachments |
| `edit_message` | PATCH route | `{ body: str }` | JSON | Sender-only edit |
| `delete_message` | DELETE route | `?scope=me\|everyone` | JSON | Hide for self or delete for all |
| `toggle_reaction` | POST route | `{ emoji: str }` | JSON | Toggle emoji reaction |
| `read_conversation` | POST route | — | JSON | Mark conversation read (HTTP alternative) |
| `download_attachment` | GET route | `attachment_id` | File | Secure attachment download |
| `api` | JS function | `path`, `options` | `Promise<object>` | Fetch wrapper with CSRF header |

### Socket.IO Events (Server Handlers)

| Event | Direction | Payload | Returns / Emits |
|-------|-----------|---------|-----------------|
| `connect` | Client → Server | (session cookie) | `socket:ready`; joins `user_{id}` and conversation rooms |
| `disconnect` | Client → Server | — | Updates online status when last SID removed |
| `join_conversation` | Client → Server | `{ conversation_id }` | `{ ok: true }` or `{ error }` |
| `send_message` | Client → Server | `{ conversation_id, body }` | `{ ok, message }` or `{ error }`; emits `message:new` |
| `typing` | Client → Server | `{ conversation_id, is_typing }` | Emits `typing:update` to room (exclude self) |
| `conversation_read` | Client → Server | `{ conversation_id }` | `{ ok, message_ids }`; emits `message:read` |

### Socket.IO Events (Server → Client)

| Event | Payload Summary |
|-------|-----------------|
| `message:new` | Full message dict |
| `message:status` | `message_id`, `status`, `delivered_at` |
| `message:read` | `conversation_id`, `message_ids`, `read_at` |
| `message:deleted` | `message_id`, `conversation_id`, `deleted_for_everyone` |
| `message:edited` | Updated message dict |
| `message:reaction` | `message_id`, `reactions` summary |
| `message:pinned` / `message:unpinned` | Pin metadata |
| `notification:new` | `type`, `message`, optional entity |
| `user:status` | `user_id`, `is_online`, `last_seen` |
| `group:removed` | `group_id` |

### Method Specifications

#### `_create_message(conversation, sender, body, attachment_data=None, ...)`

| Aspect | Specification |
|--------|---------------|
| **Preconditions** | Sanitized body non-empty OR `attachment_data` provided; sender is conversation participant |
| **Postconditions** | `Message` committed; `conversation.last_message_at` updated; direct messages to offline peer start as `status="sent"` |
| **Exceptions** | `ValueError("Message cannot be empty.")` if both body and attachment absent |

#### `socket_send_message(data)`

| Aspect | Specification |
|--------|---------------|
| **Preconditions** | Authenticated socket; valid conversation membership |
| **Postconditions** | Message created and broadcast |
| **Exceptions** | Returns `{ error: str }` without raising |

### External Dependencies

| Dependency | Usage |
|------------|-------|
| Flask-SocketIO | Realtime transport |
| SQLAlchemy | ORM queries and transactions |
| Socket.IO CDN client | Browser realtime (`chat.html`) |

---

## Module 3: Friends

### Module/Component Name

Friends — `backend/controllers/friends_controller.py`, `backend/models/user.py` (`Friend`, `FriendRequest`)

### Class/Module Interfaces

| Name | Type | Parameters | Returns | Description |
|------|------|------------|---------|-------------|
| `Friend` | Model | `user_id`, `friend_id` | — | Directional friendship edge |
| `FriendRequest` | Model | `sender_id`, `receiver_id`, `status` | — | Pending/accepted/rejected request |
| `FriendRequest.to_dict` | method | — | `dict` | Includes nested sender/receiver public dicts |
| `are_friends` | function | `user_id`, `friend_id` | `bool` | Checks `Friend` row existence |
| `add_friendship` | function | `user_id`, `friend_id` | `None` | Creates bidirectional `Friend` rows if missing |
| `search_users` | GET `/api/users/search` | `?q=` (min 2 chars) | JSON | Search with friendship/request metadata |
| `friends` | GET `/api/friends` | — | JSON | Friend list |
| `friend_requests` | GET `/api/friends/requests` | — | JSON | `{ received, sent }` pending lists |
| `send_friend_request` | POST `/api/friends/request` | `{ user_id: int }` | JSON 201 | Creates request + notification |
| `accept_friend_request` | POST `.../accept` | `request_id` | JSON | Accepts + `add_friendship` |
| `reject_friend_request` | POST `.../reject` | `request_id` | JSON | Sets status rejected |
| `remove_friend` | DELETE `/api/friends/<id>` | `friend_id` | JSON | Removes both friendship directions |

### Method Specifications

#### `send_friend_request()`

| Aspect | Specification |
|--------|---------------|
| **Preconditions** | `user_id` is int ≠ current user; receiver exists; not already friends; no pending request between pair |
| **Postconditions** | `FriendRequest` with `status="pending"`; Socket.IO notify receiver |
| **Exceptions** | 400 self/add/already friends/pending; 404 user not found |

#### `direct_conversation()` (friend gate)

| Aspect | Specification |
|--------|---------------|
| **Preconditions** | `are_friends(current_user, other_id)` must be true |
| **Postconditions** | Direct `Conversation` returned or created with sorted user IDs |
| **Exceptions** | 403 if not friends |

### External Dependencies

| Dependency | Usage |
|------------|-------|
| SQLAlchemy `or_`, `and_` | Request deduplication queries |
| Flask-SocketIO | `notification:new` to `user_{receiver_id}` |

---

## Module 4: Groups

### Module/Component Name

Groups — `backend/controllers/chat_controller.py` (group routes), `backend/models/group.py`

### Class/Module Interfaces

| Name | Type | Parameters | Returns | Description |
|------|------|------------|---------|-------------|
| `Group` | Model | `name`, `description`, `created_by_id` | — | Group metadata |
| `Group.to_dict` | method | — | `dict` | Includes `member_count` of active members |
| `GroupMember` | Model | `group_id`, `user_id`, `role`, `is_active` | — | Membership with read pointer |
| `GroupMember.to_dict` | method | — | `dict` | Role, user public profile |
| `create_group` | POST `/api/groups` | `{ name, description, member_ids[] }` | JSON 201 | Creates group + conversation |
| `group_info` | GET `/api/groups/<id>` | — | JSON | Group, role, members |
| `add_group_members` | POST `.../members` | `{ user_ids[] }` | JSON | Admin-only add/reactivate |
| `remove_group_member` | DELETE `.../members/<user_id>` | — | JSON | Admin soft-remove (`is_active=false`) |
| `leave_group` | POST `.../leave` | — | JSON | Self-leave with last-admin guard |

### Method Specifications

#### `create_group()`

| Aspect | Specification |
|--------|---------------|
| **Preconditions** | Non-empty `name`; `member_ids` list; ≥ 2 valid members (creator + ≥1 friend) |
| **Postconditions** | `Group`, admin `GroupMember`, member rows, `Conversation(type="group")` committed |
| **Exceptions** | 400 if insufficient members or invalid `member_ids` type |

#### `leave_group()`

| Aspect | Specification |
|--------|---------------|
| **Preconditions** | Active membership exists |
| **Postconditions** | `is_active=false` on membership |
| **Exceptions** | 400 if sole admin; 404 if not a member |

### External Dependencies

| Dependency | Usage |
|------------|-------|
| `are_friends` | Validates invitee eligibility |
| Socket.IO | Group join notifications |

---

## Module 5: Connection Status

### Module/Component Name

Connection Health — `frontend/static/js/connection.js`, `backend/app.py` (`/health`)

### Class/Module Interfaces

| Name | Type | Parameters | Returns | Description |
|------|------|------------|---------|-------------|
| `health` | GET route | — | JSON | Backend/database health probe |
| `_database_is_healthy` | function | — | `bool` | Executes `SELECT 1` |
| `ConnectionManager.start` | JS method | — | `void` | Binds DOM, starts health polling |
| `ConnectionManager.checkHealth` | JS method | `options` | `Promise<state>` | Fetches `/health`, updates state |
| `ConnectionManager.setSocketStatus` | JS method | `status: string` | `void` | Updates realtime lane in UI |
| `ConnectionManager.canSendMessages` | JS method | — | `bool` | `backend===online && database===connected` |
| `ConnectionManager.queueAction` | JS method | `action: Function` | `void` | Queues deferred send on outage |
| `ConnectionManager.flushActionQueue` | JS method | — | `Promise<void>` | Runs queued actions when operational |
| `ConnectionManager.onChange` | JS method | `listener` | `unsubscribe fn` | State change subscription |

### Method Specifications

#### `health()` GET `/health`

| Aspect | Specification |
|--------|---------------|
| **Preconditions** | None (unauthenticated health check) |
| **Postconditions** | Returns JSON with `status` (`ok` or `degraded`), `backend`, `database`, `app`, `version`, `environment` |
| **Exceptions** | None; database failure yields `degraded` not HTTP 500 |

#### `checkHealth(options)`

| Aspect | Specification |
|--------|---------------|
| **Preconditions** | `ConnectionManager` started |
| **Postconditions** | On success: `backend=online`, `database` from payload, schedule 30 s poll; on failure: exponential retry, dispatch `connection:lost` |
| **Exceptions** | Abort after 8 s timeout treated as failure |

### External Dependencies

| Dependency | Usage |
|------------|-------|
| Browser `fetch` API | Health polling |
| `window.AppConfig.healthUrl` | Configurable health endpoint (default `/health`) |
| Custom events | `connection:lost`, `connection:restored` for `chat.js` integration |

---

## Cross-Cutting External APIs

| API | Endpoint / Symbol | Auth | Notes |
|-----|-------------------|------|-------|
| App entry | `GET /` | Optional | Redirects to chat or login |
| CSRF | `X-CSRFToken` header | Session | Required on mutating HTTP methods |
| Uploads (web) | `/static/uploads/...` | Session for attachments | Avatars public within app |
| Uploads (desktop) | `/user-data/uploads/...` | `@login_required` | Path-guarded in `app.py` |
| Profile | `profile_bp` routes | `@login_required` | Avatar/bio updates (related module) |

---

## Assumptions

- All `/api/*` JSON errors follow `{ "error": "<message>" }` via `json_error()`.
- Socket.IO authentication relies on the same Flask session as HTTP (`g.user` loaded in app context).
- Message status values observed in code: `sent`, `delivered`, `seen`.
- Friend request status values: `pending`, `accepted`, `rejected`.
