import { core_kon } from '../db/db';
import { rolloverAnnualLeave, autoRolloverEnabled } from '../services/leaveRollover';

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
        // HR ตั้งยอดยกมาเอง — ระบบจะไม่ปรับยอดยกมาแถวนี้ทับอีก (syncCarriedForward)
        if ('carried_in' in patch) { patch.carried_from_fy = null; patch.auto_created = false; }
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
