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

-- Fixed coordinates are committed BEFORE calling Google; retries overwrite.
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
