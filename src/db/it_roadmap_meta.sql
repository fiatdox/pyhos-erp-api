-- ============================================================================
-- IT Project Roadmap — master/lookup tables (ทำให้ตัวเลือกในฟอร์มยืดหยุ่น แก้ไขได้)
-- สถานะ / ลำดับความสำคัญ / กลุ่มงาน / KPI / หน่วยงาน — เก็บเป็นตาราง ไม่ hardcode
-- ============================================================================

CREATE TABLE IF NOT EXISTS it_roadmap_status (
    value  VARCHAR(30) PRIMARY KEY,
    label  VARCHAR(100) NOT NULL,
    color  VARCHAR(30)  NOT NULL DEFAULT 'default',   -- antd Tag color
    sort   INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS it_roadmap_priority (
    value  VARCHAR(30) PRIMARY KEY,
    label  VARCHAR(100) NOT NULL,
    color  VARCHAR(30)  NOT NULL DEFAULT 'default',
    sort   INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS it_roadmap_mission (
    value  VARCHAR(30) PRIMARY KEY,
    label  VARCHAR(150) NOT NULL,
    color  VARCHAR(30)  NOT NULL DEFAULT '#3b82f6',   -- hex (ใช้กับ ECharts/แผนภูมิ)
    sort   INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS it_roadmap_kpi (
    code   VARCHAR(30) PRIMARY KEY,
    name   VARCHAR(255) NOT NULL,
    target VARCHAR(100),
    sort   INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- ปีงบที่ KPI นี้ active — ถ้าไม่มีแถวเลย = ใช้ได้ทุกปีงบ, ถ้ามี = เฉพาะปีที่ระบุ
CREATE TABLE IF NOT EXISTS it_roadmap_kpi_years (
    kpi_code    VARCHAR(30) NOT NULL REFERENCES it_roadmap_kpi(code) ON DELETE CASCADE,
    fiscal_year SMALLINT NOT NULL,
    PRIMARY KEY (kpi_code, fiscal_year)
);

CREATE TABLE IF NOT EXISTS it_roadmap_department (
    id     SERIAL PRIMARY KEY,
    name   VARCHAR(200) NOT NULL UNIQUE,
    sort   INT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT TRUE
);

-- ผูกผู้รับผิดชอบหลักกับผู้ใช้จริง (role IT_STAFF) — เก็บทั้ง id (อ้างอิง) และชื่อ (แสดง/ย้อนหลัง)
ALTER TABLE it_roadmap_tasks ADD COLUMN IF NOT EXISTS owner_user_id INT;
