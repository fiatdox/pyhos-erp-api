import { core_kon } from '../db/db';
import { rolloverAnnualLeave, autoRolloverEnabled, syncCarriedForward, entitlementsOf, fiscalYearStart, currentFiscalYear } from '../services/leaveRollover';

const serverError = (set: any, where: string, error: any) => {
    console.error(`[hrLeaveBalanceController] ${where}:`, error);
    set.status = 500;
    return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
};

// ปีงบประมาณราชการไทย (1 ต.ค. - 30 ก.ย.) เรียกชื่อตาม พ.ศ. ของปีที่ปีงบสิ้นสุด
const fiscalYearOf = (d: Date): number => {
    const ceYear = d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear(); // เดือน 9 = ต.ค. (0-indexed)
    return ceYear + 543;
};

// หาเกณฑ์สิทธิ์ที่ตรงกับผู้ใช้ ณ ตอนนี้ (user_type + อายุงาน) — เลือก tier อายุงานสูงสุดที่ยังไม่เกินอายุงานจริง
// อายุงานนับจาก v_leave_service_start (hire_date ในทะเบียน ถ้าว่างใช้วันบรรจุจากโปรแกรมการลาเดิม)
// ไม่มีวันเริ่มงานเลย ใช้ tier ต่ำสุด — กติกาเดียวกับการตรวจสิทธิ์ตอนยื่นใบลา
// (เดิมนับอายุงานเป็น 0 เดือน ทำให้ไม่ผ่าน tier 6 เดือนของลาพักผ่อน และไม่ได้ยกยอดเลย)
const findEntitlement = async (userId: number, leaveTypeId: number) => {
    const rows = await core_kon`
        SELECT e.max_days_per_year, e.carry_over, e.carry_over_max_days
        FROM users u
        JOIN v_leave_service_start ss ON ss.user_id = u.id
        JOIN hr_leave_entitlements e ON e.user_type_id = u.user_type_id AND e.leave_type_id = ${leaveTypeId}
        WHERE u.id = ${userId}
          AND (ss.service_start IS NULL
               OR e.min_service_months <= EXTRACT(YEAR FROM AGE(now(), ss.service_start))::int * 12
                                        + EXTRACT(MONTH FROM AGE(now(), ss.service_start))::int)
        ORDER BY CASE WHEN ss.service_start IS NULL THEN e.min_service_months END ASC,
                 e.min_service_months DESC
        LIMIT 1`;
    return rows[0] ?? null;
};

// ── ประวัติการแก้ยอด (hr_leave_balance_logs) ────────────────────────────────
const BALANCE_FIELDS = ['carried_in', 'entitled', 'used'] as const;
const snapshot = (r: any) => ({
    carried_in: Number(r.carried_in), entitled: Number(r.entitled), used: Number(r.used),
    remaining: Number(r.remaining), note: r.note ?? null,
});
const logBalance = (sql: any, balanceId: number, action: 'CREATE' | 'UPDATE', before: any, after: any, reason: string | null, actorId: number) => sql`
    INSERT INTO hr_leave_balance_logs (balance_id, action, before, after, reason, actor_id)
    VALUES (${balanceId}, ${action}, ${before ? sql.json(before) : null}, ${sql.json(after)}, ${reason}, ${actorId})`;

/** ยอดวันต้องเป็นตัวเลข ≥ 0 ทีละครึ่งวัน — คืนข้อความผิดพลาด หรือ null ถ้าผ่าน */
const invalidDays = (patch: Record<string, any>) => {
    for (const k of BALANCE_FIELDS) {
        if (!(k in patch)) continue;
        const n = Number(patch[k]);
        if (!Number.isFinite(n) || n < 0 || n > 999 || Math.round(n * 2) !== n * 2) return 'จำนวนวันต้องเป็นตัวเลข 0 ขึ้นไป ทีละครึ่งวัน';
    }
    return null;
};
const cleanReason = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 255) : null);

