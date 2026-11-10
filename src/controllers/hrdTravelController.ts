// เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — ตั้งค่าเบี้ยเลี้ยงบุคลากร
// สิทธิ์: ADMIN หรือ HRD · ตาราง src/db/hrd_travel_allowance.sql
//
// อัตราเบี้ยเลี้ยง (tier) เก็บราคาไว้ที่ตัวอัตรา แก้ราคาได้ — บุคลากรผูกกับอัตรา ไม่ได้ผูกกับตัวเลข
// ไม่มีแถวใน hrd_travel_allowance = อยู่อัตราค่าเริ่มต้น (is_default)
// แสดงเฉพาะบุคลากรสถานะปฏิบัติงาน (นิยามเดียวกับ hrLeaveNotifyController)
import { core_kon } from '../db/db';

export const ALLOWANCE_ROLES = ['ADMIN', 'HRD'];
const MAX_AMOUNT = 10000;

const fail = (set: any, status: number, message: string) => { set.status = status; return { success: false, message }; };
class Bad extends Error { constructor(public status: number, message: string) { super(message); } }

export const canManage = async (uid: number) => (await core_kon`
    SELECT 1 FROM core_kon.user_m_users_roles mu JOIN core_kon.user_roles r ON r.id = mu.role_id
    WHERE mu.user_id = ${uid} AND UPPER(r.role_name) IN ${core_kon(ALLOWANCE_ROLES)} LIMIT 1`).length > 0;

export const guard = async (user: any, set: any) =>
    (await canManage(Number(user?.id))) ? null : fail(set, 403, 'เฉพาะผู้ดูแลระบบหรือเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล (HRD)');

// บุคลากรที่ปฏิบัติงานอยู่ (alias u) — ส่ง sql ของ transaction มาเมื่อใช้ใน core_kon.begin
const working = (s: any = core_kon) => s`u.is_active = 'Y' AND COALESCE(u.user_status_id, 1) = 1
    AND (u.work_end_date IS NULL OR u.work_end_date >= CURRENT_DATE)`;

// อัตราของบุคลากร (alias u, a = hrd_travel_allowance) — ไม่มีแถว = อัตราค่าเริ่มต้น
const tierOf = (s: any = core_kon) => s`COALESCE(a.tier_id, (SELECT id FROM hrd_travel_allowance_tiers WHERE is_default))`;

const loadTiers = () => core_kon`
    SELECT t.id, t.code, t.name, t.amount, t.is_default, t.updated_at,
           CASE WHEN t.updated_by IS NULL THEN NULL ELSE CONCAT(u.pname, u.fname, ' ', u.lname) END AS updated_by_name
    FROM hrd_travel_allowance_tiers t LEFT JOIN users u ON u.id = t.updated_by
    ORDER BY t.sort_order, t.id`;

// ตัวกรองรายชื่อ — ใช้ชุดเดียวกันทั้งตอนแสดงและตอน "ตั้งทั้งหมดที่กรอง" จำนวนที่ผู้ใช้เห็นกับที่บันทึกจึงตรงกัน
interface Filters { search: string; tierId: number | null; missionId: number | null; majorId: number | null; submajorId: number | null; typeId: number | null; levelId: number | null }
const posInt = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const parseFilters = (q: any): Filters => ({
    search: String(q?.search ?? '').trim().slice(0, 100),
    tierId: posInt(q?.tier_id), missionId: posInt(q?.mission_id), majorId: posInt(q?.major_id),
    submajorId: posInt(q?.submajor_id), typeId: posInt(q?.user_type_id), levelId: posInt(q?.user_level_id),
});
// ต้อง join a = hrd_travel_allowance และ up = user_positions ไว้แล้ว
const whereOf = (s: any, f: Filters) => {
    const like = '%' + f.search + '%';
    return s`${working(s)}
        ${f.search ? s`AND (CONCAT(u.pname, u.fname, ' ', u.lname) ILIKE ${like} OR u.username ILIKE ${like} OR up.position_name ILIKE ${like})` : s``}
        ${f.missionId ? s`AND u.mission_id = ${f.missionId}` : s``}
        ${f.majorId ? s`AND u.major_id = ${f.majorId}` : s``}
        ${f.submajorId ? s`AND u.submajor_id = ${f.submajorId}` : s``}
        ${f.typeId ? s`AND u.user_type_id = ${f.typeId}` : s``}
        ${f.levelId ? s`AND u.user_level_id = ${f.levelId}` : s``}
        ${f.tierId ? s`AND ${tierOf(s)} = ${f.tierId}` : s``}`;
};
const fromOf = (s: any) => s`FROM users u
    LEFT JOIN hrd_travel_allowance a ON a.user_id = u.id
    LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id`;

