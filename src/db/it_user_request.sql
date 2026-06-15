-- ============================================================
-- MODULE: IT User Request — การขอรหัสผู้ใช้งานระบบ
-- DESCRIPTION: บันทึกคำร้องขอบัญชีผู้ใช้งานระบบสารสนเทศของโรงพยาบาล
--              และสถานะการออกรหัสโดยเจ้าหน้าที่ไอที
--              หมายเหตุ: username/password ที่ตั้งให้ผู้ใช้ ส่งแจ้งผ่าน "หมอพร้อม"
--                       ไม่เก็บลงฐานข้อมูล (ตัวตนผู้ใช้ถูกระบุไว้ในระบบแล้ว)
-- PAGE: /information-technology/user-request
-- DATABASE: PostgreSQL
-- SCHEMA: core_kon
-- CREATED: 2026-06-15
--
-- TABLES:
--   1. it_user_systems   — master ระบบที่เปิดให้ขอใช้งาน (HOSxP, Inventory, ...)
--   2. it_user_requests  — fact บันทึกคำร้อง + การออกรหัส (อ้างอิง it_user_systems)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS core_kon;

-- ─────────────────────────────────────────────────────────────
-- TRIGGER FUNCTION: auto-update updated_at on every UPDATE
-- (สร้างไว้แล้วในโมดูลอื่น — CREATE OR REPLACE ปลอดภัยเมื่อรันซ้ำ)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION core_kon.fn_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ─────────────────────────────────────────────────────────────
-- TABLE 1: it_user_systems
-- DESCRIPTION: Master ระบบสารสนเทศที่เปิดให้บุคลากรขอสิทธิ์เข้าใช้งาน
--              ใช้เป็น dropdown "ระบบที่ขอใช้งาน" ในฟอร์ม
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core_kon.it_user_systems (

  id           SMALLINT     NOT NULL GENERATED ALWAYS AS IDENTITY,
  system_code  VARCHAR(40)  NOT NULL,
  name_th      VARCHAR(120) NOT NULL,
  name_en      VARCHAR(120),
  icon_key     VARCHAR(40),
  color        VARCHAR(9),
  sort_order   SMALLINT     NOT NULL DEFAULT 99,
  is_active    CHAR(1)      NOT NULL DEFAULT 'Y',

  PRIMARY KEY (id),
  CONSTRAINT uq_us_system_code  UNIQUE (system_code),
  CONSTRAINT chk_us_is_active   CHECK (is_active IN ('Y','N'))

);

COMMENT ON TABLE  core_kon.it_user_systems             IS 'Master ระบบที่เปิดให้บุคลากรขอสิทธิ์เข้าใช้งาน — ใช้เป็น dropdown ในฟอร์มขอรหัส';
COMMENT ON COLUMN core_kon.it_user_systems.id          IS 'รหัสระบบ (PK)';
COMMENT ON COLUMN core_kon.it_user_systems.system_code IS 'รหัสระบบแบบ slug เช่น hosxp, inventory, wifi (ใช้ใน API/code)';
COMMENT ON COLUMN core_kon.it_user_systems.name_th     IS 'ชื่อระบบที่แสดงในหน้าจอ เช่น HOSxP, โปรแกรมเงินเดือน';
COMMENT ON COLUMN core_kon.it_user_systems.name_en     IS 'ชื่อระบบภาษาอังกฤษ (ถ้ามี)';
COMMENT ON COLUMN core_kon.it_user_systems.icon_key    IS 'คีย์ไอคอนสำหรับ UI เช่น hospital, boxes, bed, building, money, wifi';
COMMENT ON COLUMN core_kon.it_user_systems.color       IS 'สี hex สำหรับไอคอน/แท็กใน UI เช่น #7c3aed';
COMMENT ON COLUMN core_kon.it_user_systems.sort_order  IS 'ลำดับการแสดงผลใน dropdown';
COMMENT ON COLUMN core_kon.it_user_systems.is_active   IS 'Y=ใช้งาน, N=ซ่อนจาก dropdown (Soft Disable)';