// ── เมตาไว้ให้หน้าเว็บ: ปีงบประมาณปัจจุบัน + ปีที่มีข้อมูลอยู่แล้ว ──────────────
export const getLeaveBalanceMeta = async ({ set }: any) => {
    try {
        const current = fiscalYearOf(new Date());
        const rows = await core_kon`SELECT DISTINCT fiscal_year FROM hr_leave_balances ORDER BY fiscal_year DESC`;
        const years = Array.from(new Set([current, ...rows.map((r: any) => r.fiscal_year)])).sort((a, b) => b - a);
        const [auto] = await core_kon`SELECT value, updated_at FROM hr_settings WHERE name = 'leave_rollover_fy'`;
        return {
            success: true,
            data: {
                current_fiscal_year: current, fiscal_years: years,
                // งานยกยอดอัตโนมัติเมื่อข้ามปีงบ — last_fiscal_year = ปีล่าสุดที่ยกยอดแล้ว
                auto_rollover: {
                    enabled: autoRolloverEnabled(),
                    last_fiscal_year: auto?.value ? Number(auto.value) : null,
                    updated_at: auto?.updated_at ?? null,
                },
            },
        };
    } catch (error: any) { return serverError(set, 'getLeaveBalanceMeta', error); }
};

// ── รายการวันลาสะสม กรองตามกลุ่มภารกิจ/กลุ่มงาน/หน่วยงาน/ชื่อ ───────────────
export const getLeaveBalances = async ({ query, set }: any) => {
    try {
        const fiscalYear = query.fiscal_year ? Number(query.fiscal_year) : fiscalYearOf(new Date());
        const leaveTypeId = Number(query.leave_type_id);
        if (!leaveTypeId) { set.status = 400; return { success: false, message: 'กรุณาระบุประเภทการลา' }; }

        const missionId = query.mission_id ? Number(query.mission_id) : null;
        const majorId = query.major_id ? Number(query.major_id) : null;
        const submajorId = query.submajor_id ? Number(query.submajor_id) : null;
        const search = (query.search ?? '').trim();

        const rows = await core_kon`
            SELECT
                u.id AS user_id, u.pname, u.fname, u.lname,
                up.position_name, m.name AS mission_name, mj.name AS major_name, sm.name AS submajor_name,
                b.id AS balance_id, b.carried_in, b.entitled, b.used, b.remaining, b.note, b.updated_at
            FROM users u
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            LEFT JOIN missions   m  ON m.mission_id   = u.mission_id
            LEFT JOIN majors     mj ON mj.major_id    = u.major_id
            LEFT JOIN submajors  sm ON sm.submajor_id = u.submajor_id
            LEFT JOIN hr_leave_balances b
                   ON b.user_id = u.id AND b.leave_type_id = ${leaveTypeId} AND b.fiscal_year = ${fiscalYear}
            WHERE u.is_active = 'Y'
              AND (${missionId}::int   IS NULL OR u.mission_id   = ${missionId})
              AND (${majorId}::int     IS NULL OR u.major_id     = ${majorId})
              AND (${submajorId}::int IS NULL OR u.submajor_id  = ${submajorId})
              AND (${search} = '' OR (u.pname || u.fname || ' ' || u.lname) ILIKE ${'%' + search + '%'})
            ORDER BY u.fname
            LIMIT 500`;
        return { success: true, data: { fiscal_year: fiscalYear, leave_type_id: leaveTypeId, rows } };
    } catch (error: any) { return serverError(set, 'getLeaveBalances', error); }
};

// ── เพิ่มยอดสะสมครั้งแรก (เช่น ข้าราชการย้ายมา) ─────────────────────────────
export const createLeaveBalance = async ({ body, user, set }: any) => {
    try {
        const { user_id, leave_type_id, fiscal_year, carried_in, used, note } = body;
        const bad = invalidDays(body);
        if (bad) { set.status = 400; return { success: false, message: bad }; }
        // ไม่ระบุสิทธิ์ปีนี้ = ใช้เกณฑ์ตามประเภทเจ้าหน้าที่ + อายุงาน
        const entitled = body.entitled != null ? Number(body.entitled) : ((await findEntitlement(user_id, leave_type_id))?.max_days_per_year ?? 0);
        const row = await core_kon.begin(async (tx: any) => {
            const [r] = await tx`
                INSERT INTO hr_leave_balances (user_id, leave_type_id, fiscal_year, carried_in, entitled, used, note, created_by, updated_by)
                VALUES (${user_id}, ${leave_type_id}, ${fiscal_year}, ${carried_in ?? 0}, ${entitled}, ${used ?? 0}, ${note ?? null}, ${user.id}, ${user.id})
                RETURNING id, user_id, leave_type_id, fiscal_year, carried_in, entitled, used, remaining, note, updated_at`;
            await logBalance(tx, r.id, 'CREATE', null, snapshot(r), cleanReason(body.reason) ?? cleanReason(note), Number(user.id));
            await syncCarriedForward(tx, Number(user_id), Number(leave_type_id), Number(fiscal_year));
            return r;
        });
        set.status = 201;
        return { success: true, data: row };
    } catch (error: any) {
        if (error.code === '23505') {
            set.status = 409;
            return { success: false, message: 'มีข้อมูลวันลาสะสมของบุคคลนี้ในปีงบประมาณนี้อยู่แล้ว' };
        }
        return serverError(set, 'createLeaveBalance', error);
    }
};

