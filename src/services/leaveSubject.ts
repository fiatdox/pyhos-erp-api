import { core_kon } from '../db/db';

// ── ใบลาเป็นของใคร: ผู้ login เอง หรือบุคลากรที่ HR / ADMIN ทำรายการแทน ─────────
//
// ปกติผู้ยื่นคือผู้ login เท่านั้น — ส่ง user_id ของคนอื่นมาได้เฉพาะ HR / ADMIN
// (ใช้บันทึกใบลาย้อนหลังแทนบุคลากร เช่น ลาพักผ่อนที่ระเบียบไม่ให้ผู้ลายื่นย้อนหลังเอง)

export const LEAVE_ON_BEHALF_ROLES = ['ADMIN', 'HR'];

export const isHrOrAdmin = async (userId: number): Promise<boolean> => {
    const rows = await core_kon`
        SELECT 1 FROM core_kon.user_m_users_roles mu
        JOIN core_kon.user_roles r ON r.id = mu.role_id
        WHERE mu.user_id = ${userId} AND UPPER(r.role_name) IN ${core_kon(LEAVE_ON_BEHALF_ROLES)}
        LIMIT 1
    `;
    return rows.length > 0;
};

export type LeaveSubject =
    | { ok: true; uid: number; actorId: number; actorIsHr: boolean; onBehalf: boolean }
    | { ok: false; status: number; message: string };

export const resolveLeaveSubject = async (actorId: number, requested: unknown): Promise<LeaveSubject> => {
    const actorIsHr = await isHrOrAdmin(actorId);
    const target = requested == null || requested === '' ? actorId : Number(requested);
    if (!Number.isInteger(target) || target < 1) return { ok: false, status: 400, message: 'รหัสบุคลากรไม่ถูกต้อง' };
    if (target === actorId) return { ok: true, uid: actorId, actorId, actorIsHr, onBehalf: false };
    if (!actorIsHr) return { ok: false, status: 403, message: 'ทำรายการลาแทนผู้อื่นได้เฉพาะงานทรัพยากรบุคคลหรือผู้ดูแลระบบ' };
    const [u] = await core_kon`SELECT id FROM users WHERE id = ${target} AND is_active <> 'N'`;
    if (!u) return { ok: false, status: 404, message: 'ไม่พบบุคลากรที่ต้องการทำรายการแทน' };
    return { ok: true, uid: target, actorId, actorIsHr, onBehalf: true };
};

/** คอลัมน์ hr_leave_requests.created_by (src/db/hr_leave_day_count.sql) — ยังไม่รัน SQL ก็ใช้งานได้ แค่ไม่บันทึกผู้ทำรายการ */
let createdByColumn: Promise<boolean> | null = null;
export const hasCreatedByColumn = () => {
    createdByColumn ??= core_kon`
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema() AND table_name = 'hr_leave_requests' AND column_name = 'created_by'
    `.then(r => r.length > 0).catch(() => { createdByColumn = null; return false; });
    return createdByColumn;
};
