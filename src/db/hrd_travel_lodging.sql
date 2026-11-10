-- ══════════════════════════════════════════════════════════════════════════════
-- เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — เงื่อนไขการเบิกค่าเช่าที่พัก
-- รันหลัง hrd_travel_requests.sql · รันซ้ำได้
--
-- ระดับสิทธิ์ที่พัก (hrd_travel_lodging_classes) — เพดานต่อคนต่อคืน ตามระดับตำแหน่ง แก้ราคาได้
--   ผู้บริหารระดับสูง / ทรงคุณวุฒิ                 เหมาจ่าย 1,200 · ห้องเดี่ยว 2,500 · ห้องคู่ 1,400 · เครื่องบินชั้นธุรกิจ
--   บริหารระดับต้น / อำนวยการสูง / เชี่ยวชาญ        เหมาจ่าย 1,200 · ห้องเดี่ยว 2,200 · ห้องคู่ 1,200 · เครื่องบินชั้นธุรกิจ
--   อำนวยการต้น / ชำนาญการพิเศษ / ชำนาญการ       เหมาจ่าย   800 · ห้องเดี่ยว 1,500 · ห้องคู่   850 · ชั้นประหยัด
--   ทั่วไป (ปฏิบัติงาน / ชำนาญงาน / อาวุโส)          เหมาจ่าย   800 · ห้องเดี่ยว 1,500 · ห้องคู่   850 · ชั้นประหยัด (ค่าเริ่มต้น)
--
-- ระดับของบุคลากร = กำหนดรายคน (hrd_travel_lodging_people)
--                → ตามระดับตำแหน่งในข้อมูลบุคลากร (users.user_level_id → hrd_travel_lodging_levels)
--                → ระดับค่าเริ่มต้น (is_default) เมื่อไม่มีทั้งสองอย่าง
--
-- เบิกได้ 2 รูปแบบ ไปทั้งคณะต้องเลือกรูปแบบเดียวกัน (hrd_travel_requests.lodging_mode):
--   lump   เหมาจ่าย ไม่ต้องแนบหลักฐาน — เบิก = Σ อัตราเหมาจ่ายของแต่ละคน × จำนวนคืน
--   actual จ่ายจริง แนบใบเสร็จ — เบิกได้ไม่เกิน Σ อัตราห้องเดี่ยว/ห้องคู่ของแต่ละคน × จำนวนคืน
-- อัตราที่ใช้เก็บไว้ในคำขอรายคน (hrd_travel_request_travelers.lodging_*) — แก้ราคาภายหลังไม่กระทบคำขอเดิม
-- ผู้ตั้งค่า: ADMIN หรือ HRD · ทุกการแก้ไขลง hrd_travel_lodging_log
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hrd_travel_lodging_classes (
    id            SERIAL PRIMARY KEY,
    code          VARCHAR(30) NOT NULL UNIQUE,
    name          VARCHAR(150) NOT NULL UNIQUE,
    lump_sum      INT NOT NULL CHECK (lump_sum > 0 AND lump_sum <= 20000),        -- เหมาจ่าย บาท/คน/คืน
    single_room   INT NOT NULL CHECK (single_room > 0 AND single_room <= 20000),  -- จ่ายจริง ห้องพักเดี่ยว บาท/คน/คืน
    double_room   INT NOT NULL CHECK (double_room > 0 AND double_room <= 20000),  -- จ่ายจริง ห้องพักคู่ บาท/คน/คืน
    flight_class  VARCHAR(10) NOT NULL DEFAULT 'economy' CHECK (flight_class IN ('business', 'economy')),
    is_default    BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order    INT NOT NULL DEFAULT 0,
    updated_by    INT REFERENCES users(id),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrd_travel_lodging_classes_default ON hrd_travel_lodging_classes (is_default) WHERE is_default;
INSERT INTO hrd_travel_lodging_classes (code, name, lump_sum, single_room, double_room, flight_class, is_default, sort_order) VALUES
    ('executive_high', 'ผู้บริหารระดับสูง / ทรงคุณวุฒิ',                1200, 2500, 1400, 'business', FALSE, 1),
    ('executive',      'บริหารระดับต้น / อำนวยการสูง / เชี่ยวชาญ',       1200, 2200, 1200, 'business', FALSE, 2),
    ('professional',   'อำนวยการต้น / ชำนาญการพิเศษ / ชำนาญการ',      800, 1500,  850, 'economy',  FALSE, 3),
    ('general',        'ทั่วไป (ปฏิบัติงาน / ชำนาญงาน / อาวุโส)',         800, 1500,  850, 'economy',  TRUE,  4)
ON CONFLICT (code) DO NOTHING;

-- ระดับตำแหน่ง (user_levels) → ระดับสิทธิ์ที่พัก · ไม่มีแถว = ระดับค่าเริ่มต้น
CREATE TABLE IF NOT EXISTS hrd_travel_lodging_levels (
    user_level_id  INT PRIMARY KEY REFERENCES user_levels(user_level_id),
    class_id       INT NOT NULL REFERENCES hrd_travel_lodging_classes(id),
    updated_by     INT REFERENCES users(id),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- จับคู่เริ่มต้นตามชื่อระดับ (ปฏิบัติการ อยู่กลุ่มเดียวกับชำนาญการตามระเบียบ) · ระดับแบบเก่า (ช/บ/ส) และ "-" ใช้ค่าเริ่มต้น
INSERT INTO hrd_travel_lodging_levels (user_level_id, class_id)
SELECT l.user_level_id, c.id
FROM user_levels l
JOIN hrd_travel_lodging_classes c ON c.code = CASE
        WHEN l.level_name IN ('ทรงคุณวุฒิ', 'บริหารสูง', 'บริหารระดับสูง') THEN 'executive_high'
        WHEN l.level_name IN ('เชี่ยวชาญ', 'อำนวยการสูง', 'บริหารต้น', 'บริหารระดับต้น') THEN 'executive'
        WHEN l.level_name IN ('ปฏิบัติการ', 'ชำนาญการ', 'ชำนาญการพิเศษ', 'อำนวยการต้น') THEN 'professional'
        WHEN l.level_name IN ('ปฏิบัติงาน', 'ชำนาญงาน', 'อาวุโส', 'ทักษะพิเศษ') THEN 'general'
    END
ON CONFLICT (user_level_id) DO NOTHING;

-- กำหนดรายบุคคล (ยกเว้นจากระดับตำแหน่ง เช่น ผู้บริหาร หรือข้อมูลระดับไม่ตรง)
CREATE TABLE IF NOT EXISTS hrd_travel_lodging_people (
    user_id     INT PRIMARY KEY REFERENCES users(id),
    class_id    INT NOT NULL REFERENCES hrd_travel_lodging_classes(id),
    note        VARCHAR(200),
    updated_by  INT REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS hrd_travel_lodging_log (
    id          SERIAL PRIMARY KEY,
    entity      VARCHAR(10) NOT NULL CHECK (entity IN ('class', 'level', 'person')),
    entity_id   INT NOT NULL,
    action      VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    before      JSONB,
    after       JSONB,
    changed_by  INT REFERENCES users(id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_lodging_log_entity ON hrd_travel_lodging_log(entity, entity_id, changed_at DESC);

-- ── คำขอ: รูปแบบการเบิกที่พัก (ทั้งคณะ) + เพดานรวม ──
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS lodging_mode VARCHAR(10) NOT NULL DEFAULT 'none';
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS lodging_cap  NUMERIC(12,2) NOT NULL DEFAULT 0;   -- เพดานรวมตามระดับสิทธิ์ (เหมาจ่าย = ยอดเบิก)
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS lodging_note VARCHAR(300);                       -- เหตุผลพักห้องเดี่ยวเมื่อไปเป็นคณะ
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hrd_travel_requests_lodging_mode') THEN
        ALTER TABLE hrd_travel_requests ADD CONSTRAINT ck_hrd_travel_requests_lodging_mode CHECK (lodging_mode IN ('none', 'lump', 'actual'));
    END IF;
END $$;
-- คำขอที่ยื่นก่อนมีเงื่อนไขนี้และมีค่าที่พัก ถือเป็นจ่ายจริง (ไม่มีรายละเอียดรายคน)
UPDATE hrd_travel_requests SET lodging_mode = 'actual', lodging_cap = lodging_amount WHERE lodging_mode = 'none' AND lodging_amount > 0;

-- ผู้เดินทาง: ระดับสิทธิ์ ห้อง และอัตรา ณ วันยื่น
ALTER TABLE hrd_travel_request_travelers ADD COLUMN IF NOT EXISTS lodging_class_id   INT REFERENCES hrd_travel_lodging_classes(id);
ALTER TABLE hrd_travel_request_travelers ADD COLUMN IF NOT EXISTS lodging_class_name VARCHAR(150);
ALTER TABLE hrd_travel_request_travelers ADD COLUMN IF NOT EXISTS lodging_room       VARCHAR(10) CHECK (lodging_room IN ('single', 'double'));  -- จ่ายจริงเท่านั้น
ALTER TABLE hrd_travel_request_travelers ADD COLUMN IF NOT EXISTS lodging_rate       INT;                                    -- บาท/คืน ที่ใช้
ALTER TABLE hrd_travel_request_travelers ADD COLUMN IF NOT EXISTS lodging_cap        NUMERIC(12,2) NOT NULL DEFAULT 0;       -- อัตรา × คืน
ALTER TABLE hrd_travel_request_travelers ADD COLUMN IF NOT EXISTS flight_class       VARCHAR(10) CHECK (flight_class IN ('business', 'economy'));
