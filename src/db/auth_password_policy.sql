-- ══════════════════════════════════════════════════════════════════════════════
-- นโยบายอายุรหัสผ่าน (บังคับเปลี่ยนรหัสผ่านทุก N วัน)
-- ปิดอยู่โดยปริยาย — เปิดได้จากหน้าตั้งค่าของผู้ดูแลระบบ
-- ══════════════════════════════════════════════════════════════════════════════

-- วันเวลาที่เปลี่ยนรหัสผ่านครั้งล่าสุด
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;

-- Backfill: ตั้งต้นนับจาก "ตอนติดตั้งนโยบาย" ไม่ใช่ NULL
-- เหตุผล: ถ้าปล่อย NULL แล้วถือว่าหมดอายุ ผู้ใช้ทั้งองค์กรจะถูกบังคับเปลี่ยนรหัสพร้อมกันทันทีที่เปิดใช้
-- (updated_at ใช้แทนไม่ได้ เพราะขยับทุกครั้งที่แก้ข้อมูลอื่นของผู้ใช้ ไม่ใช่เฉพาะตอนเปลี่ยนรหัส)
UPDATE users SET password_changed_at = NOW() WHERE password_changed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_password_changed_at ON users(password_changed_at);

-- ค่าตั้งนโยบาย (ใช้ตาราง auth_settings ร่วมกับ MFA)
INSERT INTO auth_settings (name, value, description) VALUES
    ('password_expiry_enabled',   'false', 'เปิด/ปิดการบังคับเปลี่ยนรหัสผ่านตามรอบ'),
    ('password_expiry_days',      '90',    'อายุรหัสผ่าน (วัน) — ครบกำหนดแล้วต้องเปลี่ยนก่อนใช้งานต่อ'),
    ('password_expiry_warn_days', '7',     'เริ่มเตือนล่วงหน้ากี่วันก่อนรหัสผ่านหมดอายุ')
ON CONFLICT (name) DO NOTHING;
