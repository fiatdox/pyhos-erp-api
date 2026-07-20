import { core_kon } from '../db/db';

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

// หาเกณฑ์สิทธิ์ที่ตรงกับผู้ใช้ ณ ตอนนี้ (user_type + อายุงานจาก hire_date) — เลือก tier อายุงานสูงสุดที่ยังไม่เกินอายุงานจริง
const findEntitlement = async (userId: number, leaveTypeId: number) => {
    const rows = await core_kon`
        SELECT e.max_days_per_year, e.carry_over, e.carry_over_max_days
        FROM users u
        JOIN hr_leave_entitlements e ON e.user_type_id = u.user_type_id AND e.leave_type_id = ${leaveTypeId}
        WHERE u.id = ${userId}
          AND e.min_service_months <= COALESCE(
                EXTRACT(YEAR FROM AGE(now(), u.hire_date))::int * 12 + EXTRACT(MONTH FROM AGE(now(), u.hire_date))::int,
                0)
        ORDER BY e.min_service_months DESC
        LIMIT 1`;
    return rows[0] ?? null;
};

// ── เมตาไว้ให้หน้าเว็บ: ปีงบประมาณปัจจุบัน + ปีที่มีข้อมูลอยู่แล้ว ──────────────
export const getLeaveBalanceMeta = async ({ set }: any) => {
    try {
        const current = fiscalYearOf(new Date());
        const rows = await core_kon`SELECT DISTINCT fiscal_year FROM hr_leave_balances ORDER BY fiscal_year DESC`;
        const years = Array.from(new Set([current, ...rows.map((r: any) => r.fiscal_year)])).sort((a, b) => b - a);
        return { success: true, data: { current_fiscal_year: current, fiscal_years: years } };
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
        const entitlement = await findEntitlement(user_id, leave_type_id);
        const entitled = entitlement?.max_days_per_year ?? 0;
        const rows = await core_kon`
            INSERT INTO hr_leave_balances (user_id, leave_type_id, fiscal_year, carried_in, entitled, used, note, created_by, updated_by)
            VALUES (${user_id}, ${leave_type_id}, ${fiscal_year}, ${carried_in ?? 0}, ${entitled}, ${used ?? 0}, ${note ?? null}, ${user.id}, ${user.id})
            RETURNING id, user_id, leave_type_id, fiscal_year, carried_in, entitled, used, remaining, note, updated_at`;
        set.status = 201;
        return { success: true, data: rows[0] };
    } catch (error: any) {
        if (error.code === '23505') {
            set.status = 409;
            return { success: false, message: 'มีข้อมูลวันลาสะสมของบุคคลนี้ในปีงบประมาณนี้อยู่แล้ว' };
        }
        return serverError(set, 'createLeaveBalance', error);
    }
};

// ── แก้ไขยอดสะสม (ปรับยอดยกมา/สิทธิ์/ใช้ไปแล้ว/หมายเหตุ) ────────────────────
export const updateLeaveBalance = async ({ params, body, user, set }: any) => {
    try {
        const allowed = ['carried_in', 'entitled', 'used', 'note'];
        const patch: Record<string, any> = {};
        for (const k of allowed) if (k in body) patch[k] = body[k];
        if (Object.keys(patch).length === 0) {
            set.status = 400;
            return { success: false, message: 'ไม่มีข้อมูลให้บันทึก' };
        }
        patch.updated_by = user.id;
        patch.updated_at = new Date();
        const rows = await core_kon`
            UPDATE hr_leave_balances SET ${core_kon(patch)}
            WHERE id = ${params.id}
            RETURNING id, user_id, leave_type_id, fiscal_year, carried_in, entitled, used, remaining, note, updated_at`;
        if (rows.length === 0) { set.status = 404; return { success: false, message: 'ไม่พบข้อมูลวันลาสะสมนี้' }; }
        return { success: true, data: rows[0] };
    } catch (error: any) { return serverError(set, 'updateLeaveBalance', error); }
};

// ── ยกยอดปีงบประมาณใหม่แบบอัตโนมัติ ──────────────────────────────────────────
// ทำเฉพาะ "ลาพักผ่อน" (hr_leave_types.code = 'ANNUAL') เท่านั้น — ตามระเบียบราชการที่ให้สะสม
// ลาพักผ่อนได้เป็นหลัก จึงล็อกไว้ในโค้ด ไม่รับ leave_type_id จาก client เพื่อกันยกยอดประเภทอื่นผิดพลาด
// คัดลอกคงเหลือ (cap ตาม carry_over_max_days ของแต่ละคน) จาก from_fiscal_year → to_fiscal_year
// ไม่ทำซ้ำถ้าคนนั้นมีแถวของปีใหม่อยู่แล้ว (กันกดยกยอดซ้ำ)
export const rolloverLeaveBalances = async ({ body, user, set }: any) => {
    try {
        const { from_fiscal_year, to_fiscal_year } = body;
        if (to_fiscal_year <= from_fiscal_year) {
            set.status = 400;
            return { success: false, message: 'ปีงบประมาณใหม่ต้องมากกว่าปีเดิม' };
        }
        const [annual] = await core_kon`SELECT id FROM hr_leave_types WHERE code = 'ANNUAL'`;
        if (!annual) {
            set.status = 500;
            return { success: false, message: 'ไม่พบประเภทการลาพักผ่อน (ANNUAL) ในระบบ' };
        }
        const leaveTypeIds: number[] = [annual.id];

        let created = 0, skippedExisting = 0, skippedNoEntitlement = 0;

        await core_kon.begin(async (sql: any) => {
            for (const leaveTypeId of leaveTypeIds) {
                const candidates = await sql`
                    SELECT b.user_id, b.remaining
                    FROM hr_leave_balances b
                    WHERE b.leave_type_id = ${leaveTypeId} AND b.fiscal_year = ${from_fiscal_year}
                      AND NOT EXISTS (
                          SELECT 1 FROM hr_leave_balances b2
                          WHERE b2.user_id = b.user_id AND b2.leave_type_id = ${leaveTypeId} AND b2.fiscal_year = ${to_fiscal_year}
                      )`;
                for (const c of candidates) {
                    const entitlement = await findEntitlement(c.user_id, leaveTypeId);
                    if (!entitlement || !entitlement.carry_over) { skippedNoEntitlement++; continue; }
                    const cap = entitlement.carry_over_max_days;
                    const carriedIn = cap != null ? Math.min(Number(c.remaining), cap) : Number(c.remaining);
                    await sql`
                        INSERT INTO hr_leave_balances (user_id, leave_type_id, fiscal_year, carried_in, entitled, used, note, created_by, updated_by)
                        VALUES (${c.user_id}, ${leaveTypeId}, ${to_fiscal_year}, ${Math.max(carriedIn, 0)}, ${entitlement.max_days_per_year ?? 0}, 0,
                                ${'ยกยอดอัตโนมัติจากปีงบประมาณ ' + from_fiscal_year}, ${user.id}, ${user.id})`;
                    created++;
                }
                const existingCount = await sql`
                    SELECT COUNT(*)::int AS n FROM hr_leave_balances
                    WHERE leave_type_id = ${leaveTypeId} AND fiscal_year = ${from_fiscal_year}`;
                skippedExisting += existingCount[0].n - (candidates.length);
            }
        });

        return { success: true, data: { created, skipped_existing: skippedExisting, skipped_no_entitlement: skippedNoEntitlement } };
    } catch (error: any) { return serverError(set, 'rolloverLeaveBalances', error); }
};
