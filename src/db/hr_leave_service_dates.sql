-- ── วันเริ่มรับราชการ/ทำงาน สำหรับคิดอายุงานในสิทธิ์การลา ───────────────────
--
-- สิทธิ์ลาพักผ่อนข้าราชการขึ้นกับอายุงาน: รับราชการ ≥ 10 ปี สะสมได้ 20 วัน (รวมปีนี้ 30)
-- ไม่ถึง 10 ปี สะสมได้ 10 วัน (รวม 20) · บรรจุไม่ถึง 6 เดือน ไม่มีสิทธิ์ลาพักผ่อน
-- แต่ users.hire_date ในทะเบียนกรอกไว้น้อยมาก (ข้าราชการ 106 จาก 663 คน)
-- จึงเก็บวันบรรจุ (tb_employee.appoint_date) จากโปรแกรมการลาเดิมไว้ที่นี่เพื่อเติมส่วนที่ขาด
--
-- อายุงานที่ระบบลาใช้ = v_leave_service_start.service_start
--   = users.hire_date (ทะเบียนบุคลากร — HR แก้ได้ที่หน้าผู้ใช้) ถ้ามี ไม่งั้นใช้วันบรรจุจากโปรแกรมเดิม
--
-- รันซ้ำได้

CREATE TABLE IF NOT EXISTS core_kon.hr_leave_service_dates (
    user_id            integer PRIMARY KEY REFERENCES core_kon.users(id),
    service_start_date date NOT NULL,
    source             varchar(20) NOT NULL DEFAULT 'LEGACY',   -- LEGACY = tb_employee.appoint_date
    legacy_employee_id integer,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE VIEW core_kon.v_leave_service_start AS
SELECT u.id AS user_id,
       COALESCE(u.hire_date, d.service_start_date) AS service_start,
       CASE WHEN u.hire_date IS NOT NULL THEN 'HIRE_DATE'
            WHEN d.service_start_date IS NOT NULL THEN d.source END AS source
FROM core_kon.users u
LEFT JOIN core_kon.hr_leave_service_dates d ON d.user_id = u.id;
