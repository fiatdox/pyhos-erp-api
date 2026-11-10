// เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — ตั้งค่าค่าพาหนะ · ตาราง src/db/hrd_travel_transport.sql
//   พาหนะส่วนตัว: อัตราค่าน้ำมันบาท/กม. แยกประเภทรถ
//   รถโดยสารประจำทาง / เครื่องบิน: เพดานราคาต่อเที่ยวตามเส้นทาง (ใช้ได้ทั้งไปและกลับ)
// อ่าน: ผู้ใช้ที่ล็อกอินทุกคน (แบบฟอร์มขอไปราชการต้องใช้เพดานราคา) · แก้ไข: ADMIN / HRD
import { core_kon } from '../db/db';
import { canManage, guard } from './hrdTravelController';

const MODES = ['bus', 'plane'] as const;
type Mode = typeof MODES[number];
const MODE_LABEL: Record<Mode, string> = { bus: 'รถโดยสารประจำทาง', plane: 'เครื่องบิน' };
const MAX_RATE = 100, MAX_FARE = 100000;

const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, ...(field ? { field } : {}) }; };
class Bad extends Error { constructor(public status: number, message: string, public field?: string) { super(message); } }

const vehicleCols = (s: any) => s`v.id, v.code, v.name, v.rate_per_km::float8 AS rate_per_km, v.updated_at,
    CASE WHEN v.updated_by IS NULL THEN NULL ELSE CONCAT(u.pname, u.fname, ' ', u.lname) END AS updated_by_name`;
const routeCols = (s: any) => s`r.id, r.mode, r.origin, r.destination, r.max_fare, r.note, r.updated_at,
    CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name`;
const snapRoute = (r: any) => ({ mode: r.mode, origin: r.origin, destination: r.destination, max_fare: r.max_fare, note: r.note });
const log = (s: any, entity: 'vehicle' | 'route', id: number, action: string, before: any, after: any, actor: number) =>
    s`INSERT INTO hrd_travel_transport_log (entity, entity_id, action, before, after, changed_by)
      VALUES (${entity}, ${id}, ${action}, ${before ? s.json(before) : null}, ${after ? s.json(after) : null}, ${actor})`;

export const getTransport = async ({ user, set }: any) => {
    try {
        const [vehicles, routes, editable] = await Promise.all([
            core_kon`SELECT ${vehicleCols(core_kon)} FROM hrd_travel_vehicle_rates v LEFT JOIN users u ON u.id = v.updated_by ORDER BY v.sort_order, v.id`,
            core_kon`SELECT ${routeCols(core_kon)} FROM hrd_travel_routes r LEFT JOIN users u ON u.id = r.updated_by
                     WHERE r.is_active ORDER BY r.mode, r.origin, r.destination`,
            canManage(Number(user?.id)),
        ]);
        return { success: true, data: { vehicles, routes, can_edit: editable, limits: { max_rate: MAX_RATE, max_fare: MAX_FARE } } };
    } catch (e: any) {
        console.error('[hrdTransport] get:', e?.message);
        return fail(set, 500, 'โหลดการตั้งค่าการเดินทางไม่สำเร็จ');
    }
};

