-- ══════════════════════════════════════════════════════════════════════════════
-- ระบบคืนหลักประกันสัญญา — schema core_kon
--
-- ชื่อนำหน้าตาราง = หน่วยงานเจ้าของข้อมูล (ผู้รับผิดชอบความถูกต้องของแถวนั้น)
--   proc_  กลุ่มงานพัสดุ    ทะเบียนผู้รับจ้าง (รหัสกลางให้ระบบอื่นอ้าง) สัญญา แฟ้มเอกสาร ผลตรวจ ความชำรุด บันทึกเสนอคืน
--   fin_   กลุ่มงานการเงิน  ทะเบียนหลักประกัน การจ่ายคืน เจ้าหนี้ และการจ่ายหนี้
--   ctr_   ใช้ร่วมกันทุกหน่วย งานตามกำหนด กฎ ประวัติการแก้ไข
--
-- กรรมการตรวจรับ ผู้ควบคุมงาน และผู้ครอบครองพัสดุ เป็น "หน้าที่" ไม่ใช่หน่วยงาน
-- (มาจากหลายหน่วยและเปลี่ยนตามสัญญา) ข้อมูลที่กรอกจึงอยู่ใต้ proc_ เพราะเข้าแฟ้มสัญญาของพัสดุ
-- ส่วนชื่อที่ต่อจากชื่อนำหน้าใช้ contract_ / guarantee_ ให้ตารางชุดเดียวกันเรียงติดกัน
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── proc_ : กลุ่มงานพัสดุ ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proc_vendors (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    tax_id       VARCHAR(20),
    contact_name VARCHAR(150),
    phone        VARCHAR(50),
    email        VARCHAR(150),
    address      TEXT,
    created_by   INT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_proc_vendors_tax ON proc_vendors(tax_id) WHERE tax_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS proc_contracts (
    id                  SERIAL PRIMARY KEY,
    contract_no         VARCHAR(60) NOT NULL UNIQUE,
    project_name        VARCHAR(500) NOT NULL,
    work_type           VARCHAR(20) NOT NULL CHECK (work_type IN ('construction', 'purchase', 'hire', 'maintenance')),
    vendor_id           INT NOT NULL REFERENCES proc_vendors(id),
    contract_value      NUMERIC(14,2),
    owner_major_id      INT,                    -- หน่วยงานเจ้าของโครงการ (majors.major_id)
    signed_date         DATE,
    delivered_date      DATE,
    accepted_date       DATE,                   -- วันตรวจรับ
    warranty_months     INT NOT NULL DEFAULT 0 CHECK (warranty_months >= 0), -- ใช้แยกประกันระยะสั้น/ยาว
    warranty_end_date   DATE,                   -- T: เจ้าหน้าที่พัสดุเป็นผู้ตั้ง ยังไม่ตั้งจะยังไม่สร้างงานตามกำหนด
    periodic_months     INT CHECK (periodic_months > 0), -- รอบตรวจตามสัญญา/TOR ไม่มีให้ว่าง
    special_terms       TEXT,
    status              VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'returned', 'cancelled')),
    cancel_reason       TEXT,
    created_by          INT,
    updated_by          INT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_contracts_t ON proc_contracts(status, warranty_end_date);

CREATE TABLE IF NOT EXISTS proc_contract_amendments (
    id                      SERIAL PRIMARY KEY,
    contract_id             INT NOT NULL REFERENCES proc_contracts(id),
    amendment_no            VARCHAR(60) NOT NULL,
    amendment_date          DATE NOT NULL,
    change_type             VARCHAR(20) NOT NULL CHECK (change_type IN ('extend_time', 'value', 'warranty', 'other')),
    detail                  TEXT NOT NULL,
    old_warranty_end_date   DATE,                   -- วันหมดประกันเดิม ก่อนบันทึกนี้เปลี่ยน
    new_warranty_end_date   DATE,                   -- วันหมดประกันใหม่ที่เจ้าหน้าที่ตั้ง (ถ้ามี)
    add_warranty_months     INT NOT NULL DEFAULT 0, -- บวก/ลบเดือนประกัน
    created_by              INT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contract_id, amendment_no)
);

-- ผู้รับผิดชอบรายสัญญา พร้อมผู้สำรอง — เป็นตัวกำหนดว่าใครเห็นสัญญาไหนในหน้ากรรมการ/ผู้ครอบครอง/ผู้อนุมัติ
CREATE TABLE IF NOT EXISTS proc_contract_staff (
    id             SERIAL PRIMARY KEY,
    contract_id    INT NOT NULL REFERENCES proc_contracts(id),
    duty           VARCHAR(20) NOT NULL CHECK (duty IN ('committee', 'supervisor', 'custodian', 'approver')),
    user_id        INT NOT NULL,
    backup_user_id INT,
    UNIQUE (contract_id, duty, user_id)
);
CREATE INDEX IF NOT EXISTS idx_proc_contract_staff_user ON proc_contract_staff(user_id);
CREATE INDEX IF NOT EXISTS idx_proc_contract_staff_backup ON proc_contract_staff(backup_user_id);

