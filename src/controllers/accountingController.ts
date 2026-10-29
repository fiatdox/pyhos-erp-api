import { core_kon, salaryPool } from '../db/db';
import { positionWithLevel } from '../utils/position';

// log รายละเอียด error ฝั่ง server เท่านั้น — client ได้ข้อความกลางไม่เปิดเผย internal
const serverError = (set: any, fn: string, error: any) => {
    console.error(`[accountingController] ${fn}:`, error);
    set.status = 500;
    return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
};

// หาเลขที่เงินเดือน "ทุกเลข" ของผู้ login — identity จาก JWT เท่านั้น
// 1 คนอาจมีหลายเลข (เช่น ลูกจ้าง → บรรจุเป็นข้าราชการ ได้เลขใหม่)
// ต้องดึงข้ามทุกเลข ไม่งั้นสลิปช่วงก่อนบรรจุจะหายไป
// รวมจาก user_salary_ids และ users.salary_id (เผื่อยังไม่ได้ย้ายเข้าตารางใหม่)
const getSalaryIdsOf = async (userId: number): Promise<number[]> => {
    const rows = await core_kon`
        SELECT salary_id FROM user_salary_ids WHERE user_id = ${userId}
        UNION
        SELECT salary_id FROM users WHERE id = ${userId} AND salary_id IS NOT NULL AND salary_id > 0`;
    return rows.map((r: any) => Number(r.salary_id)).filter((n: number) => Number.isFinite(n) && n > 0);
};

// เลขปัจจุบัน — ใช้เลือกโปรไฟล์/บัญชีธนาคารล่าสุดมาแสดง
const currentSalaryIdOf = async (userId: number, all: number[]): Promise<number> => {
    const [cur] = await core_kon`
        SELECT salary_id FROM user_salary_ids WHERE user_id = ${userId} AND is_current LIMIT 1`;
    return cur?.salary_id != null && all.includes(Number(cur.salary_id)) ? Number(cur.salary_id) : all[0]!;
};

const noSalaryId = (set: any) => {
    set.status = 409;
    return { success: false, code: 'no_salary_id', message: 'ยังไม่ได้ระบุเลขที่เงินเดือน' };
};

// สร้าง placeholder (?, ?, ...) สำหรับ IN clause ของ MySQL
const inList = (ids: number[]) => ids.map(() => '?').join(',');

// ⚠️ dgpn_payrollmt.id / dgpn_payroll.id เป็น VARCHAR(13)
// ถ้าส่งค่าเป็น number MySQL จะแปลงชนิดข้อมูลแล้ว "ทิ้ง index" → full scan ~1.6 ล้านแถว (ช้ากว่า 400 เท่า)
// จึงต้องส่งเป็น string เสมอ
const asParams = (ids: number[]) => ids.map(String);

// สรุปเงินเดือนรายเดือนของผู้ login — ?year=<พ.ศ.> (ไม่ส่ง/ไม่มีข้อมูลปีนั้น = ปีล่าสุดที่มีข้อมูล)
// mt ใน dgpn_payrollmt เป็นงวดแบบ พ.ศ. รูปแบบ YYYYMM00 เช่น 25690600 = มิ.ย. 2569
export const getSalarySummary = async ({ user, query, set }: any) => {
    try {
        const salaryIds = await getSalaryIdsOf(user.id);
        if (salaryIds.length === 0) return noSalaryId(set);
        const currentId = await currentSalaryIdOf(user.id, salaryIds);
        const ph = inList(salaryIds);
        const sids = asParams(salaryIds);

        const [yearRows] = await salaryPool.query(
            `SELECT DISTINCT LEFT(mt, 4) AS y FROM dgpn_payrollmt WHERE id IN (${ph}) ORDER BY y DESC`, sids) as any;
        const years: number[] = yearRows.map((r: any) => Number(r.y));
        if (years.length === 0) {
            return { success: true, data: { salary_id: currentId, salary_ids: salaryIds, years: [], year: null, months: [], profile: null } };
        }
        const year = query?.year && years.includes(Number(query.year)) ? Number(query.year) : years[0];

        // รวมยอดข้ามทุกเลข — ถ้างวดเดียวกันมีข้อมูลจากหลายเลข (ช่วงคาบเกี่ยวตอนเปลี่ยนเลข) จะรวมเป็นงวดเดียว
        const [monthRows] = await salaryPool.query(
            `SELECT p.mt,
                    SUM(CASE WHEN c.payrolltype = '1' THEN p.amt ELSE 0 END) AS income,
                    SUM(CASE WHEN c.payrolltype = '2' THEN p.amt ELSE 0 END) AS deduction,
                    COUNT(DISTINCT p.id) AS id_count,
                    GROUP_CONCAT(DISTINCT p.id ORDER BY p.id) AS ids
             FROM dgpn_payrollmt p
             JOIN cpayroll c ON c.code = p.code
             WHERE p.id IN (${ph}) AND mt LIKE CONCAT(?, '%')
             GROUP BY p.mt
             ORDER BY p.mt DESC`, [...sids, String(year)]) as any;
        const months = monthRows.map((r: any) => {
            const income = Number(r.income);
            const deduction = Number(r.deduction);
            return {
                mt: r.mt, income, deduction, net: +(income - deduction).toFixed(2),
                // งวดที่มีข้อมูลจากหลายเลข — ให้หน้าจอเตือนได้ว่าเป็นช่วงคาบเกี่ยว
                multi_source: Number(r.id_count) > 1,
                // เลขที่เงินเดือนที่จ่ายจริงในงวดนี้ (คนที่เปลี่ยนเลข งวดเก่าจะเป็นเลขเดิม)
                salary_ids: String(r.ids ?? '').split(',').filter(Boolean),
            };
        });

        // โปรไฟล์/บัญชีธนาคาร — ใช้ระเบียนล่าสุดในบรรดาทุกเลข
        const [profileRows] = await salaryPool.query(
            `SELECT fname, lname, bank, bankbranch, accno FROM dgpn_payroll
             WHERE id IN (${ph}) ORDER BY upddate DESC LIMIT 1`, sids) as any;

        return { success: true, data: { salary_id: currentId, salary_ids: salaryIds, years, year, months, profile: profileRows[0] ?? null } };
    } catch (error: any) { return serverError(set, 'getSalarySummary', error); }
};

