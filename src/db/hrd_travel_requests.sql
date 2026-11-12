-- ══════════════════════════════════════════════════════════════════════════════
-- เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — คำขออนุมัติเดินทางไปราชการและเบิกค่าใช้จ่าย
-- ตามแบบบันทึกข้อความ "ขออนุมัติเดินทางไปราชการและเบิกค่าใช้จ่ายในการเดินทางไปราชการ"
--
-- เก็บราคา ณ วันยื่นไว้ในคำขอ (อัตราเบี้ยเลี้ยงรายคน · บาท/กม. · เพดานราคาเส้นทาง)
-- แก้ราคาที่หน้าตั้งค่าภายหลังไม่กระทบคำขอเดิม
-- ยอดเงินทุกช่องคำนวณ/ตรวจที่ server (hrdTravelRequestController) — ไม่เชื่อตัวเลขจากหน้าเว็บ
-- อนุมัติยังลงนามบนกระดาษ (พิมพ์ PDF) — status มีแค่ ยื่นแล้ว / ยกเลิก
--
-- งบประมาณ (hrd_travel_budgets) — งาน HRD ตั้งเองรายปีงบ: ประเภท (ตรงกับช่องติ๊กในแบบฟอร์ม) + ชื่อ + วงเงิน
--   ตัวเลขจริงของงบ = ยอดที่การเงินยืนยันแล้วเท่านั้น (actual_amount — HRD บันทึกตามการเงิน) · คงเหลือ = วงเงิน − ยอดยืนยัน
--   ประมาณการในคำขอไม่ตัดงบ (แสดงเป็น "รอยืนยัน" ประกอบการวางแผน) · คำขอยกเลิกไม่นับ
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hrd_travel_budgets (
    id           SERIAL PRIMARY KEY,
    fiscal_year  INT NOT NULL CHECK (fiscal_year BETWEEN 2500 AND 2700),     -- ปีงบประมาณ พ.ศ.
    budget_type  VARCHAR(10) NOT NULL CHECK (budget_type IN ('hospital', 'budget', 'project')),   -- CHECK นี้ถูกแทนด้วย FK ไป hrd_travel_budget_types (hrd_travel_budget_types.sql — รันต่อจากไฟล์นี้)
    name         VARCHAR(200) NOT NULL,
    amount       NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    note         VARCHAR(300),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,                             -- ปิด = เลือกในคำขอใหม่ไม่ได้ (คำขอเดิมยังนับ)
    created_by   INT REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by   INT REFERENCES users(id),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fiscal_year, name)
);

