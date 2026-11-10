// สรุปประวัติวันลารายบุคคล (ADMIN / HR) — หน้า /hr/leave/person-summary
// · รายชื่อบุคลากรที่ปฏิบัติงาน กรองกลุ่มภารกิจ / กลุ่มงาน / หน่วยงาน / ค้นชื่อ พร้อมตัวเลขย่อของปีงบ
// · รายคน: ใบลาในปีงบ (ตาราง + ไฟล์แนบ) · สรุปตามประเภท · วันลาพักผ่อน (ยกมา / สิทธิ์ปีนี้ / ใช้ / คงเหลือ)
//
// ปีงบของใบลา = ปีงบของวันเริ่มลา (ตรงกับ hrLeaveBalanceController / ยอดใน hr_leave_balances)
// นับวัน = days_deducted (ยอดที่หักจริงหลังงาน HR ตรวจ · ใบยกเลิก = 0)
// "ใช้แล้ว" = อนุมัติแล้ว + ขอยกเลิกที่ยังไม่อนุมัติ (ยังมีผลอยู่) · รออนุมัติแยกไว้ · ยกเลิก/ไม่อนุมัติไม่นับ
import { core_kon } from '../db/db';
import { isHrOrAdmin } from '../services/leaveSubject';
import { currentFiscalYear } from '../services/leaveRollover';

const fail = (set: any, status: number, message: string) => { set.status = status; return { success: false, message }; };
const COUNTED = ['APPROVED', 'CANCEL_PENDING'];
const ANNUAL = 'ANNUAL';
const MAX_PAGE_SIZE = 100;

/** บุคลากรที่ปฏิบัติงานอยู่ (alias u) — เกณฑ์เดียวกับทะเบียนบุคลากร */
const working = () => core_kon`u.is_active = 'Y' AND COALESCE(u.user_status_id, 1) = 1 AND (u.work_end_date IS NULL OR u.work_end_date >= CURRENT_DATE)`;
/** ช่วงวันที่ของปีงบ พ.ศ. — 1 ต.ค. ปีก่อน ถึง 30 ก.ย. */
const fyRange = (fy: number) => ({ from: `${fy - 544}-10-01`, to: `${fy - 543}-09-30` });
const fyOf = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 2500 && n < 2700 ? n : null; };
const idOf = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const num = (v: unknown) => Math.round(Number(v ?? 0) * 100) / 100;

const guard = async (user: any, set: any) =>
    (await isHrOrAdmin(Number(user?.id))) ? null : fail(set, 403, 'เฉพาะงานทรัพยากรบุคคลและผู้ดูแลระบบ');

// ตัวกรอง: กลุ่มภารกิจ → กลุ่มงาน → หน่วยงาน (ส่งรหัสแม่ไปด้วยเพื่อกรองรายการลูกที่หน้าเว็บ)
export const getPersonSummaryMeta = async ({ user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const [missions, majors, submajors, types] = await Promise.all([
            core_kon`SELECT mission_id AS id, BTRIM(name) AS name FROM missions WHERE is_active = 'Y' ORDER BY name`,
            core_kon`SELECT major_id AS id, BTRIM(name) AS name, mission_id FROM majors WHERE is_active = 'Y' ORDER BY name`,
            core_kon`SELECT submajor_id AS id, BTRIM(name) AS name, major_id FROM submajors WHERE is_active = 'Y' ORDER BY name`,
            core_kon`SELECT id, code, name_th FROM hr_leave_types WHERE is_active ORDER BY sort_order, id`,
        ]);
        return { success: true, data: { fiscal_year: currentFiscalYear(), missions, majors, submajors, leave_types: types } };
    } catch (e: any) {
        console.error('[leavePersonSummary] meta:', e?.message);
        return fail(set, 500, 'โหลดตัวกรองไม่สำเร็จ');
    }
};

