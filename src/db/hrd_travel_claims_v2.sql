-- ══════════════════════════════════════════════════════════════════════════════
-- เคลียร์ค่าใช้จ่ายเดินทาง (ต่อ) — รันหลัง hrd_travel_claims.sql · รันซ้ำได้
--   1) role HRD_FINANCE = เจ้าหน้าที่การเงินที่ตรวจการเบิกค่าใช้จ่ายเดินทาง (งาน HRD) — แยกจาก FINANCE/ACCOUNT ของระบบอื่น
--   2) ผู้เดินทางที่ไม่ได้ไปจริง (ตัดตอนเบิก) — ไม่นับในประวัติ/สถิติการไปราชการ
--   3) การเบิก: ผู้ที่ไม่ได้ไป · เวลาไป-กลับรายคน (กลับก่อน/ไปไม่ครบวัน) · ชนิด refund = ยกเลิกเดินทางแล้วคืนเงินยืมเต็มจำนวน
--      · ผู้บันทึกส่ง (HRD เบิกแทนคณะได้ — ผู้บันทึกแทนตรวจเองไม่ได้)
--   4) ประวัติการเปลี่ยนแปลงคำขอหลังยื่น (HRD เลื่อนวันเดินทาง · คิดสายอนุมัติใหม่ · แก้ผู้ร่วมเดินทาง)
--   5) บันทึกการแจ้งเตือนหมอพร้อมให้เตรียมเอกสารเบิก (ครั้งเดียวต่อคำขอ)
-- ══════════════════════════════════════════════════════════════════════════════

-- 1) role
INSERT INTO user_roles (role_name, description)
SELECT 'HRD_FINANCE', 'เจ้าหน้าที่การเงิน — ตรวจสอบการเบิกค่าใช้จ่ายเดินทางไปราชการ (งาน HRD)'
WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE UPPER(role_name) = 'HRD_FINANCE');

-- 2) ไม่ได้เดินทางจริง
ALTER TABLE hrd_travel_request_travelers ADD COLUMN IF NOT EXISTS absent BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN hrd_travel_request_travelers.absent IS 'ไม่ได้เดินทางจริง (ผู้เบิกตัดออกตอนเบิก) — ไม่นับในประวัติ/สถิติการไปราชการ';

-- 3) การเบิก
ALTER TABLE hrd_travel_claims
    ADD COLUMN IF NOT EXISTS kind VARCHAR(10) NOT NULL DEFAULT 'claim',
    ADD COLUMN IF NOT EXISTS absent_user_ids INT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS person_times JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS submitted_by INT REFERENCES users(id);
ALTER TABLE hrd_travel_claims DROP CONSTRAINT IF EXISTS hrd_travel_claims_kind_check;
ALTER TABLE hrd_travel_claims ADD CONSTRAINT hrd_travel_claims_kind_check CHECK (kind IN ('claim', 'refund'));
COMMENT ON COLUMN hrd_travel_claims.kind IS 'claim = เบิกค่าใช้จ่ายจริง · refund = ยกเลิกการเดินทาง คืนเงินยืมเต็มจำนวน';
COMMENT ON COLUMN hrd_travel_claims.person_times IS 'เวลาไป-กลับรายคนที่ต่างจากคณะ {"<user_id>":{"start":"…","end":"…"}}';

-- 4) ประวัติการเปลี่ยนแปลงคำขอ
CREATE TABLE IF NOT EXISTS hrd_travel_request_changes (
    id          SERIAL PRIMARY KEY,
    request_id  INT NOT NULL REFERENCES hrd_travel_requests(id) ON DELETE CASCADE,
    kind        VARCHAR(10) NOT NULL,
    before      JSONB NOT NULL,
    after       JSONB NOT NULL,
    note        VARCHAR(500),
    changed_by  INT REFERENCES users(id),
    changed_by_name VARCHAR(200) NOT NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_request_changes_req ON hrd_travel_request_changes (request_id, changed_at);
-- travelers = HRD แก้ผู้ร่วมเดินทางหลังหัวหน้าเริ่มอนุมัติ (เพิ่ม/ลบ/เปลี่ยนตัว)
ALTER TABLE hrd_travel_request_changes DROP CONSTRAINT IF EXISTS hrd_travel_request_changes_kind_check;
ALTER TABLE hrd_travel_request_changes ADD CONSTRAINT hrd_travel_request_changes_kind_check CHECK (kind IN ('dates', 'chain', 'travelers'));

-- 5) แจ้งเตือนเตรียมเอกสารเบิก (หมอพร้อม) — ครั้งเดียวต่อคำขอ · เปิดด้วย hr_settings.hrd_travel_claim_notify = 'on'
CREATE TABLE IF NOT EXISTS hrd_travel_claim_notify_log (
    id          SERIAL PRIMARY KEY,
    request_id  INT NOT NULL REFERENCES hrd_travel_requests(id) ON DELETE CASCADE,
    kind        VARCHAR(20) NOT NULL DEFAULT 'claim_due',
    status      VARCHAR(10) NOT NULL CHECK (status IN ('SENT', 'SKIPPED', 'FAILED')),
    detail      VARCHAR(300),
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, kind)
);
