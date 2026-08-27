-- ══════════════════════════════════════════════════════════════════════════════
-- เลขที่เงินเดือนหลายเลขต่อ 1 คน
-- เหตุผล: เจ้าหน้าที่ที่เริ่มงานเป็นลูกจ้าง/พนักงานราชการ แล้วได้บรรจุเป็นข้าราชการ
--         จะได้เลขที่เงินเดือนใหม่ ข้อมูลสลิปเก่ายังอยู่ใต้เลขเดิม
--         ถ้าผูกได้เลขเดียว (users.salary_id) ประวัติก่อนบรรจุจะหายไปจากระบบ
--
-- users.salary_id ยังคงไว้ = "เลขปัจจุบัน" เพื่อไม่ให้โค้ดเดิมพัง
-- ตารางนี้คือแหล่งความจริงของ "ทุกเลขที่เคยใช้"
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS user_salary_ids (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL,
    salary_id   INT NOT NULL,
    -- เลขที่เงินเดือน 1 เลข ต้องเป็นของคนเดียวเท่านั้น กันสลิปข้ามคน
    CONSTRAINT uq_user_salary_ids_salary UNIQUE (salary_id),

    is_current  BOOLEAN NOT NULL DEFAULT FALSE,   -- เลขที่ใช้อยู่ปัจจุบัน (1 คนควรมีอันเดียว)
    source      VARCHAR(20) NOT NULL DEFAULT 'manual',
        -- migrated = ย้ายมาจาก users.salary_id | auto_pid = ระบบค้นเจอจากเลขบัตร | manual = ผู้ดูแลเพิ่มเอง
    note        VARCHAR(200),                     -- เช่น "ก่อนบรรจุ (ลูกจ้างชั่วคราว)"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by  INT
);
CREATE INDEX IF NOT EXISTS idx_user_salary_ids_user ON user_salary_ids(user_id);

-- ย้ายข้อมูลเดิมจาก users.salary_id เข้ามาเป็น "เลขปัจจุบัน"
INSERT INTO user_salary_ids (user_id, salary_id, is_current, source, note)
SELECT u.id, u.salary_id, TRUE, 'migrated', 'ย้ายจากข้อมูลเดิม'
FROM users u
WHERE u.salary_id IS NOT NULL
ON CONFLICT (salary_id) DO NOTHING;
