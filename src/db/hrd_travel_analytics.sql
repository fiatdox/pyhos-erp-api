-- ══════════════════════════════════════════════════════════════════════════════
-- เดินทางไปราชการ: เตรียมข้อมูลสำหรับ dashboard เปรียบเทียบย้อนหลังหลายปีงบ (เช่น สรุป 5 ปี)
--   1) hrd_travel_requests.fiscal_year — ปีงบ พ.ศ. ของวันออกเดินทาง (เวลาไทย, 1 ต.ค. ขึ้นปีใหม่) คำนวณเก็บไว้ (STORED)
--      group/กรองตามปีงบได้ตรง ๆ และใช้ดัชนีได้ — ไม่ต้องคิดช่วงวันที่ทุก query
--   2) hrd_travel_request_travelers.major_id / mission_id — สังกัดของผู้เดินทาง ณ วันยื่น (snapshot)
--      เทียบย้อนหลังรายกลุ่มงานได้ถูกต้องแม้คนย้ายกลุ่มภายหลัง · trigger เติมให้ทุกครั้งที่เพิ่มแถว
--      แถวเก่า: เติมจากสังกัดปัจจุบัน (ดีที่สุดที่มี — ไม่มีประวัติการย้าย)
--   3) ดัชนีสำหรับสรุปรายปีงบ / รายกลุ่มงาน
-- รันหลัง hrd_travel_hrd_review.sql · รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════

-- 1) ปีงบประมาณ (เดือน ต.ค.–ธ.ค. = ปีงบถัดไป)
ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS fiscal_year SMALLINT GENERATED ALWAYS AS (
    (EXTRACT(YEAR FROM (start_at AT TIME ZONE 'Asia/Bangkok'))::int + 543
     + CASE WHEN EXTRACT(MONTH FROM (start_at AT TIME ZONE 'Asia/Bangkok')) >= 10 THEN 1 ELSE 0 END)::smallint
) STORED;
COMMENT ON COLUMN hrd_travel_requests.fiscal_year IS 'ปีงบประมาณ พ.ศ. ของวันออกเดินทาง (เวลาไทย) — คำนวณอัตโนมัติ';

-- 2) สังกัดผู้เดินทาง ณ วันยื่น
ALTER TABLE hrd_travel_request_travelers
    ADD COLUMN IF NOT EXISTS major_id   INT,
    ADD COLUMN IF NOT EXISTS mission_id INT;
COMMENT ON COLUMN hrd_travel_request_travelers.major_id IS 'กลุ่มงานของผู้เดินทาง ณ วันยื่น/แก้ไขคำขอ';
COMMENT ON COLUMN hrd_travel_request_travelers.mission_id IS 'กลุ่มภารกิจของผู้เดินทาง ณ วันยื่น/แก้ไขคำขอ';

-- SET search_path FROM CURRENT: ตาราง users อยู่ schema เดียวกับตอนสร้าง trigger (ไม่ขึ้นกับ session ที่ insert)
CREATE OR REPLACE FUNCTION hrd_travel_traveler_unit() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
    IF NEW.major_id IS NULL AND NEW.mission_id IS NULL THEN
        SELECT u.major_id, u.mission_id INTO NEW.major_id, NEW.mission_id FROM users u WHERE u.id = NEW.user_id;
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_hrd_travel_traveler_unit ON hrd_travel_request_travelers;
CREATE TRIGGER trg_hrd_travel_traveler_unit BEFORE INSERT ON hrd_travel_request_travelers
    FOR EACH ROW EXECUTE FUNCTION hrd_travel_traveler_unit();

UPDATE hrd_travel_request_travelers t SET major_id = u.major_id, mission_id = u.mission_id
FROM users u WHERE u.id = t.user_id AND t.major_id IS NULL AND t.mission_id IS NULL;

-- 3) ดัชนี
-- สรุปรายปีงบ (หลายปี) — คำขอที่ยื่นแล้ว · INCLUDE ยอดเงินให้สรุปได้จากดัชนีโดยไม่ต้องอ่านแถวเต็ม
CREATE INDEX IF NOT EXISTS idx_hrd_travel_requests_fy
    ON hrd_travel_requests (fiscal_year, budget_id) INCLUDE (total_amount, actual_amount, allowance_amount, lodging_amount)
    WHERE status = 'submitted';
-- รายกลุ่มงาน/กลุ่มภารกิจ ณ วันยื่น
CREATE INDEX IF NOT EXISTS idx_hrd_travel_travelers_major ON hrd_travel_request_travelers (major_id, request_id);
CREATE INDEX IF NOT EXISTS idx_hrd_travel_travelers_mission ON hrd_travel_request_travelers (mission_id, request_id);

ANALYZE hrd_travel_requests;
ANALYZE hrd_travel_request_travelers;
