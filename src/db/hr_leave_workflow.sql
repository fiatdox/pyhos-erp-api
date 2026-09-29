-- ── สายอนุมัติการลา: เก็บสายอนุมัติและบอกได้ว่าอนุมัติในฐานะหัวหน้าอะไร ─────────
--
-- ปัญหาที่แก้
-- 1) หัวหน้าหนึ่งคนถือหมวกหลายใบได้ (เป็นทั้งหัวหน้ากลุ่มงานและรักษาการหัวหน้าภารกิจ)
--    ถ้าบันทึกแค่ approver_id จะตรวจย้อนหลังไม่ได้ว่าอนุมัติในฐานะหมวกใบไหน
-- 2) สายอนุมัติต้อง "แช่แข็ง" ตั้งแต่วันยื่น ไม่งั้นพอเปลี่ยนตัวหัวหน้าระหว่างทาง
--    ใบลาที่ค้างอยู่จะเปลี่ยนผู้อนุมัติตามไปด้วย ตรวจสอบย้อนหลังไม่ได้
--
-- ปลอดภัยกับข้อมูลเดิม: เพิ่มคอลัมน์ที่ยอมให้เป็น NULL และมีค่าตั้งต้น รันซ้ำได้

ALTER TABLE core_kon.hr_leave_requests
    -- สายอนุมัติ ณ วันที่ยื่น: [{ step, level, approver_id, approver_name, unit_type, unit_id, unit_name, is_acting, skipped, skip_reason }]
    ADD COLUMN IF NOT EXISTS approval_chain jsonb,
    -- ขั้นที่รออนุมัติอยู่ (1-based) เกินจำนวนขั้น = ผ่านครบแล้ว
    ADD COLUMN IF NOT EXISTS current_step smallint NOT NULL DEFAULT 1;

ALTER TABLE core_kon.hr_leave_approvals
    -- ระดับที่อนุมัติ: SUBMAJOR | MAJOR | MISSION | DIRECTOR
    ADD COLUMN IF NOT EXISTS level varchar(10),
    -- หน่วยที่ใช้อำนาจอนุมัติ (DIRECTOR ไม่มีหน่วย)
    ADD COLUMN IF NOT EXISTS unit_type varchar(10),
    ADD COLUMN IF NOT EXISTS unit_id integer;

-- ดึง "ใบลาที่รอฉันอนุมัติ" ต้องค้นด้วย current_step คู่กับ approval_chain บ่อยมาก
CREATE INDEX IF NOT EXISTS idx_leave_req_status_step
    ON core_kon.hr_leave_requests (status, current_step);

CREATE INDEX IF NOT EXISTS idx_leave_req_user_created
    ON core_kon.hr_leave_requests (user_id, created_at DESC);

-- ── แก้ความยาวคอลัมน์สถานะ ───────────────────────────────────────────────────
-- hr_leave_requests.status เป็น varchar(10) แต่ CHECK ของตัวเองอนุญาต 'CANCEL_PENDING'
-- ซึ่งยาว 14 ตัวอักษร = ค่านั้นบันทึกลงไปไม่ได้เลย (ขัดกันเองมาตั้งแต่ต้น)
ALTER TABLE core_kon.hr_leave_requests
    ALTER COLUMN status TYPE varchar(20);

ALTER TABLE core_kon.hr_leave_cancellations
    ALTER COLUMN status TYPE varchar(20),
    ALTER COLUMN status_before TYPE varchar(20);
