-- การคิดวันลา — รันใน schema core_kon (รันซ้ำได้)
--   1) ประเภทการลานับ "วันทำการ" (ไม่นับเสาร์-อาทิตย์และวันหยุดราชการใน hr_holidays) หรือ "วันปฏิทิน"
--      ตามระเบียบการลาของข้าราชการ: ลาป่วย ลากิจ ลาพักผ่อน ลาช่วยภริยาคลอด นับวันทำการ
--      ลาคลอด อุปสมบท/ฮัจย์ ตรวจเลือก ศึกษา ฯลฯ นับวันปฏิทินต่อเนื่อง
--   2) ตัดยอดวันลาทันทีเมื่อบันทึกใบลา — days_deducted = จำนวนวันที่หักจาก hr_leave_balances ไปแล้ว
--      (0 = ใบเก่าที่ยังไม่ได้หัก จะหักตอนอนุมัติขั้นสุดท้ายเหมือนเดิม)
--   3) งาน HR ตรวจจำนวนวันของใบลาที่คร่อมวันหยุด (day_check_*)

ALTER TABLE hr_leave_types
    ADD COLUMN IF NOT EXISTS count_working_days_only BOOLEAN NOT NULL DEFAULT TRUE;
COMMENT ON COLUMN hr_leave_types.count_working_days_only IS 'TRUE = นับเฉพาะวันทำการ (ไม่นับเสาร์-อาทิตย์/วันหยุดราชการ) · FALSE = นับวันปฏิทิน';
UPDATE hr_leave_types SET count_working_days_only = FALSE
WHERE code IN ('MAT', 'ORDAIN', 'MIL', 'STUDY', 'INTL', 'FOLLOW', 'REHAB');

ALTER TABLE hr_leave_requests
    ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS days_deducted NUMERIC(6,1) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS day_check_status VARCHAR(20),
    ADD COLUMN IF NOT EXISTS day_check_note TEXT,
    ADD COLUMN IF NOT EXISTS day_checked_by INT REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS day_checked_at TIMESTAMPTZ;
COMMENT ON COLUMN hr_leave_requests.created_by IS 'ผู้ทำรายการ (HR / ADMIN เมื่อยื่นแทน) — NULL = ใบเก่าก่อนมีคอลัมน์นี้';
COMMENT ON COLUMN hr_leave_requests.days_deducted IS 'จำนวนวันที่หักจาก hr_leave_balances ไปแล้วสำหรับใบนี้ (คืนเมื่อไม่อนุมัติ/ถอน/ลบ/ยกเลิกสำเร็จ)';
COMMENT ON COLUMN hr_leave_requests.day_check_status IS 'NULL = ยังไม่ตรวจ · VERIFIED = HR ยืนยันจำนวนวันแล้ว · ADJUSTED = HR แก้จำนวนวัน';

ALTER TABLE hr_leave_requests DROP CONSTRAINT IF EXISTS chk_hr_leave_day_check_status;
ALTER TABLE hr_leave_requests ADD CONSTRAINT chk_hr_leave_day_check_status
    CHECK (day_check_status IS NULL OR day_check_status IN ('VERIFIED', 'ADJUSTED'));
