-- ══════════════════════════════════════════════════════════════════════════════
-- ประวัติการปรับสายอนุมัติใบลาให้ตรงผังปัจจุบัน (ADMIN — หน้า /hr/leave/chain-resync)
--
-- การปรับแก้ทั้ง approval_chain และแถวใน hr_leave_approvals (เปลี่ยนผู้กด / ลบขั้นที่ไม่มีในผังแล้ว)
-- จึงเก็บค่าเดิมไว้ทั้งชุด ตรวจย้อนหลังได้ว่าใครปรับ และใบเดิมเป็นอย่างไร
--
-- ติดตั้ง: รันไฟล์นี้ครั้งเดียว (รันซ้ำได้)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_leave_chain_resync_log (
    id          BIGSERIAL   PRIMARY KEY,
    request_id  INT         NOT NULL REFERENCES hr_leave_requests(id),
    actor_id    INT         NOT NULL,
    note        TEXT,
    before      JSONB       NOT NULL,       -- { current_step, approval_chain, approvals: [...] }
    after       JSONB       NOT NULL,       -- { current_step, approval_chain, changes: [...] }
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_hr_leave_chain_resync_log_request ON hr_leave_chain_resync_log (request_id);
CREATE INDEX IF NOT EXISTS ix_hr_leave_chain_resync_log_created ON hr_leave_chain_resync_log (created_at DESC);

COMMENT ON TABLE hr_leave_chain_resync_log IS 'ประวัติการปรับสายอนุมัติใบลาตามผังปัจจุบัน — เก็บค่าเดิมของสายและการอนุมัติ';
