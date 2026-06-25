# State Specification Template (SST)

| Field | Value |
|-------|-------|
| **Project** | WeChat Cloned |
| **Module/Component** | *(see state machines below)* |
| **Author** | *[Student Name]* |
| **Date** | 2026-06-25 |
| **Version** | 1.0 |

---

## Template Structure

Use this template to describe state machines: states, transitions, conditions, and actions on transitions.

### Section Labels (PSP Standard)

1. State machine name  
2. State list (name, description)  
3. Transition table: From State \| Event/Condition \| To State \| Action  
4. Initial and final states  

---

## State Machine 1: User Session (Authentication)

### State Machine Name

`UserSessionState`

### State List

| State | Description |
|-------|-------------|
| `Anonymous` | No `session["user_id"]`; `g.user` is None |
| `Authenticated` | Valid session references existing `User` row |
| `RateLimited` | Login attempts exceeded threshold for IP/username key (transient sub-state during login POST) |

### Transition Table

| From State | Event/Condition | To State | Action |
|------------|-----------------|----------|--------|
| `Anonymous` | GET `/login` or `/register` | `Anonymous` | Render form; issue CSRF token |
| `Anonymous` | POST `/login` success | `Authenticated` | `session["user_id"]=user.id`; clear throttle; redirect `/chat` |
| `Anonymous` | POST `/login` invalid credentials | `Anonymous` | `_record_failed_login()`; flash error |
| `Anonymous` | POST `/login` while rate limited | `Anonymous` | HTTP 429; flash throttle message |
| `Authenticated` | POST `/logout` | `Anonymous` | `session.clear()`; redirect `/login` |
| `Authenticated` | Access protected route | `Authenticated` | Serve resource |
| `Authenticated` | Session user_id invalid/deleted | `Anonymous` | `g.user=None`; redirect or 401 |
| `Authenticated` | GET `/login` while logged in | `Authenticated` | Redirect `/chat` (no logout) |

### Initial and Final States

| | State |
|---|-------|
| **Initial** | `Anonymous` (new browser session) |
| **Final** | `Anonymous` after explicit logout (session terminal for auth purposes; user may log in again) |

---

## State Machine 2: Message Delivery Status

### State Machine Name

`MessageDeliveryState` (per `Message.status` in direct conversations)

### State List

| State | Description |
|-------|-------------|
| `sent` | Message stored; recipient has no active Socket.IO connection |
| `delivered` | Recipient is online; message reached recipient client (or initial state if recipient online at send time) |
| `seen` | Recipient opened conversation; `read_at` set |

### Transition Table

| From State | Event/Condition | To State | Action |
|------------|-----------------|----------|--------|
| *(create)* | Direct msg; recipient offline (`_get_online_count==0`) | `sent` | `delivered_at=None` |
| *(create)* | Direct msg; recipient online | `delivered` | `delivered_at=utc_now()` |
| *(create)* | Group message | `delivered` | Group uses member `last_read_at` for aggregate read counts |
| `sent` | Recipient Socket.IO `connect` | `delivered` | `_mark_direct_messages_delivered()`; emit `message:status` |
| `sent` | Recipient connects (batch) | `delivered` | Update all pending peer messages in direct conversations |
| `delivered` | Recipient emits `conversation_read` / opens chat | `seen` | Set `read_at`; emit `message:read` |
| `seen` | — | `seen` | Terminal for delivery lifecycle |
| any | `delete_message` scope=everyone | `deleted` (logical) | `is_deleted=True`; body cleared; emit `message:deleted` |

### Initial and Final States

| | State |
|---|-------|
| **Initial** | `sent` or `delivered` at `_create_message()` based on recipient online presence |
| **Final** | `seen` for normal lifecycle; `deleted` for retraction |

---

## State Machine 3: Friend Request

### State Machine Name

`FriendRequestState` (`FriendRequest.status`)

### State List

| State | Description |
|-------|-------------|
| `pending` | Request created; awaiting receiver action |
| `accepted` | Receiver approved; bidirectional `Friend` rows exist |
| `rejected` | Receiver declined; no friendship |

### Transition Table

| From State | Event/Condition | To State | Action |
|------------|-----------------|----------|--------|
| *(none)* | POST `/api/friends/request` valid | `pending` | Insert `FriendRequest`; notify receiver |
| `pending` | POST `.../accept` by receiver | `accepted` | `add_friendship()` both directions; `responded_at` set; notify sender |
| `pending` | POST `.../reject` by receiver | `rejected` | `responded_at` set |
| `accepted` | DELETE `/api/friends/<id>` | *(friendship removed)* | Delete `Friend` rows; request row remains historical |
| `rejected` | New request after reject | `pending` | New row allowed (no unique pending enforced across rejected) |

### Initial and Final States

| | State |
|---|-------|
| **Initial** | Implicit non-friend (no row) before first request |
| **Final** | `accepted` (friendship active) or `rejected` (no friendship from that request) |

---

## State Machine 4: Group Membership

### State Machine Name

`GroupMembershipState` (`GroupMember.is_active`, `GroupMember.role`)

### State List

| State | Description |
|-------|-------------|
| `NonMember` | No row or `is_active=False` |
| `ActiveMember` | `is_active=True`, `role=member` |
| `ActiveAdmin` | `is_active=True`, `role=admin` |

### Transition Table

