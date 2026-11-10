-- ══════════════════════════════════════════════════════════════════════════════
-- เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — อนุมัติผ่านระบบพร้อมลายเซ็น
-- รันหลัง hrd_travel_lodging.sql และ user_signatures.sql · รันซ้ำได้
--
-- ลำดับ (approval_stage):
--   chain    รอหัวหน้าในสายบังคับบัญชาอนุมัติในระบบ — ตามช่องความเห็นในบันทึกข้อความ: หัวหน้ากลุ่มงาน → หัวหน้ากลุ่มภารกิจ
--            (สายมาจาก resolveApprovalChain เดียวกับระบบลา: ข้ามขั้นที่ไม่มีหัวหน้า/ผู้ขอเป็นหัวหน้าเอง · ขั้นหน่วยงานและ ผอ. ไม่อยู่ในสายนี้)
--   director ผ่านสายในระบบแล้ว รอผู้อำนวยการลงนามจริงบนกระดาษ (พิมพ์ PDF เสนอ)
--   approved งาน HRD บันทึกผลคำสั่ง ผอ. ว่าอนุมัติแล้ว — บันทึกยอดยืนยันจากการเงินได้หลังขั้นนี้
-- ไม่อนุมัติขั้นใดขั้นหนึ่ง (หรือ ผอ. ไม่อนุมัติ) = status 'rejected' จบคำขอ ยื่นใหม่ได้ (ไม่นับครั้ง/ไม่นับงบ เหมือนยกเลิก)
--
-- ลายเซ็น: ผู้ขอลงนามตอนยื่น (requester_signature) · ผู้อนุมัติลงนามตอนกด (hrd_travel_request_approvals.signature)
--   เป็นสำเนาภาพ ณ เวลาลงนาม — ผู้ใช้เปลี่ยน/ลบลายเซ็นภายหลังไม่กระทบเอกสาร
-- คำขอที่ยื่นก่อนมีขั้นตอนนี้ = approval_stage 'director' (เสนอกระดาษทั้งฉบับแบบเดิม)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE hrd_travel_requests DROP CONSTRAINT IF EXISTS hrd_travel_requests_status_check;
ALTER TABLE hrd_travel_requests ADD CONSTRAINT hrd_travel_requests_status_check CHECK (status IN ('submitted', 'rejected', 'cancelled'));

ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS approval_stage      VARCHAR(10) NOT NULL DEFAULT 'director';
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS approval_chain      JSONB NOT NULL DEFAULT '[]'::jsonb;   -- ขั้นในระบบ ณ วันยื่น
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS current_step        INT NOT NULL DEFAULT 1;
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS requester_signature TEXT;                                -- สำเนาลายเซ็นผู้ขอ ณ วันยื่น/แก้ไข
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS reject_reason       VARCHAR(300);
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS director_result     VARCHAR(10) CHECK (director_result IN ('approved', 'rejected'));
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS director_note       VARCHAR(300);
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS director_by         INT REFERENCES users(id);         -- ADMIN/HRD ผู้บันทึกผลตามหนังสือที่ ผอ. ลงนาม
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS director_at         TIMESTAMPTZ;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hrd_travel_requests_approval_stage') THEN
        ALTER TABLE hrd_travel_requests ADD CONSTRAINT ck_hrd_travel_requests_approval_stage CHECK (approval_stage IN ('chain', 'director', 'approved'));
    END IF;
END $$;
-- ดัชนีค้นสายอนุมัติ (GIN บน approval_chain) อยู่ใน hrd_travel_indexes.sql

-- การกดอนุมัติ/ไม่อนุมัติในระบบ (สำเนาชื่อ ตำแหน่ง ลายเซ็น ณ เวลานั้น — พิมพ์ลงช่องความเห็น)
CREATE TABLE IF NOT EXISTS hrd_travel_request_approvals (
    id                 SERIAL PRIMARY KEY,
    request_id         INT NOT NULL REFERENCES hrd_travel_requests(id) ON DELETE CASCADE,
    step               INT NOT NULL,
    level              VARCHAR(10) NOT NULL,          -- MAJOR / MISSION
    approver_id        INT NOT NULL REFERENCES users(id),
    approver_name      VARCHAR(200) NOT NULL,
    approver_position  VARCHAR(200),
    is_acting          BOOLEAN NOT NULL DEFAULT FALSE,
    unit_name          VARCHAR(200),
    action             VARCHAR(10) NOT NULL CHECK (action IN ('approved', 'rejected')),
    comment            VARCHAR(300),
    signature          TEXT NOT NULL,
    acted_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (request_id, step)
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_request_approvals_approver ON hrd_travel_request_approvals(approver_id, acted_at DESC);
