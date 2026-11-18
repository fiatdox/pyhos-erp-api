import { core_kon } from '../db/db';

// ── ทะเบียนความเสี่ยง (Risk Register) ของบริการที่สำคัญ — ปีงบประมาณละ 2 ครั้ง ───────────
// ตาราง it_risk_registers / it_risk_register_items / it_risk_register_log (src/db/it_risk_register.sql)
// ระดับความเสี่ยง (ตามแบบฟอร์ม): 12.5–25 วิกฤติ · 9.5–12.4 สูง · 3.5–9.4 ปานกลาง · 1–3.4 ต่ำ — คำนวณที่หน้าเว็บ
// สร้างรอบใหม่ยกรายการที่ยัง Open จากรอบก่อนมาได้ (copied_from) · ผู้บันทึกการแก้ไข = ผู้ใช้จาก token

class Bad extends Error { constructor(public status: number, msg: string, public field?: string) { super(msg); } }
const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, field }; };
const handle = (set: any, tag: string, e: any) => {
    if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
    console.error(`[ItRiskRegister] ${tag}:`, e?.message);
    return fail(set, 500, 'บันทึกไม่สำเร็จ');
};

const CATEGORIES = ['strategic', 'operational', 'financial', 'compliance', 'reputational', 'cyber'];
const TREATMENTS = ['mitigate', 'accept', 'transfer', 'avoid', 'monitor'];
const CIA = ['C', 'I', 'A'];
const AREAS = ['F', 'S', 'R', 'I', 'L', 'O'];