// ── แก้ไขยอดสะสม (ปรับยอดยกมา/สิทธิ์/ใช้ไปแล้ว/หมายเหตุ) ────────────────────
// แก้ตัวเลขต้องระบุเหตุผล — เก็บค่าก่อน/หลังไว้ใน hr_leave_balance_logs
// keep_carry_link = ยอดยกมาที่ตั้งตามคงเหลือปีก่อน (ปุ่ม "แก้ตามที่แนะนำ") ให้ระบบปรับตามปีก่อนต่อได้
const applyBalancePatch = async (tx: any, id: number, body: any, reason: string | null, actorId: number) => {
    const [before] = await tx`SELECT * FROM hr_leave_balances WHERE id = ${id} FOR UPDATE`;
    if (!before) return null;
    const patch: Record<string, any> = {};
    for (const k of [...BALANCE_FIELDS, 'note'] as const) if (k in body && body[k] !== undefined) patch[k] = body[k];
    if ('carried_in' in patch && Number(patch.carried_in) !== Number(before.carried_in)) {
        // HR ตั้งยอดยกมาเอง — ระบบจะไม่ปรับยอดยกมาแถวนี้ทับอีก (syncCarriedForward)
        if (body.keep_carry_link) patch.carried_from_fy = Number(before.fiscal_year) - 1;
        else { patch.carried_from_fy = null; patch.auto_created = false; }
    }
    patch.updated_by = actorId;
    patch.updated_at = new Date();
    const [after] = await tx`
        UPDATE hr_leave_balances SET ${tx(patch)}
        WHERE id = ${id}
        RETURNING id, user_id, leave_type_id, fiscal_year, carried_in, entitled, used, remaining, note, updated_at`;
    await logBalance(tx, id, 'UPDATE', snapshot(before), snapshot(after), reason, actorId);
    // คงเหลือปีนี้เปลี่ยน → ยอดยกมาของปีถัดไปที่ระบบยกให้ต้องเปลี่ยนตาม
    if (BALANCE_FIELDS.some(k => k in patch)) await syncCarriedForward(tx, Number(after.user_id), Number(after.leave_type_id), Number(after.fiscal_year));
    return after;
};

export const updateLeaveBalance = async ({ params, body, user, set }: any) => {
    try {
        const touchesDays = BALANCE_FIELDS.some(k => k in body);
        if (!touchesDays && !('note' in body)) {
            set.status = 400;
            return { success: false, message: 'ไม่มีข้อมูลให้บันทึก' };
        }
        const bad = invalidDays(body);
        if (bad) { set.status = 400; return { success: false, message: bad }; }
        const reason = cleanReason(body.reason);
        if (touchesDays && !reason) { set.status = 400; return { success: false, message: 'กรุณาระบุเหตุผลที่แก้ไขยอดวันลา' }; }
        const row = await core_kon.begin((tx: any) => applyBalancePatch(tx, Number(params.id), body, reason, Number(user.id)));
        if (!row) { set.status = 404; return { success: false, message: 'ไม่พบข้อมูลวันลาสะสมนี้' }; }
        return { success: true, data: row };
    } catch (error: any) { return serverError(set, 'updateLeaveBalance', error); }
};