export const getAllowanceMeta = async ({ user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        // ตัวเลือกตัวกรอง — เฉพาะที่มีบุคลากรปฏิบัติงานอยู่ · กลุ่มงาน/หน่วยงานมี parent ไว้กรองตามกันฝั่งหน้าเว็บ
        const [tiers, missions, majors, submajors, userTypes, userLevels] = await Promise.all([
            loadTiers(),
            core_kon`SELECT m.mission_id AS id, m.name FROM missions m
                WHERE EXISTS (SELECT 1 FROM users u WHERE u.mission_id = m.mission_id AND ${working()}) ORDER BY m.name`,
            core_kon`SELECT m.major_id AS id, m.name, m.mission_id FROM majors m
                WHERE EXISTS (SELECT 1 FROM users u WHERE u.major_id = m.major_id AND ${working()}) ORDER BY m.name`,
            core_kon`SELECT s.submajor_id AS id, s.name, s.major_id FROM submajors s
                WHERE EXISTS (SELECT 1 FROM users u WHERE u.submajor_id = s.submajor_id AND ${working()}) ORDER BY s.name`,
            core_kon`SELECT t.user_type_id AS id, t.type_name AS name FROM user_types t
                WHERE EXISTS (SELECT 1 FROM users u WHERE u.user_type_id = t.user_type_id AND ${working()}) ORDER BY t.user_type_id`,
            core_kon`SELECT l.user_level_id AS id, l.level_name AS name FROM user_levels l
                WHERE EXISTS (SELECT 1 FROM users u WHERE u.user_level_id = l.user_level_id AND ${working()}) ORDER BY l.user_level_id`,
        ]);
        return { success: true, data: { tiers, missions, majors, submajors, user_types: userTypes, user_levels: userLevels, max_amount: MAX_AMOUNT } };
    } catch (e: any) {
        console.error('[hrdTravel] meta:', e?.message);
        return fail(set, 500, 'โหลดข้อมูลไม่สำเร็จ');
    }
};

export const getAllowances = async ({ query, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const f = parseFilters(query);
        const limit = Math.min(Math.max(Number(query?.limit) || 50, 1), 200);
        const offset = Math.max(Number(query?.offset) || 0, 0);
        const where = whereOf(core_kon, f);
        const from = fromOf(core_kon);

        const [rows, [{ total }], stats] = await Promise.all([
            core_kon`
                SELECT u.id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, up.position_name,
                       ms.name AS mission_name, mj.name AS major_name, sm.name AS submajor_name,
                       ut.type_name AS user_type_name, ul.level_name AS user_level_name,
                       t.id AS tier_id, t.amount, (a.user_id IS NULL) AS is_default,
                       a.updated_at, CASE WHEN a.updated_by IS NULL THEN NULL ELSE CONCAT(ub.pname, ub.fname, ' ', ub.lname) END AS updated_by_name
                ${from}
                JOIN hrd_travel_allowance_tiers t ON t.id = ${tierOf()}
                LEFT JOIN missions ms ON ms.mission_id = u.mission_id
                LEFT JOIN majors mj ON mj.major_id = u.major_id
                LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
                LEFT JOIN user_types ut ON ut.user_type_id = u.user_type_id
                LEFT JOIN user_levels ul ON ul.user_level_id = u.user_level_id
                LEFT JOIN users ub ON ub.id = a.updated_by
                WHERE ${where}
                ORDER BY t.is_default, t.sort_order, u.fname, u.lname, u.id
                LIMIT ${limit} OFFSET ${offset}`,
            core_kon`SELECT count(*)::int AS total ${from} WHERE ${where}`,
            core_kon`
                SELECT t.id AS tier_id, count(u.id)::int AS count
                FROM hrd_travel_allowance_tiers t
                LEFT JOIN (users u LEFT JOIN hrd_travel_allowance a ON a.user_id = u.id)
                       ON ${tierOf()} = t.id AND ${working()}
                GROUP BY t.id, t.sort_order ORDER BY t.sort_order, t.id`,
        ]);
        const working_total = stats.reduce((n: number, s: any) => n + s.count, 0);
        return { success: true, data: { rows, total, limit, offset, stats: { total: working_total, by_tier: stats } } };
    } catch (e: any) {
        console.error('[hrdTravel] list:', e?.message);
        return fail(set, 500, 'โหลดรายชื่อไม่สำเร็จ');
    }
};