const txt = (v: unknown, max: number, field: string, required = false) => {
    const s = String(v ?? '').trim();
    if (required && !s) throw new Bad(400, 'กรุณากรอกข้อมูล', field);
    if (s.length > max) throw new Bad(400, `ข้อความยาวเกิน ${max} ตัวอักษร`, field);
    return s || null;
};
const day = (v: unknown, field: string, required = false) => {
    if (v === null || v === undefined || v === '') { if (required) throw new Bad(400, 'กรุณาระบุวันที่', field); return null; }
    const s = String(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Bad(400, 'วันที่ไม่ถูกต้อง', field);
    return s;
};
const lvl = (v: unknown, field: string, required = true) => {
    if (!required && (v === null || v === undefined || v === '')) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new Bad(400, 'ต้องเป็นจำนวนเต็ม 1–5', field);
    return n;
};
const subset = (v: unknown, allowed: string[], field: string) => {
    const arr = Array.isArray(v) ? [...new Set(v.map(String))] : [];
    if (arr.some(x => !allowed.includes(x))) throw new Bad(400, 'ค่าที่เลือกไม่ถูกต้อง', field);
    return allowed.filter(x => arr.includes(x));   // เรียงตามแบบฟอร์มเสมอ
};

const readHeader = (b: any) => {
    const period = String(b?.period ?? '');
    // รอบ = ปีงบประมาณ พ.ศ. + ครั้งที่: 'YYYY-1' ต.ค.–มี.ค. · 'YYYY-2' เม.ย.–ก.ย.
    if (!/^2[56]\d{2}-[12]$/.test(period)) throw new Bad(400, 'กรุณาเลือกปีงบประมาณและครั้งที่ของทะเบียน', 'period');
    const rid = Number(b?.recorder_id);
    if (!Number.isInteger(rid) || rid <= 0) throw new Bad(400, 'กรุณาเลือกผู้บันทึกจากบัญชีเจ้าหน้าที่ IT', 'recorder_id');
    return {
        period, recorder_id: rid, recorder_role: txt(b?.recorder_role, 150, 'recorder_role'),
        meeting_date: day(b?.meeting_date, 'meeting_date'), location: txt(b?.location, 255, 'location'), address: txt(b?.address, 500, 'address'),
        critical_service: txt(b?.critical_service, 255, 'critical_service'), notes: txt(b?.notes, 2000, 'notes'),
    };
};

const readItem = (b: any) => {
    const category = String(b?.category ?? '');
    if (!CATEGORIES.includes(category)) throw new Bad(400, 'กรุณาเลือกกลุ่มความเสี่ยง', 'category');
    const treatment = String(b?.treatment ?? '');
    if (!TREATMENTS.includes(treatment)) throw new Bad(400, 'กรุณาเลือกตัวเลือกการตอบสนอง', 'treatment');
    const progress = b?.progress_pct === '' || b?.progress_pct == null ? 0 : Number(b.progress_pct);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Bad(400, 'ความคืบหน้าต้องเป็น 0–100', 'progress_pct');
    const rl = lvl(b?.residual_likelihood, 'residual_likelihood', false), ri = lvl(b?.residual_impact, 'residual_impact', false);
    if ((rl == null) !== (ri == null)) throw new Bad(400, 'ความเสี่ยงคงเหลือต้องระบุทั้งโอกาสเกิดและความรุนแรง', rl == null ? 'residual_likelihood' : 'residual_impact');
    const status = String(b?.status ?? 'open');
    if (!['open', 'closed'].includes(status)) throw new Bad(400, 'สถานะไม่ถูกต้อง', 'status');
    const bia = b?.bia_service_id === '' || b?.bia_service_id == null ? null : Number(b.bia_service_id);
    if (bia !== null && (!Number.isInteger(bia) || bia <= 0)) throw new Bad(400, 'บริการ BIA ไม่ถูกต้อง', 'bia_service_id');
    return {
        identified_date: day(b?.identified_date, 'identified_date', true), category,
        asset_group: txt(b?.asset_group, 255, 'asset_group', true), bia_service_id: bia,
        threat: txt(b?.threat, 1000, 'threat', true), vulnerability: txt(b?.vulnerability, 2000, 'vulnerability'), controls: txt(b?.controls, 2000, 'controls'),
        cia: subset(b?.cia, CIA, 'cia'), impact_areas: subset(b?.impact_areas, AREAS, 'impact_areas'),
        likelihood: lvl(b?.likelihood, 'likelihood'), impact: lvl(b?.impact, 'impact'),
        owner: txt(b?.owner, 255, 'owner'), treatment, treatment_plan: txt(b?.treatment_plan, 2000, 'treatment_plan'),
        progress_pct: progress, due_date: day(b?.due_date, 'due_date'),
        residual_areas: subset(b?.residual_areas, AREAS, 'residual_areas'), residual_likelihood: rl, residual_impact: ri,
        status, follow_up: txt(b?.follow_up, 2000, 'follow_up'),
    };
};

// ผู้บันทึก = บัญชีเจ้าหน้าที่ IT ที่ยังใช้งาน · recorder_name เก็บชื่อ ณ วันบันทึกไว้ (ทะเบียนเก่ายังแสดงชื่อเดิมแม้เปลี่ยนชื่อ/ย้ายงาน)
const RECORDER_ROLES = ['IT_STAFF', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT'];
const itStaff = (sql: any, id?: number) => sql`
    SELECT DISTINCT u.id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, up.position_name
    FROM user_m_users_roles mu JOIN users u ON u.id = mu.user_id JOIN user_roles r ON r.id = mu.role_id
    LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
    WHERE UPPER(r.role_name) = ANY(${RECORDER_ROLES}) AND COALESCE(UPPER(u.is_active), 'Y') <> 'N' ${id ? sql`AND u.id = ${id}` : sql``}
    ORDER BY name`;
const withRecorder = async (sql: any, h: ReturnType<typeof readHeader>, keep?: { recorder_id: number | null; recorder_name: string | null }) => {
    // แก้หัวทะเบียนโดยไม่เปลี่ยนผู้บันทึก → คงชื่อเดิมไว้ แม้บัญชีนั้นจะไม่ได้อยู่ฝ่าย IT แล้ว
    if (keep && keep.recorder_id === h.recorder_id) return { ...h, recorder_name: keep.recorder_name };
    const [u] = await itStaff(sql, h.recorder_id);
    if (!u) throw new Bad(400, 'ผู้บันทึกต้องเป็นบัญชีเจ้าหน้าที่ IT ที่ยังใช้งานอยู่', 'recorder_id');
    return { ...h, recorder_name: u.name as string };
};

export const listStaff = async ({ user, set }: any) => {
    try {
        const rows = await itStaff(core_kon);
        return { success: true, data: rows.map((r: any) => ({ ...r, me: r.id === Number(user.id) })) };
    } catch (e: any) { return handle(set, 'staff', e); }
};

const ITEM_COLS = core_kon`
    i.id, i.register_id, to_char(i.identified_date, 'YYYY-MM-DD') AS identified_date, i.category, i.asset_group, i.bia_service_id, b.name AS bia_service_name,
    i.threat, i.vulnerability, i.controls, i.cia, i.impact_areas, i.likelihood, i.impact, i.score, i.owner, i.treatment, i.treatment_plan, i.progress_pct,
    to_char(i.due_date, 'YYYY-MM-DD') AS due_date, i.residual_areas, i.residual_likelihood, i.residual_impact, i.residual_score, i.status, i.follow_up, i.copied_from,
    i.updated_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name`;
const HEADER_COLS = core_kon`
    r.id, r.period, r.recorder_id, r.recorder_name, r.recorder_role, to_char(r.meeting_date, 'YYYY-MM-DD') AS meeting_date, r.location, r.address, r.critical_service, r.notes,
    r.updated_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name`;

// รายการทะเบียนทุกรอบ (ใหม่ → เก่า) + สรุปจำนวนและคะแนนเฉลี่ย
export const listRegisters = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT ${HEADER_COLS}, count(i.id)::int AS items, count(i.id) FILTER (WHERE i.status = 'open')::int AS open_items,
                   ROUND(AVG(i.score)::numeric, 1)::float8 AS avg_score, ROUND(AVG(i.residual_score)::numeric, 1)::float8 AS avg_residual
            FROM it_risk_registers r LEFT JOIN users u ON u.id = r.updated_by LEFT JOIN it_risk_register_items i ON i.register_id = r.id
            GROUP BY r.id, u.pname, u.fname, u.lname ORDER BY r.period DESC`;
        return { success: true, data: rows };
    } catch (e: any) { return handle(set, 'list', e); }
};

export const getRegister = async ({ params, set }: any) => {
    try {
        const [header] = await core_kon`SELECT ${HEADER_COLS} FROM it_risk_registers r LEFT JOIN users u ON u.id = r.updated_by WHERE r.id = ${Number(params.id)}`;
        if (!header) return fail(set, 404, 'ไม่พบทะเบียน');
        const items = await core_kon`
            SELECT ${ITEM_COLS} FROM it_risk_register_items i
            LEFT JOIN it_bia_services b ON b.id = i.bia_service_id LEFT JOIN users u ON u.id = i.updated_by
            WHERE i.register_id = ${header.id} ORDER BY i.identified_date, i.id`;
        return { success: true, data: { ...header, items } };
    } catch (e: any) { return handle(set, 'get', e); }
};

// สร้างทะเบียนรอบใหม่ — copy_from = id ทะเบียนรอบก่อน: ยกรายการที่ยัง Open มาทั้งแถว (ไม่ยกรายการที่ปิดแล้ว)
export const createRegister = async ({ body, user, set }: any) => {
    try {
        const actor = Number(user.id);
        const copyFrom = body?.copy_from ? Number(body.copy_from) : null;
        const out = await core_kon.begin(async (sql: any) => {
            const h = await withRecorder(sql, readHeader(body));
            if ((await sql`SELECT 1 FROM it_risk_registers WHERE period = ${h.period}`).length) throw new Bad(409, 'รอบนี้มีทะเบียนอยู่แล้ว', 'period');
            const [r] = await sql`INSERT INTO it_risk_registers ${sql({ ...h, created_by: actor, updated_by: actor } as any)} RETURNING id`;
            await sql`INSERT INTO it_risk_register_log (register_id, action, after, changed_by) VALUES (${r.id}, 'create_register', ${sql.json(h)}, ${actor})`;
            let copied = 0;
            if (copyFrom) {
                if (!(await sql`SELECT 1 FROM it_risk_registers WHERE id = ${copyFrom}`).length) throw new Bad(400, 'ไม่พบทะเบียนที่จะยกรายการมา', 'copy_from');
                const res = await sql`
                    INSERT INTO it_risk_register_items (register_id, identified_date, category, asset_group, bia_service_id, threat, vulnerability, controls, cia, impact_areas,
                        likelihood, impact, owner, treatment, treatment_plan, progress_pct, due_date, residual_areas, residual_likelihood, residual_impact, status, follow_up,
                        copied_from, created_by, updated_by)
                    SELECT ${r.id}, identified_date, category, asset_group, bia_service_id, threat, vulnerability, controls, cia, impact_areas,
                        likelihood, impact, owner, treatment, treatment_plan, progress_pct, due_date, residual_areas, residual_likelihood, residual_impact, status, follow_up,
                        id, ${actor}, ${actor}
                    FROM it_risk_register_items WHERE register_id = ${copyFrom} AND status = 'open' ORDER BY identified_date, id`;
                copied = res.count;
                if (copied) await sql`INSERT INTO it_risk_register_log (register_id, action, after, changed_by) VALUES (${r.id}, 'copy', ${sql.json({ from_register: copyFrom, items: copied })}, ${actor})`;
            }
            return { id: r.id, copied };
        });
        return { success: true, data: out };
    } catch (e: any) { return handle(set, 'create register', e); }
};

export const updateRegister = async ({ params, body, user, set }: any) => {
    try {
        const h0 = readHeader(body);
        const actor = Number(user.id), id = Number(params.id);
        await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT period, recorder_id, recorder_name, recorder_role, to_char(meeting_date, 'YYYY-MM-DD') AS meeting_date, location, address, critical_service, notes FROM it_risk_registers WHERE id = ${id} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบทะเบียน');
            const h = await withRecorder(sql, h0, cur);
            if ((await sql`SELECT 1 FROM it_risk_registers WHERE period = ${h.period} AND id <> ${id}`).length) throw new Bad(409, 'รอบนี้มีทะเบียนอยู่แล้ว', 'period');
            await sql`UPDATE it_risk_registers SET ${sql({ ...h, updated_by: actor, updated_at: new Date() } as any)} WHERE id = ${id}`;
            await sql`INSERT INTO it_risk_register_log (register_id, action, before, after, changed_by) VALUES (${id}, 'update_register', ${sql.json({ ...cur })}, ${sql.json(h)}, ${actor})`;
        });
        return { success: true };
    } catch (e: any) { return handle(set, 'update register', e); }
};

const checkBia = async (sql: any, id: number | null) => {
    if (id && !(await sql`SELECT 1 FROM it_bia_services WHERE id = ${id}`).length) throw new Bad(400, 'ไม่พบบริการในทะเบียน BIA', 'bia_service_id');
};

export const createItem = async ({ params, body, user, set }: any) => {
    try {
        const it = readItem(body);
        const actor = Number(user.id), rid = Number(params.id);
        const id = await core_kon.begin(async (sql: any) => {
            if (!(await sql`SELECT 1 FROM it_risk_registers WHERE id = ${rid}`).length) throw new Bad(404, 'ไม่พบทะเบียน');
            await checkBia(sql, it.bia_service_id);
            const [r] = await sql`INSERT INTO it_risk_register_items ${sql({ ...it, register_id: rid, created_by: actor, updated_by: actor } as any)} RETURNING id`;
            await sql`INSERT INTO it_risk_register_log (register_id, item_id, action, after, changed_by) VALUES (${rid}, ${r.id}, 'create', ${sql.json(it)}, ${actor})`;
            return r.id;
        });
        return { success: true, data: { id } };
    } catch (e: any) { return handle(set, 'create item', e); }
};

const snapItem = (r: any) => {
    const out: Record<string, any> = {};
    for (const k of ['identified_date', 'category', 'asset_group', 'bia_service_id', 'threat', 'vulnerability', 'controls', 'cia', 'impact_areas', 'likelihood', 'impact', 'owner',
        'treatment', 'treatment_plan', 'progress_pct', 'due_date', 'residual_areas', 'residual_likelihood', 'residual_impact', 'status', 'follow_up']) out[k] = r[k];
    return out;
};
const ITEM_RAW = core_kon`*, to_char(identified_date, 'YYYY-MM-DD') AS identified_date, to_char(due_date, 'YYYY-MM-DD') AS due_date`;

export const updateItem = async ({ params, body, user, set }: any) => {
    try {
        const it = readItem(body);
        const actor = Number(user.id), id = Number(params.itemId);
        const changed = await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT ${ITEM_RAW} FROM it_risk_register_items WHERE id = ${id} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบรายการความเสี่ยง');
            await checkBia(sql, it.bia_service_id);
            const before = snapItem(cur);
            if (JSON.stringify(before) === JSON.stringify(it)) return false;
            await sql`UPDATE it_risk_register_items SET ${sql({ ...it, updated_by: actor, updated_at: new Date() } as any)} WHERE id = ${id}`;
            await sql`INSERT INTO it_risk_register_log (register_id, item_id, action, before, after, changed_by) VALUES (${cur.register_id}, ${id}, 'update', ${sql.json(before)}, ${sql.json(it)}, ${actor})`;
            return true;
        });
        return { success: true, data: { changed } };
    } catch (e: any) { return handle(set, 'update item', e); }
};

// ลบรายการ (บันทึกผิด) — รายการของรอบถัดไปที่ยกมาจากรายการนี้ยังอยู่ (ตัดการอ้างอิงออก)
export const deleteItem = async ({ params, user, set }: any) => {
    try {
        const actor = Number(user.id), id = Number(params.itemId);
        await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT ${ITEM_RAW} FROM it_risk_register_items WHERE id = ${id} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบรายการความเสี่ยง');
            await sql`UPDATE it_risk_register_items SET copied_from = NULL WHERE copied_from = ${id}`;
            await sql`DELETE FROM it_risk_register_items WHERE id = ${id}`;
            await sql`INSERT INTO it_risk_register_log (register_id, item_id, action, before, changed_by) VALUES (${cur.register_id}, ${id}, 'delete', ${sql.json(snapItem(cur))}, ${actor})`;
        });
        return { success: true };
    } catch (e: any) { return handle(set, 'delete item', e); }
};

export const getRegisterLog = async ({ params, set }: any) => {
    try {
        const rows = await core_kon`
            SELECT l.id, l.item_id, l.action, l.changed_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS changed_by_name,
                   COALESCE(l.after->>'threat', l.before->>'threat') AS threat
            FROM it_risk_register_log l LEFT JOIN users u ON u.id = l.changed_by
            WHERE l.register_id = ${Number(params.id)} ORDER BY l.changed_at DESC, l.id DESC LIMIT 200`;
        return { success: true, data: rows };
    } catch (e: any) { return handle(set, 'log', e); }
};
