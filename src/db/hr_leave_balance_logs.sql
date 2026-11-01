-- ============================================================
-- MODULE: HR Leave Balance Logs — ประวัติการแก้ไขยอดวันลาสะสม
-- DESCRIPTION: เก็บค่าก่อน/หลัง ทุกครั้งที่ HR/ADMIN เพิ่มหรือแก้ยอดใน hr_leave_balances
--              ผ่านหน้าวันลาสะสม (/hr/leave/balance) และหน้าตรวจแก้วันลาสะสม (/hr/leave/balance-audit)
--              การหัก/คืนยอดอัตโนมัติจากใบลาไม่บันทึกที่นี่ (ดูได้จากใบลาเอง)
-- DATABASE: PostgreSQL / SCHEMA: core_kon — ปลอดภัยกับข้อมูลเดิม รันซ้ำได้
-- ============================================================

CREATE TABLE IF NOT EXISTS core_kon.hr_leave_balance_logs (
  id          SERIAL PRIMARY KEY,
  balance_id  INTEGER     NOT NULL REFERENCES core_kon.hr_leave_balances(id) ON DELETE CASCADE,
  action      VARCHAR(10) NOT NULL,          -- CREATE / UPDATE
  before      JSONB,                         -- { carried_in, entitled, used, remaining, note } (CREATE = NULL)
  after       JSONB       NOT NULL,
  reason      VARCHAR(255),                  -- เหตุผลที่แก้ (บังคับกรอกเมื่อแก้ยอด)
  actor_id    INTEGER,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_leave_balance_logs_balance
  ON core_kon.hr_leave_balance_logs (balance_id, created_at DESC);

COMMENT ON TABLE core_kon.hr_leave_balance_logs IS 'ประวัติการเพิ่ม/แก้ยอดวันลาสะสมโดย HR/ADMIN — ค่าก่อนและหลังแก้ พร้อมเหตุผล';
