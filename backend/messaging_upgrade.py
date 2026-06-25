from sqlalchemy import inspect, text

from extensions import db


MESSAGE_COLUMNS = (
    ("edited_at", {"default": "DATETIME", "mssql": "DATETIME"}),
    ("deleted_for_everyone", {"default": "BOOLEAN DEFAULT 0", "mssql": "BIT DEFAULT 0"}),
    ("is_forwarded", {"default": "BOOLEAN DEFAULT 0", "mssql": "BIT DEFAULT 0"}),
    ("forward_from_name", {"default": "VARCHAR(120)", "mssql": "VARCHAR(120)"}),
)

PERFORMANCE_INDEXES = (
    ("ix_messages_conversation_created", "messages", "conversation_id, created_at"),
    ("ix_messages_conversation_created_id", "messages", "conversation_id, created_at, id"),
    ("ix_messages_conversation_sender_created", "messages", "conversation_id, sender_id, created_at"),
    ("ix_messages_status", "messages", "conversation_id, status"),
    ("ix_group_members_group_active", "group_members", "group_id, is_active"),
    ("ix_group_members_user_active", "group_members", "user_id, is_active"),
    ("ix_friend_requests_receiver_status_created", "friend_requests", "receiver_id, status, created_at"),
    ("ix_friend_requests_sender_status_created", "friend_requests", "sender_id, status, created_at"),
)


def upgrade_messaging_schema():
    """Add messaging feature tables/columns/indexes for existing desktop databases."""
    db.create_all()
    inspector = inspect(db.engine)
    table_names = set(inspector.get_table_names())
    if "messages" not in table_names:
        return
    existing = {column["name"] for column in inspector.get_columns("messages")}
    dialect = db.engine.dialect.name
    with db.engine.begin() as connection:
        for name, ddl_by_dialect in MESSAGE_COLUMNS:
            if name in existing:
                continue
            ddl = ddl_by_dialect.get(dialect, ddl_by_dialect["default"])
            connection.execute(text(_add_column_sql(dialect, "messages", name, ddl)))

        existing_indexes = _existing_index_names(inspector, table_names)

        for index_name, table_name, columns in PERFORMANCE_INDEXES:
            if table_name not in table_names:
                continue
            if index_name in existing_indexes:
                continue
            connection.execute(text(_create_index_sql(dialect, index_name, table_name, columns)))


def _existing_index_names(inspector, table_names):
    indexes = set()
    for table_name in table_names:
        try:
            indexes.update(index["name"] for index in inspector.get_indexes(table_name))
        except Exception:
            continue
    return indexes


def _create_index_sql(dialect, index_name, table_name, columns):
    if dialect == "sqlite":
        return f"CREATE INDEX IF NOT EXISTS {index_name} ON {table_name} ({columns})"
    return f"CREATE INDEX {index_name} ON {table_name} ({columns})"


def _add_column_sql(dialect, table_name, column_name, column_ddl):
    if dialect == "mssql":
        return f"ALTER TABLE {table_name} ADD {column_name} {column_ddl}"
    return f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_ddl}"
