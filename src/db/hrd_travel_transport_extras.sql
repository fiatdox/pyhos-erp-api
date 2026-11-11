-- ══════════════════════════════════════════════════════════════════════════════
-- ค่าพาหนะย่อยของคำขอไปราชการ (รถโดยสาร / เครื่องบิน / อื่น ๆ) — รวมอยู่ใน ๖.๓ ค่าพาหนะเดินทาง และ total_amount
--   taxi_go_amount      ค่าแท็กซี่ขาไป: สถานีขนส่ง/สนามบินปลายทาง → ที่พัก
--   taxi_back_amount    ค่าแท็กซี่ขากลับ: ที่พัก → สถานีขนส่ง/สนามบินปลายทาง
--   home_station_amount ค่าเดินทางบ้าน/ที่ทำงาน ↔ สถานีขนส่ง/สนามบินต้นทาง (ไป-กลับ)
-- transport_amount ยังเป็นค่าโดยสารตามเส้นทาง (ตรวจเพดาน) เหมือนเดิม
-- รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════
ALTER TABLE hrd_travel_requests
    ADD COLUMN IF NOT EXISTS taxi_go_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS taxi_back_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS home_station_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
COMMENT ON COLUMN hrd_travel_requests.taxi_go_amount IS 'ค่าแท็กซี่ขาไป สถานีขนส่ง/สนามบิน → ที่พัก (บาท)';
COMMENT ON COLUMN hrd_travel_requests.taxi_back_amount IS 'ค่าแท็กซี่ขากลับ ที่พัก → สถานีขนส่ง/สนามบิน (บาท)';
COMMENT ON COLUMN hrd_travel_requests.home_station_amount IS 'ค่าเดินทางบ้าน/ที่ทำงาน ↔ สถานีขนส่ง/สนามบิน ไป-กลับ (บาท)';
