-- ยกยอดวันลาพักผ่อนอัตโนมัติเมื่อข้ามปีงบประมาณ — รันใน schema core_kon (รันซ้ำได้)
--   carried_from_fy = ยกยอดมาจากปีงบไหนแล้ว (NULL = ยังไม่ได้ยกยอดเข้าแถวนี้)
--   auto_created    = แถวที่ระบบสร้างเองตอนบันทึกใบลา (ยังไม่มีแถวของปีนั้น) — งานยกยอดเติมยอดยกมาให้ได้
--                     แถวที่ HR สร้าง/แก้เองไม่ถูกงานอัตโนมัติแตะ
--   hr_settings.leave_rollover_fy = ปีงบล่าสุดที่ยกยอดอัตโนมัติแล้ว (ครั้งแรกตั้งเป็นปีปัจจุบันโดยไม่ยกยอด)

ALTER TABLE hr_leave_balances
    ADD COLUMN IF NOT EXISTS carried_from_fy INT,
    ADD COLUMN IF NOT EXISTS auto_created BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN hr_leave_balances.carried_from_fy IS 'ยกยอดมาจากปีงบประมาณ (พ.ศ.) — NULL = ยังไม่ได้ยกยอด';
COMMENT ON COLUMN hr_leave_balances.auto_created IS 'TRUE = ระบบสร้างเองตอนบันทึกใบลา งานยกยอดอัตโนมัติเติมยอดยกมาได้';

UPDATE hr_leave_balances SET auto_created = TRUE
WHERE NOT auto_created AND note IN ('สร้างอัตโนมัติจากการบันทึกใบลา', 'สร้างอัตโนมัติจากการอนุมัติใบลา');
UPDATE hr_leave_balances SET carried_from_fy = fiscal_year - 1
WHERE carried_from_fy IS NULL AND note LIKE 'ยกยอดอัตโนมัติจากปีงบประมาณ %';

INSERT INTO hr_settings (name, description, value)
VALUES ('leave_rollover_fy', 'ปีงบประมาณล่าสุดที่ยกยอดวันลาพักผ่อนอัตโนมัติแล้ว (พ.ศ.)', NULL)
ON CONFLICT (name) DO NOTHING;
