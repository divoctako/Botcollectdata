# เชื่อม GitHub กับ Cloudflare โดยไม่เปิด Terminal

Repository: https://github.com/divoctako/Botcollectdata

แนวทางนี้ให้ Cloudflare ดึงโค้ดจาก GitHub แล้ว build/deploy เอง คุณตั้งค่าผ่านหน้าเว็บ ไม่ต้องติดตั้ง Node.js หรือคัดลอก worker.js ลง Edit code หลังเชื่อมแล้ว การ commit ลง main จะสั่ง build ใหม่

## 1. สร้าง D1 และใส่ ID ผ่าน GitHub

1. เข้า [Cloudflare Dashboard](https://dash.cloudflare.com/) → Storage & databases → D1 SQL Database
2. Create database ชื่อ `line-chat-archive-dashboard` ใช้ฐานใหม่ที่ว่างสำหรับชุดติดตั้งนี้
3. เปิดรายละเอียดฐานแล้วคัดลอก Database ID
4. เปิด [wrangler.github.jsonc บน GitHub](https://github.com/divoctako/Botcollectdata/blob/main/wrangler.github.jsonc)
5. กดรูปดินสอ Edit เปลี่ยน database_id จาก `00000000-0000-0000-0000-000000000000` เป็น ID จริง แล้ว Commit changes ลง main
6. ถ้าฐานตั้งชื่ออื่น ให้เปลี่ยน database_name ให้ตรงด้วย คง binding ชื่อ `DB` ตามเดิม

Database ID ไม่ใช่ access token ส่วนรหัส LINE/Google ห้ามใส่ใน GitHub ถ้าเคยใช้วิธีคัดลอกไฟล์รวมและมีฐาน Dashboard ที่ทำงานแล้ว สามารถใช้ ID ของฐานชุดนั้นได้โดยเก็บ binding และ namespace เดิม ไม่สร้างฐานใหม่แทนข้อมูลเดิมโดยไม่ตั้งใจ

ฐานที่สร้างตารางด้วย CLI รุ่นเดิมและไม่มี marker ของ Dashboard จะถูกปฏิเสธโดยตัวติดตั้งอัตโนมัติ ให้ใช้ฐานว่างแยกสำหรับการเริ่มติดตั้ง ไม่ลบข้อมูลจริงเพื่อแก้ข้อผิดพลาด

## 2. เชื่อม repository กับ Workers Builds

1. Cloudflare → Workers & Pages → Create application
2. เลือก Import a repository / Connect Git และเลือก GitHub
3. อนุญาต Cloudflare GitHub App ให้เข้าถึง repository `divoctako/Botcollectdata` ตามหน้าจอที่คุณตรวจและยอมรับเอง
4. เลือก repository Botcollectdata และ branch `main`
5. ตั้ง **Worker name** เป็น `line-chat-archive` ให้ตรง name ใน wrangler.github.jsonc
6. ตั้ง Build settings ตามตารางนี้:

| ช่อง | ค่า |
| --- | --- |
| Production branch | main |
| Root directory | ราก repository (ปล่อยค่า default หรือ /) |
| Build command | npm run build:github |
| Deploy command | npm run deploy:github |
| Build variable: NODE_VERSION | 22 |

สองช่อง command เป็นคำสั่งให้ Cloudflare ทำเองบนเซิร์ฟเวอร์ ไม่ได้ให้คุณเปิด Terminal ส่วน build script จะรวมโค้ดและทดสอบก่อน deploy และไม่ต้องใช้ Python บนเครื่อง build

สำคัญ: ใช้ `deploy:github` ตามนี้ เพราะ script เลือก `wrangler.github.jsonc` และคง runtime variables ที่คุณตั้งใน Dashboard ถ้าใช้คำสั่ง deploy default จะอ่าน config สำหรับการพัฒนาอีกไฟล์ที่ยังมี placeholder

กด Deploy แล้วรอ build สำเร็จ จะได้ URL รูปแบบ `https://line-chat-archive.<your-subdomain>.workers.dev` จด URL production จริงไว้ ไม่ใช้ URL preview

ถ้ามี Worker ชื่อ line-chat-archive อยู่แล้ว ให้เข้า Worker นั้น → Settings → Builds → Connect repository และตั้งค่า Build/Deploy command ข้างต้น แทนการสร้าง Worker ชนชื่อ

อ้างอิง: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)

## 3. ตั้ง runtime variables ใน Cloudflare

เปิด Worker → Settings → Variables and Secrets เพิ่มชนิด **Text**:

| ชื่อ | ค่า |
| --- | --- |
| APP_URL | URL production จริง ไม่มี / ท้าย เช่น https://line-chat-archive.your-subdomain.workers.dev |
| OWNER_EMAIL | อีเมล Google เจ้าของที่ใช้ล็อกอิน |
| ARCHIVE_NAMESPACE | line-chat-archive-dashboard-production |
| RETENTION_DAYS | 365 |
| CACHE_DAYS | 7 |

ตั้งตรง runtime Variables and Secrets ไม่ใช่ Build variables ข้อยกเว้นคือ NODE_VERSION ซึ่งเป็น Build variable ตามขั้นก่อน

ถ้าย้ายจากวิธี Dashboard ที่มีข้อมูลอยู่แล้ว ให้คง APP_URL, OWNER_EMAIL, ARCHIVE_NAMESPACE และ D1 ID ที่ใช้งานไว้ให้ตรงระบบเดิม ไม่สร้าง namespace ใหม่โดยไม่ตั้งใจ

ไม่มี vars ใน wrangler.github.jsonc และ deploy script ใช้ keep-vars เพื่อเก็บค่าที่ตั้งผ่าน Dashboard ส่วน secrets จะอยู่ฝั่ง Cloudflare ไม่อยู่ใน repository

## 4. ตั้ง Google และ LINE ตามคู่มือหน้าเว็บ

ใช้ [ขั้นที่ 5–7 ในคู่มือแบบคลิก](../release/DEPLOY-CLICK.md):

- Google Cloud: เปิด Sheets API และ Drive API, สร้าง OAuth Web application, เพิ่ม test user ตามบัญชีเจ้าของ
- Google redirect URI: `https://<your-worker>/auth/callback`
- LINE OA: เปิด Messaging API และ Allow bot to join group chats
- เก็บ Channel secret และ Channel access token ของ OA เดียวกัน
- เปิดไฟล์ generate-secrets.html จากเครื่องด้วยเบราว์เซอร์ เพื่อสร้างรหัสภายในสองค่าที่ไม่ซ้ำกัน

เพิ่มชนิด **Secret** ใน Worker → Settings → Variables and Secrets ให้ครบ:

| Secret |
| --- |
| LINE_CHANNEL_SECRET |
| LINE_CHANNEL_ACCESS_TOKEN |
| GOOGLE_CLIENT_ID |
| GOOGLE_CLIENT_SECRET |
| SESSION_SECRET |
| TOKEN_ENCRYPTION_SECRET |

กด Save/Deploy ให้ค่ามีผล ไม่ต้องเพิ่ม secrets เหล่านี้ใน GitHub หรือใน Build variables และไม่ต้องตั้ง GOOGLE_REFRESH_TOKEN เอง

ไม่ต้องใช้ขั้นคัดลอกไฟล์เข้า Edit code ของคู่มือเดิม เพราะ GitHub Builds ทำหน้าที่ deploy โค้ดแล้ว Cron และ compatibility flag ถูกกำหนดใน wrangler.github.jsonc เช่นกัน ไม่ต้องเพิ่ม Cron ซ้ำอีกตัว

## 5. เปิดเว็บ เชื่อม Google และตั้ง webhook

1. เปิด URL production → เข้าสู่ระบบด้วย Google ด้วยบัญชี OWNER_EMAIL และอนุญาตสิทธิ์ที่แอปขอ
2. ตัวติดตั้งจะสร้าง schema อัตโนมัติบน D1 ว่างเมื่อเปิดครั้งแรก ไม่ต้องรัน SQL
3. LINE Developers → Messaging API ตั้ง Webhook URL เป็น `https://<your-worker>/webhooks/line`
4. กด Verify ให้ได้ Success แล้วเปิด Use webhook และ Webhook redelivery เมื่อมีตัวเลือก
5. เชิญบอตเข้ากลุ่มทดสอบหนึ่งกลุ่ม ส่งข้อความตัวอักษรใหม่ แล้วตรวจ dashboard และไฟล์ใน Google Drive

OAuth External ที่ยังอยู่สถานะ Testing พร้อม Drive scope มีข้อจำกัด refresh token อายุ 7 วัน อาจต้องเชื่อม Google ใหม่จนกว่าจะจัดการ publishing/verification ตามที่ Google กำหนด

## อัปเดตโปรแกรมภายหลัง

เมื่อแก้ไฟล์และ commit ลง main Cloudflare จะดึง commit ไป build และ deploy ใหม่ ดูผลใน Worker → Builds/Deployments ได้ เมื่อ build ไม่ผ่านให้ดู log โดยยังไม่เปลี่ยนฐานข้อมูลหรือออก secrets ใหม่

ไม่แก้โค้ดผ่าน Edit code ควบคู่กับ GitHub เพราะ deployment ถัดไปจะใช้โค้ดจาก repository ค่าตัวแปรและ secrets ยังคงตั้งผ่าน Dashboard ตามเดิม

## ปัญหาที่พบบ่อย

| อาการ | ตรวจอะไร |
| --- | --- |
| ไม่เห็น repository | Cloudflare GitHub App ยังไม่ได้รับสิทธิ์ repo นี้ หรือเลือก GitHub account คนละบัญชี |
| Build หา build:github ไม่พบ | Root directory ไม่ใช่ราก repo หรือ branch/commit ยังไม่ใช่ชุดล่าสุด |
| database not found หรือ ID เป็นศูนย์ | แก้ ID ใน wrangler.github.jsonc ผ่าน GitHub แล้ว commit ก่อนกด Retry build |
| Worker name ไม่ตรง config | ใช้ชื่อ line-chat-archive หรือแก้ name ใน config ให้ตรง Worker ที่ตั้งไว้ |
| ตัวแปรหายหลัง build | Deploy command ต้องเป็น npm run deploy:github ไม่ใช้ default ที่อ่าน config คนละไฟล์ |
| หน้าเว็บยังไม่ให้ล็อกอิน | ตั้ง runtime Text/Secret ให้ครบ กด Deploy และรีเฟรช production URL |
| โค้ดใช้ได้ แต่ 10,000 ข้อความ/วันชนโควตา | ข้อจำกัด D1 Free ของแบบปัจจุบันยังต้องแก้ การใช้ GitHub ไม่ได้เพิ่มโควตา |

ไฟล์ node_modules, .wrangler, .dev.vars, .env, cache, ฐานข้อมูลในเครื่อง และ backup ไม่ใช่ไฟล์ที่ต้องอัปโหลด ไม่ต้องส่งรหัสลับลงแชทเพื่อเชื่อมระบบ