// รายชื่อบุคลากร + ตัวเลขย่อของปีงบ (ครั้ง / วันที่ใช้ / แยกตามประเภท / รออนุมัติ / พักผ่อนคงเหลือ)
export const getPersonSummaryPeople = async ({ query, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const fy = fyOf(query?.fiscal_year) ?? currentFiscalYear();
        const { from, to } = fyRange(fy);
        const mission = idOf(query?.mission_id), major = idOf(query?.major_id), submajor = idOf(query?.submajor_id);
        const q = String(query?.q ?? '').trim().slice(0, 100);
        const like = q ? `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%` : null;
        const page = Math.max(1, Math.floor(Number(query?.page) || 1));
        const size = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(query?.page_size) || 20)));
        const where = core_kon`WHERE ${working()}
            ${mission ? core_kon`AND u.mission_id = ${mission}` : core_kon``}
            ${major ? core_kon`AND u.major_id = ${major}` : core_kon``}
            ${submajor ? core_kon`AND u.submajor_id = ${submajor}` : core_kon``}
            ${like ? core_kon`AND (CONCAT(u.pname, u.fname, ' ', u.lname) ILIKE ${like} OR CONCAT(u.fname, ' ', u.lname) ILIKE ${like})` : core_kon``}`;
        const [[{ total }], rows] = await Promise.all([
            core_kon`SELECT count(*)::int AS total FROM users u ${where}`,
            core_kon`
                SELECT u.id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, up.position_name AS position, ut.type_name AS user_type,
                       BTRIM(mi.name) AS mission_name, BTRIM(ma.name) AS major_name, BTRIM(sm.name) AS submajor_name,
                       COALESCE(s.leave_count, 0)::int AS leave_count, COALESCE(s.leave_days, 0)::float8 AS leave_days,
                       COALESCE(s.pending_days, 0)::float8 AS pending_days, b.remaining::float8 AS annual_remaining,
                       COALESCE(bt.by_type, '{}'::jsonb) AS by_type
                FROM users u
                LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
                LEFT JOIN user_types ut ON ut.user_type_id = u.user_type_id
                LEFT JOIN missions mi ON mi.mission_id = u.mission_id
                LEFT JOIN majors ma ON ma.major_id = u.major_id
                LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
                LEFT JOIN LATERAL (
                    SELECT count(*) FILTER (WHERE r.status IN ${core_kon(COUNTED)}) AS leave_count,
                           SUM(r.days_deducted) FILTER (WHERE r.status IN ${core_kon(COUNTED)}) AS leave_days,
                           SUM(r.days_deducted) FILTER (WHERE r.status = 'PENDING') AS pending_days
                    FROM hr_leave_requests r
                    WHERE r.user_id = u.id AND r.start_date BETWEEN ${from}::date AND ${to}::date
                ) s ON TRUE
                -- แยกตามประเภท (นับเฉพาะที่มีผล) → { "SICK": { "days": 2, "count": 1 }, ... } มีเฉพาะประเภทที่ลา
                LEFT JOIN LATERAL (
                    SELECT jsonb_object_agg(t.code, jsonb_build_object('days', x.days, 'count', x.cnt)) AS by_type
                    FROM (
                        SELECT r.leave_type_id, SUM(r.days_deducted)::float8 AS days, count(*)::int AS cnt
                        FROM hr_leave_requests r
                        WHERE r.user_id = u.id AND r.start_date BETWEEN ${from}::date AND ${to}::date AND r.status IN ${core_kon(COUNTED)}
                        GROUP BY r.leave_type_id
                    ) x JOIN hr_leave_types t ON t.id = x.leave_type_id
                ) bt ON TRUE
                LEFT JOIN hr_leave_balances b ON b.user_id = u.id AND b.fiscal_year = ${fy}
                     AND b.leave_type_id = (SELECT id FROM hr_leave_types WHERE code = ${ANNUAL})
                ${where}
                ORDER BY u.fname, u.lname, u.id
                LIMIT ${size} OFFSET ${(page - 1) * size}`,
        ]);
        return { success: true, data: { fiscal_year: fy, rows, total, page, page_size: size } };
    } catch (e: any) {
        console.error('[leavePersonSummary] people:', e?.message);
        return fail(set, 500, 'โหลดรายชื่อบุคลากรไม่สำเร็จ');
    }
};