-- ทะเบียนเอกสาร: ใครถือต้นฉบับ อยู่ตู้ไหน ตรวจนับล่าสุดเมื่อไร
CREATE TABLE IF NOT EXISTS proc_contract_documents (
    id                SERIAL PRIMARY KEY,
    contract_id       INT NOT NULL REFERENCES proc_contracts(id),
    doc_type          VARCHAR(30) NOT NULL,
    title             VARCHAR(300) NOT NULL,
    holder_user_id    INT,
    backup_user_id    INT,
    location          VARCHAR(300) NOT NULL,   -- อาคาร / ห้อง / ตู้ / เลขแฟ้ม
    scan_ref          VARCHAR(500),            -- ที่อยู่ไฟล์สแกน (ระยะแรกยังไม่มีอัปโหลดในระบบ)
    last_checked_date DATE,
    check_result      VARCHAR(10) CHECK (check_result IN ('found', 'missing')),
    note              TEXT,
    created_by        INT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_contract_documents_c ON proc_contract_documents(contract_id);

CREATE TABLE IF NOT EXISTS proc_contract_inspections (
    id             SERIAL PRIMARY KEY,
    contract_id    INT NOT NULL REFERENCES proc_contracts(id),
    kind           VARCHAR(10) NOT NULL CHECK (kind IN ('periodic', 'final')),
    inspected_date DATE NOT NULL,
    inspector_id   INT NOT NULL,
    result         VARCHAR(10) NOT NULL CHECK (result IN ('pass', 'defect')),
    detail         TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_contract_inspections_c ON proc_contract_inspections(contract_id, kind);

CREATE TABLE IF NOT EXISTS proc_contract_defects (
    id                   SERIAL PRIMARY KEY,
    contract_id          INT NOT NULL REFERENCES proc_contracts(id),
    found_date           DATE NOT NULL,
    detail               TEXT NOT NULL,
    reported_by          INT NOT NULL,
    notified_vendor_date DATE,
    fixed_date           DATE,      -- ยังว่าง = ค้าง เสนอคืนหลักประกันไม่ได้
    fixed_note           TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proc_contract_defects_c ON proc_contract_defects(contract_id);

-- บันทึกเสนอคืน → หัวหน้าหน่วยงานอนุมัติ/ส่งกลับ
CREATE TABLE IF NOT EXISTS proc_contract_returns (
    id            SERIAL PRIMARY KEY,
    contract_id   INT NOT NULL REFERENCES proc_contracts(id),
    released_date DATE NOT NULL,    -- วันที่ผู้รับจ้างพ้นภาระตามสัญญา
    due_date      DATE NOT NULL,    -- กำหนดคืนสุดท้าย = released_date + return_days
    memo          TEXT,
    proposed_by   INT NOT NULL,
    proposed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status        VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'sent_back')),
    decided_by    INT,
    decided_at    TIMESTAMPTZ,
    decision_note TEXT
);
-- เรื่องที่ยังเดินอยู่มีได้เรื่องเดียวต่อสัญญา ส่วนเรื่องที่ถูกส่งกลับเก็บไว้เป็นประวัติ
CREATE UNIQUE INDEX IF NOT EXISTS uq_proc_contract_returns_live ON proc_contract_returns(contract_id) WHERE status IN ('pending', 'approved');

-- ─── fin_ : กลุ่มงานการเงิน ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fin_guarantees (
    id               SERIAL PRIMARY KEY,
    contract_id      INT NOT NULL REFERENCES proc_contracts(id),
    guarantee_type   VARCHAR(20) NOT NULL CHECK (guarantee_type IN ('cash', 'bank_guarantee', 'other')),
    purpose          VARCHAR(20) NOT NULL DEFAULT 'performance' CHECK (purpose IN ('performance', 'advance', 'other')),
    amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    bank_name        VARCHAR(150),
    doc_no           VARCHAR(100),
    expiry_date      DATE,          -- วันหมดอายุหนังสือค้ำประกัน
    storage_location VARCHAR(300) NOT NULL,
    status           VARCHAR(10) NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'returned', 'escrow', 'treasury')),
    created_by       INT,
    updated_by       INT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fin_guarantees_c ON fin_guarantees(contract_id);
