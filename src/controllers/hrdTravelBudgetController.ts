// เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — งบประมาณ + dashboard · ตาราง src/db/hrd_travel_requests.sql
// ตัวเลขจริงของงบ: spent = ยอดที่การเงินยืนยันแล้ว (actual_amount) · remaining = วงเงิน − spent
// pending = ประมาณการของคำขอที่ยังไม่ยืนยัน (แสดงประกอบเท่านั้น ไม่ตัดงบ) · projected = remaining − pending
// นับเฉพาะคำขอที่ไม่ยกเลิก · สิทธิ์: ADMIN / HRD ทั้งหมด
import { core_kon } from '../db/db';
import { guard } from './hrdTravelController';
import { ALLOWANCE_SQL } from './hrdTravelRequestController';

const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, ...(field ? { field } : {}) }; };
class Bad extends Error { constructor(public status: number, message: string, public field?: string) { super(message); } }
// ประเภทงบอยู่ในตาราง hrd_travel_budget_types (src/db/hrd_travel_budget_types.sql) — ADMIN/HRD เพิ่มเองได้
const TYPE_CODE_RE = /^[a-z0-9]{1,10}$/;
const MAX_AMOUNT = 1_000_000_000;

/** ปีงบประมาณ พ.ศ. ของวันนี้ (ต.ค. ขึ้นปีงบใหม่) */
export const currentFiscalYear = (d = new Date()) => {
    const th = new Date(d.getTime() + 7 * 3600 * 1000);
    return th.getUTCFullYear() + 543 + (th.getUTCMonth() >= 9 ? 1 : 0);
};

const readBudget = (body: any) => {
    const fy = Number(body?.fiscal_year);
    if (!Number.isInteger(fy) || fy < 2500 || fy > 2700) throw new Bad(400, 'ปีงบประมาณ (พ.ศ.) ไม่ถูกต้อง', 'fiscal_year');
    const type = String(body?.budget_type ?? '');
    if (!TYPE_CODE_RE.test(type)) throw new Bad(400, 'กรุณาเลือกประเภทงบ', 'budget_type');
    const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 200) throw new Bad(400, 'กรุณาระบุชื่องบ (ไม่เกิน 200 ตัวอักษร)', 'name');
    const amount = Number(body?.amount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT || Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6)
        throw new Bad(400, 'วงเงินต้องมากกว่า 0 ทศนิยมไม่เกิน 2 ตำแหน่ง', 'amount');
    const note = body?.note == null ? null : String(body.note).trim() || null;
    if (note && note.length > 300) throw new Bad(400, 'หมายเหตุไม่เกิน 300 ตัวอักษร', 'note');
    const isActive = body?.is_active === undefined ? true : !!body.is_active;
    return { fiscal_year: fy, budget_type: type, name, amount, note, is_active: isActive };
};
/** ประเภทต้องมีอยู่ · ประเภทที่ปิดใช้แล้วเลือกใหม่ไม่ได้ (งบเดิมที่เป็นประเภทนั้นอยู่แล้วแก้อย่างอื่นได้) */
const checkType = async (sql: any, code: string, keep: string | null) => {
    const [t] = await sql`SELECT is_active FROM hrd_travel_budget_types WHERE code = ${code}`;
    if (!t) throw new Bad(400, 'ไม่พบประเภทงบนี้', 'budget_type');
    if (!t.is_active && code !== keep) throw new Bad(400, 'ประเภทงบนี้ปิดใช้งานแล้ว', 'budget_type');
};
const snap = (b: any) => ({ fiscal_year: b.fiscal_year, budget_type: b.budget_type, name: b.name, amount: Number(b.amount), note: b.note ?? null, is_active: !!b.is_active });

