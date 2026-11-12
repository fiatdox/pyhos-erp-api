-- สถานะบุคลากร "กลับต้นสังกัด" (เช่น มาช่วยราชการแล้วกลับหน่วยงานเดิม)
-- ทะเบียนบุคลากร: สถานะที่ไม่ใช่ "ปฏิบัติงาน" ต้องระบุวันสิ้นสุด (work_end_date) และระงับบัญชี (is_active = 'N') — ฝั่งหน้าเว็บบังคับให้
-- ใช้รหัส 11 ตายตัว เพราะ HR Dashboard นับเป็น "ออกจากงาน" ด้วยรหัส (EXIT_STATUS_IDS ใน hrDashboardController.ts)
-- รันซ้ำได้
INSERT INTO user_statuses (user_status_id, name)
VALUES (11, 'กลับต้นสังกัด')
ON CONFLICT (user_status_id) DO NOTHING;

-- ให้ sequence ไม่ชนรหัสที่ใส่เอง
SELECT setval('user_statuses_user_status_id_seq', GREATEST((SELECT MAX(user_status_id) FROM user_statuses), 11));
