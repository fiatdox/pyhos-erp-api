-- ══════════════════════════════════════════════════════════════════════════════
-- ค่ารถรับจ้างในจังหวัดพะเยา (บ้าน/ที่พัก ↔ สถานีขนส่ง) — เบิกตามที่จ่ายจริง ไม่เกินอัตราที่ สสจ.พะเยา กำหนด
--   อัตรา = บาท : เที่ยว : คน : วัน แยกตามอำเภอที่ขึ้นรถ (เช่น เมืองพะเยา 75 = รพ. → บขส.)
--   ผู้ตั้งค่า: ADMIN / HRD (หน้า ตั้งค่าการเดินทาง) · แก้แล้วลง hrd_travel_transport_log entity = 'local'
-- คำขอเก็บอำเภอ อัตรา จำนวนเที่ยว และจุดขึ้นรถ ณ วันที่ขอไว้ในคำขอเอง (แก้อัตราภายหลังไม่กระทบคำขอเก่า)
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hrd_travel_local_rates (
    id          SERIAL PRIMARY KEY,
    district    VARCHAR(100) NOT NULL UNIQUE,
    rate        INT NOT NULL CHECK (rate > 0 AND rate <= 10000),   -- บาท/เที่ยว/คน/วัน
    note        VARCHAR(200),
    sort_order  INT NOT NULL DEFAULT 0,
    updated_by  INT REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO hrd_travel_local_rates (district, rate, note, sort_order) VALUES
    ('เมืองพะเยา', 75, 'รพ. → บขส.', 1),
    ('จุน',        110, NULL, 2),
    ('เชียงคำ',    120, NULL, 3),
    ('เชียงม่วน',  145, NULL, 4),
    ('ดอกคำใต้',   90, NULL, 5),
    ('ปง',         120, NULL, 6),
    ('แม่ใจ',       90, NULL, 7),
    ('ภูซาง',      135, NULL, 8),
    ('ภูกามยาว',   90, NULL, 9)
ON CONFLICT (district) DO NOTHING;

-- ประวัติการแก้ไขใช้ตารางเดียวกับอัตราค่าพาหนะอื่น
ALTER TABLE hrd_travel_transport_log DROP CONSTRAINT IF EXISTS hrd_travel_transport_log_entity_check;
ALTER TABLE hrd_travel_transport_log ADD CONSTRAINT hrd_travel_transport_log_entity_check CHECK (entity IN ('vehicle', 'route', 'local'));

-- รายละเอียดค่าเดินทางบ้าน ↔ สถานี ของคำขอ (มีเมื่อ home_station_amount > 0)
ALTER TABLE hrd_travel_requests
    ADD COLUMN IF NOT EXISTS home_station_rate_id  INT REFERENCES hrd_travel_local_rates(id),
    ADD COLUMN IF NOT EXISTS home_station_district VARCHAR(100),
    ADD COLUMN IF NOT EXISTS home_station_rate     NUMERIC(10,2),
    ADD COLUMN IF NOT EXISTS home_station_trips    SMALLINT CHECK (home_station_trips IN (1, 2)),
    ADD COLUMN IF NOT EXISTS home_station_from     VARCHAR(200),
    ADD COLUMN IF NOT EXISTS home_station_to       VARCHAR(200);
COMMENT ON COLUMN hrd_travel_requests.home_station_district IS 'อำเภอที่ขึ้นรถรับจ้าง (อัตรา สสจ.พะเยา ณ วันที่ขอ)';
COMMENT ON COLUMN hrd_travel_requests.home_station_rate IS 'อัตรา บาท/เที่ยว/คน ณ วันที่ขอ';
COMMENT ON COLUMN hrd_travel_requests.home_station_trips IS 'จำนวนเที่ยว 1 = เที่ยวเดียว · 2 = ไป-กลับ';
COMMENT ON COLUMN hrd_travel_requests.home_station_from IS 'จุดขึ้นรถ (บ้าน/ที่พัก/ที่ทำงาน)';
COMMENT ON COLUMN hrd_travel_requests.home_station_to IS 'สถานีที่ไปขึ้นรถโดยสาร/เครื่องบิน';
