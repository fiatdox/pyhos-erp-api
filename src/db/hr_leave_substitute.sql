-- ── ผู้ปฏิบัติหน้าที่แทนระหว่างลา ──────────────────────────────────────────────
--
-- ผู้ลาเลือกจากรายชื่อบุคลากรตอนยื่นใบลา (ไม่บังคับ) — พิมพ์ลงแบบใบลา "และได้มอบหมายให้ ... เป็นผู้ปฏิบัติหน้าที่แทนระหว่างลา"
--
-- รันซ้ำได้

ALTER TABLE core_kon.hr_leave_requests
    ADD COLUMN IF NOT EXISTS substitute_user_id integer REFERENCES core_kon.users(id);
