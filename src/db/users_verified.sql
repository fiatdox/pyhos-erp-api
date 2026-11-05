-- users_verified.sql
-- การตรวจสอบข้อมูลบุคลากรโดยงานทรัพยากรบุคคล (หน้า /hr/users)
-- verified_at ว่าง = ยังไม่ตรวจ · ต้องรันก่อนรีสตาร์ต backend เวอร์ชันที่ใช้คอลัมน์นี้

ALTER TABLE core_kon.users
    ADD COLUMN IF NOT EXISTS verified_at timestamptz,
    ADD COLUMN IF NOT EXISTS verified_by integer REFERENCES core_kon.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN core_kon.users.verified_at IS 'เวลาที่งาน HR ตรวจสอบข้อมูลบุคลากรล่าสุด (NULL = ยังไม่ตรวจ)';
COMMENT ON COLUMN core_kon.users.verified_by IS 'ผู้ตรวจสอบข้อมูลบุคลากรล่าสุด';
