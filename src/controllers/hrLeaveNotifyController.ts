// ── ตั้งค่าการแจ้งเตือนระบบลา (หน้า /hr/leave/notify-settings — เฉพาะ ADMIN) ─────────────────
// ตรรกะการส่งอยู่ที่ services/leaveNotify.ts
import { core_kon } from '../db/db';
import { DEFAULT_CONFIG, digestBuckets, loadConfig, mophConfigured, normalizeConfig, saveConfig, sendTest } from '../services/leaveNotify';
const fail = (set: any, status: number, message: string) => { set.status = status; return { success: false, message }; };

const isAdmin = async (uid: number) => (await core_kon`
    SELECT 1 FROM core_kon.user_m_users_roles mu JOIN core_kon.user_roles r ON r.id = mu.role_id
    WHERE mu.user_id = ${uid} AND UPPER(r.role_name) = 'ADMIN' LIMIT 1`).length > 0;

const guard = async (user: any, set: any) => (await isAdmin(Number(user?.id))) ? null : fail(set, 403, 'เฉพาะผู้ดูแลระบบ (ADMIN)');

export const getLeaveNotifyConfig = async ({ user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const { config, ready } = await loadConfig();
        const [meta] = ready ? await core_kon`
            SELECT c.updated_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name
            FROM hr_leave_notify_config c LEFT JOIN users u ON u.id = c.updated_by WHERE c.id = 1` : [];
        const missions = await core_kon`
            SELECT m.mission_id AS id, m.name, (SELECT count(*)::int FROM users u WHERE u.is_active = 'Y' AND u.mission_id = m.mission_id) AS staff
            FROM missions m WHERE m.is_active = 'Y' ORDER BY m.name`;
        return {
            success: true,
            data: {
                config, defaults: DEFAULT_CONFIG, ready, moph_configured: mophConfigured(),
                updated_at: meta?.updated_at ?? null, updated_by_name: meta?.updated_by_name ?? null, missions,
            },
        };
    } catch (e: any) {
        console.error('[leaveNotify] getConfig:', e?.message);
        return fail(set, 500, 'โหลดค่าตั้งไม่สำเร็จ');
    }
};

export const updateLeaveNotifyConfig = async ({ body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const raw = body?.config;
        if (Array.isArray(raw?.digest_times) && raw.digest_times.some((t: unknown) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(t)))) {
            return fail(set, 400, 'เวลาสรุปต้องเป็นรูปแบบ HH:MM เช่น 08:00');
        }
        const config = await saveConfig(raw, Number(user?.id) || null);
        return { success: true, data: { config }, message: 'บันทึกค่าตั้งการแจ้งเตือนแล้ว' };
    } catch (e: any) {
        console.error('[leaveNotify] saveConfig:', e?.message);
        return fail(set, 500, /does not exist/.test(String(e?.message)) ? 'ยังไม่ได้สร้างตาราง — รัน src/db/hr_leave_notify.sql ก่อน' : 'บันทึกไม่สำเร็จ');
    }
};

export const getLeaveNotifyLog = async ({ query, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const limit = Math.min(200, Math.max(1, Number(query?.limit) || 50));
        const rows = await core_kon`
            SELECT id, kind, request_id, recipients, status, detail, created_at
            FROM hr_leave_notify_log WHERE kind <> 'DIGEST_SLOT' ORDER BY id DESC LIMIT ${limit}`;
        return { success: true, data: rows };
    } catch (e: any) {
        if (/does not exist/.test(String(e?.message))) return { success: true, data: [] };
        console.error('[leaveNotify] log:', e?.message);
        return fail(set, 500, 'โหลดประวัติการส่งไม่สำเร็จ');
    }
};

/** ตัวอย่างรอบสรุปถ้าส่งตอนนี้ (ไม่ส่งจริง) — ใช้ค่าตั้งที่หน้าเว็บกำลังแก้ ถ้าส่งมา */
export const previewLeaveNotifyDigest = async ({ body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const config = body?.config ? normalizeConfig(body.config) : (await loadConfig()).config;
        const buckets = await digestBuckets(config);
        const ids = [...buckets.keys()];
        const people = ids.length ? await core_kon`
            SELECT id, CONCAT(pname, fname, ' ', lname) AS name, (id_card ~ '^[0-9]{13}$') AS has_cid FROM users WHERE id IN ${core_kon(ids)}` : [];
        const byId = new Map((people as any[]).map(p => [Number(p.id), p]));
        const data = [...buckets.entries()].map(([id, b]) => ({
            approver_id: id, name: byId.get(id)?.name ?? `#${id}`, has_cid: !!byId.get(id)?.has_cid,
            level: b.level, count: b.count, cancel: b.cancel, oldest: b.oldest,
            units: [...b.units.entries()].map(([unit, n]) => ({ unit, n })).sort((a, z) => z.n - a.n),
        })).sort((a, z) => z.count - a.count);
        return { success: true, data };
    } catch (e: any) {
        console.error('[leaveNotify] preview:', e?.message);
        return fail(set, 500, 'คำนวณตัวอย่างไม่สำเร็จ');
    }
};

export const testLeaveNotify = async ({ body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const level = ['SUBMAJOR', 'MAJOR', 'MISSION', 'DIRECTOR'].includes(String(body?.level)) ? body.level : undefined;
        const missionId = level === 'MISSION' && Number.isInteger(Number(body?.mission_id)) && Number(body.mission_id) > 0 ? Number(body.mission_id) : undefined;
        const colleague = body?.kind === 'COLLEAGUE';
        const r = await sendTest(Number(user?.id), { level, missionId, colleague, config: body?.config ? normalizeConfig(body.config) : undefined });
        return r.ok ? { success: true, message: r.message } : fail(set, 400, r.message);
    } catch (e: any) {
        console.error('[leaveNotify] test:', e?.message);
        return fail(set, 500, 'ทดสอบส่งไม่สำเร็จ');
    }
};
