# Deploy LINE Archive ด้วยการคลิก — ไม่ใช้ Terminal

คู่มือนี้เป็นทางเลือกสำหรับคัดลอกไฟล์รวมลง Dashboard โดยตรง วิธีหลักล่าสุดที่ผู้ใช้เลือกคือ [เชื่อม GitHub กับ Cloudflare](../docs/deploy-github.md) ให้ใช้คู่มือนั้นถ้าจะให้ GitHub สั่ง build/deploy อัตโนมัติ และไม่ต้องทำขั้น Edit code หรือเพิ่ม Cron ซ้ำตามเอกสารนี้

คู่มือนี้ใช้ Cloudflare Dashboard, Google Cloud Console และ LINE Developers คุณกดตั้งค่าและ Deploy เองได้ ไม่ต้องติดตั้ง Node.js ไม่ต้องรันคำสั่ง ไม่ต้องใช้ GitHub และไม่ต้องสร้างตาราง SQL เอง

## ไฟล์ที่ใช้

- `worker.js` ในโฟลเดอร์ release: โค้ดรวม frontend และ backend พร้อมสำหรับวางใน Cloudflare Edit code
- `generate-secrets.html`: เปิดในเบราว์เซอร์จากเครื่องเพื่อสุ่มรหัสภายในสองค่า ไม่มีการส่งข้อมูลออก

ใช้ไฟล์ `release/worker.js` เท่านั้นในการวางโค้ด ไฟล์ `src/worker.js` เป็น source ที่ยังมี imports และยังไม่ได้รวมหน้าเว็บ

รุ่นนี้ยังมีข้อจำกัด D1 Free ที่ปริมาณเป้าหมาย 10,000 ข้อความ/วัน ควรเริ่มกับกลุ่มทดสอบหนึ่งกลุ่มก่อน การเปลี่ยนวิธี deploy ไม่ได้เพิ่มโควตาฟรี

## 1. สร้าง Worker และรับ URL

