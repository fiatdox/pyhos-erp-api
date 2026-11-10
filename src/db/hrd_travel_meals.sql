-- ══════════════════════════════════════════════════════════════════════════════
-- หักเบี้ยเลี้ยงเมื่อผู้จัด (ประชุม/อบรม/สัมมนา) จัดอาหารให้
--
-- ตามแนวปฏิบัติของกรมบัญชีกลาง: มื้อที่ผู้จัดเลี้ยงให้ หักเบี้ยเลี้ยงมื้อละ ๑ ใน ๓ ของอัตราต่อวัน
--   (อัตรา ๒๔๐ บาท/วัน → มื้อละ ๘๐ บาท · ๒๗๐ บาท/วัน → มื้อละ ๙๐ บาท)
-- จำนวนมื้อใช้กับผู้เดินทางทุกคนในคำขอ (ไปงานเดียวกัน) · เบี้ยเลี้ยงรายคน = อัตรา × วัน − มื้อ × (อัตรา ÷ ๓)
-- คำขอเดิม = ๐ มื้อ (ยอดไม่เปลี่ยน) · รันซ้ำได้
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE hrd_travel_requests ADD COLUMN IF NOT EXISTS meals_provided SMALLINT NOT NULL DEFAULT 0;
COMMENT ON COLUMN hrd_travel_requests.meals_provided IS 'จำนวนมื้อที่ผู้จัดเลี้ยงอาหาร — หักเบี้ยเลี้ยงมื้อละ ๑/๓ ของอัตราต่อวันของแต่ละคน';

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_hrd_travel_requests_meals') THEN
        ALTER TABLE hrd_travel_requests ADD CONSTRAINT ck_hrd_travel_requests_meals
            CHECK (meals_provided >= 0 AND meals_provided <= allowance_days * 3);
    END IF;
END $$;
