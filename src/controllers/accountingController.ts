import { core_kon, salaryPool } from '../db/db';

// log รายละเอียด error ฝั่ง server เท่านั้น — client ได้ข้อความกลางไม่เปิดเผย internal
const serverError = (set: any, fn: string, error: any) => {
    console.error(`[accountingController] ${fn}:`, error);
    set.status = 500;
    return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
};

// หาเลขที่เงินเดือน (users.salary_id) ของผู้ login — identity จาก JWT เท่านั้น
const getSalaryIdOf = async (userId: number): Promise<number | null> => {
    const rows = await core_kon`SELECT salary_id FROM users WHERE id = ${userId}`;
    return rows.length > 0 ? (rows[0].salary_id ?? null) : null;
};

const noSalaryId = (set: any) => {
    set.status = 409;
    return { success: false, code: 'no_salary_id', message: 'ยังไม่ได้ระบุเลขที่เงินเดือน' };
};

// สรุปเงินเดือนรายเดือนของผู้ login — ?year=<พ.ศ.> (ไม่ส่ง/ไม่มีข้อมูลปีนั้น = ปีล่าสุดที่มีข้อมูล)
// mt ใน dgpn_payrollmt เป็นงวดแบบ พ.ศ. รูปแบบ YYYYMM00 เช่น 25690600 = มิ.ย. 2569
export const getSalarySummary = async ({ user, query, set }: any) => {
    try {
        const salaryId = await getSalaryIdOf(user.id);
        if (salaryId == null) return noSalaryId(set);
        const sid = String(salaryId);

        const [yearRows] = await salaryPool.query(
            `SELECT DISTINCT LEFT(mt, 4) AS y FROM dgpn_payrollmt WHERE id = ? ORDER BY y DESC`, [sid]) as any;
        const years: number[] = yearRows.map((r: any) => Number(r.y));
        if (years.length === 0) {
            return { success: true, data: { salary_id: salaryId, years: [], year: null, months: [], profile: null } };
        }
        const year = query?.year && years.includes(Number(query.year)) ? Number(query.year) : years[0];

        const [monthRows] = await salaryPool.query(
            `SELECT p.mt,
                    SUM(CASE WHEN c.payrolltype = '1' THEN p.amt ELSE 0 END) AS income,
                    SUM(CASE WHEN c.payrolltype = '2' THEN p.amt ELSE 0 END) AS deduction
             FROM dgpn_payrollmt p
             JOIN cpayroll c ON c.code = p.code
             WHERE p.id = ? AND mt LIKE CONCAT(?, '%')
             GROUP BY p.mt
             ORDER BY p.mt DESC`, [sid, String(year)]) as any;
        const months = monthRows.map((r: any) => {
            const income = Number(r.income);
            const deduction = Number(r.deduction);
            return { mt: r.mt, income, deduction, net: +(income - deduction).toFixed(2) };
        });

        const [profileRows] = await salaryPool.query(
            `SELECT fname, lname, bank, bankbranch, accno FROM dgpn_payroll WHERE id = ? ORDER BY upddate DESC LIMIT 1`, [sid]) as any;

        return { success: true, data: { salary_id: salaryId, years, year, months, profile: profileRows[0] ?? null } };
    } catch (error: any) { return serverError(set, 'getSalarySummary', error); }
};

// รายละเอียดสลิปงวดเดียว (สำหรับดู/พิมพ์ PDF) — คืนรายการรายรับ/รายการหัก + ยอดรวม + ข้อมูลบัญชี
export const getSalarySlip = async ({ user, params, set }: any) => {
    try {
        const salaryId = await getSalaryIdOf(user.id);
        if (salaryId == null) return noSalaryId(set);
        const sid = String(salaryId);

        const [items] = await salaryPool.query(
            `SELECT p.code, c.name, c.payrolltype, p.amt
             FROM dgpn_payrollmt p
             JOIN cpayroll c ON c.code = p.code
             WHERE p.id = ? AND p.mt = ?
             ORDER BY c.payrolltype ASC, p.code ASC`, [sid, params.mt]) as any;
        if (items.length === 0) {
            set.status = 404;
            return { success: false, message: 'ไม่พบข้อมูลเงินเดือนงวดนี้' };
        }

        const earnings = items.filter((i: any) => i.payrolltype === '1')
            .map((i: any) => ({ code: i.code, label: i.name, amount: Number(i.amt) }));
        const deductions = items.filter((i: any) => i.payrolltype === '2')
            .map((i: any) => ({ code: i.code, label: i.name, amount: Number(i.amt) }));
        const totalEarnings = +earnings.reduce((s: number, e: any) => s + e.amount, 0).toFixed(2);
        const totalDeductions = +deductions.reduce((s: number, d: any) => s + d.amount, 0).toFixed(2);

        const [profileRows] = await salaryPool.query(
            `SELECT fname, lname, bank, bankbranch, accno FROM dgpn_payroll WHERE id = ? ORDER BY upddate DESC LIMIT 1`, [sid]) as any;

        return {
            success: true,
            data: {
                mt: params.mt,
                earnings,
                deductions,
                total_earnings: totalEarnings,
                total_deductions: totalDeductions,
                net: +(totalEarnings - totalDeductions).toFixed(2),
                profile: profileRows[0] ?? null,
            },
        };
    } catch (error: any) { return serverError(set, 'getSalarySlip', error); }
};
