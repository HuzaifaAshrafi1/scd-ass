# Operational Specification Template (OST)

| Field | Value |
|-------|-------|
| **Project** | WeChat Cloned |
| **Module/Component** | *(see sections below)* |
| **Author** | *[Student Name]* |
| **Date** | 2026-06-25 |
| **Version** | 1.0 |

---

## Template Structure

Use this template to describe how users interact with the system: operational scenarios, user actions, system responses, and test scenarios.

### Section Labels (PSP Standard)

1. Module/Component name  
2. Purpose  
3. Operational scenarios (numbered): Actor, Preconditions, Normal flow, Postconditions, Exceptions  

---

## Module 1: Authentication

### Module/Component Name

Authentication (`auth_controller.py`, `login.html`, `register.html`, `auth.js`)

### Purpose

Allow users to register a new account, sign in with username and password, and sign out. Enforce password strength, username format, login rate limiting, and server-side session management with CSRF token issuance.

### Operational Scenarios

#### Scenario 1.1 — User Login (Success)

| Item | Description |
|------|-------------|
| **Actor** | Registered user (unauthenticated) |
| **Preconditions** | User account exists in SQLite `users` table; server is running at `http://127.0.0.1:5000`; user is not already logged in |
| **Normal Flow** | 1. Actor navigates to `/login`.<br>2. System renders `login.html` with CSRF token.<br>3. Actor enters username and password and submits the form (POST `/login`).<br>4. System sanitizes username (lowercase, max 40 chars), looks up `User`, verifies password via `check_password()`.<br>5. System clears failed-login throttle for the client IP/username pair, sets `session["user_id"]`, issues CSRF token.<br>6. System redirects to `/chat`. |
| **Postconditions** | User session is active; chat page loads; Socket.IO can connect using session cookie |
| **Exceptions** | **E1:** Invalid credentials → flash "Invalid username or password." and re-render login form.<br>**E2:** Too many failed attempts within rate-limit window → HTTP 429, flash "Too many login attempts…"<br>**E3:** Already logged in → redirect to `/chat` without re-authenticating |

#### Scenario 1.2 — User Registration

| Item | Description |
|------|-------------|
| **Actor** | New user |
| **Preconditions** | Username is not already taken; password ≥ 8 characters |
| **Normal Flow** | 1. Actor opens `/register`.<br>2. Actor submits username (3–40 alphanumeric/underscore), display name, password, and confirmation.<br>3. Client-side `auth.js` validates fields before submit.<br>4. Server validates pattern, password length, password match, and uniqueness.<br>5. Server creates `User`, hashes password with Werkzeug, commits to database.<br>6. Server logs user in and redirects to `/chat`. |
| **Postconditions** | New user record exists; session established |
| **Exceptions** | Invalid username pattern, short password, password mismatch, or duplicate username → flash error and re-render register form |

#### Scenario 1.3 — User Logout

| Item | Description |
|------|-------------|
| **Actor** | Authenticated user |
| **Preconditions** | Valid `session["user_id"]` |
| **Normal Flow** | 1. Actor submits POST `/logout` (with CSRF token).<br>2. System calls `session.clear()`.<br>3. System redirects to `/login`. |
| **Postconditions** | Session destroyed; protected routes require re-login |
| **Exceptions** | Missing CSRF token on POST → HTTP 400 |

### Test Scenarios (Authentication)

| ID | Test | Expected Result |
|----|------|-----------------|
| T-AUTH-01 | Login with sample user `user` / `12345678` | Redirect to `/chat` |
| T-AUTH-02 | Login with wrong password 6 times from same IP | 429 on 6th attempt within lock window |
| T-AUTH-03 | Register with 7-character password | Error flash; no user created |
| T-AUTH-04 | Access `/api/bootstrap` without session | 401 JSON or redirect to login |

---

## Module 2: Messaging / Chat

### Module/Component Name

Real-Time Messaging (`chat_controller.py`, `chat.js`, Socket.IO)

### Purpose

Enable authenticated friends to exchange one-to-one and group messages in real time, with delivery/read receipts, typing indicators, attachments, message search, reactions, pinning, forwarding, and deletion.

