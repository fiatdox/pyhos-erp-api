-- ══════════════════════════════════════════════════════════════════════════════
-- MFA / OTP ผ่าน Line หมอพร้อม (MOPH Alert v3.1)
-- ออกแบบให้ "ปิดอยู่โดยปริยาย" — ตราบใดที่ mfa_enabled = false ระบบ login ทำงานเหมือนเดิมทุกประการ
-- ══════════════════════════════════════════════════════════════════════════════

-- ── ค่าตั้งระบบยืนยันตัวตน (แก้ได้จากหน้า admin) ──────────────────────────────
CREATE TABLE IF NOT EXISTS auth_settings (
    name         VARCHAR(60) PRIMARY KEY,
    value        VARCHAR(200),
    description  VARCHAR(300),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by   INT
);

-- ค่าเริ่มต้น — ON CONFLICT DO NOTHING เพื่อให้รันซ้ำได้ไม่ทับค่าที่ admin ตั้งไว้
INSERT INTO auth_settings (name, value, description) VALUES
    ('mfa_enabled',                  'false', 'เปิด/ปิดระบบ MFA ทั้งระบบ — false = login ด้วยรหัสผ่านอย่างเดียวเหมือนเดิม'),
    ('mfa_scope',                    'users', 'ขอบเขตบังคับ MFA: users = เฉพาะรายชื่อใน auth_mfa_users | roles = เฉพาะ role ที่ระบุ | all = ทุกคน'),
    ('mfa_roles',                    '',      'รายชื่อ role ที่บังคับ MFA (คั่นด้วยจุลภาค) — ใช้เมื่อ mfa_scope = roles'),
    ('mfa_otp_ttl_seconds',          '300',   'อายุรหัส OTP (วินาที)'),
    ('mfa_max_attempts',             '5',     'จำนวนครั้งที่กรอก OTP ผิดได้ก่อนตัดรอบ'),
    ('mfa_resend_cooldown_seconds',  '60',    'ต้องรอกี่วินาทีก่อนขอรหัสใหม่ได้'),
    ('mfa_challenge_ttl_seconds',    '600',   'อายุรอบยืนยันตัวตน (challenge) รวมทั้งหมด')
ON CONFLICT (name) DO NOTHING;

-- ── รายชื่อผู้ใช้ที่บังคับ MFA (ใช้เมื่อ mfa_scope = 'users') ──────────────────
-- ระยะทดสอบ: ใส่เฉพาะผู้ทดสอบ เพื่อไม่ให้คนอื่นได้รับผลกระทบ
CREATE TABLE IF NOT EXISTS auth_mfa_users (
    user_id   INT PRIMARY KEY,
    added_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    added_by  INT
);

-- ── รอบยืนยัน OTP ─────────────────────────────────────────────────────────────
-- เก็บเฉพาะ hash ของ OTP (ไม่เก็บเลขจริง) — หลุดฐานข้อมูลก็ใช้ OTP ต่อไม่ได้
CREATE TABLE IF NOT EXISTS auth_otp_challenges (
    id                   SERIAL PRIMARY KEY,
    challenge_token      UUID NOT NULL UNIQUE,
    user_id              INT NOT NULL,
    otp_hash             TEXT NOT NULL,
    attempts             INT NOT NULL DEFAULT 0,
    max_attempts         INT NOT NULL DEFAULT 5,
    resend_count         INT NOT NULL DEFAULT 0,
    expires_at           TIMESTAMPTZ NOT NULL,   -- อายุของ OTP รอบล่าสุด
    challenge_expires_at TIMESTAMPTZ NOT NULL,   -- อายุรวมของ challenge (ขอรหัสใหม่ไม่ยืดอันนี้)
    last_sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at          TIMESTAMPTZ,            -- ยืนยันสำเร็จแล้ว (ใช้ซ้ำไม่ได้)
    failed_at            TIMESTAMPTZ,            -- ตัดรอบเพราะผิดเกินกำหนด
    client_ip            VARCHAR(64),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_user    ON auth_otp_challenges(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_token   ON auth_otp_challenges(challenge_token);
CREATE INDEX IF NOT EXISTS idx_otp_challenges_created ON auth_otp_challenges(created_at);

-- ── บันทึกเหตุการณ์ (audit) ───────────────────────────────────────────────────
-- ใช้ตรวจสอบย้อนหลัง + วัดอัตราส่งถึง/ความหน่วงตามที่ต้องประเมินก่อนขยายผล
CREATE TABLE IF NOT EXISTS auth_mfa_audit (
    id           SERIAL PRIMARY KEY,
    user_id      INT,
    username     VARCHAR(100),
    event        VARCHAR(40) NOT NULL,
        -- otp_sent | otp_send_failed | otp_verified | otp_wrong | otp_expired
        -- | otp_locked | otp_resent | settings_changed
    detail       VARCHAR(400),
    send_ms      INT,              -- เวลาที่ MOPH Alert ตอบกลับ (มิลลิวินาที)
    client_ip    VARCHAR(64),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mfa_audit_user    ON auth_mfa_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_audit_event   ON auth_mfa_audit(event);
CREATE INDEX IF NOT EXISTS idx_mfa_audit_created ON auth_mfa_audit(created_at);