/**
 * รายการรายรับ/รายการหักของงวดเดียว รวมข้ามทุกเลขที่ส่งมา — รหัสรายการเดียวกันจากคนละเลขรวมยอดกัน
 * ใช้ทั้งสลิปของตัวเอง และหน้าทะเบียนเงินเดือนของเจ้าหน้าที่ · ไม่มีรายการ = null
 */
export const slipItems = async (sids: string[], mt: string) => {
    const ph = sids.map(() => '?').join(',');
    const [[items], [idRows]] = await Promise.all([
        salaryPool.query(
            `SELECT p.code, c.name, c.payrolltype, SUM(p.amt) AS amt
             FROM dgpn_payrollmt p
             JOIN cpayroll c ON c.code = p.code
             WHERE p.id IN (${ph}) AND p.mt = ?
             GROUP BY p.code, c.name, c.payrolltype
             ORDER BY c.payrolltype ASC, p.code ASC`, [...sids, mt]),
        salaryPool.query(`SELECT DISTINCT id FROM dgpn_payrollmt WHERE id IN (${ph}) AND mt = ? ORDER BY id`, [...sids, mt]),
    ]) as any;
    if (items.length === 0) return null;

    const earnings = items.filter((i: any) => i.payrolltype === '1')
        .map((i: any) => ({ code: i.code, label: i.name, amount: Number(i.amt) }));
    const deductions = items.filter((i: any) => i.payrolltype === '2')
        .map((i: any) => ({ code: i.code, label: i.name, amount: Number(i.amt) }));
    const totalEarnings = +earnings.reduce((s: number, e: any) => s + e.amount, 0).toFixed(2);
    const totalDeductions = +deductions.reduce((s: number, d: any) => s + d.amount, 0).toFixed(2);
    return {
        mt,
        // เลขที่เงินเดือนที่มีรายการในงวดนี้จริง
        salary_ids: idRows.map((r: any) => String(r.id)),
        earnings,
        deductions,
        total_earnings: totalEarnings,
        total_deductions: totalDeductions,
        net: +(totalEarnings - totalDeductions).toFixed(2),
    };
};

/** ตำแหน่ง/ประเภท/กลุ่มงานของผู้ใช้สำหรับหัวสลิป — อ่านจาก DB ปัจจุบัน ไม่ใช่ cookie ตอน login */
export const slipEmployeeOf = async (userId: number) => {
    const [u] = await core_kon`
        SELECT up.position_name, ul.level_name, u.user_type_id, ut.type_name, m1."name" AS major_name
        FROM users u
        LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
        LEFT JOIN user_levels    ul ON ul.user_level_id    = u.user_level_id
        LEFT JOIN user_types     ut ON ut.user_type_id     = u.user_type_id
        LEFT JOIN majors         m1 ON m1.major_id         = u.major_id
        WHERE u.id = ${userId}`;
    if (!u) return null;
    return {
        position: positionWithLevel(u.position_name, u.level_name, u.user_type_id),
        staff_type: u.type_name ?? '',
        department: u.major_name ?? '',
    };
};

// รายละเอียดสลิปงวดเดียว (สำหรับดู/พิมพ์ PDF) — คืนรายการรายรับ/รายการหัก + ยอดรวม + ข้อมูลบัญชี
export const getSalarySlip = async ({ user, params, set }: any) => {
    try {
        const salaryIds = await getSalaryIdsOf(user.id);
        if (salaryIds.length === 0) return noSalaryId(set);
        const ph = inList(salaryIds);
        const sids = asParams(salaryIds);

        const slip = await slipItems(sids, params.mt);
        if (!slip) {
            set.status = 404;
            return { success: false, message: 'ไม่พบข้อมูลเงินเดือนงวดนี้' };
        }

        const [[profileRows], employee] = await Promise.all([
            salaryPool.query(
                `SELECT fname, lname, bank, bankbranch, accno FROM dgpn_payroll
                 WHERE id IN (${ph}) ORDER BY upddate DESC LIMIT 1`, sids) as any,
            slipEmployeeOf(user.id),
        ]);

        return { success: true, data: { ...slip, profile: profileRows[0] ?? null, employee } };
    } catch (error: any) { return serverError(set, 'getSalarySlip', error); }
};
