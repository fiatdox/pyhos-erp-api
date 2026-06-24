-- ============================================================
-- MODULE: IT Repair Progress — อัพเดทความคืบหน้างานซ่อม (ระหว่างดำเนินการ)
-- DESCRIPTION: ระหว่าง process_status_id = 2 (กำลังดำเนินการ) ช่างกด "อัพเดทงาน"
--              เพื่อติ๊กขั้นงานย่อยที่ทำเสร็จ + ใส่หมายเหตุความคืบหน้า ได้หลายครั้ง
--              เก็บเป็น history (append-only) — สถานะคงที่ที่ 2 ไม่เลื่อน
-- PAGE: /information-technology/repair (modal "อัพเดทงานที่กำลังทำ")
-- DATABASE: PostgreSQL
-- SCHEMA: core_kon
-- CREATED: 2026-06-17
--
-- TABLES:
--   1. it_repair_work_steps     — master ขั้นงานย่อยที่ติ๊กได้ (ทำบันทึกข้อความ, ทำใบ PR, ...)
--   2. it_repair_progress       — fact 1 แถว = 1 ครั้งที่กดอัพเดท (history) + หมายเหตุ
--   3. it_repair_progress_steps — junction อัพเดทครั้งนั้นติ๊กขั้นงานใดบ้าง (m:n อ้างอิง 1 + 2)
--
-- หมายเหตุ: คงสไตล์โปรเจกต์เดิม — logical relation ไม่มี FK constraint,
--           ผู้บันทึก (created_by) เก็บเป็น users.id (INTEGER) ตามโมดูลซ่อม
--           ตาราง it_repair_progress เป็น append-only จึงไม่มี updated_at/trigger
-- ============================================================

CREATE SCHEMA IF NOT EXISTS core_kon;


-- ─────────────────────────────────────────────────────────────
-- TABLE 1: it_repair_work_steps
-- DESCRIPTION: Master "ขั้นงานที่ทำเสร็จแล้ว" ใช้ render checkbox (เลือกได้หลายอัน)
--              ในฟอร์มอัพเดทความคืบหน้า (กดเพิ่ม/แก้รายการได้ภายหลัง)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core_kon.it_repair_work_steps (

  id          SMALLINT     NOT NULL GENERATED ALWAYS AS IDENTITY,
  step_code   VARCHAR(40)  NOT NULL,
  name_th     VARCHAR(200) NOT NULL,
  sort_order  SMALLINT     NOT NULL DEFAULT 99,
  is_active   CHAR(1)      NOT NULL DEFAULT 'Y',

  PRIMARY KEY (id),
  CONSTRAINT uq_rws_step_code  UNIQUE (step_code),
  CONSTRAINT chk_rws_is_active CHECK (is_active IN ('Y','N'))

);

COMMENT ON TABLE  core_kon.it_repair_work_steps            IS 'Master ขั้นงานย่อยที่ติ๊กว่าทำเสร็จได้ในฟอร์มอัพเดทความคืบหน้างานซ่อม';
COMMENT ON COLUMN core_kon.it_repair_work_steps.id         IS 'รหัสขั้นงาน (PK)';
COMMENT ON COLUMN core_kon.it_repair_work_steps.step_code  IS 'รหัสขั้นงานแบบ slug เช่น memo, pr (ใช้ใน API/code)';
COMMENT ON COLUMN core_kon.it_repair_work_steps.name_th    IS 'ชื่อขั้นงานที่แสดงในหน้าจอ เช่น ทำบันทึกข้อความ, ทำใบ PR';
COMMENT ON COLUMN core_kon.it_repair_work_steps.sort_order IS 'ลำดับการแสดงผลในเช็กลิสต์';
COMMENT ON COLUMN core_kon.it_repair_work_steps.is_active  IS 'Y=ใช้งาน, N=ซ่อนจากเช็กลิสต์ (Soft Disable)';

-- Seed: ขั้นงาน 4 รายการ (ตรงกับเช็กลิสต์ในหน้าเว็บ)
INSERT INTO core_kon.it_repair_work_steps
  (step_code,                  name_th,                                                      sort_order)
VALUES
  ('memo',                     'ทำบันทึกข้อความ',                                              1),
  ('pr',                       'ทำใบ PR',                                                     2),
  ('equipment_register_req',   'แจ้งเตือนให้ขอทะเบียนครุภัณฑ์จากพัสดุ',                          3),
  ('inventory_item_req',       'ขอเพิ่ม item จากระบบ inventory — รออนุมัติจาก ผอ.',             4)
