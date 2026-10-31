import { core_kon } from '../db/db';
import { join } from 'path';
import { resolveApprovalChain, stepFor, parseChain, canActOnStep, type ChainStep } from '../services/leaveChain';
import { resolveLeaveSubject, isHrOrAdmin, hasCreatedByColumn } from '../services/leaveSubject';
import { countLeaveDays, countWithHolidays, holidaysBetween } from '../services/leaveDays';
import { maxAdvanceDays, bangkokDate } from '../services/leaveRules';
import { syncCarriedForward } from '../services/leaveRollover';

// ── ใบลา: ยื่น → อนุมัติตามสายบังคับบัญชา → ตัดยอดวันลา → ยกเลิก ────────────────
//
// หลักที่ยึดตลอดไฟล์นี้
// 1) สิทธิ์กดอนุมัติดูจาก approval_chain ในใบ — ขั้นที่ยังไม่ถึงถูกปรับตามผังปัจจุบัน
//    เมื่อแก้ผัง/ย้ายหน่วย (resyncPendingChains) หัวหน้าที่ถือหมวกหลายใบจึงเห็นเฉพาะใบที่
//    "รอขั้นของเขา" จริง ๆ ไม่ปนกับหน่วยอื่น
// 2) ทุกการกดบันทึกลง hr_leave_approvals พร้อมระดับและหน่วยที่ใช้อำนาจ
// 3) ตัดยอดวันลาทันทีเมื่อบันทึกใบ (days_deducted) — คืนยอดเมื่อไม่อนุมัติ / ถอน / ลบ / ยกเลิกสำเร็จ
//    ใบเก่าที่ยังไม่ได้หัก (days_deducted = 0) จะหักตอนอนุมัติขั้นสุดท้ายเหมือนเดิม

const serverError = (set: any, where: string, error: any) => {
    console.error(`[hrLeaveRequest] ${where}:`, error);
    set.status = 500;
    return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
};

const fail = (set: any, status: number, message: string, code?: string) => {
    set.status = status;
    return { success: false, message, ...(code ? { code } : {}) };
};

/** คอลัมน์ date ของ Postgres อ่านกลับมาเป็น Date object — แปลงเป็น YYYY-MM-DD ก่อนใช้เสมอ */
const isoDate = (v: unknown): string => {
    if (v instanceof Date) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
    }
    return String(v ?? '').slice(0, 10);
};

/** ปีงบประมาณไทยของวันที่หนึ่ง ๆ (1 ต.ค. – 30 ก.ย.) */
const fiscalYearOf = (value: unknown): number => {
    const [y, m] = isoDate(value).split('-').map(Number);
    if (!y || !m) throw new Error(`fiscalYearOf: วันที่ไม่ถูกต้อง (${String(value)})`);
    return (m >= 10 ? y + 1 : y) + 543;
};

const isAdmin = async (userId: number): Promise<boolean> => {
    const rows = await core_kon`
        SELECT 1 FROM core_kon.user_m_users_roles mu
        JOIN core_kon.user_roles r ON r.id = mu.role_id
        WHERE mu.user_id = ${userId} AND UPPER(r.role_name) = 'ADMIN' LIMIT 1
    `;
    return rows.length > 0;
};

// ── สิทธิ์วันลาคงเหลือ ──────────────────────────────────────────────────────
//
// ลำดับการหา "จำนวนวันที่มีสิทธิ์"
//   1) แถวใน hr_leave_balances ของปีงบนั้น (ยอดที่ HR ตั้งไว้จริง = ถือเป็นข้อยุติ)
//   2) ถ้ายังไม่มีแถว ใช้ max_days_per_year จาก hr_leave_entitlements ตามประเภท
//      เจ้าหน้าที่ + อายุงาน (เลือก tier ที่ min_service_months สูงสุดที่ผ่านเกณฑ์)
//
// ใบที่บันทึกแล้วถูกหักจาก hr_leave_balances.used ทันที (รวมใบที่ยังรออนุมัติ)
// ผลที่ส่งกลับแยกให้เห็น: used = อนุมัติแล้ว · pending = รออนุมัติ · remaining = เหลือจริง
export interface LeaveQuota {
    fiscal_year: number;
    has_entitlement: boolean;   // false = ยังไม่ได้กำหนดสิทธิ์ไว้ ไม่บังคับเพดาน
    entitled: number;           // สิทธิ์ของปีนี้ (รวมยอดยกมา)
    used: number;               // อนุมัติแล้ว
    pending: number;            // ยื่นค้างอยู่ ยังไม่ถึงที่สุด
    remaining: number;
    /** อายุงานยังไม่ถึงเกณฑ์ขั้นต่ำของประเภทเจ้าหน้าที่ (เช่น ข้าราชการบรรจุไม่ถึง 6 เดือน ไม่มีสิทธิ์ลาพักผ่อน) */
    service_short?: { required_months: number; service_months: number };
}

/** สิทธิ์ต่อปีตามประเภทเจ้าหน้าที่ + อายุงาน (null = ไม่ได้กำหนดสิทธิ์ไว้) */
// เลือก tier ตามอายุงาน (v_leave_service_start: hire_date ในทะเบียน ถ้าว่างใช้วันบรรจุจากโปรแกรมการลาเดิม)
// เช่น ข้าราชการบรรจุไม่ถึง 6 เดือน = ยังไม่มีสิทธิ์ลาพักผ่อน · ถ้าไม่มีวันเริ่มงานเลย
// ให้ใช้ tier ต่ำสุดเป็นฐาน ดีกว่าถือว่า "ไม่มีสิทธิ์" ซึ่งจะทำให้เพดานวันลาไม่ถูกบังคับกับเกือบทั้งองค์กร
// asOf = วันที่ใช้คิดอายุงาน (ตอนยื่นใบลาใช้วันเริ่มลา) ไม่ระบุ = วันนี้
const entitlementFor = async (userId: number, leaveTypeId: number, asOf?: string): Promise<number | null> => {
    const at = core_kon`${asOf ?? bangkokDate(0)}::date`;
    const rows = await core_kon`
            SELECT e.max_days_per_year, e.min_service_months
            FROM hr_leave_entitlements e
            JOIN users u ON u.user_type_id = e.user_type_id
            JOIN v_leave_service_start ss ON ss.user_id = u.id
            WHERE u.id = ${userId} AND e.leave_type_id = ${leaveTypeId}
              AND (ss.service_start IS NULL
                   OR e.min_service_months <= EXTRACT(YEAR FROM age(${at}, ss.service_start)) * 12
                                            + EXTRACT(MONTH FROM age(${at}, ss.service_start)))
            ORDER BY
                CASE WHEN ss.service_start IS NULL THEN e.min_service_months END ASC,
                e.min_service_months DESC
            LIMIT 1`;
    return rows.length && rows[0].max_days_per_year != null ? Number(rows[0].max_days_per_year) : null;
};

/** อายุงาน ณ asOf ยังไม่ถึงเกณฑ์ขั้นต่ำของประเภทการลานี้ (มีเกณฑ์กำหนดไว้ แต่ไม่ผ่านสักขั้น) */
const serviceShortFor = async (userId: number, leaveTypeId: number, asOf: string) => {
    const [r] = await core_kon`
        SELECT MIN(e.min_service_months)::int AS required_months,
               (EXTRACT(YEAR FROM age(${asOf}::date, ss.service_start)) * 12
                + EXTRACT(MONTH FROM age(${asOf}::date, ss.service_start)))::int AS service_months
        FROM hr_leave_entitlements e
        JOIN users u ON u.user_type_id = e.user_type_id
        JOIN v_leave_service_start ss ON ss.user_id = u.id
        WHERE u.id = ${userId} AND e.leave_type_id = ${leaveTypeId} AND ss.service_start IS NOT NULL
        GROUP BY ss.service_start`;
    return r && r.service_months < r.required_months
        ? { required_months: Number(r.required_months), service_months: Math.max(Number(r.service_months), 0) }
        : undefined;
};

const leaveQuota = async (userId: number, leaveTypeId: number, fy: number, asOf?: string): Promise<LeaveQuota> => {
    const at = asOf ?? bangkokDate(0);
    const [balance, entRows, pendingRows, short] = await Promise.all([
        core_kon`
            SELECT carried_in, entitled, used FROM hr_leave_balances
            WHERE user_id = ${userId} AND leave_type_id = ${leaveTypeId} AND fiscal_year = ${fy}`,
        entitlementFor(userId, leaveTypeId, at),
        // ใบที่รออนุมัติ: จำนวนวันทั้งหมด และส่วนที่หักจาก balance ไปแล้ว (ใบเก่าอาจยังไม่ได้หัก)
        core_kon`
            SELECT COALESCE(SUM(total_days), 0) AS pending_all, COALESCE(SUM(days_deducted), 0) AS pending_deducted
            FROM hr_leave_requests
            WHERE user_id = ${userId} AND leave_type_id = ${leaveTypeId}
              AND status = 'PENDING'
              AND (CASE WHEN EXTRACT(MONTH FROM start_date) >= 10
                        THEN EXTRACT(YEAR FROM start_date) + 1
                        ELSE EXTRACT(YEAR FROM start_date) END) + 543 = ${fy}`,
        serviceShortFor(userId, leaveTypeId, at),
    ]);

    const pending = Number(pendingRows[0]?.pending_all ?? 0);
    const pendingDeducted = Number(pendingRows[0]?.pending_deducted ?? 0);
    const tier = entRows;

    const b = balance[0];
    const fromBalance = b ? Number(b.carried_in ?? 0) + Number(b.entitled ?? 0) : 0;
    // แถวยอดที่ระบบสร้างเองโดยยังไม่มีสิทธิ์ตั้งไว้ (0 + 0) ไม่ถือเป็น "ไม่มีสิทธิ์" — ใช้สิทธิ์ตามประเภทเจ้าหน้าที่แทน
    const entitled = fromBalance > 0 ? fromBalance : (tier ?? 0);
    const hasEntitlement = fromBalance > 0 || tier != null;
    const used = Math.max((b ? Number(b.used ?? 0) : 0) - pendingDeducted, 0);
    return {
        fiscal_year: fy,
        has_entitlement: hasEntitlement,
        entitled, used, pending,
        remaining: hasEntitlement ? entitled - used - pending : 0,
        // HR ตั้งยอดให้เองแล้ว (fromBalance > 0) ถือว่ามีสิทธิ์ ไม่เตือนเรื่องอายุงาน
        ...(short && fromBalance <= 0 ? { service_short: short } : {}),
    };
};

/** สิทธิ์คงเหลือของประเภทการลาหนึ่ง — ฟอร์มเรียกก่อนยื่นเพื่อแสดงให้เห็น */
export const getLeaveQuota = async ({ query, user, set }: any) => {
    try {
        const leaveTypeId = Number(query?.leave_type_id);
        if (!Number.isInteger(leaveTypeId)) return fail(set, 400, 'กรุณาระบุประเภทการลา');
        const fy = query?.start_date ? fiscalYearOf(query.start_date) : fiscalYearOf(new Date());
        const subject = await resolveLeaveSubject(Number(user?.id), query?.user_id);
        if (!subject.ok) return fail(set, subject.status, subject.message);
        const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(query?.start_date ?? '')) ? String(query.start_date) : undefined;
        return { success: true, data: await leaveQuota(subject.uid, leaveTypeId, fy, asOf) };
    } catch (error: any) {
        return serverError(set, 'getLeaveQuota', error);
    }
};