CREATE TABLE IF NOT EXISTS hrd_travel_budget_log (
    id          SERIAL PRIMARY KEY,
    budget_id   INT NOT NULL REFERENCES hrd_travel_budgets(id),
    action      VARCHAR(10) NOT NULL CHECK (action IN ('create', 'update')),
    before      JSONB,
    after       JSONB,
    changed_by  INT REFERENCES users(id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_budget_log_budget ON hrd_travel_budget_log(budget_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS hrd_travel_requests (
    id                  SERIAL PRIMARY KEY,
    requester_id        INT NOT NULL REFERENCES users(id),
    requester_name      VARCHAR(200) NOT NULL,          -- ชื่อ ณ วันยื่น (พิมพ์ลงแบบฟอร์ม)
    requester_position  VARCHAR(200),
    requester_unit      VARCHAR(200),                   -- กลุ่มงาน
    purpose             VARCHAR(300) NOT NULL,          -- มีความประสงค์ขออนุมัติเดินทางไปราชการ เพื่อ ...
    subject             VARCHAR(1000) NOT NULL,         -- ๑. เรื่อง/วัตถุประสงค์
    location            VARCHAR(300) NOT NULL,          -- ๒. สถานที่ไปราชการ
    start_at            TIMESTAMPTZ NOT NULL,           -- ๓. ระยะเวลาเดินทาง
    end_at              TIMESTAMPTZ NOT NULL,
    overnight           BOOLEAN NOT NULL,               -- พักแรม (ข้ามวัน) — ใช้นับวันเบี้ยเลี้ยง
    allowance_max_days  NUMERIC(5,1) NOT NULL,          -- จำนวนวันที่เบิกได้ตามระเบียบ
    allowance_days      NUMERIC(5,1) NOT NULL,          -- จำนวนวันที่ขอเบิก (≤ max)
    -- ๕. ยานพาหนะ
    vehicle_mode        VARCHAR(10) NOT NULL CHECK (vehicle_mode IN ('gov_car', 'private', 'bus', 'plane', 'other')),
    vehicle_id          INT REFERENCES hrd_travel_vehicle_rates(id),
    vehicle_name        VARCHAR(100),                   -- ประเภทรถส่วนตัว ณ วันยื่น
    vehicle_plate       VARCHAR(50),
    distance_km         NUMERIC(8,1),
    rate_per_km         NUMERIC(6,2),
    route_id            INT REFERENCES hrd_travel_routes(id),
    route_text          VARCHAR(220),                   -- ต้นทาง ⇄ ปลายทาง ณ วันยื่น
    route_max_fare      INT,                            -- เพดานต่อเที่ยวต่อคน ณ วันยื่น
    vehicle_other       VARCHAR(200),
    -- ๖. ประมาณการค่าใช้จ่าย
    allowance_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,   -- ๖.๑
    lodging_rooms       INT NOT NULL DEFAULT 0,             -- ๖.๒
    lodging_nights      INT NOT NULL DEFAULT 0,
    lodging_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    transport_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,   -- ๖.๓
    registration_amount NUMERIC(12,2) NOT NULL DEFAULT 0,   -- ๖.๔
    fuel_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,   -- ๖.๕ ค่าน้ำมัน (กม. × อัตรา)
    toll_amount         NUMERIC(12,2) NOT NULL DEFAULT 0,   -- ๖.๕ ค่าทางด่วน
    other_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,   -- ๖.๖
    other_desc          VARCHAR(200),
    total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    budget_id           INT NOT NULL REFERENCES hrd_travel_budgets(id),
    budget_type         VARCHAR(10) NOT NULL,           -- ณ วันยื่น (ติ๊กช่องในแบบฟอร์ม)
    budget_name         VARCHAR(200) NOT NULL,
    actual_amount       NUMERIC(12,2) CHECK (actual_amount >= 0),   -- ยอดที่การเงินยืนยัน (ตัดงบ) — NULL = ยังเป็นประมาณการรอยืนยัน
    actual_note         VARCHAR(300),
    actual_by           INT REFERENCES users(id),
    actual_at           TIMESTAMPTZ,
    status             VARCHAR(10) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'cancelled')),
    cancel_reason       VARCHAR(300),
    cancelled_by        INT REFERENCES users(id),
    cancelled_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by          INT REFERENCES users(id),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (end_at > start_at),
    CHECK (allowance_days >= 0 AND allowance_days <= allowance_max_days)
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_requests_requester ON hrd_travel_requests(requester_id, start_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_requests_start ON hrd_travel_requests(start_at DESC);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_requests_budget ON hrd_travel_requests(budget_id) WHERE status = 'submitted';

-- ผู้เดินทาง (ผู้ขอ + ผู้ร่วมเดินทาง) พร้อมอัตราเบี้ยเลี้ยง ณ วันยื่น
CREATE TABLE IF NOT EXISTS hrd_travel_request_travelers (
    id            SERIAL PRIMARY KEY,
    request_id    INT NOT NULL REFERENCES hrd_travel_requests(id) ON DELETE CASCADE,
    user_id       INT NOT NULL REFERENCES users(id),
    name          VARCHAR(200) NOT NULL,
    position      VARCHAR(200),
    tier_id       INT REFERENCES hrd_travel_allowance_tiers(id),
    tier_name     VARCHAR(100),
    rate          INT NOT NULL,                 -- บาท/วัน
    is_requester  BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order    INT NOT NULL DEFAULT 0,
    UNIQUE (request_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_request_travelers_user ON hrd_travel_request_travelers(user_id);