-- Seed: ระบบที่เปิดให้ขอใช้งาน 6 รายการ (ตรงกับ SYSTEM_OPTIONS ในหน้าเว็บ)
INSERT INTO core_kon.it_user_systems
  (system_code,  name_th,             name_en,         icon_key,   color,     sort_order)
VALUES
  ('hosxp',      'HOSxP',             'HOSxP',         'hospital', '#7c3aed', 1),
  ('inventory',  'Inventory',         'Inventory',     'boxes',    '#0891b2', 2),
  ('ipd_chart',  'IPD CHART',         'IPD Chart',     'bed',      '#16a34a', 3),
  ('smart_office','Smart Office',     'Smart Office',  'building', '#2563eb', 4),
  ('payroll',    'โปรแกรมเงินเดือน',  'Payroll',       'money',    '#d97706', 5),
  ('wifi',       'WI-FI',             'Wi-Fi',         'wifi',     '#dc2626', 6)
;


-- ─────────────────────────────────────────────────────────────
-- TABLE 2: it_user_requests
-- DESCRIPTION: Fact บันทึกคำร้องขอบัญชีผู้ใช้ + การออกรหัสโดยไอที
--              อ้างอิง it_user_systems (logical relation — ไม่มี FK constraint)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core_kon.it_user_requests (

  -- ─── PRIMARY KEY / เลขที่คำร้อง ───────────────────────────────────
  id                INTEGER       NOT NULL GENERATED ALWAYS AS IDENTITY,
  request_no        VARCHAR(20)   NOT NULL,
  request_date      DATE          NOT NULL DEFAULT CURRENT_DATE,

  -- ─── ผู้ขอใช้งาน (ref → users + snapshot ไว้อ้างอิงย้อนหลัง) ────────
  requester_user_id INTEGER,
  requester_name    VARCHAR(150)  NOT NULL,
  position_name     VARCHAR(150),
  department        VARCHAR(150),
  phone             VARCHAR(30),

  -- ─── ระบบที่ขอใช้งาน (ref → it_user_systems) ──────────────────────
  system_id         SMALLINT      NOT NULL,
  purpose           TEXT,

  -- ─── การออกรหัส (เติมเมื่อ status = issued) ───────────────────────
  -- หมายเหตุ: username/password ที่ตั้งให้ผู้ใช้ ใช้ส่งแจ้งเตือนผ่าน "หมอพร้อม" เท่านั้น
  --           ไม่เก็บลงฐานข้อมูล เพราะตัวตนผู้ใช้ถูกระบุไว้ในระบบอยู่แล้ว
  status            VARCHAR(15)   NOT NULL DEFAULT 'pending',
  issued_by         VARCHAR(100),
  issued_date       DATE,
  notified_at       TIMESTAMP,
  note              TEXT,

  -- ─── METADATA ────────────────────────────────────────────────────
  is_active         CHAR(1)       NOT NULL DEFAULT 'Y',
  created_by        VARCHAR(100),
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by        VARCHAR(100),
  updated_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- ─── CONSTRAINTS ─────────────────────────────────────────────────
  PRIMARY KEY (id),
  CONSTRAINT uq_ur_request_no   UNIQUE (request_no),
  CONSTRAINT chk_ur_status      CHECK (status IN ('pending','issued','rejected','cancelled')),
  CONSTRAINT chk_ur_is_active   CHECK (is_active IN ('Y','N')),
  -- เมื่อออกรหัสแล้ว (issued) ต้องบันทึกผู้ออกและวันที่ออก
  CONSTRAINT chk_ur_issued_meta
    CHECK (status <> 'issued' OR (issued_by IS NOT NULL AND issued_date IS NOT NULL))

);