/** ยอดใช้ของงบ (ตามเงื่อนไข where ของ alias b) */
const budgetRows = (where: any) => core_kon`
    SELECT b.id, b.fiscal_year, b.budget_type, b.name, b.amount::float8 AS amount, b.note, b.is_active, b.updated_at,
           CASE WHEN b.updated_by IS NULL THEN NULL ELSE CONCAT(u.pname, u.fname, ' ', u.lname) END AS updated_by_name,
           COALESCE(x.spent, 0)::float8 AS spent, COALESCE(x.pending, 0)::float8 AS pending,
           COALESCE(x.requests, 0)::int AS requests, COALESCE(x.confirmed, 0)::int AS confirmed, COALESCE(x.travelers, 0)::int AS travelers
    FROM hrd_travel_budgets b
    LEFT JOIN users u ON u.id = b.updated_by
    LEFT JOIN LATERAL (
        SELECT SUM(r.actual_amount) AS spent,
               SUM(r.total_amount) FILTER (WHERE r.actual_amount IS NULL) AS pending,
               count(*) AS requests, count(*) FILTER (WHERE r.actual_amount IS NOT NULL) AS confirmed,
               (SELECT count(*) FROM hrd_travel_request_travelers t JOIN hrd_travel_requests r2 ON r2.id = t.request_id
                 WHERE r2.budget_id = b.id AND r2.status = 'submitted') AS travelers
        FROM hrd_travel_requests r WHERE r.budget_id = b.id AND r.status = 'submitted'
    ) x ON TRUE
    WHERE ${where}
    ORDER BY b.fiscal_year DESC, b.is_active DESC, b.budget_type, b.name`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const withRemaining = (r: any) => ({ ...r, remaining: r2(r.amount - r.spent), projected: r2(r.amount - r.spent - r.pending) });

export const getBudgets = async ({ query, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const fy = Number(query?.fiscal_year) || null;
        const rows = await budgetRows(fy ? core_kon`b.fiscal_year = ${fy}` : core_kon`TRUE`);
        const years = (await core_kon`SELECT DISTINCT fiscal_year FROM hrd_travel_budgets ORDER BY fiscal_year DESC`).map((r: any) => r.fiscal_year);
        const cur = currentFiscalYear();
        return { success: true, data: { rows: rows.map(withRemaining), years: [...new Set([cur, ...years])].sort((a, b) => b - a), current_fiscal_year: cur } };
    } catch (e: any) {
        console.error('[hrdBudget] list:', e?.message);
        return fail(set, 500, 'โหลดงบประมาณไม่สำเร็จ');
    }
};

export const createBudget = async ({ body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const b = readBudget(body);
        const actor = Number(user.id);
        const id = await core_kon.begin(async (sql: any) => {
            await checkType(sql, b.budget_type, null);
            if ((await sql`SELECT 1 FROM hrd_travel_budgets WHERE fiscal_year = ${b.fiscal_year} AND name = ${b.name}`).length)
                throw new Bad(409, `ปีงบ ${b.fiscal_year} มีงบชื่อ "${b.name}" อยู่แล้ว`, 'name');
            const [row] = await sql`INSERT INTO hrd_travel_budgets ${sql({ ...b, created_by: actor, updated_by: actor })} RETURNING id`;
            await sql`INSERT INTO hrd_travel_budget_log (budget_id, action, before, after, changed_by) VALUES (${row.id}, 'create', NULL, ${sql.json(b)}, ${actor})`;
            return row.id;
        });
        return { success: true, data: { id } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdBudget] create:', e?.message);
        return fail(set, 500, 'เพิ่มงบไม่สำเร็จ');
    }
};

