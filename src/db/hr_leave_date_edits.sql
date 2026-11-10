-- ══════════════════════════════════════════════════════════════════════════════
-- ประวัติการแก้วันที่ลาโดยงาน HR (หน้าประวัติการลาเจ้าหน้าที่ → การตรวจของงาน HR → แก้วันที่ลา)
-- กรณีใช้: ผู้ลาขอยกเลิกบางวันของใบที่ยื่น/อนุมัติแล้ว → HR ย่นช่วงวันลา ระบบคืนวันลาส่วนต่างทันที
-- before / after = { start_date, end_date, is_half_day, half_day_period, total_days }
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS core_kon.hr_leave_date_edits (
    id          BIGSERIAL PRIMARY KEY,
    request_id  INTEGER     NOT NULL REFERENCES core_kon.hr_leave_requests (id) ON DELETE CASCADE,
    before      JSONB       NOT NULL,
    after       JSONB       NOT NULL,
    refunded_days NUMERIC(6,1) NOT NULL DEFAULT 0,
    reason      TEXT        NOT NULL,
    actor_id    INTEGER     NOT NULL REFERENCES core_kon.users (id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_leave_date_edits_request
    ON core_kon.hr_leave_date_edits (request_id, created_at DESC);
