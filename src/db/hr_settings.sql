-- ============================================================
-- MODULE: HR Settings — ตาราง key-value เก็บค่าตั้งค่าของ HR
--         เริ่มใช้กับการแต่งตั้ง ผอ. และ รักษาการ ผอ.
-- PAGE: /hr/settings/supervisor
-- DATABASE: PostgreSQL / SCHEMA: core_kon
-- ============================================================

CREATE TABLE IF NOT EXISTS core_kon.hr_settings (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(50)  NOT NULL UNIQUE,
  description VARCHAR(255),
  value       VARCHAR(255),
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by  INTEGER,
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by  INTEGER
);

COMMENT ON TABLE  core_kon.hr_settings            IS 'Key-value ตั้งค่าของ HR เช่น director_id (ผอ.), acting_director_id (รักษาการ ผอ.)';
COMMENT ON COLUMN core_kon.hr_settings.name        IS 'ชื่อ key เช่น director_id, acting_director_id';
COMMENT ON COLUMN core_kon.hr_settings.description IS 'คำอธิบายว่า key นี้เก็บอะไร (แสดงในหน้า settings ได้)';
COMMENT ON COLUMN core_kon.hr_settings.value      IS 'ค่าเป็น string (director_id เก็บ users.id) — NULL = ยังไม่ตั้ง/ถอดถอน';
COMMENT ON COLUMN core_kon.hr_settings.created_by IS 'ref → users.id ผู้สร้าง key';
COMMENT ON COLUMN core_kon.hr_settings.updated_by IS 'ref → users.id ผู้แก้ไขล่าสุด (คนแต่งตั้งครั้งล่าสุด)';

-- Seed key เริ่มต้น (ยังไม่กำหนดตัวบุคคล)
INSERT INTO core_kon.hr_settings (name, description, value)
VALUES
  ('director_id',        'ผู้อำนวยการ — เก็บ users.id ของผู้ดำรงตำแหน่ง',        NULL),
  ('acting_director_id', 'รักษาการผู้อำนวยการ — เก็บ users.id ของผู้รักษาการ', NULL)
ON CONFLICT (name) DO NOTHING;

-- ============================================================
-- การใช้งาน:
--   แต่งตั้ง   → INSERT ... ON CONFLICT (name) DO UPDATE
--               SET value = EXCLUDED.value, updated_at = now(), updated_by = <user_id>
--   ถอดถอน   → UPDATE ... SET value = NULL, updated_at = now(), updated_by = <user_id>
--   อ่านค่า    → SELECT name, value FROM core_kon.hr_settings
--               WHERE name IN ('director_id','acting_director_id')
-- ============================================================
