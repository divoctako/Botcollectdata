# LINE Archive

โปรแกรมบันทึกข้อความตัวอักษรจากกลุ่ม LINE ลง Google Sheets ทันที พร้อมหน้า frontend ภาษาไทยบน Cloudflare Workers

## สถานะ

**วิธีติดตั้งหลักที่ผู้ใช้เลือก:** [เชื่อม GitHub กับ Cloudflare ผ่านหน้าเว็บ](docs/deploy-github.md) จาก repository [divoctako/Botcollectdata](https://github.com/divoctako/Botcollectdata) ใช้ build อัตโนมัติและไม่ต้องเปิด Terminal ตั้งค่า D1, Google/LINE และ secrets ผ่าน Dashboard ตามคู่มือ

ทางเลือกเดิม: [คัดลอกไฟล์รวมลง Dashboard](release/DEPLOY-CLICK.md) มี [หน้าสุ่ม secrets ในเครื่อง](release/generate-secrets.html) ให้ด้วย ชุดติดตั้งสร้างตาราง D1 บนฐานว่างให้เองเมื่อเปิดครั้งแรก ไม่ต้องรัน SQL

Source code อยู่บน GitHub แล้ว คู่มือหลักอัปเดตวันที่ 6 พฤศจิกายน 2026 ใช้ GitHub → Cloudflare Workers Builds โดยตั้งค่าทั้งหมดผ่านหน้าเว็บ ตรวจ deployment จริงและการเชื่อม LINE/Google ตามขั้นตอนในคู่มือก่อนเริ่มรับข้อมูลจริง

| ช่องใน Cloudflare Builds | ค่า |
| --- | --- |
| Worker name | botcollectdata |
| Production branch | main |
| Root directory | ราก repository |
| Build command | npm run build:github |
| Deploy command | npm run deploy:github |
| Build variable NODE_VERSION | 22 |

ก่อนกด Deploy ต้องใส่ Database ID จริงใน wrangler.github.jsonc บน GitHub ส่วน APP_URL, OWNER_EMAIL และรหัสลับให้ตั้งเป็น runtime Variables/Secrets ใน Cloudflare ตาม [คู่มือหลัก](docs/deploy-github.md)

**ข้อจำกัดที่ยังไม่ผ่านเป้าหมาย:** แบบ D1 ปัจจุบันมีการเขียนหลายแถวต่อข้อความ รวมการกันซ้ำ พิกัดแถว การยืนยันส่ง และการล้าง cache จึงคาดว่าจะเกิน D1 Free ที่ 100,000 แถวเขียน/วันเมื่อใช้งาน 10,000 ข้อความ/วันต่อเนื่อง แม้ Workers จะยังรับจำนวนคำขอได้ โปรแกรมไม่อัปเกรดแผนหรือคิดเงินอัตโนมัติ แต่เมื่อโควตาหมดอาจรับข้อความไม่ได้ ต้องปรับเส้นทางจัดเก็บเพื่อลดการเขียนหรือทบทวนเพดานปริมาณก่อนใช้งานตามเป้าเต็มรูปแบบ

## สิ่งที่ทำได้

- รับเฉพาะข้อความตัวอักษรจากกลุ่มที่มีบอต ไม่เก็บภาพ ไฟล์ เสียง หรือแชทส่วนตัว
- ตรวจ HMAC-SHA256 ของ LINE ก่อนอ่านเหตุการณ์
- เก็บรหัสกลุ่ม/ข้อความ/ผู้ส่ง ชื่อผู้ส่ง วันเวลาไทย เนื้อหา และข้อความที่ตอบกลับเมื่อ LINE ส่งมาให้
- หนึ่งแถวหลักต่อหนึ่งข้อความ อัปเดตฉบับล่าสุดและสถานะในแถวเดิม เก็บทุกเหตุการณ์ในแท็บประวัติของกลุ่มแยกต่างหาก
- ข้อความที่ยกเลิกส่งยังอยู่พร้อมสถานะ `unsent` ตามข้อกำหนดผู้ใช้
- สร้างโฟลเดอร์ `LINE Archive` ใน My Drive ไฟล์สารบัญ และไฟล์รายเดือนของบัญชีเจ้าของโดยอัตโนมัติ
- สร้างแท็บเมื่อบอตเข้ากลุ่มหรือมีข้อความแรก หลังเชื่อมต่อ Google สำเร็จ การเตรียมไฟล์ครั้งแรกอาจทยอยต่อหลายรอบเพื่อรักษาโควตา
- บันทึก D1 ก่อนตอบรับ webhook แล้วเริ่มส่งชีตทันทีในคำขอเบื้องหลังแยก invocation ไม่รอรอบรายวัน
- เก็บพิกัดก่อนเรียก Google การเขียนข้อความหลักและประวัติอยู่ใน batch เดียว ลองใหม่ที่แถวเดิมเมื่อคำตอบ Google หาย
- หน้าเว็บล็อกอินด้วย Google เฉพาะ OWNER_EMAIL แสดงกลุ่ม รายการค้าง ข้อผิดพลาด และลิงก์ชีต
- ปุ่มรีเฟรชสถานะและปุ่มลองส่งรายการค้าง Cron ทุกนาทีสำหรับงานกู้คืน/ดูแลข้อมูล ไม่มีรอบส่งข้อความเวลา 08:00 น.
- ล้าง cache ที่ส่งสำเร็จเกิน 7 วันแบบทยอย ข้อมูลยังไม่สำเร็จและพิกัดที่ใช้กู้คืนจะไม่ถูกลบทิ้ง
- ล้างข้อมูลในชีตที่เกิน 365 วันแบบทยอย และย้ายไฟล์เดือนที่หมดอายุทั้งเดือนไปถังขยะ Drive ไม่เลื่อนแถวเพื่อรักษาพิกัด

## ลองหน้าจอโดยไม่ใช้บัญชีจริง

ต้องมี Node.js 22.13 ขึ้นไป (ทดสอบด้วย Node 26) และ npm

```powershell
npm install
npm run preview:demo
```

เปิด http://127.0.0.1:8788 เป็นข้อมูลตัวอย่างเฉพาะหน้าจอ ไม่เชื่อม API และไม่บันทึกข้อความจริง เซิร์ฟเวอร์นี้ฟังเฉพาะ loopback และไม่อยู่ใน Worker ที่ deploy

## รัน Worker ในเครื่อง

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars
npm run db:local
npm run dev
```

เปิด http://localhost:8787 เพื่อให้ตรงกับ APP_URL และ OAuth redirect URI กรอก secrets ใน `.dev.vars` เฉพาะเครื่อง ห้าม commit ไฟล์นี้และห้ามส่งรหัสลับลงแชท

หาก sandbox ของเครื่องไม่ให้ Wrangler เขียน config/log ในโปรไฟล์ผู้ใช้ สามารถเปลี่ยนตำแหน่งเฉพาะ shell นี้ก่อนรันคำสั่งได้:

```powershell
$env:XDG_CONFIG_HOME = Join-Path (Get-Location) '.wrangler/config'
$env:WRANGLER_LOG_PATH = Join-Path (Get-Location) '.wrangler/logs'
$env:WRANGLER_SEND_METRICS = 'false'
```

## วิธีเดิมสำหรับผู้พัฒนาที่ใช้ Terminal

วิธีที่ผู้ใช้เลือกปัจจุบันคือ [เชื่อม GitHub กับ Cloudflare ผ่านหน้าเว็บ](docs/deploy-github.md) ส่วนวิธีเดิมด้านล่างเก็บไว้สำหรับงานพัฒนาเท่านั้น

<details>
<summary>แสดงวิธีเดิมผ่าน Wrangler / PowerShell</summary>

## คู่มือ deploy ขึ้น Cloudflare แบบละเอียด

ลำดับนี้ใช้ PowerShell บน Windows และ deploy ผ่าน Wrangler จากโปรเจกต์เดิม ไม่ต้องใช้ GitHub ไม่ต้องอัปโหลดโฟลเดอร์ dist เอง และไม่ต้องซื้อโดเมนเพื่อเริ่มทดสอบ

สิ่งที่จะได้คือ frontend กับ backend ใน Worker เดียว, ฐานข้อมูล D1 หนึ่งฐาน, Cron สำหรับลองส่งใหม่/ดูแลข้อมูล และไฟล์ประวัติใน Google Drive ของคุณ หน้า localhost:8788 เป็น demo เท่านั้น ไม่ใช่ระบบออนไลน์

**ขอบเขตรุ่นปัจจุบัน:** เริ่มทดสอบกับกลุ่มเล็กได้หลังตั้งค่าครบ แต่ยังไม่ผ่านข้อกำหนด 10,000 ข้อความ/วันบน D1 ฟรี ไม่ควรเชิญครบ 50 กลุ่มก่อนแก้ข้อจำกัดปริมาณนี้ การหมดโควตาอาจทำให้รับข้อความไม่ได้และการส่งซ้ำจาก LINE ไม่ใช่การกู้ประวัติย้อนหลังทั้งหมด

### ขั้นที่ 1 — เตรียมบัญชีและเครื่อง

ต้องมีบัญชี Cloudflare, Google ที่จะเป็นเจ้าของชีต และ LINE Official Account ที่คุณเป็นผู้ดูแล หากยังไม่มี LINE OA ให้สร้างตามขั้นที่ 7

เปิด PowerShell แล้วตรวจเวอร์ชัน:

```powershell
Set-Location -LiteralPath 'D:\BOT เก็บข้อมูล'
node --version
npm --version
```

โปรเจกต์ต้องการ Node.js 22.13 ขึ้นไป ติดตั้ง dependencies ตาม lockfile:

```powershell
npm ci
npm test
npm run build
```

ควรเห็น tests ผ่านและ Wrangler แสดง `--dry-run: exiting now.` คำสั่ง build นี้ยังไม่เผยแพร่เว็บ ถ้าต้องการตรวจ schema Python ด้วยให้รัน `npm run check` ซึ่งต้องมี Python 3

### ขั้นที่ 2 — เชื่อม Wrangler กับบัญชี Cloudflare

เปิด [Cloudflare Dashboard](https://dash.cloudflare.com/) และใช้บัญชีที่ต้องการเป็นเจ้าของระบบ เลือก Workers Free สำหรับการทดสอบนี้

```powershell
npx wrangler login
npx wrangler whoami
```

คำสั่งแรกจะเปิดเบราว์เซอร์เพื่อให้เข้าสู่ระบบและอนุญาต Wrangler คำสั่งที่สองใช้ตรวจบัญชี หากมีหลายบัญชีให้เลือกบัญชีเดียวกันทุกขั้นตอน สามารถกำหนด `account_id` ระดับบนสุดของ wrangler.jsonc ให้ตรงกับบัญชีนั้นได้

ไม่ต้องสร้าง Worker เปล่าใน Dashboard ล่วงหน้า ชื่อ Worker ในโปรเจกต์คือ `botcollectdata`

### ขั้นที่ 3 — สร้างฐานข้อมูล D1 จริง

```powershell
npx wrangler d1 create line-chat-archive
```

คัดลอก database_id ที่คำสั่งคืนมา แล้วเปิดไฟล์:

```powershell
notepad .\wrangler.jsonc
```

แก้เฉพาะ database_id ใน d1_databases โดยคง binding ชื่อ DB และชื่อฐานข้อมูลเดิมไว้ ตัวอย่างค่า ID ด้านล่างเป็นตำแหน่งให้แทน ไม่ใช่ ID จริง:

```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "line-chat-archive",
  "database_id": "ใส่-UUID-จริง-จาก-Cloudflare",
  "migrations_dir": "migrations"
}]
```

ใน vars เปลี่ยน OWNER_EMAIL เป็นอีเมล Google เจ้าของที่จะใช้ล็อกอิน เช่น:

```jsonc
"OWNER_EMAIL": "yourname@gmail.com"
```

อย่าลบ main, assets, compatibility_flags หรือ triggers ที่มีอยู่ จากนั้นสร้างตารางบนฐานข้อมูลจริง:

```powershell
npm run db:remote
npx wrangler d1 migrations list line-chat-archive --remote
```

ควรเห็น migrations 0001–0003 ถูกนำไปใช้สำเร็จ และไม่มี migration ค้าง คำสั่ง `npm run db:local` สร้างเฉพาะฐานข้อมูลในเครื่อง ใช้แทน db:remote ไม่ได้

ถ้าฐานข้อมูลชื่อนี้มีอยู่แล้วในบัญชี ให้ตรวจ `npx wrangler d1 list` และยืนยันว่าเป็นฐานของโปรเจกต์นี้ก่อนใช้ ID เดิม ไม่ต้องสร้างฐานซ้ำ

### ขั้นที่ 4 — Deploy รอบแรกเพื่อรับ URL จริง

```powershell
npm run deploy
```

หากยังไม่ได้ตั้ง workers.dev subdomain ให้ตั้งตามหน้าจอหรือ Dashboard ที่ Workers & Pages เมื่อ deploy สำเร็จ terminal จะแสดง URL รูปแบบ:

```text
https://botcollectdata.your-subdomain.workers.dev
```

ใช้ URL ที่คำสั่งคืนมาจริง ไม่คัดลอก your-subdomain จากตัวอย่างไปใช้ หน้าเว็บรอบแรกจะแจ้งว่ายังไม่ได้ตั้งค่า Google/LINE เป็นอาการปกติในขั้นนี้ ยังไม่ต้องเชิญบอตเข้ากลุ่ม

### ขั้นที่ 5 — ตั้ง APP_URL ให้ตรงกับเว็บออนไลน์

กลับไปแก้ vars ใน wrangler.jsonc ให้ตรงกับ URL รอบแรก:

```jsonc
"vars": {
  "APP_URL": "https://botcollectdata.your-subdomain.workers.dev",
  "OWNER_EMAIL": "yourname@gmail.com",
  "ARCHIVE_NAMESPACE": "line-chat-archive-production",
  "RETENTION_DAYS": "365",
  "CACHE_DAYS": "7"
}
```

APP_URL ต้องเป็น HTTPS, ไม่มี path และไม่มี `/` ท้าย URL หากคง localhost ไว้ การล็อกอิน ปุ่มลองส่งใหม่ และงาน Cron ที่เรียก API ภายในจะทำงานผิดปลายทาง

ARCHIVE_NAMESPACE ใช้แยกไฟล์ Drive ของระบบจริงกับระบบทดสอบ ตัวอย่าง .dev.vars ใช้ local-development อย่าใช้ namespace เดียวกันกับคนละ D1 หรือคนละโปรเจกต์ และอย่าเปลี่ยนค่า production ไปมาเมื่อเริ่มมีข้อมูลแล้ว

บันทึกไฟล์แล้ว deploy ค่าใหม่:

```powershell
npm run deploy
```

### ขั้นที่ 6 — สร้าง Google Cloud project และ OAuth

เปิด [Google Cloud Console](https://console.cloud.google.com/) ด้วยบัญชีเจ้าของชีต

1. สร้างหรือเลือก project สำหรับ LINE Archive จดชื่อ project ไว้เพื่อให้ตั้งค่า API และ OAuth อยู่ project เดียวกัน
2. ไปที่ APIs & Services → Library ค้นหา **Google Sheets API** แล้วกด Enable
3. ค้นหา **Google Drive API** แล้วกด Enable เช่นกัน
4. ไปที่ **Google Auth platform** หากยังไม่เคยตั้งค่าให้กด Get started
5. ตั้งชื่อแอป LINE Archive, support email และ contact email เป็นบัญชีที่คุณดูแล เลือก Audience เป็น External สำหรับบัญชี Gmail ส่วนตัว อ่านและยอมรับเงื่อนไขที่ Google แสดงด้วยตัวเอง
6. ใน Audience → Test users เพิ่มอีเมลเดียวกับ OWNER_EMAIL แล้ว Save ระหว่างทดสอบให้ใช้บัญชีนี้เท่านั้น
7. ใน Data Access → Add or remove scopes เลือกสิทธิ์ด้านล่างที่ตรงกับโค้ด แล้วบันทึก

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/drive.file
```