CREATE INDEX IF NOT EXISTS idx_fin_guarantees_status ON fin_guarantees(status, expiry_date);

CREATE TABLE IF NOT EXISTS fin_guarantee_payouts (
    id            SERIAL PRIMARY KEY,
    guarantee_id  INT NOT NULL UNIQUE REFERENCES fin_guarantees(id),
    method        VARCHAR(10) NOT NULL CHECK (method IN ('returned', 'escrow', 'treasury')),
    paid_date     DATE NOT NULL,
    deduct_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deduct_amount >= 0),
    deduct_reason TEXT,
    net_amount    NUMERIC(14,2) NOT NULL,
    receiver_name VARCHAR(200),
    voucher_no    VARCHAR(100) NOT NULL,   -- ใบสำคัญจ่าย / หนังสือส่งคืน / เลขที่วางทรัพย์ / เลขนำส่งคลัง
    note          TEXT,
    paid_by       INT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- เจ้าหนี้รายใบ — ยอดค้างจ่ายคำนวณจากการจ่ายจริงเสมอ ไม่เก็บยอดสรุปซ้ำ
-- ระบบอื่นผูกเข้ามาได้ด้วย vendor_id + source_module/source_ref โดยไม่ต้องมีสัญญา
CREATE TABLE IF NOT EXISTS fin_payables (
    id            SERIAL PRIMARY KEY,
    vendor_id     INT NOT NULL REFERENCES proc_vendors(id),
    contract_id   INT REFERENCES proc_contracts(id),
    source_module VARCHAR(40),            -- ระบบต้นทาง เช่น it_repair (ว่าง = บันทึกจากหน้าเจ้าหนี้)
    source_ref    VARCHAR(100),           -- เลขอ้างอิงในระบบต้นทาง
    description   VARCHAR(500) NOT NULL,
    invoice_no    VARCHAR(100),
    invoice_date  DATE NOT NULL,
    due_date      DATE,
    amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    cancelled_at  TIMESTAMPTZ,
    cancelled_by  INT,
    cancel_reason TEXT,
    created_by    INT,
    updated_by    INT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fin_payables_vendor ON fin_payables(vendor_id);
CREATE INDEX IF NOT EXISTS idx_fin_payables_contract ON fin_payables(contract_id);
-- กันบันทึกใบแจ้งหนี้ใบเดิมซ้ำ ซึ่งจะทำให้ยอดค้างจ่ายเกินจริง
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_payables_invoice ON fin_payables(vendor_id, invoice_no) WHERE invoice_no IS NOT NULL AND cancelled_at IS NULL;

-- จ่ายได้หลายงวดต่อใบ · จ่ายผิดให้ยกเลิก (voided) ไม่ลบแถว
CREATE TABLE IF NOT EXISTS fin_payable_payments (
    id          SERIAL PRIMARY KEY,
    payable_id  INT NOT NULL REFERENCES fin_payables(id),
    paid_date   DATE NOT NULL,
    amount      NUMERIC(14,2) NOT NULL CHECK (amount > 0),
    voucher_no  VARCHAR(100) NOT NULL,
    note        TEXT,
    paid_by     INT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    voided_at   TIMESTAMPTZ,
    voided_by   INT,
    void_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_fin_payable_payments_p ON fin_payable_payments(payable_id);

-- ยอดรายผู้รับจ้าง ใช้ได้ทั้งหน้าจอนี้และระบบอื่น ไม่ต้องเขียนสูตรซ้ำ
CREATE OR REPLACE VIEW fin_vendor_balances AS
SELECT p.vendor_id,
       count(*)::int AS payable_count,
       sum(p.amount) AS payable_total,
       sum(COALESCE(x.paid, 0)) AS paid_total,
       sum(p.amount - COALESCE(x.paid, 0)) AS outstanding,
       COALESCE(sum(p.amount - COALESCE(x.paid, 0)) FILTER (WHERE p.due_date < (NOW() AT TIME ZONE 'Asia/Bangkok')::date), 0) AS overdue_amount
FROM fin_payables p
LEFT JOIN LATERAL (SELECT sum(y.amount) AS paid FROM fin_payable_payments y WHERE y.payable_id = p.id AND y.voided_at IS NULL) x ON TRUE
WHERE p.cancelled_at IS NULL
GROUP BY p.vendor_id;

-- ─── ctr_ : ใช้ร่วมกันทุกหน่วย ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ctr_tasks (
    id          SERIAL PRIMARY KEY,
    contract_id INT NOT NULL REFERENCES proc_contracts(id),
    code        VARCHAR(30) NOT NULL,
    round       INT NOT NULL DEFAULT 0,  -- รอบตรวจตามสัญญา งานอื่นเป็น 0
    title       VARCHAR(200) NOT NULL,
    duty        VARCHAR(20) NOT NULL CHECK (duty IN ('procurement', 'finance', 'committee', 'custodian', 'approver')),
    due_date    DATE NOT NULL,
    status      VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'cancelled')),
    done_by     INT,
    done_at     TIMESTAMPTZ,
    UNIQUE (contract_id, code, round)
);
CREATE INDEX IF NOT EXISTS idx_ctr_tasks_due ON ctr_tasks(status, due_date);

