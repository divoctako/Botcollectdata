export const MESSAGE_HEADERS = ['group_id', 'message_id', 'sender_id', 'sender_display_name',
  'sent_at_ms', 'sent_at_thai', 'timezone', 'original_text', 'current_text',
  'replied_to_message_id', 'message_status', 'edited_at_ms', 'unsent_at_ms', 'version_count',
  'latest_edit_event_id'];
export const HISTORY_HEADERS = ['webhook_event_id', 'group_id', 'message_id', 'event_type',
  'event_at_ms', 'event_at_thai', 'timezone', 'text', 'original_sent_at_ms'];

export function thaiTime(ms) {
  return new Date(Number(ms) + 7 * 3600_000).toISOString().replace('Z', '+07:00');
}
export const thaiMonth = (ms) => thaiTime(ms).slice(0, 7);
export const toRow = (record, headers) => headers.map((key) => record[key] ?? '');
export function fromRow(row, headers = MESSAGE_HEADERS) {
  if (!row?.[1]) return null;
  return Object.fromEntries(headers.map((key, i) => [key, row[i] ?? '']));
}
export function projectMessage(previous, original, event) {
  if (!previous && !original) return null;
  const record = previous ? { ...previous } : {
    ...original, current_text: original.original_text, message_status: 'active',
    edited_at_ms: '', unsent_at_ms: '', version_count: 1, latest_edit_event_id: '',
  };
  record.sent_at_thai = thaiTime(record.sent_at_ms);
  record.timezone = 'Asia/Bangkok';
  if (event.event_type === 'edited') {
    record.version_count = Number(record.version_count) + 1;
    const previousTime = record.edited_at_ms === '' ? -1 : Number(record.edited_at_ms);
    if (event.event_at_ms > previousTime || (event.event_at_ms === previousTime
      && event.webhook_event_id > record.latest_edit_event_id)) {
      record.current_text = event.text;
      record.edited_at_ms = event.event_at_ms;
      record.latest_edit_event_id = event.webhook_event_id;
    }
    if (record.message_status !== 'unsent') record.message_status = 'edited';
  }
  if (event.event_type === 'unsent') {
    record.message_status = 'unsent';
    record.unsent_at_ms = Math.max(Number(record.unsent_at_ms || 0), event.event_at_ms);
  }
  return record;
}