| From State | Event/Condition | To State | Action |
|------------|-----------------|----------|--------|
| `NonMember` | `create_group` / admin add | `ActiveMember` or `ActiveAdmin` | Insert/reactivate `GroupMember`; notify user |
| `ActiveMember` | Admin remove | `NonMember` | `is_active=False`; emit `group:removed` |
| `ActiveMember` | POST `leave` | `NonMember` | `is_active=False` |
| `ActiveAdmin` | POST `leave` (sole admin) | `ActiveAdmin` | **Reject** — error 400 |
| `ActiveAdmin` | POST `leave` (other admins exist) | `NonMember` | `is_active=False` |
| `ActiveAdmin` | Promote *(not in current code)* | `ActiveAdmin` | *N/A — only creator starts as admin* |

### Initial and Final States

| | State |
|---|-------|
| **Initial** | `NonMember` |
| **Final** | `NonMember` after leave or removal (conversation may still exist for other members) |

---

## State Machine 5: Backend Connection (Client)

### State Machine Name

`BackendHealthState` (`connection.js` — `state.backend`, `state.database`)

### State List

| State | Description |
|-------|-------------|
| `backend:online` | `/health` succeeded |
| `backend:reconnecting` | Transient failure; retries in progress |
| `backend:offline` | Exhausted retry ladder |
| `database:connected` | Health payload `database: true` |
| `database:degraded` | Health OK but DB probe failed |
| `database:disconnected` | Health request failed |

### Transition Table

| From State | Event/Condition | To State | Action |
|------------|-----------------|----------|--------|
| `backend:online` | `fetchHealth()` throws | `backend:reconnecting` | `wasOffline=true`; dispatch `connection:lost`; schedule retry |
| `backend:reconnecting` | Retry succeeds | `backend:online` | `retryIndex=0`; dispatch `connection:restored` if recovering; poll 30 s |
| `backend:reconnecting` | Retries ≥ ladder length | `backend:offline` | Show offline banner; disable composer |
| `backend:online` | `payload.database==false` | `database:degraded` | Disable messaging; show DB banner |
| `backend:online` | `payload.database==true` | `database:connected` | Enable composer (if socket also ready) |
| any | `window` `offline` event | `backend:reconnecting` | `database:disconnected`; schedule fast retry |
| any | `window` `online` event | → health check | `checkHealth({ reason: "browser-online" })` |

### Initial and Final States

| | State |
|---|-------|
| **Initial** | `backend:online`, `database:connected` (assumed until first check at startup) |
| **Final** | None — continuous monitoring while chat page mounted |

---

## State Machine 6: Socket.IO Realtime Channel (Client)

### State Machine Name

`SocketConnectionState` (`connection.js` — `state.socket`)

### State List

| State | Description |
|-------|-------------|
| `unavailable` | Socket.IO client not loaded (`window.io` missing) |
| `connected` | `socket.on("connect")` active |
| `reconnecting` | `connect_error` or transient `disconnect` |
| `disconnected` | Intentional or terminal disconnect |

### Transition Table

| From State | Event/Condition | To State | Action |
|------------|-----------------|----------|--------|
| `unavailable` | `window.io` present; page init | `reconnecting` | `io()` constructed in `chat.js` |
| `reconnecting` | `connect` | `connected` | `setSocketStatus("connected")`; `checkHealth`; refresh bootstrap if was lost |
| `connected` | `disconnect` (server/client) | `reconnecting` or `disconnected` | Based on reason; update pill to "Syncing..." |
| `connected` | `connect_error` | `reconnecting` | Socket.IO auto-retry |
| `connected` | `socket:ready` from server | `connected` | `socketReady=true`; join rooms server-side already |
| `reconnecting` | `reconnect` | `connected` | Flush bootstrap; restore realtime handlers |

### Initial and Final States

| | State |
|---|-------|
| **Initial** | `unavailable` until `chat.js` initializes socket |
| **Final** | `disconnected` on page unload (implicit) |

---

## State Machine 7: User Online Presence (Server)

### State Machine Name

`UserPresenceState` (`User.is_online`, `online_sids` map)

### State List

| State | Description |
|-------|-------------|
| `Offline` | `is_online=False`; no SIDs in `online_sids[user_id]` |
| `Online` | At least one Socket.IO SID registered for user |

### Transition Table

| From State | Event/Condition | To State | Action |
|------------|-----------------|----------|--------|
| `Offline` | Socket `connect` (authenticated) | `Online` | Add SID; `is_online=True`; join rooms; `_mark_direct_messages_delivered`; `_broadcast_status(True)` |
| `Online` | Additional tab connect | `Online` | Add SID to set |
| `Online` | One tab `disconnect` | `Online` | Remove SID; remain online if other SIDs exist |
| `Online` | Last SID `disconnect` | `Offline` | `is_online=False`; `last_seen=utc_now()`; `_broadcast_status(False)` to friends |

### Initial and Final States

| | State |
|---|-------|
| **Initial** | `Offline` (persisted default; updated on connect) |
| **Final** | `Offline` after all sockets close |

---

## Composite: Operational Messaging Gate

The UI enables sending only when **both** `BackendHealthState` is operational (`backend:online` + `database:connected`) **and** user is `Authenticated`. Socket `connected` improves realtime delivery but HTTP POST `/api/conversations/.../messages` remains an alternate path when socket send is unavailable.

```
[Anonymous] --login--> [Authenticated]
                              |
                              v
                    [canSendMessages?]
                     /              \
                   yes               no
                    |                 |
            [Composer enabled]  [Composer disabled,
             socket optional]    queueAction on recovery]
```

---

## Assumptions

- `RateLimited` is not persisted; it is derived from in-memory `_failed_login_attempts`.
- Group messages do not use per-message `sent`→`delivered` the same way as direct; read tracking uses `GroupMember.last_read_at`.
- Socket and backend state machines are orthogonal but combined in UI via `pillState()` in `connection.js`.