// ย้ายอัตรา: body { tier_id, user_ids: number[] } (เลือกเอง ≤ 500 คน)
//          หรือ body { tier_id, filter: {...ตัวกรองเดียวกับหน้ารายชื่อ}, expected_total } (ทั้งหมดที่กรอง)
// expected_total = จำนวนที่ผู้ใช้เห็นตอนยืนยัน ถ้าข้อมูลเปลี่ยนระหว่างนั้นจะไม่บันทึก
export const setAllowances = async ({ body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const tierId = Number(body?.tier_id);
        const byFilter = body?.filter && typeof body.filter === 'object' && !Array.isArray(body?.user_ids);
        const ids = byFilter ? [] : [...new Set<number>((Array.isArray(body?.user_ids) ? body.user_ids : []).map(Number))].filter(n => Number.isInteger(n) && n > 0);
        if (!byFilter && ids.length === 0) return fail(set, 400, 'ยังไม่ได้เลือกบุคลากร');
        if (!byFilter && ids.length > 500) return fail(set, 400, 'เลือกได้ครั้งละไม่เกิน 500 คน ใช้ "ตั้งทั้งหมดที่กรอง" แทน');
        const expected = byFilter ? Number(body?.expected_total) : null;
        if (byFilter && !(Number.isInteger(expected) && expected! > 0)) return fail(set, 400, 'ไม่มีจำนวนที่ยืนยัน');
        const actor = Number(user.id);

        const result = await core_kon.begin(async (sql: any) => {
            const [tier] = Number.isInteger(tierId) && tierId > 0 ? await sql`SELECT id, amount FROM hrd_travel_allowance_tiers WHERE id = ${tierId}` : [];
            if (!tier) throw new Bad(400, 'ไม่พบอัตราเบี้ยเลี้ยงที่เลือก');
            const people = byFilter
                ? await sql`
                    SELECT u.id, t.id AS old_tier_id, t.amount AS old_amount
                    ${fromOf(sql)} JOIN hrd_travel_allowance_tiers t ON t.id = ${tierOf(sql)}
                    WHERE ${whereOf(sql, parseFilters(body.filter))}
                    FOR UPDATE OF u`
                : await sql`
                    SELECT u.id, t.id AS old_tier_id, t.amount AS old_amount
                    FROM users u LEFT JOIN hrd_travel_allowance a ON a.user_id = u.id
                    JOIN hrd_travel_allowance_tiers t ON t.id = ${tierOf(sql)}
                    WHERE u.id IN ${sql(ids)} AND ${working(sql)}
                    FOR UPDATE OF u`;
            if (byFilter && people.length !== expected) throw new Bad(409, `รายชื่อที่กรองเปลี่ยนไปเป็น ${people.length} คน กรุณาตรวจแล้วยืนยันใหม่`);
            if (!byFilter && people.length !== ids.length) throw new Bad(400, 'มีบุคลากรที่ไม่ได้อยู่ในสถานะปฏิบัติงาน ตั้งค่าไม่ได้');
            const todo = people.filter((p: any) => p.old_tier_id !== tier.id);
            if (todo.length > 0) {
                await sql`
                    INSERT INTO hrd_travel_allowance ${sql(todo.map((p: any) => ({ user_id: p.id, tier_id: tier.id, updated_by: actor })))}
                    ON CONFLICT (user_id) DO UPDATE SET tier_id = EXCLUDED.tier_id, updated_by = EXCLUDED.updated_by, updated_at = NOW()`;
                await sql`
                    INSERT INTO hrd_travel_allowance_log ${sql(todo.map((p: any) => ({
                        user_id: p.id, old_tier_id: p.old_tier_id, new_tier_id: tier.id, old_amount: p.old_amount, new_amount: tier.amount, changed_by: actor,
                    })))}`;
            }
            return { changed: todo.length, unchanged: people.length - todo.length, tier_id: tier.id, amount: tier.amount };
        });
        return { success: true, data: result };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message);
        console.error('[hrdTravel] set:', e?.message);
        return fail(set, 500, 'บันทึกอัตราเบี้ยเลี้ยงไม่สำเร็จ');
    }
};

