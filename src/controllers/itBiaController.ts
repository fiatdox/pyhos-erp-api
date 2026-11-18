import { core_kon } from '../db/db';

// ── Business Impact Analysis (BIA) ของงาน IT ────────────────────────────────
// ตาราง it_bia_services + it_bia_log (src/db/it_bia.sql) · ไม่มีลบ — ปิดใช้แทน
// MTPD / Tier คำนวณที่หน้าเว็บ (ข้อมูลดิบเก็บที่นี่) · ผู้แก้ = ผู้ใช้จาก token เท่านั้น

class Bad extends Error { constructor(public status: number, msg: string, public field?: string) { super(msg); } }
const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, field }; };

const CATEGORIES = ['clinical', 'support', 'admin', 'infra'];
const IMPACTS = ['impact_patient', 'impact_operation', 'impact_financial', 'impact_legal', 'impact_reputation'] as const;
const WINDOWS = ['impact_1h', 'impact_4h', 'impact_24h', 'impact_72h', 'impact_1w'] as const;
const KEY_RE = /^(v3|v2):.{1,60}$/;

const int = (v: unknown, lo: number, hi: number, field: string) => {
    const n = Number(v);
    if (v === null || v === undefined || v === '' || !Number.isInteger(n) || n < lo || n > hi) throw new Bad(400, `ต้องเป็นจำนวนเต็ม ${lo}–${hi}`, field);
    return n;
};
const optNum = (v: unknown, field: string, max = 100000) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new Bad(400, 'ต้องเป็นตัวเลขไม่ติดลบ', field);
    return n;
};
const txt = (v: unknown, max: number, field: string) => {
    const s = String(v ?? '').trim().replace(/[ \t]+/g, ' ');
    if (s.length > max) throw new Bad(400, `ข้อความยาวเกิน ${max} ตัวอักษร`, field);
    return s || null;
};

const readBody = (b: any) => {
    const name = txt(b?.name, 150, 'name');
    if (!name) throw new Bad(400, 'กรุณาระบุชื่อบริการ/ระบบงาน', 'name');
    const category = String(b?.category ?? '');
    if (!CATEGORIES.includes(category)) throw new Bad(400, 'กรุณาเลือกประเภทบริการ', 'category');
    const out: Record<string, any> = { name, category, owner_department: txt(b?.owner_department, 255, 'owner_department'), description: txt(b?.description, 2000, 'description') };
    for (const k of IMPACTS) out[k] = int(b?.[k], 1, 5, k);
    for (const k of WINDOWS) out[k] = int(b?.[k], 0, 5, k);
    // ผลกระทบต้องไม่ลดลงเมื่อหยุดนานขึ้น
    for (let i = 1; i < WINDOWS.length; i++) if (out[WINDOWS[i]] < out[WINDOWS[i - 1]]) throw new Bad(400, 'ระดับผลกระทบต้องไม่ลดลงเมื่อหยุดนานขึ้น', WINDOWS[i]);
    const rto = optNum(b?.rto_hours, 'rto_hours', 9999), rpo = optNum(b?.rpo_hours, 'rpo_hours', 9999);
    if (rto === null) throw new Bad(400, 'กรุณาระบุ RTO (ชั่วโมง)', 'rto_hours');
    if (rpo === null) throw new Bad(400, 'กรุณาระบุ RPO (ชั่วโมง)', 'rpo_hours');
    Object.assign(out, {
        rto_hours: rto, rpo_hours: rpo,
        workaround: txt(b?.workaround, 2000, 'workaround'), workaround_hours: optNum(b?.workaround_hours, 'workaround_hours', 9999),
        users_affected: b?.users_affected === '' || b?.users_affected == null ? null : int(b.users_affected, 0, 100000, 'users_affected'),
        patients_per_day: b?.patients_per_day === '' || b?.patients_per_day == null ? null : int(b.patients_per_day, 0, 1000000, 'patients_per_day'),
        peak_period: txt(b?.peak_period, 255, 'peak_period'),
        is_active: b?.is_active === undefined ? true : !!b.is_active,
        reviewed_at: b?.reviewed_at ? (/^\d{4}-\d{2}-\d{2}$/.test(String(b.reviewed_at)) ? String(b.reviewed_at) : (() => { throw new Bad(400, 'วันที่ไม่ถูกต้อง', 'reviewed_at'); })()) : null,
    });
    const keys = Array.isArray(b?.asset_keys) ? [...new Set(b.asset_keys.map(String))] as string[] : [];
    if (keys.length > 200 || keys.some(k => !KEY_RE.test(k))) throw new Bad(400, 'รายการครุภัณฑ์ไม่ถูกต้อง', 'asset_keys');
    const deps = Array.isArray(b?.depends_on) ? [...new Set(b.depends_on.map(Number))] as number[] : [];
    if (deps.length > 50 || deps.some(d => !Number.isInteger(d) || d <= 0)) throw new Bad(400, 'บริการที่พึ่งพาไม่ถูกต้อง', 'depends_on');
    out.asset_keys = keys; out.depends_on = deps;
    return out;
};