;


-- ─────────────────────────────────────────────────────────────
-- TABLE 2: it_repair_progress
-- DESCRIPTION: Fact บันทึกการอัพเดทความคืบหน้า 1 แถว = 1 ครั้งที่กด "อัพเดทงาน"
--              เก็บเป็น history (append-only) อ้างอิง it_repair_requests (logical relation)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core_kon.it_repair_progress (

  id                   INTEGER      NOT NULL GENERATED ALWAYS AS IDENTITY,
  it_repair_request_id INTEGER      NOT NULL,
  note                 TEXT,

  -- ─── METADATA ────────────────────────────────────────────────────
  is_active            CHAR(1)      NOT NULL DEFAULT 'Y',
  created_by           INTEGER,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  CONSTRAINT chk_rp_is_active CHECK (is_active IN ('Y','N'))

);

COMMENT ON TABLE  core_kon.it_repair_progress                      IS 'Fact บันทึกการอัพเดทความคืบหน้างานซ่อม (append-only history) — 1 แถวต่อ 1 ครั้งที่กดอัพเดท';
COMMENT ON COLUMN core_kon.it_repair_progress.id                   IS 'รหัสการอัพเดท (PK)';
COMMENT ON COLUMN core_kon.it_repair_progress.it_repair_request_id IS 'ref → it_repair_requests.it_repair_request_id';
COMMENT ON COLUMN core_kon.it_repair_progress.note                 IS 'หมายเหตุ/รายละเอียดการดำเนินการจนถึงวันที่อัพเดท (สูงสุด 500 ตัวอักษรจากฟอร์ม)';
COMMENT ON COLUMN core_kon.it_repair_progress.is_active            IS 'Soft Delete: Y=ใช้งาน, N=ยกเลิกรายการอัพเดทนี้';
COMMENT ON COLUMN core_kon.it_repair_progress.created_by           IS 'ref → users.id ของช่างผู้อัพเดท';
COMMENT ON COLUMN core_kon.it_repair_progress.created_at           IS 'วันเวลาที่อัพเดท';

CREATE INDEX idx_rp_request_id ON core_kon.it_repair_progress (it_repair_request_id);
CREATE INDEX idx_rp_created_at ON core_kon.it_repair_progress (created_at);
CREATE INDEX idx_rp_is_active  ON core_kon.it_repair_progress (is_active);


-- ─────────────────────────────────────────────────────────────
-- TABLE 3: it_repair_progress_steps
-- DESCRIPTION: Junction การอัพเดทแต่ละครั้งติ๊กขั้นงานใดบ้าง (m:n)
--              อ้างอิง it_repair_progress.id + it_repair_work_steps.id (logical relation)
--              * ชุดที่ติ๊กของอัพเดทล่าสุด (created_at มากสุด) = สถานะความคืบหน้าปัจจุบัน
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core_kon.it_repair_progress_steps (

  it_repair_progress_id INTEGER  NOT NULL,
  work_step_id          SMALLINT NOT NULL,

  -- 1 การอัพเดท ติ๊กขั้นงานแต่ละชนิดได้ครั้งเดียว
  PRIMARY KEY (it_repair_progress_id, work_step_id)

);

COMMENT ON TABLE  core_kon.it_repair_progress_steps                       IS 'Junction: การอัพเดทความคืบหน้าแต่ละครั้งติ๊กขั้นงานใดบ้าง (m:n)';
COMMENT ON COLUMN core_kon.it_repair_progress_steps.it_repair_progress_id IS 'ref → it_repair_progress.id';
COMMENT ON COLUMN core_kon.it_repair_progress_steps.work_step_id          IS 'ref → it_repair_work_steps.id';

CREATE INDEX idx_rps_work_step ON core_kon.it_repair_progress_steps (work_step_id);


-- ============================================================
-- หมายเหตุ flow:
--   status 2 (กำลังดำเนินการ)  --[POST /repair-requests/:id/progress]-->  status คงที่ 2
--   * INSERT it_repair_progress (note) 1 แถว
--   * INSERT it_repair_progress_steps ตามขั้นงานที่ติ๊ก
--   * เพิ่ม it_repair_requests_track (process_status_id = 2) + แจ้ง MOPH 2 ทาง
--   * อัพเดทได้หลายครั้ง — ชุดติ๊กของแถวล่าสุด = ความคืบหน้าปัจจุบัน
-- ============================================================
