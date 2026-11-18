-- ============================================================
-- MODULE: IT Risk Register — ทะเบียนความเสี่ยงของบริการที่สำคัญ (ปีงบประมาณละ 2 ครั้ง)
-- DESCRIPTION: 1 ทะเบียน = 1 รอบ: ปีงบประมาณ (พ.ศ.) ครั้งที่ 1 ต.ค.–มี.ค. / ครั้งที่ 2 เม.ย.–ก.ย. (หัวทะเบียน: ผู้บันทึก (บัญชีเจ้าหน้าที่ IT) วันที่ประชุม สถานที่ ระบบบริการที่สำคัญ)
--              รายการความเสี่ยง 3 ส่วนตามแบบฟอร์ม:
--                PART 1 ประเมิน: วันที่ระบุ กลุ่ม ระบบงาน ภัยคุกคาม ช่องโหว่ มาตรการที่มี กระทบ C/I/A
--                        ความรุนแรงแต่ละด้าน F/S/R/I/L/O โอกาส × ความรุนแรง = ระดับ เจ้าของความเสี่ยง
--                PART 2 แผนจัดการ: ตัวเลือกการตอบสนอง แผน ความคืบหน้า (%) กำหนดเสร็จ ความเสี่ยงคงเหลือ (ด้าน + โอกาส × ความรุนแรง)
--                PART 3 ติดตาม: สถานะ Open/Closed ความคืบหน้าการติดตาม
--              ผูกกับบริการในทะเบียน BIA ได้ (ไม่บังคับ) · ทุกการเพิ่ม/แก้/ลบรายการเก็บค่าก่อน-หลังใน it_risk_register_log
-- PAGE: /information-technology/risk-register
-- DATABASE: PostgreSQL / SCHEMA: core_kon · รันซ้ำได้ · ต้องรันหลัง it_bia.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS core_kon.it_risk_registers (
    id                SERIAL PRIMARY KEY,
    period            VARCHAR(6)   NOT NULL UNIQUE CHECK (period ~ '^2[56]\d{2}-[12]$'),   -- ปีงบ พ.ศ.-ครั้งที่ เช่น 2570-1
    recorder_id       INTEGER REFERENCES core_kon.users(id),   -- ผู้บันทึก = บัญชีเจ้าหน้าที่ IT
    recorder_name     VARCHAR(150),                             -- ชื่อผู้บันทึก ณ วันบันทึก
    recorder_role     VARCHAR(150),
    meeting_date      DATE,
    location          VARCHAR(255),
    address           VARCHAR(500),
    critical_service  VARCHAR(255),
    notes             TEXT,
    created_by        INTEGER REFERENCES core_kon.users(id),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by        INTEGER REFERENCES core_kon.users(id),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ฐานข้อมูลที่สร้างตารางไว้ก่อนมีคอลัมน์ผู้บันทึก (dev)
ALTER TABLE core_kon.it_risk_registers ADD COLUMN IF NOT EXISTS recorder_id INTEGER REFERENCES core_kon.users(id);

CREATE TABLE IF NOT EXISTS core_kon.it_risk_register_items (
    id                   SERIAL PRIMARY KEY,
    register_id          INTEGER NOT NULL REFERENCES core_kon.it_risk_registers(id),
    identified_date      DATE NOT NULL,
    category             VARCHAR(20) NOT NULL CHECK (category IN ('strategic', 'operational', 'financial', 'compliance', 'reputational', 'cyber')),
    asset_group          VARCHAR(255) NOT NULL,
    bia_service_id       INTEGER REFERENCES core_kon.it_bia_services(id),
    threat               TEXT NOT NULL,
    vulnerability        TEXT,
    controls             TEXT,
    cia                  TEXT[] NOT NULL DEFAULT '{}',          -- C I A
    impact_areas         TEXT[] NOT NULL DEFAULT '{}',          -- F S R I L O
    likelihood           SMALLINT NOT NULL CHECK (likelihood BETWEEN 1 AND 5),
    impact               SMALLINT NOT NULL CHECK (impact BETWEEN 1 AND 5),
    score                SMALLINT GENERATED ALWAYS AS (likelihood * impact) STORED,
    owner                VARCHAR(255),
    treatment            VARCHAR(20) NOT NULL CHECK (treatment IN ('mitigate', 'accept', 'transfer', 'avoid', 'monitor')),
    treatment_plan       TEXT,
    progress_pct         SMALLINT NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
    due_date             DATE,
    residual_areas       TEXT[] NOT NULL DEFAULT '{}',
    residual_likelihood  SMALLINT CHECK (residual_likelihood BETWEEN 1 AND 5),
    residual_impact      SMALLINT CHECK (residual_impact BETWEEN 1 AND 5),
    residual_score       SMALLINT GENERATED ALWAYS AS (residual_likelihood * residual_impact) STORED,
    status               VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    follow_up            TEXT,
    copied_from          INTEGER REFERENCES core_kon.it_risk_register_items(id),   -- ยกมาจากรายการของรอบก่อน
    created_by           INTEGER REFERENCES core_kon.users(id),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by           INTEGER REFERENCES core_kon.users(id),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT it_risk_register_residual_pair CHECK ((residual_likelihood IS NULL) = (residual_impact IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_it_risk_register_items_register ON core_kon.it_risk_register_items (register_id, identified_date, id);

-- ลบรายการได้ (บันทึกผิด) — log ไม่ผูก FK กับรายการ เพื่อให้ประวัติยังอยู่หลังลบ
CREATE TABLE IF NOT EXISTS core_kon.it_risk_register_log (
    id           SERIAL PRIMARY KEY,
    register_id  INTEGER NOT NULL REFERENCES core_kon.it_risk_registers(id),
    item_id      INTEGER,
    action       VARCHAR(20) NOT NULL CHECK (action IN ('create_register', 'update_register', 'create', 'update', 'delete', 'copy')),
    before       JSONB,
    after        JSONB,
    changed_by   INTEGER REFERENCES core_kon.users(id),
    changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_it_risk_register_log ON core_kon.it_risk_register_log (register_id, changed_at DESC);

COMMENT ON TABLE  core_kon.it_risk_registers IS 'หัวทะเบียนความเสี่ยง ปีงบประมาณละ 2 ครั้ง (1 รอบ 1 ทะเบียน)';
COMMENT ON TABLE  core_kon.it_risk_register_items IS 'รายการความเสี่ยงในทะเบียน — PART 1 ประเมิน · PART 2 แผนจัดการ/ความเสี่ยงคงเหลือ · PART 3 ติดตาม';
COMMENT ON COLUMN core_kon.it_risk_register_items.impact_areas IS 'F การเงิน · S ความปลอดภัย (ผู้ป่วย/บุคลากร) · R ชื่อเสียง · I ข้อมูลสารสนเทศ · L กฎหมาย/ข้อบังคับ · O การดำเนินงาน';
COMMENT ON COLUMN core_kon.it_risk_register_items.treatment    IS 'mitigate ลด · accept ยอมรับ · transfer ถ่ายโอน · avoid หลีกเลี่ยง · monitor ติดตามต่อเนื่อง (Continue Monitoring)';
