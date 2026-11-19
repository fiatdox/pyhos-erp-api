-- ══════════════════════════════════════════════════════════════════════════════
-- รายงานผลการเดินทางไปราชการ (เสนอผู้บริหารทราบ) — หนึ่งคำขอมีหนึ่งรายงาน
--   content    เนื้อหาจากตัวแก้ไขข้อความ (tiptap JSON) ที่ backend กรองแล้ว: ย่อหน้า รายการ ตัวหนา/เอียง/ขีดเส้นใต้ ขนาดตัวอักษร จัดแนว
--   plain_text ข้อความล้วน (ค้นหา / แสดงตัวอย่างในรายการ) — backend สร้างจาก content
--   status     draft = ร่าง (เห็นเฉพาะผู้เขียน/ADMIN/HRD) · submitted = ส่งแล้ว (ผู้บริหารในสาย/ผอ./HRD เห็น)
-- ผู้บริหารรับทราบบนกระดาษ (พิมพ์บันทึกข้อความจากระบบ) — ไม่มีการกดรับทราบในระบบ
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hrd_travel_reports (
    id            SERIAL PRIMARY KEY,
    request_id    INT NOT NULL UNIQUE REFERENCES hrd_travel_requests(id) ON DELETE CASCADE,
    memo_no       VARCHAR(30),
    content       JSONB NOT NULL,
    plain_text    TEXT NOT NULL DEFAULT '',
    status        VARCHAR(10) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
    submitted_at  TIMESTAMPTZ,
    created_by    INT REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by    INT REFERENCES users(id),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (status = 'draft' OR submitted_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_reports_submitted ON hrd_travel_reports(submitted_at DESC) WHERE status = 'submitted';
