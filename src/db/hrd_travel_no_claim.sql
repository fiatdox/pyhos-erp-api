-- ══════════════════════════════════════════════════════════════════════════════
-- คำขอไปราชการแบบ "ไม่เบิกค่าใช้จ่าย" เลือกหลายวันในเดือนเดียว (เช่น พยาบาลชุมชนออกหน่วย วันที่ ๑ ๕ ๖ ๑๐)
--   cost_mode       claim = เบิกค่าใช้จ่าย (เดิม) · no_claim = ไม่เบิก (ยอดเงินทุกช่อง = 0 ไม่ผูกงบ)
--   trip_dates      วันที่ไปของคำขอ no_claim (เรียงจากน้อยไปมาก เดือนเดียวกัน) · start_at/end_at = วันแรก+เวลาเริ่ม / วันสุดท้าย+เวลาเลิก
--   vehicle_request ขออนุมัติใช้รถราชการ → ต้องแนบหนังสือขออนุมัติใช้รถ (ไฟล์ประเภท vehicle_use)
-- รันต่อจาก hrd_travel_files.sql · รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE hrd_travel_requests
    ADD COLUMN IF NOT EXISTS cost_mode       VARCHAR(10) NOT NULL DEFAULT 'claim',
    ADD COLUMN IF NOT EXISTS trip_dates      DATE[],
    ADD COLUMN IF NOT EXISTS vehicle_request BOOLEAN NOT NULL DEFAULT FALSE;
-- ไม่เบิก = ไม่ผูกงบ
ALTER TABLE hrd_travel_requests ALTER COLUMN budget_id DROP NOT NULL, ALTER COLUMN budget_type DROP NOT NULL, ALTER COLUMN budget_name DROP NOT NULL;

ALTER TABLE hrd_travel_requests DROP CONSTRAINT IF EXISTS hrd_travel_requests_cost_mode_check;
ALTER TABLE hrd_travel_requests ADD CONSTRAINT hrd_travel_requests_cost_mode_check CHECK (
    (cost_mode = 'claim' AND budget_id IS NOT NULL AND trip_dates IS NULL)
    OR (cost_mode = 'no_claim' AND budget_id IS NULL AND total_amount = 0 AND cardinality(trip_dates) BETWEEN 1 AND 31));
COMMENT ON COLUMN hrd_travel_requests.cost_mode IS 'claim = เบิกค่าใช้จ่าย · no_claim = ไม่เบิกค่าใช้จ่าย (เลือกหลายวันในเดือนเดียว)';
COMMENT ON COLUMN hrd_travel_requests.trip_dates IS 'วันที่เดินทางของคำขอไม่เบิกค่าใช้จ่าย';
COMMENT ON COLUMN hrd_travel_requests.vehicle_request IS 'ขออนุมัติใช้รถราชการ (ต้องแนบหนังสือขออนุมัติใช้รถ)';

-- ไฟล์แนบประเภทใหม่: หนังสือขออนุมัติใช้รถ
ALTER TABLE hrd_travel_request_files DROP CONSTRAINT IF EXISTS hrd_travel_request_files_kind_check;
ALTER TABLE hrd_travel_request_files ADD CONSTRAINT hrd_travel_request_files_kind_check CHECK (kind IN ('source', 'plane', 'private_car', 'vehicle_use'));