/**
 * สรุปวันลาปีงบปัจจุบันของฉัน — การ์ดหน้า /hr/leave
 * ลาพักผ่อน (แยกสิทธิ์ปีนี้ / ยกมา) · ลากิจ · ลาป่วย · ลาคลอด (เฉพาะเพศหญิง)
 */
const OVERVIEW_CODES = ['ANNUAL', 'PERS', 'SICK', 'MAT'];
export const getMyLeaveOverview = async ({ user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const fy = fiscalYearOf(new Date());
        const [me] = await core_kon`SELECT gender FROM users WHERE id = ${uid}`;
        const codes = OVERVIEW_CODES.filter(c => c !== 'MAT' || me?.gender === 'F');
        const types = await core_kon`
            SELECT t.id, t.code, t.name_th, b.carried_in
            FROM hr_leave_types t
            LEFT JOIN hr_leave_balances b ON b.leave_type_id = t.id AND b.user_id = ${uid} AND b.fiscal_year = ${fy}
            WHERE t.is_active AND t.code IN ${core_kon(codes)}`;
        const data = await Promise.all(types.map(async (t: any) => {
            const q = await leaveQuota(uid, Number(t.id), fy);
            const carried = Math.min(Number(t.carried_in ?? 0), q.entitled);
            return {
                leave_type_id: Number(t.id), code: t.code, name_th: t.name_th,
                ...q, carried_in: carried, entitled_this_year: q.entitled - carried,
            };
        }));
        data.sort((a, b) => codes.indexOf(a.code) - codes.indexOf(b.code));
        return { success: true, data: { fiscal_year: fy, types: data } };
    } catch (error: any) {
        return serverError(set, 'getMyLeaveOverview', error);
    }
};

