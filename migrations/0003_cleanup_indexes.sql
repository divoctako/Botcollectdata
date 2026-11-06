-- Avoid scanning the entire seven-day cache every maintenance invocation.
CREATE INDEX messages_received ON messages(received_at_ms);
CREATE INDEX sheet_rows_recorded ON sheet_rows(recorded_at_ms);
CREATE INDEX profiles_expiry ON member_profiles(expires_at_ms);
