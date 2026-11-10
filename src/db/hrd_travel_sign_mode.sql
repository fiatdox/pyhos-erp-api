-- ══════════════════════════════════════════════════════════════════════════════
-- เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — โหมดการลงนามตามกลุ่ม
-- รันหลัง hrd_travel_approval.sql · รันซ้ำได้
--
--   esign  ลงนามอิเล็กทรอนิกส์ผ่านระบบ: ผู้ขอ + หัวหน้ากลุ่มงาน + หัวหน้ากลุ่มภารกิจ ลงนามในระบบ · ผอ. เซ็นจริง
--   paper  เดินเอกสาร: ยื่นในระบบแล้วพิมพ์บันทึกข้อความไปเสนอลงนามจริงทุกช่อง · งาน HRD บันทึกผลตามเอกสาร
--
-- โหมดของผู้ขอ = ตั้งที่กลุ่มงาน → ตั้งที่กลุ่มภารกิจ → ค่าเริ่มต้น (unit_type 'default', unit_id 0)
-- ไม่มีแถว = ตามระดับบน · คำขอเก็บโหมด ณ วันยื่นไว้ (hrd_travel_requests.sign_mode)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hrd_travel_sign_modes (
    unit_type   VARCHAR(10) NOT NULL CHECK (unit_type IN ('default', 'mission', 'major')),
    unit_id     INT NOT NULL DEFAULT 0,                 -- mission_id / major_id · default = 0
    mode        VARCHAR(10) NOT NULL CHECK (mode IN ('esign', 'paper')),
    updated_by  INT REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (unit_type, unit_id),
    CHECK ((unit_type = 'default') = (unit_id = 0))
);
INSERT INTO hrd_travel_sign_modes (unit_type, unit_id, mode) VALUES ('default', 0, 'esign') ON CONFLICT DO NOTHING;

-- ประวัติการเปลี่ยน (before/after null = ตามระดับบน)
CREATE TABLE IF NOT EXISTS hrd_travel_sign_mode_log (
    id          SERIAL PRIMARY KEY,
    unit_type   VARCHAR(10) NOT NULL,
    unit_id     INT NOT NULL,
    unit_name   VARCHAR(200),
    before      VARCHAR(10),
    after       VARCHAR(10),
    changed_by  INT REFERENCES users(id),
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_sign_mode_log_at ON hrd_travel_sign_mode_log(changed_at DESC);

-- คำขอที่ยื่นก่อนมีการตั้งค่านี้ไม่มีลายเซ็นในระบบอยู่แล้ว = paper · คำขอใหม่ระบบใส่โหมดเองทุกครั้ง
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS sign_mode VARCHAR(10) NOT NULL DEFAULT 'paper';
UPDATE hrd_travel_requests SET sign_mode = 'esign' WHERE sign_mode = 'paper' AND requester_signature IS NOT NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hrd_travel_requests_sign_mode') THEN
        ALTER TABLE hrd_travel_requests ADD CONSTRAINT ck_hrd_travel_requests_sign_mode CHECK (sign_mode IN ('esign', 'paper'));
    END IF;
END $$;
