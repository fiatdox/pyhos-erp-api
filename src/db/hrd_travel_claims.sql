-- ══════════════════════════════════════════════════════════════════════════════
-- เคลียร์ค่าใช้จ่ายเดินทางไปราชการ (เบิกจ่ายจริง) — หนึ่งคำขอ (TR) มีหนึ่งการเบิก · ผู้ขอเบิกแทนทั้งคณะ
--   mode       advance   = ยืมเงินแล้ว ล้างเงินยืม (คืนส่วนเหลือ / การเงินจ่ายเพิ่มส่วนเกิน)
--              reimburse = สำรองจ่ายเอง ขอเบิกคืน (การเงินจ่ายคืนเต็มยอดที่ตรวจแล้ว)
--   status     draft → hrd (รอ HRD ตรวจ) → finance (รอการเงินตรวจ) → verified (รอคืนเงิน/จ่ายเพิ่ม) → closed
--              HRD ส่งกลับ → returned (ผู้เดินทางแก้แล้วส่งใหม่ → hrd) · การเงินตีกลับ → hrd (finance_returned = true)
--   ยอด        claimed_* = ที่ผู้เดินทางขอ (ระบบคิดจากรายการ) · approved_* = HRD อนุมัติ · การเงินไม่แก้ยอด
--   ยืนยันแล้ว → hrd_travel_requests.actual_amount = approved_total (งบถูกตัดตามยอดจริง)
-- รายการ (hrd_travel_claim_items): รายคน (เบี้ยเลี้ยง/ที่พัก/ลงทะเบียน) และรวมคณะ (น้ำมัน/ทางด่วน/ค่าโดยสาร/แท็กซี่/อื่น)
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hrd_travel_claims (
    id                 SERIAL PRIMARY KEY,
    request_id         INT NOT NULL UNIQUE REFERENCES hrd_travel_requests(id) ON DELETE CASCADE,
    mode               VARCHAR(10) NOT NULL CHECK (mode IN ('advance', 'reimburse')),
    advance_no         VARCHAR(50),
    advance_amount     NUMERIC(12,2),
    advance_date       DATE,
    actual_start_at    TIMESTAMPTZ NOT NULL,
    actual_end_at      TIMESTAMPTZ NOT NULL CHECK (actual_end_at > actual_start_at),
    meals_provided     INT NOT NULL DEFAULT 0 CHECK (meals_provided >= 0),
    allowance_days     NUMERIC(5,1) NOT NULL DEFAULT 0,
    lodging_mode       VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (lodging_mode IN ('none', 'lump', 'actual')),
    lodging_nights     INT NOT NULL DEFAULT 0,
    distance_km        NUMERIC(7,1),
    other_desc         VARCHAR(200),
    -- เหตุผลที่เบิกเกินประมาณการ รายหมวด {"transport":"…"}
    over_reasons       JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- ยอดรายหมวด: allowance lodging transport registration other
    claimed            JSONB NOT NULL DEFAULT '{}'::jsonb,
    approved           JSONB,
    claimed_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
    approved_total     NUMERIC(12,2),
    status             VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'hrd', 'returned', 'finance', 'verified', 'closed')),
    finance_returned   BOOLEAN NOT NULL DEFAULT FALSE,
    submitted_at       TIMESTAMPTZ,
    hrd_by             INT REFERENCES users(id),
    hrd_at             TIMESTAMPTZ,
    finance_by         INT REFERENCES users(id),
    finance_at         TIMESTAMPTZ,
    settle_note        VARCHAR(300),
    closed_by          INT REFERENCES users(id),
    closed_at          TIMESTAMPTZ,
    created_by         INT REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by         INT REFERENCES users(id),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (mode = 'reimburse' OR advance_amount IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_claims_open ON hrd_travel_claims (status, submitted_at) WHERE status IN ('hrd', 'returned', 'finance', 'verified');

CREATE TABLE IF NOT EXISTS hrd_travel_claim_items (
    id              SERIAL PRIMARY KEY,
    claim_id        INT NOT NULL REFERENCES hrd_travel_claims(id) ON DELETE CASCADE,
    category        VARCHAR(15) NOT NULL CHECK (category IN ('allowance', 'lodging', 'registration', 'fuel', 'toll', 'fare', 'taxi', 'other')),
    user_id         INT REFERENCES users(id),
    label           VARCHAR(300) NOT NULL,
    detail          VARCHAR(300),
    -- room: ห้องพักของรายการที่พักจ่ายจริง (single/double)
    room            VARCHAR(6) CHECK (room IN ('single', 'double')),
    claimed_amount  NUMERIC(12,2) NOT NULL CHECK (claimed_amount >= 0),
    cap_amount      NUMERIC(12,2),
    -- ระบบคิดให้ (เบี้ยเลี้ยง/ที่พักเหมาจ่าย/น้ำมัน) — ผู้เดินทางแก้ไม่ได้
    computed        BOOLEAN NOT NULL DEFAULT FALSE,
    approved_amount NUMERIC(12,2) CHECK (approved_amount >= 0),
    hrd_note        VARCHAR(300),
    sort_order      INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_claim_items_claim ON hrd_travel_claim_items (claim_id, sort_order);

-- ประวัติการดำเนินการ (ส่ง / ส่งกลับ / ส่งการเงิน / ตีกลับ / ยืนยัน / ปิดเรื่อง)
CREATE TABLE IF NOT EXISTS hrd_travel_claim_log (
    id         SERIAL PRIMARY KEY,
    claim_id   INT NOT NULL REFERENCES hrd_travel_claims(id) ON DELETE CASCADE,
    actor_id   INT REFERENCES users(id),
    actor_name VARCHAR(200) NOT NULL,
    action     VARCHAR(20) NOT NULL CHECK (action IN ('submitted', 'hrd_returned', 'hrd_passed', 'finance_returned', 'verified', 'closed')),
    note       VARCHAR(1000),
    amount     NUMERIC(12,2),
    acted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_claim_log_claim ON hrd_travel_claim_log (claim_id, acted_at);

-- ใบเสร็จ/หลักฐานการเบิก = ไฟล์แนบของคำขอ ประเภท receipt
ALTER TABLE hrd_travel_request_files DROP CONSTRAINT IF EXISTS hrd_travel_request_files_kind_check;
ALTER TABLE hrd_travel_request_files ADD CONSTRAINT hrd_travel_request_files_kind_check CHECK (kind IN ('source', 'plane', 'private_car', 'vehicle_use', 'receipt'));
