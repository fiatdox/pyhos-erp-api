// ทะเบียนเงินเดือนบุคลากร (อ่านอย่างเดียว) จากฐาน salarydb — รายชื่อใน dgpn_payroll + ยอดรายงวดจาก dgpn_payrollmt
// สิทธิ์: IT_STAFF · ADMIN (เมนูอยู่ใน sidebar ขวา) — เป็นข้อมูลอ่อนไหว จึงไม่ส่งเลขบัตรประชาชน/เลขผู้เสียภาษี
// และเลขบัญชีส่งเฉพาะ 4 ตัวท้าย
//
// ⚠️ dgpn_payrollmt PK = (id, mt, code) → ค้นด้วย id เร็ว แต่ค้นด้วย mt อย่างเดียวต้อง full scan (~3 วินาที)
//    จึงโหลดทะเบียน (dgpn_payroll ~3 พันแถว) มาแคชสั้นๆ แล้วกรอง/แบ่งหน้าในหน่วยความจำ
//    และดึงยอดงวดเฉพาะ id ของหน้าที่แสดงเท่านั้น (ส่ง id เป็น string เพื่อใช้ index)
import { core_kon, salaryPool } from '../db/db';
import { hasAccess, userRoles, nameMatch, type NameMatch } from './salaryIdController';
import { slipItems, slipEmployeeOf } from './accountingController';

const err = (set: any, status: number, message: string) => {
    set.status = status;
    return { success: false, message };
};

type RegRow = {
    id: string; name: string; fname: string; lname: string; ptype: string | null; ptype_name: string | null
    seccode: string | null; section_name: string | null
    bank: string | null; bankbranch: string | null; acc_masked: string | null
    paytype: string | null; upddate: string | null
}

const norm = (v: any) => (v == null || v === '' ? null : String(Number.isNaN(Number(v)) ? v : Number(v)));
const mask = (acc: any) => {
    const d = String(acc ?? '').replace(/\D/g, '');
    return d.length >= 4 ? `••••${d.slice(-4)}` : null;
};

let cache: { at: number; rows: RegRow[]; ptypes: { value: string; label: string }[]; sections: { value: string; label: string }[] } | null = null;
const CACHE_MS = 60_000;

async function loadRegister() {
    if (cache && Date.now() - cache.at < CACHE_MS) return cache;
    const [[reg], [types], [secs], [prefixes]]: any = await Promise.all([
        salaryPool.query(`SELECT id, ptype, paytype, bank, bankbranch, accno, fname, lname, seccode, pcode, upddate FROM dgpn_payroll`),
        salaryPool.query(`SELECT ptype, ptypename FROM cpersontype`),
        salaryPool.query(`SELECT seccode, secname FROM c_payrollsec`),
        salaryPool.query(`SELECT pcode, prefix FROM cprefix`),
    ]);
    const typeName = new Map<string, string>(types.map((t: any) => [norm(t.ptype)!, String(t.ptypename)]));
    const secName = new Map<string, string>(secs.map((s: any) => [norm(s.seccode)!, String(s.secname)]));
    const prefix = new Map<string, string>(prefixes.map((p: any) => [norm(p.pcode)!, String(p.prefix ?? '')]));

    const rows: RegRow[] = reg.map((r: any) => {
        const pt = norm(r.ptype), sc = norm(r.seccode);
        return {
            id: String(r.id),
            name: `${prefix.get(norm(r.pcode) ?? '') ?? ''}${r.fname ?? ''} ${r.lname ?? ''}`.trim(),
            fname: String(r.fname ?? '').trim(), lname: String(r.lname ?? '').trim(),
            ptype: pt, ptype_name: pt ? typeName.get(pt) ?? null : null,
            seccode: sc, section_name: sc ? secName.get(sc) ?? null : null,
            bank: r.bank ?? null, bankbranch: r.bankbranch ?? null, acc_masked: mask(r.accno),
            paytype: r.paytype ?? null, upddate: r.upddate ? new Date(r.upddate).toISOString() : null,
        };
    });
    cache = {
        at: Date.now(), rows,
        ptypes: types.map((t: any) => ({ value: norm(t.ptype)!, label: String(t.ptypename) })),
        sections: secs.map((s: any) => ({ value: norm(s.seccode)!, label: String(s.secname) }))
            .sort((a: any, b: any) => a.label.localeCompare(b.label, 'th')),
    };
    return cache;
}

