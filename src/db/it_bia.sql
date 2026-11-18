-- ============================================================
-- MODULE: IT Business Impact Analysis (BIA) — วิเคราะห์ผลกระทบทางธุรกิจของบริการ/ระบบงานที่พึ่ง IT
-- DESCRIPTION: ทะเบียนบริการสำคัญของโรงพยาบาล พร้อมผลกระทบ 5 ด้าน (1–5), ระดับผลกระทบตามระยะเวลาที่หยุด
--              (1 ชม. / 4 ชม. / 24 ชม. / 72 ชม. / 1 สัปดาห์, 0–5), RTO/RPO, แผนสำรองแบบ manual
--              และสิ่งที่พึ่งพา: ครุภัณฑ์ (asset_key จากทะเบียนทรัพย์สิน IT) และบริการอื่น
--              MTPD (ระยะหยุดนานที่สุดที่รับได้) และระดับความสำคัญ (Tier) คำนวณที่หน้าเว็บจากข้อมูลเหล่านี้
--              ไม่มีลบ — ปิดใช้ (is_active = FALSE) · ทุกการเพิ่ม/แก้เก็บค่าก่อน-หลังใน it_bia_log
-- PAGE: /information-technology/bia
-- DATABASE: PostgreSQL / SCHEMA: core_kon · รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS core_kon.it_bia_services (
    id                  SERIAL PRIMARY KEY,
    name                VARCHAR(150) NOT NULL,
    category            VARCHAR(20)  NOT NULL CHECK (category IN ('clinical', 'support', 'admin', 'infra')),
    owner_department    VARCHAR(255),
    description         TEXT,
    -- ผลกระทบสูงสุดแต่ละด้าน (1 น้อยมาก – 5 รุนแรง)
    impact_patient      SMALLINT NOT NULL CHECK (impact_patient BETWEEN 1 AND 5),
    impact_operation    SMALLINT NOT NULL CHECK (impact_operation BETWEEN 1 AND 5),
    impact_financial    SMALLINT NOT NULL CHECK (impact_financial BETWEEN 1 AND 5),
    impact_legal        SMALLINT NOT NULL CHECK (impact_legal BETWEEN 1 AND 5),
    impact_reputation   SMALLINT NOT NULL CHECK (impact_reputation BETWEEN 1 AND 5),
    -- ระดับผลกระทบเมื่อหยุดนานเท่านี้ (0 ไม่กระทบ – 5 รุนแรง) ต้องไม่ลดลงตามเวลา
    impact_1h           SMALLINT NOT NULL CHECK (impact_1h BETWEEN 0 AND 5),
    impact_4h           SMALLINT NOT NULL CHECK (impact_4h BETWEEN 0 AND 5),
    impact_24h          SMALLINT NOT NULL CHECK (impact_24h BETWEEN 0 AND 5),
    impact_72h          SMALLINT NOT NULL CHECK (impact_72h BETWEEN 0 AND 5),
    impact_1w           SMALLINT NOT NULL CHECK (impact_1w BETWEEN 0 AND 5),
    rto_hours           NUMERIC(6, 1) NOT NULL CHECK (rto_hours >= 0),
    rpo_hours           NUMERIC(6, 1) NOT NULL CHECK (rpo_hours >= 0),
    workaround          TEXT,
    workaround_hours    NUMERIC(6, 1) CHECK (workaround_hours >= 0),
    users_affected      INTEGER CHECK (users_affected >= 0),
    patients_per_day    INTEGER CHECK (patients_per_day >= 0),
    peak_period         VARCHAR(255),
    asset_keys          TEXT[]  NOT NULL DEFAULT '{}',
    depends_on          INTEGER[] NOT NULL DEFAULT '{}',
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    reviewed_at         DATE,
    created_by          INTEGER REFERENCES core_kon.users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by          INTEGER REFERENCES core_kon.users(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT it_bia_impact_not_decreasing CHECK (impact_1h <= impact_4h AND impact_4h <= impact_24h AND impact_24h <= impact_72h AND impact_72h <= impact_1w)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_it_bia_services_name ON core_kon.it_bia_services (LOWER(name));

CREATE TABLE IF NOT EXISTS core_kon.it_bia_log (
    id          SERIAL PRIMARY KEY,
    service_id  INTEGER NOT NULL REFERENCES core_kon.it_bia_services(id),
    action      VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update')),
    before      JSONB,
    after       JSONB,
    changed_by  INTEGER REFERENCES core_kon.users(id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_it_bia_log_service ON core_kon.it_bia_log (service_id, changed_at DESC);

COMMENT ON TABLE  core_kon.it_bia_services IS 'ทะเบียน BIA: บริการ/ระบบงานสำคัญ ผลกระทบ RTO/RPO และสิ่งที่พึ่งพา — ปิดใช้แทนการลบ';
COMMENT ON COLUMN core_kon.it_bia_services.category   IS 'clinical บริการผู้ป่วย · support สนับสนุนบริการ · admin บริหาร · infra โครงสร้างพื้นฐาน IT';
COMMENT ON COLUMN core_kon.it_bia_services.asset_keys IS 'ครุภัณฑ์ที่บริการนี้พึ่งพา: <ทะเบียน>:<เลขครุภัณฑ์> (ดู /api/v1/it/assets)';
COMMENT ON COLUMN core_kon.it_bia_services.depends_on IS 'id ของบริการอื่นใน it_bia_services ที่บริการนี้ต้องใช้ (เช่น ทุกระบบพึ่ง "เครือข่าย")';
