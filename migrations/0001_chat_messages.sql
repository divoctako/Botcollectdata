-- Cloudflare D1 / SQLite. LINE identifiers must remain strings.
-- Times are UTC Unix milliseconds; views render Asia/Bangkok (+07:00).
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

-- No FK to messages: LINE may deliver an edit/unsend before the original.
-- Such an event is retained and becomes visible when its original arrives.
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

-- One row per original message, irrespective of webhook delivery order.
-- Equal event timestamps use event ID as a deterministic tie-break only.
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

-- Safe default for counts/summaries of the current conversation.
-- Retained unsent content remains available explicitly in message_current/history.
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
