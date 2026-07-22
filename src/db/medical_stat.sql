-- ============================================================================
-- Medical Statistics Request module (schema core_kon)
-- ระบบขอข้อมูลสถิติทางการแพทย์ + ตรวจ PDPA + มอบหมายประมวลผล + dashboard
-- ============================================================================

-- master: จุดประสงค์การขอข้อมูล (ใช้ทำสถิติใน dashboard ว่าเอาข้อมูลไปทำอะไร)
CREATE TABLE IF NOT EXISTS stat_purpose_categories (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(120) NOT NULL,
    description  VARCHAR(255),
    sort_order   INT NOT NULL DEFAULT 0,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- master: ระดับความเร่งด่วน (มีสีสำหรับ select)
CREATE TABLE IF NOT EXISTS stat_urgency_levels (
    id           SERIAL PRIMARY KEY,
    code         VARCHAR(30) NOT NULL UNIQUE,
    name         VARCHAR(60) NOT NULL,
    color_hex    VARCHAR(9) NOT NULL DEFAULT '#999999',
    sort_order   INT NOT NULL DEFAULT 0,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

-- คำขอหลัก
CREATE TABLE IF NOT EXISTS stat_requests (
    id                  SERIAL PRIMARY KEY,
    request_no          VARCHAR(30) NOT NULL UNIQUE,
    requester_id        INT NOT NULL REFERENCES users(id),
    email               VARCHAR(255),               -- อีเมลผู้ขอ (ผู้ประมวลผลตอบกลับข้อมูลผ่านอีเมลนี้)
    purpose_category_id INT REFERENCES stat_purpose_categories(id),
    purpose_detail      TEXT,                       -- จุดประสงค์ (บรรยาย)
    data_detail         TEXT,                       -- รายละเอียดข้อมูลที่ขอ (รหัสโรค ฯลฯ)
    period_from         DATE,
    period_to           DATE,
    format              VARCHAR(40),                -- Excel/PDF/CSV/พิมพ์
    urgency_id          INT REFERENCES stat_urgency_levels(id),
    -- workflow: pending -> processing (หัวหน้าอนุมัติ+มอบหมาย) -> delivered ; หรือ rejected
    status              VARCHAR(20) NOT NULL DEFAULT 'pending',
    review_type         VARCHAR(20),                -- 'full' | 'partial' (ตัดบางฟิลด์) ; null=ยังไม่ตรวจ
    review_note         TEXT,                       -- หมายเหตุ PDPA จากหัวหน้า
    reviewed_by         INT REFERENCES users(id),
    reviewed_at         TIMESTAMPTZ,
    assigned_to         INT REFERENCES users(id),   -- เจ้าพนักงานเวชสถิติผู้ประมวลผล
    delivered_note      TEXT,
    delivered_by        INT REFERENCES users(id),
    delivered_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stat_requests_status   ON stat_requests(status);
CREATE INDEX IF NOT EXISTS idx_stat_requests_reqester ON stat_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_stat_requests_assigned ON stat_requests(assigned_to);

-- ไฟล์แนบ: kind='sample' (Excel ตัวอย่างจากผู้ขอ 1-5 ไฟล์), 'result' (ไฟล์ที่ส่งมอบ)
CREATE TABLE IF NOT EXISTS stat_request_files (
    id             SERIAL PRIMARY KEY,
    request_id     INT NOT NULL REFERENCES stat_requests(id) ON DELETE CASCADE,
    kind           VARCHAR(10) NOT NULL DEFAULT 'sample',
    stored_name    VARCHAR(120) NOT NULL,           -- ชื่อไฟล์บนดิสก์ (uuid.ext)
    original_name  VARCHAR(255) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stat_files_request ON stat_request_files(request_id);

-- ฟิลด์ที่หัวหน้าสั่งห้ามส่ง (PDPA) — ผู้ประมวลผลต้องไม่ดึงฟิลด์เหล่านี้
CREATE TABLE IF NOT EXISTS stat_request_restricted_fields (
    id           SERIAL PRIMARY KEY,
    request_id   INT NOT NULL REFERENCES stat_requests(id) ON DELETE CASCADE,
    field_name   VARCHAR(150) NOT NULL,
    note         VARCHAR(255),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stat_restricted_request ON stat_request_restricted_fields(request_id);

-- ประวัติการดำเนินการ (timeline)
CREATE TABLE IF NOT EXISTS stat_request_history (
    id           SERIAL PRIMARY KEY,
    request_id   INT NOT NULL REFERENCES stat_requests(id) ON DELETE CASCADE,
    step_name    VARCHAR(60) NOT NULL,
    actor_id     INT REFERENCES users(id),
    action       VARCHAR(120) NOT NULL,
    note         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stat_history_request ON stat_request_history(request_id);