### Operational Scenarios

#### Scenario 2.1 — Send Text Message (Socket.IO)

| Item | Description |
|------|-------------|
| **Actor** | Authenticated user in an active conversation |
| **Preconditions** | User is friend with recipient (direct) or active group member; Socket.IO connected; `ConnectionManager.canSendMessages()` is true |
| **Normal Flow** | 1. Actor selects conversation in sidebar.<br>2. Client emits `join_conversation` with `conversation_id`.<br>3. Actor types message and submits composer.<br>4. Client emits `send_message` with `conversation_id` and `body`.<br>5. Server validates membership, creates `Message` via `_create_message()`, broadcasts `message:new` to `conversation_{id}` room.<br>6. Recipient clients update message list and sidebar preview; notification toast if applicable. |
| **Postconditions** | Message persisted in SQLite; unread count updated for other participants |
| **Exceptions** | Empty body → error returned to sender.<br>Backend offline → composer disabled; draft preserved per `connection.js` banner.<br>Non-member conversation → "Conversation was not found." |

#### Scenario 2.2 — Send Message with Attachment (HTTP)

| Item | Description |
|------|-------------|
| **Actor** | Authenticated user |
| **Preconditions** | File within allowed extensions and 12 MB limit; operational backend |
| **Normal Flow** | 1. Actor attaches file via `#attachmentInput`.<br>2. Client POSTs multipart form to `/api/conversations/<id>/messages` with optional `body` and `attachment`.<br>3. Server saves file via `save_upload()`, sets `message_type` to `image` or `document`.<br>4. Server broadcasts `message:new` with `attachment` metadata. |
| **Postconditions** | Attachment stored under `frontend/static/uploads/attachments/` (or desktop user-data path); downloadable via `/api/attachments/<id>/download` |
| **Exceptions** | Disallowed extension or signature mismatch → HTTP 400.<br>File too large → HTTP 413 |

#### Scenario 2.3 — Read Receipts and Typing Indicator

| Item | Description |
|------|-------------|
| **Actor** | Conversation participant |
| **Preconditions** | Active conversation open; Socket.IO connected |
| **Normal Flow (read)** | 1. Actor opens conversation.<br>2. Client emits `conversation_read`.<br>3. Server updates `last_read_at`, sets peer messages to `status=seen`, emits `message:read`.<br>**Normal Flow (typing)** | 1. Actor types in composer.<br>2. Client emits `typing` with `is_typing: true`, then false after timeout.<br>3. Other participants see "X is typing..." in `#typingIndicator`. |
| **Postconditions** | Sender sees delivered/seen status updates via `message:status` and `message:read` |
| **Exceptions** | Socket disconnected → typing events not delivered; read sync retried on reconnect via bootstrap refresh |

#### Scenario 2.4 — Message Search Within Conversation

| Item | Description |
|------|-------------|
| **Actor** | Authenticated user |
| **Preconditions** | User has access to conversation |
| **Normal Flow** | 1. Actor opens message search bar.<br>2. Client GETs `/api/conversations/<id>/messages?q=<query>`.<br>3. Server filters `Message.body` with `ILIKE`, returns up to 300 messages (excluding user-hidden).<br>4. Client highlights matches and supports match navigation. |
| **Postconditions** | Filtered message list displayed without mutating stored messages |
| **Exceptions** | Empty query returns full history (up to limit) |

### Test Scenarios (Messaging)

| ID | Test | Expected Result |
|----|------|-----------------|
| T-MSG-01 | Send message to non-friend via direct conversation API | HTTP 403 |
| T-MSG-02 | Receiver connects Socket.IO while sender online | Message status transitions sent → delivered |
| T-MSG-03 | Receiver opens conversation | Unread count resets; `message:read` emitted |
| T-MSG-04 | Delete message `scope=me` | Hidden for current user only via `MessageHidden` |

---

## Module 3: Friends

### Module/Component Name

Friends Management (`friends_controller.py`, friend UI in `chat.js`)

### Purpose

Allow users to search for other users, send and respond to friend requests, list friends, and remove friendships. Friend status gates direct messaging.

### Operational Scenarios

