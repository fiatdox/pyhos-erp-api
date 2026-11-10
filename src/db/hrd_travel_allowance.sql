-- ══════════════════════════════════════════════════════════════════════════════
-- เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — อัตราเบี้ยเลี้ยง
--
-- hrd_travel_allowance_tiers : อัตราเบี้ยเลี้ยงและราคา (บาท/วัน) — แก้ราคาได้ที่หน้าตั้งค่า
--   เริ่มต้น 2 อัตรา: อัตราปกติ 240 (ค่าเริ่มต้นของทุกคน) และอัตราพิเศษ 270
--   ราคาเปลี่ยน = แก้ที่อัตรา ทุกคนในอัตรานั้นได้ราคาใหม่ทันที
-- hrd_travel_allowance       : บุคลากรคนไหนอยู่อัตราไหน — ไม่มีแถว = อัตราที่ is_default
--
-- ผู้ตั้งค่า: ADMIN หรือ role HRD (เจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล) — ADMIN จับคนใส่ role ที่หน้าจัดการสิทธิ์
-- คำขอไปราชการในอนาคตต้องเก็บราคา ณ วันที่ขอไว้ในคำขอเอง ไม่อ้างราคาปัจจุบันของอัตรา
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO user_roles (role_name, description)
SELECT 'HRD', 'เจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล (HRD)'
WHERE NOT EXISTS (SELECT 1 FROM user_roles WHERE UPPER(role_name) = 'HRD');

CREATE TABLE IF NOT EXISTS hrd_travel_allowance_tiers (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(30) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    amount      INT NOT NULL CHECK (amount > 0 AND amount <= 10000),   -- บาท/วัน
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    sort_order  INT NOT NULL DEFAULT 0,
    updated_by  INT REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- อัตราค่าเริ่มต้นมีได้อัตราเดียว
CREATE UNIQUE INDEX IF NOT EXISTS uq_hrd_travel_allowance_tiers_default ON hrd_travel_allowance_tiers (is_default) WHERE is_default;

INSERT INTO hrd_travel_allowance_tiers (code, name, amount, is_default, sort_order) VALUES
    ('standard', 'อัตราปกติ', 240, TRUE, 1),
    ('special',  'อัตราพิเศษ', 270, FALSE, 2)
ON CONFLICT (code) DO NOTHING;

-- ประวัติการแก้ราคา
CREATE TABLE IF NOT EXISTS hrd_travel_allowance_tier_log (
    id          SERIAL PRIMARY KEY,
    tier_id     INT NOT NULL REFERENCES hrd_travel_allowance_tiers(id),
    old_name    VARCHAR(100) NOT NULL,
    new_name    VARCHAR(100) NOT NULL,
    old_amount  INT NOT NULL,
    new_amount  INT NOT NULL,
    changed_by  INT REFERENCES users(id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_allowance_tier_log_tier ON hrd_travel_allowance_tier_log(tier_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS hrd_travel_allowance (
    user_id     INT PRIMARY KEY REFERENCES users(id),
    tier_id     INT NOT NULL REFERENCES hrd_travel_allowance_tiers(id),
    updated_by  INT REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_allowance_tier ON hrd_travel_allowance(tier_id);

-- ประวัติการย้ายอัตรารายบุคคล — เก็บราคา ณ ตอนเปลี่ยนไว้ด้วย อ่านย้อนหลังได้แม้ราคาอัตราเปลี่ยนภายหลัง
CREATE TABLE IF NOT EXISTS hrd_travel_allowance_log (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id),
    old_tier_id INT NOT NULL REFERENCES hrd_travel_allowance_tiers(id),
    new_tier_id INT NOT NULL REFERENCES hrd_travel_allowance_tiers(id),
    old_amount  INT NOT NULL,
    new_amount  INT NOT NULL,
    changed_by  INT REFERENCES users(id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_allowance_log_user ON hrd_travel_allowance_log(user_id, changed_at DESC);
