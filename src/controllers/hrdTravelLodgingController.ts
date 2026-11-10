// เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — ตั้งค่าค่าเช่าที่พัก · ตาราง src/db/hrd_travel_lodging.sql
//   ระดับสิทธิ์ (class): เพดานเหมาจ่าย / ห้องเดี่ยว / ห้องคู่ ต่อคนต่อคืน + สิทธิ์ชั้นโดยสารเครื่องบิน — แก้ราคาได้
//   ระดับของบุคลากร = กำหนดรายคน → ตามระดับตำแหน่ง (user_levels) → ระดับค่าเริ่มต้น
// สิทธิ์: ADMIN / HRD ทั้งอ่านและแก้ (แบบฟอร์มขอไปราชการได้อัตรารายคนจาก /requests/meta และ /requests/people)
import { core_kon } from '../db/db';
import { guard } from './hrdTravelController';

const MAX_RATE = 20000;
const FLIGHT = ['business', 'economy'] as const;

const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, ...(field ? { field } : {}) }; };
class Bad extends Error { constructor(public status: number, message: string, public field?: string) { super(message); } }

const working = (s: any = core_kon) => s`u.is_active = 'Y' AND COALESCE(u.user_status_id, 1) = 1
    AND (u.work_end_date IS NULL OR u.work_end_date >= CURRENT_DATE)`;
const nameOf = (s: any = core_kon) => s`TRIM(CONCAT(u.pname, u.fname, ' ', u.lname))`;

/** join ระดับสิทธิ์ที่พักของบุคลากร (alias u) → lc = ระดับที่ใช้ · lp/ll = ที่มา (รายคน / ระดับตำแหน่ง) */
export const lodgingJoin = (s: any = core_kon) => s`
    LEFT JOIN hrd_travel_lodging_people lp ON lp.user_id = u.id
    LEFT JOIN hrd_travel_lodging_levels ll ON ll.user_level_id = u.user_level_id
    JOIN hrd_travel_lodging_classes lc ON lc.id = COALESCE(lp.class_id, ll.class_id, (SELECT id FROM hrd_travel_lodging_classes WHERE is_default))`;
/** คอลัมน์ระดับสิทธิ์ที่พัก (ใช้คู่กับ lodgingJoin) */
export const lodgingCols = (s: any = core_kon) => s`lc.id AS lodging_class_id, lc.name AS lodging_class_name, lc.lump_sum, lc.single_room, lc.double_room, lc.flight_class,
    CASE WHEN lp.user_id IS NOT NULL THEN 'person' WHEN ll.user_level_id IS NOT NULL THEN 'level' ELSE 'default' END AS lodging_source`;

const log = (s: any, entity: 'class' | 'level' | 'person', id: number, action: string, before: any, after: any, actor: number) =>
    s`INSERT INTO hrd_travel_lodging_log (entity, entity_id, action, before, after, changed_by)
      VALUES (${entity}, ${id}, ${action}, ${before ? s.json(before) : null}, ${after ? s.json(after) : null}, ${actor})`;

const rateIn = (v: unknown, field: string, label: string) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || n > MAX_RATE) throw new Bad(400, `${label}ต้องเป็นจำนวนเต็มบาท 1–${MAX_RATE.toLocaleString('en-US')}`, field);
    return n;
};
const classExists = async (s: any, id: unknown) => {
    const n = Number(id);
    const [c] = Number.isInteger(n) && n > 0 ? await s`SELECT id, name FROM hrd_travel_lodging_classes WHERE id = ${n}` : [];
    if (!c) throw new Bad(400, 'ไม่พบระดับสิทธิ์ที่พักที่เลือก', 'class_id');
    return c;
};

