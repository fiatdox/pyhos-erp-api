-- ══════════════════════════════════════════════════════════════════════════════
-- ประเภทงบ (ช่องที่ติ๊กในบันทึกข้อความ "ขอใช้เงิน...") — ADMIN / HRD เพิ่ม แก้ชื่อ ปิดใช้ได้เอง
-- เดิมตายตัว 3 ค่า (CHECK ใน hrd_travel_budgets) → ย้ายมาเป็นตาราง อ้างด้วย code (รหัสเดิมคงไว้ ข้อมูลเก่าไม่เปลี่ยน)
--   code       — รหัสอ้างอิง (เดิม hospital / budget / project · ใหม่ระบบตั้งให้ t4, t5, ...)
--   item_label — ข้อความหน้าชื่องบในบันทึกข้อความ เช่น "รายการงบ" / "ชื่อโครงการ"
--   ปิดใช้ = ตั้งงบใหม่ด้วยประเภทนี้ไม่ได้ และไม่วาดช่องในบันทึกข้อความใหม่ (งบ/คำขอเดิมยังอยู่)
-- คำขอเก็บชื่อประเภท ณ วันยื่น (budget_type_name, budget_item_label) — แก้ชื่อประเภทภายหลังไม่กระทบบันทึกข้อความเดิม
-- ต้องรันหลัง hrd_travel_requests.sql · รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════

CREATE SEQUENCE IF NOT EXISTS hrd_travel_budget_type_seq START 4;

CREATE TABLE IF NOT EXISTS hrd_travel_budget_types (
    code        VARCHAR(10) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    item_label  VARCHAR(30) NOT NULL DEFAULT 'รายการงบ',
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  INT REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  INT REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO hrd_travel_budget_types (code, name, item_label, sort_order) VALUES
    ('hospital', 'เงินบำรุงโรงพยาบาล', 'รายการงบ', 1),
    ('budget',   'งบประมาณ',          'รายการงบ', 2),
    ('project',  'โครงการ',           'ชื่อโครงการ', 3)
ON CONFLICT (code) DO NOTHING;

-- รหัสงบที่งานการเงินใช้ (เช่น P20 เงินบำรุง · P21 งบผู้ไปราชการผู้บริหาร · P25 งบพัฒนาบุคลากรศูนย์แพทย์) — ไม่บังคับ ห้ามซ้ำ
-- รายการย่อยของประเภท (เช่น P20 แตก 19 รายการ) = งบใน hrd_travel_budgets ที่มี budget_type เดียวกัน (วงเงินแยกรายการ)
ALTER TABLE hrd_travel_budget_types ADD COLUMN IF NOT EXISTS ref_code VARCHAR(20);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrd_travel_budget_types_ref_code ON hrd_travel_budget_types (UPPER(ref_code)) WHERE ref_code IS NOT NULL;

-- งบ: เลิก CHECK 3 ค่า → FK ไปตารางประเภท
ALTER TABLE hrd_travel_budgets DROP CONSTRAINT IF EXISTS hrd_travel_budgets_budget_type_check;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hrd_travel_budgets_budget_type_fk') THEN
        ALTER TABLE hrd_travel_budgets ADD CONSTRAINT hrd_travel_budgets_budget_type_fk
            FOREIGN KEY (budget_type) REFERENCES hrd_travel_budget_types(code);
    END IF;
END $$;

-- คำขอ: ชื่อประเภท ณ วันยื่น
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS budget_type_name  VARCHAR(100);
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS budget_item_label VARCHAR(30);
UPDATE hrd_travel_requests r SET budget_type_name = t.name, budget_item_label = t.item_label
FROM hrd_travel_budget_types t
WHERE t.code = r.budget_type AND r.budget_type_name IS NULL;
