# ERP API (Core Kon)

REST API ของระบบ PYHOS-EXP พัฒนาด้วย [Bun](https://bun.sh) + [Elysia](https://elysiajs.com) + PostgreSQL
หน้าเว็บอยู่ที่ repo `fiatx` (Next.js) — เรียก API นี้ผ่าน proxy route ของ Next ไม่ได้เรียกจากเบราว์เซอร์ตรง

## Tech Stack

| ส่วนประกอบ | เทคโนโลยี |
|---|---|
| Runtime | Bun |
| Framework | Elysia |
| Database หลัก | PostgreSQL (`postgres` — tagged template) ฐาน `core_kon` |
| ฐานภายนอก (อ่าน) | MySQL (`mysql2`) — HIS, ครุภัณฑ์, คลังพัสดุ, เงินเดือน, โปรแกรมลาเดิม |
| Auth | JWT (8 ชั่วโมง) + OTP / MFA |
| Password Hashing | Argon2id (Bun built-in) |
| แจ้งเตือน | MOPH Alert / หมอพร้อม (ระบบลา, งานซ่อม IT) |
| API Docs | Swagger UI (`/docs`) |

## โครงสร้างโปรเจกต์

```
src/
├── index.ts            # ประกอบ route ทั้งหมด + เริ่ม job ตามเวลา (ยกยอดวันลา, รอบสรุปแจ้งเตือนใบลา)
├── routes/             # ประกาศ endpoint + schema (t.Object) + Swagger detail — แยกตามโมดูล
├── controllers/        # logic ของแต่ละ endpoint
├── services/           # logic ที่ใช้ร่วมกัน (นับวันลา, ยกยอด, แจ้งเตือนใบลา, นำเข้าข้อมูลโปรแกรมเดิม)
├── middlewares/        # authMiddleware (JWT), roleGuard (requireRoles), logger
├── utils/              # ตัวช่วยทั่วไป (ส่งหมอพร้อม, IP ผู้ใช้, ชื่อตำแหน่ง)
├── db/                 # connection pool + ไฟล์ DDL (*.sql) ของตารางที่ระบบนี้สร้างเอง
└── scripts/            # สคริปต์รันมือครั้งคราว
```

## ติดตั้ง

### เครื่องพัฒนา

```bash
bun install
bun run dev        # auto-reload
```

Server รันที่ `http://localhost:5000` (เปลี่ยนด้วย `PORT`) · Swagger UI: `http://localhost:5000/docs`

### เครื่อง Production (Windows)

1. ติดตั้ง [Bun](https://bun.sh) (`bun -v` ต้องใช้งานได้)
2. ดึงโค้ดล่าสุด (`git pull` หรือดาวน์โหลด zip) — **อย่าคัดลอก `node_modules` จากเครื่องอื่น**
3. ติดตั้ง package
   ```bat
   bun install
   ```
4. สร้าง / ตรวจไฟล์ `.env` ที่ root ของโปรเจกต์ (ดูหัวข้อ [Environment Variables](#environment-variables))
5. รัน DDL ที่ยังไม่เคยรันบนฐาน `core_kon` (ดูหัวข้อ [ฐานข้อมูล](#ฐานข้อมูล))
6. เริ่ม / รีสตาร์ทเซิร์ฟเวอร์
   ```bat
   bun src/index.ts
   ```

## Environment Variables

ไฟล์ `.env` ที่ root ของโปรเจกต์ — **ห้าม commit** ไฟล์นี้ ตัวอย่างด้านล่างเป็นชื่อตัวแปรเท่านั้น

```env
PORT=5000
JWT_SECRET=...                 # สุ่มยาว ๆ — เปลี่ยนแล้วทุกคนต้องล็อกอินใหม่

# PostgreSQL หลัก
CORE_KON_HOST=localhost
CORE_KON_PORT=5432
CORE_KON_USER=...
CORE_KON_PASSWORD=...
CORE_KON_DB_NAME=...
CORE_KON_SCHEMA=core_kon

# ฐานภายนอก (MySQL) — ใส่เฉพาะที่ใช้
HIS_HOST= / HIS_PORT= / HIS_USER= / HIS_PASSWORD= / HIS_DB_NAME=
EQUIPMENT_HOST= ... EQUIPMENT_DB_NAME=          # ครุภัณฑ์
EQUIPMENT_V2_HOST= ... EQUIPMENT_V2_DB_NAME=
INVENTORY_HOST= ... INVENTORY_DB_NAME=          # คลังพัสดุ
SALARY_HOST= ... SALARY_DB_NAME=                # เงินเดือน
DB_LEAVE_HOST= / DB_LEAVE_PORT= / DB_LEAVE_USERNAME= / DB_LEAVE_PASSWORD= / DB_LEAVE_DATABASE=   # โปรแกรมลาเดิม (นำเข้าข้อมูล)

# แจ้งเตือนหมอพร้อม
MOPH_NOTIFY_BASE_URL=...       # งานซ่อม IT / OTP
IT_MATENANCE_CLIENT_ID=...
IT_MATENANCE_SECRET_ID=...
MOPH_ALERT_BASE_URL=...        # แจ้งเตือนระบบลา (การ์ด Flex รายคนตามเลขบัตร)
MOPH_ALERT_CLIENT_ID=...
MOPH_ALERT_SECRET_ID=...

# ตัวเลือก
TRUSTED_PROXIES=ip1,ip2        # reverse proxy ที่อยู่คนละเครื่อง — ใช้หา IP จริงของผู้ใช้
LEAVE_AUTO_ROLLOVER=false      # ปิดการยกยอดวันลาพักผ่อนอัตโนมัติเมื่อข้ามปีงบ (ค่าเริ่มต้นเปิด)
LEAVE_MAX_ADVANCE_DAYS=...     # ยื่นลาล่วงหน้าได้ไม่เกินกี่วัน
```

## ฐานข้อมูล

ตารางที่ระบบนี้สร้างเองมี DDL อยู่ใน `src/db/*.sql` — ทุกไฟล์รันซ้ำได้ (`IF NOT EXISTS` / `ON CONFLICT DO NOTHING`)
เมื่อติดตั้งเครื่องใหม่หรืออัปเดตแล้วมีไฟล์ใหม่ ให้รันไฟล์นั้นบนฐาน `core_kon` ด้วย pgAdmin หรือ psql

```bat
psql -h <host> -U <user> -d <database> -f src\db\<ไฟล์>.sql
```

| กลุ่ม | ไฟล์ |
|---|---|
| ระบบลา | `hr_leave_workflow`, `hr_leave_balances`, `hr_leave_balance_logs`, `hr_leave_day_count`, `hr_leave_cancel_refund`, `hr_leave_substitute`, `hr_leave_contact`, `hr_leave_service_dates`, `hr_leave_auto_rollover`, `hr_leave_legacy_import`, `hr_legacy_import_runs`, `hr_leave_notify`, `hr_settings`, `hr_posts` |
| บัญชีผู้ใช้ / ความปลอดภัย | `auth_mfa`, `auth_password_policy`, `auth_username_policy`, `user_credential_audit`, `user_salary_ids` |
| IT | `it_repair_pr`, `it_repair_progress`, `it_repair_complete`, `it_roadmap`, `it_roadmap_meta`, `it_user_request`, `it_user_request_consent`, `it_user_request_license` |
| อื่น ๆ | `app_modules` (สวิตช์เปิด/ปิดโมดูล), `app_page_views`, `asset_donation`, `medical_stat` |

### แจ้งเตือนระบบลา (หมอพร้อม)

1. ใส่ `MOPH_ALERT_*` ใน `.env` แล้วรัน `src/db/hr_leave_notify.sql`
2. รีสตาร์ทเซิร์ฟเวอร์ (job รอบสรุปเริ่มจาก `startLeaveNotifyJob()` ใน `src/index.ts`)
3. ADMIN เปิดใช้ที่หน้าเว็บ `/hr/leave/notify-settings` — ค่าเริ่มต้น **ปิด**
   - เลือกโหมดต่อระดับผู้อนุมัติ / กลุ่มภารกิจ: ส่งทันที · สรุปตามรอบ · ปิด
   - ตั้ง `app_url` เพื่อให้การ์ดมีปุ่มเข้าระบบ
   - ปุ่ม "ทดสอบ" ส่งข้อความเข้าหมอพร้อมของผู้กดเอง (ตามเลขบัตรของบัญชีนั้น)
4. รอบสรุปไม่ส่งข้อความถ้าไม่มีใบรออนุมัติ · ประวัติการส่งดูได้ในหน้าเดียวกัน

## API

รายการ endpoint ทั้งหมดพร้อม schema ดูที่ Swagger UI `/docs` — กลุ่มหลัก:

| Prefix | โมดูล |
|---|---|
| `/api/v1/auth`, `/api/v1/mfa` | เข้าสู่ระบบ, OTP / MFA |
| `/api/v1/users`, `/api/v1/system` | ทะเบียนบุคลากร, Master Data (ด้าน / กลุ่มงาน / หน่วยงาน / ตำแหน่ง ฯลฯ) |
| `/api/v1/roles`, `/api/v1/user-roles`, `/api/v1/permissions`, `/api/v1/user-credentials` | สิทธิ์และบัญชีผู้ใช้ |
| `/api/v1/hr`, `/api/v1/hr-posts` | ระบบลา, ผังผู้บริหาร, dashboard HR, ตั้งค่าแจ้งเตือน, ข่าว / เอกสาร HR |
| `/api/v1/it` (`/activity`, `/incident`, `/risk`, `/roadmap`, `/user-requests`), `/api/v1/his` | งานซ่อมคอมพิวเตอร์, HAIT, ขอรหัสผู้ใช้, roadmap, เซสชัน HIS |
| `/api/v1/equipment`, `/api/v1/equipment-v2`, `/api/v1/asset-donation` | ครุภัณฑ์ |
| `/api/v1/accounting` | เงินเดือน, เลขที่เงินเดือน |
| `/api/v1/medical-stat` | สถิติบริการ |
| `/api/v1/modules`, `/api/v1/page-views` | สวิตช์เปิด/ปิดโมดูล, สถิติการเข้าชมหน้า |

ทุก endpoint (ยกเว้นการล็อกอิน) ต้องแนบ Header:
```
Authorization: Bearer <token>
```
สิทธิ์ตาม role ตรวจด้วย `requireRoles(...)` ที่ route หรือใน controller

### Response Format

```json
{ "success": true, "data": { } }
{ "success": false, "message": "..." }
```
HTTP status: `401` ไม่ได้ล็อกอิน / token หมดอายุ · `403` ไม่มีสิทธิ์ · `404` ไม่พบข้อมูล · `500` ข้อผิดพลาดฝั่งเซิร์ฟเวอร์