// แก้อัตราค่าน้ำมัน: body { rate_per_km, name? }
export const updateVehicleRate = async ({ params, body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const rate = Number(body?.rate_per_km);
        if (!Number.isFinite(rate) || rate <= 0 || rate > MAX_RATE || Math.abs(Math.round(rate * 100) - rate * 100) > 1e-6)
            return fail(set, 400, `อัตราต้องมากกว่า 0 ไม่เกิน ${MAX_RATE} บาท/กม. ทศนิยมไม่เกิน 2 ตำแหน่ง`, 'rate_per_km');
        const nameIn = body?.name === undefined ? null : String(body.name).trim();
        if (nameIn !== null && (nameIn.length === 0 || nameIn.length > 100)) return fail(set, 400, 'ชื่อประเภทรถต้องมี 1–100 ตัวอักษร', 'name');
        const actor = Number(user.id);
        const changed = await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT id, name, rate_per_km::float8 AS rate_per_km FROM hrd_travel_vehicle_rates WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบประเภทรถ');
            const name = nameIn ?? cur.name;
            if (name !== cur.name && (await sql`SELECT 1 FROM hrd_travel_vehicle_rates WHERE name = ${name} AND id <> ${cur.id}`).length)
                throw new Bad(409, `มีประเภทรถชื่อ "${name}" อยู่แล้ว`, 'name');
            if (cur.rate_per_km === rate && cur.name === name) return false;
            await sql`UPDATE hrd_travel_vehicle_rates SET rate_per_km = ${rate}, name = ${name}, updated_by = ${actor}, updated_at = NOW() WHERE id = ${cur.id}`;
            await log(sql, 'vehicle', cur.id, 'update', { name: cur.name, rate_per_km: cur.rate_per_km }, { name, rate_per_km: rate }, actor);
            return true;
        });
        return { success: true, data: { changed } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdTransport] vehicle:', e?.message);
        return fail(set, 500, 'บันทึกอัตราไม่สำเร็จ');
    }
};

const readRoute = (body: any) => {
    const mode = String(body?.mode ?? '') as Mode;
    if (!MODES.includes(mode)) throw new Bad(400, 'ประเภทการเดินทางไม่ถูกต้อง', 'mode');
    const origin = String(body?.origin ?? '').trim().replace(/\s+/g, ' ');
    const destination = String(body?.destination ?? '').trim().replace(/\s+/g, ' ');
    if (!origin || origin.length > 100) throw new Bad(400, 'กรุณาระบุต้นทาง (ไม่เกิน 100 ตัวอักษร)', 'origin');
    if (!destination || destination.length > 100) throw new Bad(400, 'กรุณาระบุปลายทาง (ไม่เกิน 100 ตัวอักษร)', 'destination');
    if (origin === destination) throw new Bad(400, 'ต้นทางและปลายทางต้องไม่ซ้ำกัน', 'destination');
    const fare = Number(body?.max_fare);
    if (!Number.isInteger(fare) || fare <= 0 || fare > MAX_FARE) throw new Bad(400, `ราคาต้องเป็นจำนวนเต็มบาท 1–${MAX_FARE.toLocaleString('en-US')}`, 'max_fare');
    const note = body?.note == null ? null : String(body.note).trim() || null;
    if (note && note.length > 200) throw new Bad(400, 'หมายเหตุไม่เกิน 200 ตัวอักษร', 'note');
    return { mode, origin, destination, max_fare: fare, note };
};
// เส้นทางซ้ำ (ไม่ว่าทิศไหน) ในประเภทเดียวกัน
const assertNoDup = async (s: any, r: { mode: Mode; origin: string; destination: string }, exceptId: number | null) => {
    const [dup] = await s`SELECT origin, destination FROM hrd_travel_routes
        WHERE is_active AND mode = ${r.mode} AND ${exceptId ? s`id <> ${exceptId}` : s`TRUE`}
          AND LEAST(origin, destination) = LEAST(${r.origin}::text, ${r.destination}::text)
          AND GREATEST(origin, destination) = GREATEST(${r.origin}::text, ${r.destination}::text)`;
    if (dup) throw new Bad(409, `มีเส้นทาง${MODE_LABEL[r.mode]} ${dup.origin} ⇄ ${dup.destination} อยู่แล้ว`, 'destination');
};

