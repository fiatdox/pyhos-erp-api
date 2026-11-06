// ── ตั้งค่าการแจ้งเตือนระบบลา (หน้า /hr/leave/notify-settings — เฉพาะ ADMIN) ─────────────────
// ตรรกะการส่งอยู่ที่ services/leaveNotify.ts
import { core_kon } from '../db/db';
import { DEFAULT_CONFIG, digestBuckets, loadConfig, modeOfStep, mophConfigured, normalizeConfig, saveConfig, saveExempt, sendTest, type ExemptMode } from '../services/leaveNotify';
import type { ChainStep } from '../services/leaveChain';
const fail = (set: any, status: number, message: string) => { set.status = status; return { success: false, message }; };

const isAdmin = async (uid: number) => (await core_kon`
    SELECT 1 FROM core_kon.user_m_users_roles mu JOIN core_kon.user_roles r ON r.id = mu.role_id
    WHERE mu.user_id = ${uid} AND UPPER(r.role_name) = 'ADMIN' LIMIT 1`).length > 0;

export const guard = async (user: any, set: any) => (await isAdmin(Number(user?.id))) ? null : fail(set, 403, 'เฉพาะผู้ดูแลระบบ (ADMIN)');

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

// ── ยกเว้นการแจ้งเตือนรายคน (หน้า /hr/leave/notify-exempt) ────────────────────────────
const LEVEL_NAME: Record<string, string> = {
    DIRECTOR: 'ผู้อำนวยการ', MISSION: 'หัวหน้ากลุ่มภารกิจ', MAJOR: 'หัวหน้ากลุ่มงาน', SUBMAJOR: 'หัวหน้าหน่วยงาน',
};
const LEVEL_ORDER = ['DIRECTOR', 'MISSION', 'MAJOR', 'SUBMAJOR'];

/** หัวหน้าทุกระดับ + คนที่ถูกยกเว้นอยู่ พร้อมโหมดตามค่าระดับ และรายชื่อบุคลากรอื่นสำหรับเพิ่มเข้ารายการ */
export const getLeaveNotifyExempt = async ({ user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const { config } = await loadConfig();

        let ready = true;
        let exempt: any[] = [];
        try {
            exempt = await core_kon`
                SELECT e.user_id, e.mode, e.updated_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name
                FROM hr_leave_notify_exempt e LEFT JOIN users u ON u.id = e.updated_by`;
        } catch (e: any) {
            if (!/does not exist/.test(String(e?.message))) throw e;
            ready = false;
        }
        const exemptById = new Map(exempt.map(e => [Number(e.user_id), e]));

        const units = await core_kon`
            SELECT supervisor_id AS uid, FALSE AS is_acting, 'SUBMAJOR' AS level, submajor_id AS unit_id, name AS unit_name FROM submajors WHERE supervisor_id IS NOT NULL AND is_active = 'Y'
            UNION ALL SELECT acting_supervisor_id, TRUE, 'SUBMAJOR', submajor_id, name FROM submajors WHERE acting_supervisor_id IS NOT NULL AND is_active = 'Y'
            UNION ALL SELECT supervisor_id, FALSE, 'MAJOR', major_id, name FROM majors WHERE supervisor_id IS NOT NULL AND is_active = 'Y'
            UNION ALL SELECT acting_supervisor_id, TRUE, 'MAJOR', major_id, name FROM majors WHERE acting_supervisor_id IS NOT NULL AND is_active = 'Y'
            UNION ALL SELECT supervisor_id, FALSE, 'MISSION', mission_id, name FROM missions WHERE supervisor_id IS NOT NULL AND is_active = 'Y'
            UNION ALL SELECT acting_supervisor_id, TRUE, 'MISSION', mission_id, name FROM missions WHERE acting_supervisor_id IS NOT NULL AND is_active = 'Y'`;
        const directors = await core_kon`SELECT name, value FROM hr_settings WHERE name IN ('director_id', 'acting_director_id') AND value <> ''`;
        const heads = [
            ...(directors as any[]).map(d => ({ uid: Number(d.value), is_acting: d.name === 'acting_director_id', level: 'DIRECTOR', unit_id: null, unit_name: null })),
            ...(units as any[]).map(u => ({ ...u, uid: Number(u.uid) })),
        ];

        // คนที่ถูกยกเว้นแต่พ้นสภาพไปแล้วยังต้องเห็น จะได้เอาออกจากรายการได้
        const exemptIds = [...exemptById.keys()];
        const people = await core_kon`
            SELECT u.id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, COALESCE(sm.name, mj.name) AS unit_name,
                   (u.id_card ~ '^[0-9]{13}$') AS has_cid,
                   (u.is_active = 'Y' AND COALESCE(u.user_status_id, 1) = 1 AND (u.work_end_date IS NULL OR u.work_end_date >= CURRENT_DATE)) AS working
            FROM users u
            LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
            LEFT JOIN majors mj ON mj.major_id = u.major_id
            WHERE u.is_active = 'Y' ${exemptIds.length ? core_kon`OR u.id IN ${core_kon(exemptIds)}` : core_kon``}
            ORDER BY u.fname, u.lname`;

        const rows: any[] = [];
        const staff: any[] = [];
        for (const p of people as any[]) {
            const id = Number(p.id);
            const titles = !p.working ? [] : heads.filter(h => h.uid === id)
                .sort((a, z) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(z.level))
                .map(h => ({
                    level: h.level, level_name: LEVEL_NAME[h.level], unit_name: h.unit_name, is_acting: h.is_acting,
                    mode: modeOfStep(config, { level: h.level, approver_id: id, unit_id: h.unit_id } as unknown as ChainStep),
                }));
            const e = exemptById.get(id);
            if (titles.length || e) {
                rows.push({
                    id, name: p.name, unit_name: p.unit_name, has_cid: !!p.has_cid, working: !!p.working, titles,
                    exempt: e?.mode ?? null, updated_at: e?.updated_at ?? null, updated_by_name: e?.updated_by_name ?? null,
                });
            } else {
                staff.push({ id, name: p.name, unit_name: p.unit_name });
            }
        }
        return { success: true, data: { ready, enabled: config.enabled, digest_times: config.digest_times, rows, staff } };
    } catch (e: any) {
        console.error('[leaveNotify] getExempt:', e?.message);
        return fail(set, 500, 'โหลดรายการยกเว้นไม่สำเร็จ');
    }
};

export const updateLeaveNotifyExempt = async ({ params, body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const userId = Number(params?.userId);
        if (!Number.isInteger(userId) || userId <= 0) return fail(set, 400, 'รหัสบุคลากรไม่ถูกต้อง');
        const mode = body?.mode ?? null;
        if (mode !== null && mode !== 'digest' && mode !== 'off') return fail(set, 400, 'รูปแบบการยกเว้นไม่ถูกต้อง');
        const [target] = await core_kon`SELECT 1 FROM users WHERE id = ${userId}`;
        if (!target) return fail(set, 404, 'ไม่พบบุคลากร');
        await saveExempt(userId, mode as ExemptMode | null, Number(user?.id) || null);
        return { success: true, message: mode ? 'บันทึกการยกเว้นแล้ว' : 'เลิกยกเว้นแล้ว — กลับไปตามค่าตั้งของระดับ' };
    } catch (e: any) {
        console.error('[leaveNotify] saveExempt:', e?.message);
        return fail(set, 500, /does not exist/.test(String(e?.message)) ? 'ยังไม่ได้สร้างตาราง — รัน src/db/hr_leave_notify.sql ก่อน' : 'บันทึกไม่สำเร็จ');
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
