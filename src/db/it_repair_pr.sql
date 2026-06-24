-- ============================================================
-- MODULE: IT Repair PR — บันทึกใบ PR และเอกสารเตรียมนำเสนอผู้อำนวยการ
-- DESCRIPTION: เมื่อหัวหน้ากลุ่มภารกิจอนุมัติให้จัดซื้อ (ผลประเมิน = สั่งซื้ออะไหล่/
--              จ้างภายนอก → process_status_id = 3 "ออกใบ PR") เจ้าหน้าที่ไอทีจะบันทึก
--              เลขที่ใบ PR + รายละเอียดอะไหล่ที่ต้องจัดซื้อ + ติ๊กเอกสารที่จะเสนอ ผอ.
--              เมื่อบันทึกเสร็จ คำร้องเลื่อนไป process_status_id = 7
-- PAGE: /information-technology/repair (modal "บันทึกเอกสารเตรียมนำเสนอ")
-- DATABASE: PostgreSQL
-- SCHEMA: core_kon
-- CREATED: 2026-06-17
--
-- TABLES:
--   1. it_pr_document_types   — master เช็กลิสต์เอกสารที่เสนอ ผอ. (บันทึกข้อความ, ทะเบียนครุภัณฑ์, ...)
--   2. it_repair_prs          — fact บันทึกใบ PR ของคำร้องซ่อม (1 คำร้อง → 1 ใบ PR)
--   3. it_repair_pr_documents — junction ใบ PR แนบเอกสารใดบ้าง (m:n อ้างอิง 1 + 2)
--
-- หมายเหตุ: คงสไตล์โปรเจกต์เดิม — logical relation ไม่มี FK constraint,
--           ผู้บันทึก (created_by/updated_by) เก็บเป็น users.id (INTEGER) ตามโมดูลซ่อม
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
-- TABLE 1: it_pr_document_types
-- DESCRIPTION: Master เช็กลิสต์ "เอกสารที่เสนอผู้อำนวยการ ประกอบด้วย"
--              ใช้ render checkbox ในฟอร์มบันทึกใบ PR (กดเพิ่ม/แก้รายการได้ภายหลัง)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core_kon.it_pr_document_types (

  id          SMALLINT     NOT NULL GENERATED ALWAYS AS IDENTITY,
  doc_code    VARCHAR(40)  NOT NULL,
  name_th     VARCHAR(150) NOT NULL,
  sort_order  SMALLINT     NOT NULL DEFAULT 99,
  is_active   CHAR(1)      NOT NULL DEFAULT 'Y',

  PRIMARY KEY (id),
  CONSTRAINT uq_pdt_doc_code   UNIQUE (doc_code),
  CONSTRAINT chk_pdt_is_active CHECK (is_active IN ('Y','N'))

);

COMMENT ON TABLE  core_kon.it_pr_document_types            IS 'Master รายการเอกสารที่เสนอผู้อำนวยการ — ใช้ render checkbox ในฟอร์มบันทึกใบ PR';
COMMENT ON COLUMN core_kon.it_pr_document_types.id         IS 'รหัสประเภทเอกสาร (PK)';
COMMENT ON COLUMN core_kon.it_pr_document_types.doc_code   IS 'รหัสเอกสารแบบ slug เช่น memo, equipment_register (ใช้ใน API/code)';
COMMENT ON COLUMN core_kon.it_pr_document_types.name_th    IS 'ชื่อเอกสารที่แสดงในหน้าจอ เช่น บันทึกข้อความ, ทะเบียนครุภัณฑ์';
COMMENT ON COLUMN core_kon.it_pr_document_types.sort_order IS 'ลำดับการแสดงผลในเช็กลิสต์';
COMMENT ON COLUMN core_kon.it_pr_document_types.is_active  IS 'Y=ใช้งาน, N=ซ่อนจากเช็กลิสต์ (Soft Disable)';

-- Seed: เอกสารที่เสนอ ผอ. 5 รายการ (ตรงกับเช็กลิสต์ในหน้าเว็บ)
INSERT INTO core_kon.it_pr_document_types
  (doc_code,             name_th,                          sort_order)
VALUES
  ('memo',               'บันทึกข้อความ',                   1),
  ('equipment_register', 'ทะเบียนครุภัณฑ์',                 2),
  ('repair_form',        'ใบซ่อมครุภัณฑ์คอมพิวเตอร์',        3),
  ('quotation',          'ใบเสนอราคาของ บ.',                4),
  ('offplan_purchase',   'ใบขอซื้อนอกแผน',                  5)
;


