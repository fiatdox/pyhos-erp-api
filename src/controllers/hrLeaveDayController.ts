import { core_kon } from '../db/db';
import { countLeaveDays, countWithHolidays, holidaysBetween } from '../services/leaveDays';
import { setDeduction } from './hrLeaveRequestController';

// ── วันหยุดราชการ + การคิดวันลา + งาน HR ตรวจจำนวนวันของใบลาที่คร่อมวันหยุด ──────

const serverError = (set: any, where: string, error: any) => {
    console.error(`[hrLeaveDay] ${where}:`, error);
    set.status = 500;
    return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
};
const fail = (set: any, status: number, message: string) => {
    set.status = status;
    return { success: false, message };
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (d: unknown): d is string =>
    typeof d === 'string' && YMD.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
const spanDays = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1;
const isoDate = (v: unknown) => v instanceof Date
    ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
    : String(v ?? '').slice(0, 10);

export const HOLIDAY_TYPES = ['public', 'special', 'substitution'] as const;

// ── นับวันลาของช่วงที่เลือก (ฟอร์มยื่นลาเรียกเพื่อเติมจำนวนวันให้อัตโนมัติ) ─────────
export const getLeaveDayCount = async ({ query, set }: any) => {
    try {
        const { start_date, end_date } = query ?? {};
        if (!realDate(start_date) || !realDate(end_date) || end_date < start_date) return fail(set, 400, 'ช่วงวันที่ไม่ถูกต้อง');
        if (spanDays(start_date, end_date) > 400) return fail(set, 400, 'ช่วงวันที่ยาวเกินไป');
        const typeId = Number(query?.leave_type_id);
        let workingOnly = true;
        if (Number.isInteger(typeId) && typeId > 0 && typeId <= 32767) {
            const [t] = await core_kon`SELECT count_working_days_only FROM hr_leave_types WHERE id = ${typeId}`;
            if (t) workingOnly = !!t.count_working_days_only;
        }
        const halfDay = String(query?.is_half_day ?? '') === 'true';
        return { success: true, data: await countLeaveDays(start_date, end_date, workingOnly, halfDay) };
    } catch (error: any) {
        return serverError(set, 'getLeaveDayCount', error);
    }
};

// ── วันหยุดราชการ ──────────────────────────────────────────────────────────
export const getHolidays = async ({ query, set }: any) => {
    try {
        const year = Number(query?.year);
        const from = realDate(query?.from) ? query.from : Number.isInteger(year) && year > 1900 ? `${year}-01-01` : null;
        const to = realDate(query?.to) ? query.to : Number.isInteger(year) && year > 1900 ? `${year}-12-31` : null;
        if (!from || !to) return fail(set, 400, 'ระบุปี (ค.ศ.) หรือช่วงวันที่ from / to');
        const rows = await core_kon`
            SELECT h.id, to_char(h.holiday_date, 'YYYY-MM-DD') AS holiday_date, h.name_th, h.holiday_type, h.note,
                   h.updated_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name
            FROM hr_holidays h
            LEFT JOIN users u ON u.id = COALESCE(h.updated_by, h.created_by)
            WHERE h.is_active AND h.holiday_date BETWEEN ${from} AND ${to}
            ORDER BY h.holiday_date
        `;
        return { success: true, data: rows };
    } catch (error: any) {
        return serverError(set, 'getHolidays', error);
    }
};

const checkHolidayBody = (body: any): string | null => {
    if (!realDate(body?.holiday_date)) return 'วันที่ไม่ถูกต้อง';
    if (!String(body?.name_th ?? '').trim()) return 'กรุณาระบุชื่อวันหยุด';
    if (body?.holiday_type != null && !HOLIDAY_TYPES.includes(body.holiday_type)) return 'ประเภทวันหยุดไม่ถูกต้อง';
    return null;
};
const isDupDate = (e: any) => String(e?.message ?? '').includes('uq_hr_holidays_date');

export const createHoliday = async ({ body, user, set }: any) => {
    const bad = checkHolidayBody(body);
    if (bad) return fail(set, 400, bad);
    try {
        const [row] = await core_kon`
            INSERT INTO hr_holidays (holiday_date, name_th, holiday_type, note, created_by, updated_by)
            VALUES (${body.holiday_date}, ${String(body.name_th).trim()}, ${body.holiday_type ?? 'public'},
                    ${body.note ?? null}, ${Number(user?.id)}, ${Number(user?.id)})
            RETURNING id
        `;
        return { success: true, data: row, message: 'เพิ่มวันหยุดเรียบร้อย' };
    } catch (error: any) {
        if (isDupDate(error)) return fail(set, 409, 'มีวันหยุดในวันที่นี้อยู่แล้ว');
        return serverError(set, 'createHoliday', error);
    }
};

export const updateHoliday = async ({ params, body, user, set }: any) => {
    const bad = checkHolidayBody(body);
    if (bad) return fail(set, 400, bad);
    try {
        const rows = await core_kon`
            UPDATE hr_holidays
            SET holiday_date = ${body.holiday_date}, name_th = ${String(body.name_th).trim()},
                holiday_type = ${body.holiday_type ?? 'public'}, note = ${body.note ?? null},
                updated_by = ${Number(user?.id)}, updated_at = now()
            WHERE id = ${Number(params?.id)} AND is_active
            RETURNING id
        `;
        if (!rows.length) return fail(set, 404, 'ไม่พบวันหยุดนี้');
        return { success: true, data: rows[0], message: 'บันทึกวันหยุดเรียบร้อย' };
    } catch (error: any) {
        if (isDupDate(error)) return fail(set, 409, 'มีวันหยุดในวันที่นี้อยู่แล้ว');
        return serverError(set, 'updateHoliday', error);
    }
};

/** ลบแบบ soft (is_active = false) — เก็บประวัติไว้ และเปิดวันที่เดิมให้เพิ่มใหม่ได้ */
export const deleteHoliday = async ({ params, user, set }: any) => {
    try {
        const rows = await core_kon`
            UPDATE hr_holidays SET is_active = false, updated_by = ${Number(user?.id)}, updated_at = now()
            WHERE id = ${Number(params?.id)} AND is_active
            RETURNING id
        `;
        if (!rows.length) return fail(set, 404, 'ไม่พบวันหยุดนี้');
        return { success: true, data: rows[0], message: 'ลบวันหยุดเรียบร้อย' };
    } catch (error: any) {
        return serverError(set, 'deleteHoliday', error);
    }
};

// ── งาน HR ตรวจจำนวนวันลา ──────────────────────────────────────────────────
//
// แสดงใบลาที่ยังมีผล (รออนุมัติ / อนุมัติแล้ว / ระหว่างขอยกเลิก) ในช่วงที่เลือก พร้อมผลนับวันตาม
// ปฏิทินวันหยุด ณ ตอนนี้ — แก้วันหยุดทีหลัง ผลนับก็เปลี่ยนตาม HR จึงเห็นใบที่ต้องตรวจใหม่
//   filter = review       (ค่าเริ่มต้น) คร่อมวันหยุด หรือจำนวนวันไม่ตรงผลนับ และยังไม่ได้ตรวจ
//            approved     อนุมัติครบทุกขั้นแล้ว และยังต้องให้ HR ตรวจ (ขั้นตอนหลังอนุมัติขั้นสุดท้าย)
//            understated  ระบุวันน้อยกว่าที่ปฏิทินนับได้ (อาจลักไก่ลดวันลา) — ยังไม่ได้ตรวจ
//            spans        ทุกใบที่คร่อมวันหยุด / เสาร์-อาทิตย์
//            mismatch     จำนวนวันในใบไม่ตรงผลนับ
//            checked      ตรวจแล้ว
//            all          ทั้งหมด
// quota_short = ถ้านับตามปฏิทิน สิทธิ์คงเหลือของปีงบนั้นจะไม่พอ
const DAY_CHECK_FILTERS = ['review', 'approved', 'understated', 'spans', 'mismatch', 'checked', 'all'];

export const getLeaveDayCheck = async ({ query, set }: any) => {
    try {
        const { from, to } = query ?? {};
        if (!realDate(from) || !realDate(to) || to < from) return fail(set, 400, 'ระบุช่วงวันที่ from / to');
        if (spanDays(from, to) > 400) return fail(set, 400, 'ช่วงวันที่ต้องไม่เกิน 400 วัน');
        const filter = DAY_CHECK_FILTERS.includes(query?.filter) ? query.filter : 'review';

        const rows = await core_kon`
            SELECT r.id, r.user_id, CONCAT(u.pname, u.fname, ' ', u.lname) AS employee_name,
                   up.position_name, ma.name AS major_name, sm.name AS submajor_name,
                   r.leave_type_id, t.name_th AS leave_type_name, t.code AS leave_type_code, t.count_working_days_only,
                   to_char(r.start_date, 'YYYY-MM-DD') AS start_date, to_char(r.end_date, 'YYYY-MM-DD') AS end_date,
                   r.total_days, r.days_deducted, r.is_half_day, r.half_day_period, r.status, r.reason, r.created_at,
                   r.day_check_status, r.day_check_note, r.day_checked_at,
                   CONCAT(cu.pname, cu.fname, ' ', cu.lname) AS day_checked_by_name
            FROM hr_leave_requests r
            JOIN hr_leave_types t ON t.id = r.leave_type_id
            JOIN users u ON u.id = r.user_id
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            LEFT JOIN majors ma ON ma.major_id = u.major_id
            LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
            LEFT JOIN users cu ON cu.id = r.day_checked_by
            WHERE r.status IN ('PENDING', 'APPROVED', 'CANCEL_PENDING')
              AND r.start_date <= ${to} AND r.end_date >= ${from}
            ORDER BY r.start_date, r.id
        `;
        if (!rows.length) return { success: true, data: [], summary: { total: 0, review: 0, approved: 0, understated: 0, spans: 0, mismatch: 0, checked: 0 } };

        const minStart = rows.reduce((m: string, r: any) => (r.start_date < m ? r.start_date : m), rows[0].start_date);
        const maxEnd = rows.reduce((m: string, r: any) => (r.end_date > m ? r.end_date : m), rows[0].end_date);
        const holidays = await holidaysBetween(minStart, maxEnd);
        // ยอดคงเหลือของแต่ละคน/ประเภท/ปีงบ (รวมการหักของใบนี้แล้ว) — ใช้ดูว่านับวันจริงแล้วสิทธิ์พอหรือไม่
        const fyOf = (d: string) => { const [y, m] = d.split('-').map(Number); return (m >= 10 ? y + 1 : y) + 543; };
        const balances = await core_kon`
            SELECT user_id, leave_type_id, fiscal_year, remaining FROM hr_leave_balances
            WHERE user_id IN ${core_kon([...new Set(rows.map((r: any) => Number(r.user_id)))])}`;
        const remainingOf = new Map(balances.map((b: any) => [`${b.user_id}|${b.leave_type_id}|${b.fiscal_year}`, Number(b.remaining)]));

        const all = rows.map((r: any) => {
            const count = countWithHolidays(r.start_date, r.end_date, !!r.count_working_days_only, !!r.is_half_day, holidays);
            const total = Number(r.total_days);
            const mismatch = total !== count.computed_days;
            const understated = total < count.computed_days;
            const checked = r.day_check_status != null;
            const remaining = remainingOf.get(`${r.user_id}|${r.leave_type_id}|${fyOf(r.start_date)}`);
            return { ...r, total_days: total, days_deducted: Number(r.days_deducted), count, mismatch, understated,
                     remaining: remaining ?? null,
                     quota_short: understated && remaining != null && count.computed_days - total > remaining,
                     needs_review: !checked && (count.spans_non_working || mismatch) };
        })
            // ใบที่ระบุวันน้อยกว่าที่ควรขึ้นก่อน
            .sort((a: any, b: any) => Number(b.understated) - Number(a.understated) || a.start_date.localeCompare(b.start_date));
        const pick: Record<string, (x: any) => boolean> = {
            review: x => x.needs_review,
            approved: x => x.needs_review && x.status === 'APPROVED',
            understated: x => x.understated && x.day_check_status == null,
            spans: x => x.count.spans_non_working,
            mismatch: x => x.mismatch,
            checked: x => x.day_check_status != null,
            all: () => true,
        };
        return {
            success: true,
            data: all.filter(pick[filter]),
            summary: {
                total: all.length,
                review: all.filter(pick.review).length,
                approved: all.filter(pick.approved).length,
                understated: all.filter(pick.understated).length,
                spans: all.filter(pick.spans).length,
                mismatch: all.filter(pick.mismatch).length,
                checked: all.filter(pick.checked).length,
            },
        };
    } catch (error: any) {
        return serverError(set, 'getLeaveDayCheck', error);
    }
};

/** HR ยืนยันว่าจำนวนวันในใบถูกต้อง (ไม่เปลี่ยนจำนวนวัน) */
export const verifyLeaveDays = async ({ params, body, user, set }: any) => {
    try {
        const rows = await core_kon`
            UPDATE hr_leave_requests
            SET day_check_status = 'VERIFIED', day_check_note = ${body?.note ?? null},
                day_checked_by = ${Number(user?.id)}, day_checked_at = now(), updated_at = now()
            WHERE id = ${Number(params?.id)} AND status IN ('PENDING', 'APPROVED', 'CANCEL_PENDING')
            RETURNING id
        `;
        if (!rows.length) return fail(set, 404, 'ไม่พบใบลาที่ยังมีผลอยู่');
        return { success: true, data: rows[0], message: 'ยืนยันจำนวนวันลาแล้ว' };
    } catch (error: any) {
        return serverError(set, 'verifyLeaveDays', error);
    }
};

/** HR แก้จำนวนวันลาให้ถูกต้อง — ปรับยอดวันลาที่หักไว้ตามส่วนต่างทันที */
export const adjustLeaveDays = async ({ params, body, user, set }: any) => {
    const days = Number(body?.total_days);
    if (!(days > 0) || !Number.isInteger(days * 2)) return fail(set, 400, 'จำนวนวันต้องมากกว่า 0 และเป็นจำนวนเต็มหรือครึ่งวัน');
    if (!String(body?.note ?? '').trim()) return fail(set, 400, 'กรุณาระบุเหตุผลที่แก้จำนวนวัน');
    try {
        return await core_kon.begin(async (tx: any) => {
            const [req] = await tx`
                SELECT id, user_id, leave_type_id, start_date, end_date, total_days, days_deducted, is_half_day, status
                FROM hr_leave_requests WHERE id = ${Number(params?.id)} FOR UPDATE
            `;
            if (!req || !['PENDING', 'APPROVED', 'CANCEL_PENDING'].includes(req.status)) return fail(set, 404, 'ไม่พบใบลาที่ยังมีผลอยู่');
            const span = spanDays(isoDate(req.start_date), isoDate(req.end_date));
            const max = req.is_half_day ? span - 0.5 : span;
            if (days > max) return fail(set, 400, `ช่วงวันที่ ${span} วัน ลาได้ไม่เกิน ${max} วัน`);

            const before = Number(req.total_days);
            await tx`
                UPDATE hr_leave_requests
                SET total_days = ${days}, actual_days = ${days},
                    day_check_status = 'ADJUSTED', day_check_note = ${String(body.note).trim()},
                    day_checked_by = ${Number(user?.id)}, day_checked_at = now(), updated_at = now()
                WHERE id = ${req.id}
            `;
            // ใบเก่าที่ยังรออนุมัติและยังไม่ได้หัก (days_deducted = 0) จะหักตอนอนุมัติด้วยจำนวนใหม่
            // ใบที่อนุมัติไปก่อนมี days_deducted ถูกหักไปแล้วเท่ากับ total_days เดิม
            const deducted = Number(req.days_deducted) > 0 ? Number(req.days_deducted)
                : (req.status === 'PENDING' ? null : before);
            if (deducted != null) await setDeduction(tx, { ...req, days_deducted: deducted }, days);
            return { success: true, data: { id: req.id, before, after: days }, message: `แก้จำนวนวันลาจาก ${before} เป็น ${days} วันแล้ว` };
        });
    } catch (error: any) {
        return serverError(set, 'adjustLeaveDays', error);
    }
};
