-- ══════════════════════════════════════════════════════════════════════════════
-- ประชาสัมพันธ์งานทรัพยากรบุคคล + เอกสารระเบียบการลา (หน้า /hr/leave)
-- ผู้ใช้ทุกคนอ่านได้เฉพาะที่เผยแพร่ ส่วน ADMIN / HR เพิ่ม แก้ไข ซ่อน ลบได้
--
-- kind  : news = ข่าวประชาสัมพันธ์, document = เอกสาร/ระเบียบ (แสดงแยกตาม category)
--         popup = ป๊อปอัปรูปภาพ เด้งเมื่อเข้าหน้าแรก / หน้างาน HR ในช่วง show_from–show_until
-- ไฟล์แนบเก็บที่ uploads/hr-posts/<file_name> (ชื่อสุ่ม) original_name คือชื่อเดิมตอนอัปโหลด
-- ลบแบบ soft delete (is_active = false) ไฟล์ยังอยู่บนดิสก์
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS hr_posts (
    id             SERIAL PRIMARY KEY,
    kind           VARCHAR(20)  NOT NULL CHECK (kind IN ('news', 'document', 'popup')),
    title          VARCHAR(300) NOT NULL,
    body           TEXT,
    category       VARCHAR(100),
    link_url       VARCHAR(500),
    file_name      VARCHAR(100),
    original_name  VARCHAR(255),
    file_size      INT,
    show_from      DATE,
    show_until     DATE,
    is_pinned      BOOLEAN      NOT NULL DEFAULT FALSE,
    is_published   BOOLEAN      NOT NULL DEFAULT TRUE,
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_by     INT,
    updated_by     INT,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hr_posts_list ON hr_posts(kind, is_active, is_published);

-- ── ถ้าเคยรันไฟล์รุ่นแรก (ยังไม่มี popup) ไปแล้ว — ส่วนนี้รันซ้ำได้ ไม่กระทบข้อมูลเดิม ──
ALTER TABLE hr_posts ADD COLUMN IF NOT EXISTS show_from  DATE;
ALTER TABLE hr_posts ADD COLUMN IF NOT EXISTS show_until DATE;
ALTER TABLE hr_posts DROP CONSTRAINT IF EXISTS hr_posts_kind_check;
ALTER TABLE hr_posts ADD CONSTRAINT hr_posts_kind_check CHECK (kind IN ('news', 'document', 'popup'));