/** ตรวจข้อมูลใบลา (ใช้ทั้งยื่นใหม่และแก้ไข) — exclude = ใบเดิมที่กำลังแก้ ไม่นับซ้อนทับ/ไม่นับซ้ำในสิทธิ์วันลา */
type ExcludeReq = { id: number; leave_type_id: number; start_date: string; total_days: number };
// actorIsHr = ผู้ทำรายการเป็น HR / ADMIN — ลาพักผ่อนย้อนหลังได้ และไม่ถูกกันเรื่องใส่จำนวนวันน้อยกว่าปฏิทิน
const checkLeaveInput = async (uid: number, body: any, set: any, exclude?: ExcludeReq, actorIsHr = false)
    : Promise<{ error: any } | { quota: LeaveQuota }> => {
    const fail2 = (status: number, message: string, code?: string) => ({ error: fail(set, status, message, code) });
    const { leave_type_id, start_date, end_date, total_days, is_half_day, half_day_period } = body;
    // ค่าที่หลุดช่วงของคอลัมน์ (smallint / varchar / date) จะกลายเป็น 500 จากฐานข้อมูล — กันไว้ตั้งแต่ตรงนี้
    const realDate = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
        && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
    if (!realDate(start_date) || !realDate(end_date)) return fail2(400, 'วันที่ลาไม่ถูกต้อง');
    const typeId = Number(leave_type_id);
    if (!Number.isInteger(typeId) || typeId < 1 || typeId > 32767) return fail2(400, 'ไม่พบประเภทการลาที่เลือก');
    if (end_date < start_date) return fail2(400, 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มลา');
    const days = Number(total_days);
    if (!(days > 0)) return fail2(400, 'จำนวนวันลาต้องมากกว่า 0');
    if (!Number.isInteger(days * 2)) return fail2(400, 'จำนวนวันลาต้องเป็นจำนวนเต็มหรือครึ่งวันเท่านั้น');
    if (is_half_day && !half_day_period) return fail2(400, 'ลาครึ่งวันต้องระบุช่วงเช้า/บ่าย');
    if (!is_half_day && half_day_period) return fail2(400, 'ระบุช่วงเช้า/บ่ายได้เฉพาะเมื่อลาครึ่งวัน');
    if (half_day_period && half_day_period !== 'AM' && half_day_period !== 'PM') return fail2(400, 'ช่วงลาครึ่งวันต้องเป็นเช้า (AM) หรือบ่าย (PM)');
    // จำนวนวันลดได้ (หักวันหยุดในช่วง) แต่ห้ามเกินช่วงวันที่ที่เลือก · ลาครึ่งวันมีวันหนึ่งที่นับครึ่งเดียว
    const span = (Date.parse(end_date) - Date.parse(start_date)) / 86_400_000 + 1;
    const maxDays = is_half_day ? span - 0.5 : span;
    if (days > maxDays) return fail2(400, `ช่วงวันที่ ${span} วัน${is_half_day ? ' (มีครึ่งวัน)' : ''} ลาได้ไม่เกิน ${maxDays} วัน`);

    const [leaveType] = await core_kon`
        SELECT lt.id, lt.code, lt.name_th, lt.gender_restriction, lt.count_working_days_only, u.gender
        FROM hr_leave_types lt
        LEFT JOIN users u ON u.id = ${uid}
        WHERE lt.id = ${leave_type_id} AND lt.is_active = true
    `;
    if (!leaveType) return fail2(400, 'ไม่พบประเภทการลาที่เลือก');
    // กันยิง API ตรงด้วยประเภทการลาที่เพศตัวเองลาไม่ได้ (หน้าเว็บซ่อนไว้แล้ว)
    const genderOk = leaveType.gender_restriction === 'ALL' || leaveType.gender == null
        || (leaveType.gender_restriction === 'MALE' && leaveType.gender === 'M')
        || (leaveType.gender_restriction === 'FEMALE' && leaveType.gender === 'F');
    if (!genderOk) return fail2(400, `${leaveType.name_th} ไม่ตรงกับเพศในทะเบียนบุคลากร`);
    // ลาพักผ่อนต้องยื่นล่วงหน้า (เริ่มวันนี้ได้) — ย้อนหลังได้เฉพาะ HR / ADMIN ทำรายการให้
    if (leaveType.code === 'ANNUAL' && start_date < bangkokDate() && !actorIsHr) {
        return fail2(400, 'ลาพักผ่อนต้องยื่นล่วงหน้า ไม่สามารถลาย้อนหลังได้ หากจำเป็นให้ติดต่องานทรัพยากรบุคคลทำรายการให้', 'ANNUAL_BACKDATE');
    }
    // ลาล่วงหน้าได้ไม่เกิน LEAVE_MAX_ADVANCE_DAYS วัน (ทุกประเภท ทุกผู้ทำรายการ)
    const maxAdvance = maxAdvanceDays();
    if (start_date > bangkokDate(maxAdvance)) {
        return fail2(400, `ลาล่วงหน้าได้ไม่เกิน ${maxAdvance} วันนับจากวันนี้`, 'ADVANCE_LIMIT');
    }

    // ซ้อนทับกับใบที่ยังมีผลอยู่ไม่ได้ — กันลาซ้ำช่วงเดียวกันโดยไม่ตั้งใจ
    const overlap = await core_kon`
        SELECT id, start_date, end_date FROM hr_leave_requests
        WHERE user_id = ${uid}
          AND status IN ('PENDING', 'APPROVED', 'CANCEL_PENDING')
          AND start_date <= ${end_date} AND end_date >= ${start_date}
          ${exclude ? core_kon`AND id <> ${exclude.id}` : core_kon``}
        LIMIT 1
    `;
    if (overlap.length > 0) {
        return fail2(409, `มีใบลาที่ยังมีผลอยู่ทับช่วงวันที่นี้แล้ว (ใบเลขที่ ${overlap[0].id})`, 'OVERLAP');
    }

    // ตรวจสิทธิ์วันลา — นับรวมใบที่ยังค้างอยู่ด้วย กันยื่นหลายใบพร้อมกันจนทะลุสิทธิ์
    const fy = fiscalYearOf(start_date);
    const quota = await leaveQuota(uid, Number(leave_type_id), fy, start_date);
    // อายุงาน ณ วันเริ่มลายังไม่ถึงเกณฑ์ เช่น ข้าราชการบรรจุไม่ถึง 6 เดือน ไม่มีสิทธิ์ลาพักผ่อน
    if (quota.service_short) {
        const { required_months, service_months } = quota.service_short;
        return fail2(409, `${leaveType.name_th}ต้องมีอายุงานอย่างน้อย ${required_months} เดือน`
            + ` (ณ วันเริ่มลามีอายุงาน ${service_months} เดือน)`, 'SERVICE_TOO_SHORT');
    }
    // แก้ไขใบเดิม: วันของใบนี้ถูกนับเป็น "ค้างอยู่" แล้ว — คืนกลับก่อนเทียบ ไม่งั้นแก้ใบที่ใช้สิทธิ์จนหมดไม่ได้
    if (exclude && exclude.leave_type_id === Number(leave_type_id) && fiscalYearOf(exclude.start_date) === fy) {
        quota.pending -= exclude.total_days;
        quota.remaining += exclude.total_days;
    }
    // ใส่จำนวนวันน้อยกว่าที่ปฏิทินนับได้ แล้วจำนวนที่ควรเป็นเกินสิทธิ์คงเหลือ = อาจลดวันเพื่อเลี่ยงเพดาน
    // ผู้ลาแก้จำนวนวันเองได้ (เช่น เจ้าหน้าที่เวร) แต่กรณีนี้ต้องให้งาน HR ทำรายการให้
    if (quota.has_entitlement && !actorIsHr) {
        const counted = await countLeaveDays(start_date, end_date, !!leaveType.count_working_days_only, !!is_half_day);
        if (days < counted.computed_days && counted.computed_days > quota.remaining) {
            set.status = 409;
            return { error: {
                success: false,
                code: 'QUOTA_EXCEEDED_BY_CALENDAR',
                message: `ช่วงวันที่นี้นับได้ ${counted.computed_days} วัน${counted.working_days_only ? 'ทำการ' : ''} แต่${leaveType.name_th}คงเหลือ ${quota.remaining} วัน`
                    + ` (ใบนี้ระบุ ${days} วัน) — หากจำนวนวันลาจริงน้อยกว่าปฏิทิน เช่น ทำงานเป็นเวร ให้ติดต่องานทรัพยากรบุคคลทำรายการให้`,
                data: { quota, counted },
            } };
        }
    }
    if (quota.has_entitlement && Number(total_days) > quota.remaining) {
        set.status = 409;
        return { error: {
            success: false,
            code: 'QUOTA_EXCEEDED',
            message: `${leaveType.name_th}ปีงบ ${quota.fiscal_year} คงเหลือ ${quota.remaining} วัน`
                + (quota.pending > 0 ? ` (มีใบค้างอยู่ ${quota.pending} วัน)` : '')
                + ` แต่ใบนี้ขอลา ${total_days} วัน`,
            data: quota,
        } };
    }

    return { quota };
};

// ── ยื่นใบลา ────────────────────────────────────────────────────────────────
/** ผู้ปฏิบัติหน้าที่แทน (ไม่บังคับ) — ต้องเป็นบุคลากรที่ยังปฏิบัติงาน และไม่ใช่ผู้ลาเอง · คืน undefined = ข้อมูลไม่ถูกต้อง */
const substituteOf = async (uid: number, raw: unknown): Promise<number | null | undefined> => {
    if (raw == null || raw === '') return null;
    const id = Number(raw);
    if (!Number.isInteger(id) || id < 1 || id === uid) return undefined;
    const [u] = await core_kon`SELECT id FROM users WHERE id = ${id} AND is_active = 'Y'`;
    return u ? id : undefined;
};

/** ที่ติดต่อระหว่างลา (ไม่บังคับ) — ว่างเก็บ null · คืน undefined = ยาวเกินคอลัมน์ */
const CONTACT_MAX = 255;
const contactOf = (raw: unknown): string | null | undefined => {
    const v = String(raw ?? '').trim();
    if (!v) return null;
    return v.length > CONTACT_MAX ? undefined : v;
};

export const createLeaveRequest = async ({ body, user, set }: any) => {
    try {
        const subject = await resolveLeaveSubject(Number(user?.id), body?.user_id);
        if (!subject.ok) return fail(set, subject.status, subject.message);
        const uid = subject.uid;
        const { leave_type_id, start_date, end_date, total_days, is_half_day, half_day_period, reason, document_url } = body;

        const checked = await checkLeaveInput(uid, body, set, undefined, subject.actorIsHr);
        if ('error' in checked) return checked.error;
        const { quota } = checked;
        const substitute = await substituteOf(uid, body?.substitute_user_id);
        if (substitute === undefined) return fail(set, 400, 'ผู้ปฏิบัติหน้าที่แทนไม่ถูกต้อง');
        const contact = contactOf(body?.contact_info);
        if (contact === undefined) return fail(set, 400, `ที่ติดต่อระหว่างลายาวได้ไม่เกิน ${CONTACT_MAX} ตัวอักษร`);

        const chain = await resolveApprovalChain(uid);
        if (!chain || chain.steps.length === 0) {
            return fail(set, 422,
                'ไม่พบผู้อนุมัติในสายบังคับบัญชาของคุณ กรุณาติดต่อฝ่ายบุคคลเพื่อตั้งค่าหัวหน้าหน่วยงาน',
                'NO_APPROVER');
        }

        // บันทึกใบ + หักยอดวันลาในธุรกรรมเดียว — การลามีผลต่อสิทธิ์คงเหลือทันทีที่บันทึก
        const row = await core_kon.begin(async (tx: any) => {
            const [r] = await tx`
                INSERT INTO hr_leave_requests
                    (user_id, leave_type_id, start_date, end_date, total_days, actual_days,
                     is_half_day, half_day_period, status, reason, document_url,
                     approval_chain, current_step, days_deducted, substitute_user_id, contact_info)
                VALUES (${uid}, ${leave_type_id}, ${start_date}, ${end_date}, ${total_days}, ${total_days},
                        ${!!is_half_day}, ${half_day_period ?? null}, 'PENDING', ${reason ?? null}, ${document_url ?? null},
                        ${JSON.stringify(chain.steps)}::text::jsonb, 1, ${total_days}, ${substitute}, ${contact})
                RETURNING id, status, current_step, created_at
            `;
            await adjustBalance(tx, uid, Number(leave_type_id), start_date, Number(total_days));
            if (await hasCreatedByColumn()) {
                await tx`UPDATE hr_leave_requests SET created_by = ${subject.actorId} WHERE id = ${r.id}`;
            }
            return r;
        });

        return {
            success: true,
            data: { ...row, approval_chain: chain.steps, skipped: chain.skipped, quota, on_behalf: subject.onBehalf },
            message: `${subject.onBehalf ? 'บันทึกใบลาแทนบุคลากรเรียบร้อย' : 'ส่งใบลาเรียบร้อย'} รออนุมัติจาก${chain.steps[0].level_name} (${chain.steps[0].approver_name})`,
        };
    } catch (error: any) {
        return serverError(set, 'createLeaveRequest', error);
    }
};

/** ดูสายอนุมัติล่วงหน้าก่อนยื่น — ฟอร์มใช้แสดงให้ผู้ยื่นเห็นว่าใบจะวิ่งไปหาใครบ้าง */
export const previewApprovalChain = async ({ user, query, set }: any) => {
    try {
        const subject = await resolveLeaveSubject(Number(user?.id), query?.user_id);
        if (!subject.ok) return fail(set, subject.status, subject.message);
        const chain = await resolveApprovalChain(subject.uid);
        if (!chain) return { success: true, data: { steps: [], skipped: [], can_submit: false } };
        return { success: true, data: { ...chain, can_submit: chain.steps.length > 0 } };
    } catch (error: any) {
        return serverError(set, 'previewApprovalChain', error);
    }
};

/** คำขอยกเลิกรอบล่าสุดของใบ (ขอใหม่ได้ถ้ารอบก่อนไม่ได้รับอนุมัติ) พร้อมเหตุผลที่ไม่อนุมัติ */
/**
 * ตำแหน่ง + ระดับ (user_levels.level_name) เช่น พยาบาลวิชาชีพชำนาญการ · ระดับแบบรหัส (ส 2) เว้นวรรค · "-" / ว่าง = ไม่มีระดับ
 * p = alias ของ user_positions · ผู้ใช้ต้องเป็น alias u
 */
const positionName = (p: string) => core_kon`
    CASE WHEN ${core_kon(p)}.position_name IS NULL THEN NULL ELSE TRIM(CONCAT(${core_kon(p)}.position_name,
        (SELECT CASE WHEN lv.level_name IS NULL OR TRIM(lv.level_name) IN ('', '-') THEN ''
                     WHEN lv.level_name ~ '[0-9]' THEN ' ' || TRIM(lv.level_name)
                     ELSE TRIM(lv.level_name) END
         FROM user_levels lv WHERE lv.user_level_id = u.user_level_id))) END`;

/** ผลการตรวจจำนวนวันของงาน HR (alias ใบลา = r) — ผู้ลาและผู้อนุมัติเห็นด้วย */
const dayCheckCols = () => core_kon`r.day_check_status, r.day_check_note, r.day_checked_at,
    (SELECT CONCAT(cu.pname, cu.fname, ' ', cu.lname) FROM users cu WHERE cu.id = r.day_checked_by) AS day_checked_by_name`;

/** ชื่อผู้ปฏิบัติหน้าที่แทน (alias ใบลา = r) */
const substituteName = () => core_kon`(SELECT CONCAT(su.pname, su.fname, ' ', su.lname) FROM users su WHERE su.id = r.substitute_user_id)`;

const latestCancellation = () => core_kon`
    LEFT JOIN LATERAL (
        SELECT c.id, c.status, c.reason, c.refunded_days,
               (SELECT a.comment FROM hr_leave_approvals a
                WHERE a.cancellation_id = c.id AND a.action = 'REJECTED'
                ORDER BY a.actioned_at DESC LIMIT 1) AS reject_comment
        FROM hr_leave_cancellations c
        WHERE c.request_id = r.id
        ORDER BY c.id DESC
        LIMIT 1
    ) c ON TRUE`;

// ── ใบลาของบุคลากรหนึ่งคน + ข้อมูลกรอกแบบใบลา ──────────────────────────────
// ใช้ทั้ง "ใบลาของฉัน" และ "พิมพ์ใบลา" จากรายงานการลาในสังกัด (สถิติการลาในแบบฟอร์มนับจากใบทั้งหมดของเจ้าของใบ)
const leavePackage = async (uid: number, status: string | null = null) => {
        const rows = await core_kon`
            SELECT r.id, r.leave_type_id, t.name_th AS leave_type_name, t.code AS leave_type_code,
                   r.start_date, r.end_date, r.total_days, r.actual_days,
                   r.is_half_day, r.half_day_period, r.status, r.reason, r.reject_reason,
                   r.document_url, r.approval_chain, r.current_step, r.created_at, r.updated_at,
                   r.substitute_user_id, ${substituteName()} AS substitute_name, r.contact_info, ${dayCheckCols()},
                   c.id AS cancellation_id, c.status AS cancellation_status, c.reason AS cancellation_reason,
                   c.refunded_days AS cancellation_refunded_days, c.reject_comment AS cancellation_reject_comment
            FROM hr_leave_requests r
            JOIN hr_leave_types t ON t.id = r.leave_type_id
            ${latestCancellation()}
            WHERE r.user_id = ${uid}
              ${status ? core_kon`AND r.status = ${status}` : core_kon``}
            ORDER BY r.created_at DESC
        `;
        const actions = await loadActions(rows.map((r: any) => Number(r.id)));

        // ข้อมูลผู้ยื่นและยอดวันลาสะสม — ใช้กรอกแบบฟอร์มใบลาที่พิมพ์ออกมา
        const [profile] = await core_kon`
            SELECT u.id, u.pname, u.fname, u.lname,
                   ${positionName('po')} AS position_name, ut.type_name AS user_type_name,
                   sm.name AS submajor_name, ma.name AS major_name, mi.name AS mission_name
            FROM users u
            LEFT JOIN user_positions po ON po.user_position_id = u.user_position_id
            LEFT JOIN user_types ut ON ut.user_type_id = u.user_type_id
            LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
            LEFT JOIN majors ma ON ma.major_id = u.major_id
            LEFT JOIN missions mi ON mi.mission_id = u.mission_id
            WHERE u.id = ${uid}
        `;

        // ยอดยกมา (carried_in) และสิทธิ์ต่อปีของแต่ละประเภท — แยกตามปีงบของใบนั้น
        const balances = await core_kon`
            SELECT leave_type_id, fiscal_year, carried_in, entitled, used, remaining
            FROM hr_leave_balances WHERE user_id = ${uid}
        `;
        const perYear = await core_kon`
            SELECT e.leave_type_id, e.max_days_per_year, e.min_service_months
            FROM hr_leave_entitlements e
            JOIN users u ON u.id = ${uid}
            WHERE e.user_type_id = u.user_type_id
            ORDER BY e.min_service_months ASC
        `;
        // ชื่อผู้อนุมัติ (ตามสาย + ผู้ที่กดจริง) แยกคำนำหน้า/ชื่อ/สกุล — แบบใบลาพิมพ์ "(ลงชื่อ) ชื่อ สกุล" และ "(คำนำหน้าชื่อ สกุล)"
        const approverIds = [...new Set([
            ...rows.flatMap((r: any) => parseChain(r.approval_chain).map(s => Number(s.approver_id))),
            ...[...actions.values()].flat().map((a: any) => Number(a.approver_id)),
        ])];
        const approverRows = approverIds.length
            ? await core_kon`SELECT id, pname, fname, lname FROM users WHERE id IN ${core_kon(approverIds)}`
            : [];

        const balanceOf = (typeId: number, fy: number) =>
            balances.find((b: any) => Number(b.leave_type_id) === typeId && Number(b.fiscal_year) === fy) ?? null;
        const entitlementOf = (typeId: number) =>
            perYear.find((e: any) => Number(e.leave_type_id) === typeId) ?? null;

        return {
            data: rows.map((r: any) => {
                const fy = fiscalYearOf(r.start_date);
                const bal = balanceOf(Number(r.leave_type_id), fy);
                const ent = entitlementOf(Number(r.leave_type_id));
                return {
                    ...r,
                    actions: actions.get(Number(r.id)) ?? [],
                    fiscal_year: fy,
                    carried_in: bal ? Number(bal.carried_in) : 0,
                    // สิทธิ์ปีนี้ตามยอดจริงของปีงบนั้น (อายุงานเปลี่ยนเกณฑ์ได้) — ยังไม่มียอดใช้เกณฑ์ตามประเภทเจ้าหน้าที่
                    entitled_per_year: bal && Number(bal.entitled) > 0 ? Number(bal.entitled)
                        : ent?.max_days_per_year != null ? Number(ent.max_days_per_year) : null,
                };
            }),
            profile: profile ?? null,
            approvers: Object.fromEntries(approverRows.map((a: any) => [a.id, { pname: a.pname, fname: a.fname, lname: a.lname }])),
        };
};

// ── ใบลาของฉัน ──────────────────────────────────────────────────────────────
export const getMyLeaveRequests = async ({ user, query, set }: any) => {
    try {
        const status = query?.status ? String(query.status).toUpperCase() : null;
        return { success: true, ...(await leavePackage(Number(user?.id), status)) };
    } catch (error: any) {
        return serverError(set, 'getMyLeaveRequests', error);
    }
};

// ── ข้อมูลพิมพ์แบบใบลาของใบหนึ่ง (หน้า /hr/leave/status) ─────────────────────
// ดูได้: เจ้าของใบ · ผู้อยู่ในสายอนุมัติของใบ · ADMIN / HR · หัวหน้า/รักษาการของหน่วยที่เจ้าของใบสังกัด (ขอบเขตเดียวกับรายงาน)
/** ดูใบลานี้ได้ไหม — เจ้าของใบ · ผู้อยู่ในสายอนุมัติ · ADMIN / HR · หัวหน้า/รักษาการของหน่วยที่เจ้าของใบสังกัด */
const canViewLeave = async (uid: number, row: any): Promise<boolean> =>
    Number(row.user_id) === uid
    || parseChain(row.approval_chain).some(s => Number(s.approver_id) === uid)
    || await isHrOrAdmin(uid)
    || (await core_kon`
        SELECT 1 FROM (
            SELECT supervisor_id, acting_supervisor_id FROM missions WHERE is_active = 'Y' AND mission_id = ${row.mission_id}
            UNION ALL SELECT supervisor_id, acting_supervisor_id FROM majors WHERE is_active = 'Y' AND major_id = ${row.major_id}
            UNION ALL SELECT supervisor_id, acting_supervisor_id FROM submajors WHERE is_active = 'Y' AND submajor_id = ${row.submajor_id}
        ) h WHERE h.supervisor_id = ${uid} OR h.acting_supervisor_id = ${uid} LIMIT 1`).length > 0;

export const getLeavePrintData = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [row] = await core_kon`
            SELECT r.id, r.user_id, r.approval_chain, u.mission_id, u.major_id, u.submajor_id
            FROM hr_leave_requests r JOIN users u ON u.id = r.user_id
            WHERE r.id = ${Number(params?.id)}`;
        if (!row) return fail(set, 404, 'ไม่พบใบลานี้');
        const owner = Number(row.user_id);
        if (!(await canViewLeave(uid, row))) return fail(set, 403, 'ไม่มีสิทธิ์พิมพ์ใบลานี้');

        const pkg = await leavePackage(owner);
        const request = pkg.data.find((r: any) => Number(r.id) === Number(row.id));
        return { success: true, data: { request, rows: pkg.data, profile: pkg.profile, approvers: pkg.approvers } };
    } catch (error: any) {
        return serverError(set, 'getLeavePrintData', error);
    }
};