export const getLodging = async ({ user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const [classes, levels, [{ no_level }], people] = await Promise.all([
            // จำนวนบุคลากรที่ปฏิบัติงานในแต่ละระดับ (คิดตามลำดับ รายคน → ระดับตำแหน่ง → ค่าเริ่มต้น)
            core_kon`
                SELECT c.id, c.code, c.name, c.lump_sum, c.single_room, c.double_room, c.flight_class, c.is_default, c.updated_at,
                       CASE WHEN c.updated_by IS NULL THEN NULL ELSE CONCAT(ub.pname, ub.fname, ' ', ub.lname) END AS updated_by_name,
                       (SELECT count(*)::int FROM users u ${lodgingJoin()} WHERE ${working()} AND lc.id = c.id) AS people
                FROM hrd_travel_lodging_classes c LEFT JOIN users ub ON ub.id = c.updated_by
                ORDER BY c.sort_order, c.id`,
            // ระดับตำแหน่งที่มีคนปฏิบัติงานอยู่ หรือจับคู่ไว้แล้ว
            core_kon`
                SELECT l.user_level_id AS id, l.level_name AS name, ll.class_id, ll.updated_at,
                       (SELECT count(*)::int FROM users u WHERE u.user_level_id = l.user_level_id AND ${working()}) AS people,
                       (SELECT count(*)::int FROM users u JOIN hrd_travel_lodging_people p ON p.user_id = u.id WHERE u.user_level_id = l.user_level_id AND ${working()}) AS overridden
                FROM user_levels l LEFT JOIN hrd_travel_lodging_levels ll ON ll.user_level_id = l.user_level_id
                WHERE ll.user_level_id IS NOT NULL OR EXISTS (SELECT 1 FROM users u WHERE u.user_level_id = l.user_level_id AND ${working()})
                ORDER BY l.user_level_id`,
            core_kon`SELECT count(*)::int AS no_level FROM users u WHERE ${working()} AND u.user_level_id IS NULL`,
            core_kon`
                SELECT p.user_id, ${nameOf()} AS name, up.position_name AS position, ul.level_name, mj.name AS unit, p.class_id, p.note, p.updated_at,
                       ${working()} AS working, CONCAT(ub.pname, ub.fname, ' ', ub.lname) AS updated_by_name
                FROM hrd_travel_lodging_people p
                JOIN users u ON u.id = p.user_id
                LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
                LEFT JOIN user_levels ul ON ul.user_level_id = u.user_level_id
                LEFT JOIN majors mj ON mj.major_id = u.major_id
                LEFT JOIN users ub ON ub.id = p.updated_by
                ORDER BY u.fname, u.lname`,
        ]);
        return { success: true, data: { classes, levels, no_level, people, limits: { max_rate: MAX_RATE } } };
    } catch (e: any) {
        console.error('[hrdLodging] get:', e?.message);
        return fail(set, 500, 'โหลดการตั้งค่าค่าที่พักไม่สำเร็จ');
    }
};

// แก้ระดับสิทธิ์: body { name, lump_sum, single_room, double_room, flight_class } — มีผลกับคำขอใหม่ทันที (คำขอเดิมเก็บอัตราไว้แล้ว)
export const updateLodgingClass = async ({ params, body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ');
        if (!name || name.length > 150) return fail(set, 400, 'ชื่อระดับต้องมี 1–150 ตัวอักษร', 'name');
        const next = {
            name,
            lump_sum: rateIn(body?.lump_sum, 'lump_sum', 'อัตราเหมาจ่าย'),
            single_room: rateIn(body?.single_room, 'single_room', 'อัตราห้องพักเดี่ยว'),
            double_room: rateIn(body?.double_room, 'double_room', 'อัตราห้องพักคู่'),
            flight_class: FLIGHT.includes(body?.flight_class) ? body.flight_class as string : null,
        };
        if (!next.flight_class) return fail(set, 400, 'เลือกสิทธิ์ชั้นโดยสารเครื่องบิน', 'flight_class');
        const actor = Number(user.id);
        const changed = await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT id, name, lump_sum, single_room, double_room, flight_class FROM hrd_travel_lodging_classes WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบระดับสิทธิ์ที่พัก');
            if (name !== cur.name && (await sql`SELECT 1 FROM hrd_travel_lodging_classes WHERE name = ${name} AND id <> ${cur.id}`).length)
                throw new Bad(409, `มีระดับชื่อ "${name}" อยู่แล้ว`, 'name');
            const before = { name: cur.name, lump_sum: cur.lump_sum, single_room: cur.single_room, double_room: cur.double_room, flight_class: cur.flight_class };
            if (JSON.stringify(before) === JSON.stringify(next)) return false;
            await sql`UPDATE hrd_travel_lodging_classes SET ${sql(next)}, updated_by = ${actor}, updated_at = NOW() WHERE id = ${cur.id}`;
            await log(sql, 'class', cur.id, 'update', before, next, actor);
            return true;
        });
        return { success: true, data: { changed } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdLodging] class:', e?.message);
        return fail(set, 500, 'บันทึกอัตราค่าที่พักไม่สำเร็จ');
    }
};

// จับคู่ระดับตำแหน่ง → ระดับสิทธิ์: body { class_id } · class_id = null = ใช้ระดับค่าเริ่มต้น
export const setLodgingLevel = async ({ params, body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const levelId = Number(params.id);
        const actor = Number(user.id);
        const changed = await core_kon.begin(async (sql: any) => {
            const [lvl] = await sql`SELECT l.user_level_id, l.level_name, ll.class_id FROM user_levels l
                LEFT JOIN hrd_travel_lodging_levels ll ON ll.user_level_id = l.user_level_id WHERE l.user_level_id = ${levelId} FOR UPDATE OF l`;
            if (!lvl) throw new Bad(404, 'ไม่พบระดับตำแหน่ง');
            const target = body?.class_id === null || body?.class_id === undefined ? null : (await classExists(sql, body.class_id)).id;
            if ((lvl.class_id ?? null) === target) return false;
            if (target === null) await sql`DELETE FROM hrd_travel_lodging_levels WHERE user_level_id = ${levelId}`;
            else await sql`INSERT INTO hrd_travel_lodging_levels (user_level_id, class_id, updated_by) VALUES (${levelId}, ${target}, ${actor})
                ON CONFLICT (user_level_id) DO UPDATE SET class_id = EXCLUDED.class_id, updated_by = EXCLUDED.updated_by, updated_at = NOW()`;
            await log(sql, 'level', levelId, lvl.class_id == null ? 'create' : target === null ? 'delete' : 'update',
                lvl.class_id == null ? null : { level: lvl.level_name, class_id: lvl.class_id }, target === null ? null : { level: lvl.level_name, class_id: target }, actor);
            return true;
        });
        return { success: true, data: { changed } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdLodging] level:', e?.message);
        return fail(set, 500, 'บันทึกการจับคู่ระดับไม่สำเร็จ');
    }
};

