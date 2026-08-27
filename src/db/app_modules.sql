-- ══════════════════════════════════════════════════════════════════════════════
-- ทะเบียนโมดูล — สวิตช์เปิด/ปิดการมองเห็นแต่ละระบบ (ผู้ดูแลระบบคุมจากหน้าเว็บ)
--
-- ที่มา: บางระบบพัฒนาเสร็จแล้วแต่ยังไม่เปิดใช้จริง (เช่น การลา, ขอใช้รถ, ซ่อมบำรุง)
--        เดิมต้องคอมเมนต์เมนูทิ้งในโค้ดแล้ว deploy ใหม่ทุกครั้งที่จะเปิด/ปิด
--
-- route_prefix ใช้จับคู่แบบ "ทั้งเซกเมนต์": route == prefix หรือ route ขึ้นต้นด้วย prefix + '/'
--   ดังนั้น /general/maintenance-request จะไม่ถูกปิดตาม /general/maintenance
--   (คนละระบบกัน จึงต้องแยกแถวกัน)
--
-- ตั้งต้นเปิดทุกโมดูล ('Y') — ติดตั้งแล้วเมนูไม่เปลี่ยนจากเดิม
-- ให้ผู้ดูแลระบบไปปิดเองที่หน้า /account/modules ตามที่ต้องการ
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS app_modules (
    module_key   VARCHAR(64)  PRIMARY KEY,
    label        VARCHAR(200) NOT NULL,
    group_label  VARCHAR(200) NOT NULL,
    route_prefix VARCHAR(200) NOT NULL,
    enabled      CHAR(1)      NOT NULL DEFAULT 'Y',
    sort         INT          NOT NULL DEFAULT 0,
    note         TEXT,
    updated_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_by   VARCHAR(100)
);

COMMENT ON TABLE  app_modules IS 'ทะเบียนโมดูลของระบบ — enabled = N จะซ่อนเมนูทั้งสาขาออกจากทุกหน้าจอ';
COMMENT ON COLUMN app_modules.route_prefix IS 'เส้นทางต้นทางของโมดูล จับคู่แบบทั้งเซกเมนต์';