// ── ไฟล์แนบของใบลา (ใบรับรองแพทย์ ฯลฯ) ─────────────────────────────────────
// document_url เก็บแค่ชื่อไฟล์ ใบที่โอนจากโปรแกรมเดิมอยู่ที่ uploads/hr-leave/legacy/ ใบที่ยื่นในระบบนี้อยู่ที่ uploads/hr-leave/
// ดูได้ตามสิทธิ์เดียวกับการพิมพ์ใบลา
const LEAVE_UPLOAD_DIR = join(process.cwd(), 'uploads', 'hr-leave');
const DOC_MIME: Record<string, string> = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
/** ชื่อไฟล์ล้วน (ตัด path ทิ้ง กันอ่านไฟล์นอกโฟลเดอร์) */
const docBaseName = (v: unknown): string | null => {
    const name = String(v ?? '').trim().split(/[\\/]/).pop() ?? '';
    return name && name !== '.' && name !== '..' ? name : null;
};

export const getLeaveDocument = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [row] = await core_kon`
            SELECT r.id, r.user_id, r.approval_chain, r.document_url, r.legacy_leave_id,
                   u.mission_id, u.major_id, u.submajor_id
            FROM hr_leave_requests r JOIN users u ON u.id = r.user_id
            WHERE r.id = ${Number(params?.id)}`;
        // ไม่มีสิทธิ์ตอบ 404 เหมือนไม่มีไฟล์ ไม่บอกว่ามีอยู่
        if (!row || !(await canViewLeave(uid, row))) return fail(set, 404, 'ไม่พบไฟล์แนบ');
        const name = docBaseName(row.document_url);
        if (!name) return fail(set, 404, 'ใบลานี้ไม่มีไฟล์แนบ');
        const file = Bun.file(join(LEAVE_UPLOAD_DIR, row.legacy_leave_id != null ? 'legacy' : '', name));
        if (!(await file.exists())) return fail(set, 404, 'ยังไม่มีไฟล์นี้ในเซิร์ฟเวอร์', 'FILE_MISSING');
        const ext = name.split('.').pop()?.toLowerCase() ?? '';
        set.headers['content-type'] = DOC_MIME[ext] ?? 'application/octet-stream';
        set.headers['content-disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(name)}`;
        return file;
    } catch (error: any) {
        return serverError(set, 'getLeaveDocument', error);
    }
};

// ── ประวัติการลาเจ้าหน้าที่ (หน้า /hr/leave/staff-history — ADMIN / HR) ──────────
// ทุกใบของทุกคน กรองตามปีงบ / ประเภท / สถานะ / ชื่อ / มีไฟล์แนบ แบ่งหน้าที่ server
// ส่งรายละเอียดครบ (ที่ติดต่อ ผู้ปฏิบัติแทน สายอนุมัติ ประวัติการกด) ให้เปิดดูได้โดยไม่ต้องยิงซ้ำ
const STAFF_HISTORY_STATUS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'CANCEL_PENDING'];

export const getStaffLeaveHistory = async ({ query, set }: any) => {
    try {
        const fy = Number(query?.fiscal_year);
        const range = Number.isInteger(fy) && fy > 2500 && fy < 2700
            ? { from: `${fy - 544}-10-01`, to: `${fy - 543}-09-30` } : null;
        const typeId = Number(query?.leave_type_id) || null;
        const status = STAFF_HISTORY_STATUS.includes(String(query?.status ?? '').toUpperCase())
            ? String(query.status).toUpperCase() : null;
        const q = String(query?.q ?? '').trim().slice(0, 100);
        const like = q ? `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%` : null;
        const hasDoc = String(query?.has_document ?? '') === '1';
        // การตรวจของงาน HR: UNCHECKED = ยังไม่ตรวจ · VERIFIED = ถูกต้อง · ADJUSTED = แก้จำนวนวันแล้ว
        const check = ['UNCHECKED', 'VERIFIED', 'ADJUSTED'].includes(String(query?.check ?? '').toUpperCase())
            ? String(query.check).toUpperCase() : null;
        const page = Math.max(1, Math.floor(Number(query?.page) || 1));
        const size = Math.min(100, Math.max(1, Math.floor(Number(query?.page_size) || 20)));

        const where = core_kon`
            WHERE ${range ? core_kon`r.start_date <= ${range.to}::date AND r.end_date >= ${range.from}::date` : core_kon`TRUE`}
              AND ${typeId ? core_kon`r.leave_type_id = ${typeId}` : core_kon`TRUE`}
              AND ${status ? core_kon`r.status = ${status}` : core_kon`TRUE`}
              AND ${hasDoc ? core_kon`NULLIF(TRIM(r.document_url), '') IS NOT NULL` : core_kon`TRUE`}
              AND ${check === 'UNCHECKED' ? core_kon`r.day_check_status IS NULL` : check ? core_kon`r.day_check_status = ${check}` : core_kon`TRUE`}
              AND ${like ? core_kon`(CONCAT(u.pname, u.fname, ' ', u.lname) ILIKE ${like} OR CONCAT(u.fname, ' ', u.lname) ILIKE ${like})` : core_kon`TRUE`}`;

        const [[{ total }], rows, years] = await Promise.all([
            core_kon`SELECT count(*)::int AS total FROM hr_leave_requests r JOIN users u ON u.id = r.user_id ${where}`,
            core_kon`
                SELECT r.id, r.user_id, CONCAT(u.pname, u.fname, ' ', u.lname) AS employee_name,
                       ${positionName('po')} AS position_name, ut.type_name AS user_type_name,
                       COALESCE(sm.name, ma.name, mi.name) AS unit_name,
                       t.name_th AS leave_type_name, t.code AS leave_type_code,
                       r.start_date, r.end_date, r.total_days, r.is_half_day, r.half_day_period,
                       r.status, r.reason, r.reject_reason, r.contact_info, ${substituteName()} AS substitute_name,
                       NULLIF(TRIM(r.document_url), '') AS document_name,
                       r.current_step, r.approval_chain, r.created_at,
                       c.status AS cancellation_status, c.reason AS cancellation_reason,
                       t.count_working_days_only, r.day_check_status, r.day_check_note, r.day_checked_at,
                       (SELECT CONCAT(cu.pname, cu.fname, ' ', cu.lname) FROM users cu WHERE cu.id = r.day_checked_by) AS day_checked_by_name
                FROM hr_leave_requests r
                JOIN hr_leave_types t ON t.id = r.leave_type_id
                JOIN users u ON u.id = r.user_id
                LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
                LEFT JOIN majors ma ON ma.major_id = u.major_id
                LEFT JOIN missions mi ON mi.mission_id = u.mission_id
                LEFT JOIN user_positions po ON po.user_position_id = u.user_position_id
                LEFT JOIN user_types ut ON ut.user_type_id = u.user_type_id
                ${latestCancellation()}
                ${where}
                ORDER BY r.start_date DESC, r.id DESC
                LIMIT ${size} OFFSET ${(page - 1) * size}`,
            // ปีงบที่มีใบลาจริง — ตัวกรองปีงบแสดงเฉพาะปีเหล่านี้ (ปีงบ พ.ศ. เริ่ม 1 ต.ค.)
            core_kon`
                SELECT DISTINCT (EXTRACT(YEAR FROM start_date)::int + 543
                       + CASE WHEN EXTRACT(MONTH FROM start_date) >= 10 THEN 1 ELSE 0 END) AS fy
                FROM hr_leave_requests ORDER BY fy DESC`,
        ]);

        const actions = await loadActions(rows.map((r: any) => Number(r.id)));
        // จำนวนวันที่นับได้ตามกฎของประเภท (วันทำการ / วันปฏิทิน + วันหยุดราชการ) — ให้ HR เทียบกับจำนวนวันในใบ
        const ruleDays = await Promise.all(rows.map(async (r: any) =>
            (await countLeaveDays(isoDate(r.start_date), isoDate(r.end_date), !!r.count_working_days_only, !!r.is_half_day)).computed_days));
        return {
            success: true,
            data: rows.map((r: any, i: number) => ({ ...r, rule_days: ruleDays[i], actions: actions.get(Number(r.id)) ?? [] })),
            pagination: { page, page_size: size, total },
            fiscal_years: years.map((y: any) => Number(y.fy)),
        };
    } catch (error: any) {
        return serverError(set, 'getStaffLeaveHistory', error);
    }
};

