-- ============================================================
-- MIGRATION: IT User Request — แบบยินยอมเงื่อนไขการใช้งานระบบ (consent form)
-- DESCRIPTION: ผู้ขอรหัสต้องอ่านและยอมรับข้อตกลงการใช้งานระบบสารสนเทศก่อนส่งคำร้อง
--              เก็บฉบับ (version) ของข้อตกลงที่ยอมรับ + เวลา เพื่อพิมพ์แบบยินยอมให้ลงนามภายหลัง
-- PAGE: /home (ขอรหัสผู้ใช้งาน), /information-technology/user-request (พิมพ์แบบยินยอม)
-- DATABASE: PostgreSQL / SCHEMA: core_kon
-- CREATED: 2026-10-27
-- รันซ้ำได้ (IF NOT EXISTS / ON CONFLICT)
-- แก้ข้อความข้อตกลง: เพิ่มฉบับใหม่ (version ใหม่) แล้วตั้ง is_active ฉบับเก่าเป็น 'N'
--                   ห้ามแก้ข้อความฉบับที่มีผู้ยอมรับแล้ว เพื่อให้พิมพ์ย้อนหลังได้ตรงกับที่ยอมรับจริง
-- ============================================================

-- 1) Master ข้อตกลง (ฉบับที่ใช้งานได้ครั้งละ 1 ฉบับ)
CREATE TABLE IF NOT EXISTS core_kon.it_user_consent_terms (
  id          SMALLINT      NOT NULL GENERATED ALWAYS AS IDENTITY,
  version     VARCHAR(20)   NOT NULL,
  title       VARCHAR(200)  NOT NULL,
  clauses     TEXT          NOT NULL,
  is_active   CHAR(1)       NOT NULL DEFAULT 'Y',
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  CONSTRAINT uq_uct_version   UNIQUE (version),
  CONSTRAINT chk_uct_is_active CHECK (is_active IN ('Y','N'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_uct_one_active
  ON core_kon.it_user_consent_terms (is_active) WHERE is_active = 'Y';

COMMENT ON TABLE  core_kon.it_user_consent_terms         IS 'ข้อตกลงและเงื่อนไขการใช้งานระบบสารสนเทศ ที่ผู้ขอรหัสต้องยอมรับ (versioned)';
COMMENT ON COLUMN core_kon.it_user_consent_terms.version IS 'ฉบับของข้อตกลง เช่น 1.0 — ฉบับที่มีผู้ยอมรับแล้วห้ามแก้ข้อความ';
COMMENT ON COLUMN core_kon.it_user_consent_terms.title   IS 'หัวเรื่องแบบยินยอม';
COMMENT ON COLUMN core_kon.it_user_consent_terms.clauses IS 'ข้อตกลง 1 บรรทัด = 1 ข้อ (แสดงเป็นรายการลำดับเลข)';
COMMENT ON COLUMN core_kon.it_user_consent_terms.is_active IS 'Y = ฉบับที่ใช้กับคำร้องใหม่ (มีได้ฉบับเดียว)';

-- 2) คำร้อง: ฉบับที่ยอมรับ + เวลา + วิธียอมรับ
ALTER TABLE core_kon.it_user_requests
  ADD COLUMN IF NOT EXISTS consent_term_id     SMALLINT,
  ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS consent_method      VARCHAR(10);
DO $$ BEGIN
  ALTER TABLE core_kon.it_user_requests
    ADD CONSTRAINT chk_ur_consent_method CHECK (consent_method IS NULL OR consent_method IN ('self','staff'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN core_kon.it_user_requests.consent_term_id     IS 'ref → it_user_consent_terms.id — ฉบับข้อตกลงที่ผู้ขอยอมรับ (NULL = คำร้องก่อนมีแบบยินยอม)';
COMMENT ON COLUMN core_kon.it_user_requests.consent_accepted_at IS 'วันเวลาที่ยอมรับข้อตกลง';
COMMENT ON COLUMN core_kon.it_user_requests.consent_method      IS 'self = ผู้ขอกดยอมรับเองในระบบ, staff = เจ้าหน้าที่ไอทีบันทึกแทน (ผู้ขอลงนามในแบบพิมพ์)';

-- Seed: ข้อตกลงฉบับ 1.0
INSERT INTO core_kon.it_user_consent_terms (version, title, clauses) VALUES (
  '1.0',
  'ข้อตกลงและเงื่อนไขการใช้งานระบบสารสนเทศ โรงพยาบาลพะเยา',
  'ข้าพเจ้าจะเก็บรักษาชื่อผู้ใช้ (username) และรหัสผ่าน (password) เป็นความลับ ไม่เปิดเผยหรืออนุญาตให้ผู้อื่นใช้บัญชีของข้าพเจ้าไม่ว่ากรณีใด และจะเปลี่ยนรหัสผ่านเมื่อเข้าใช้งานครั้งแรก
ข้าพเจ้าจะใช้งานระบบเฉพาะตามหน้าที่ที่ได้รับมอบหมาย และเข้าถึงข้อมูลเท่าที่จำเป็นต่อการปฏิบัติงานเท่านั้น
ข้าพเจ้าจะรักษาความลับข้อมูลผู้ป่วยและข้อมูลส่วนบุคคล ตามพระราชบัญญัติคุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 และพระราชบัญญัติสุขภาพแห่งชาติ พ.ศ. 2550 มาตรา 7
ข้าพเจ้าจะไม่คัดลอก ดาวน์โหลด ถ่ายภาพ ส่งต่อ หรือเผยแพร่ข้อมูลจากระบบ ไปยังบุคคลหรือช่องทางที่ไม่ได้รับอนุญาต
ข้าพเจ้าจะออกจากระบบหรือล็อกหน้าจอทุกครั้งเมื่อไม่อยู่ที่เครื่อง และจะไม่บันทึกรหัสผ่านไว้ในที่ที่ผู้อื่นเห็นได้
กรณีระบบเวชระเบียนอิเล็กทรอนิกส์ (HIS) ข้าพเจ้าจะบันทึกข้อมูลการรักษาในนามของข้าพเจ้าเท่านั้น และรับผิดชอบต่อข้อมูลที่บันทึกภายใต้บัญชีและเลขที่ใบอนุญาตประกอบวิชาชีพของข้าพเจ้า
ข้าพเจ้ารับทราบว่าระบบมีการบันทึกประวัติการใช้งาน (log) ตามพระราชบัญญัติว่าด้วยการกระทำความผิดเกี่ยวกับคอมพิวเตอร์ พ.ศ. 2550 และที่แก้ไขเพิ่มเติม และโรงพยาบาลสามารถตรวจสอบการใช้งานได้
ข้าพเจ้าจะแจ้งงานเทคโนโลยีสารสนเทศทันที เมื่อสงสัยว่ารหัสผ่านรั่วไหลหรือพบการใช้งานผิดปกติ
ข้าพเจ้ารับทราบว่าโรงพยาบาลจะระงับหรือยกเลิกสิทธิ์การใช้งาน เมื่อข้าพเจ้าย้าย ลาออก พ้นจากตำแหน่ง หรือเปลี่ยนหน้าที่
หากข้าพเจ้าฝ่าฝืนข้อตกลงนี้ ยินยอมให้ระงับสิทธิ์การใช้งาน และรับผิดชอบทางวินัยและทางกฎหมายตามที่เกี่ยวข้อง'
) ON CONFLICT (version) DO NOTHING;
