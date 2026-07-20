-- ============================================================
-- MODULE: HR Leave Balances — วันลาสะสม (ลาพักผ่อนสะสมตามระเบียบราชการ)
-- DESCRIPTION: เก็บยอดวันลาสะสมต่อ (บุคลากร × ประเภทการลา × ปีงบประมาณ)
--              ใช้ 2 กรณี:
--                1) ข้าราชการย้ายมา — HR กรอกยอดสะสมยกมาด้วยตนเอง
--                2) ขึ้นปีงบประมาณใหม่ — ระบบยกยอดคงเหลือของปีก่อนมาใส่อัตโนมัติ
--              ปีงบประมาณราชการไทย: 1 ต.ค. - 30 ก.ย. เรียกชื่อปีตาม พ.ศ. ที่ปีงบสิ้นสุด
-- PAGE: /hr/leave/balance
-- DATABASE: PostgreSQL / SCHEMA: core_kon
-- ============================================================

CREATE TABLE IF NOT EXISTS core_kon.hr_leave_balances (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER  NOT NULL REFERENCES core_kon.users(id),
  leave_type_id  SMALLINT NOT NULL REFERENCES core_kon.hr_leave_types(id),
  fiscal_year    INTEGER  NOT NULL,
  carried_in     NUMERIC  NOT NULL DEFAULT 0,  -- วันสะสมยกมาจากปีก่อน/ยกมาตอนย้ายเข้า
  entitled       NUMERIC  NOT NULL DEFAULT 0,  -- สิทธิ์ปีนี้ (snapshot จาก hr_leave_entitlements ตอนสร้างแถว)
  used           NUMERIC  NOT NULL DEFAULT 0,  -- ใช้ไปแล้วในปีนี้ (HR ปรับปรุงเอง จนกว่าจะมีระบบตัดยอดอัตโนมัติจากใบลาที่อนุมัติ)
  remaining      NUMERIC  GENERATED ALWAYS AS (carried_in + entitled - used) STORED,
  note           VARCHAR(255),
  created_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by     INTEGER,
  updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by     INTEGER,
  UNIQUE (user_id, leave_type_id, fiscal_year)
);

CREATE INDEX IF NOT EXISTS idx_hr_leave_balances_lookup
  ON core_kon.hr_leave_balances (fiscal_year, leave_type_id, user_id);

COMMENT ON TABLE  core_kon.hr_leave_balances            IS 'วันลาสะสมต่อบุคลากร/ประเภทการลา/ปีงบประมาณ — รองรับกรอกยอดยกมาตอนย้ายเข้า และยกยอดอัตโนมัติข้ามปีงบ';
COMMENT ON COLUMN core_kon.hr_leave_balances.fiscal_year IS 'ปีงบประมาณราชการไทย (พ.ศ. ของปีที่ปีงบสิ้นสุด, 1 ต.ค. - 30 ก.ย.)';
COMMENT ON COLUMN core_kon.hr_leave_balances.carried_in  IS 'วันสะสมยกมา (จากปีก่อน หรือยกมาตอนย้ายเข้าหน่วยงาน)';
COMMENT ON COLUMN core_kon.hr_leave_balances.entitled    IS 'สิทธิ์วันลาปีนี้ — snapshot จาก hr_leave_entitlements ตอนสร้างแถว (กันย้อนหลังถ้ามีการแก้ระเบียบภายหลัง)';
COMMENT ON COLUMN core_kon.hr_leave_balances.used        IS 'จำนวนวันที่ใช้ไปแล้วในปีงบนี้ — ปรับปรุงโดย HR (ระบบยังไม่ตัดยอดอัตโนมัติจากใบลาที่อนุมัติ)';
COMMENT ON COLUMN core_kon.hr_leave_balances.remaining   IS 'คงเหลือ = carried_in + entitled - used (คำนวณอัตโนมัติ)';

-- ============================================================
-- การใช้งาน:
--   ย้ายมา/สร้างครั้งแรก → INSERT แถวใหม่ต่อปีงบ พร้อม carried_in ตามที่ HR แจ้ง
--   ขึ้นปีงบใหม่          → คำนวณ remaining ของปีก่อน (cap ตาม carry_over_max_days
--                           ของ entitlement ที่ตรงกับ user_type + อายุงาน) แล้ว INSERT
--                           แถวปีใหม่ carried_in = ค่าที่ cap แล้ว, entitled = สิทธิ์ปีใหม่, used = 0
-- ============================================================
