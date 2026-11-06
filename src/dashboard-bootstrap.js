const ready = new WeakMap();
const requiredTables = ['messages', 'message_events', 'settings', 'chat_groups',
  'member_profiles', 'workbooks', 'sheet_targets', 'sheet_rows', 'leases'];

async function initialized(db) {
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r) => r.name);
  if (!tables.includes('settings')) return false;
  const marker = await db.prepare("SELECT value FROM settings WHERE key='dashboard_schema_version'").first();
  if (marker?.value === '3' && requiredTables.every((name) => tables.includes(name))) return true;
  return false;
}

async function initialize(db, statements) {
  if (await initialized(db)) return;
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map((r) => r.name);
  if (requiredTables.some((name) => tables.includes(name))) {
    // Never guess migrations or overwrite a partially configured/existing DB.
    throw new Error('ฐานข้อมูลนี้มีตารางอยู่แล้วแต่ไม่ใช่ชุด Dashboard ที่พร้อมใช้ กรุณาเลือกฐาน D1 ใหม่ที่ว่าง โดยไม่ลบข้อมูลเดิม');
  }
  try {
    await db.batch([
      ...statements.map((sql) => db.prepare(sql)),
      db.prepare("INSERT INTO settings(key,value) VALUES ('dashboard_schema_version','3')"),
    ]);
  } catch (error) {
    // Concurrent cold starts: one atomic batch wins, the other can adopt it.
    if (!await initialized(db)) throw error;
  }
}

export async function ensureDashboardDatabase(db, statements) {
  if (!db?.prepare) throw new Error('ยังไม่ได้เชื่อม D1 binding ชื่อ DB ในหน้า Bindings ของ Worker');
  let pending = ready.get(db);
  if (!pending) {
    pending = initialize(db, statements);
    ready.set(db, pending);
  }
  try { await pending; }
  catch (error) { ready.delete(db); throw error; }
}