// ── ลบใบลา ──────────────────────────────────────────────────────────────────
//
// ลบออกจากฐานข้อมูลจริง อนุญาตเฉพาะกรณีที่ "ยังไม่มีผู้อนุมัติคนไหนกดเลย"
// เพราะเมื่อมีคนกดแล้ว การกดนั้นเป็นหลักฐานทางเอกสารที่ต้องเก็บไว้ ลบทิ้งไม่ได้
// (กรณีนั้นให้ใช้การถอนใบ ซึ่งเปลี่ยนสถานะเป็น CANCELLED และเก็บประวัติไว้ครบ)
//
// ยอดวันลาที่หักไปตอนบันทึก (days_deducted) คืนกลับในธุรกรรมเดียวกับการลบ
export const deleteLeaveRequest = async ({ params, user, set }: any) => {
    const uid = Number(user?.id);
    const requestId = Number(params?.id);
    try {
        return await core_kon.begin(async (tx: any) => {
            const [req] = await tx`
                SELECT id, user_id, status, leave_type_id, start_date, days_deducted
                FROM hr_leave_requests WHERE id = ${requestId} FOR UPDATE
            `;
            if (!req) return fail(set, 404, 'ไม่พบใบลานี้');
            if (Number(req.user_id) !== uid) return fail(set, 403, 'ลบได้เฉพาะใบลาของตัวเอง');
            if (req.status !== 'PENDING' && req.status !== 'DRAFT') {
                return fail(set, 409, `ใบลาสถานะ ${req.status} ลบไม่ได้`, 'NOT_DELETABLE');
            }

            const [acted] = await tx`
                SELECT count(*)::int AS n FROM hr_leave_approvals WHERE request_id = ${requestId}
            `;
            if (Number(acted.n) > 0) {
                return fail(set, 409,
                    'ใบลานี้มีผู้อนุมัติดำเนินการไปแล้ว ลบไม่ได้ — ใช้การถอนใบลาแทน',
                    'ALREADY_ACTIONED');
            }

            await setDeduction(tx, req, 0);
            await tx`DELETE FROM hr_leave_cancellations WHERE request_id = ${requestId}`;
            await tx`DELETE FROM hr_leave_requests WHERE id = ${requestId}`;
            return { success: true, data: { id: requestId }, message: 'ลบใบลาเรียบร้อย' };
        });
    } catch (error: any) {
        return serverError(set, 'deleteLeaveRequest', error);
    }
};

// ── แก้ไขใบลาของตัวเอง ────────────────────────────────────────────────────────
// แก้ได้เฉพาะใบ PENDING ที่ยังไม่มีผู้อนุมัติคนใดกด (เงื่อนไขเดียวกับการลบ) — ตรวจข้อมูลชุดเดียวกับตอนยื่น
// สายอนุมัติคำนวณใหม่ตามผังปัจจุบัน และเริ่มนับขั้นที่ 1 ใหม่
export const updateLeaveRequest = async ({ params, body, user, set }: any) => {
    const uid = Number(user?.id);
    const requestId = Number(params?.id);
    try {
        return await core_kon.begin(async (tx: any) => {
            const [req] = await tx`
                SELECT id, user_id, status, leave_type_id, start_date, total_days, days_deducted, day_check_status
                FROM hr_leave_requests WHERE id = ${requestId} FOR UPDATE
            `;
            if (!req) return fail(set, 404, 'ไม่พบใบลานี้');
            if (Number(req.user_id) !== uid) return fail(set, 403, 'แก้ไขได้เฉพาะใบลาของตัวเอง');
            if (req.status !== 'PENDING') return fail(set, 409, `ใบลาสถานะ ${req.status} แก้ไขไม่ได้`, 'NOT_EDITABLE');
            const [acted] = await tx`SELECT count(*)::int AS n FROM hr_leave_approvals WHERE request_id = ${requestId}`;
            if (Number(acted.n) > 0) {
                return fail(set, 409, 'ใบลานี้มีผู้อนุมัติดำเนินการไปแล้ว แก้ไขไม่ได้ — ใช้การถอนใบลาแล้วยื่นใหม่', 'ALREADY_ACTIONED');
            }
            // งาน HR ตรวจจำนวนวันแล้ว — ผู้ลาแก้เองไม่ได้ (ADMIN / HR แก้ได้ และผลการตรวจจะถูกล้างให้ตรวจใหม่)
            if (req.day_check_status && !(await isHrOrAdmin(uid))) {
                return fail(set, 409, 'งานทรัพยากรบุคคลตรวจจำนวนวันของใบลานี้แล้ว แก้ไขไม่ได้ — ติดต่องาน HR หากต้องแก้ไข', 'DAY_CHECKED');
            }

            const checked = await checkLeaveInput(uid, body, set, {
                id: requestId,
                leave_type_id: Number(req.leave_type_id),
                start_date: req.start_date,
                total_days: Number(req.total_days),
            }, await isHrOrAdmin(uid));
            if ('error' in checked) return checked.error;
            const substitute = await substituteOf(uid, body?.substitute_user_id);
            if (substitute === undefined) return fail(set, 400, 'ผู้ปฏิบัติหน้าที่แทนไม่ถูกต้อง');
            const contact = contactOf(body?.contact_info);
            if (contact === undefined) return fail(set, 400, `ที่ติดต่อระหว่างลายาวได้ไม่เกิน ${CONTACT_MAX} ตัวอักษร`);

            const chain = await resolveApprovalChain(uid);
            if (!chain || chain.steps.length === 0) {
                return fail(set, 422,
                    'ไม่พบผู้อนุมัติในสายบังคับบัญชาของคุณ กรุณาติดต่อฝ่ายบุคคลเพื่อตั้งค่าหัวหน้าหน่วยงาน',
                    'NO_APPROVER');
            }

            const { leave_type_id, start_date, end_date, total_days, is_half_day, half_day_period, reason } = body;
            await tx`
                UPDATE hr_leave_requests
                SET leave_type_id = ${leave_type_id}, start_date = ${start_date}, end_date = ${end_date},
                    total_days = ${total_days}, actual_days = ${total_days},
                    is_half_day = ${!!is_half_day}, half_day_period = ${half_day_period ?? null},
                    reason = ${reason ?? null}, substitute_user_id = ${substitute}, contact_info = ${contact},
                    approval_chain = ${JSON.stringify(chain.steps)}::text::jsonb, current_step = 1,
                    day_check_status = NULL, day_check_note = NULL, day_checked_by = NULL, day_checked_at = NULL,
                    updated_at = NOW()
                WHERE id = ${requestId}
            `;
            // ประเภท / ปีงบอาจเปลี่ยน — คืนยอดเดิมทั้งหมดแล้วหักใหม่ตามใบที่แก้
            await setDeduction(tx, req, 0);
            await setDeduction(tx, { id: requestId, user_id: uid, leave_type_id, start_date, days_deducted: 0 }, Number(total_days));
            return {
                success: true,
                data: { id: requestId, approval_chain: chain.steps, quota: checked.quota },
                message: `บันทึกการแก้ไขใบลาแล้ว รออนุมัติจาก${chain.steps[0].level_name} (${chain.steps[0].approver_name})`,
            };
        });
    } catch (error: any) {
        return serverError(set, 'updateLeaveRequest', error);
    }
};

// ── ใบลาที่รอฉันอนุมัติ ─────────────────────────────────────────────────────
// เงื่อนไขเดียว: ขั้นที่ใบกำลังรออยู่ ระบุ approver_id เป็นฉัน
// หัวหน้าที่ถือหมวกหลายใบจึงเห็นใบของทุกหน่วยที่ตัวเองคุม แต่ไม่เห็นของหน่วยอื่น
export const getPendingApprovals = async ({ user, query, set }: any) => {
    try {
        const uid = Number(user?.id);
        const scope = String(query?.scope ?? 'pending').toLowerCase();
        const isHr = await isHrOrAdmin(uid);

        const rows = await core_kon`
            SELECT r.id, r.user_id, CONCAT(u.pname, u.fname, ' ', u.lname) AS employee_name,
                   ${positionName('up')} AS position_name, sm.name AS submajor_name, ma.name AS major_name, mi.name AS mission_name,
                   r.leave_type_id, t.name_th AS leave_type_name, t.code AS leave_type_code,
                   r.start_date, r.end_date, r.total_days, r.actual_days,
                   r.is_half_day, r.half_day_period, r.status, r.reason, r.reject_reason,
                   r.document_url, r.approval_chain, r.current_step, r.created_at, r.days_deducted,
                   step.value AS my_step, ${dayCheckCols()},
                   c.id AS cancellation_id, c.status AS cancellation_status, c.reason AS cancellation_reason,
                   c.refunded_days AS cancellation_refunded_days, c.reject_comment AS cancellation_reject_comment
            FROM hr_leave_requests r
            JOIN hr_leave_types t ON t.id = r.leave_type_id
            JOIN users u ON u.id = r.user_id
            ${latestCancellation()}
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
            LEFT JOIN majors ma ON ma.major_id = u.major_id
            LEFT JOIN missions mi ON mi.mission_id = u.mission_id
            CROSS JOIN LATERAL jsonb_array_elements(r.approval_chain) AS step(value)
            WHERE jsonb_typeof(r.approval_chain) = 'array'
              AND ((step.value ->> 'approver_id')::int = ${uid}
                   OR (${isHr} AND (step.value ->> 'external')::boolean IS TRUE AND r.user_id <> ${uid}))
              ${scope === 'pending'
                ? core_kon`AND r.status = 'PENDING' AND (step.value ->> 'step')::int = r.current_step`
                : core_kon`AND (step.value ->> 'step')::int <= r.current_step`}
            ORDER BY r.created_at ASC
        `;
        const actions = await loadActions(rows.map((r: any) => Number(r.id)));
        const counts = await dayCountsOf(rows);
        return {
            success: true,
            data: rows.map((r: any) => {
                const day_count = counts.get(Number(r.id)) ?? null;
                return {
                    ...r, actions: actions.get(Number(r.id)) ?? [], day_count,
                    understated: !!day_count && Number(r.total_days) < day_count.computed_days,
                };
            }),
        };
    } catch (error: any) {
        return serverError(set, 'getPendingApprovals', error);
    }
};

