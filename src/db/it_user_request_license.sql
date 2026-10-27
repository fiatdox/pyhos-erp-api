-- ============================================================
-- MIGRATION: IT User Request — เลขที่ใบอนุญาตประกอบวิชาชีพ
-- DESCRIPTION: ระบบ HIS (HOSxP) ต้องผูกผู้ใช้กับเลขใบอนุญาตประกอบวิชาชีพ
--              สำหรับตำแหน่งวิชาชีพ (แพทย์ ทันตแพทย์ เภสัชกร พยาบาล นักเทคนิคการแพทย์ ฯลฯ)
--              คำร้องขอรหัสของตำแหน่งเหล่านี้จึงบังคับกรอกเลขใบอนุญาต
-- PAGE: /home (ขอรหัสผู้ใช้งาน), /information-technology/user-request
-- DATABASE: PostgreSQL / SCHEMA: core_kon
-- CREATED: 2026-10-27
-- รันซ้ำได้ (IF NOT EXISTS / UPDATE แบบกำหนดค่า)
-- ============================================================

-- 1) ตำแหน่ง: ประเภทใบอนุญาตที่ต้องใช้ (NULL = ไม่ต้องใช้)
ALTER TABLE core_kon.user_positions
  ADD COLUMN IF NOT EXISTS license_type VARCHAR(60);
COMMENT ON COLUMN core_kon.user_positions.license_type IS
  'ใบอนุญาตประกอบวิชาชีพที่ตำแหน่งนี้ต้องใช้ เช่น เวชกรรม, การพยาบาล (NULL = ไม่ต้องใช้) — บังคับกรอกเมื่อขอรหัสระบบที่ requires_license = Y';

-- 2) ระบบ: ต้องใช้เลขใบอนุญาตหรือไม่
ALTER TABLE core_kon.it_user_systems
  ADD COLUMN IF NOT EXISTS requires_license CHAR(1) NOT NULL DEFAULT 'N';
DO $$ BEGIN
  ALTER TABLE core_kon.it_user_systems
    ADD CONSTRAINT chk_us_requires_license CHECK (requires_license IN ('Y','N'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN core_kon.it_user_systems.requires_license IS
  'Y = ระบบ HIS ที่ต้องผูกเลขใบอนุญาตประกอบวิชาชีพ (บังคับเฉพาะตำแหน่งที่มี license_type)';

-- 3) คำร้อง: snapshot ประเภท + เลขใบอนุญาต ณ วันยื่น
ALTER TABLE core_kon.it_user_requests
  ADD COLUMN IF NOT EXISTS license_type VARCHAR(60),
  ADD COLUMN IF NOT EXISTS license_no   VARCHAR(30);
COMMENT ON COLUMN core_kon.it_user_requests.license_type IS 'ประเภทใบอนุญาตประกอบวิชาชีพของตำแหน่ง (snapshot)';
COMMENT ON COLUMN core_kon.it_user_requests.license_no   IS 'เลขที่ใบอนุญาตประกอบวิชาชีพ — บังคับเมื่อระบบ requires_license = Y และตำแหน่งมี license_type';

-- Seed: ระบบ HIS
UPDATE core_kon.it_user_systems SET requires_license = 'Y' WHERE system_code = 'hosxp';

-- Seed: ตำแหน่งวิชาชีพที่มีใบอนุญาต (ตามชื่อตำแหน่งใน user_positions)
UPDATE core_kon.user_positions p SET license_type = v.license_type
FROM (VALUES
  ('นายแพทย์',              'เวชกรรม'),
  ('ทันตแพทย์',             'ทันตกรรม'),
  ('เภสัชกร',               'เภสัชกรรม'),
  ('พยาบาลวิชาชีพ',         'การพยาบาลและการผดุงครรภ์'),
  ('พยาบาลเทคนิค',          'การพยาบาล'),
  ('นักเทคนิคการแพทย์',      'เทคนิคการแพทย์'),
  ('นักกายภาพบำบัด',        'กายภาพบำบัด'),
  ('นักกิจกรรมบำบัด',       'การประกอบโรคศิลปะ สาขากิจกรรมบำบัด'),
  ('นักรังสีการแพทย์',       'การประกอบโรคศิลปะ สาขารังสีเทคนิค'),
  ('นักจิตวิทยาคลินิก',      'การประกอบโรคศิลปะ สาขาจิตวิทยาคลินิก'),
  ('แพทย์แผนไทย',           'การแพทย์แผนไทย')
) AS v(position_name, license_type)
WHERE p.position_name = v.position_name AND p.license_type IS DISTINCT FROM v.license_type;