// ── แก้หลายแถวพร้อมกัน (ปุ่ม "แก้ตามที่แนะนำ" ในหน้าตรวจแก้วันลาสะสม) — ทั้งชุดหรือไม่เลย ──
export const fixLeaveBalances = async ({ body, user, set }: any) => {
    try {
        const items: any[] = Array.isArray(body.items) ? body.items : [];
        const reason = cleanReason(body.reason);
        if (!items.length) { set.status = 400; return { success: false, message: 'ไม่มีรายการให้แก้ไข' }; }
        if (items.length > 500) { set.status = 400; return { success: false, message: 'แก้ได้ครั้งละไม่เกิน 500 รายการ' }; }
        if (!reason) { set.status = 400; return { success: false, message: 'กรุณาระบุเหตุผลที่แก้ไขยอดวันลา' }; }
        for (const it of items) {
            const bad = invalidDays(it);
            if (bad) { set.status = 400; return { success: false, message: bad }; }
            if (!BALANCE_FIELDS.some(k => k in it)) { set.status = 400; return { success: false, message: 'บางรายการไม่มียอดที่ต้องแก้' }; }
        }
        const updated = await core_kon.begin(async (tx: any) => {
            let n = 0;
            for (const it of items) {
                const { id, ...rest } = it;
                if (await applyBalancePatch(tx, Number(id), rest, reason, Number(user.id))) n++;
            }
            return n;
        });
        return { success: true, data: { updated } };
    } catch (error: any) { return serverError(set, 'fixLeaveBalances', error); }
};

// ── ประวัติการแก้ของแถวหนึ่ง ────────────────────────────────────────────────
export const getLeaveBalanceLogs = async ({ params, set }: any) => {
    try {
        const id = Number(params.id);
        const [cur] = await core_kon`
            SELECT b.updated_at, b.note, CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name
            FROM hr_leave_balances b LEFT JOIN users u ON u.id = b.updated_by
            WHERE b.id = ${id}`;
        if (!cur) { set.status = 404; return { success: false, message: 'ไม่พบข้อมูลวันลาสะสมนี้' }; }
        const logs = await core_kon`
            SELECT l.id, l.action, l.before, l.after, l.reason, l.created_at,
                   CONCAT(u.pname, u.fname, ' ', u.lname) AS actor_name
            FROM hr_leave_balance_logs l LEFT JOIN users u ON u.id = l.actor_id
            WHERE l.balance_id = ${id}
            ORDER BY l.created_at DESC, l.id DESC
            LIMIT 100`;
        return { success: true, data: { current: cur, logs } };
    } catch (error: any) { return serverError(set, 'getLeaveBalanceLogs', error); }
};

// ── ตรวจยอดวันลาสะสมที่น่าจะผิด ───────────────────────────────────────────
// negative  คงเหลือติดลบ
// used      ใช้ไปแล้ว ≠ ผลรวมวันที่หักจากใบลาจริงของปีงบนั้น (days_deducted) → แนะนำค่าจากใบลา
// entitled  สิทธิ์ปีนี้ ≠ เกณฑ์ตามประเภทเจ้าหน้าที่ + อายุงาน ณ วันแรกของปีงบ → แนะนำค่าตามเกณฑ์
// no_rule   ไม่ผ่านเกณฑ์สิทธิ์ใดเลย (ประเภทเจ้าหน้าที่ไม่มีเกณฑ์ หรืออายุงานไม่ถึง) แต่มีการใช้วันลา — HR ต้องตัดสินเอง
// carry     ลาพักผ่อน: ยอดยกมา ≠ คงเหลือปีก่อน (ไม่เกินเพดาน) → แนะนำค่าจากปีก่อน
// cap       ลาพักผ่อน: ยอดยกมาเกินเพดานสะสม / ประเภทนี้สะสมไม่ได้ → แนะนำเพดาน
export const BALANCE_ISSUES = ['negative', 'used', 'entitled', 'no_rule', 'carry', 'cap'] as const;

