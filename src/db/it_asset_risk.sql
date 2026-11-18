-- ============================================================
-- MODULE: IT Asset Risk — ประเมินความเสี่ยงทรัพย์สินงาน IT
-- DESCRIPTION: ผลประเมินความเสี่ยงรายครุภัณฑ์คอมพิวเตอร์ (โอกาส × ผลกระทบ 5×5) พร้อมภัยคุกคาม มาตรการควบคุม
--              แนวทางจัดการ ผู้รับผิดชอบ กำหนดเสร็จ และวันทบทวน
--              เก็บแบบเพิ่มแถวทุกครั้ง (ไม่แก้ทับ) — ผลปัจจุบัน = แถวล่าสุดของครุภัณฑ์ ที่เหลือเป็นประวัติ
--              ครุภัณฑ์อ้างด้วย asset_key = '<ทะเบียน>:<เลขครุภัณฑ์>' (v3 / v2) เพราะข้อมูลครุภัณฑ์อยู่คนละฐาน (MySQL)
--              ชื่อ/ชนิด/หน่วยงานเก็บ snapshot ณ วันประเมิน · suggested_* = ค่าที่ระบบเสนอ ณ วันประเมิน (ไว้ตรวจย้อน)
-- PAGE: /information-technology/assets/risk
-- DATABASE: PostgreSQL / SCHEMA: core_kon · รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS core_kon.it_asset_risk_assessments (
    id                   SERIAL PRIMARY KEY,
    asset_key            VARCHAR(80)  NOT NULL,
    source               VARCHAR(2)   NOT NULL CHECK (source IN ('v3', 'v2')),
    noid                 VARCHAR(60)  NOT NULL,
    asset_name           VARCHAR(255),
    asset_kind           VARCHAR(20),
    department           VARCHAR(255),
    likelihood           SMALLINT     NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
    impact               SMALLINT     NOT NULL CHECK (impact BETWEEN 1 AND 5),
    score                SMALLINT     GENERATED ALWAYS AS (likelihood * impact) STORED,
    suggested_likelihood SMALLINT     CHECK (suggested_likelihood BETWEEN 1 AND 5),
    suggested_impact     SMALLINT     CHECK (suggested_impact BETWEEN 1 AND 5),
    threats              TEXT[]       NOT NULL DEFAULT '{}',
    controls             TEXT,
    treatment            VARCHAR(20)  NOT NULL CHECK (treatment IN ('accept', 'mitigate', 'replace', 'transfer', 'avoid')),
    treatment_plan       TEXT,
    owner_name           VARCHAR(150),
    due_date             DATE,
    next_review          DATE,
    notes                TEXT,
    assessed_by          INTEGER REFERENCES core_kon.users(id),
    assessed_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_it_asset_risk_key ON core_kon.it_asset_risk_assessments (asset_key, assessed_at DESC, id DESC);

COMMENT ON TABLE  core_kon.it_asset_risk_assessments IS 'ผลประเมินความเสี่ยงทรัพย์สินงาน IT รายครุภัณฑ์ — เพิ่มแถวทุกครั้ง แถวล่าสุดของ asset_key = ผลปัจจุบัน';
COMMENT ON COLUMN core_kon.it_asset_risk_assessments.asset_key IS '<ทะเบียน>:<เลขครุภัณฑ์> เช่น v3:7440-001-0001/1';
COMMENT ON COLUMN core_kon.it_asset_risk_assessments.threats   IS 'รหัสภัยคุกคาม: hw_failure power malware unauthorized theft disaster eol_software data_loss network_outage';
COMMENT ON COLUMN core_kon.it_asset_risk_assessments.treatment IS 'accept ยอมรับ · mitigate ลดความเสี่ยง · replace จัดหาทดแทน · transfer ถ่ายโอน (ประกัน/MA) · avoid หลีกเลี่ยง/เลิกใช้';
