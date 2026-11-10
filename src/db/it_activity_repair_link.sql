-- ============================================================
-- MODULE: IT Activity ← Repair — บันทึกกิจกรรม IT อัตโนมัติจากระบบแจ้งซ่อม
-- DESCRIPTION: เมื่อเจ้าหน้าที่ที่อยู่ในรายชื่อบันทึกกิจกรรม (it_activity_staff) กดรับงาน ประเมิน
--              อัพเดทความคืบหน้า ปิดงาน อนุมัติ หรือบันทึกใบ PR ในระบบแจ้งซ่อม ระบบจะเพิ่มกิจกรรม
--              ให้หนึ่งแถวต่อหนึ่งการกด (ดู src/services/repairActivityLog.ts)
-- PAGE: /information-technology/hait/activity (ป้าย "จากระบบแจ้งซ่อม" + ADMIN ผูกบัญชีผู้ใช้)
-- DATABASE: PostgreSQL / SCHEMA: core_kon — รันซ้ำได้
-- ============================================================

-- 1) ผูกเจ้าหน้าที่ในรายชื่อกิจกรรมกับบัญชีผู้ใช้ (หนึ่งบัญชีต่อหนึ่งคน)
ALTER TABLE core_kon.it_activity_staff
  ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES core_kon.users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_it_activity_staff_user
  ON core_kon.it_activity_staff (user_id) WHERE user_id IS NOT NULL;
COMMENT ON COLUMN core_kon.it_activity_staff.user_id IS 'ref → users.id ใช้หาว่าผู้กดปุ่มในระบบแจ้งซ่อมคือเจ้าหน้าที่คนไหน (ADMIN ผูกได้ที่หน้าบันทึกกิจกรรม)';

-- 2) ที่มาของแถวที่ระบบสร้าง — ห้ามซ้ำ กันบันทึกซ้ำและแยกจากแถวที่คนพิมพ์เอง
--    รูปแบบ: repair_track:<it_repair_request_track_id> (หนึ่งการกดในระบบแจ้งซ่อม = หนึ่ง track)
ALTER TABLE core_kon.it_activity_logs
  ADD COLUMN IF NOT EXISTS auto_ref VARCHAR(80);
CREATE UNIQUE INDEX IF NOT EXISTS uq_it_activity_logs_auto_ref
  ON core_kon.it_activity_logs (auto_ref) WHERE auto_ref IS NOT NULL;
COMMENT ON COLUMN core_kon.it_activity_logs.auto_ref IS 'ระบบสร้างให้อัตโนมัติ เช่น repair_track:123 · NULL = เจ้าหน้าที่บันทึกเอง';

-- 3) แหล่งที่มาใหม่ "ระบบแจ้งซ่อม"
INSERT INTO core_kon.it_activity_request_sources (source_code, source_name_th, is_planned, sort_order)
SELECT 'repair_system', 'ระบบแจ้งซ่อม', false, COALESCE(MAX(sort_order), 0) + 1
FROM core_kon.it_activity_request_sources
ON CONFLICT (source_code) DO NOTHING;

-- 4) ผูกบัญชีให้เจ้าหน้าที่ที่ชื่อ-นามสกุลตรงกับผู้ใช้ "คนเดียว" (ตัดคำนำหน้าออกก่อนเทียบ)
--    ชื่อซ้ำหรือไม่พบ = ปล่อยว่างให้ ADMIN เลือกเอง
WITH cand AS (
  SELECT s.staff_id, u.id AS user_id, COUNT(*) OVER (PARTITION BY s.staff_id) AS n
  FROM core_kon.it_activity_staff s
  JOIN core_kon.users u
    ON trim(concat(u.fname, ' ', u.lname)) = trim(regexp_replace(s.full_name_th, '^(นาย|นางสาว|นาง|น\.ส\.)\s*', ''))
  WHERE s.user_id IS NULL
)
UPDATE core_kon.it_activity_staff s
SET user_id = c.user_id
FROM cand c
WHERE c.staff_id = s.staff_id AND c.n = 1
  AND NOT EXISTS (SELECT 1 FROM core_kon.it_activity_staff x WHERE x.user_id = c.user_id);

-- 5) view ที่หน้ารายการใช้ — เพิ่ม auto_ref ต่อท้าย (CREATE OR REPLACE เพิ่มคอลัมน์ได้เฉพาะท้ายสุด)
CREATE OR REPLACE VIEW core_kon.it_activity_log_summary AS
 SELECT l.log_id,
    l.log_date,
    to_char(l.log_date::timestamp with time zone, 'DD/MM/YYYY'::text) AS log_date_th,
    s.staff_id,
    s.full_name_th AS staff_name,
    s.role_th AS staff_role,
    t.type_id,
    t.type_code,
    t.type_name_th,
    t.nature AS activity_nature,
    sys.system_id,
    sys.system_code,
    sys.system_name_th AS system_name,
    st.status_code,
    st.status_name_th AS status_name,
    st.color_hex AS status_color,
    st.is_closed,
    l.start_time,
    l.end_time,
    (to_char(l.start_time::interval, 'HH24:MI'::text) || ' – '::text) || to_char(l.end_time::interval, 'HH24:MI'::text) AS time_slot,
    l.duration_hours,
    l.minutes_used,
    l.hours_used,
    l.detail,
    l.outcome,
    l.priority_code,
    p.priority_name_th AS priority_name,
    p.color_hex AS priority_color,
    l.source_code,
    rs.source_name_th AS source_name,
    rs.is_planned AS source_is_planned,
    l.location,
    l.asset_code,
    l.affected_users,
    l.is_overtime,
    l.ticket_id,
    l.created_at,
    l.updated_at,
    l.auto_ref
   FROM core_kon.it_activity_logs l
     JOIN core_kon.it_activity_staff s ON s.staff_id = l.staff_id
     JOIN core_kon.it_activity_types t ON t.type_id = l.type_id
     JOIN core_kon.it_activity_systems sys ON sys.system_id = l.system_id
     JOIN core_kon.it_activity_statuses st ON st.status_code::text = l.status_code::text
     JOIN core_kon.it_activity_priorities p ON p.priority_code::text = l.priority_code::text
     JOIN core_kon.it_activity_request_sources rs ON rs.source_code::text = l.source_code::text;