// รายละเอียดรายคนในปีงบ — ไม่ส่ง fiscal_year = ปีงบปัจจุบัน
// ดูได้ทั้งคนที่พ้นสภาพแล้ว (เปิดจากลิงก์เดิม) แต่รายชื่อหน้าแรกแสดงเฉพาะผู้ปฏิบัติงาน
export const getPersonSummaryDetail = async ({ params, query, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const uid = idOf(params?.id);
        if (!uid) return fail(set, 400, 'รหัสบุคลากรไม่ถูกต้อง');
        const current = currentFiscalYear();
        const fy = fyOf(query?.fiscal_year) ?? current;
        const { from, to } = fyRange(fy);
        const fyExpr = core_kon`((CASE WHEN EXTRACT(MONTH FROM start_date) >= 10 THEN EXTRACT(YEAR FROM start_date) + 1 ELSE EXTRACT(YEAR FROM start_date) END)::int + 543)`;
        const [[person], years, requests, types, [annual]] = await Promise.all([
            core_kon`
                SELECT u.id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, up.position_name AS position, ut.type_name AS user_type,
                       BTRIM(mi.name) AS mission_name, BTRIM(ma.name) AS major_name, BTRIM(sm.name) AS submajor_name,
                       u.hire_date, (${working()}) AS working, us.name AS status_name
                FROM users u
                LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
                LEFT JOIN user_types ut ON ut.user_type_id = u.user_type_id
                LEFT JOIN missions mi ON mi.mission_id = u.mission_id
                LEFT JOIN majors ma ON ma.major_id = u.major_id
                LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
                LEFT JOIN user_statuses us ON us.user_status_id = u.user_status_id
                WHERE u.id = ${uid}`,
            // ปีงบที่เลือกได้ = ปีที่มีใบลา + ปีที่มียอดวันลา (ไม่เกินปีปัจจุบัน) + ปีปัจจุบัน
            core_kon`
                SELECT fy FROM (
                    SELECT DISTINCT ${fyExpr} AS fy FROM hr_leave_requests WHERE user_id = ${uid}
                    UNION SELECT DISTINCT fiscal_year FROM hr_leave_balances WHERE user_id = ${uid} AND fiscal_year <= ${current}
                    UNION SELECT ${current}::int
                ) x ORDER BY fy DESC`,
            core_kon`
                SELECT r.id, t.code AS leave_type_code, t.name_th AS leave_type_name, r.start_date, r.end_date,
                       r.total_days::float8 AS total_days, r.days_deducted::float8 AS days_deducted,
                       r.is_half_day, r.half_day_period, r.status, r.reason, r.reject_reason,
                       NULLIF(TRIM(r.document_url), '') AS document_name, r.created_at, r.day_check_status
                FROM hr_leave_requests r JOIN hr_leave_types t ON t.id = r.leave_type_id
                WHERE r.user_id = ${uid} AND r.start_date BETWEEN ${from}::date AND ${to}::date
                ORDER BY r.start_date DESC, r.id DESC`,
            core_kon`SELECT id, code, name_th FROM hr_leave_types WHERE is_active ORDER BY sort_order, id`,
            core_kon`
                SELECT b.carried_in::float8 AS carried_in, b.carried_from_fy, b.entitled::float8 AS entitled,
                       b.used::float8 AS used, b.remaining::float8 AS remaining
                FROM hr_leave_balances b JOIN hr_leave_types t ON t.id = b.leave_type_id
                WHERE b.user_id = ${uid} AND b.fiscal_year = ${fy} AND t.code = ${ANNUAL}`,
        ]);
        if (!person) return fail(set, 404, 'ไม่พบบุคลากร');

        // สรุปตามประเภท — ประเภทที่ใช้งานอยู่ทุกตัว + ประเภทที่ปิดแล้วแต่มีใบลาในปีนี้
        const typeList = [...types];
        for (const r of requests) if (!typeList.some((t: any) => t.code === r.leave_type_code)) typeList.push({ id: 0, code: r.leave_type_code, name_th: r.leave_type_name });
        const byType = typeList.map((t: any) => {
            const mine = requests.filter((r: any) => r.leave_type_code === t.code);
            const counted = mine.filter((r: any) => COUNTED.includes(r.status));
            const pending = mine.filter((r: any) => r.status === 'PENDING');
            return {
                code: t.code, name_th: t.name_th,
                count: counted.length, days: num(counted.reduce((n: number, r: any) => n + (r.days_deducted ?? 0), 0)),
                pending_count: pending.length, pending_days: num(pending.reduce((n: number, r: any) => n + (r.days_deducted ?? 0), 0)),
            };
        });
        const annualType = byType.find(t => t.code === ANNUAL);
        const totals = {
            count: byType.reduce((n, t) => n + t.count, 0), days: num(byType.reduce((n, t) => n + t.days, 0)),
            pending_count: byType.reduce((n, t) => n + t.pending_count, 0), pending_days: num(byType.reduce((n, t) => n + t.pending_days, 0)),
        };
        return {
            success: true,
            data: {
                fiscal_year: fy, current_fiscal_year: current, years: years.map((y: any) => Number(y.fy)),
                person, requests, by_type: byType, totals,
                // ยอดในตาราง hr_leave_balances เป็นหลัก (ใช้ = ใบอนุมัติ + ใบรออนุมัติ ตามที่ระบบหักไว้)
                annual: annual ? {
                    ...annual, total: num(annual.carried_in + annual.entitled),
                    approved_days: annualType?.days ?? 0, pending_days: annualType?.pending_days ?? 0,
                } : null,
            },
        };
    } catch (e: any) {
        console.error('[leavePersonSummary] detail:', e?.message);
        return fail(set, 500, 'โหลดประวัติการลาไม่สำเร็จ');
    }
};