export const getLeaveBalanceAudit = async ({ query, set }: any) => {
    try {
        const fy = query.fiscal_year ? Number(query.fiscal_year) : currentFiscalYear();
        const typeId = query.leave_type_id ? Number(query.leave_type_id) : null;
        const rows = await core_kon`
            WITH ded AS (
                SELECT user_id, leave_type_id, SUM(COALESCE(days_deducted, 0)) AS ded
                FROM hr_leave_requests
                WHERE (CASE WHEN EXTRACT(MONTH FROM start_date) >= 10
                            THEN EXTRACT(YEAR FROM start_date) + 1
                            ELSE EXTRACT(YEAR FROM start_date) END)::int + 543 = ${fy}
                GROUP BY user_id, leave_type_id)
            SELECT b.id AS balance_id, b.user_id, b.leave_type_id, t.code AS leave_type_code, t.name_th AS leave_type_name,
                   b.carried_in, b.entitled, b.used, b.remaining, b.note, b.updated_at, b.carried_from_fy,
                   u.pname, u.fname, u.lname, u.is_active, up.position_name, ut.type_name AS user_type_name,
                   m.name AS mission_name, mj.name AS major_name, sm.name AS submajor_name,
                   COALESCE(d.ded, 0) AS expected_used, prev.remaining AS prev_remaining
            FROM hr_leave_balances b
            JOIN hr_leave_types t ON t.id = b.leave_type_id
            JOIN users u ON u.id = b.user_id
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            LEFT JOIN user_types ut     ON ut.user_type_id     = u.user_type_id
            LEFT JOIN missions   m  ON m.mission_id   = u.mission_id
            LEFT JOIN majors     mj ON mj.major_id    = u.major_id
            LEFT JOIN submajors  sm ON sm.submajor_id = u.submajor_id
            LEFT JOIN ded d ON d.user_id = b.user_id AND d.leave_type_id = b.leave_type_id
            LEFT JOIN hr_leave_balances prev
                   ON prev.user_id = b.user_id AND prev.leave_type_id = b.leave_type_id AND prev.fiscal_year = b.fiscal_year - 1
            WHERE b.fiscal_year = ${fy} AND (${typeId}::int IS NULL OR b.leave_type_id = ${typeId})
            ORDER BY u.fname, u.lname, t.id`;

        // เกณฑ์สิทธิ์ ณ วันแรกของปีงบ แยกตามประเภทการลา (เฉพาะบุคลากรที่ยังปฏิบัติงาน)
        const ents = new Map<number, Map<number, any>>();
        for (const t of new Set(rows.map((r: any) => Number(r.leave_type_id)))) {
            ents.set(t, await entitlementsOf(core_kon, t, fiscalYearStart(fy)));
        }

        const counts: Record<string, number> = Object.fromEntries(BALANCE_ISSUES.map(k => [k, 0]));
        const out = rows.map((r: any) => {
            const cur = { carried_in: Number(r.carried_in), entitled: Number(r.entitled), used: Number(r.used) };
            const ent = r.is_active === 'Y' ? ents.get(Number(r.leave_type_id))?.get(Number(r.user_id)) ?? null : null;
            const issues: string[] = [];
            const suggest: Record<string, number> = {};
            let carryLink = false;
            const expectedUsed = Number(r.expected_used);
            if (cur.used !== expectedUsed) { issues.push('used'); suggest.used = expectedUsed; }
            if (ent) {
                const max = Number(ent.max_days_per_year ?? 0);
                if (cur.entitled !== max) { issues.push('entitled'); suggest.entitled = max; }
            } else if (r.is_active === 'Y' && cur.used > 0 && cur.carried_in + cur.entitled < cur.used) {
                issues.push('no_rule');
            }
            if (r.leave_type_code === 'ANNUAL' && ent) {
                const cap = ent.carry_over ? (ent.carry_over_max_days != null ? Number(ent.carry_over_max_days) : null) : 0;
                if (r.prev_remaining != null && ent.carry_over) {
                    const left = Math.max(Number(r.prev_remaining), 0);
                    const exp = cap != null ? Math.min(left, cap) : left;
                    if (cur.carried_in !== exp) { issues.push('carry'); suggest.carried_in = exp; carryLink = true; }
                } else if (cap != null && cur.carried_in > cap) {
                    issues.push('cap'); suggest.carried_in = cap;
                }
            }
            if (Number(r.remaining) < 0) issues.push('negative');
            for (const k of issues) counts[k]++;
            const next = { ...cur, ...suggest };
            return {
                balance_id: r.balance_id, user_id: r.user_id, fiscal_year: fy,
                name: `${r.pname ?? ''}${r.fname ?? ''} ${r.lname ?? ''}`.trim(), is_active: r.is_active === 'Y',
                position_name: r.position_name, user_type_name: r.user_type_name,
                mission_name: r.mission_name, major_name: r.major_name, submajor_name: r.submajor_name,
                leave_type_id: r.leave_type_id, leave_type_code: r.leave_type_code, leave_type_name: r.leave_type_name,
                ...cur, remaining: Number(r.remaining), note: r.note, updated_at: r.updated_at,
                expected_used: expectedUsed, prev_remaining: r.prev_remaining != null ? Number(r.prev_remaining) : null,
                rule: ent ? {
                    max_days_per_year: Number(ent.max_days_per_year ?? 0), carry_over: !!ent.carry_over,
                    carry_over_max_days: ent.carry_over_max_days != null ? Number(ent.carry_over_max_days) : null,
                } : null,
                issues,
                suggest: Object.keys(suggest).length ? suggest : null,
                suggest_remaining: Object.keys(suggest).length ? next.carried_in + next.entitled - next.used : null,
                keep_carry_link: carryLink,
            };
        });
        const flagged = out.filter(r => r.issues.length).length;
        // summary=1 — เฉพาะตัวเลข (การ์ดเมนูหน้าการลา) ไม่ต้องส่งรายการทั้งหมด
        return { success: true, data: { fiscal_year: fy, total: out.length, flagged, counts, ...(query.summary === '1' ? {} : { rows: out }) } };
    } catch (error: any) { return serverError(set, 'getLeaveBalanceAudit', error); }
};