// เลขที่เงินเดือน → ผู้ใช้ในระบบที่ผูกไว้ (user_salary_ids + users.salary_id เผื่อยังไม่ย้าย)
type LinkedUser = { id: number; name: string; fname: string; lname: string };
async function linkedUsers(): Promise<Map<string, LinkedUser>> {
    const rows = await core_kon`
        SELECT x.salary_id, u.id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, u.fname, u.lname
        FROM user_salary_ids x JOIN users u ON u.id = x.user_id
        UNION
        SELECT u.salary_id, u.id, CONCAT(u.pname, u.fname, ' ', u.lname), u.fname, u.lname
        FROM users u WHERE u.salary_id IS NOT NULL AND u.salary_id > 0`;
    const m = new Map<string, LinkedUser>();
    for (const r of rows) m.set(String(r.salary_id), { id: Number(r.id), name: String(r.name), fname: String(r.fname ?? ''), lname: String(r.lname ?? '') });
    return m;
}

// id ที่มีรายการเงินเดือนในงวดนั้น — ค้นด้วย mt ต้อง full scan (~3 วินาที) จึงแคชไว้ต่องวด
const periodCache = new Map<string, { at: number; ids: Set<string> }>();
const PERIOD_CACHE_MS = 10 * 60_000;
async function idsInPeriod(mt: string): Promise<Set<string>> {
    const hit = periodCache.get(mt);
    if (hit && Date.now() - hit.at < PERIOD_CACHE_MS) return hit.ids;
    const [rows]: any = await salaryPool.query(`SELECT DISTINCT id FROM dgpn_payrollmt WHERE mt = ?`, [mt]);
    const ids = new Set<string>(rows.map((r: any) => String(r.id)));
    periodCache.set(mt, { at: Date.now(), ids });
    return ids;
}

// 24 งวดล่าสุด (mt = พ.ศ. YYYYMM00) ให้เลือกดู — ไม่ query หา distinct mt เพราะต้อง full scan
function recentPeriods(n = 24): string[] {
    const out: string[] = [];
    const d = new Date();
    let y = d.getFullYear() + 543, m = d.getMonth() + 1;
    for (let i = 0; i < n; i++) {
        out.push(`${y}${String(m).padStart(2, '0')}00`);
        if (--m === 0) { m = 12; y--; }
    }
    return out;
}

