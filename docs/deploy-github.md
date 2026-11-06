# เชื่อม GitHub กับ Cloudflare โดยไม่เปิด Terminal

อัปเดต: 6 พฤศจิกายน 2026 — วิธีติดตั้งหลักของโปรเจกต์นี้

Repository: https://github.com/divoctako/Botcollectdata

แนวทางนี้ให้ Cloudflare ดึงโค้ดจาก GitHub แล้ว build/deploy เอง คุณตั้งค่าผ่านหน้าเว็บ ไม่ต้องติดตั้ง Node.js หรือคัดลอก worker.js ลง Edit code หลังเชื่อมแล้ว การ commit ลง main จะสั่ง build ใหม่

## เริ่มจากตรงไหน

| สถานะของคุณ | เริ่มทำ |
| --- | --- |
| ยังไม่เคยสร้างระบบ | ขั้นที่ 1 สร้าง D1 แล้วทำตามลำดับ |
| สร้าง D1 ว่างแล้ว | คัดลอก Database ID และแก้ไฟล์ GitHub ในขั้นที่ 1 |
| มี Worker แล้ว แต่ยังไม่เชื่อม GitHub | ขั้นที่ 2 ส่วนเชื่อม Worker เดิม โดยตรวจ D1 ID ให้ตรงก่อน |
| เคยใช้ชุดติดตั้ง Dashboard และมีข้อมูลแล้ว | ใช้ D1, namespace, เจ้าของ และ secrets เดิม ห้ามสร้างฐานใหม่ทับการตั้งค่าเดิม |
| เชื่อม GitHub และ deploy ได้แล้ว | ตรวจค่าขั้นที่ 3–5 และทดสอบท้ายคู่มือ |

บัญชีที่ต้องใช้: Cloudflare, GitHub ที่เข้าถึง repository นี้ได้, Google เจ้าของชีต และ LINE OA ที่คุณดูแล เริ่มด้วยกลุ่มทดสอบหนึ่งกลุ่ม รุ่นนี้ยังไม่ผ่านเป้า 10,000 ข้อความต่อวันบน D1 Free

## ค่าหลักที่ใช้ตลอดคู่มือ

| รายการ | ค่า |
| --- | --- |
| Repository | divoctako/Botcollectdata |
| Production branch | main |
| Worker name | botcollectdata |
| ไฟล์ config สำหรับ GitHub Builds | wrangler.github.jsonc |
| D1 binding | DB ตัวพิมพ์ใหญ่ |
| ฐาน D1 ตัวอย่าง | line-chat-archive-dashboard |

URL เว็บจะทราบหลัง deploy ครั้งแรก เช่น `https://botcollectdata.your-subdomain.workers.dev` ให้แทน your-subdomain ด้วย URL ที่ Cloudflare แสดงจริง ไม่ใช้ localhost หรือ URL preview

## 1. สร้าง D1 และใส่ ID ผ่าน GitHub

