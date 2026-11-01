// ── ADMIN: ดูหน้า /hr/leave แบบเจ้าหน้าที่คนหนึ่ง (view as) ─────────────────────────
// ส่งข้อมูลชุดเดียวกับที่หน้า /hr/leave ใช้ตัดสินว่าจะแสดงเมนู/การ์ดอะไร แต่เป็นของบุคลากรที่เลือก
// (role · การเป็นหัวหน้า/รักษาการ/ผอ. · ใบรออนุมัติ · ใบลาของตัวเอง · สรุปวันลา) — อ่านอย่างเดียว
// ใช้ตรวจว่าแต่ละคนเห็นเมนูครบตามหน้าที่ไหม และใครได้สิทธิ์ที่ไม่ควรได้จาก role
import { core_kon } from '../db/db';
import { getLeaveApproverCheck } from './hrController';
import { getMyLeaveOverview, getMyLeaveRequests, getPendingApprovals } from './hrLeaveRequestController';

const isAdmin = async (uid: number) => (await core_kon`
    SELECT 1 FROM core_kon.user_m_users_roles mu JOIN core_kon.user_roles r ON r.id = mu.role_id
    WHERE mu.user_id = ${uid} AND UPPER(r.role_name) = 'ADMIN' LIMIT 1`).length > 0;

export const getLeaveAccessPreview = async ({ user, query, set }: any) => {
    try {
        const actor = Number(user?.id);
        if (!(await isAdmin(actor))) { set.status = 403; return { success: false, message: 'ดูแบบเจ้าหน้าที่ได้เฉพาะผู้ดูแลระบบ' }; }
        const uid = Number(query?.user_id);
        if (!Number.isInteger(uid) || uid < 1) { set.status = 400; return { success: false, message: 'รหัสบุคลากรไม่ถูกต้อง' }; }

        const [person] = await core_kon`
            SELECT u.id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, u.is_active
            FROM users u WHERE u.id = ${uid}`;
        if (!person) { set.status = 404; return { success: false, message: 'ไม่พบบุคลากร' }; }

        const as = { user: { id: uid }, set: {} as any };
        const [roleRows, approver, pending, mine, overview] = await Promise.all([
            core_kon`
                SELECT DISTINCT UPPER(r.role_name) AS role
                FROM core_kon.user_m_users_roles mu JOIN core_kon.user_roles r ON r.id = mu.role_id
                WHERE mu.user_id = ${uid} ORDER BY 1`,
            getLeaveApproverCheck(as),
            getPendingApprovals({ ...as, query: { scope: 'pending' } }),
            getMyLeaveRequests({ ...as, query: {} }),
            getMyLeaveOverview(as),
        ]) as any[];

        const rows: any[] = mine?.success && Array.isArray(mine.data) ? mine.data : [];
        return {
            success: true,
            data: {
                user: { id: Number(person.id), name: person.name, is_active: person.is_active === 'Y' },
                roles: roleRows.map((r: any) => String(r.role)),
                approver: approver?.success ? approver.data : null,
                pending_approvals: pending?.success && Array.isArray(pending.data) ? pending.data.length : 0,
                mine: { total: rows.length, pending: rows.filter(r => ['PENDING', 'CANCEL_PENDING'].includes(String(r.status).toUpperCase())).length },
                overview: overview?.success ? overview.data : null,
            },
        };
    } catch (error: any) {
        console.error('[getLeaveAccessPreview]', error?.message);
        set.status = 500;
        return { success: false, message: 'โหลดข้อมูลไม่สำเร็จ' };
    }
};