/** จำนวนวันที่ปฏิทินนับได้ของแต่ละใบ (โหลดวันหยุดครั้งเดียว) — ใช้เตือนผู้อนุมัติเมื่อใบระบุวันน้อยกว่า */
const dayCountsOf = async (rows: any[]) => {
    const out = new Map<number, ReturnType<typeof countWithHolidays>>();
    if (!rows.length) return out;
    const typeIds = [...new Set(rows.map(r => Number(r.leave_type_id)))];
    const types = await core_kon`SELECT id, count_working_days_only FROM hr_leave_types WHERE id IN ${core_kon(typeIds)}`;
    const workingOnly = new Map(types.map((t: any) => [Number(t.id), !!t.count_working_days_only]));
    const starts = rows.map(r => isoDate(r.start_date)), ends = rows.map(r => isoDate(r.end_date));
    const holidays = await holidaysBetween(starts.reduce((a, b) => (a < b ? a : b)), ends.reduce((a, b) => (a > b ? a : b)));
    rows.forEach((r, i) => out.set(Number(r.id),
        countWithHolidays(starts[i], ends[i], workingOnly.get(Number(r.leave_type_id)) ?? true, !!r.is_half_day, holidays)));
    return out;
};

/** ประวัติการกดของแต่ละใบ — ใช้แสดง timeline ว่าใครอนุมัติในฐานะอะไรเมื่อไร */
const loadActions = async (requestIds: number[]): Promise<Map<number, any[]>> => {
    const ids = [...new Set(requestIds)];
    if (ids.length === 0) return new Map();
    const rows = await core_kon`
        SELECT a.request_id, a.step, a.action, a.comment, a.actioned_at, a.approver_id,
               a.level, a.unit_type, a.unit_id,
               CONCAT(u.pname, u.fname, ' ', u.lname) AS approver_name
        FROM hr_leave_approvals a
        JOIN users u ON u.id = a.approver_id
        WHERE a.request_id IN ${core_kon(ids)}
        ORDER BY a.step ASC, a.actioned_at ASC
    `;
    const out = new Map<number, any[]>();
    for (const r of rows) {
        const key = Number(r.request_id);
        if (!out.has(key)) out.set(key, []);
        out.get(key)!.push(r);
    }
    return out;
};

// ── อนุมัติ / ไม่อนุมัติ ────────────────────────────────────────────────────
const actOnRequest = async (
    { params, body, user, set }: any,
    action: 'APPROVED' | 'REJECTED',
) => {
    const uid = Number(user?.id);
    const requestId = Number(params?.id);
    const comment = body?.comment ?? null;

    if (action === 'REJECTED' && !String(comment ?? '').trim()) {
        return fail(set, 400, 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
    }

    try {
        return await core_kon.begin(async (tx: any) => {
            // ล็อกแถวไว้ก่อน กันสองคนกดพร้อมกันแล้วขั้นเดินซ้ำ
            const [req] = await tx`
                SELECT id, user_id, leave_type_id, start_date, total_days, days_deducted, status, approval_chain, current_step
                FROM hr_leave_requests WHERE id = ${requestId} FOR UPDATE
            `;
            if (!req) return fail(set, 404, 'ไม่พบใบลานี้');
            if (req.status !== 'PENDING') {
                return fail(set, 409, `ใบลานี้ไม่ได้อยู่ในสถานะรออนุมัติแล้ว (สถานะปัจจุบัน: ${req.status})`, 'NOT_PENDING');
            }

            const chain: ChainStep[] = parseChain(req.approval_chain);
            const step = stepFor(chain, Number(req.current_step));
            if (!step) return fail(set, 500, 'สายอนุมัติของใบลานี้ไม่สมบูรณ์ กรุณาติดต่อผู้ดูแลระบบ');

            if (!canActOnStep(step, uid, await isHrOrAdmin(uid))) {
                return fail(set, 403, `ขั้นนี้รออนุมัติจาก${step.level_name} (${step.approver_name}) คุณไม่มีสิทธิ์กดในขั้นนี้`, 'NOT_YOUR_STEP');
            }
            if (Number(req.user_id) === uid) {
                return fail(set, 403, 'อนุมัติใบลาของตัวเองไม่ได้');
            }

            await tx`
                INSERT INTO hr_leave_approvals
                    (request_id, approver_id, step, action, comment, level, unit_type, unit_id)
                VALUES (${requestId}, ${uid}, ${step.step}, ${action}, ${comment},
                        ${step.level}, ${step.unit_type}, ${step.unit_id})
            `;

            if (action === 'REJECTED') {
                await tx`
                    UPDATE hr_leave_requests
                    SET status = 'REJECTED', reject_reason = ${comment}, updated_at = now()
                    WHERE id = ${requestId}
                `;
                await setDeduction(tx, req, 0);  // ไม่อนุมัติ = คืนยอดที่หักไว้ตอนบันทึก
                return { success: true, data: { id: requestId, status: 'REJECTED' }, message: 'บันทึกการไม่อนุมัติแล้ว' };
            }

            const nextStep = Number(req.current_step) + 1;
            const isFinal = nextStep > chain.length;

            if (!isFinal) {
                await tx`
                    UPDATE hr_leave_requests SET current_step = ${nextStep}, updated_at = now()
                    WHERE id = ${requestId}
                `;
                const next = stepFor(chain, nextStep)!;
                return {
                    success: true,
                    data: { id: requestId, status: 'PENDING', current_step: nextStep },
                    message: `อนุมัติแล้ว ส่งต่อให้${next.level_name} (${next.approver_name})`,
                };
            }

            await tx`
                UPDATE hr_leave_requests
                SET status = 'APPROVED', current_step = ${nextStep}, updated_at = now()
                WHERE id = ${requestId}
            `;
            // ปกติหักไปแล้วตอนบันทึก — ใบเก่าที่ยังไม่ได้หัก (days_deducted = 0) หักตอนนี้
            if (Number(req.days_deducted) !== Number(req.total_days)) await setDeduction(tx, req, Number(req.total_days));

            return { success: true, data: { id: requestId, status: 'APPROVED' }, message: 'อนุมัติครบทุกขั้นแล้ว' };
        });
    } catch (error: any) {
        return serverError(set, 'actOnRequest', error);
    }
};

export const approveLeaveRequest = (ctx: any) => actOnRequest(ctx, 'APPROVED');
export const rejectLeaveRequest = (ctx: any) => actOnRequest(ctx, 'REJECTED');

/**
 * บวก/ลบยอดวันลาที่ใช้ไปของปีงบนั้น
 * ไม่มีแถวยอดคงเหลือก็สร้างให้ เพราะ HR ยังไม่ได้ตั้งยอดต้นปีให้ทุกคน
 * แต่ห้ามให้ used ติดลบ (เช่น ยกเลิกใบที่ตัดยอดก่อนระบบนี้ใช้งาน)
 */
const adjustBalance = async (tx: any, userId: number, leaveTypeId: number, startDate: unknown, days: number) => {
    const fy = fiscalYearOf(startDate);
    const [existing] = await tx`
        SELECT id, used FROM hr_leave_balances
        WHERE user_id = ${userId} AND leave_type_id = ${leaveTypeId} AND fiscal_year = ${fy}
        FOR UPDATE
    `;
    if (existing) {
        const next = Math.max(Number(existing.used) + days, 0);
        await tx`UPDATE hr_leave_balances SET used = ${next}, updated_at = now() WHERE id = ${existing.id}`;
        // ปีนี้ยกยอดไปปีถัดไปแล้ว (เช่น ยกเลิกใบลาข้ามปีงบ) — ปรับยอดยกมาตามคงเหลือใหม่ ไม่เกินเพดานสะสม
        await syncCarriedForward(tx, userId, leaveTypeId, fy);
        return;
    }
    if (days <= 0) return;   // ไม่มีแถวอยู่แล้ว และเป็นการคืนยอด — ไม่ต้องสร้างแถวเปล่า
    // ใส่สิทธิ์ตามประเภทเจ้าหน้าที่ไว้ด้วย ไม่งั้นแถวที่ entitled = 0 ทำให้เพดานวันลาไม่ถูกบังคับ
    const entitled = (await entitlementFor(userId, leaveTypeId, typeof startDate === 'string' ? startDate.slice(0, 10) : undefined)) ?? 0;
    await tx`
        INSERT INTO hr_leave_balances (user_id, leave_type_id, fiscal_year, carried_in, entitled, used, note, auto_created)
        VALUES (${userId}, ${leaveTypeId}, ${fy}, 0, ${entitled}, ${days}, 'สร้างอัตโนมัติจากการบันทึกใบลา', TRUE)
    `;
    await syncCarriedForward(tx, userId, leaveTypeId, fy);
};

/** ให้ยอดที่หักของใบนี้เท่ากับ target วัน (หัก/คืนเฉพาะส่วนต่าง) แล้วจำไว้ที่ days_deducted */
type DeductRow = { id: unknown; user_id: unknown; leave_type_id: unknown; start_date: unknown; days_deducted: unknown };
export const setDeduction = async (tx: any, req: DeductRow, target: number) => {
    const diff = target - Number(req.days_deducted ?? 0);
    if (diff !== 0) await adjustBalance(tx, Number(req.user_id), Number(req.leave_type_id), req.start_date, diff);
    await tx`UPDATE hr_leave_requests SET days_deducted = ${target} WHERE id = ${Number(req.id)}`;
};

// ── ขอยกเลิกใบลาที่อนุมัติแล้ว ──────────────────────────────────────────────
export const requestCancellation = async ({ params, body, user, set }: any) => {
    const uid = Number(user?.id);
    const requestId = Number(params?.id);
    try {
        return await core_kon.begin(async (tx: any) => {
            const [req] = await tx`
                SELECT id, user_id, status, approval_chain, leave_type_id, start_date, days_deducted
                FROM hr_leave_requests WHERE id = ${requestId} FOR UPDATE
            `;
            if (!req) return fail(set, 404, 'ไม่พบใบลานี้');
            if (Number(req.user_id) !== uid) return fail(set, 403, 'ยกเลิกได้เฉพาะใบลาของตัวเอง');

            // ยังไม่มีใครอนุมัติ = ถอนใบได้เลย ไม่ต้องเข้าสายอนุมัติ
            if (req.status === 'PENDING') {
                await tx`
                    UPDATE hr_leave_requests SET status = 'CANCELLED', updated_at = now() WHERE id = ${requestId}
                `;
                await setDeduction(tx, req, 0);
                return { success: true, data: { id: requestId, status: 'CANCELLED' }, message: 'ถอนใบลาเรียบร้อย คืนยอดวันลาแล้ว' };
            }
            if (req.status !== 'APPROVED') {
                return fail(set, 409, `ใบลาสถานะ ${req.status} ยกเลิกไม่ได้`, 'NOT_CANCELLABLE');
            }

            const chain: ChainStep[] = parseChain(req.approval_chain);
            if (chain.length === 0) return fail(set, 500, 'สายอนุมัติของใบลานี้ไม่สมบูรณ์');

            const [cancel] = await tx`
                INSERT INTO hr_leave_cancellations (request_id, cancelled_by, reason, status_before, status)
                VALUES (${requestId}, ${uid}, ${body?.reason ?? null}, ${req.status}, 'PENDING')
                RETURNING id
            `;
            // การยกเลิกเดินสายอนุมัติชุดเดิม เริ่มที่ขั้น 1 ใหม่
            await tx`
                UPDATE hr_leave_requests SET status = 'CANCEL_PENDING', current_step = 1, updated_at = now()
                WHERE id = ${requestId}
            `;
            return {
                success: true,
                data: { id: requestId, cancellation_id: cancel.id, status: 'CANCEL_PENDING' },
                message: `ส่งคำขอยกเลิกแล้ว รออนุมัติจาก${chain[0].level_name} (${chain[0].approver_name})`,
            };
        });
    } catch (error: any) {
        if (/hr_leave_cancellations_request_id_key|uq_leave_cancellations_pending/.test(String(error?.message ?? ''))) {
            return fail(set, 409, 'ใบลานี้มีคำขอยกเลิกอยู่แล้ว', 'DUPLICATE_CANCEL');
        }
        return serverError(set, 'requestCancellation', error);
    }
};

const actOnCancellation = async (
    { params, body, user, set }: any,
    action: 'APPROVED' | 'REJECTED',
) => {
    const uid = Number(user?.id);
    const requestId = Number(params?.id);
    const comment = body?.comment ?? null;

    if (action === 'REJECTED' && !String(comment ?? '').trim()) {
        return fail(set, 400, 'กรุณาระบุเหตุผลที่ไม่อนุมัติการยกเลิก');
    }

    try {
        return await core_kon.begin(async (tx: any) => {
            const [req] = await tx`
                SELECT r.id, r.user_id, r.leave_type_id, r.start_date, r.total_days, r.days_deducted, r.status,
                       r.approval_chain, r.current_step, c.id AS cancellation_id, c.status_before
                FROM hr_leave_requests r
                JOIN hr_leave_cancellations c ON c.request_id = r.id AND c.status = 'PENDING'
                WHERE r.id = ${requestId} FOR UPDATE OF r
            `;
            if (!req) return fail(set, 404, 'ไม่พบคำขอยกเลิกที่รออนุมัติของใบลานี้');
            if (req.status !== 'CANCEL_PENDING') {
                return fail(set, 409, `ใบลานี้ไม่ได้อยู่ระหว่างขอยกเลิก (สถานะ: ${req.status})`, 'NOT_CANCEL_PENDING');
            }

            const chain: ChainStep[] = parseChain(req.approval_chain);
            const step = stepFor(chain, Number(req.current_step));
            if (!step) return fail(set, 500, 'สายอนุมัติของใบลานี้ไม่สมบูรณ์');
            if (!canActOnStep(step, uid, await isHrOrAdmin(uid))) {
                return fail(set, 403, `ขั้นนี้รออนุมัติจาก${step.level_name} (${step.approver_name})`, 'NOT_YOUR_STEP');
            }
            if (Number(req.user_id) === uid) return fail(set, 403, 'อนุมัติการยกเลิกใบลาของตัวเองไม่ได้');

            await tx`
                INSERT INTO hr_leave_approvals
                    (cancellation_id, approver_id, step, action, comment, level, unit_type, unit_id)
                VALUES (${req.cancellation_id}, ${uid}, ${step.step}, ${action}, ${comment},
                        ${step.level}, ${step.unit_type}, ${step.unit_id})
            `;

            if (action === 'REJECTED') {
                // ไม่อนุมัติการยกเลิก = ใบลากลับไปเป็นสถานะเดิม (ยังลาอยู่) ยอดวันลาไม่ต้องแตะ
                await tx`
                    UPDATE hr_leave_cancellations SET status = 'REJECTED', updated_at = now()
                    WHERE id = ${req.cancellation_id}
                `;
                await tx`
                    UPDATE hr_leave_requests
                    SET status = ${req.status_before}, current_step = ${chain.length + 1}, updated_at = now()
                    WHERE id = ${requestId}
                `;
                return { success: true, data: { id: requestId, status: req.status_before }, message: 'ไม่อนุมัติการยกเลิก ใบลากลับสู่สถานะเดิม' };
            }

            const nextStep = Number(req.current_step) + 1;
            if (nextStep <= chain.length) {
                await tx`
                    UPDATE hr_leave_requests SET current_step = ${nextStep}, updated_at = now() WHERE id = ${requestId}
                `;
                const next = stepFor(chain, nextStep)!;
                return {
                    success: true,
                    data: { id: requestId, status: 'CANCEL_PENDING', current_step: nextStep },
                    message: `อนุมัติการยกเลิกแล้ว ส่งต่อให้${next.level_name} (${next.approver_name})`,
                };
            }

            // คืนยอดที่หักไว้เข้าปีงบของวันเริ่มลา — ใบเก่าก่อนมี days_deducted ถูกหักตอนอนุมัติ ใช้ total_days แทน
            const deducted = Number(req.days_deducted) > 0 ? Number(req.days_deducted)
                : (req.status_before === 'APPROVED' ? Number(req.total_days) : 0);
            await setDeduction(tx, { ...req, days_deducted: deducted }, 0);
            await tx`
                UPDATE hr_leave_cancellations SET status = 'APPROVED', refunded_days = ${deducted}, updated_at = now()
                WHERE id = ${req.cancellation_id}
            `;
            await tx`
                UPDATE hr_leave_requests SET status = 'CANCELLED', updated_at = now() WHERE id = ${requestId}
            `;
            return {
                success: true,
                data: { id: requestId, status: 'CANCELLED', refunded_days: deducted },
                message: deducted > 0 ? `ยกเลิกใบลาเรียบร้อย คืนวันลา ${deducted} วัน` : 'ยกเลิกใบลาเรียบร้อย',
            };
        });
    } catch (error: any) {
        return serverError(set, 'actOnCancellation', error);
    }
};

export const approveCancellation = (ctx: any) => actOnCancellation(ctx, 'APPROVED');
export const rejectCancellation = (ctx: any) => actOnCancellation(ctx, 'REJECTED');

// ── อนุมัติแบบกลุ่ม (เลือกหลายใบจากหน้าอนุมัติ) ───────────────────────────────
// ทำทีละใบด้วยกติกาเดียวกับกดทีละใบ (แต่ละใบ transaction ของตัวเอง) — ใบที่ไม่ใช่คิวของผู้กด
// หรือสถานะเปลี่ยนไปแล้วจะไม่ผ่านเฉพาะใบนั้น ใบอื่นยังอนุมัติได้ · ส่งผลรายใบกลับไปให้หน้าจอแสดง
const BULK_MAX = 100;
const bulkAct = async (ctx: any, handler: (c: any) => Promise<any>, defaultComment: string) => {
    const ids = [...new Set<number>((Array.isArray(ctx.body?.ids) ? ctx.body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0))];
    if (ids.length === 0) return fail(ctx.set, 400, 'กรุณาเลือกรายการที่จะอนุมัติ');
    if (ids.length > BULK_MAX) return fail(ctx.set, 400, `อนุมัติได้ครั้งละไม่เกิน ${BULK_MAX} รายการ`);
    const comment = String(ctx.body?.comment ?? '').trim() || defaultComment;
    const results: { id: number; success: boolean; status?: string; message?: string; code?: string; refunded_days?: number }[] = [];
    for (const id of ids) {
        const set: any = {};
        const r = await handler({ ...ctx, params: { id }, body: { comment }, set });
        results.push({
            id, success: !!r?.success, status: r?.data?.status, message: r?.message, code: r?.code,
            ...(r?.data?.refunded_days != null ? { refunded_days: r.data.refunded_days } : {}),
        });
    }
    const ok = results.filter(r => r.success).length;
    return {
        success: true,
        data: { total: ids.length, ok, failed: ids.length - ok, results },
        message: ok === ids.length ? `อนุมัติเรียบร้อย ${ok} รายการ` : `อนุมัติสำเร็จ ${ok} จาก ${ids.length} รายการ`,
    };
};
export const bulkApproveLeaveRequests = (ctx: any) => bulkAct(ctx, approveLeaveRequest, 'อนุมัติ (แบบกลุ่ม)');
export const bulkApproveCancellations = (ctx: any) => bulkAct(ctx, approveCancellation, 'อนุมัติการยกเลิก (แบบกลุ่ม)');

// ── รายละเอียดใบลาใบเดียว ───────────────────────────────────────────────────
// เห็นได้เฉพาะเจ้าของใบ ผู้ที่อยู่ในสายอนุมัติของใบนั้น และ ADMIN
export const getLeaveRequestById = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [row] = await core_kon`
            SELECT r.*, t.name_th AS leave_type_name, t.code AS leave_type_code, ${substituteName()} AS substitute_name,
                   CONCAT(u.pname, u.fname, ' ', u.lname) AS employee_name,
                   c.id AS cancellation_id, c.status AS cancellation_status, c.reason AS cancellation_reason,
                   c.refunded_days AS cancellation_refunded_days, c.reject_comment AS cancellation_reject_comment
            FROM hr_leave_requests r
            JOIN hr_leave_types t ON t.id = r.leave_type_id
            JOIN users u ON u.id = r.user_id
            ${latestCancellation()}
            WHERE r.id = ${Number(params?.id)}
        `;
        if (!row) return fail(set, 404, 'ไม่พบใบลานี้');

        const chain: ChainStep[] = parseChain(row.approval_chain);
        const inChain = chain.some(s => Number(s.approver_id) === uid);
        if (Number(row.user_id) !== uid && !inChain && !(await isAdmin(uid))) {
            return fail(set, 403, 'ไม่มีสิทธิ์ดูใบลานี้');
        }

        const actions = await loadActions([Number(row.id)]);
        return { success: true, data: { ...row, actions: actions.get(Number(row.id)) ?? [] } };
    } catch (error: any) {
        return serverError(set, 'getLeaveRequestById', error);
    }
};