export const createRoute = async ({ body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const r = readRoute(body);
        const actor = Number(user.id);
        const id = await core_kon.begin(async (sql: any) => {
            await sql`SELECT pg_advisory_xact_lock(hashtext('hrd_travel_routes'))`;
            await assertNoDup(sql, r, null);
            const [row] = await sql`INSERT INTO hrd_travel_routes (mode, origin, destination, max_fare, note, created_by, updated_by)
                VALUES (${r.mode}, ${r.origin}, ${r.destination}, ${r.max_fare}, ${r.note}, ${actor}, ${actor}) RETURNING id`;
            await log(sql, 'route', row.id, 'create', null, r, actor);
            return row.id;
        });
        return { success: true, data: { id } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdTransport] createRoute:', e?.message);
        return fail(set, 500, 'เพิ่มเส้นทางไม่สำเร็จ');
    }
};

export const updateRoute = async ({ params, body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const r = readRoute(body);
        const actor = Number(user.id);
        const changed = await core_kon.begin(async (sql: any) => {
            await sql`SELECT pg_advisory_xact_lock(hashtext('hrd_travel_routes'))`;
            const [cur] = await sql`SELECT * FROM hrd_travel_routes WHERE id = ${Number(params.id)} AND is_active FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบเส้นทาง');
            if (cur.mode !== r.mode) throw new Bad(400, 'เปลี่ยนประเภทการเดินทางของเส้นทางไม่ได้ ให้ลบแล้วเพิ่มใหม่', 'mode');
            await assertNoDup(sql, r, cur.id);
            const before = snapRoute(cur);
            if (JSON.stringify(before) === JSON.stringify(r)) return false;
            await sql`UPDATE hrd_travel_routes SET origin = ${r.origin}, destination = ${r.destination}, max_fare = ${r.max_fare}, note = ${r.note},
                      updated_by = ${actor}, updated_at = NOW() WHERE id = ${cur.id}`;
            await log(sql, 'route', cur.id, 'update', before, r, actor);
            return true;
        });
        return { success: true, data: { changed } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdTransport] updateRoute:', e?.message);
        return fail(set, 500, 'บันทึกเส้นทางไม่สำเร็จ');
    }
};

// ลบ = ปิดใช้งาน ข้อมูลยังอยู่ให้คำขอเก่าอ้างอิง
export const deleteRoute = async ({ params, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const actor = Number(user.id);
        await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT * FROM hrd_travel_routes WHERE id = ${Number(params.id)} AND is_active FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบเส้นทาง');
            await sql`UPDATE hrd_travel_routes SET is_active = FALSE, updated_by = ${actor}, updated_at = NOW() WHERE id = ${cur.id}`;
            await log(sql, 'route', cur.id, 'delete', snapRoute(cur), null, actor);
        });
        return { success: true, data: { deleted: true } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message);
        console.error('[hrdTransport] deleteRoute:', e?.message);
        return fail(set, 500, 'ลบเส้นทางไม่สำเร็จ');
    }
};

// ประวัติ: ?entity=vehicle|route&id= (ไม่ส่ง id = ทั้งหมดของ entity นั้น ล่าสุด 200 รายการ)
export const getTransportLog = async ({ query, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const entity = query?.entity === 'vehicle' ? 'vehicle' : 'route';
        const id = Number(query?.id) || null;
        const mode = MODES.includes(query?.mode) ? query.mode : null;
        const rows = await core_kon`
            SELECT l.id, l.entity_id, l.action, l.before, l.after, l.changed_at, CONCAT(c.pname, c.fname, ' ', c.lname) AS changed_by_name
            FROM hrd_travel_transport_log l LEFT JOIN users c ON c.id = l.changed_by
            WHERE l.entity = ${entity} ${id ? core_kon`AND l.entity_id = ${id}` : core_kon``}
              ${mode ? core_kon`AND COALESCE(l.after->>'mode', l.before->>'mode') = ${mode}` : core_kon``}
            ORDER BY l.changed_at DESC, l.id DESC LIMIT 200`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[hrdTransport] log:', e?.message);
        return fail(set, 500, 'โหลดประวัติไม่สำเร็จ');
    }
};
