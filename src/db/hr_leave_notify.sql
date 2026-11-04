-- ══════════════════════════════════════════════════════════════════════════════
-- การแจ้งเตือนระบบลาออนไลน์ผ่าน MOPH Alert (หมอพร้อม รายคน ตามเลขบัตรประชาชน users.id_card)
--
--   hr_leave_notify_config  ค่าตั้งชุดเดียว (id = 1) เป็น JSON — ผู้ดูแลระบบ (ADMIN) แก้ที่ /hr/leave/notify-settings
--                           ไม่มีแถว = ปิดการแจ้งเตือนทั้งหมด (ค่าตั้งต้นในโค้ด enabled = false)
--   hr_leave_notify_log     ประวัติการส่ง — slot_key กันรอบสรุปส่งซ้ำ (หลายเครื่อง/รีสตาร์ทกลางรอบ)
--
-- ติดตั้ง: รันไฟล์นี้ครั้งเดียว (รันซ้ำได้)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_leave_notify_config (
    id          INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    config      JSONB       NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  INT
);

CREATE TABLE IF NOT EXISTS hr_leave_notify_log (
    id          BIGSERIAL   PRIMARY KEY,
    kind        VARCHAR(30) NOT NULL,       -- SUBMITTED / COLLEAGUE / APPROVER / DIGEST / RESULT / TEST
    request_id  INT,
    recipients  INT         NOT NULL DEFAULT 0,
    slot_key    VARCHAR(60),                -- DIGEST: 'digest:YYYY-MM-DD HH:MM'
    status      VARCHAR(10) NOT NULL,       -- SENT / SKIPPED / FAILED
    detail      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_leave_notify_slot ON hr_leave_notify_log (slot_key) WHERE slot_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_hr_leave_notify_log_created ON hr_leave_notify_log (created_at DESC);

COMMENT ON TABLE hr_leave_notify_config IS 'ค่าตั้งการแจ้งเตือนระบบลา (JSON ชุดเดียว) — ADMIN แก้ที่ /hr/leave/notify-settings';
COMMENT ON TABLE hr_leave_notify_log    IS 'ประวัติการส่งแจ้งเตือนระบบลา — slot_key กันรอบสรุปส่งซ้ำ';
