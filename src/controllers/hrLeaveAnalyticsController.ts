// ── วิเคราะห์การลาเชิงลึก (หน้า /hr/leave/dashboard — ADMIN / HR) ─────────────────
// ส่งใบลาทั้งปีงบเป็นรายใบพร้อมข้อมูลประกอบ ให้หน้าเว็บสรุปตามตัวกรองเอง (ปีหนึ่งราว 1–2 พันใบ)
// + จำนวนบุคลากรแต่ละกลุ่มงาน (ใช้คิดอัตราวันลาต่อคน) + ยอดวันลาพักผ่อนของทุกคน (ใช้ดูการใช้สิทธิ์)
import { core_kon } from '../db/db';
import { countWithHolidays, holidaysBetween } from '../services/leaveDays';
import { parseChain } from '../services/leaveChain';

const isoDate = (v: unknown): string => {
    if (v instanceof Date) {
        const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return String(v ?? '').slice(0, 10);
};

/** วันหยุดที่อยู่ในช่วงใบลา — เสาร์ / อาทิตย์ / วันหยุดราชการ (ใช้อธิบายว่าทำไมจำนวนวันในใบไม่ตรงกฎนับวันทำการ) */
const offDaysIn = (start: string, end: string, holidays: Map<string, string>) => {
    const out: { date: string; kind: 'SAT' | 'SUN' | 'HOLIDAY'; name?: string }[] = [];
    for (let d = new Date(`${start}T00:00:00Z`); d <= new Date(`${end}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
        const iso = d.toISOString().slice(0, 10), wd = d.getUTCDay();
        if (holidays.has(iso)) out.push({ date: iso, kind: 'HOLIDAY', name: holidays.get(iso) });
        else if (wd === 6) out.push({ date: iso, kind: 'SAT' });
        else if (wd === 0) out.push({ date: iso, kind: 'SUN' });
        if (out.length > 60) break;
    }
    return out;
};

const currentFY = () => {
    const now = new Date();
    return now.getMonth() >= 9 ? now.getFullYear() + 544 : now.getFullYear() + 543;
};

export const getLeaveAnalytics = async ({ query, set }: any) => {
    try {
        const q = Number(query?.fiscal_year);
        const fy = Number.isInteger(q) && q > 2500 && q < 2700 ? q : currentFY();
        const from = `${fy - 544}-10-01`, to = `${fy - 543}-09-30`;

        const [rows, units, balances, years] = await Promise.all([
            core_kon`
                SELECT r.id, r.user_id, CONCAT(u.pname, u.fname, ' ', u.lname) AS employee_name,
                       COALESCE(ut.type_name, 'ไม่ระบุ') AS user_type_name, u.gender,
                       COALESCE(mi.name, 'ไม่ระบุ') AS mission_name, COALESCE(ma.name, mi.name, 'ไม่ระบุ') AS group_name,
                       COALESCE(sm.name, 'ไม่ระบุ') AS submajor_name,
                       t.code AS leave_type_code, t.name_th AS leave_type_name, r.leave_type_id,
                       t.requires_document, t.requires_document_after_days, t.count_working_days_only,
                       r.start_date, r.end_date, r.total_days, r.is_half_day, r.status, r.created_at, r.reason,
                       NULLIF(TRIM(r.document_url), '') IS NOT NULL AS has_document,
                       r.day_check_status, r.current_step, r.approval_chain,
                       jsonb_array_length(COALESCE(r.approval_chain, '[]'::jsonb)) AS chain_steps,
                       (SELECT min(a.actioned_at) FROM hr_leave_approvals a WHERE a.request_id = r.id AND a.cancellation_id IS NULL) AS first_action_at,
                       (SELECT max(a.actioned_at) FROM hr_leave_approvals a WHERE a.request_id = r.id AND a.cancellation_id IS NULL) AS last_action_at
                FROM hr_leave_requests r
                JOIN hr_leave_types t ON t.id = r.leave_type_id
                JOIN users u ON u.id = r.user_id
                LEFT JOIN user_types ut ON ut.user_type_id = u.user_type_id
                LEFT JOIN majors ma ON ma.major_id = u.major_id
                LEFT JOIN missions mi ON mi.mission_id = u.mission_id
                LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
                WHERE r.start_date <= ${to}::date AND r.end_date >= ${from}::date
                ORDER BY r.start_date`,
            // บุคลากรปัจจุบันแยกภารกิจ / กลุ่มงาน / หน่วยงาน / ประเภท — ตัวหารของอัตราวันลาต่อคน (หน้าเว็บรวมตามตัวกรอง)
            core_kon`
                SELECT COALESCE(mi.name, 'ไม่ระบุ') AS mission_name, COALESCE(ma.name, mi.name, 'ไม่ระบุ') AS group_name,
                       COALESCE(sm.name, 'ไม่ระบุ') AS submajor_name, COALESCE(ut.type_name, 'ไม่ระบุ') AS user_type_name,
                       count(*)::int AS headcount
                FROM users u
                LEFT JOIN majors ma ON ma.major_id = u.major_id
                LEFT JOIN missions mi ON mi.mission_id = u.mission_id
                LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
                LEFT JOIN user_types ut ON ut.user_type_id = u.user_type_id
                WHERE u.is_active = 'Y'
                GROUP BY 1, 2, 3, 4`,
            core_kon`
                SELECT b.user_id, b.carried_in, b.entitled, b.used
                FROM hr_leave_balances b JOIN hr_leave_types t ON t.id = b.leave_type_id
                JOIN users u ON u.id = b.user_id
                WHERE t.code = 'ANNUAL' AND b.fiscal_year = ${fy} AND u.is_active = 'Y'`,
            core_kon`
                SELECT DISTINCT (EXTRACT(YEAR FROM start_date)::int + 543
                       + CASE WHEN EXTRACT(MONTH FROM start_date) >= 10 THEN 1 ELSE 0 END) AS fy
                FROM hr_leave_requests ORDER BY fy DESC`,
        ]);

        // จำนวนวันตามกฎของประเภท (โหลดวันหยุดครั้งเดียว) — ใช้หาใบที่จำนวนวันไม่ตรง
        const holidays = rows.length
            ? await holidaysBetween(isoDate(rows[0].start_date), rows.map((r: any) => isoDate(r.end_date)).reduce((a: string, b: string) => (a > b ? a : b)))
            : new Map<string, string>();
        const [{ active }] = await core_kon`SELECT count(*)::int AS active FROM users WHERE is_active = 'Y'`;

        // ── ขั้นอนุมัติรายขั้น: งานมาถึงผู้อนุมัติเมื่อไร · กดเมื่อไร / ยังค้างอยู่ ──
        // ถึงคิว = ขั้นแรกนับจากวันยื่น ขั้นถัดไปนับจากเวลาที่ขั้นก่อนหน้ากด (ไม่นับรอบขอยกเลิก)
        const ids = rows.map((r: any) => Number(r.id));
        const acts = ids.length ? await core_kon`
            SELECT request_id, step, action, actioned_at FROM hr_leave_approvals
            WHERE cancellation_id IS NULL AND request_id IN ${core_kon(ids)}
            ORDER BY actioned_at` : [];
        const actOf = new Map<string, any>();
        for (const a of acts) actOf.set(`${a.request_id}:${a.step}`, a);
        const steps: any[] = [];
        for (const r of rows) {
            let arrived = r.created_at;
            for (const c of parseChain(r.approval_chain).sort((a, b) => Number(a.step) - Number(b.step))) {
                const a = actOf.get(`${r.id}:${c.step}`);
                const waiting = !a && r.status === 'PENDING' && Number(c.step) === Number(r.current_step);
                if (!a && !waiting) break;
                steps.push({
                    request_id: Number(r.id), step: Number(c.step), approver_id: Number(c.approver_id),
                    approver_name: c.approver_name, level_name: c.level_name, unit_name: c.unit_name, is_acting: !!c.is_acting,
                    arrived_at: arrived, acted_at: a?.actioned_at ?? null, action: a?.action ?? null,
                });
                if (!a || a.action === 'REJECTED') break;
                arrived = a.actioned_at;
            }
        }

        return {
            success: true,
            data: {
                fiscal_year: fy,
                fiscal_years: years.map((y: any) => Number(y.fy)),
                active_staff: Number(active),
                requests: rows.map(({ approval_chain: _chain, ...r }: any) => ({
                    ...r,
                    start_date: isoDate(r.start_date), end_date: isoDate(r.end_date),
                    rule_days: countWithHolidays(isoDate(r.start_date), isoDate(r.end_date), !!r.count_working_days_only, !!r.is_half_day, holidays).computed_days,
                    off_days: r.count_working_days_only ? offDaysIn(isoDate(r.start_date), isoDate(r.end_date), holidays) : [],
                })),
                staff: units,
                approval_steps: steps,
                annual_balances: balances,
            },
        };
    } catch (error: any) {
        console.error('[getLeaveAnalytics]', error?.message);
        set.status = 500;
        return { success: false, message: 'โหลดข้อมูลวิเคราะห์การลาไม่สำเร็จ' };
    }
};
