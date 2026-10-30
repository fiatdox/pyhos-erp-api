-- โอนประวัติการลาจากโปรแกรมเดิม (MySQL: tb_leave / tb_employee / tb_leave_setday) — รันใน schema core_kon (รันซ้ำได้)
--   hr_leave_requests.legacy_leave_id = tb_leave.leave_id (กันโอนซ้ำ + ตามกลับไปดูใบเดิมได้)
--   hr_leave_balances.legacy_setday   = tb_leave_setday.setday ที่ใช้ตั้งสิทธิ์ลาพักผ่อนของปีนั้น (NULL = ยังไม่ได้ตั้งจากระบบเดิม)
-- สคริปต์โอน: bun src/scripts/importLegacyLeave.ts --help

ALTER TABLE hr_leave_requests ADD COLUMN IF NOT EXISTS legacy_leave_id INT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_leave_requests_legacy_leave_id
    ON hr_leave_requests (legacy_leave_id) WHERE legacy_leave_id IS NOT NULL;
COMMENT ON COLUMN hr_leave_requests.legacy_leave_id IS 'tb_leave.leave_id ของโปรแกรมเดิม — NULL = ยื่นในระบบใหม่';

ALTER TABLE hr_leave_balances ADD COLUMN IF NOT EXISTS legacy_setday NUMERIC(6,1);
COMMENT ON COLUMN hr_leave_balances.legacy_setday IS 'สิทธิ์ทั้งปี (ยกมา + ปีนี้) จาก tb_leave_setday ที่ใช้ตั้งยอดตอนโอน — NULL = ไม่ได้ตั้งจากระบบเดิม';