#### Scenario 3.1 — Search Users and Send Friend Request

| Item | Description |
|------|-------------|
| **Actor** | Authenticated user |
| **Preconditions** | Search query length ≥ 2 characters |
| **Normal Flow** | 1. Actor enters query in `#userSearchInput` (debounced).<br>2. Client GETs `/api/users/search?q=...`.<br>3. System returns up to 20 users with `is_friend`, `request_status`, `request_direction`.<br>4. Actor clicks "Add Friend" on a result.<br>5. Client POSTs `/api/friends/request` with `{ user_id }`.<br>6. Server creates `FriendRequest` (status `pending`), emits `notification:new` to receiver's `user_{id}` room. |
| **Postconditions** | Pending request visible in sender's "sent" and receiver's "received" lists |
| **Exceptions** | Self-request, already friends, or duplicate pending request → JSON error |

#### Scenario 3.2 — Accept Friend Request

| Item | Description |
|------|-------------|
| **Actor** | Request receiver |
| **Preconditions** | Pending `FriendRequest` exists for current user as receiver |
| **Normal Flow** | 1. Actor views `#requestList`.<br>2. Actor accepts request.<br>3. Client POSTs `/api/friends/requests/<id>/accept`.<br>4. Server sets status `accepted`, calls `add_friendship()` (bidirectional `Friend` rows), notifies sender via Socket.IO. |
| **Postconditions** | Both users appear in each other's friend list; direct conversation can be created |
| **Exceptions** | Request not found or not pending → HTTP 404 |

#### Scenario 3.3 — Remove Friend

| Item | Description |
|------|-------------|
| **Actor** | Authenticated user |
| **Preconditions** | Friendship exists |
| **Normal Flow** | 1. Actor removes friend from friend list.<br>2. Client DELETEs `/api/friends/<friend_id>`.<br>3. Server deletes both directional `Friend` rows. |
| **Postconditions** | Users no longer friends; new direct messages blocked (403) though historical conversation may remain |
| **Exceptions** | None documented for non-friend delete (idempotent delete) |

### Test Scenarios (Friends)

| ID | Test | Expected Result |
|----|------|-----------------|
| T-FRD-01 | Search with 1-character query | Empty `users` array |
| T-FRD-02 | Accept request | Bidirectional friendship; notification to sender |
| T-FRD-03 | Reject request | Status `rejected`; no friendship created |

---

## Module 4: Groups

### Module/Component Name

Group Chat (`chat_controller.py` group routes, group drawer in `chat.js`)

### Purpose

Allow users to create group conversations with friends, manage membership (admin add/remove), view group info, and exchange group messages with read-count aggregation.

### Operational Scenarios

#### Scenario 4.1 — Create Group

| Item | Description |
|------|-------------|
| **Actor** | Authenticated user (becomes admin) |
| **Preconditions** | At least one friend selected in addition to creator |
| **Normal Flow** | 1. Actor fills `#createGroupForm` (name, description, member checkboxes).<br>2. Client POSTs `/api/groups` with `name`, `description`, `member_ids`.<br>3. Server creates `Group`, `GroupMember` rows (creator = admin), linked `Conversation` (type `group`).<br>4. Server notifies each member via `notification:new`. |
| **Postconditions** | Group appears in all members' conversation sidebar |
| **Exceptions** | Fewer than 2 valid members → HTTP 400.<br>Non-friend IDs silently excluded |

#### Scenario 4.2 — Admin Adds Members

| Item | Description |
|------|-------------|
| **Actor** | Group admin |
| **Preconditions** | Actor has `GroupMember.role == "admin"` and `is_active` |
| **Normal Flow** | 1. Actor opens group drawer (`#groupDrawer`).<br>2. Actor selects friends and submits `#addMembersForm`.<br>3. Client POSTs `/api/groups/<id>/members` with `user_ids`.<br>4. Server reactivates or creates memberships; notifies added users. |
| **Postconditions** | New members join Socket.IO conversation rooms on next connect |
| **Exceptions** | Non-admin → HTTP 403 |

#### Scenario 4.3 — Leave Group (Last Admin)