export const getSalaryRegister = async ({ query, user, set }: any) => {
    try {
        if (!hasAccess(await userRoles(Number(user?.id)))) return err(set, 403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');

        const periods = recentPeriods();
        const mt = query?.mt && /^\d{8}$/.test(String(query.mt)) ? String(query.mt) : periods[0];
        const search = String(query?.search ?? '').trim().toLowerCase();
        const ptype = query?.ptype ? String(query.ptype) : null;
        const seccode = query?.seccode ? String(query.seccode) : null;
        const link = String(query?.link ?? 'all');          // all | linked | unlinked
        const scope = String(query?.scope ?? 'period');     // period = เฉพาะผู้มีเงินเดือนในงวดนี้ | all = ทะเบียนทั้งหมด (รวมผู้ออกไปแล้ว)
        const limit = Math.min(Number(query?.limit ?? 50) || 50, 200);
        const offset = Math.max(Number(query?.offset ?? 0) || 0, 0);

        const [reg, linked, inPeriod] = await Promise.all([loadRegister(), linkedUsers(), idsInPeriod(mt)]);

        let list = reg.rows;
        if (scope === 'period') list = list.filter(r => inPeriod.has(r.id));
        if (ptype) list = list.filter(r => r.ptype === ptype);
        if (seccode) list = list.filter(r => r.seccode === seccode);
        if (link === 'linked') list = list.filter(r => linked.has(r.id));
        if (link === 'unlinked') list = list.filter(r => !linked.has(r.id));
        if (search) list = list.filter(r => r.id.includes(search) || r.name.toLowerCase().includes(search));
        list = [...list].sort((a, b) => a.name.localeCompare(b.name, 'th'));

        const pageRows = list.slice(offset, offset + limit);

        // ยอดของงวดที่เลือก เฉพาะ id ในหน้านี้ (ใช้ PK prefix id)
        const amounts = new Map<string, { income: number; deduction: number }>();
        if (pageRows.length > 0) {
            const ph = pageRows.map(() => '?').join(',');
            const [m]: any = await salaryPool.query(
                `SELECT p.id,
                        SUM(CASE WHEN c.payrolltype = '1' THEN p.amt ELSE 0 END) AS income,
                        SUM(CASE WHEN c.payrolltype = '2' THEN p.amt ELSE 0 END) AS deduction
                 FROM dgpn_payrollmt p JOIN cpayroll c ON c.code = p.code
                 WHERE p.id IN (${ph}) AND p.mt = ?
                 GROUP BY p.id`, [...pageRows.map(r => r.id), mt]);
            for (const r of m) amounts.set(String(r.id), { income: Number(r.income), deduction: Number(r.deduction) });
        }

        const total = reg.rows.length;
        const linkedCount = reg.rows.filter(r => linked.has(r.id)).length;
        return {
            success: true,
            data: {
                mt, periods, total: list.length, limit, offset,
                rows: pageRows.map(r => {
                    const a = amounts.get(r.id);
                    return {
                        ...r,
                        income: a ? a.income : null,
                        deduction: a ? a.deduction : null,
                        net: a ? +(a.income - a.deduction).toFixed(2) : null,
                        linked_user: linked.get(r.id) ?? null,
                        // ชื่อผู้ใช้ที่ผูกไว้ตรงกับชื่อในทะเบียนหรือไม่ (ตรวจว่าผูกถูกคน)
                        name_match: (linked.has(r.id) ? nameMatch(linked.get(r.id)!, r) : 'unknown') as NameMatch,
                    };
                }),
                ptypes: reg.ptypes, sections: reg.sections,
                stats: { total, in_period: reg.rows.filter(r => inPeriod.has(r.id)).length, linked: linkedCount, unlinked: total - linkedCount },
            },
        };
    } catch (e: any) {
        console.error('[salaryRegister] getSalaryRegister:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// ประวัติเงินเดือนรายงวดของ 1 เลข (ปีที่เลือก) — ยอดรวมรายรับ/รายการหัก/สุทธิต่องวด
export const getSalaryRegisterDetail = async ({ params, query, user, set }: any) => {
    try {
        if (!hasAccess(await userRoles(Number(user?.id)))) return err(set, 403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
        const id = String(params.id);

        const [reg, linked] = await Promise.all([loadRegister(), linkedUsers()]);
        const person = reg.rows.find(r => r.id === id);
        if (!person) return err(set, 404, 'ไม่พบเลขที่เงินเดือนนี้ในทะเบียน');

        const [yearRows]: any = await salaryPool.query(
            `SELECT DISTINCT LEFT(mt, 4) AS y FROM dgpn_payrollmt WHERE id = ? ORDER BY y DESC`, [id]);
        const years: number[] = yearRows.map((r: any) => Number(r.y)).filter((n: number) => n > 0);
        const year = query?.year && years.includes(Number(query.year)) ? Number(query.year) : (years[0] ?? null);

        let months: any[] = [];
        if (year) {
            const [m]: any = await salaryPool.query(
                `SELECT p.mt,
                        SUM(CASE WHEN c.payrolltype = '1' THEN p.amt ELSE 0 END) AS income,
                        SUM(CASE WHEN c.payrolltype = '2' THEN p.amt ELSE 0 END) AS deduction
                 FROM dgpn_payrollmt p JOIN cpayroll c ON c.code = p.code
                 WHERE p.id = ? AND p.mt LIKE CONCAT(?, '%')
                 GROUP BY p.mt ORDER BY p.mt DESC`, [id, String(year)]);
            months = m.map((r: any) => {
                const income = Number(r.income), deduction = Number(r.deduction);
                return { mt: r.mt, income, deduction, net: +(income - deduction).toFixed(2) };
            });
        }

        return { success: true, data: { person: { ...person, linked_user: linked.get(id) ?? null, name_match: (linked.has(id) ? nameMatch(linked.get(id)!, person) : 'unknown') as NameMatch }, years, year, months } };
    } catch (e: any) {
        console.error('[salaryRegister] getSalaryRegisterDetail:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// รายละเอียดเงินเดือนงวดเดียวของ 1 เลข — รายการรายรับ/รายการหักและยอดรวม (ไม่ส่งเลขบัญชี)
export const getSalaryRegisterSlip = async ({ params, user, set }: any) => {
    try {
        if (!hasAccess(await userRoles(Number(user?.id)))) return err(set, 403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
        const [slip, linked] = await Promise.all([slipItems([String(params.id)], String(params.mt)), linkedUsers()]);
        if (!slip) return err(set, 404, 'ไม่พบข้อมูลเงินเดือนงวดนี้');
        // ผูกกับผู้ใช้แล้ว → ส่งหัวสลิป (ชื่อ ตำแหน่ง กลุ่มงาน) ให้พิมพ์ PDF ได้ · ไม่ส่งเลขบัญชีธนาคาร
        const lu = linked.get(String(params.id));
        const employee = lu ? await slipEmployeeOf(lu.id) : null;
        return { success: true, data: { ...slip, linked_user: lu ? { id: lu.id, name: lu.name } : null, employee } };
    } catch (e: any) {
        console.error('[salaryRegister] getSalaryRegisterSlip:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// ดูข้อมูลของเลขที่เงินเดือนก่อนผูก (พรีวิวชื่อ/ประเภท/ช่วงงวด/ผู้ที่ผูกอยู่) — ใช้ตรวจความถูกต้องตอนผูกเลข
// ?user_id= ใส่เพื่อให้เทียบชื่อกับผู้ใช้ที่กำลังจะผูกด้วย
export const getSalaryIdLookup = async ({ params, query, user, set }: any) => {
    try {
        if (!hasAccess(await userRoles(Number(user?.id)))) return err(set, 403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
        const id = String(params.salaryId);
        const [reg, linked] = await Promise.all([loadRegister(), linkedUsers()]);
        const person = reg.rows.find(r => r.id === id);
        if (!person) return err(set, 404, `ไม่พบเลขที่เงินเดือน ${id} ในทะเบียน`);

        let match: NameMatch = 'unknown';
        if (query?.user_id) {
            const [u] = await core_kon`SELECT fname, lname FROM users WHERE id = ${Number(query.user_id)}`;
            if (u) match = nameMatch(u, person);
        }
        const [p]: any = await salaryPool.query(`SELECT MIN(mt) AS f, MAX(mt) AS t, COUNT(DISTINCT mt) AS n FROM dgpn_payrollmt WHERE id = ?`, [id]);
        return {
            success: true,
            data: {
                salary_id: Number(id), name: person.name, ptype_name: person.ptype_name, section_name: person.section_name,
                period: p[0]?.f ? { from: p[0].f, to: p[0].t, count: Number(p[0].n) } : null,
                taken_by: linked.get(id)?.name ?? null, name_match: match,
            },
        };
    } catch (e: any) {
        console.error('[salaryRegister] getSalaryIdLookup:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};