1. เข้า [Cloudflare Dashboard](https://dash.cloudflare.com/) → Storage & databases → D1 SQL Database
2. Create database ชื่อ `line-chat-archive-dashboard` ใช้ฐานใหม่ที่ว่างสำหรับชุดติดตั้งนี้
3. เปิดรายละเอียดฐานแล้วคัดลอก Database ID
4. เปิด [wrangler.github.jsonc บน GitHub](https://github.com/divoctako/Botcollectdata/blob/main/wrangler.github.jsonc)
5. กดรูปดินสอ Edit เปลี่ยน database_id จาก `00000000-0000-0000-0000-000000000000` เป็น ID จริง แล้ว Commit changes ลง main
6. ถ้าฐานตั้งชื่ออื่น ให้เปลี่ยน database_name ให้ตรงด้วย คง binding ชื่อ `DB` ตามเดิม

Database ID ไม่ใช่ access token ส่วนรหัส LINE/Google ห้ามใส่ใน GitHub ถ้าเคยใช้วิธีคัดลอกไฟล์รวมและมีฐาน Dashboard ที่ทำงานแล้ว สามารถใช้ ID ของฐานชุดนั้นได้โดยเก็บ binding และ namespace เดิม ไม่สร้างฐานใหม่แทนข้อมูลเดิมโดยไม่ตั้งใจ

ฐานที่สร้างตารางด้วย CLI รุ่นเดิมและไม่มี marker ของ Dashboard จะถูกปฏิเสธโดยตัวติดตั้งอัตโนมัติ ให้ใช้ฐานว่างแยกสำหรับการเริ่มติดตั้ง ไม่ลบข้อมูลจริงเพื่อแก้ข้อผิดพลาด

**ผลที่ควรได้:** เปิดไฟล์บน GitHub แล้วเห็น Database ID จริงใน wrangler.github.jsonc ไม่ใช่เลขศูนย์ และ binding ยังคงเป็น DB อย่าแก้เฉพาะ wrangler.jsonc ซึ่งเป็น config อีกวิธีหนึ่ง

## 2. เชื่อม repository กับ Workers Builds

1. Cloudflare → Workers & Pages → Create application
2. เลือก Import a repository / Connect Git และเลือก GitHub
3. อนุญาต Cloudflare GitHub App ให้เข้าถึง repository `divoctako/Botcollectdata` ตามหน้าจอที่คุณตรวจและยอมรับเอง
4. เลือก repository Botcollectdata และ branch `main`
5. ตั้ง **Worker name** เป็น `botcollectdata` ให้ตรง name ใน wrangler.github.jsonc
6. ตั้ง Build settings ตามตารางนี้:

| ช่อง | ค่า |
| --- | --- |
| Production branch | main |
| Root directory | ราก repository (ปล่อยค่า default หรือ /) |
| Build command | npm run build:github |
| Deploy command | npm run deploy:github |
| Build variable: NODE_VERSION | 22 |

ช่อง Root directory ต้องชี้รากที่มี package.json ไม่ใช่ src, public, dist หรือ release อย่าเลือกการสร้าง Pages แบบ static เพราะโปรเจกต์นี้ต้องใช้ Workers backend และ D1

สองช่อง command เป็นคำสั่งให้ Cloudflare ทำเองบนเซิร์ฟเวอร์ ไม่ได้ให้คุณเปิด Terminal ส่วน build script จะรวมโค้ดและทดสอบก่อน deploy และไม่ต้องใช้ Python บนเครื่อง build

สำคัญ: ใช้ `deploy:github` ตามนี้ เพราะ script เลือก `wrangler.github.jsonc` และคง runtime variables ที่คุณตั้งใน Dashboard ถ้าใช้คำสั่ง deploy default จะอ่าน config สำหรับการพัฒนาอีกไฟล์ที่ยังมี placeholder

กด Deploy แล้วรอ build สำเร็จ จะได้ URL รูปแบบ `https://botcollectdata.<your-subdomain>.workers.dev` จด URL production จริงไว้ ไม่ใช้ URL preview

ถ้ามี Worker ชื่อ botcollectdata อยู่แล้ว ให้เข้า Worker นั้น → Settings → Builds → Connect repository และตั้งค่า Build/Deploy command ข้างต้น แทนการสร้าง Worker ชนชื่อ

ถ้าไม่เห็น repository ตอนเลือก ให้เปิดการตั้งค่า Cloudflare GitHub App แล้วให้สิทธิ์ repository นี้ตามหน้าจอ ไม่จำเป็นต้องอนุญาตทุก repository ในบัญชี

**ผลที่ควรได้:** Build log แสดงการรวม Worker, tests ผ่าน แล้ว deploy สำเร็จ ถ้าเพิ่ง deploy รอบแรกและหน้าเว็บยังแจ้งว่า Google/LINE ไม่พร้อม เป็นสถานะปกติก่อนตั้ง variables และ secrets ขั้นต่อไป ยังไม่ต้องเชิญบอตเข้ากลุ่ม

อ้างอิง: [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), [GitHub integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)

## 3. ตั้ง runtime variables ใน Cloudflare

เปิด Worker → Settings → Variables and Secrets เพิ่มชนิด **Text**:

| ชื่อ | ค่า |
| --- | --- |
| APP_URL | URL production จริง ไม่มี / ท้าย เช่น https://botcollectdata.your-subdomain.workers.dev |
| OWNER_EMAIL | อีเมล Google เจ้าของที่ใช้ล็อกอิน |
| ARCHIVE_NAMESPACE | line-chat-archive-dashboard-production |
| RETENTION_DAYS | 365 |
| CACHE_DAYS | 7 |

ตั้งตรง runtime Variables and Secrets ไม่ใช่ Build variables ข้อยกเว้นคือ NODE_VERSION ซึ่งเป็น Build variable ตามขั้นก่อน

ถ้าย้ายจากวิธี Dashboard ที่มีข้อมูลอยู่แล้ว ให้คง APP_URL, OWNER_EMAIL, ARCHIVE_NAMESPACE และ D1 ID ที่ใช้งานไว้ให้ตรงระบบเดิม ไม่สร้าง namespace ใหม่โดยไม่ตั้งใจ

ไม่มี vars ใน wrangler.github.jsonc และ deploy script ใช้ keep-vars เพื่อเก็บค่าที่ตั้งผ่าน Dashboard ส่วน secrets จะอยู่ฝั่ง Cloudflare ไม่อยู่ใน repository

หลังเพิ่มหรือแก้ค่า ให้กด Save/Deploy ตามหน้าจอจนมีผลกับ production แล้วรีเฟรชเว็บ ตัวติดตั้งใช้ D1 ที่ประกาศในไฟล์ config หากเปลี่ยน D1 ต้องแก้ ID ใน GitHub ด้วย ไม่แก้เฉพาะ binding ใน Dashboard แล้วปล่อย config ชี้คนละฐาน

## 4. ตั้ง Google, LINE และ Secrets ผ่านหน้าเว็บ

### 4.1 Google Cloud และ OAuth

1. เปิด [Google Cloud Console](https://console.cloud.google.com/) ด้วยบัญชีที่จะเป็นเจ้าของชีต แล้วสร้างหรือเลือก project สำหรับ LINE Archive
2. ไป APIs & Services → Library เปิด Google Sheets API และ Google Drive API ทั้งสองรายการ
3. ไป Google Auth platform → Get started ตั้งชื่อแอป LINE Archive พร้อม support/contact email ของคุณ
4. Gmail ส่วนตัวเลือก Audience เป็น External เพิ่มอีเมลเดียวกับ OWNER_EMAIL ใน Test users ระหว่างทดสอบ
5. ใน Data Access → Add or remove scopes เพิ่มสิทธิ์ตามตาราง แล้วบันทึก

| Scope |
| --- |
| openid |
| https://www.googleapis.com/auth/userinfo.email |
| https://www.googleapis.com/auth/userinfo.profile |
| https://www.googleapis.com/auth/drive.file |

6. ไป Clients → Create client เลือก Web application และตั้งชื่อ เช่น LINE Archive Cloudflare
7. เพิ่ม Authorized redirect URI เป็น URL production จริงต่อท้าย `/auth/callback` เช่น `https://botcollectdata.your-subdomain.workers.dev/auth/callback`
8. Create แล้วเก็บ Client ID และ Client secret ของ client นี้ไว้กรอกใน Cloudflare ไม่ใช้ API key หรือ service-account JSON แทน

โค้ดนี้แลก token ฝั่ง server จึงไม่ต้องตั้ง Authorized JavaScript origins เพื่อให้ flow นี้ทำงาน การกรอก origins อย่างเดียวไม่แทน redirect URI ไม่ต้องเปิดชีตเป็นสาธารณะ และยังไม่ต้องสร้างไฟล์ชีตเอง

อ้างอิง: [OAuth consent](https://developers.google.com/workspace/guides/configure-oauth-consent), [สร้าง OAuth client](https://developers.google.com/workspace/guides/create-credentials)

### 4.2 LINE Official Account

1. เปิด [LINE Official Account Manager](https://manager.line.biz/) สร้างหรือเลือก OA สำหรับบอตนี้
2. Settings → Messaging API เปิดใช้งานและเลือก Provider ให้ถูกต้อง
3. เปิด [LINE Developers Console](https://developers.line.biz/console/) เลือก Messaging API channel ของ OA เดียวกัน
4. Basic settings: เก็บ Channel secret
5. Messaging API: ออกและเก็บ Channel access token ตามชนิดที่รองรับ รุ่นนี้ใช้ token ที่ตั้งไว้ใน Worker และยังไม่ออก/ต่ออายุให้อัตโนมัติ ถ้าเลือกชนิดหมดอายุต้องเปลี่ยนค่าให้ทัน
6. เปิด Allow bot to join group chats
7. ปิด Greeting messages และ Auto-reply messages หากไม่ต้องการให้ OA ตอบเอง

ยังไม่ต้องตั้ง webhook จนกว่าจะตั้ง secrets และเชื่อม Google สำเร็จ

### 4.3 สร้างรหัสภายในโดยไม่ใช้ Terminal

1. หน้า repository บน GitHub กด Code → Download ZIP
2. แตก ZIP ในเครื่อง เปิดโฟลเดอร์ release
3. เปิด generate-secrets.html ด้วย Chrome หรือ Edge จากเครื่อง ไม่ใช่เพียงเปิดดู source ของไฟล์ HTML บน GitHub
4. กดสร้างรหัสสองค่า เก็บ SESSION_SECRET และ TOKEN_ENCRYPTION_SECRET ไว้ใน password manager แล้วนำไปตั้งในขั้นต่อไป

ไฟล์นี้สุ่มในเบราว์เซอร์ ไม่มีการส่งรหัสออก และไม่เก็บลง localStorage รหัสสองค่าต้องไม่เหมือนกัน หากระบบมีข้อมูลอยู่แล้วให้ใช้ค่าเดิม ไม่สุ่มเปลี่ยน TOKEN_ENCRYPTION_SECRET โดยไม่มีแผนเชื่อม Google ใหม่

### 4.4 เพิ่ม Secrets ใน Cloudflare

เพิ่มชนิด **Secret** ใน Worker → Settings → Variables and Secrets ให้ครบ:

| Secret | ค่าจาก |
| --- | --- |
| LINE_CHANNEL_SECRET | Channel secret ของ OA นี้ |
| LINE_CHANNEL_ACCESS_TOKEN | Messaging API token ของ channel เดียวกัน |
| GOOGLE_CLIENT_ID | OAuth Web client ที่สร้างไว้ |
| GOOGLE_CLIENT_SECRET | Client secret ของ client เดียวกัน |
| SESSION_SECRET | รหัสสุ่มค่าที่หนึ่ง |
| TOKEN_ENCRYPTION_SECRET | รหัสสุ่มอีกค่าหนึ่ง |

กด Save/Deploy ให้ค่ามีผล ไม่ต้องเพิ่ม secrets เหล่านี้ใน GitHub หรือใน Build variables และไม่ต้องตั้ง GOOGLE_REFRESH_TOKEN เอง

ไม่ต้องใช้ขั้นคัดลอกไฟล์เข้า Edit code ของคู่มือเดิม เพราะ GitHub Builds ทำหน้าที่ deploy โค้ดแล้ว Cron และ compatibility flag ถูกกำหนดใน wrangler.github.jsonc เช่นกัน ไม่ต้องเพิ่ม Cron ซ้ำอีกตัว

**ผลที่ควรได้:** มี Text variables ห้ารายการจากขั้นที่ 3 และ Secret หกรายการจากขั้นที่ 4 บน Worker production ไม่ใช่เฉพาะหน้า Builds

## 5. เปิดเว็บ เชื่อม Google และตั้ง webhook

1. เปิด URL production → เข้าสู่ระบบด้วย Google ด้วยบัญชี OWNER_EMAIL และอนุญาตสิทธิ์ที่แอปขอ
2. ตัวติดตั้งจะสร้าง schema อัตโนมัติบน D1 ว่างเมื่อเปิดครั้งแรก ไม่ต้องรัน SQL
3. LINE Developers → Messaging API ตั้ง Webhook URL เป็น `https://<your-worker>/webhooks/line`
4. กด Verify ให้ได้ Success แล้วเปิด Use webhook และ Webhook redelivery เมื่อมีตัวเลือก
5. เชิญบอตเข้ากลุ่มทดสอบหนึ่งกลุ่ม ส่งข้อความตัวอักษรใหม่ แล้วตรวจ dashboard และไฟล์ใน Google Drive

OAuth External ที่ยังอยู่สถานะ Testing พร้อม Drive scope มีข้อจำกัด refresh token อายุ 7 วัน อาจต้องเชื่อม Google ใหม่จนกว่าจะจัดการ publishing/verification ตามที่ Google กำหนด

## 6. ตรวจว่าใช้งานได้ครบก่อนเพิ่มกลุ่ม

| ทดสอบ | ผลที่ควรเห็น |
| --- | --- |
| ล็อกอิน Google เจ้าของ | กลับเข้า dashboard ได้ |
| LINE Verify | Success |
| เชิญบอตแล้วส่งตัวอักษรใหม่ | กลุ่มแสดงบน dashboard และรายการค้างทยอยลดลง |
| เปิด Google Drive | มีโฟลเดอร์ LINE Archive ไฟล์สารบัญและไฟล์รายเดือน |
| เปิดแท็บหลักของกลุ่ม | มีรหัสกลุ่ม/ข้อความ/ผู้ส่ง เวลาไทย และเนื้อหา |
| อ้างตอบกลับข้อความ | มี replied_to_message_id เมื่อ LINE ส่งมาให้ |
| แก้ข้อความทดสอบ | แถวหลักยังเป็นข้อความเดิม current_text เปลี่ยน และมีเหตุการณ์ในแท็บประวัติ |
| ยกเลิกส่งข้อความทดสอบ | เนื้อหายังอยู่พร้อมสถานะ unsent ตามข้อกำหนดของโครงการ |

การทดสอบด้วยแชทส่วนตัวหรือรูปภาพจะไม่เพิ่มแถว รุ่นนี้เก็บเฉพาะข้อความตัวอักษรในกลุ่ม ไม่ดึงประวัติก่อนบอตเข้ากลุ่ม

Cloudflare → Worker → Settings → Triggers ควรมี Cron `* * * * *` จาก config ส่วน Observability/Logs ใช้ดูข้อผิดพลาด runtime การ deploy สำเร็จเพียงอย่างเดียวยังไม่ยืนยันว่า Google และ LINE เชื่อมครบ

## อัปเดตโปรแกรมภายหลัง

เมื่อแก้ไฟล์และ commit ลง main Cloudflare จะดึง commit ไป build และ deploy ใหม่ ดูผลใน Worker → Builds/Deployments ได้ เมื่อ build ไม่ผ่านให้ดู log โดยยังไม่เปลี่ยนฐานข้อมูลหรือออก secrets ใหม่

ไม่แก้โค้ดผ่าน Edit code ควบคู่กับ GitHub เพราะ deployment ถัดไปจะใช้โค้ดจาก repository ค่าตัวแปรและ secrets ยังคงตั้งผ่าน Dashboard ตามเดิม

ตรวจ commit ของ deployment ให้ตรงกับ commit ที่ต้องการบน GitHub หากเพียงแก้ variables/secrets ให้ Save/Deploy การตั้งค่า ไม่ต้องสร้าง D1 ใหม่ หาก build ล้มเหลวอย่าลบข้อมูลหรือเปลี่ยนรหัสลับเพื่อทดลองแก้โดยไม่มีสาเหตุ

## ปัญหาที่พบบ่อย

| อาการ | ตรวจอะไร |
| --- | --- |
| ไม่เห็น repository | Cloudflare GitHub App ยังไม่ได้รับสิทธิ์ repo นี้ หรือเลือก GitHub account คนละบัญชี |
| Build หา build:github ไม่พบ | Root directory ไม่ใช่ราก repo หรือ branch/commit ยังไม่ใช่ชุดล่าสุด |
| database not found หรือ ID เป็นศูนย์ | แก้ ID ใน wrangler.github.jsonc ผ่าน GitHub แล้ว commit ก่อนกด Retry build |
| Worker name ไม่ตรง config | ใช้ชื่อ botcollectdata หรือแก้ name ใน config ให้ตรง Worker ที่ตั้งไว้ |
| ตัวแปรหายหลัง build | Deploy command ต้องเป็น npm run deploy:github ไม่ใช้ default ที่อ่าน config คนละไฟล์ |
| หน้าเว็บยังไม่ให้ล็อกอิน | ตั้ง runtime Text/Secret ให้ครบ กด Deploy และรีเฟรช production URL |
| Google แจ้ง redirect_uri_mismatch | ตรวจ APP_URL กับ Google Authorized redirect URI ให้ตรง โดยต่อท้าย /auth/callback และไม่ใช้ localhost |
| Google ไม่ให้บัญชีทดสอบเข้า | ตรวจ Test users, project ที่ออก Client ID และ OWNER_EMAIL ให้ตรงกัน |
| มี DB binding แต่แจ้งฐานมีตารางที่ไม่พร้อมใช้ | ตรวจว่าชี้ฐานชุด Dashboard เดิมที่ครบ หรือฐานใหม่ที่ว่าง ห้ามลบฐานข้อมูลจริงเพื่อให้ error หาย |
| Verify ได้ 401 | LINE_CHANNEL_SECRET ไม่ตรงกับ channel ที่ส่ง webhook |
| ข้อความค้างไม่ลด | ตรวจข้อผิดพลาดบน frontend, APP_URL, Google token, Cron และ Workers/D1 Usage |
| ใช้ได้แล้วหยุดหลังประมาณ 7 วัน | ตรวจ OAuth Testing refresh token และเชื่อมต่อ Google ใหม่เมื่อหมดอายุ |
| ปุ่มลองส่งได้ 403 เรื่อง origin | เปิด production URL เดียวกับ APP_URL และ Deploy ค่าตั้งล่าสุด |
| ไม่แน่ใจว่าใช้โค้ด commit ล่าสุด | ดู Worker → Builds/Deployments แล้วเทียบ commit กับ GitHub main |
| โค้ดใช้ได้ แต่ 10,000 ข้อความ/วันชนโควตา | ข้อจำกัด D1 Free ของแบบปัจจุบันยังต้องแก้ การใช้ GitHub ไม่ได้เพิ่มโควตา |

ไฟล์ node_modules, .wrangler, .dev.vars, .env, cache, ฐานข้อมูลในเครื่อง และ backup ไม่ใช่ไฟล์ที่ต้องอัปโหลด ไม่ต้องส่งรหัสลับลงแชทเพื่อเชื่อมระบบ
