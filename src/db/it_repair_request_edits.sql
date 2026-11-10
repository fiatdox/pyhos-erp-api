-- ══════════════════════════════════════════════════════════════════════════════
-- ประวัติการแก้ไขข้อมูลใบส่งซ่อม IT (ช่าง/งาน IT แก้ชื่อครุภัณฑ์ ยี่ห้อ เลขครุภัณฑ์ ฯลฯ ที่ผู้แจ้งกรอกผิด)
-- เก็บค่าก่อน/หลังของทุกช่องที่เปลี่ยน — ตรวจย้อนหลังได้ว่าใครแก้อะไรเมื่อไร
-- changes = { "brand": { "from": "DEL", "to": "Dell" }, ... }
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS it_repair_request_edits (
    id                    BIGSERIAL PRIMARY KEY,
    it_repair_request_id  INTEGER     NOT NULL REFERENCES it_repair_requests (it_repair_request_id) ON DELETE CASCADE,
    changes               JSONB       NOT NULL,
    edited_by             INTEGER     NOT NULL,
    edited_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_it_repair_request_edits_request
    ON it_repair_request_edits (it_repair_request_id, edited_at DESC);
