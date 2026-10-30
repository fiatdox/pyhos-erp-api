-- ── ประวัติการโอนข้อมูลจากโปรแกรมการลาเดิม (หน้า HR /hr/leave/legacy-import) ──────
--
-- งาน HR กดโอนจากหน้าเว็บ → รันเบื้องหลัง เก็บผลและรายงานไว้ที่นี่ (ดูย้อนหลังได้ว่าใครโอนอะไรเมื่อไร)
-- kind: LEAVE = ประวัติการลา · SERVICE_DATES = วันเริ่มงาน
-- mode: DRY_RUN = ทดลอง (ไม่เขียนข้อมูล) · COMMIT = โอนจริง · UNDO = ถอนที่โอนไปแล้ว
-- status: RUNNING → DONE / FAILED
--
-- รันซ้ำได้

CREATE TABLE IF NOT EXISTS core_kon.hr_legacy_import_runs (
    id          serial PRIMARY KEY,
    kind        varchar(20) NOT NULL,
    mode        varchar(10) NOT NULL,
    params      jsonb NOT NULL DEFAULT '{}'::jsonb,
    status      varchar(10) NOT NULL DEFAULT 'RUNNING',
    progress    integer NOT NULL DEFAULT 0,
    total       integer NOT NULL DEFAULT 0,
    totals      jsonb,
    report      text,
    error       text,
    created_by  integer REFERENCES core_kon.users(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_legacy_import_runs_created ON core_kon.hr_legacy_import_runs (created_at DESC);
