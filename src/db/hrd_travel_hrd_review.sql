-- ══════════════════════════════════════════════════════════════════════════════
-- เดินทางไปราชการ: เจ้าหน้าที่ HRD ตรวจคำขอเป็นขั้นแรก ก่อนเข้าสายหัวหน้า
--   ผู้ขอยื่น → hrd (HRD ตรวจ) → chain (หัวหน้ากลุ่มงาน → หัวหน้ากลุ่มภารกิจ) → director (ผอ. ลงนามบนกระดาษ) → approved
--   HRD ตรวจแล้ว: ผ่าน → chain (เดินเอกสาร/ไม่มีหัวหน้าในสาย → director)
--                ส่งกลับแก้ไข → returned (ผู้ขอแก้แล้วส่งใหม่ → hrd อีกครั้ง)
--                ไม่อนุมัติ → status rejected จบคำขอ
-- คำขอที่ยื่นก่อนมีขั้นนี้ไม่เปลี่ยน (อยู่ใน chain/director/approved ตามเดิม) · ถ้าผู้ขอแก้ไขภายหลังจะกลับไปเริ่มที่ HRD ตรวจ
-- รันหลัง hrd_travel_approval.sql · รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE hrd_travel_requests DROP CONSTRAINT IF EXISTS ck_hrd_travel_requests_approval_stage;
ALTER TABLE hrd_travel_requests ADD CONSTRAINT ck_hrd_travel_requests_approval_stage
    CHECK (approval_stage IN ('hrd', 'returned', 'chain', 'director', 'approved'));

-- ประวัติการตรวจของ HRD (ตรวจได้หลายรอบเมื่อส่งกลับแก้ไข)
CREATE TABLE IF NOT EXISTS hrd_travel_request_reviews (
    id             SERIAL PRIMARY KEY,
    request_id     INT NOT NULL REFERENCES hrd_travel_requests(id) ON DELETE CASCADE,
    reviewer_id    INT NOT NULL REFERENCES users(id),
    reviewer_name  VARCHAR(200) NOT NULL,
    action         VARCHAR(10) NOT NULL CHECK (action IN ('passed', 'returned', 'rejected')),
    note           VARCHAR(1000),                  -- สิ่งที่ต้องแก้ไข / เหตุผล (หลายบรรทัด)
    acted_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_request_reviews_request ON hrd_travel_request_reviews(request_id, acted_at);
COMMENT ON TABLE hrd_travel_request_reviews IS 'เจ้าหน้าที่ HRD ตรวจคำขอเดินทางไปราชการ: passed ผ่าน · returned ส่งกลับแก้ไข · rejected ไม่อนุมัติ';
