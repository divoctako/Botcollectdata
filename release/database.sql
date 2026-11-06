CREATE TABLE messages (
    group_id TEXT NOT NULL CHECK (length(group_id) > 0),
    message_id TEXT NOT NULL CHECK (length(message_id) > 0),
    sender_id TEXT,
    sender_display_name TEXT,
    sent_at_ms INTEGER NOT NULL CHECK (sent_at_ms >= 0),
    received_at_ms INTEGER NOT NULL CHECK (received_at_ms >= 0),
    original_text TEXT NOT NULL,
    replied_to_message_id TEXT,
    PRIMARY KEY (group_id, message_id)
);

CREATE INDEX messages_group_sent ON messages(group_id, sent_at_ms);

CREATE TABLE message_events (
    webhook_event_id TEXT PRIMARY KEY NOT NULL CHECK (length(webhook_event_id) > 0),
    group_id TEXT NOT NULL CHECK (length(group_id) > 0),
    message_id TEXT NOT NULL CHECK (length(message_id) > 0),
    event_type TEXT NOT NULL CHECK (event_type IN ('received', 'edited', 'unsent')),
    event_at_ms INTEGER NOT NULL CHECK (event_at_ms >= 0),
    received_at_ms INTEGER NOT NULL CHECK (received_at_ms >= 0),
    text TEXT,
    sheets_synced_at_ms INTEGER CHECK (sheets_synced_at_ms >= 0),
    CHECK (
        (event_type IN ('received', 'edited') AND text IS NOT NULL)
        OR (event_type = 'unsent' AND text IS NULL)
    )
);

CREATE INDEX events_message_time
    ON message_events(group_id, message_id, event_type, event_at_ms, webhook_event_id);

CREATE INDEX events_pending
    ON message_events(received_at_ms) WHERE sheets_synced_at_ms IS NULL;

CREATE VIEW message_current AS
SELECT
    m.group_id,
    m.message_id,
    m.sender_id,
    m.sender_display_name,
    m.sent_at_ms,
    strftime('%Y-%m-%dT%H:%M:%f', m.sent_at_ms / 1000.0,
             'unixepoch', '+7 hours') || '+07:00' AS sent_at_thai,
    'Asia/Bangkok' AS timezone,
    m.received_at_ms,
    m.original_text,
    COALESCE((
        SELECT e.text FROM message_events e
        WHERE e.group_id = m.group_id AND e.message_id = m.message_id
          AND e.event_type = 'edited'
        ORDER BY e.event_at_ms DESC, e.webhook_event_id DESC LIMIT 1
    ), m.original_text) AS current_text,
    m.replied_to_message_id,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM message_events e
            WHERE e.group_id = m.group_id AND e.message_id = m.message_id
              AND e.event_type = 'unsent'
        ) THEN 'unsent'
        WHEN EXISTS (
            SELECT 1 FROM message_events e
            WHERE e.group_id = m.group_id AND e.message_id = m.message_id
              AND e.event_type = 'edited'
        ) THEN 'edited'
        ELSE 'active'
    END AS message_status,
    (SELECT MAX(e.event_at_ms) FROM message_events e
     WHERE e.group_id = m.group_id AND e.message_id = m.message_id
       AND e.event_type = 'edited') AS edited_at_ms,
    (SELECT MAX(e.event_at_ms) FROM message_events e
     WHERE e.group_id = m.group_id AND e.message_id = m.message_id
       AND e.event_type = 'unsent') AS unsent_at_ms,
    1 + (SELECT COUNT(*) FROM message_events e
         WHERE e.group_id = m.group_id AND e.message_id = m.message_id
           AND e.event_type = 'edited') AS version_count
FROM messages m;

CREATE VIEW ai_messages AS
SELECT group_id, message_id, sender_id, sender_display_name,
       sent_at_ms, sent_at_thai, timezone, current_text,
       replied_to_message_id, message_status, edited_at_ms, version_count
FROM message_current
WHERE message_status <> 'unsent';

CREATE VIEW message_history AS
SELECT e.webhook_event_id, e.group_id, e.message_id,
       e.event_type, e.event_at_ms,
       strftime('%Y-%m-%dT%H:%M:%f', e.event_at_ms / 1000.0,
                'unixepoch', '+7 hours') || '+07:00' AS event_at_thai,
       'Asia/Bangkok' AS timezone,
       e.text, e.received_at_ms, e.sheets_synced_at_ms
FROM message_events e;

CREATE TABLE settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

CREATE TABLE chat_groups (
    group_id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    updated_at_ms INTEGER NOT NULL
);

CREATE TABLE member_profiles (
    group_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    display_name TEXT,
    expires_at_ms INTEGER NOT NULL,
    PRIMARY KEY (group_id, sender_id)
);

CREATE TABLE workbooks (
    month TEXT PRIMARY KEY NOT NULL,
    spreadsheet_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    expired INTEGER NOT NULL DEFAULT 0 CHECK (expired IN (0, 1))
);

CREATE TABLE sheet_targets (
    month TEXT NOT NULL,
    group_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('messages', 'history')),
    sheet_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    next_row INTEGER NOT NULL DEFAULT 2,
    capacity INTEGER NOT NULL DEFAULT 100,
    PRIMARY KEY (month, group_id, kind),
    UNIQUE (month, sheet_id)
);

CREATE TABLE sheet_rows (
    group_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('messages', 'history')),
    reference_id TEXT NOT NULL,
    month TEXT NOT NULL,
    row_number INTEGER NOT NULL,
    recorded_at_ms INTEGER NOT NULL,
    PRIMARY KEY (group_id, kind, reference_id)
);

CREATE TABLE leases (
    name TEXT PRIMARY KEY NOT NULL,
    token TEXT NOT NULL,
    expires_at_ms INTEGER NOT NULL
);

ALTER TABLE message_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE message_events ADD COLUMN next_attempt_at_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE message_events ADD COLUMN last_error TEXT;

DROP INDEX events_pending;

CREATE INDEX events_pending ON message_events(next_attempt_at_ms, received_at_ms)
    WHERE sheets_synced_at_ms IS NULL;

CREATE INDEX events_completed ON message_events(sheets_synced_at_ms)
    WHERE sheets_synced_at_ms IS NOT NULL;

CREATE INDEX messages_received ON messages(received_at_ms);

CREATE INDEX sheet_rows_recorded ON sheet_rows(recorded_at_ms);

CREATE INDEX profiles_expiry ON member_profiles(expires_at_ms);