// แก้งบ — ลดวงเงินต่ำกว่ายอดที่การเงินยืนยันแล้วไม่ได้ · เปลี่ยนประเภท/ปีงบได้เมื่อยังไม่มีคำขอใช้งบนี้
export const updateBudget = async ({ params, body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const b = readBudget(body);
        const actor = Number(user.id);
        const changed = await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT * FROM hrd_travel_budgets WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบงบ');
            await checkType(sql, b.budget_type, cur.budget_type);
            if ((await sql`SELECT 1 FROM hrd_travel_budgets WHERE fiscal_year = ${b.fiscal_year} AND name = ${b.name} AND id <> ${cur.id}`).length)
                throw new Bad(409, `ปีงบ ${b.fiscal_year} มีงบชื่อ "${b.name}" อยู่แล้ว`, 'name');
            const [{ spent, n }] = await sql`SELECT COALESCE(SUM(actual_amount), 0)::float8 AS spent, count(*)::int AS n
                FROM hrd_travel_requests WHERE budget_id = ${cur.id} AND status = 'submitted'`;
            if (b.amount < spent) throw new Bad(409, `วงเงินต้องไม่น้อยกว่ายอดที่การเงินยืนยันแล้ว ${spent.toLocaleString('en-US')} บาท`, 'amount');
            if (n > 0 && (b.budget_type !== cur.budget_type || b.fiscal_year !== cur.fiscal_year))
                throw new Bad(409, `มีคำขอใช้งบนี้แล้ว ${n} รายการ เปลี่ยนประเภทหรือปีงบไม่ได้`, b.budget_type !== cur.budget_type ? 'budget_type' : 'fiscal_year');
            const before = snap(cur);
            if (JSON.stringify(before) === JSON.stringify(b)) return false;
            await sql`UPDATE hrd_travel_budgets SET ${sql({ ...b, updated_by: actor, updated_at: new Date() })} WHERE id = ${cur.id}`;
            await sql`INSERT INTO hrd_travel_budget_log (budget_id, action, before, after, changed_by) VALUES (${cur.id}, 'update', ${sql.json(before)}, ${sql.json(b)}, ${actor})`;
            return true;
        });
        return { success: true, data: { changed } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdBudget] update:', e?.message);
        return fail(set, 500, 'บันทึกงบไม่สำเร็จ');
    }
};

export const getBudgetLog = async ({ params, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const rows = await core_kon`
            SELECT l.id, l.action, l.before, l.after, l.changed_at, CONCAT(c.pname, c.fname, ' ', c.lname) AS changed_by_name
            FROM hrd_travel_budget_log l LEFT JOIN users c ON c.id = l.changed_by
            WHERE l.budget_id = ${Number(params.id)} ORDER BY l.changed_at DESC, l.id DESC LIMIT 100`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[hrdBudget] log:', e?.message);
        return fail(set, 500, 'โหลดประวัติไม่สำเร็จ');
    }
};

// ── Dashboard เชิงลึก ──
// ทุกส่วน (รายงบ / รายเดือน / กลุ่มงาน / รายบุคคล / รายการคำขอ) คำนวณจาก "แถวผู้เดินทาง" ชุดเดียวกัน (1 คน × 1 คำขอ) แล้วกรองตามตัวกรอง
// ยอดรายคน: เบี้ยเลี้ยงของคนนั้น (อัตรา × วัน) + ค่าที่พักตามสัดส่วนเพดานของคนนั้น (คำขอเก่าไม่มีรายคน = หารเท่ากัน)
//          + ค่าใช้จ่ายร่วมอื่นของคำขอ (พาหนะ ลงทะเบียน ฯลฯ) หารเท่ากัน
//   ยอดยืนยันจากการเงินปรับตามสัดส่วนเดียวกัน → รวมทุกคนในคำขอ = ยอดของคำขอพอดี
// กลุ่มงาน/กลุ่มภารกิจ = สังกัดปัจจุบันของผู้เดินทาง
interface DashFilters { budgetId: number | null; budgetType: string | null; missionId: number | null; majorId: number | null; userId: number | null; status: 'confirmed' | 'pending' | null }
const pid = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const parseDash = (q: any): DashFilters => ({
    budgetId: pid(q?.budget_id), budgetType: TYPE_CODE_RE.test(String(q?.budget_type ?? '')) ? q.budget_type : null,
    missionId: pid(q?.mission_id), majorId: pid(q?.major_id), userId: pid(q?.user_id),
    status: q?.status === 'confirmed' || q?.status === 'pending' ? q.status : null,
});
const linesOf = (budgetIds: number[], f: DashFilters) => core_kon`
    SELECT r.id AS rid, r.budget_id, r.budget_type, r.budget_name, r.start_at, r.subject, r.location, r.requester_name,
           r.total_amount AS req_total, r.actual_amount AS req_actual, n.n AS travelers,
           t.user_id, t.name, t.is_requester, mj.name AS unit, u.major_id, u.mission_id, r.allowance_days AS days,
           ${ALLOWANCE_SQL(core_kon)} AS allowance,
           CASE WHEN r.actual_amount IS NULL THEN 0
                WHEN r.total_amount > 0 THEN e.est * r.actual_amount / r.total_amount
                ELSE r.actual_amount / n.n END AS spent,
           CASE WHEN r.actual_amount IS NULL THEN e.est ELSE 0 END AS pending
    FROM hrd_travel_requests r
    JOIN hrd_travel_request_travelers t ON t.request_id = r.id
    JOIN LATERAL (SELECT count(*)::numeric AS n, SUM(x.lodging_cap) AS cap FROM hrd_travel_request_travelers x WHERE x.request_id = r.id) n ON TRUE
    JOIN LATERAL (SELECT ${ALLOWANCE_SQL(core_kon)}
                         + CASE WHEN n.cap > 0 THEN r.lodging_amount * t.lodging_cap / n.cap ELSE r.lodging_amount / n.n END
                         + (r.total_amount - r.allowance_amount - r.lodging_amount) / n.n AS est) e ON TRUE
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN majors mj ON mj.major_id = u.major_id
    WHERE r.status = 'submitted' AND ${budgetIds.length ? core_kon`r.budget_id IN ${core_kon(budgetIds)}` : core_kon`FALSE`}
      ${f.budgetId ? core_kon`AND r.budget_id = ${f.budgetId}` : core_kon``}
      ${f.budgetType ? core_kon`AND r.budget_type = ${f.budgetType}` : core_kon``}
      ${f.missionId ? core_kon`AND u.mission_id = ${f.missionId}` : core_kon``}
      ${f.majorId ? core_kon`AND u.major_id = ${f.majorId}` : core_kon``}
      ${f.userId ? core_kon`AND t.user_id = ${f.userId}` : core_kon``}
      ${f.status === 'confirmed' ? core_kon`AND r.actual_amount IS NOT NULL` : f.status === 'pending' ? core_kon`AND r.actual_amount IS NULL` : core_kon``}`;