// ── สรุปรายการลา (หน้า /hr/leave/status) ────────────────────────────────────
//
// ขอบเขตที่เห็นขึ้นกับอำนาจของผู้เรียก ไม่ได้เปิดให้ดูทั้งองค์กรทุกคน
//   ADMIN / HR        → เห็นทุกคน
//   หัวหน้าหน่วยใด ๆ  → เห็นคนในหน่วยที่ตัวเองคุม (ครบทุกหมวกที่ถืออยู่)
//   พนักงานทั่วไป      → เห็นเฉพาะของตัวเอง
//
// ส่ง scopes กลับไปด้วย เพื่อให้หน้าจอสร้างตัวกรองจากสิ่งที่ผู้ใช้มีสิทธิ์จริง
// ไม่ใช่รายการหน่วยงานตายตัวที่อาจไม่ตรงกับอำนาจของคนที่เปิดดู
export const getLeaveSummary = async ({ user, query, set }: any) => {
    try {
        const uid = Number(user?.id);

        // ช่วงวันที่ที่หน้าจอกำลังดูอยู่ — ดึงใบที่ "คาบเกี่ยว" ช่วงนี้ทั้งใบ
        // (ใบที่คร่อมรอยต่อต้องได้มาทั้งใบ ไม่งั้นหน้าจอตัดวันตามรอบเองไม่ได้)
        const ymd = /^\d{4}-\d{2}-\d{2}$/;
        const from = ymd.test(String(query?.from ?? '')) ? String(query.from) : null;
        const to = ymd.test(String(query?.to ?? '')) ? String(query.to) : null;

        const [roleRows, missions, majors, submajors] = await Promise.all([
            core_kon`
                SELECT UPPER(r.role_name) AS role_name
                FROM core_kon.user_m_users_roles mu
                JOIN core_kon.user_roles r ON r.id = mu.role_id
                WHERE mu.user_id = ${uid}`,
            core_kon`
                SELECT mission_id AS id, name FROM missions
                WHERE is_active = 'Y' AND (supervisor_id = ${uid} OR acting_supervisor_id = ${uid}) ORDER BY name`,
            core_kon`
                SELECT major_id AS id, name FROM majors
                WHERE is_active = 'Y' AND (supervisor_id = ${uid} OR acting_supervisor_id = ${uid}) ORDER BY name`,
            core_kon`
                SELECT submajor_id AS id, name FROM submajors
                WHERE is_active = 'Y' AND (supervisor_id = ${uid} OR acting_supervisor_id = ${uid}) ORDER BY name`,
        ]);

        const roles = roleRows.map((r: any) => r.role_name);
        const canSeeAll = roles.includes('ADMIN') || roles.includes('HR');

        const missionIds = missions.map((m: any) => Number(m.id));
        const majorIds = majors.map((m: any) => Number(m.id));
        const submajorIds = submajors.map((m: any) => Number(m.id));

        const rows = await core_kon`
            SELECT r.id, r.user_id, CONCAT(u.pname, u.fname, ' ', u.lname) AS employee_name,
                   sm.name AS submajor_name, ma.name AS major_name, mi.name AS mission_name,
                   ${positionName('po')} AS position_name, ut.type_name AS user_type_name,
                   t.name_th AS leave_type_name, t.code AS leave_type_code,
                   r.start_date, r.end_date, r.total_days, r.status, r.reason, r.reject_reason,
                   r.current_step, r.approval_chain, r.created_at
            FROM hr_leave_requests r
            JOIN hr_leave_types t ON t.id = r.leave_type_id
            JOIN users u ON u.id = r.user_id
            LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
            LEFT JOIN majors ma ON ma.major_id = u.major_id
            LEFT JOIN missions mi ON mi.mission_id = u.mission_id
            LEFT JOIN user_positions po ON po.user_position_id = u.user_position_id
            LEFT JOIN user_types ut ON ut.user_type_id = u.user_type_id
            WHERE ${from ? core_kon`r.end_date >= ${from}::date` : core_kon`TRUE`}
              AND ${to ? core_kon`r.start_date <= ${to}::date` : core_kon`TRUE`}
              AND ${canSeeAll
                ? core_kon`TRUE`
                : core_kon`(
                    r.user_id = ${uid}
                    ${missionIds.length ? core_kon`OR u.mission_id IN ${core_kon(missionIds)}` : core_kon``}
                    ${majorIds.length ? core_kon`OR u.major_id IN ${core_kon(majorIds)}` : core_kon``}
                    ${submajorIds.length ? core_kon`OR u.submajor_id IN ${core_kon(submajorIds)}` : core_kon``}
                  )`}
            ORDER BY r.start_date DESC
        `;

        return {
            success: true,
            data: rows,
            scope: {
                can_see_all: canSeeAll,
                missions,
                majors,
                submajors,
            },
        };
    } catch (error: any) {
        return serverError(set, 'getLeaveSummary', error);
    }
};

