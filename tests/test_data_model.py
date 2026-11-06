import sqlite3
import unittest
from pathlib import Path


class DataModelTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys = ON')
        schema = Path(__file__).resolve().parents[1] / 'migrations' / '0001_chat_messages.sql'
        self.db.executescript(schema.read_text(encoding='utf-8'))

    def tearDown(self):
        self.db.close()

    def message(self, sender=None, name=None, quoted=None, sent=0):
        self.db.execute(
            'INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            ('g1', '9007199254740993', sender, name, sent, sent + 1, 'เดิม', quoted),
        )

    def event(self, event_id, kind, at, text=None):
        self.db.execute(
            'INSERT INTO message_events '
            '(webhook_event_id, group_id, message_id, event_type, event_at_ms, received_at_ms, text) '
            'VALUES (?, ?, ?, ?, ?, ?, ?)',
            (event_id, 'g1', '9007199254740993', kind, at, at + 1, text),
        )

    def current(self):
        return self.db.execute('SELECT * FROM message_current').fetchone()

    def test_nullable_sender_quote_outside_dataset_and_string_ids(self):
        self.message(quoted='not-collected')
        row = self.current()
        self.assertIsNone(row['sender_id'])
        self.assertIsNone(row['sender_display_name'])
        self.assertEqual(row['message_id'], '9007199254740993')
        self.assertEqual(row['replied_to_message_id'], 'not-collected')
        self.assertEqual(row['message_status'], 'active')

    def test_thai_time_crosses_date_boundary_and_preserves_milliseconds(self):
        # 1970-01-01 18:00:00.123 UTC -> next day 01:00 in Bangkok.
        self.message(sent=64_800_123)
        self.assertEqual(self.current()['sent_at_thai'], '1970-01-02T01:00:00.123+07:00')
        self.assertEqual(self.current()['timezone'], 'Asia/Bangkok')

    def test_latest_edit_uses_event_time_even_if_delivered_first(self):
        self.event('new', 'edited', 200, 'ใหม่สุด')
        self.event('old', 'edited', 100, 'ฉบับก่อน')
        self.message(sender='u1', name='ชื่อขณะส่ง')
        row = self.current()
        self.assertEqual(row['original_text'], 'เดิม')
        self.assertEqual(row['current_text'], 'ใหม่สุด')
        self.assertEqual(row['version_count'], 3)
        self.assertEqual(row['message_status'], 'edited')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ai_messages').fetchone()[0], 1)

    def test_unsend_preserves_edits_and_original_but_excludes_current_ai_counts(self):
        self.message()
        self.event('e1', 'received', 0, 'เดิม')
        self.event('e2', 'edited', 100, 'ใหม่')
        self.event('e3', 'unsent', 200)
        row = self.current()
        self.assertEqual((row['original_text'], row['current_text']), ('เดิม', 'ใหม่'))
        self.assertEqual(row['message_status'], 'unsent')
        self.assertEqual((row['edited_at_ms'], row['unsent_at_ms']), (100, 200))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM ai_messages').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM message_history').fetchone()[0], 3)

    def test_duplicate_webhook_and_message_do_not_create_extra_rows(self):
        self.message()
        self.event('e1', 'edited', 100, 'ใหม่')
        with self.assertRaises(sqlite3.IntegrityError):
            self.event('e1', 'edited', 100, 'ใหม่')
        with self.assertRaises(sqlite3.IntegrityError):
            self.message()
        self.assertEqual(self.current()['version_count'], 2)

    def test_incomplete_or_unknown_event_is_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.event('missing', 'edited', 100)
        with self.assertRaises(sqlite3.IntegrityError):
            self.event('unknown', 'deleted', 100)


if __name__ == '__main__':
    unittest.main()