const m2 = (frag: string) => core_kon.unsafe(`ROUND(COALESCE(${frag}, 0)::numeric, 2)::float8`);

// Dashboard ปีงบเดียว — query: fiscal_year + ตัวกรอง (budget_id, budget_type, mission_id, major_id, user_id, status)
export const getBudgetDashboard = async ({ query, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const fy = Number(query?.fiscal_year) || currentFiscalYear();
        const f = parseDash(query);
        // ภาพรวมงบ (วงเงิน/คงเหลือ) ไม่ขึ้นกับตัวกรองบุคคล — คงเหลือเป็นเรื่องของงบทั้งก้อน
        const budgets = (await budgetRows(core_kon`b.fiscal_year = ${fy}`)).map(withRemaining);
        const ids = budgets.map((b: any) => b.id);
        const L = linesOf(ids, f);
        const [[filtered], byBudget, monthly, byUnit, byPerson, requests, categories] = await Promise.all([
            core_kon`WITH l AS (${L}) SELECT ${m2('SUM(spent)')} AS spent, ${m2('SUM(pending)')} AS pending,
                            count(DISTINCT user_id)::int AS people, count(DISTINCT rid)::int AS requests,
                            count(DISTINCT rid) FILTER (WHERE req_actual IS NOT NULL)::int AS confirmed FROM l`,
            core_kon`WITH l AS (${L}) SELECT budget_id, budget_name, budget_type, ${m2('SUM(spent)')} AS spent, ${m2('SUM(pending)')} AS pending,
                            count(DISTINCT rid)::int AS requests, count(DISTINCT user_id)::int AS people
                     FROM l GROUP BY 1, 2, 3 ORDER BY SUM(spent + pending) DESC`,
            core_kon`WITH l AS (${L}) SELECT to_char(start_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') AS month,
                            ${m2('SUM(spent)')} AS spent, ${m2('SUM(pending)')} AS pending, count(DISTINCT rid)::int AS requests
                     FROM l GROUP BY 1 ORDER BY 1`,
            core_kon`WITH l AS (${L}) SELECT major_id, COALESCE(unit, 'ไม่ระบุกลุ่มงาน') AS unit, ${m2('SUM(spent)')} AS spent, ${m2('SUM(pending)')} AS pending,
                            count(DISTINCT user_id)::int AS people, count(DISTINCT rid)::int AS requests
                     FROM l GROUP BY 1, 2 ORDER BY SUM(spent + pending) DESC LIMIT 12`,
            core_kon`WITH l AS (${L}) SELECT user_id, name, COALESCE(unit, '') AS unit, count(DISTINCT rid)::int AS trips, SUM(days)::float8 AS days,
                            ${m2('SUM(allowance)')} AS allowance, ${m2('SUM(spent)')} AS spent, ${m2('SUM(pending)')} AS pending,
                            string_agg(DISTINCT budget_name, ', ') AS budgets
                     FROM l GROUP BY 1, 2, 3 ORDER BY SUM(spent + pending) DESC, count(DISTINCT rid) DESC LIMIT 100`,
            core_kon`WITH l AS (${L}) SELECT rid AS id, subject, location, start_at, requester_name, budget_id, budget_name, budget_type,
                            req_total::float8 AS total_amount, req_actual::float8 AS actual_amount, travelers::int AS travelers,
                            ${m2('SUM(spent + pending)')} AS share, count(*)::int AS matched,
                            string_agg(name, ', ' ORDER BY is_requester DESC, name) AS names
                     FROM l GROUP BY rid, subject, location, start_at, requester_name, budget_id, budget_name, budget_type, req_total, req_actual, travelers
                     ORDER BY start_at DESC, rid DESC LIMIT 100`,
            // หมวดค่าใช้จ่าย (ประมาณการ) ของคำขอที่ตรงตัวกรอง — ระดับคำขอ
            core_kon`WITH l AS (${L}) SELECT ${m2('SUM(r.allowance_amount)')} AS allowance, ${m2('SUM(r.lodging_amount)')} AS lodging,
                            ${m2('SUM(r.transport_amount + r.fuel_amount + r.toll_amount)')} AS transport, ${m2('SUM(r.registration_amount + r.other_amount)')} AS other
                     FROM hrd_travel_requests r WHERE r.id IN (SELECT DISTINCT rid FROM l)`,
        ]);
        const sum = (k: string) => Math.round(budgets.reduce((n: number, b: any) => n + b[k], 0) * 100) / 100;
        const totals = { amount: sum('amount'), spent: sum('spent'), pending: sum('pending'), remaining: sum('remaining'), projected: sum('projected'),
            requests: budgets.reduce((n: number, b: any) => n + b.requests, 0), confirmed: budgets.reduce((n: number, b: any) => n + b.confirmed, 0) };
        const cat = categories[0] ?? {};
        return { success: true, data: {
            fiscal_year: fy, current_fiscal_year: currentFiscalYear(),
            filters: { budget_id: f.budgetId, budget_type: f.budgetType, mission_id: f.missionId, major_id: f.majorId, user_id: f.userId, status: f.status },
            totals, budgets, filtered, by_budget: byBudget, monthly, by_unit: byUnit, by_person: byPerson, requests,
            categories: ['allowance', 'lodging', 'transport', 'other'].map(k => ({ key: k, amount: cat[k] ?? 0 })),
        } };
    } catch (e: any) {
        console.error('[hrdBudget] dashboard:', e?.message);
        return fail(set, 500, 'โหลด dashboard ไม่สำเร็จ');
    }
};