| Item | Description |
|------|-------------|
| **Actor** | Sole active admin |
| **Preconditions** | Only one active admin in group |
| **Normal Flow** | 1. Actor attempts to leave.<br>2. Client POSTs `/api/groups/<id>/leave`.<br>3. Server rejects because `active_admins == 1`. |
| **Postconditions** | Membership unchanged |
| **Exceptions** | Error: "Assign another admin before leaving." |

### Test Scenarios (Groups)

| ID | Test | Expected Result |
|----|------|-----------------|
| T-GRP-01 | Create group with one friend | HTTP 201; conversation in sidebar |
| T-GRP-02 | Non-admin adds member | HTTP 403 |
| T-GRP-03 | Admin removes member | Member receives `group:removed` event |

---

## Module 5: Connection Status

### Module/Component Name

Connection Health (`connection.js`, `/health` endpoint, Socket.IO lifecycle in `chat.js`)

### Purpose

Monitor backend, database, and realtime channel health; inform the user via connection pill and banner; disable message composer when system is non-operational; queue and flush actions after recovery.

### Operational Scenarios

#### Scenario 5.1 — Healthy Startup

| Item | Description |
|------|-------------|
| **Actor** | Authenticated user on `/chat` |
| **Preconditions** | Flask server and SQLite database available |
| **Normal Flow** | 1. `ConnectionManager.start()` binds UI elements.<br>2. Client GETs `/health` (8 s timeout).<br>3. Server returns `{ status: "ok", backend: true, database: true, app: "WeChat Cloned", version, environment }`.<br>4. Pill shows "Backend Online"; diagnostics list frontend, backend, database, realtime states.<br>5. Socket.IO connects; `setSocketStatus("connected")`.<br>6. Server emits `socket:ready` on connect. |
| **Postconditions** | Send button and attachment button enabled |
| **Exceptions** | Health fetch fails → backend `reconnecting` then `offline`; banner shown; composer disabled |

#### Scenario 5.2 — Backend Outage and Recovery

| Item | Description |
|------|-------------|
| **Actor** | User composing a message during outage |
| **Preconditions** | User had been online; server stops or network fails |
| **Normal Flow** | 1. Health poll fails; `connection:lost` custom event dispatched.<br>2. Banner: "Backend is offline. Messages are saved locally…"<br>3. Composer disabled (`aria-disabled=true`).<br>4. On recovery, health succeeds; `connection:restored` fired; `flushActionQueue()` runs queued sends. |
| **Postconditions** | Retry intervals follow `[1s, 2s, 5s, 10s, 30s]` then healthy poll every 30 s |
| **Exceptions** | Database degraded (`database: false` in health) → messaging disabled with degraded banner |

#### Scenario 5.3 — Socket Disconnect While Backend Online

| Item | Description |
|------|-------------|
| **Actor** | Authenticated user |
| **Preconditions** | Backend health OK; Socket.IO drops |
| **Normal Flow** | 1. `socket.on("disconnect")` sets status `reconnecting` or `disconnected`.<br>2. Pill may show "Syncing...".<br>3. On `reconnect`, client refreshes bootstrap data and sets socket `connected`. |
| **Postconditions** | Realtime events resume; missed messages loaded via `/api/bootstrap` or conversation fetch |
| **Exceptions** | Unauthenticated socket connect → server `disconnect()` |

### Test Scenarios (Connection)

| ID | Test | Expected Result |
|----|------|-----------------|
| T-CONN-01 | GET `/health` with DB up | `status: "ok"`, `database: true` |
| T-CONN-02 | Stop Flask during chat session | Pill offline; send disabled |
| T-CONN-03 | Socket reconnect after drop | Bootstrap refresh; pill online |

---

## Assumptions

- Application name is **WeChat Cloned** per `backend/config.py` (`APP_NAME`).
- Frontend localStorage keys use the `pulsechat-` prefix (legacy naming); this does not change the product name.
- Desktop mode (`WECHAT_CLONED_DESKTOP=1`) uses alternate upload URLs and data paths; operational flows are otherwise equivalent.
- Profile management (`profile_controller.py`) is out of scope for these core-module scenarios but uses the same auth and upload patterns.