ตัวโค้ดส่ง scope แบบ `openid email profile` ซึ่งสอดคล้องกับสิทธิ์ระบุตัวตนข้างต้น ส่วน drive.file ให้แอปจัดการไฟล์ที่แอปสร้างหรือได้รับสิทธิ์ ไม่ต้องเปิด Google Drive ทั้งบัญชี และไม่ต้องแชร์ชีตเป็นสาธารณะ

จากนั้นสร้าง OAuth client:

1. ไปที่ Google Auth platform → Clients → Create client
2. เลือก Application type เป็น **Web application** ตั้งชื่อ เช่น LINE Archive Cloudflare
3. ใน **Authorized redirect URIs** เพิ่ม URL จริงของคุณต่อท้ายด้วย `/auth/callback`:

```text
https://botcollectdata.your-subdomain.workers.dev/auth/callback
```

4. หากต้องทดสอบ Worker ในเครื่องด้วย ให้เพิ่ม `http://localhost:8787/auth/callback` เป็นอีกหนึ่งรายการ หน้า demo พอร์ต 8788 ไม่ได้ใช้ OAuth จึงไม่ต้องเพิ่ม
5. โค้ดนี้แลก token ฝั่ง server ไม่ต้องตั้ง Authorized JavaScript origins เพื่อให้ flow นี้ทำงาน การตั้ง origins อย่างเดียวใช้แทน redirect URI ไม่ได้
6. กด Create เก็บ **Client ID** และ **Client secret** อย่างปลอดภัย เพื่อนำไปตั้ง GOOGLE_CLIENT_ID และ GOOGLE_CLIENT_SECRET ในขั้นที่ 8 ไม่ใช้ API key หรือ service-account JSON แทนสองค่านี้