// ── ปฏิทินการลา (หน้า /hr/leave) ──────────────────────────────────────────────
// ขอบเขตที่เลือกดูได้ขึ้นกับตำแหน่งในผังของผู้ login:
//   me     = ของฉัน (ทุกคน)
//   team   = เพื่อนร่วมกลุ่มงาน (ทุกคนที่มีกลุ่มงาน) — ซ่อนประเภท/เหตุผลการลาของคนอื่น เห็นแค่ว่า "ลา"
//   chain  = ใบลาที่สายอนุมัติระบุรหัสของฉัน (หัวหน้า/รักษาการ หน่วยงาน กลุ่มงาน กลุ่มภารกิจ และ ผอ.)
//            ตรงกับหน้าอนุมัติการลา — ผอ. จึงเห็นเฉพาะใบของหัวหน้ากลุ่มภารกิจ/รักษาการ ที่เสนอ ผอ. โดยตรง
//   all    = ทั้งโรงพยาบาล (ADMIN / HR)
// ไม่รวมใบที่ไม่อนุมัติ/ยกเลิกแล้ว
const CALENDAR_STATUSES = ['PENDING', 'APPROVED', 'CANCEL_PENDING'];
const CALENDAR_MAX_DAYS = 62;

export const getLeaveCalendar = async ({ user, query, set }: any) => {
    try {
        const uid = Number(user?.id);
        const ymd = /^\d{4}-\d{2}-\d{2}$/;
        const from = String(query?.from ?? '');
        const to = String(query?.to ?? '');
        if (!ymd.test(from) || !ymd.test(to)) return fail(set, 400, 'ระบุช่วงวันที่ from / to เป็น YYYY-MM-DD');
        const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
        if (!(days >= 0 && days <= CALENDAR_MAX_DAYS)) return fail(set, 400, `ช่วงวันที่ต้องไม่เกิน ${CALENDAR_MAX_DAYS} วัน`);

        const [[me], roleRows, directorRows, missions, majors, submajors] = await Promise.all([
            core_kon`
                SELECT u.major_id, mj.name AS major_name
                FROM users u LEFT JOIN majors mj ON mj.major_id = u.major_id
                WHERE u.id = ${uid}`,
            core_kon`
                SELECT UPPER(r.role_name) AS role_name
                FROM core_kon.user_m_users_roles mu JOIN core_kon.user_roles r ON r.id = mu.role_id
                WHERE mu.user_id = ${uid}`,
            core_kon`SELECT name, value FROM hr_settings WHERE name IN ('director_id', 'acting_director_id')`,
            core_kon`
                SELECT mission_id AS id, name, (supervisor_id = ${uid}) AS is_primary FROM missions
                WHERE is_active = 'Y' AND (supervisor_id = ${uid} OR acting_supervisor_id = ${uid}) ORDER BY name`,
            core_kon`
                SELECT major_id AS id, name, (supervisor_id = ${uid}) AS is_primary FROM majors
                WHERE is_active = 'Y' AND (supervisor_id = ${uid} OR acting_supervisor_id = ${uid}) ORDER BY name`,
            core_kon`
                SELECT submajor_id AS id, name, (supervisor_id = ${uid}) AS is_primary FROM submajors
                WHERE is_active = 'Y' AND (supervisor_id = ${uid} OR acting_supervisor_id = ${uid}) ORDER BY name`,
        ]);
        const roles = roleRows.map((r: any) => r.role_name);
        const directorRole = directorRows.find((r: any) => r.value != null && Number(r.value) === uid)?.name;
        const canSeeAll = roles.includes('ADMIN') || roles.includes('HR');
        const units = [...missions, ...majors, ...submajors];

        // ตัวเลือกเรียงจากกว้างไปแคบ — ค่าตั้งต้นคือขอบเขตที่กว้างที่สุดที่มีสิทธิ์
        const options: { key: string; label: string; group: string }[] = [];
        if (canSeeAll) options.push({ key: 'all', label: 'ทั้งโรงพยาบาล', group: 'ผู้ดูแลระบบ' });
        if (directorRole) {
            options.push({
                key: 'chain',
                label: 'หัวหน้ากลุ่มภารกิจ / รักษาการ',
                group: directorRole === 'director_id' ? 'ผู้อำนวยการ' : 'รักษาการผู้อำนวยการ',
            });
        } else if (units.length) {
            options.push({
                key: 'chain',
                label: 'บุคลากรในสายบังคับบัญชาของฉัน',
                group: units.some((u: any) => u.is_primary) ? 'หัวหน้า' : 'รักษาการ',
            });
        }
        if (me?.major_id != null) options.push({ key: 'team', label: `เพื่อนร่วม${me.major_name ?? 'กลุ่มงาน'}`, group: 'เจ้าหน้าที่' });
        options.push({ key: 'me', label: 'การลาของฉัน', group: 'เจ้าหน้าที่' });

        const scope = String(query?.scope ?? options[0].key);
        if (!options.some(o => o.key === scope)) return fail(set, 403, 'ไม่มีสิทธิ์ดูขอบเขตนี้');

        const scopeFrag =
            scope === 'all' ? core_kon`TRUE`
            : scope === 'me' ? core_kon`r.user_id = ${uid}`
            : scope === 'team' ? core_kon`u.major_id = ${me.major_id}`
            // สายอนุมัติที่ "แช่แข็ง" ไว้ในใบตอนยื่น มีรหัสของฉันเป็นผู้อนุมัติขั้นใดขั้นหนึ่ง
            : core_kon`jsonb_typeof(r.approval_chain) = 'array' AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements(r.approval_chain) AS step(value)
                  WHERE (step.value ->> 'approver_id')::int = ${uid})`;
        const masked = scope === 'team';

        const rows = await core_kon`
            SELECT r.id, r.user_id, CONCAT(u.pname, u.fname, ' ', u.lname) AS employee_name,
                   ${positionName('po')} AS position_name, COALESCE(sm.name, ma.name) AS unit_name,
                   t.code AS leave_type_code, t.name_th AS leave_type_name,
                   to_char(r.start_date, 'YYYY-MM-DD') AS start_date, to_char(r.end_date, 'YYYY-MM-DD') AS end_date,
                   r.total_days, r.is_half_day, r.half_day_period, r.status, r.reason,
                   r.approval_chain, r.current_step
            FROM hr_leave_requests r
            JOIN hr_leave_types t ON t.id = r.leave_type_id
            JOIN users u ON u.id = r.user_id
            LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
            LEFT JOIN majors ma ON ma.major_id = u.major_id
            LEFT JOIN user_positions po ON po.user_position_id = u.user_position_id
            WHERE r.status IN ${core_kon(CALENDAR_STATUSES)}
              AND r.end_date >= ${from}::date AND r.start_date <= ${to}::date
              AND ${scopeFrag}
            ORDER BY r.start_date, employee_name`;

        return {
            success: true,
            data: {
                scope,
                options,
                masked,
                // เหตุผลการลาเป็นข้อมูลส่วนตัว — ส่งให้เจ้าของใบ, ADMIN/HR (ทั้งโรงพยาบาล) และผู้อนุมัติในสาย
                // (ขอบเขต chain = ใบที่ฉันเป็นผู้อนุมัติขั้นใดขั้นหนึ่ง เห็นเหตุผลในหน้าอนุมัติอยู่แล้ว) · เพื่อนร่วมกลุ่มงานไม่เห็น
                // เพื่อนร่วมกลุ่มงาน: ประเภทการลา (เช่น ลาป่วย) ก็ส่งเฉพาะของตัวเองเช่นกัน
                events: rows.map((r: any) => {
                    const mine = Number(r.user_id) === uid;
                    // รออนุมัติ / รออนุมัติยกเลิก → ผู้อนุมัติลำดับที่ใบกำลังรออยู่ (ลำดับ 1 กดแล้วจะเลื่อนเป็นลำดับ 2 ...)
                    const { approval_chain, current_step, ...rest } = r;
                    const steps = parseChain(approval_chain);
                    const cur = r.status === 'PENDING' || r.status === 'CANCEL_PENDING' ? stepFor(steps, Number(current_step)) : null;
                    return {
                        ...rest,
                        waiting_for: cur
                            ? { step: cur.step, total: steps.length, level_name: cur.level_name, approver_name: cur.approver_name, is_acting: cur.is_acting }
                            : null,
                        is_mine: mine,
                        reason: mine || scope === 'all' || scope === 'chain' ? r.reason : null,
                        ...(masked && !mine ? { leave_type_code: null, leave_type_name: null } : {}),
                    };
                }),
            },
        };
    } catch (error: any) {
        return serverError(set, 'getLeaveCalendar', error);
    }
};
