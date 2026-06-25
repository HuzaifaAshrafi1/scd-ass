PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id INTEGER NOT NULL PRIMARY KEY,
    username VARCHAR(40) NOT NULL UNIQUE,
    display_name VARCHAR(80) NOT NULL,
    bio VARCHAR(280),
    password_hash VARCHAR(255) NOT NULL,
    profile_photo VARCHAR(255),
    is_online BOOLEAN NOT NULL DEFAULT 0,
    last_seen DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_users_username ON users (username);

CREATE TABLE IF NOT EXISTS friend_requests (
    id INTEGER NOT NULL PRIMARY KEY,
    sender_id INTEGER NOT NULL,
    receiver_id INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at DATETIME NOT NULL,
    responded_at DATETIME,
    CONSTRAINT ck_friend_request_not_self CHECK (sender_id != receiver_id),
    FOREIGN KEY(sender_id) REFERENCES users (id),
    FOREIGN KEY(receiver_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_friend_requests_sender_id ON friend_requests (sender_id);
CREATE INDEX IF NOT EXISTS ix_friend_requests_receiver_id ON friend_requests (receiver_id);
CREATE INDEX IF NOT EXISTS ix_friend_requests_status ON friend_requests (status);

CREATE TABLE IF NOT EXISTS friends (
    id INTEGER NOT NULL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    friend_id INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    CONSTRAINT uq_friend_pair UNIQUE (user_id, friend_id),
    CONSTRAINT ck_friend_not_self CHECK (user_id != friend_id),
    FOREIGN KEY(user_id) REFERENCES users (id),
    FOREIGN KEY(friend_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_friends_user_id ON friends (user_id);
CREATE INDEX IF NOT EXISTS ix_friends_friend_id ON friends (friend_id);

CREATE TABLE IF NOT EXISTS groups (
    id INTEGER NOT NULL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(300),
    photo VARCHAR(255),
    created_by_id INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY(created_by_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_groups_created_by_id ON groups (created_by_id);

CREATE TABLE IF NOT EXISTS group_members (
    id INTEGER NOT NULL PRIMARY KEY,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member',
    is_active BOOLEAN NOT NULL DEFAULT 1,
    joined_at DATETIME NOT NULL,
    last_read_at DATETIME NOT NULL,
    CONSTRAINT uq_group_member UNIQUE (group_id, user_id),
    FOREIGN KEY(group_id) REFERENCES groups (id),
    FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_group_members_group_id ON group_members (group_id);
CREATE INDEX IF NOT EXISTS ix_group_members_user_id ON group_members (user_id);

CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER NOT NULL PRIMARY KEY,
    type VARCHAR(20) NOT NULL,
    title VARCHAR(140),
    user_one_id INTEGER,
    user_two_id INTEGER,
    group_id INTEGER UNIQUE,
    user_one_last_read_at DATETIME NOT NULL,
    user_two_last_read_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    last_message_at DATETIME NOT NULL,
    CONSTRAINT ck_conversation_shape CHECK (
        (type = 'direct' AND user_one_id IS NOT NULL AND user_two_id IS NOT NULL AND group_id IS NULL)
        OR (type = 'group' AND group_id IS NOT NULL)
    ),
    CONSTRAINT uq_direct_conversation UNIQUE (user_one_id, user_two_id),
    FOREIGN KEY(user_one_id) REFERENCES users (id),
    FOREIGN KEY(user_two_id) REFERENCES users (id),
    FOREIGN KEY(group_id) REFERENCES groups (id)
);

CREATE INDEX IF NOT EXISTS ix_conversations_type ON conversations (type);
CREATE INDEX IF NOT EXISTS ix_conversations_user_one_id ON conversations (user_one_id);
CREATE INDEX IF NOT EXISTS ix_conversations_user_two_id ON conversations (user_two_id);
CREATE INDEX IF NOT EXISTS ix_conversations_group_id ON conversations (group_id);
CREATE INDEX IF NOT EXISTS ix_conversations_last_message_at ON conversations (last_message_at);

CREATE TABLE IF NOT EXISTS messages (
    id INTEGER NOT NULL PRIMARY KEY,
    conversation_id INTEGER NOT NULL,
    sender_id INTEGER NOT NULL,
    body TEXT,
    message_type VARCHAR(20) NOT NULL DEFAULT 'text',
    status VARCHAR(20) NOT NULL DEFAULT 'sent',
    delivered_at DATETIME,
    read_at DATETIME,
    is_deleted BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES conversations (id),
    FOREIGN KEY(sender_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_messages_conversation_id ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS ix_messages_sender_id ON messages (sender_id);
CREATE INDEX IF NOT EXISTS ix_messages_status ON messages (status);
CREATE INDEX IF NOT EXISTS ix_messages_created_at ON messages (created_at);

CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER NOT NULL PRIMARY KEY,
    message_id INTEGER UNIQUE,
    uploaded_by_id INTEGER NOT NULL,
    filename VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    storage_path VARCHAR(500) NOT NULL,
    url_path VARCHAR(500) NOT NULL,
    mimetype VARCHAR(120) NOT NULL,
    file_size INTEGER NOT NULL,
    created_at DATETIME NOT NULL,
    FOREIGN KEY(message_id) REFERENCES messages (id),
    FOREIGN KEY(uploaded_by_id) REFERENCES users (id)
);

CREATE INDEX IF NOT EXISTS ix_attachments_message_id ON attachments (message_id);
CREATE INDEX IF NOT EXISTS ix_attachments_uploaded_by_id ON attachments (uploaded_by_id);