-- ค่าเริ่มต้นและกฎทุกตัวอยู่ที่นี่ ไม่ฝังในโปรแกรม — แก้ได้ที่หน้าตั้งค่า /general/contracts/settings
CREATE TABLE IF NOT EXISTS ctr_rules (
    key            VARCHAR(40) PRIMARY KEY,
    label          VARCHAR(200) NOT NULL,
    value          INT NOT NULL,
    unit           VARCHAR(20),
    ref_doc        VARCHAR(200),         -- เลขหนังสือเวียน/ระเบียบที่อ้างอิง
    is_proposal    BOOLEAN NOT NULL DEFAULT FALSE, -- TRUE = ค่าที่เสนอ ไม่ใช่ข้อกำหนดตามระเบียบ
    sort           INT NOT NULL DEFAULT 0,
    updated_by     INT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ctr_rules (key, label, value, unit, ref_doc, is_proposal, sort) VALUES
    ('default_warranty_months','ระยะประกันเริ่มต้นของสัญญาใหม่',             12, 'เดือน', NULL, TRUE, 5),
    ('return_days',            'กำหนดคืนหลักประกันนับจากวันพ้นภาระ',        15, 'วัน',  'ว117 / ระเบียบฯ ข้อ 170 วรรคหนึ่ง (2) (อ้างตามบทความสรุป)', FALSE, 10),
    ('warranty_short_months',  'ประกันไม่เกินกี่เดือนถือเป็นประกันระยะสั้น',    6, 'เดือน', 'ว117 / ว327 (อ้างตามบทความสรุป)', FALSE, 20),
    ('final_short_days',       'ตรวจรอบสุดท้ายก่อนหมดประกัน (ระยะสั้น)',     15, 'วัน',  'ว117 / ว327 (อ้างตามบทความสรุป)', FALSE, 30),
    ('final_long_days',        'ตรวจรอบสุดท้ายก่อนหมดประกัน (เกินระยะสั้น)', 30, 'วัน',  'ว117 / ว327 (อ้างตามบทความสรุป)', FALSE, 40),
    ('schedule_lead_days',     'นัดกรรมการล่วงหน้าก่อนหมดประกัน',           45, 'วัน',  NULL, TRUE, 50),
    ('approve_after_t_days',   'ควรอนุมัติคืนภายในกี่วันหลังหมดประกัน',       6, 'วัน',  NULL, TRUE, 60),
    ('near_due_days',          'เตือนสีเหลืองเมื่อเหลือไม่เกิน',              14, 'วัน',  NULL, TRUE, 70),
    ('guarantee_margin_days',  'เตือนหนังสือค้ำประกันหมดอายุก่อน T + กี่วัน', 30, 'วัน',  NULL, TRUE, 80),
    ('block_same_approver',    'ห้ามผู้เสนอ/ผู้ตรวจรอบสุดท้ายเป็นผู้อนุมัติ (1 = ห้าม)', 1, NULL, 'หลักควบคุมภายใน', TRUE, 90),
    ('proc_major_id',          'รหัสกลุ่มงานพัสดุ (majors.major_id)',          2, NULL, NULL, FALSE, 100),
    ('fin_major_id',           'รหัสกลุ่มงานการเงิน (majors.major_id)',        4, NULL, NULL, FALSE, 110)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS ctr_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    actor_id    INT NOT NULL,
    action      VARCHAR(40) NOT NULL,
    entity      VARCHAR(40) NOT NULL,
    entity_id   INT,
    contract_id INT,
    before_data JSONB,
    after_data  JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ctr_audit_log_c ON ctr_audit_log(contract_id, created_at DESC);

-- ทะเบียนโมดูล — ให้ผู้ดูแลระบบปิดการมองเห็นได้ที่ /account/modules
INSERT INTO app_modules (module_key, label, group_label, route_prefix, sort, note) VALUES
    ('general.contracts', 'สัญญาและหลักประกัน', 'งานบริหารงานทั่วไป', '/general/contracts', 85, 'ทะเบียนสัญญา หลักประกัน ตรวจรอบสุดท้าย อนุมัติคืน')
ON CONFLICT (module_key) DO NOTHING;