// กำหนดรายบุคคล: body { user_id, class_id, note? } — เพิ่มหรือเปลี่ยน
export const setLodgingPerson = async ({ body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const uid = Number(body?.user_id);
        if (!Number.isInteger(uid) || uid <= 0) return fail(set, 400, 'เลือกบุคลากร', 'user_id');
        const note = body?.note == null ? null : String(body.note).trim().replace(/\s+/g, ' ') || null;
        if (note && note.length > 200) return fail(set, 400, 'เหตุผลไม่เกิน 200 ตัวอักษร', 'note');
        const actor = Number(user.id);
        const changed = await core_kon.begin(async (sql: any) => {
            const [person] = await sql`SELECT u.id, ${nameOf(sql)} AS name FROM users u WHERE u.id = ${uid} AND ${working(sql)} FOR UPDATE OF u`;
            if (!person) throw new Bad(400, 'ไม่พบบุคลากรที่ปฏิบัติงานอยู่', 'user_id');
            const cls = await classExists(sql, body?.class_id);
            const [cur] = await sql`SELECT class_id, note FROM hrd_travel_lodging_people WHERE user_id = ${uid}`;
            if (cur && cur.class_id === cls.id && (cur.note ?? null) === note) return false;
            await sql`INSERT INTO hrd_travel_lodging_people (user_id, class_id, note, updated_by) VALUES (${uid}, ${cls.id}, ${note}, ${actor})
                ON CONFLICT (user_id) DO UPDATE SET class_id = EXCLUDED.class_id, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = NOW()`;
            await log(sql, 'person', uid, cur ? 'update' : 'create', cur ? { name: person.name, class_id: cur.class_id, note: cur.note } : null, { name: person.name, class_id: cls.id, note }, actor);
            return true;
        });
        return { success: true, data: { changed } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdLodging] person:', e?.message);
        return fail(set, 500, 'บันทึกระดับรายบุคคลไม่สำเร็จ');
    }
};

// เลิกกำหนดรายบุคคล → กลับไปใช้ตามระดับตำแหน่ง
export const deleteLodgingPerson = async ({ params, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const uid = Number(params.id);
        const actor = Number(user.id);
        await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT p.class_id, p.note, TRIM(CONCAT(u.pname, u.fname, ' ', u.lname)) AS name
                FROM hrd_travel_lodging_people p JOIN users u ON u.id = p.user_id WHERE p.user_id = ${uid} FOR UPDATE OF p`;
            if (!cur) throw new Bad(404, 'ไม่พบการกำหนดรายบุคคลนี้');
            await sql`DELETE FROM hrd_travel_lodging_people WHERE user_id = ${uid}`;
            await log(sql, 'person', uid, 'delete', { name: cur.name, class_id: cur.class_id, note: cur.note }, null, actor);
        });
        return { success: true, data: { deleted: true } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message);
        console.error('[hrdLodging] unperson:', e?.message);
        return fail(set, 500, 'ลบการกำหนดรายบุคคลไม่สำเร็จ');
    }
};

// ประวัติการแก้ไขทั้งหมด (ล่าสุด 200) · ?entity=class|level|person&id=
export const getLodgingLog = async ({ query, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const entity = ['class', 'level', 'person'].includes(query?.entity) ? query.entity : null;
        const id = Number(query?.id) || null;
        const rows = await core_kon`
            SELECT l.id, l.entity, l.entity_id, l.action, l.before, l.after, l.changed_at, CONCAT(c.pname, c.fname, ' ', c.lname) AS changed_by_name
            FROM hrd_travel_lodging_log l LEFT JOIN users c ON c.id = l.changed_by
            WHERE TRUE ${entity ? core_kon`AND l.entity = ${entity}` : core_kon``} ${entity && id ? core_kon`AND l.entity_id = ${id}` : core_kon``}
            ORDER BY l.changed_at DESC, l.id DESC LIMIT 200`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[hrdLodging] log:', e?.message);
        return fail(set, 500, 'โหลดประวัติไม่สำเร็จ');
    }
};
