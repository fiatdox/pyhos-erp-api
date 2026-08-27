-- ══════════════════════════════════════════════════════════════════════════════
-- บันทึกการแก้ไขบัญชีผู้ใช้โดยผู้ดูแล (username / รหัสผ่าน / เลขบัตรประชาชน)
-- ทั้ง 3 อย่างเป็นข้อมูลยืนยันตัวตน โดยเฉพาะเลขบัตรที่เป็นปลายทางส่ง OTP หมอพร้อม
-- การแก้ไขจึงต้องตรวจสอบย้อนหลังได้เสมอว่าใครแก้ของใคร เมื่อไหร่
--
-- ไม่เก็บค่ารหัสผ่าน (ทั้งเก่าและใหม่) เก็บแค่ว่า "มีการเปลี่ยน"
-- เลขบัตรเก็บเฉพาะ 4 ตัวท้ายไว้อ้างอิง ไม่เก็บเลขเต็ม
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_credential_audit (
    id             SERIAL PRIMARY KEY,
    target_user_id INT NOT NULL,          -- บัญชีที่ถูกแก้
    target_username VARCHAR(100),
    actor_user_id  INT,                   -- ผู้ดูแลที่แก้
    actor_username VARCHAR(100),
    field          VARCHAR(20) NOT NULL,  -- username | password | id_card
    old_value      VARCHAR(120),          -- password = NULL เสมอ · id_card = ****1234
    new_value      VARCHAR(120),
    client_ip      VARCHAR(64),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cred_audit_target  ON user_credential_audit(target_user_id);
CREATE INDEX IF NOT EXISTS idx_cred_audit_actor   ON user_credential_audit(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_cred_audit_created ON user_credential_audit(created_at);
