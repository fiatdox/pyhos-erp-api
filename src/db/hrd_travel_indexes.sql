-- ══════════════════════════════════════════════════════════════════════════════
-- ดัชนีเพิ่มเติมของระบบขออนุมัติเดินทางไปราชการ — รองรับข้อมูลสะสมหลายปี
--
-- ปัญหา: "รอฉันอนุมัติ" / ตัวเลขบนปุ่ม / แท็บรออนุมัติ ต้องหาคำขอที่ผู้ใช้อยู่ในสายอนุมัติ (approval_chain JSONB)
--        เดิมต้องแตก JSON ทุกแถวทั้งตาราง (seq scan) — ช้าลงตามจำนวนคำขอสะสม
-- แก้:   GIN jsonb_path_ops บน approval_chain + query ใช้ approval_chain @> '[{"approver_id": uid}]'
--        (เฉพาะโหมดลงนามในระบบ — โหมดเดินเอกสารเก็บสายไว้แค่พิมพ์ชื่อ ไม่ต้องค้น)
--
-- วัดบนข้อมูลจำลอง 60,000 คำขอ (≈ 120,000 ผู้เดินทาง, 129,000 การอนุมัติ):
--   ตัวเลขรออนุมัติ (badge)   336 ms → 0.06 ms
--   แท็บรออนุมัติ หน้า 1       153 ms → 2.3 ms
--   คำขอของฉัน หน้า 1          22 ms → 0.7 ms
--
-- รันซ้ำได้ · ตารางยังเล็ก สร้างแบบปกติได้ (ถ้าตารางใหญ่แล้วให้รันทีละคำสั่งแบบ CREATE INDEX CONCURRENTLY นอก transaction)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_hrd_travel_requests_chain
    ON hrd_travel_requests USING gin (approval_chain jsonb_path_ops)
    WHERE sign_mode = 'esign';

-- pending (รอฉันอนุมัติ) ใช้ GIN ข้างบนแล้ว — ดัชนีขั้นอนุมัติเดิมไม่มี query ไหนใช้ ลดภาระตอนเขียน
DROP INDEX IF EXISTS idx_hrd_travel_requests_stage;

-- งานที่ต้องดำเนินการของ HRD (การ์ดหน้าแรก + ตัวกรอง ?task=) — คำขอที่ยังเปิดอยู่เท่านั้น (ยังไม่มียอดการเงินยืนยัน)
-- ส่วนใหญ่ของตารางเป็นคำขอที่ปิดแล้ว ดัชนีบางส่วนนี้จึงเล็กและไม่โตตามข้อมูลสะสม
CREATE INDEX IF NOT EXISTS idx_hrd_travel_requests_open
    ON hrd_travel_requests (approval_stage, start_at)
    WHERE status = 'submitted' AND actual_amount IS NULL;

ANALYZE hrd_travel_requests;
