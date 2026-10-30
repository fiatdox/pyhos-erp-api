-- ── ขอยกเลิกใบลาที่อนุมัติแล้วได้หลายรอบ + บันทึกวันลาที่คืน ─────────────────
--
-- เดิม UNIQUE (request_id) = ใบลาหนึ่งใบมีคำขอยกเลิกได้ครั้งเดียว ถ้าผู้บังคับบัญชา
-- ไม่อนุมัติการยกเลิกไปแล้ว ผู้ลาขอยกเลิกใหม่ไม่ได้อีกเลย (วันลาที่ตัดไปคืนไม่ได้)
-- เปลี่ยนเป็น: เก็บทุกรอบไว้เป็นประวัติ แต่ "รออนุมัติ" ได้ทีละรอบเท่านั้น
--
-- refunded_days = จำนวนวันที่คืนเข้ายอดวันลาเมื่ออนุมัติการยกเลิกครบทุกขั้น
--
-- ปลอดภัยกับข้อมูลเดิม รันซ้ำได้

ALTER TABLE core_kon.hr_leave_cancellations
    DROP CONSTRAINT IF EXISTS hr_leave_cancellations_request_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_cancellations_pending
    ON core_kon.hr_leave_cancellations (request_id) WHERE status = 'PENDING';

ALTER TABLE core_kon.hr_leave_cancellations
    ADD COLUMN IF NOT EXISTS refunded_days numeric(5,1);
