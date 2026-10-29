-- ══════════════════════════════════════════════════════════════════════════════
-- บันทึกการเปิดหน้าเว็บ — ใช้ทำ dashboard การเข้าใช้งานระบบแต่ละหน้า (หน้าผู้ดูแล /account/usage)
-- access log ของ backend เก็บแค่ 45 วันและเป็นการเรียก API ไม่ใช่การเปิดหน้า
-- ดูย้อนหลังทั้งปีงบประมาณไม่ได้ จึงเก็บแยกไว้ที่นี่
--
-- path เก็บแบบ normalize แล้ว (ตัด query, เซกเมนต์ที่เป็นเลข/รหัสเป็น :id) ไม่มีข้อมูลส่วนบุคคลใน path
-- แถวละ ~60 ไบต์ ผู้ใช้ทั้ง รพ. ราว 1–2 หมื่นแถว/วัน
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS app_page_views (
    id         BIGSERIAL PRIMARY KEY,
    user_id    INT,
    path       VARCHAR(200) NOT NULL,
    client_ip  VARCHAR(64),
    viewed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_page_views_viewed_at ON app_page_views(viewed_at);
CREATE INDEX IF NOT EXISTS idx_page_views_path_time ON app_page_views(path, viewed_at);