COMMENT ON TABLE  core_kon.it_user_requests                   IS 'Fact บันทึกคำร้องขอบัญชีผู้ใช้งานระบบ และสถานะการออกรหัส (ตัว username/password ส่งผ่านหมอพร้อม ไม่เก็บใน DB)';
COMMENT ON COLUMN core_kon.it_user_requests.id                IS 'รหัสคำร้อง (PK)';
COMMENT ON COLUMN core_kon.it_user_requests.request_no        IS 'เลขที่คำร้อง สร้างอัตโนมัติ เช่น REQ-202606001';
COMMENT ON COLUMN core_kon.it_user_requests.request_date      IS 'วันที่ยื่นคำร้อง';
COMMENT ON COLUMN core_kon.it_user_requests.requester_user_id IS 'ref → users.id ของผู้ขอ (ดึงข้อมูลจาก /api/v1/users/{id}/info)';
COMMENT ON COLUMN core_kon.it_user_requests.requester_name    IS 'ชื่อ-นามสกุลผู้ขอ (snapshot ณ วันยื่นคำร้อง)';
COMMENT ON COLUMN core_kon.it_user_requests.position_name     IS 'ตำแหน่งของผู้ขอ (snapshot)';
COMMENT ON COLUMN core_kon.it_user_requests.department        IS 'หน่วยงาน/กลุ่มงานของผู้ขอ (snapshot)';
COMMENT ON COLUMN core_kon.it_user_requests.phone             IS 'เบอร์โทรติดต่อผู้ขอ';
COMMENT ON COLUMN core_kon.it_user_requests.system_id         IS 'ref → it_user_systems.id — ระบบที่ขอใช้งาน';
COMMENT ON COLUMN core_kon.it_user_requests.purpose           IS 'วัตถุประสงค์/เหตุผลในการขอใช้งาน';
COMMENT ON COLUMN core_kon.it_user_requests.status            IS 'สถานะ: pending=รอออกรหัส, issued=ออกรหัสแล้ว, rejected=ปฏิเสธ, cancelled=ยกเลิก';
COMMENT ON COLUMN core_kon.it_user_requests.issued_by         IS 'ชื่อเจ้าหน้าที่ไอทีผู้ออกรหัส';
COMMENT ON COLUMN core_kon.it_user_requests.issued_date       IS 'วันที่ออกรหัส';
COMMENT ON COLUMN core_kon.it_user_requests.notified_at       IS 'วันเวลาที่ส่งแจ้ง username/password ให้ผู้ใช้ผ่าน "หมอพร้อม" (ไม่เก็บตัวรหัสผ่านในระบบ)';
COMMENT ON COLUMN core_kon.it_user_requests.note              IS 'หมายเหตุเพิ่มเติม';
COMMENT ON COLUMN core_kon.it_user_requests.is_active         IS 'Soft Delete: Y=ใช้งาน, N=ลบแล้ว';
COMMENT ON COLUMN core_kon.it_user_requests.created_by        IS 'ผู้บันทึกข้อมูล (user login)';
COMMENT ON COLUMN core_kon.it_user_requests.created_at        IS 'วันเวลาที่บันทึกครั้งแรก';
COMMENT ON COLUMN core_kon.it_user_requests.updated_by        IS 'ผู้แก้ไขข้อมูลล่าสุด (user login)';
COMMENT ON COLUMN core_kon.it_user_requests.updated_at        IS 'วันเวลาที่แก้ไขล่าสุด (auto-update via trigger)';

-- Trigger: auto-update updated_at
CREATE TRIGGER trg_ur_updated_at
  BEFORE UPDATE ON core_kon.it_user_requests
  FOR EACH ROW EXECUTE FUNCTION core_kon.fn_set_updated_at();

-- ─── INDEXES ────────────────────────────────────────────────────
CREATE INDEX idx_ur_request_date      ON core_kon.it_user_requests (request_date);
CREATE INDEX idx_ur_status            ON core_kon.it_user_requests (status);
CREATE INDEX idx_ur_system_id         ON core_kon.it_user_requests (system_id);
CREATE INDEX idx_ur_requester_user_id ON core_kon.it_user_requests (requester_user_id);
CREATE INDEX idx_ur_is_active         ON core_kon.it_user_requests (is_active);
