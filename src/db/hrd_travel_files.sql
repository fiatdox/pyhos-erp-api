-- ══════════════════════════════════════════════════════════════════════════════
-- ไฟล์แนบของคำขอไปราชการ — เก็บไฟล์ที่ uploads/hrd-travel/<uuid>.<ext>
--   source       หนังสือต้นเรื่อง (หนังสือเชิญ / คำสั่ง / หนังสืออนุญาตจัดอบรม ฯลฯ) — ต้องแนบทุกคำขอ
--   plane        หนังสืออนุมัติเดินทางโดยเครื่องบิน — ต้องแนบเมื่อเลือกเครื่องบิน
--   private_car  หนังสือขออนุมัติใช้รถยนต์ส่วนตัว — ต้องแนบเมื่อเลือกพาหนะส่วนตัว
-- แนบ/ลบได้: ผู้ขอ หรือ ADMIN/HRD ขณะคำขอยังไม่ยกเลิก/ไม่ถูกปฏิเสธ · ดูได้: ผู้มีสิทธิ์ดูคำขอ
-- ลบคำขอ (CASCADE) → แถวไฟล์หายตาม (ไฟล์บนดิสก์ไม่ลบ — คำขอยกเลิกไม่ลบแถวอยู่แล้ว)
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hrd_travel_request_files (
    id             SERIAL PRIMARY KEY,
    request_id     INT NOT NULL REFERENCES hrd_travel_requests(id) ON DELETE CASCADE,
    kind           VARCHAR(20) NOT NULL CHECK (kind IN ('source', 'plane', 'private_car')),
    file_name      VARCHAR(80) NOT NULL,          -- ชื่อที่เก็บบนดิสก์ (uuid.ext)
    original_name  VARCHAR(255) NOT NULL,
    mime           VARCHAR(100) NOT NULL,
    size_bytes     INT NOT NULL CHECK (size_bytes > 0),
    uploaded_by    INT REFERENCES users(id),
    uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_request_files_req ON hrd_travel_request_files(request_id, kind);
