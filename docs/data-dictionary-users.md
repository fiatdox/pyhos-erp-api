# Data Dictionary — โครงสร้างองค์กรและผู้ใช้งาน

ฐานข้อมูล: `hris` · Schema: `core_kon`
เอกสารนี้อธิบายโครงสร้างตารางกลุ่มผู้ใช้งานและโครงสร้างองค์กร ปรับปรุงล่าสุด: 2026-07-01

## สารบัญตาราง

| ตาราง | คำอธิบาย | จำนวนแถว (ณ วันจัดทำ) |
|-------|----------|----------------------|
| [users](#users) | ข้อมูลบุคลากร/ผู้ใช้งานระบบ | 1,280 |
| [user_positions](#user_positions) | ตำแหน่งงาน (lookup) | 100 |
| [user_types](#user_types) | ประเภทบุคลากร (lookup) | 6 |
| [user_statuses](#user_statuses) | สถานะการปฏิบัติงาน (lookup) | 10 |
| [user_levels](#user_levels) | ระดับตำแหน่ง (lookup) | 17 |
| [missions](#missions) | กลุ่มภารกิจ (ระดับบนสุดของโครงสร้าง) | 7 |
| [majors](#majors) | กลุ่มงาน (สังกัดกลุ่มภารกิจ) | 62 |
| [submajors](#submajors) | งาน/หน่วยงานย่อย (สังกัดกลุ่มงาน) | 86 |

## แผนผังความสัมพันธ์

```
missions (กลุ่มภารกิจ)
   └─< majors (กลุ่มงาน)              majors.mission_id → missions.mission_id
         └─< submajors (งานย่อย)      submajors.major_id → majors.major_id

users (บุคลากร)
   ├─ user_type_id     → user_types.user_type_id       [FK]
   ├─ user_position_id → user_positions.user_position_id [FK]
   ├─ user_level_id    → user_levels.user_level_id      [FK]
   ├─ user_status_id   → user_statuses.user_status_id   [FK]
   ├─ mission_id       → missions.mission_id            [FK]
   ├─ major_id         → majors.major_id                (ความสัมพันธ์เชิงตรรกะ)
   └─ submajor_id      → submajors.submajor_id          (ความสัมพันธ์เชิงตรรกะ)

หัวหน้าหน่วยงาน (missions / majors / submajors):
   supervisor_id, acting_supervisor_id → users.id       (ความสัมพันธ์เชิงตรรกะ)
```

> **หมายเหตุ:** เฉพาะ 5 คอลัมน์ในตาราง `users` (`user_type_id`, `user_position_id`, `user_level_id`, `user_status_id`, `mission_id`) มี FOREIGN KEY constraint จริงในฐานข้อมูล ส่วน `major_id`, `submajor_id`, และ `supervisor_id`/`acting_supervisor_id` เป็นความสัมพันธ์เชิงตรรกะ (ยังไม่ได้ประกาศ FK)

---

## users

ข้อมูลบุคลากรและบัญชีผู้ใช้งานระบบ · PK: `id` · UNIQUE: `username`, `id_card`

| # | คอลัมน์ | ชนิดข้อมูล | Null | ค่า Default | คำอธิบาย |
|---|---------|-----------|:----:|------------|----------|
| 1 | id | integer | NO | auto (sequence) | รหัสผู้ใช้ (Primary Key) |
| 2 | pname | varchar(20) | YES | | คำนำหน้าชื่อ (นาย/นาง/นางสาว) |
| 3 | fname | varchar(100) | NO | | ชื่อจริง |
| 4 | lname | varchar(100) | NO | | นามสกุล |
| 5 | id_card | varchar(13) | YES | | เลขบัตรประชาชน 13 หลัก (UNIQUE) |
| 6 | gender | varchar(10) | YES | | เพศ |
| 7 | birthday | date | YES | | วันเกิด |
| 8 | hire_date | date | YES | | วันที่เริ่มปฏิบัติงาน |
| 9 | user_type_id | integer | YES | | ประเภทบุคลากร → `user_types` |
| 10 | user_position_id | integer | YES | | ตำแหน่งงาน → `user_positions` |
| 11 | user_level_id | integer | YES | | ระดับตำแหน่ง → `user_levels` |
| 12 | user_status_id | integer | YES | | สถานะการปฏิบัติงาน → `user_statuses` |
| 13 | mission_id | integer | YES | | กลุ่มภารกิจที่สังกัด → `missions` |
| 14 | major_id | integer | YES | | กลุ่มงานที่สังกัด → `majors` |
| 15 | submajor_id | integer | YES | | งานย่อยที่สังกัด → `submajors` |
| 16 | attendance_id | integer | YES | | รหัสอ้างอิงระบบลงเวลา |
| 17 | salary_id | integer | YES | | รหัสอ้างอิงระบบเงินเดือน |
| 18 | username | varchar(50) | NO | | ชื่อผู้ใช้เข้าระบบ (UNIQUE) |
| 19 | password | varchar(255) | NO | | รหัสผ่าน (hash แบบ argon2id) |
| 20 | is_active | char(1) | NO | `'Y'` | สถานะใช้งานบัญชี (Y/N) |
| 21 | created_at | timestamptz | NO | `now()` | วันเวลาที่สร้างระเบียน |
| 22 | updated_at | timestamptz | NO | `now()` | วันเวลาที่แก้ไขล่าสุด |
| 23 | hospital_lc_pid | smallint | YES | | รหัสหน่วยบริการ (โรงพยาบาล) |

---

## user_positions

ตารางอ้างอิงตำแหน่งงาน · PK: `user_position_id`

| # | คอลัมน์ | ชนิดข้อมูล | Null | ค่า Default | คำอธิบาย |
|---|---------|-----------|:----:|------------|----------|
| 1 | user_position_id | integer | NO | auto (sequence) | รหัสตำแหน่ง (Primary Key) |
| 2 | position_name | varchar(100) | NO | | ชื่อตำแหน่ง เช่น นักวิชาการคอมพิวเตอร์, นายแพทย์ |
| 3 | created_at | timestamptz | NO | `now()` | วันเวลาที่สร้างระเบียน |

---

## user_types

ตารางอ้างอิงประเภทบุคลากร · PK: `user_type_id`

| # | คอลัมน์ | ชนิดข้อมูล | Null | ค่า Default | คำอธิบาย |
|---|---------|-----------|:----:|------------|----------|
| 1 | user_type_id | integer | NO | auto (sequence) | รหัสประเภทบุคลากร (Primary Key) |
| 2 | type_name | varchar(100) | NO | | ชื่อประเภทบุคลากร |
| 3 | created_at | timestamptz | NO | `now()` | วันเวลาที่สร้างระเบียน |

**ค่าในระบบ:**

| user_type_id | type_name |
|:---:|---|
| 1 | ข้าราชการ |
| 2 | พนักงานราชการ |
| 3 | ลูกจ้างประจำ |
| 4 | พนักงานกระทรวงสาธารณสุข |
| 5 | ลูกจ้างชั่วคราวรายเดือน |
| 6 | ลูกจ้างชั่วคราวรายวัน |

---

## user_statuses

ตารางอ้างอิงสถานะการปฏิบัติงาน · PK: `user_status_id`

| # | คอลัมน์ | ชนิดข้อมูล | Null | ค่า Default | คำอธิบาย |
|---|---------|-----------|:----:|------------|----------|
| 1 | user_status_id | integer | NO | auto (sequence) | รหัสสถานะ (Primary Key) |
| 2 | name | varchar(100) | NO | | ชื่อสถานะการปฏิบัติงาน |
| 3 | is_active | char(1) | NO | `'Y'` | สถานะการใช้งานรายการ (Y/N) |
| 4 | created_at | timestamptz | NO | `now()` | วันเวลาที่สร้างระเบียน |

**ค่าในระบบ:**

| user_status_id | name |
|:---:|---|
| 1 | ปฏิบัติงาน |
| 2 | ลาออก |
| 3 | เกษียณอายุราชการ |
| 4 | โอนย้าย |
| 5 | ช่วยราชการ |
| 6 | ถูกให้ออก |
| 7 | ไล่ออก |
| 8 | พักราชการ |
| 9 | ลาศึกษาต่อ |
| 10 | เสียชีวิต |

---

## user_levels

ตารางอ้างอิงระดับตำแหน่ง · PK: `user_level_id`

| # | คอลัมน์ | ชนิดข้อมูล | Null | ค่า Default | คำอธิบาย |
|---|---------|-----------|:----:|------------|----------|
| 1 | user_level_id | integer | NO | auto (sequence) | รหัสระดับตำแหน่ง (Primary Key) |
| 2 | level_name | varchar(100) | NO | | ชื่อระดับตำแหน่ง |
| 3 | created_at | timestamptz | NO | `now()` | วันเวลาที่สร้างระเบียน |

**ค่าในระบบ:**

| user_level_id | level_name | | user_level_id | level_name |
|:---:|---|---|:---:|---|
| 1 | ปฏิบัติงาน | | 10 | บ 2 |
| 2 | ปฏิบัติการ | | 11 | บ 3 |
| 3 | ชำนาญงาน | | 12 | ส 1 |
| 4 | ชำนาญการ | | 13 | ส 2 |
| 5 | ชำนาญการพิเศษ | | 14 | ส 3 |
| 6 | เชี่ยวชาญ | | 15 | ส 4 |
| 7 | อำนวยการสูง | | 16 | ช1 |
| 8 | ช 2 | | 17 | - |
| 9 | ช 3 | | | |

---

## missions

กลุ่มภารกิจ — ระดับบนสุดของโครงสร้างองค์กร · PK: `mission_id`

| # | คอลัมน์ | ชนิดข้อมูล | Null | ค่า Default | คำอธิบาย |
|---|---------|-----------|:----:|------------|----------|
| 1 | mission_id | integer | NO | auto (sequence) | รหัสกลุ่มภารกิจ (Primary Key) |
| 2 | name | varchar(200) | NO | | ชื่อกลุ่มภารกิจ |
| 3 | supervisor_id | integer | YES | | หัวหน้ากลุ่มภารกิจ → `users.id` |
| 4 | acting_supervisor_id | integer | YES | | ผู้รักษาการหัวหน้า → `users.id` |
| 5 | moph_secret_id | varchar(255) | YES | | MOPH Secret ID (สำหรับแจ้งเตือน MOPH) |
| 6 | moph_client_id | varchar(255) | YES | | MOPH Client ID (สำหรับแจ้งเตือน MOPH) |
| 7 | is_active | char(1) | NO | `'Y'` | สถานะการใช้งาน (Y/N) |
| 8 | created_at | timestamptz | NO | `now()` | วันเวลาที่สร้างระเบียน |
| 9 | updated_at | timestamptz | NO | `now()` | วันเวลาที่แก้ไขล่าสุด |

**ค่าในระบบ:**

| mission_id | name |
|:---:|---|
| 1 | ด้านอำนวยการ |
| 2 | ด้านการพยาบาล |
| 3 | ด้านบริการทุติยภูมิและตติยภูมิ |
| 4 | ด้านบริการปฐมภูมิ |
| 5 | ด้านพัฒนาระบบบริการและสนับสนุนบริการสุขภาพ |
| 6 | ด้านผลิตบุคลากรทางการแพทย์ |
| 7 | ด้านดิจิทัลทางการแพทย์และสุขภาพ |

---

## majors

กลุ่มงาน — สังกัดกลุ่มภารกิจ · PK: `major_id`

| # | คอลัมน์ | ชนิดข้อมูล | Null | ค่า Default | คำอธิบาย |
|---|---------|-----------|:----:|------------|----------|
| 1 | major_id | integer | NO | auto (sequence) | รหัสกลุ่มงาน (Primary Key) |
| 2 | mission_id | integer | NO | | กลุ่มภารกิจที่สังกัด → `missions.mission_id` |
| 3 | name | varchar(200) | NO | | ชื่อกลุ่มงาน |
| 4 | supervisor_id | integer | YES | | หัวหน้ากลุ่มงาน → `users.id` |
| 5 | acting_supervisor_id | integer | YES | | ผู้รักษาการหัวหน้า → `users.id` |
| 6 | moph_secret_id | varchar(255) | YES | | MOPH Secret ID (สำหรับแจ้งเตือน MOPH) |
| 7 | moph_client_id | varchar(255) | YES | | MOPH Client ID (สำหรับแจ้งเตือน MOPH) |
| 8 | is_active | char(1) | NO | `'Y'` | สถานะการใช้งาน (Y/N) |
| 9 | created_at | timestamptz | NO | `now()` | วันเวลาที่สร้างระเบียน |
| 10 | updated_at | timestamptz | NO | `now()` | วันเวลาที่แก้ไขล่าสุด |

> ตัวอย่าง: กลุ่มงานเทคโนโลยีสารสนเทศ (`major_id = 71`) สังกัด `mission_id = 7` (ด้านดิจิทัลทางการแพทย์และสุขภาพ)

---

## submajors

งาน/หน่วยงานย่อย — สังกัดกลุ่มงาน · PK: `submajor_id`

| # | คอลัมน์ | ชนิดข้อมูล | Null | ค่า Default | คำอธิบาย |
|---|---------|-----------|:----:|------------|----------|
| 1 | submajor_id | integer | NO | auto (sequence) | รหัสงานย่อย (Primary Key) |
| 2 | major_id | integer | NO | | กลุ่มงานที่สังกัด → `majors.major_id` |
| 3 | name | varchar(200) | NO | | ชื่องาน/หน่วยงานย่อย |
| 4 | supervisor_id | integer | YES | | หัวหน้างาน → `users.id` |
| 5 | acting_supervisor_id | integer | YES | | ผู้รักษาการหัวหน้า → `users.id` |
| 6 | moph_secret_id | varchar(255) | YES | | MOPH Secret ID (สำหรับแจ้งเตือน MOPH) |
| 7 | moph_client_id | varchar(255) | YES | | MOPH Client ID (สำหรับแจ้งเตือน MOPH) |
| 8 | is_active | char(1) | NO | `'Y'` | สถานะการใช้งาน (Y/N) |
| 9 | created_at | timestamptz | NO | `now()` | วันเวลาที่สร้างระเบียน |
| 10 | updated_at | timestamptz | NO | `now()` | วันเวลาที่แก้ไขล่าสุด |