INSERT INTO app_modules (module_key, label, group_label, route_prefix, sort, note) VALUES
    -- งานทรัพยากรบุคคล
    ('hr.leave',              'ระบบการลา',                    'งานทรัพยากรบุคคล', '/hr/leave',                       10, 'ยื่นคำขอลา อนุมัติ สรุปรายการ วันลาสะสม กำหนดสิทธิ์'),
    ('hr.time_attendance',    'เวลาเข้าออกงาน',               'งานทรัพยากรบุคคล', '/hr/time-attendance',             20, NULL),
    ('hr.users',              'ทะเบียนบุคลากร',               'งานทรัพยากรบุคคล', '/hr/users',                       30, NULL),
    ('hr.dashboard',          'Dashboard ภาพรวมบุคลากร',      'งานทรัพยากรบุคคล', '/hr/dashboard',                   40, NULL),
    ('hr.supervisor',         'ผังผู้บริหาร',                  'งานทรัพยากรบุคคล', '/hr/settings/supervisor',         50, NULL),

    -- งานบริหารงานทั่วไป
    ('general.room_booking',  'ขอห้องพักเจ้าหน้าที่',          'งานบริหารงานทั่วไป', '/general/room-booking',          10, NULL),
    ('general.vehicle',       'รถราชการ',                      'งานบริหารงานทั่วไป', '/general/vehicle',               20, 'ขอใช้รถ อนุมัติ บันทึกการเดินทาง Dashboard'),
    ('general.item_moving',   'ขอย้ายสิ่งของ / จัดสถานที่',     'งานบริหารงานทั่วไป', '/general/item-moving',           30, NULL),
    ('general.maintenance',   'ระบบซ่อมบำรุง (ใบสั่งงาน/รายงาน)','งานบริหารงานทั่วไป', '/general/maintenance',          40, 'Dashboard ใบสั่งงานซ่อม รายงานค่าซ่อม'),
    ('general.repair_request','แจ้งซ่อมบำรุงทั่วไป',           'งานบริหารงานทั่วไป', '/general/maintenance-request',   50, NULL),
    ('general.medical_equip', 'แจ้งซ่อมเครื่องมือแพทย์',       'งานบริหารงานทั่วไป', '/general/medical-equipment-repair', 60, NULL),
    ('general.assets',        'ระบบครุภัณฑ์ / รับบริจาค',      'งานบริหารงานทั่วไป', '/general/assets',                70, NULL),
    ('general.procurement',   'งานพัสดุ',                      'งานบริหารงานทั่วไป', '/general/procurement',           80, NULL),

    -- งานพัฒนาระบบบริการและสนับสนุนบริการสุขภาพ
    ('hss.strategy',          'งานยุทธศาสตร์และแผนงาน',        'งานพัฒนาระบบบริการฯ', '/hss/strategy',                 10, NULL),
    ('hss.hrd',               'งานพัฒนาบุคลากรและการศึกษา',    'งานพัฒนาระบบบริการฯ', '/hss/hrd',                      20, NULL),

    -- งานคอมพิวเตอร์และเทคโนโลยีสารสนเทศ
    ('it.maintenance',        'งานซ่อมคอมพิวเตอร์',            'งานเทคโนโลยีสารสนเทศ', '/information-technology/maintenance',        10, NULL),
    ('it.hait',               'HAIT',                          'งานเทคโนโลยีสารสนเทศ', '/information-technology/hait',                20, NULL),
    ('it.smart_hospital',     'Smart Hospital',                'งานเทคโนโลยีสารสนเทศ', '/information-technology/smart-hospital',      30, NULL),
    ('it.roadmap',            'แผนโครงการ IT (Gantt)',         'งานเทคโนโลยีสารสนเทศ', '/information-technology/grant-charts',        40, NULL),
    ('it.user_request',       'ขอรหัสผู้ใช้งานระบบ',           'งานเทคโนโลยีสารสนเทศ', '/information-technology/user-request',        50, NULL),
    ('it.lan_request',        'ขอติดตั้งจุด LAN',              'งานเทคโนโลยีสารสนเทศ', '/information-technology/lan-request',         60, NULL),
    ('it.his_session',        'ขอเคลียร์เซสชัน HIS',           'งานเทคโนโลยีสารสนเทศ', '/information-technology/his-users-session',   70, NULL),

    -- งานข้อมูลทางการแพทย์
    ('medstat',               'งานข้อมูลทางการแพทย์',          'งานข้อมูลทางการแพทย์', '/medical-data',                 10, 'เวชสถิติ ขอข้อมูล ตรวจสอบคำขอ Dashboard'),

    -- งานการเงินและบัญชี
    ('accounting.schedule',   'ตารางเวรการปฏิบัติงาน',         'งานการเงินและบัญชี', '/accounting/schedule',            10, NULL),
    ('accounting.salary',     'สลิปเงินเดือน',                 'งานการเงินและบัญชี', '/accounting/salary',              20, NULL),
    ('accounting.salary_ids', 'เลขที่เงินเดือนบุคลากร',        'งานการเงินและบัญชี', '/accounting/salary-ids',          30, NULL),
    ('accounting.credentials','ขอสิทธิ์ใช้งานระบบบัญชี',       'งานการเงินและบัญชี', '/accounting/credentials',         40, NULL),
    ('accounting.repair_pay', 'เบิกจ่ายค่าซ่อมบำรุง',          'งานการเงินและบัญชี', '/accounting/repair-payment',      50, NULL),
    ('accounting.payable',    'เจ้าหนี้การค้า / KPI จ่าย',      'งานการเงินและบัญชี', '/accounting/accounts-payable',    60, NULL),
    ('accounting.budget',     'งบประมาณรายหน่วยงาน',           'งานการเงินและบัญชี', '/accounting/budget',              70, NULL)
ON CONFLICT (module_key) DO NOTHING;
