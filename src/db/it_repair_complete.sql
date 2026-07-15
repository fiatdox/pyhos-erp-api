-- ============================================================
-- MODULE: IT Repair Complete — บันทึกปิดงานซ่อม (รับอะไหล่ / เสร็จสิ้น)
-- DESCRIPTION: เมื่อเจ้าหน้าที่กด"รับอะไหล่ / เสร็จสิ้น" ที่คอลัมน์ "รอรับของ / รับอะไหล่"
--              (process_status_id = 8) จะบันทึกเวลาที่ซ่อมเสร็จจริง + หมายเหตุ แล้วเลื่อน
--              คำร้องไป process_status_id = 5 (ซ่อมเสร็จแล้ว)
-- PAGE: /information-technology/maintenance/manage (modal "บันทึกปิดงานซ่อม")
-- DATABASE: PostgreSQL / SCHEMA: core_kon
-- ============================================================

-- เวลาที่ซ่อมเสร็จจริง (เจ้าหน้าที่กรอกในโมดัลปิดงาน)
ALTER TABLE core_kon.it_repair_requests
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;
-- ผู้บันทึกปิดงาน (ref → users.id)
ALTER TABLE core_kon.it_repair_requests
  ADD COLUMN IF NOT EXISTS completed_by INTEGER;
-- หมายเหตุปิดงาน / สรุปการรับอะไหล่
ALTER TABLE core_kon.it_repair_requests
  ADD COLUMN IF NOT EXISTS completion_note TEXT;

COMMENT ON COLUMN core_kon.it_repair_requests.completed_at    IS 'วันเวลาที่ซ่อมเสร็จจริง (กรอกตอนปิดงานจากสถานะ 8 → 5)';
COMMENT ON COLUMN core_kon.it_repair_requests.completed_by    IS 'ref → users.id ของผู้บันทึกปิดงาน';
COMMENT ON COLUMN core_kon.it_repair_requests.completion_note IS 'หมายเหตุปิดงาน / สรุปการรับอะไหล่และซ่อมเสร็จ';

-- ============================================================
-- flow: status 8 (รอรับของ/รับอะไหล่) --[POST /repair-requests/:id/complete]--> status 5 (ซ่อมเสร็จแล้ว)
--   * set completed_at, completed_by, completion_note, process_status_id = 5
--   * เพิ่ม it_repair_requests_track (process_status_id = 5)
-- ============================================================
