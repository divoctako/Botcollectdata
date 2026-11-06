const $ = (id) => document.getElementById(id);
const date = (value) => value ? new Intl.DateTimeFormat('th-TH', {
  timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date(Number(value))) : 'ยังไม่มีข้อมูล';
const number = (value) => new Intl.NumberFormat('th-TH').format(value || 0);
let current;
let retrying = false;
let loading = false;
function element(tag, className, text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function renderGroups() {
  const search = $('group-search').value.trim().toLocaleLowerCase();
  const groups = current.groups.filter((g) => `${g.display_name || ''} ${g.group_id}`.toLocaleLowerCase().includes(search));
  $('group-rows').replaceChildren();
  $('groups-empty').hidden = groups.length > 0;
  if (search && !groups.length) {
    $('groups-empty').querySelector('h3').textContent = 'ไม่พบกลุ่มที่ตรงกับคำค้น';
    $('groups-empty').querySelector('p').textContent = 'ลองค้นหาด้วยชื่อหรือรหัสกลุ่มอื่น';
  } else if (!groups.length) {
    $('groups-empty').querySelector('h3').textContent = 'พร้อมสำหรับกลุ่มแรกของคุณ';
    $('groups-empty').querySelector('p').textContent = 'ตั้งค่า webhook และเชิญบอตเข้ากลุ่ม LINE กลุ่มและข้อความใหม่จะแสดงที่นี่โดยอัตโนมัติ';
  }
  for (const group of groups) {
    const row = element('tr');
    const cell = element('td');
    const groupCell = element('div', 'group-cell');
    groupCell.append(element('span', 'group-avatar', (group.display_name || 'L').slice(0, 1)));
    const copy = element('div');
    copy.append(element('div', 'group-title', group.display_name || 'กลุ่ม LINE'), element('div', 'group-id', group.group_id));
    groupCell.append(copy); cell.append(groupCell); row.append(cell);
    const status = element('td');
    status.append(element('span', `status-pill${group.active ? '' : ' offline'}`, group.active ? '● เชื่อมต่อแล้ว' : 'บอตออกจากกลุ่มแล้ว'));
    row.append(status, element('td', 'subtle', number(group.pending)), element('td', 'subtle', date(group.updated_at_ms)));
    $('group-rows').append(row);
  }
}
function render(data) {
  current = data;
  $('login-panel').hidden = data.authenticated;
  $('dashboard').hidden = !data.authenticated;
  $('logout').hidden = !data.authenticated;
  $('reconnect').hidden = !data.authenticated || data.demo;
  $('connection-badge').replaceChildren(element('span', 'small-dot'), document.createTextNode(data.authenticated && data.configuration.line ? ' ระบบพร้อมรับข้อความ' : ' รอเชื่อมต่อระบบ'));
  $('last-refresh').textContent = `อัปเดตสถานะ ${date(Date.now())}`;
  if (!data.authenticated) {
    $('login-link').hidden = !data.configuration.google;
    if (!data.configuration.google) $('login-description').textContent = 'ยังไม่ได้ตั้งค่า Google OAuth และบัญชีเจ้าของ โปรดทำตาม README ในโปรเจกต์ก่อนเปิดใช้งาน ระบบยังไม่รับสิทธิ์เข้าถึงข้อมูลของคุณ';
    return;
  }
  $('group-count').textContent = number(data.groups.filter((g) => g.active).length);
  $('group-total').textContent = number(data.groups.length);
  $('synced-count').textContent = number(data.syncedEvents);
  $('pending-count').textContent = number(data.pending);
  $('pending-caption').textContent = data.failed ? `${number(data.failed)} รายการกำลังรอลองส่งใหม่` : 'ข้อความใหม่จะถูกเขียนลงชีตทันที';
  $('last-sync').textContent = date(data.lastSyncAt);
  $('sync-title').textContent = data.pending ? `มี ${number(data.pending)} รายการกำลังรอบันทึก` : 'พร้อมรับบทสนทนาใหม่';
  $('retry').disabled = retrying || !data.pending;
  $('index-link').hidden = !data.indexSpreadsheetId;
  if (data.indexSpreadsheetId) $('index-link').href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(data.indexSpreadsheetId)}`;
  renderGroups();
  $('workbook-list').replaceChildren();
  $('workbooks-empty').hidden = data.workbooks.length > 0;
  for (const workbook of data.workbooks) {
    const card = element('a', 'workbook-card');
    card.href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(workbook.spreadsheet_id)}`;
    card.target = '_blank'; card.rel = 'noopener noreferrer';
    const copy = element('div', 'file-copy');
    copy.append(element('strong', '', `LINE Archive ${workbook.month}`), element('small', '', 'ข้อความและประวัติแยกตามกลุ่ม'));
    card.append(element('span', 'file-icon', '▤'), copy, element('span', 'file-arrow', '↗'));
    $('workbook-list').append(card);
  }
  $('errors-panel').hidden = !data.errors.length;
  $('error-list').replaceChildren();
  for (const error of data.errors) {
    const item = element('li', '', error.last_error);
    item.append(element('small', '', `${error.group_id} · ลองแล้ว ${number(error.attempts)} ครั้ง · รอบถัดไป ${date(error.next_attempt_at_ms)}`));
    $('error-list').append(item);
  }
  if (data.demo) notice('โหมดตัวอย่างหน้าจอ — ข้อมูลจำลอง ไม่มีการเชื่อมต่อ LINE หรือ Google และไม่มีการบันทึกข้อมูลจริง');
  else if (!data.configuration.line) notice('ยังไม่ได้ตั้งค่า LINE Channel Secret หรือ Channel Access Token โปรดตั้งค่าก่อนเชิญบอตเข้ากลุ่ม');
  else if (data.maintenanceError) notice(`งานดูแลข้อมูลต้องตรวจสอบ: ${data.maintenanceError}`);
  else if (data.setupError) notice(`การเตรียมชีตจะลองใหม่อัตโนมัติ: ${data.setupError}`);
}
async function load() {
  if (loading) return;
  loading = true;
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'โหลดสถานะไม่สำเร็จ');
    notice(''); render(data);
  } catch (error) {
    notice(error.message || 'เชื่อมต่อระบบไม่สำเร็จ กรุณาลองอีกครั้ง');
    $('connection-badge').textContent = 'เชื่อมต่อระบบไม่สำเร็จ';
  } finally { loading = false; }
}
$('refresh').addEventListener('click', load);
$('group-search').addEventListener('input', renderGroups);
$('retry').addEventListener('click', async () => {
  retrying = true; $('retry').disabled = true;
  try {
    const response = await fetch('/api/retry', { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    notice('เริ่มลองส่งรายการค้างแล้ว ระบบจะทยอยส่งต่ออัตโนมัติ ดูผลได้จากจำนวนรายการค้าง');
    setTimeout(load, 2500);
  } catch (error) { notice(error.message || 'ลองส่งใหม่ไม่สำเร็จ'); }
  finally { retrying = false; $('retry').disabled = !current?.pending; }
});
$('logout').addEventListener('click', async () => {
  const response = await fetch('/auth/logout', { method: 'POST' });
  if (response.ok) { current = null; await load(); }
  else notice('ออกจากระบบไม่สำเร็จ กรุณาลองใหม่');
});
document.querySelectorAll('.nav-item').forEach((link) => link.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item === link));
}));
load();
setInterval(() => { if (!document.hidden && current?.authenticated) load(); }, 30_000);
