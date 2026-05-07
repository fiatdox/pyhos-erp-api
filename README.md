# ERP API (Core Kon)

REST API สำหรับระบบ ERP พัฒนาด้วย [Bun](https://bun.sh) + [Elysia](https://elysiajs.com) + PostgreSQL

## Tech Stack

| ส่วนประกอบ | เทคโนโลยี |
|---|---|
| Runtime | Bun |
| Framework | Elysia |
| Database | PostgreSQL (via `postgres`) |
| Auth | JWT (8 ชั่วโมง) |
| Password Hashing | Argon2id (Bun built-in) |
| API Docs | Swagger UI (`/docs`) |

## โครงสร้างโปรเจกต์

```
src/
├── controllers/
│   ├── authController.ts       # Login
│   ├── userController.ts       # จัดการผู้ใช้
│   └── systemController.ts     # ข้อมูล Master Data
├── routes/
│   ├── authRoutes.ts
│   ├── userRoutes.ts
│   └── systemRoutes.ts
├── middlewares/
│   ├── authMiddleware.ts       # ตรวจสอบ JWT
│   ├── corsMiddleware.ts
│   ├── loggerMiddleware.ts
│   └── securityMiddleware.ts
├── db/
│   └── db.ts                  # PostgreSQL connection pool
└── index.ts
```

## ติดตั้งและเริ่มใช้งาน

```bash
# ติดตั้ง dependencies
bun install

# รัน development server (auto-reload)
bun run dev
```

Server จะรันที่ `http://localhost:5000`
Swagger UI: `http://localhost:5000/docs`

## Environment Variables

สร้างไฟล์ `.env` ที่ root ของโปรเจกต์:

```env
PORT=5000
JWT_SECRET=your-secret-key

CORE_KON_HOST=localhost
CORE_KON_PORT=5432
CORE_KON_USER=postgres
CORE_KON_PASSWORD=your-password
CORE_KON_DB_NAME=your-database
CORE_KON_SCHEMA=public
```

## API Endpoints

ทุก endpoint (ยกเว้น `/auth/login`) ต้องแนบ Header:
```
Authorization: Bearer <token>
```

### Auth

| Method | Path | คำอธิบาย |
|--------|------|----------|
| POST | `/api/v1/auth/login` | เข้าสู่ระบบ รับ JWT token |

**Request body:**
```json
{ "username": "string", "password": "string" }
```

**Response:**
```json
{
  "success": true,
  "token": "...",
  "weak": false,
  "data": {
    "id": 1,
    "username": "string",
    "name": "string",
    "mission_name": "string",
    "major_name": "string",
    "position_name": "string"
  }
}
```

> `weak: true` หมายถึงรหัสผ่านยังเป็นค่าเริ่มต้นควรแจ้งให้ผู้ใช้เปลี่ยน

---

### Users

| Method | Path | คำอธิบาย |
|--------|------|----------|
| GET | `/api/v1/users` | ดึงรายชื่อผู้ใช้ทั้งหมด |
| GET | `/api/v1/users/:id` | ดึงข้อมูลผู้ใช้ตาม ID |
| POST | `/api/v1/users` | สร้างผู้ใช้ใหม่ |
| PUT | `/api/v1/users/:id` | อัปเดตข้อมูลผู้ใช้ |
| PATCH | `/api/v1/users/:id/deactivate` | ปิดการใช้งานผู้ใช้ |
| PATCH | `/api/v1/users/:id/activate` | เปิดการใช้งานผู้ใช้ |

---

### System (Master Data)

| Method | Path | คำอธิบาย |
|--------|------|----------|
| GET | `/api/v1/system/missions` | ดึงภารกิจทั้งหมด |
| GET | `/api/v1/system/missions/:id` | ดึงภารกิจตาม ID |
| GET | `/api/v1/system/missions/:id/majors` | ดึงกลุ่มงานของภารกิจ |
| GET | `/api/v1/system/majors` | ดึงกลุ่มงานทั้งหมด |
| GET | `/api/v1/system/majors/:id` | ดึงกลุ่มงานตาม ID |
| GET | `/api/v1/system/majors/:id/submajors` | ดึงกลุ่มงานย่อยของกลุ่มงาน |
| GET | `/api/v1/system/submajors` | ดึงกลุ่มงานย่อยทั้งหมด |
| GET | `/api/v1/system/submajors/:id` | ดึงกลุ่มงานย่อยตาม ID |
| GET | `/api/v1/system/levels` | ดึงระดับผู้ใช้ทั้งหมด |
| GET | `/api/v1/system/levels/:id` | ดึงระดับผู้ใช้ตาม ID |
| GET | `/api/v1/system/positions` | ดึงตำแหน่งทั้งหมด |
| GET | `/api/v1/system/positions/:id` | ดึงตำแหน่งตาม ID |
| GET | `/api/v1/system/user-types` | ดึงประเภทผู้ใช้ทั้งหมด |
| GET | `/api/v1/system/user-types/:id` | ดึงประเภทผู้ใช้ตาม ID |
| GET | `/api/v1/system/user-statuses` | ดึงสถานะผู้ใช้ทั้งหมด |
| GET | `/api/v1/system/user-statuses/:id` | ดึงสถานะผู้ใช้ตาม ID |

---

## Response Format

**สำเร็จ:**
```json
{ "success": true, "data": { } }
```

**ไม่พบข้อมูล (404):**
```json
{ "success": false, "message": "... not found" }
```

**ไม่ได้รับอนุญาต (401):**
```json
{ "success": false, "message": "Unauthorized" }
```

**เกิดข้อผิดพลาด (500):**
```json
{ "success": false, "message": "error message" }
```