**เรื่อง token อายุ 7 วัน:** Google OAuth ที่เป็น External และยังมี publishing status = Testing พร้อม Drive scope จะได้ refresh token อายุ 7 วัน หากต้องการรันทดสอบต่อให้เชื่อมต่อ Google ใหม่เมื่อหมดอายุ หากต้องการใช้งานต่อเนื่องให้ตรวจและดำเนินการด้าน publishing/verification ตามที่ Google กำหนดก่อน ไม่ถือว่าการ deploy Worker ทำให้ผ่าน verification หรือทำให้ token ไม่มีวันหมดอายุ

### ขั้นที่ 7 — เตรียม LINE Official Account

1. เปิด [LINE Official Account Manager](https://manager.line.biz/) และสร้างหรือเลือก OA สำหรับบอตนี้
2. ไปที่ Settings → Messaging API แล้วเปิดใช้งาน เลือก provider ที่ต้องการให้ถูกต้องตั้งแต่แรก
3. เปิด [LINE Developers Console](https://developers.line.biz/console/) แล้วเลือก Messaging API channel ของ OA นั้น
4. ใน Basic settings หา **Channel secret** เก็บไว้สำหรับ LINE_CHANNEL_SECRET
5. ใน Messaging API หา Channel access token ออก token ตามชนิดที่บัญชีรองรับ สำหรับเริ่มทดสอบแบบคงค่าที่โค้ดนี้ใช้ สามารถใช้ long-lived token จาก Console ได้เมื่อมีตัวเลือกนี้ เก็บไว้สำหรับ LINE_CHANNEL_ACCESS_TOKEN อย่าใช้ Channel ID แทน token
6. เปิด **Allow bot to join group chats**
7. ถ้าไม่ต้องการให้ OA พูดเอง ให้ปิด Greeting messages และ Auto-reply messages ในการตั้งค่า OA โปรแกรมนี้ไม่มีคำสั่ง reply/push ของตัวเอง

สองค่าต้องมาจาก channel เดียวกันกับ OA ที่จะเชิญเข้ากลุ่ม LINE แนะนำ token แบบ v2.1 สำหรับงานจริงด้วย แต่รุ่นนี้ยังไม่มีการออก/ต่ออายุ token ให้อัตโนมัติ หากใช้ token แบบหมดอายุต้องวางแผนเปลี่ยน Worker secret ให้ทัน

ยังไม่ต้องตั้ง webhook จนกว่าจะอัปโหลด secrets ในขั้นถัดไปเสร็จ

### ขั้นที่ 8 — สร้างรหัสภายในและอัปโหลด secrets

ค่าที่ต้องตั้งมีหกค่า:

| Secret | นำมาจากไหน |
| --- | --- |
| LINE_CHANNEL_SECRET | LINE Developers → Basic settings |
| LINE_CHANNEL_ACCESS_TOKEN | token ของ Messaging API channel |
| GOOGLE_CLIENT_ID | Google Auth platform → Clients |
| GOOGLE_CLIENT_SECRET | OAuth client เดียวกับ Client ID |
| SESSION_SECRET | ค่าสุ่มสำหรับเซ็น session และคำสั่งภายใน |
| TOKEN_ENCRYPTION_SECRET | ค่าสุ่มอีกค่าหนึ่งสำหรับเข้ารหัส refresh token |

สร้าง SESSION_SECRET บนเครื่องของคุณด้วยคำสั่งนี้ แล้วเก็บผลลัพธ์ไว้ใน password manager:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

รันอีกครั้งเพื่อสร้าง TOKEN_ENCRYPTION_SECRET ให้เป็นคนละค่า ผลลัพธ์แต่ละครั้งเป็นรหัสลับจริง ไม่ใช่ตัวอย่างสำหรับโพสต์ลงแชท

จากโฟลเดอร์โปรเจกต์ รันทีละคำสั่ง Wrangler จะถามค่าที่จะใส่:

```powershell
npx wrangler secret put LINE_CHANNEL_SECRET
npx wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET
npx wrangler secret put TOKEN_ENCRYPTION_SECRET
npx wrangler secret list
```

ตรวจว่ารายชื่อครบทั้งหก ไม่มีช่องว่างหรือเครื่องหมายคำพูดติดหน้าหลังค่าที่วาง คำสั่ง secret put เปลี่ยนเวอร์ชันและ deploy secret ทันที ส่วน secret list แสดงรายชื่อ ไม่แสดงค่ารหัสลับ

**.dev.vars ใช้เฉพาะเครื่อง:** ถึงแม้กรอกครบแล้ว ไฟล์นี้ก็ไม่ได้ถูกอัปโหลดเป็น Worker secrets อัตโนมัติ อย่ากรอก secrets ลง vars ใน wrangler.jsonc และไม่ต้องตั้ง GOOGLE_REFRESH_TOKEN เอง โค้ดจะรับและเข้ารหัส token หลังคุณล็อกอินสำเร็จ

### ขั้นที่ 9 — Deploy ชุดสุดท้ายและเชื่อม Google

```powershell
npm test
npm run build
npm run deploy
```

เปิด URL Worker จริง กด **เข้าสู่ระบบด้วย Google** เลือกบัญชีเดียวกับ OWNER_EMAIL อนุญาตสิทธิ์ไฟล์ที่แอปขอ เมื่อสำเร็จควรกลับมาที่ dashboard ได้

ยังไม่ต้องสร้าง spreadsheet หรือกรอก spreadsheet ID เอง แอปสร้างโฟลเดอร์ LINE Archive, ไฟล์สารบัญ และไฟล์รายเดือนใน My Drive ของบัญชีที่เชื่อม เมื่อเริ่มเตรียมกลุ่ม/รับข้อความ

หาก Google ปฏิเสธบัญชีหรือขอข้อมูล publishing/verification ให้แก้ที่ project ของคุณตามข้อความที่แสดงก่อน ไม่ใช้การปิดระบบยืนยันตัวตนของแอปเพื่อแก้ปัญหา

### ขั้นที่ 10 — ตั้ง LINE webhook และเชิญบอตเข้ากลุ่มทดสอบ

ใน LINE Developers → Messaging API ตั้ง Webhook URL เป็น:

```text
https://botcollectdata.your-subdomain.workers.dev/webhooks/line
```

กด Update → Verify ควรเห็น Success จากนั้นเปิด **Use webhook** และ **Webhook redelivery** เมื่อมีตัวเลือก แนะนำเริ่มจากกลุ่มทดสอบเพียงหนึ่งกลุ่ม

เพิ่ม OA เป็นเพื่อนใน LINE แล้วเชิญเข้ากลุ่ม แต่ละกลุ่มมี LINE Official Account ได้หนึ่งบัญชีในเวลาเดียวกัน หากมี OA อื่นอยู่ต้องจัดการกลุ่มนั้นก่อน

ส่งข้อความตัวอักษรใหม่ เช่น `ทดสอบเก็บข้อมูล 001` แล้วตรวจ:

1. frontend แสดงกลุ่มและรหัสกลุ่ม
2. รายการค้างลดลงหลังส่งลงชีตสำเร็จ การเตรียมไฟล์ครั้งแรกอาจใช้หลายรอบเล็ก
3. Google Drive มีโฟลเดอร์ LINE Archive พร้อมสารบัญและไฟล์เดือนปัจจุบัน
4. แท็บหลักมี group_id, message_id, sender_id, sender_display_name, เวลาไทย, original_text/current_text และสถานะ
5. ส่งข้อความโดยอ้างตอบกลับ แล้วดู replied_to_message_id ถ้า LINE ส่งข้อมูลนี้มา
6. แก้ไขข้อความเดิมเมื่อบัญชี/แอปรองรับ: แถวหลักยังเป็นแถวเดิม เนื้อหาล่าสุดเปลี่ยน และมีประวัติเพิ่ม
7. ยกเลิกส่งข้อความทดสอบ: เนื้อหาเดิมยังอยู่และสถานะเป็น unsent ตามข้อกำหนดของโครงการ

การส่งเข้าหาบอตแบบแชทส่วนตัวหรือส่งรูปจะไม่เพิ่มแถว เพราะรุ่นนี้เก็บเฉพาะตัวอักษรในกลุ่ม และไม่สามารถดึงข้อความก่อนบอตเข้ากลุ่มย้อนหลังได้

### ขั้นที่ 11 — ตรวจงานเบื้องหลังและการดูแล

Cloudflare Dashboard → Workers & Pages → botcollectdata → Settings → Triggers/Cron Triggers ควรมี `* * * * *` ตาม wrangler.jsonc ซึ่งเรียกทุกนาทีเพื่อส่งรายการที่ค้างและดูแลอายุข้อมูล ไม่มีรอบส่งข้อความเวลา 08:00 น. แล้ว

Cron บางการเปลี่ยนแปลงอาจใช้เวลาทยอยมีผล ให้ตรวจตามเอกสาร Cloudflare และสถานะจริง อย่าตัดสินจากการ deploy เสร็จเพียงอย่างเดียว

หากต้องดู runtime log ระหว่างทดสอบ:

```powershell
npx wrangler tail botcollectdata
```

กด Ctrl+C เมื่อเลิกดู การปิด tail ไม่หยุด Worker ออนไลน์ ดูจำนวนรายการค้างและข้อผิดพลาดบน dashboard ควบคู่กัน

ไม่ต้องเปิดคอมค้างหลัง deploy Worker และ Cron รันบน Cloudflare ส่วน demo ในเครื่องจะหยุดเมื่อปิด process ของ demo

### ปัญหาที่พบบ่อย

| อาการ | จุดตรวจและวิธีแก้ |
| --- | --- |
| Google ขึ้น redirect_uri_mismatch | APP_URL และ Authorized redirect URI ต้องเป็น URL Worker จริงเดียวกัน ต่อด้วย /auth/callback; ตรวจ http/https และ / ท้าย URL |
| Google ไม่ให้บัญชีทดสอบเข้า | เพิ่มอีเมลเป็น Test user ใน project ที่ออก Client ID และเลือกอีเมลเดียวกับ OWNER_EMAIL |
| แอปแจ้งบัญชีไม่ได้รับอนุญาต | OWNER_EMAIL ไม่ตรงกับ Google ที่เลือก แก้ config แล้ว deploy ใหม่ หรือเข้าสู่ระบบด้วยบัญชีเจ้าของ |
| ไม่เห็นปุ่มล็อกอิน | ตรวจ Google secrets, OWNER_EMAIL, SESSION_SECRET และ TOKEN_ENCRYPTION_SECRET ซึ่งสองค่าหลังต้องยาวอย่างน้อย 32 อักขระ |
| เกิด no such table | ยังไม่ได้ npm run db:remote หรือ binding DB ชี้คนละฐาน; db:local ไม่แก้ฐานออนไลน์ |
| LINE Verify ได้ 401 | Channel secret ไม่ตรงกับ channel ที่ส่ง webhook; ตั้ง LINE_CHANNEL_SECRET ใหม่ |
| เปิด webhook ใน browser แล้ว 404 | เป็น GET แต่ endpoint รับ POST ให้ทดสอบด้วยปุ่ม Verify ของ LINE แทน |
| webhook ได้ 302 หรือหน้า Cloudflare login | มี Access/login gate ครอบ endpoint ทำให้ LINE เรียกไม่ได้; endpoint webhook และ internal drain ต้องเข้าถึงตามการตรวจลายเซ็นของโค้ด ไม่ใช้หน้า login ครอบทั้งหมด |
| webhook Success แต่ไม่เห็นข้อความ | เปิด Use webhook, เชื่อม Google, เชิญบอตเข้ากลุ่มและส่งตัวอักษรใหม่ ตรวจว่าไม่ใช่แชทส่วนตัว/รูปภาพ |
| ไม่สามารถเชิญ OA เข้ากลุ่ม | เปิด Allow bot to join group chats และตรวจว่ากลุ่มไม่มี OA อื่นอยู่ |
| ค้างที่ Google API 403 | ตรวจเปิด Drive/Sheets API, สิทธิ์ drive.file และบัญชีเจ้าของ; อ่านสถานะใน Google Cloud ประกอบก่อนเชื่อมใหม่ |
| เคยใช้ได้แล้ว Google token ใช้ไม่ได้ | Testing refresh token อาจหมดอายุ 7 วัน หรือสิทธิ์ถูกถอน กดเชื่อมต่อ Google ใหม่บน frontend |
| ปุ่มลองส่งขึ้นคำขอไม่ได้มาจากเว็บนี้ | URL ที่เปิดไม่ตรง origin ของ APP_URL หรือยังไม่ได้ deploy ค่า APP_URL ใหม่ |
| งานเบื้องหลังไม่เดิน | ตรวจ APP_URL, secrets, Cron และ log scheduled_job_failed/sync_dispatch_failed รวมถึงโควตา Workers/D1 |
| D1 quota exceeded หรือ Worker resource limit | หยุดเพิ่มปริมาณและตรวจ usage ข้อจำกัดปริมาณฟรีของรุ่นนี้ยังไม่ได้แก้ การกด retry รัวไม่ช่วยเพิ่มโควตา |

### อัปเดตโปรแกรมครั้งต่อไป

```powershell
Set-Location -LiteralPath 'D:\BOT เก็บข้อมูล'
npm ci
npm test
npm run build
```

ตรวจว่ามี migration ใหม่หรือไม่ ก่อนใช้กับฐานจริงควรสำรอง D1 แล้วจึง apply และ deploy:

```powershell
npx wrangler d1 export line-chat-archive --remote --output .\line-archive-backup.sql
npm run db:remote
npm run deploy
```

ไฟล์ backup มีข้อมูลแชทและค่า refresh token ที่เข้ารหัส ไม่แชร์หรือ commit ไฟล์นี้ ย้ายไปที่เก็บสำรองส่วนตัวที่ปลอดภัย ไม่ต้องสร้าง D1 หรือออก secrets ใหม่ทุกครั้ง และอย่าเปลี่ยน TOKEN_ENCRYPTION_SECRET โดยไม่มีแผนเชื่อม Google ใหม่

คู่มือนี้เป็นขั้นตอนให้ดำเนินการ ยังไม่ได้รันคำสั่งสร้างฐานจริง อัปโหลด secrets หรือ deploy แทนคุณในการเขียนคู่มือครั้งนี้

</details>

## การตรวจสอบ

```powershell
npm run check
npm run build
```

- Node tests ใช้ SQLite จริงในหน่วยความจำและจำลองเฉพาะ Google/LINE HTTP สำหรับกรณีเครือข่ายล้มเหลว
- Python tests ตรวจ schema หลัก (ต้องมี Python 3)
- build เป็น Wrangler dry-run ไม่มีการเผยแพร่
- การทดสอบในเครื่องยังไม่ใช่การยืนยัน Google OAuth consent จริง เครือข่าย LINE จริง CPU บน edge หรือโควตาใช้งานเต็มวัน

## ดูแลระบบ

- `/api/status`: สถานะและลิงก์ชีต เฉพาะเจ้าของ; ผู้ไม่ล็อกอินได้เพียงสถานะว่าตั้งค่าแล้วหรือไม่
- `/api/retry`: POST จาก frontend ของเจ้าของเท่านั้น เริ่มลองส่งข้อมูลค้างใหม่
- `/api/internal/drain`: งานย่อยที่ตรวจลายเซ็นภายใน ไม่ต้องเรียกเอง
- Cron ทุกนาทีส่งข้อมูลค้างทีละชุดเล็กและดูแลอายุข้อมูล งานดูแลข้อมูลอาจล่าช้าขณะมี backlog หรือบริการภายนอกขัดข้อง ให้ตรวจ lastMaintenanceAt และข้อผิดพลาดบน frontend
- อย่าลบ/ย้ายแถวหรือเปลี่ยนชื่อแท็บที่โปรแกรมจัดการเอง เพราะพิกัดใช้ป้องกันการเขียนซ้ำ ถ้าต้องวิเคราะห์หรือจัดรูปแบบใหม่ให้ทำสำเนาหรือใช้ไฟล์วิเคราะห์แยก
- การล้างข้อมูลนี้ครอบคลุมข้อมูลที่แอปแสดงในชีตและ cache ไม่ได้ลบประวัติเวอร์ชัน/ระบบสำรองของผู้ให้บริการ Google; ไฟล์ที่หมดอายุย้ายเข้าถังขยะตามปกติของ Drive
- เก็บสำรอง D1 และ secrets ก่อนเปลี่ยนบัญชี/โปรเจกต์ การเปลี่ยน TOKEN_ENCRYPTION_SECRET ต้องเชื่อม Google ใหม่
- เนื้อหาที่เข้าข่ายสูตรจะเขียนเป็น `stringValue` ไม่ให้ Google Sheets ประมวลผลเป็นสูตร

## วิเคราะห์ด้วย AI ผ่านแชท

อ่านเฉพาะกลุ่มและช่วงเวลาที่ต้องการจากชีตหลัก ใช้ group_id + message_id เป็นตัวนับหนึ่งข้อความ ใช้ current_text สำหรับเนื้อหาล่าสุด และกรอง message_status = unsent ออกจากสรุปบทสนทนาปัจจุบันโดยปริยาย หากต้องการวิเคราะห์ประวัติหรือข้อความยกเลิกส่งให้ระบุแยกและใช้แท็บประวัติ ไม่รวมประวัติทุกฉบับเข้ากับจำนวนข้อความหลัก

ยังไม่มี AI API หรือการวิเคราะห์อัตโนมัติในบอต คุณนำไฟล์ที่สร้างแล้วมาให้อ่านผ่านเครื่องมือ Google Drive/Sheets ในแชทได้ตามสิทธิ์บัญชี

## เอกสาร

- [แบบระบบ](docs/system-design.md)
- [ข้อกำหนด](docs/requirements.md)
- [โครงสร้างข้อมูล](docs/data-model.md)

แหล่งอ้างอิง: [Cloudflare D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Google OAuth token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [LINE webhook signature](https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/)