// แก้ชื่อ/ราคาของอัตรา: body { amount, name? } — มีผลกับทุกคนในอัตรานี้ทันที
export const updateAllowanceTier = async ({ params, body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const id = Number(params.id);
        const amount = Number(body?.amount);
        if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return fail(set, 400, `ราคาต้องเป็นจำนวนเต็มบาท 1–${MAX_AMOUNT.toLocaleString('en-US')}`);
        const nameIn = body?.name === undefined ? null : String(body.name).trim();
        if (nameIn !== null && (nameIn.length === 0 || nameIn.length > 100)) return fail(set, 400, 'ชื่ออัตราต้องมี 1–100 ตัวอักษร');
        const actor = Number(user.id);

        const result = await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT id, name, amount FROM hrd_travel_allowance_tiers WHERE id = ${id} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบอัตราเบี้ยเลี้ยง');
            const name = nameIn ?? cur.name;
            const [dup] = await sql`SELECT name FROM hrd_travel_allowance_tiers WHERE id <> ${id} AND (amount = ${amount} OR name = ${name}) LIMIT 1`;
            if (dup) throw new Bad(409, dup.name === name ? `มีอัตราชื่อ "${name}" อยู่แล้ว` : `ราคา ${amount} บาทซ้ำกับ${dup.name}`);
            if (cur.amount === amount && cur.name === name) return { changed: false };
            await sql`UPDATE hrd_travel_allowance_tiers SET amount = ${amount}, name = ${name}, updated_by = ${actor}, updated_at = NOW() WHERE id = ${id}`;
            await sql`INSERT INTO hrd_travel_allowance_tier_log (tier_id, old_name, new_name, old_amount, new_amount, changed_by)
                      VALUES (${id}, ${cur.name}, ${name}, ${cur.amount}, ${amount}, ${actor})`;
            return { changed: true };
        });
        return { success: true, data: { ...result, tiers: await loadTiers() } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message);
        console.error('[hrdTravel] tier:', e?.message);
        return fail(set, 500, 'บันทึกราคาไม่สำเร็จ');
    }
};

// ประวัติการแก้ราคาของอัตราหนึ่ง
export const getAllowanceTierLog = async ({ params, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const rows = await core_kon`
            SELECT l.id, l.old_name, l.new_name, l.old_amount, l.new_amount, l.changed_at, CONCAT(c.pname, c.fname, ' ', c.lname) AS changed_by_name
            FROM hrd_travel_allowance_tier_log l LEFT JOIN users c ON c.id = l.changed_by
            WHERE l.tier_id = ${Number(params.id)}
            ORDER BY l.changed_at DESC, l.id DESC LIMIT 100`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[hrdTravel] tierLog:', e?.message);
        return fail(set, 500, 'โหลดประวัติไม่สำเร็จ');
    }
};

// ประวัติการย้ายอัตราของบุคลากรหนึ่งคน
export const getAllowanceLog = async ({ params, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const rows = await core_kon`
            SELECT l.id, ot.name AS old_tier_name, nt.name AS new_tier_name, l.old_amount, l.new_amount, l.changed_at,
                   CONCAT(c.pname, c.fname, ' ', c.lname) AS changed_by_name
            FROM hrd_travel_allowance_log l
            JOIN hrd_travel_allowance_tiers ot ON ot.id = l.old_tier_id
            JOIN hrd_travel_allowance_tiers nt ON nt.id = l.new_tier_id
            LEFT JOIN users c ON c.id = l.changed_by
            WHERE l.user_id = ${Number(params.id)}
            ORDER BY l.changed_at DESC, l.id DESC LIMIT 100`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[hrdTravel] log:', e?.message);
        return fail(set, 500, 'โหลดประวัติไม่สำเร็จ');
    }
};
