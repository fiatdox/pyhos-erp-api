-- ══════════════════════════════════════════════════════════════════════════════
-- เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — ตั้งค่าค่าพาหนะ
--
-- 1) พาหนะส่วนตัว เบิกค่าน้ำมันตามระยะทาง: hrd_travel_vehicle_rates (บาท/กม. แยกประเภทรถ)
--    เริ่มต้น รถจักรยานยนต์ 2 บาท/กม. · รถยนต์ 4 บาท/กม.
-- 2) รถโดยสารประจำทาง และ 3) เครื่องบิน: hrd_travel_routes (เพดานราคาต่อเที่ยวตามเส้นทาง)
--    หนึ่งเส้นทางใช้ได้ทั้งไปและกลับ (พะเยา ⇄ กรุงเทพ = กรุงเทพ ⇄ พะเยา)
--    ผู้เดินทางเบิกได้ไม่เกินราคาที่ตั้ง · ลบ = ปิดใช้งาน (is_active) ไม่ลบแถว ให้คำขอเก่าอ้างอิงได้
--
-- ผู้ตั้งค่า: ADMIN หรือ HRD · ทุกการแก้ไขลง hrd_travel_transport_log
-- คำขอไปราชการในอนาคตต้องเก็บราคา ณ วันที่ขอไว้ในคำขอเอง
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hrd_travel_vehicle_rates (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(30) NOT NULL UNIQUE,
    name         VARCHAR(100) NOT NULL UNIQUE,
    rate_per_km  NUMERIC(6,2) NOT NULL CHECK (rate_per_km > 0 AND rate_per_km <= 100),
    sort_order   INT NOT NULL DEFAULT 0,
    updated_by   INT REFERENCES users(id),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO hrd_travel_vehicle_rates (code, name, rate_per_km, sort_order) VALUES
    ('motorcycle', 'รถจักรยานยนต์', 2, 1),
    ('car',        'รถยนต์ส่วนตัว', 4, 2)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS hrd_travel_routes (
    id           SERIAL PRIMARY KEY,
    mode         VARCHAR(10) NOT NULL CHECK (mode IN ('bus', 'plane')),
    origin       VARCHAR(100) NOT NULL,
    destination  VARCHAR(100) NOT NULL,
    max_fare     INT NOT NULL CHECK (max_fare > 0 AND max_fare <= 100000),   -- บาท/เที่ยว
    note         VARCHAR(200),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   INT REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by   INT REFERENCES users(id),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (origin <> destination)
);
-- เส้นทางเดียวกันไม่ว่าทิศไหน มีได้แถวเดียวต่อประเภทพาหนะ (เฉพาะที่ใช้งานอยู่)
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrd_travel_routes_pair ON hrd_travel_routes
    (mode, LEAST(origin, destination), GREATEST(origin, destination)) WHERE is_active;

CREATE TABLE IF NOT EXISTS hrd_travel_transport_log (
    id          SERIAL PRIMARY KEY,
    entity      VARCHAR(10) NOT NULL CHECK (entity IN ('vehicle', 'route')),
    entity_id   INT NOT NULL,
    action      VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    before      JSONB,
    after       JSONB,
    changed_by  INT REFERENCES users(id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_transport_log_entity ON hrd_travel_transport_log(entity, entity_id, changed_at DESC);