// ── สถานะการโอนยอดวันลาพักผ่อนสะสม ของบุคลากรที่ยังปฏิบัติงาน (อ่านอย่างเดียว) ──────────
// imported = โอนจากโปรแกรมเดิม (legacy_setday) · hr = HR เพิ่ม/แก้ยอดเอง · rolled = ระบบยกยอดจากปีก่อน
// auto     = มีแถวเพราะยื่นใบลา แต่ยังไม่ได้ตั้งยอดยกมา · none = ยังไม่มีข้อมูลปีงบนี้
// auto / none = "ยังไม่ได้โอน" — ถ้าปล่อยไว้ ตอนขึ้นปีงบใหม่ระบบยกยอดจากคงเหลือเท่าที่มี (ไม่มีแถว = ถือว่าเหลือเต็มสิทธิ์ 1 ปี)
// has_right = ผ่านเกณฑ์สิทธิ์ลาพักผ่อนแบบสะสมได้ ณ วันแรกของปีงบ — ไม่ผ่านก็ไม่ต้องตั้งยอดสะสม
export const TRANSFER_STATUSES = ['imported', 'hr', 'rolled', 'auto', 'none'] as const;

export const getLeaveBalanceTransferStatus = async ({ query, set }: any) => {
    try {
        const fy = query.fiscal_year ? Number(query.fiscal_year) : currentFiscalYear();
        const [annual] = await core_kon`SELECT id FROM hr_leave_types WHERE code = 'ANNUAL'`;
        if (!annual) { set.status = 404; return { success: false, message: 'ไม่พบประเภทการลาพักผ่อน (ANNUAL) ในระบบ' }; }
        const typeId = Number(annual.id);
        const [rows, ents] = await Promise.all([
            core_kon`
                SELECT u.id AS user_id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, up.position_name,
                       u.user_type_id, ut.type_name AS user_type_name,
                       m.name AS mission_name, mj.name AS major_name, sm.name AS submajor_name,
                       to_char(ss.service_start, 'YYYY-MM-DD') AS service_start,
                       b.id AS balance_id, b.carried_in, b.entitled, b.used, b.remaining, b.note,
                       b.legacy_setday, b.auto_created, b.carried_from_fy,
                       (b.id IS NOT NULL AND EXISTS (SELECT 1 FROM hr_leave_balance_logs l WHERE l.balance_id = b.id)) AS hr_logged
                FROM users u
                LEFT JOIN v_leave_service_start ss ON ss.user_id = u.id
                LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
                LEFT JOIN user_types ut     ON ut.user_type_id     = u.user_type_id
                LEFT JOIN missions   m  ON m.mission_id   = u.mission_id
                LEFT JOIN majors     mj ON mj.major_id    = u.major_id
                LEFT JOIN submajors  sm ON sm.submajor_id = u.submajor_id
                LEFT JOIN hr_leave_balances b
                       ON b.user_id = u.id AND b.leave_type_id = ${typeId} AND b.fiscal_year = ${fy}
                WHERE u.is_active = 'Y'
                ORDER BY u.user_type_id NULLS LAST, u.fname, u.lname`,
            entitlementsOf(core_kon, typeId, fiscalYearStart(fy)),
        ]);

        const statusOf = (r: any) => r.balance_id == null ? 'none'
            : r.legacy_setday != null ? 'imported'
            : r.hr_logged || (!r.auto_created && r.carried_from_fy == null) ? 'hr'
            : r.carried_from_fy != null ? 'rolled'
            : 'auto';

        const types = new Map<string, any>();
        const out = (rows as any[]).map(r => {
            const ent = ents.get(Number(r.user_id));
            const status = statusOf(r);
            const hasRight = !!ent?.carry_over;
            const key = r.user_type_id != null ? String(r.user_type_id) : 'none';
            const t = types.get(key) ?? types.set(key, {
                user_type_id: r.user_type_id, user_type_name: r.user_type_name ?? 'ไม่ระบุประเภท', total: 0,
                ...Object.fromEntries(TRANSFER_STATUSES.map(k => [k, 0])), missing: 0, missing_with_right: 0,
            }).get(key);
            t.total++; t[status]++;
            const missing = status === 'auto' || status === 'none';
            if (missing) { t.missing++; if (hasRight) t.missing_with_right++; }
            return {
                user_id: r.user_id, name: r.name, position_name: r.position_name,
                user_type_id: r.user_type_id, user_type_name: r.user_type_name ?? 'ไม่ระบุประเภท',
                mission_name: r.mission_name, major_name: r.major_name, submajor_name: r.submajor_name,
                service_start: r.service_start, status, missing,
                balance_id: r.balance_id,
                carried_in: r.balance_id ? Number(r.carried_in) : null, entitled: r.balance_id ? Number(r.entitled) : null,
                used: r.balance_id ? Number(r.used) : null, remaining: r.balance_id ? Number(r.remaining) : null,
                note: r.note,
                rule: ent ? {
                    max_days_per_year: Number(ent.max_days_per_year ?? 0), carry_over: !!ent.carry_over,
                    carry_over_max_days: ent.carry_over_max_days != null ? Number(ent.carry_over_max_days) : null,
                } : null,
                has_right: hasRight,
            };
        });
        const by_type = [...types.values()];
        const total = out.length;
        const missing = out.filter(r => r.missing).length;
        const missing_with_right = out.filter(r => r.missing && r.has_right).length;
        return {
            success: true,
            data: {
                fiscal_year: fy, leave_type_id: typeId, total, missing, missing_with_right, by_type,
                // summary=1 — เฉพาะตัวเลข (การ์ดเมนูหน้าการลา)
                ...(query.summary === '1' ? {} : { rows: out }),
            },
        };
    } catch (error: any) { return serverError(set, 'getLeaveBalanceTransferStatus', error); }
};

// ── ยกยอดปีงบประมาณใหม่ (ปุ่มของงาน HR) ─────────────────────────────────────
// ตรรกะอยู่ที่ services/leaveRollover.ts — ใช้ร่วมกับงานยกยอดอัตโนมัติเมื่อข้ามปีงบ
export const rolloverLeaveBalances = async ({ body, user, set }: any) => {
    try {
        const { from_fiscal_year, to_fiscal_year } = body;
        if (to_fiscal_year <= from_fiscal_year) {
            set.status = 400;
            return { success: false, message: 'ปีงบประมาณใหม่ต้องมากกว่าปีเดิม' };
        }
        const data = await core_kon.begin((sql: any) => rolloverAnnualLeave(sql, Number(from_fiscal_year), Number(to_fiscal_year), Number(user.id)));
        return { success: true, data };
    } catch (error: any) { return serverError(set, 'rolloverLeaveBalances', error); }
};