const ROW = core_kon`
    s.*, s.rto_hours::float8 AS rto_hours, s.rpo_hours::float8 AS rpo_hours, s.workaround_hours::float8 AS workaround_hours,
    to_char(s.reviewed_at, 'YYYY-MM-DD') AS reviewed_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name`;

export const getBiaServices = async ({ set }: any) => {
    try {
        const rows = await core_kon`SELECT ${ROW} FROM it_bia_services s LEFT JOIN users u ON u.id = s.updated_by ORDER BY s.is_active DESC, s.name`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[ItBia] list:', e?.message);
        return fail(set, 500, 'โหลดทะเบียน BIA ไม่สำเร็จ');
    }
};

const checkDeps = async (sql: any, deps: number[], selfId: number | null) => {
    if (selfId && deps.includes(selfId)) throw new Bad(400, 'บริการพึ่งพาตัวเองไม่ได้', 'depends_on');
    if (!deps.length) return;
    const found = await sql`SELECT id FROM it_bia_services WHERE id IN ${sql(deps)}`;
    if (found.length !== deps.length) throw new Bad(400, 'ไม่พบบริการที่พึ่งพาบางรายการ', 'depends_on');
};

export const createBiaService = async ({ body, user, set }: any) => {
    try {
        const b = readBody(body);
        const actor = Number(user.id);
        const id = await core_kon.begin(async (sql: any) => {
            if ((await sql`SELECT 1 FROM it_bia_services WHERE LOWER(name) = LOWER(${b.name})`).length) throw new Bad(409, `มีบริการชื่อ "${b.name}" แล้ว`, 'name');
            await checkDeps(sql, b.depends_on, null);
            const [r] = await sql`INSERT INTO it_bia_services ${sql({ ...b, created_by: actor, updated_by: actor } as any)} RETURNING id`;
            await sql`INSERT INTO it_bia_log (service_id, action, after, changed_by) VALUES (${r.id}, 'create', ${sql.json(b)}, ${actor})`;
            return r.id;
        });
        return { success: true, data: { id } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[ItBia] create:', e?.message);
        return fail(set, 500, 'บันทึกไม่สำเร็จ');
    }
};

export const updateBiaService = async ({ params, body, user, set }: any) => {
    try {
        const b = readBody(body);
        const actor = Number(user.id);
        const sid = Number(params.id);
        const changed = await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT * FROM it_bia_services WHERE id = ${sid} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบบริการ');
            if ((await sql`SELECT 1 FROM it_bia_services WHERE LOWER(name) = LOWER(${b.name}) AND id <> ${sid}`).length) throw new Bad(409, `มีบริการชื่อ "${b.name}" แล้ว`, 'name');
            await checkDeps(sql, b.depends_on, sid);
            const before: Record<string, any> = {};
            for (const k of Object.keys(b)) before[k] = cur[k] instanceof Date ? cur[k].toISOString().slice(0, 10) : (typeof cur[k] === 'string' && /^\d+(\.\d+)?$/.test(cur[k]) && typeof b[k] === 'number' ? Number(cur[k]) : cur[k]);
            if (JSON.stringify(before) === JSON.stringify(b)) return false;
            await sql`UPDATE it_bia_services SET ${sql({ ...b, updated_by: actor, updated_at: new Date() } as any)} WHERE id = ${sid}`;
            await sql`INSERT INTO it_bia_log (service_id, action, before, after, changed_by) VALUES (${sid}, 'update', ${sql.json(before)}, ${sql.json(b)}, ${actor})`;
            return true;
        });
        return { success: true, data: { changed } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[ItBia] update:', e?.message);
        return fail(set, 500, 'บันทึกไม่สำเร็จ');
    }
};

export const getBiaLog = async ({ params, set }: any) => {
    try {
        const rows = await core_kon`
            SELECT l.id, l.action, l.before, l.after, l.changed_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS changed_by_name
            FROM it_bia_log l LEFT JOIN users u ON u.id = l.changed_by
            WHERE l.service_id = ${Number(params.id)} ORDER BY l.changed_at DESC, l.id DESC LIMIT 100`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[ItBia] log:', e?.message);
        return fail(set, 500, 'โหลดประวัติไม่สำเร็จ');
    }
};
