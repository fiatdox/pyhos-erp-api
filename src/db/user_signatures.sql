-- ══════════════════════════════════════════════════════════════════════════════
-- ลายเซ็นของผู้ใช้ (ตั้งค่าเองที่หน้า ตั้งค่าบัญชี > ลายเซ็น)
-- ใช้ลงนามเอกสารที่อนุมัติผ่านระบบ เช่น ขออนุมัติเดินทางไปราชการ (ผู้ขอ / หัวหน้ากลุ่มงาน / หัวหน้ากลุ่มภารกิจ)
-- ผู้อำนวยการยังลงนามจริงบนกระดาษ
--
-- เก็บเป็น PNG (data URL) ที่หน้าเว็บวาด/ย่อแล้ว — server ตรวจชนิดไฟล์ ขนาด และมิติภาพ
-- เอกสารที่ลงนามแล้ว "คัดลอก" ลายเซ็นไปเก็บในเอกสารนั้น — เปลี่ยน/ลบลายเซ็นภายหลังไม่กระทบเอกสารเดิม
-- อ่านลายเซ็นของตัวเองได้คนเดียว (ไม่มี API ให้ดูลายเซ็นของคนอื่น)
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_signatures (
    user_id     INT PRIMARY KEY REFERENCES users(id),
    image       TEXT NOT NULL,                 -- data:image/png;base64,...
    width       INT NOT NULL,
    height      INT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ประวัติการตั้ง/ลบ (ไม่เก็บภาพ)
CREATE TABLE IF NOT EXISTS user_signature_log (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id),
    action      VARCHAR(10) NOT NULL CHECK (action IN ('set', 'delete')),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_user_signature_log_user ON user_signature_log(user_id, changed_at DESC);