// ── ประเภทงบ (ช่องที่ติ๊กในบันทึกข้อความ) ──
// อ่าน: ทุกคนที่ login (หน้าเว็บใช้แปลงรหัสเป็นชื่อ) · เพิ่ม/แก้: ADMIN / HRD · ไม่มีลบ — ปิดใช้แทน (งบ/คำขอเดิมอ้างอยู่)
// ref_code = รหัสงบของการเงิน (P20, P21, ...) · รายการย่อยของประเภท = งบ (hrd_travel_budgets) ที่เป็นประเภทนั้น
const REF_CODE_RE = /^[A-Za-z0-9.\-/]{1,20}$/;
const readType = (body: any) => {
    const name = String(body?.name ?? '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 100) throw new Bad(400, 'กรุณาระบุชื่อประเภท (ไม่เกิน 100 ตัวอักษร)', 'name');
    const refCode = String(body?.ref_code ?? '').trim().toUpperCase() || null;
    if (refCode && !REF_CODE_RE.test(refCode)) throw new Bad(400, 'รหัสงบใช้ตัวอักษรอังกฤษ ตัวเลข . - / ไม่เกิน 20 ตัว เช่น P20', 'ref_code');
    // ว่างได้ = บันทึกข้อความพิมพ์ชื่องบโดยไม่มีคำนำหน้า · ไม่ส่งมาเลย (เพิ่มใหม่) = "รายการงบ"
    const label = body?.item_label === undefined ? 'รายการงบ' : String(body.item_label ?? '').trim().replace(/\s+/g, ' ');
    if (label.length > 30) throw new Bad(400, 'ข้อความหน้าชื่องบไม่เกิน 30 ตัวอักษร', 'item_label');
    const order = body?.sort_order === undefined || body?.sort_order === null || body?.sort_order === '' ? null : Number(body.sort_order);
    if (order !== null && (!Number.isInteger(order) || order < 0 || order > 9999)) throw new Bad(400, 'ลำดับต้องเป็นจำนวนเต็ม 0–9999', 'sort_order');
    return { name, ref_code: refCode, item_label: label, sort_order: order, is_active: body?.is_active === undefined ? true : !!body.is_active };
};
const dupCheck = async (sql: any, t: { name: string; ref_code: string | null }, code: string | null) => {
    if ((await sql`SELECT 1 FROM hrd_travel_budget_types WHERE name = ${t.name} ${code ? sql`AND code <> ${code}` : sql``}`).length)
        throw new Bad(409, `มีประเภท "${t.name}" อยู่แล้ว`, 'name');
    if (t.ref_code && (await sql`SELECT 1 FROM hrd_travel_budget_types WHERE UPPER(ref_code) = ${t.ref_code} ${code ? sql`AND code <> ${code}` : sql``}`).length)
        throw new Bad(409, `รหัสงบ ${t.ref_code} ใช้กับประเภทอื่นแล้ว`, 'ref_code');
};

export const getBudgetTypes = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT t.code, t.ref_code, t.name, t.item_label, t.sort_order, t.is_active,
                   (SELECT count(*)::int FROM hrd_travel_budgets b WHERE b.budget_type = t.code) AS budgets
            FROM hrd_travel_budget_types t ORDER BY t.sort_order, t.code`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[hrdBudget] types:', e?.message);
        return fail(set, 500, 'โหลดประเภทงบไม่สำเร็จ');
    }
};

export const createBudgetType = async ({ body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const t = readType(body);
        const actor = Number(user.id);
        const code = await core_kon.begin(async (sql: any) => {
            await dupCheck(sql, t, null);
            const [{ n }] = await sql`SELECT nextval('hrd_travel_budget_type_seq') AS n`;
            const order = t.sort_order ?? (await sql`SELECT COALESCE(MAX(sort_order), 0) + 1 AS o FROM hrd_travel_budget_types`)[0].o;
            const [row] = await sql`INSERT INTO hrd_travel_budget_types ${sql({ ...t, sort_order: order, code: `t${n}`, created_by: actor, updated_by: actor })} RETURNING code`;
            return row.code;
        });
        return { success: true, data: { code } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdBudget] type create:', e?.message);
        return fail(set, 500, 'เพิ่มประเภทงบไม่สำเร็จ');
    }
};

export const updateBudgetType = async ({ params, body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const code = String(params?.code ?? '');
        if (!TYPE_CODE_RE.test(code)) return fail(set, 404, 'ไม่พบประเภทงบ');
        const t = readType(body);
        const actor = Number(user.id);
        await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT code, sort_order FROM hrd_travel_budget_types WHERE code = ${code} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบประเภทงบ');
            await dupCheck(sql, t, code);
            if (!t.is_active && !(await sql`SELECT 1 FROM hrd_travel_budget_types WHERE is_active AND code <> ${code}`).length)
                throw new Bad(409, 'ต้องเปิดใช้อย่างน้อย 1 ประเภท', 'is_active');
            await sql`UPDATE hrd_travel_budget_types SET ${sql({ ...t, sort_order: t.sort_order ?? cur.sort_order, updated_by: actor, updated_at: new Date() })} WHERE code = ${code}`;
        });
        return { success: true, data: { code } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdBudget] type update:', e?.message);
        return fail(set, 500, 'บันทึกประเภทงบไม่สำเร็จ');
    }
};
