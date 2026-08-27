-- ============================================================================
-- Asset Donation module — schema core_kon
-- ระบบรับบริจาคครุภัณฑ์โรงพยาบาล: Form 1 (ขอรับบริจาค) -> กรรมการ 3 ท่านลงมติ -> Form 2 (ขึ้นทะเบียนโดยพัสดุ)
-- ============================================================================

-- master: หน่วยงานปลายทาง (ใช้ทั้งตอนรับบริจาคและตอนขึ้นทะเบียนเป็นผู้ครอบครองทรัพย์สิน)
CREATE TABLE IF NOT EXISTS donation_departments (
    id     SERIAL PRIMARY KEY,
    name   VARCHAR(200) NOT NULL UNIQUE,
    sort   INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- master: รายชื่อกรรมการรับบริจาค (ปกติ 3 ท่าน) — ผูกกับ users จริง + ตำแหน่งในคณะ
CREATE TABLE IF NOT EXISTS donation_committee_members (
    id                 SERIAL PRIMARY KEY,
    user_id            INT NOT NULL,
    committee_position VARCHAR(100) NOT NULL,   -- ประธานกรรมการ / กรรมการ / กรรมการและเลขานุการ
    sort               INT NOT NULL DEFAULT 0,
    active             BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_donation_committee_members_user ON donation_committee_members(user_id);

CREATE TABLE IF NOT EXISTS donation_forms (
    id                       SERIAL PRIMARY KEY,
    form_code                VARCHAR(30) NOT NULL UNIQUE,        -- DON-2569-0001
    submitted_by_user_id     INT,
    submitted_by_name        VARCHAR(150),
    submitted_by_position    VARCHAR(150),
    submitted_date           DATE NOT NULL DEFAULT CURRENT_DATE,

    donor_name               VARCHAR(200) NOT NULL,
    donor_address            TEXT,
    donor_phone              VARCHAR(50),
    donor_purpose            TEXT,

    receiving_department     VARCHAR(200) NOT NULL,               -- ข้อความรวม (major › submajor) เก็บไว้เพื่อแสดงผล
    major_id                 INT,                                 -- อ้างอิง majors.major_id
    submajor_id              INT,                                 -- อ้างอิง submajors.submajor_id (ถ้ามี)

    donation_type            VARCHAR(10) NOT NULL,               -- new | used

    used_exterior_condition   VARCHAR(20),                       -- ดีมาก|ดี|พอใช้|ทรุดโทรม
    used_tested_working       BOOLEAN,
    used_estimated_age_years  NUMERIC(6,1),
    used_condition_notes      TEXT,
    used_acknowledged_by      VARCHAR(150),
    used_acknowledged_date    DATE,

    status                   VARCHAR(30) NOT NULL DEFAULT 'draft',
        -- draft | pending_approval | pending_registration | rejected | registered
    approval_date            DATE,                               -- วันที่กรรมการสรุปผล (อนุมัติ/ไม่อนุมัติ)

    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_donation_forms_status     ON donation_forms(status);
CREATE INDEX IF NOT EXISTS idx_donation_forms_submitted  ON donation_forms(submitted_by_user_id);
-- migration: หน่วยงานปลายทางอ้างอิง majors/submajors
ALTER TABLE donation_forms ADD COLUMN IF NOT EXISTS major_id    INT;
ALTER TABLE donation_forms ADD COLUMN IF NOT EXISTS submajor_id INT;

CREATE TABLE IF NOT EXISTS donation_items (
    id                       SERIAL PRIMARY KEY,
    donation_form_id         INT NOT NULL REFERENCES donation_forms(id) ON DELETE CASCADE,
    item_no                  INT NOT NULL,
    item_name                VARCHAR(300) NOT NULL,
    item_brand_model         VARCHAR(200),
    item_qty                 NUMERIC(12,2) NOT NULL,
    item_unit                VARCHAR(50) NOT NULL,
    item_est_value           NUMERIC(14,2),
    item_condition_general   VARCHAR(200),

    -- ── เติมตอน Form 2 (ฝ่ายพัสดุ) ──
    asset_registration_no    VARCHAR(100),
    depreciation_start_date  DATE,
    useful_life_years        NUMERIC(6,1),
    custodian_department     VARCHAR(200),
    repair_condition_note    TEXT,
    recorded_by_user_id      INT,
    recorded_date            DATE
);
CREATE INDEX IF NOT EXISTS idx_donation_items_form ON donation_items(donation_form_id);

CREATE TABLE IF NOT EXISTS donation_item_images (
    id                 SERIAL PRIMARY KEY,
    donation_item_id   INT NOT NULL REFERENCES donation_items(id) ON DELETE CASCADE,
    file_name          VARCHAR(255) NOT NULL,   -- ชื่อไฟล์จริงบนดิสก์ (uuid.ext)
    original_name      VARCHAR(255),
    uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_donation_item_images_item ON donation_item_images(donation_item_id);

-- 1 กรรมการ ลงมติได้ 1 ครั้งต่อ 1 ฟอร์ม (กันโหวตซ้ำ)
CREATE TABLE IF NOT EXISTS donation_committee_reviews (
    id                 SERIAL PRIMARY KEY,
    donation_form_id   INT NOT NULL REFERENCES donation_forms(id) ON DELETE CASCADE,
    committee_user_id  INT NOT NULL,
    committee_position VARCHAR(100),
    decision           VARCHAR(20) NOT NULL,     -- approved | rejected
    comment            TEXT NOT NULL,
    reviewed_date      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (donation_form_id, committee_user_id)
);
CREATE INDEX IF NOT EXISTS idx_donation_reviews_form ON donation_committee_reviews(donation_form_id);