1. เปิด [Cloudflare Dashboard](https://dash.cloudflare.com/) และเลือกบัญชีของคุณ
2. เข้า **Workers & Pages**
3. กด **Create application** แล้วเลือก **Create Worker / Hello World** ตามหน้าจอของบัญชี
4. ตั้งชื่อ `line-chat-archive` ถ้าชื่อนี้มีอยู่แล้วและเป็นโปรเจกต์ของคุณ ให้เปิด Worker เดิมแทนการสร้างซ้ำ
5. กด **Deploy** สำหรับโค้ดตัวอย่างก่อน ยังไม่ต้องวางโปรแกรมในหน้าสร้างรอบแรก
6. เปิดหน้า Overview ของ Worker จด URL จริง เช่น `https://line-chat-archive.your-subdomain.workers.dev`

หลังสร้างเสร็จจึงจะใช้ปุ่ม **Edit code** แก้โค้ดได้ ใช้ URL production ของ Worker ไม่ใช่ URL ของหน้าต่าง Preview

อ้างอิง: [สร้าง Worker ผ่าน Dashboard](https://developers.cloudflare.com/learning-paths/workers/get-started/first-worker/)

## 2. สร้าง D1 ว่างและผูกกับ Worker

1. จากเมนู Cloudflare ไปที่ **Storage & databases → D1 SQL Database**
2. กด **Create database**
3. ตั้งชื่อ `line-chat-archive-dashboard` แล้วกด **Create**
4. กลับไป **Workers & Pages → line-chat-archive**
5. เข้าแท็บ **Bindings** หรือ **Settings → Bindings** ตามหน้าจอ
6. กด **Add binding → D1 database**
7. ช่อง Variable name ใส่ `DB` ตัวพิมพ์ใหญ่ตามนี้
8. เลือกฐาน `line-chat-archive-dashboard` จากรายการ แล้วกด **Add binding / Save / Deploy** ให้เรียบร้อย

ใช้ฐานใหม่ที่ว่างสำหรับชุดติดตั้งนี้ ถ้าเคยสร้างตารางด้วยวิธีเดิมแล้ว อย่าลบข้อมูลเดิมเพื่อแก้ปัญหา ให้สร้าง D1 ใหม่อีกชื่อและเลือก binding ให้ถูก โปรแกรมจะสร้างตารางของตัวเองครั้งแรกที่เปิดเว็บหลังนำโค้ดจริงขึ้นแล้ว

ไม่ต้องกรอก database_id ลงโค้ด ไม่ต้องเปิด Console เพื่อวาง SQL และไม่ต้องเพิ่ม ASSETS binding เพราะหน้าเว็บถูกรวมไว้ในไฟล์แล้ว

อ้างอิง: [การสร้าง D1](https://developers.cloudflare.com/d1/get-started/), [D1 binding](https://developers.cloudflare.com/d1/worker-api/d1-database/)

## 3. กรอกตัวแปรทั่วไป

เปิด **Worker → Settings → Variables and Secrets → Add** เลือกชนิด **Text** แล้วเพิ่มค่าต่อไปนี้ทีละรายการ:

| Variable name | Value |
| --- | --- |
| APP_URL | URL จริงจากขั้นที่ 1 เช่น https://line-chat-archive.your-subdomain.workers.dev |
| OWNER_EMAIL | อีเมล Google ที่จะเป็นเจ้าของชีตและใช้ล็อกอิน |
| ARCHIVE_NAMESPACE | line-chat-archive-dashboard-production |
| RETENTION_DAYS | 365 |
| CACHE_DAYS | 7 |

APP_URL ต้องเริ่มด้วย https:// ไม่มี path และไม่มี `/` ท้าย URL ไม่ใช้ localhost ตัวอย่าง your-subdomain ต้องแทนด้วย subdomain ของคุณจริง

กด **Deploy / Save and deploy** เพื่อให้ตัวแปรมีผลกับ Worker จริง อย่าเพิ่มเป็น Build variables เพราะรุ่นนี้ไม่ได้ใช้ระบบ Build และโค้ดอ่านตัวแปรตอนทำงาน

ห้ามใช้ ARCHIVE_NAMESPACE เดียวกันกับ Worker คนละชุดที่ใช้ D1 คนละฐาน เพราะทั้งสองชุดอาจพบไฟล์ Drive ชุดเดียวกันและเขียนชนกัน

## 4. ตั้ง Compatibility

1. ในหน้า Settings หา **Runtime / Compatibility date**
2. ตั้ง Compatibility date เป็น `2026-11-05`
3. ใน **Compatibility flags** เพิ่ม `global_fetch_strictly_public`
4. กดบันทึกหรือ Deploy ตามหน้าจอ

flag นี้ทำให้ Worker เรียก API ภายในที่ URL ของตัวเองได้ งานส่งข้อมูลและลองใหม่ใช้เส้นทางนี้

อ้างอิง: [Cloudflare Fetch](https://developers.cloudflare.com/workers/runtime-apis/fetch/)

## 5. ตั้ง Google Cloud

1. เปิด [Google Cloud Console](https://console.cloud.google.com/) ด้วยบัญชีที่จะเป็นเจ้าของชีต
2. สร้างหรือเลือก project สำหรับ LINE Archive
3. ไปที่ **APIs & Services → Library** ค้นหา **Google Sheets API** แล้วกด **Enable**
4. ทำแบบเดียวกันกับ **Google Drive API**
5. ไปที่ **Google Auth platform** กด **Get started** ถ้ายังไม่เคยตั้งค่า
6. ตั้งชื่อแอป LINE Archive พร้อม support/contact email ที่คุณดูแล
7. สำหรับ Gmail ส่วนตัว เลือก Audience เป็น **External** และเพิ่มบัญชีเดียวกับ OWNER_EMAIL ใน **Test users**
8. ใน **Data Access → Add or remove scopes** เลือกสิทธิ์ต่อไปนี้แล้ว Save:

| Scope |
| --- |
| openid |
| https://www.googleapis.com/auth/userinfo.email |
| https://www.googleapis.com/auth/userinfo.profile |
| https://www.googleapis.com/auth/drive.file |

จากนั้นสร้าง OAuth client:

1. ไป **Google Auth platform → Clients → Create client**
2. เลือก **Web application**
3. ตั้งชื่อ เช่น LINE Archive Cloudflare
4. ใน **Authorized redirect URIs** เพิ่ม URL Worker จริงตามด้วย `/auth/callback` เช่น `https://line-chat-archive.your-subdomain.workers.dev/auth/callback`
5. กด **Create** แล้วเก็บ **Client ID** และ **Client secret** สำหรับขั้นที่ 7

ไม่ใช้ API key หรือ service-account JSON แทนสองค่านี้ ไม่ต้องเพิ่มพอร์ต demo 8788 และไม่ต้องสร้าง Google Sheets เอง

ถ้า Google ขอให้ยอมรับเงื่อนไขหรือดำเนินการ verification ให้อ่านและดำเนินการด้วยบัญชีของคุณตามหน้าจอ ไม่มีการอนุญาตสิทธิ์ Google โดยการ deploy โค้ดเพียงอย่างเดียว

อ้างอิง: [OAuth consent](https://developers.google.com/workspace/guides/configure-oauth-consent), [สร้าง OAuth client](https://developers.google.com/workspace/guides/create-credentials)

## 6. ตั้ง LINE Official Account

1. เปิด [LINE Official Account Manager](https://manager.line.biz/)
2. สร้างหรือเลือก OA ที่ใช้สำหรับบอตนี้
3. ไป **Settings → Messaging API** แล้วเปิดใช้งานและเลือก Provider ให้ถูกต้อง
4. เปิด [LINE Developers Console](https://developers.line.biz/console/) เลือก Messaging API channel ของ OA นี้
5. จาก **Basic settings** เก็บค่า **Channel secret**
6. จาก **Messaging API** ออกและเก็บ **Channel access token** ตามตัวเลือกที่บัญชีรองรับ สำหรับเริ่มต้นโค้ดที่ใช้ token คงที่ สามารถใช้ long-lived token ได้เมื่อมีตัวเลือกนี้ ถ้าใช้ชนิดหมดอายุต้องเปลี่ยน secret ให้ทันเพราะรุ่นนี้ยังไม่ต่ออายุให้เอง
7. เปิด **Allow bot to join group chats**
8. ปิด Greeting messages และ Auto-reply messages ถ้าไม่ต้องการให้ OA ตอบเอง

Channel secret และ access token ต้องมาจาก channel เดียวกัน ยังไม่ต้องตั้ง Webhook จนกว่าจะนำโค้ดและ secrets ขึ้นครบ

## 7. กรอก Secrets ผ่านหน้าเว็บ

ในเครื่อง เปิดไฟล์ `release/generate-secrets.html` ด้วยเบราว์เซอร์ แล้วกด **สร้างรหัสสองค่า** คัดลอกค่าที่ได้ไปเก็บใน password manager ของคุณ ไม่ต้องใช้โปรแกรมออนไลน์สุ่มรหัสและไม่ต้องเปิด terminal

กลับมาที่ **Cloudflare Worker → Settings → Variables and Secrets → Add** เลือกชนิด **Secret** แล้วเพิ่มหกค่าต่อไปนี้:

| Variable name | Value |
| --- | --- |
| LINE_CHANNEL_SECRET | Channel secret จาก LINE |
| LINE_CHANNEL_ACCESS_TOKEN | Channel access token จาก LINE |
| GOOGLE_CLIENT_ID | OAuth Client ID จาก Google |
| GOOGLE_CLIENT_SECRET | Client secret จาก Google |
| SESSION_SECRET | ค่า SESSION_SECRET ที่ไฟล์สร้างให้ |
| TOKEN_ENCRYPTION_SECRET | ค่า TOKEN_ENCRYPTION_SECRET อีกค่าที่ไฟล์สร้างให้ |

กด **Deploy** ให้ค่ามีผล รหัสภายในสองค่าต้องไม่ซ้ำกันและยาวอย่างน้อย 32 อักขระ ไฟล์สร้างรหัสให้ยาวเพียงพอแล้ว ไม่ต้องพิมพ์เครื่องหมายคำพูดครอบค่าที่วาง

ไม่ใส่ secrets ลง worker.js ไม่ส่งลงแชท และไม่ต้องสร้าง GOOGLE_REFRESH_TOKEN เอง โปรแกรมจะรับหลังล็อกอินสำเร็จ

อ้างอิง: [เพิ่ม Secret ผ่าน Dashboard](https://developers.cloudflare.com/workers/configuration/secrets/)

## 8. วางโค้ดรวมแล้ว Deploy

1. เปิด File Explorer ไปที่โฟลเดอร์ `D:\BOT เก็บข้อมูล\release`
2. คลิกขวา `worker.js` → **Open with → Notepad** หรือเปิดไฟล์จาก editor ของคุณ ไม่ดับเบิลคลิกเพื่อรันไฟล์ JavaScript
3. ในไฟล์ กด **Ctrl+A → Ctrl+C** เพื่อคัดลอกโค้ดทั้งหมด
4. เปิด **Cloudflare Worker → Overview → Edit code**
5. เลือกไฟล์ entry ของ Worker ที่มีโค้ดตัวอย่าง เช่น worker.js หรือ index.js
6. คลิกในช่อง editor กด **Ctrl+A → Ctrl+V** เพื่อแทนโค้ดตัวอย่างทั้งหมดด้วยไฟล์รวม
7. กด **Deploy / Save and deploy** และรอสำเร็จ
8. กด **Visit** เปิด URL production ของ Worker

ไฟล์รวมนี้มีทั้ง API, frontend และตัวสร้าง schema อยู่แล้ว ไม่ต้องอัปโหลด public แยก ไม่ต้องอัปโหลด dist และไม่ต้องตั้ง Build command

การเปิดเว็บครั้งแรกจะสร้างตาราง D1 ทั้งชุดใน batch เดียวและบันทึกเวอร์ชัน schema ให้เอง หากมีการเริ่มพร้อมกันจะตรวจรับผลที่สร้างสำเร็จแล้ว หากเกิดปัญหาระหว่างสร้าง ระบบไม่ทิ้งตารางไว้ครึ่งชุด

หากพบข้อความว่าไม่มี binding ชื่อ DB ให้กลับไปขั้นที่ 2 หากพบว่าฐานมีตารางอยู่แล้วแต่ไม่ใช่ชุด Dashboard ที่พร้อมใช้ ให้เลือกฐานใหม่ที่ว่าง ห้ามลบฐานที่มีข้อมูลจริงเพื่อให้ข้อความหาย

## 9. เพิ่ม Cron ผ่านหน้า Settings

1. เปิด Worker → **Settings → Triggers / Cron Triggers**
2. กด **Add trigger / Add Cron Trigger**
3. เลือกแบบ Custom cron expression ถ้ามี
4. กรอก `* * * * *`
5. กด **Add / Save**

นี่คืองานทุกนาทีเพื่อส่งรายการที่ยังค้างและดูแลอายุข้อมูล ข้อความใหม่ยังถูกส่งลงชีตทันที ไม่รอเวลา 08:00 น. Cloudflare ใช้เวลา UTC สำหรับ Cron และการตั้งค่าอาจทยอยมีผล

อ้างอิง: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)

## 10. ล็อกอินและอนุญาต Google

1. เปิด URL production ของ Worker
2. กด **เข้าสู่ระบบด้วย Google**
3. เลือกบัญชีที่ตรงกับ OWNER_EMAIL
4. อนุญาตสิทธิ์ที่แอปขอ
5. เมื่อกลับมาที่ dashboard ได้ ถือว่าการเชื่อม Google สำเร็จ

แอปจะสร้างโฟลเดอร์ LINE Archive พร้อมไฟล์สารบัญและไฟล์รายเดือนใน Drive ของคุณเมื่อเริ่มมีการเตรียมกลุ่ม/ส่งข้อความ ไม่ต้องเปิดแชร์ไฟล์เป็นสาธารณะ

ถ้า OAuth ยังเป็น External + Testing พร้อม Drive scope refresh token จะมีอายุ 7 วันตามข้อกำหนด Google อาจต้องกด **เชื่อมต่อ Google ใหม่** หลังหมดอายุ สำหรับใช้งานต่อเนื่องให้ดำเนินการด้าน publishing/verification ตามที่ Google กำหนด

อ้างอิง: [อายุ refresh token](https://developers.google.com/identity/protocols/oauth2#expiration)

## 11. ตั้ง Webhook และทดสอบกลุ่มแรก

ใน LINE Developers → Messaging API:

1. ใน Webhook URL ใส่ URL Worker จริงตามด้วย `/webhooks/line` เช่น `https://line-chat-archive.your-subdomain.workers.dev/webhooks/line`
2. กด **Update → Verify** ต้องได้ **Success**
3. เปิด **Use webhook**
4. เปิด **Webhook redelivery** เมื่อมีตัวเลือก
5. เพิ่ม OA เป็นเพื่อน แล้วเชิญบอตเข้ากลุ่มทดสอบหนึ่งกลุ่ม
6. ส่งตัวอักษรใหม่ เช่น “ทดสอบบันทึกข้อความ 001”

ตรวจ dashboard ว่าเห็นกลุ่มและจำนวนค้างลดลง แล้วเปิด Drive ดูไฟล์รายเดือนและแท็บของกลุ่ม การเตรียมไฟล์ครั้งแรกอาจต่อหลายรอบเล็กเพื่อรักษาโควตา

ทดสอบข้อความตอบกลับ การแก้ไข และยกเลิกส่งด้วยข้อความทดสอบ แถวหลักต้องไม่เพิ่มเป็นคนละข้อความทุกครั้งที่แก้ไข ส่วนประวัติจะมีเหตุการณ์เพิ่ม สถานะยกเลิกส่งใช้ unsent โดยคงเนื้อหาไว้ตามข้อกำหนดของคุณ

ในหนึ่งกลุ่มมี LINE OA ได้หนึ่งบัญชี ระบบไม่เก็บรูปหรือแชทส่วนตัว และไม่ดึงประวัติก่อนบอตเข้ากลุ่ม

อ้างอิง: [Webhook](https://developers.line.biz/en/docs/messaging-api/building-bot/), [กลุ่ม LINE](https://developers.line.biz/en/docs/messaging-api/group-chats/)

## ตรวจปัญหาโดยไม่ใช้ Terminal

| อาการ | ไปแก้ที่ไหน |
| --- | --- |
| ยังเป็น Hello World | Edit code: วาง release/worker.js แล้วกด Deploy ไม่ใช่เพียง Save |
| ไม่พบ DB binding | Worker → Bindings เพิ่ม D1 ชื่อ DB และเลือกฐานให้ถูก |
| ฐานมีตารางที่ไม่พร้อมใช้ | เลือก D1 ใหม่ที่ว่างสำหรับชุดนี้ อย่าลบข้อมูลเดิม |
| ไม่เห็นปุ่มล็อกอิน | Variables and Secrets: ตรวจ OWNER_EMAIL และ Google/SESSION/TOKEN secrets ให้ครบและกด Deploy |
| redirect_uri_mismatch | Google Auth platform → Clients: redirect URI ต้องตรง APP_URL + /auth/callback |
| บัญชีเข้าไม่ได้ | ตรวจ Test users ของ Google และ OWNER_EMAIL ให้เป็นบัญชีเดียวกัน |
| LINE Verify ได้ 401 | ตั้ง Channel secret ของ channel นี้ใหม่ใน Worker Secrets |
| เปิด webhook ด้วย browser แล้ว 404 | เป็นปกติของ GET ให้ใช้ Verify ของ LINE ซึ่งส่ง POST |
| ไม่มีชื่อผู้ส่ง | LINE อาจไม่ส่งข้อมูลโปรไฟล์ หรือ token/profile API เรียกไม่ได้ ตรวจ Channel access token และสถานะ LINE |
| รายการค้างไม่ลด | เปิดข้อผิดพลาดใน dashboard และดู Worker → Observability / Logs ตรวจ Cron, Google token, APP_URL และ compatibility flag |
| Google ใช้ไม่ได้หลัง 7 วัน | เชื่อมต่อ Google ใหม่และตรวจสถานะ Testing/publishing |
| ปุ่มลองส่งใหม่ได้ 403 เรื่อง origin | เปิด production URL ให้ตรง APP_URL และ Deploy ตัวแปรใหม่ |
| ไม่เห็นหน้าเว็บหลังเปลี่ยน compatibility/settings | ตรวจว่าใช้โค้ดไฟล์รวมและ Deploy สำเร็จ เปิด URL production ใหม่ |
| โควตาฟรีเต็ม | ดู Worker/D1 Usage ใน Dashboard และหยุดเพิ่มปริมาณ การกด retry ซ้ำไม่เพิ่มโควตา |

อย่าเปิดหน้า Cloudflare Access/login gate ครอบทั้ง Worker จน LINE webhook และ internal drain เรียกไม่ได้ โค้ดมีการตรวจลายเซ็นและล็อกอิน Google ของเจ้าของอยู่แล้ว

## เมื่อจะอัปเดตโปรแกรม

ใช้ไฟล์ release/worker.js รุ่นที่เตรียมให้ใหม่ ไป Edit code → แทนโค้ดทั้งหมด → Deploy คง D1 binding, ตัวแปร, secrets และ Cron เดิมไว้ ไม่ต้องสร้างฐานใหม่ทุกครั้ง

การอัปเดตที่เปลี่ยน schema ต้องมีขั้นตอน migration สำหรับรุ่นนั้นแยกต่างหาก ชุดเริ่มต้นนี้ไม่เดาการแก้ตารางที่ไม่รู้จัก และไม่ใช้แทนวิธี migrate ของโครงการอื่น

ไม่ควรสลับไปสร้างตารางซ้ำด้วยวิธี CLI บนฐานที่ชุด Dashboard สร้างไว้แล้ว เก็บสำรองข้อมูลก่อนเปลี่ยนรูปแบบติดตั้ง

หลัง deploy ไม่ต้องเปิดคอมค้าง ระบบออนไลน์รันบน Cloudflare บัญชี LINE/Google/Cloudflare ยังเป็นของคุณทั้งหมด คู่มือนี้ยังไม่ได้สร้างทรัพยากรหรือเผยแพร่เข้าบัญชีคุณแทนคุณ