-- ─────────────────────────────────────────────────────────────
-- TABLE 2: it_repair_prs
-- DESCRIPTION: Fact บันทึกใบ PR ของคำร้องซ่อม (1 คำร้อง → 1 ใบ PR)
--              อ้างอิง it_repair_requests.it_repair_request_id (logical relation)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core_kon.it_repair_prs (

  id                   INTEGER      NOT NULL GENERATED ALWAYS AS IDENTITY,
  it_repair_request_id INTEGER      NOT NULL,
  pr_number            VARCHAR(50)  NOT NULL,
  pr_detail            TEXT,

  -- ─── METADATA ────────────────────────────────────────────────────
  is_active            CHAR(1)      NOT NULL DEFAULT 'Y',
  created_by           INTEGER,
  created_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by           INTEGER,
  updated_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  -- 1 คำร้องซ่อม มีได้ 1 ใบ PR
  CONSTRAINT uq_rpr_request    UNIQUE (it_repair_request_id),
  -- หมายเหตุ: ไม่ตั้ง unique กับ pr_number เพราะเลข PR ใบเดียวอาจครอบหลายคำร้อง
  CONSTRAINT chk_rpr_is_active CHECK (is_active IN ('Y','N'))

);

COMMENT ON TABLE  core_kon.it_repair_prs                      IS 'Fact บันทึกใบ PR (เลขที่ + รายละเอียดจัดซื้อ) ของคำร้องซ่อม — 1 คำร้อง → 1 ใบ PR';
COMMENT ON COLUMN core_kon.it_repair_prs.id                   IS 'รหัสใบ PR (PK)';
COMMENT ON COLUMN core_kon.it_repair_prs.it_repair_request_id IS 'ref → it_repair_requests.it_repair_request_id (1:1, unique)';
COMMENT ON COLUMN core_kon.it_repair_prs.pr_number           IS 'เลขที่ใบ PR เช่น PR-2026-00123 (เลขเดียวอาจครอบหลายคำร้อง จึงไม่ตั้ง unique)';
COMMENT ON COLUMN core_kon.it_repair_prs.pr_detail           IS 'รายละเอียด PR / อะไหล่ที่ต้องการจัดซื้อ (Part Number, จำนวน, ราคาประมาณ)';
COMMENT ON COLUMN core_kon.it_repair_prs.is_active           IS 'Soft Delete: Y=ใช้งาน, N=ลบแล้ว';
COMMENT ON COLUMN core_kon.it_repair_prs.created_by          IS 'ref → users.id ของผู้บันทึกใบ PR';
COMMENT ON COLUMN core_kon.it_repair_prs.created_at          IS 'วันเวลาที่บันทึกครั้งแรก';
COMMENT ON COLUMN core_kon.it_repair_prs.updated_by          IS 'ref → users.id ของผู้แก้ไขล่าสุด';
COMMENT ON COLUMN core_kon.it_repair_prs.updated_at          IS 'วันเวลาที่แก้ไขล่าสุด (auto-update via trigger)';

-- Trigger: auto-update updated_at
CREATE TRIGGER trg_rpr_updated_at
  BEFORE UPDATE ON core_kon.it_repair_prs
  FOR EACH ROW EXECUTE FUNCTION core_kon.fn_set_updated_at();

CREATE INDEX idx_rpr_request_id ON core_kon.it_repair_prs (it_repair_request_id);
CREATE INDEX idx_rpr_is_active  ON core_kon.it_repair_prs (is_active);


-- ─────────────────────────────────────────────────────────────
-- TABLE 3: it_repair_pr_documents
-- DESCRIPTION: Junction ใบ PR แต่ละใบติ๊กเอกสารใดบ้าง (m:n)
--              อ้างอิง it_repair_prs.id + it_pr_document_types.id (logical relation)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE core_kon.it_repair_pr_documents (

  it_repair_pr_id     INTEGER NOT NULL,
  pr_document_type_id SMALLINT NOT NULL,

  -- 1 ใบ PR ติ๊กเอกสารแต่ละชนิดได้ครั้งเดียว
  PRIMARY KEY (it_repair_pr_id, pr_document_type_id)

);

COMMENT ON TABLE  core_kon.it_repair_pr_documents                     IS 'Junction: ใบ PR แต่ละใบแนบเอกสารที่เสนอ ผอ. ชนิดใดบ้าง (m:n)';
COMMENT ON COLUMN core_kon.it_repair_pr_documents.it_repair_pr_id     IS 'ref → it_repair_prs.id';
COMMENT ON COLUMN core_kon.it_repair_pr_documents.pr_document_type_id IS 'ref → it_pr_document_types.id';

CREATE INDEX idx_rprd_doc_type ON core_kon.it_repair_pr_documents (pr_document_type_id);


-- ============================================================
-- หมายเหตุ flow:
--   status 3 (ออกใบ PR)  --[POST /repair-requests/:id/pr]-->  status 7
--   * บันทึก it_repair_prs (pr_number, pr_detail)
--   * บันทึก it_repair_pr_documents ตามเอกสารที่ติ๊ก
--   * เพิ่ม it_repair_requests_track (process_status_id = 7) + แจ้ง MOPH
-- ============================================================
