import { core_kon } from '../db/db';
import { resolveApprovalChain, stepFor, parseChain, type ChainStep } from '../services/leaveChain';
import { resolveLeaveSubject, isHrOrAdmin, hasCreatedByColumn } from '../services/leaveSubject';
import { countLeaveDays, countWithHolidays, holidaysBetween } from '../services/leaveDays';
import { maxAdvanceDays, bangkokDate } from '../services/leaveRules';

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
}

/** สิทธิ์ต่อปีตามประเภทเจ้าหน้าที่ + อายุงาน (null = ไม่ได้กำหนดสิทธิ์ไว้) */
// เลือก tier ตามอายุงาน — แต่ทะเบียนบุคลากรส่วนใหญ่ยังไม่ได้กรอก hire_date ถ้าไม่มีวันเริ่มงาน
// ให้ใช้ tier ต่ำสุดเป็นฐาน ดีกว่าถือว่า "ไม่มีสิทธิ์" ซึ่งจะทำให้เพดานวันลาไม่ถูกบังคับกับเกือบทั้งองค์กร
const entitlementFor = async (userId: number, leaveTypeId: number): Promise<number | null> => {
    const rows = await core_kon`
            SELECT e.max_days_per_year, e.min_service_months
            FROM hr_leave_entitlements e
            JOIN users u ON u.user_type_id = e.user_type_id
            WHERE u.id = ${userId} AND e.leave_type_id = ${leaveTypeId}
              AND (u.hire_date IS NULL
                   OR e.min_service_months <= EXTRACT(YEAR FROM age(now(), u.hire_date)) * 12
                                            + EXTRACT(MONTH FROM age(now(), u.hire_date)))
            ORDER BY
                CASE WHEN (SELECT hire_date FROM users WHERE id = ${userId}) IS NULL
                     THEN e.min_service_months END ASC,
                e.min_service_months DESC
            LIMIT 1`;
    return rows.length && rows[0].max_days_per_year != null ? Number(rows[0].max_days_per_year) : null;
};

const leaveQuota = async (userId: number, leaveTypeId: number, fy: number): Promise<LeaveQuota> => {
    const [balance, entRows, pendingRows] = await Promise.all([
        core_kon`
            SELECT carried_in, entitled, used FROM hr_leave_balances
            WHERE user_id = ${userId} AND leave_type_id = ${leaveTypeId} AND fiscal_year = ${fy}`,
        entitlementFor(userId, leaveTypeId),
        // ใบที่รออนุมัติ: จำนวนวันทั้งหมด และส่วนที่หักจาก balance ไปแล้ว (ใบเก่าอาจยังไม่ได้หัก)
        core_kon`
            SELECT COALESCE(SUM(total_days), 0) AS pending_all, COALESCE(SUM(days_deducted), 0) AS pending_deducted
            FROM hr_leave_requests
            WHERE user_id = ${userId} AND leave_type_id = ${leaveTypeId}
              AND status = 'PENDING'
              AND (CASE WHEN EXTRACT(MONTH FROM start_date) >= 10
                        THEN EXTRACT(YEAR FROM start_date) + 1
                        ELSE EXTRACT(YEAR FROM start_date) END) + 543 = ${fy}`,
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
        return { success: true, data: await leaveQuota(subject.uid, leaveTypeId, fy) };
    } catch (error: any) {
        return serverError(set, 'getLeaveQuota', error);
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
    const quota = await leaveQuota(uid, Number(leave_type_id), fy);
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
export const createLeaveRequest = async ({ body, user, set }: any) => {
    try {
        const subject = await resolveLeaveSubject(Number(user?.id), body?.user_id);
        if (!subject.ok) return fail(set, subject.status, subject.message);
        const uid = subject.uid;
        const { leave_type_id, start_date, end_date, total_days, is_half_day, half_day_period, reason, document_url } = body;

        const checked = await checkLeaveInput(uid, body, set, undefined, subject.actorIsHr);
        if ('error' in checked) return checked.error;
        const { quota } = checked;

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
                     approval_chain, current_step, days_deducted)
                VALUES (${uid}, ${leave_type_id}, ${start_date}, ${end_date}, ${total_days}, ${total_days},
                        ${!!is_half_day}, ${half_day_period ?? null}, 'PENDING', ${reason ?? null}, ${document_url ?? null},
                        ${JSON.stringify(chain.steps)}::text::jsonb, 1, ${total_days})
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

// ── ใบลาของฉัน ──────────────────────────────────────────────────────────────
export const getMyLeaveRequests = async ({ user, query, set }: any) => {
    try {
        const uid = Number(user?.id);
        const status = query?.status ? String(query.status).toUpperCase() : null;
        const rows = await core_kon`
            SELECT r.id, r.leave_type_id, t.name_th AS leave_type_name, t.code AS leave_type_code,
                   r.start_date, r.end_date, r.total_days, r.actual_days,
                   r.is_half_day, r.half_day_period, r.status, r.reason, r.reject_reason,
                   r.document_url, r.approval_chain, r.current_step, r.created_at, r.updated_at,
                   c.id AS cancellation_id, c.status AS cancellation_status, c.reason AS cancellation_reason
            FROM hr_leave_requests r
            JOIN hr_leave_types t ON t.id = r.leave_type_id
            LEFT JOIN hr_leave_cancellations c ON c.request_id = r.id
            WHERE r.user_id = ${uid}
              ${status ? core_kon`AND r.status = ${status}` : core_kon``}
            ORDER BY r.created_at DESC
        `;
        const actions = await loadActions(rows.map((r: any) => Number(r.id)));

        // ข้อมูลผู้ยื่นและยอดวันลาสะสม — ใช้กรอกแบบฟอร์มใบลาที่พิมพ์ออกมา
        const [profile] = await core_kon`
            SELECT u.id, u.pname, u.fname, u.lname,
                   po.position_name, ut.type_name AS user_type_name,
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
        const balanceOf = (typeId: number, fy: number) =>
            balances.find((b: any) => Number(b.leave_type_id) === typeId && Number(b.fiscal_year) === fy) ?? null;
        const entitlementOf = (typeId: number) =>
            perYear.find((e: any) => Number(e.leave_type_id) === typeId) ?? null;

        return {
            success: true,
            data: rows.map((r: any) => {
                const fy = fiscalYearOf(r.start_date);
                const bal = balanceOf(Number(r.leave_type_id), fy);
                const ent = entitlementOf(Number(r.leave_type_id));
                return {
                    ...r,
                    actions: actions.get(Number(r.id)) ?? [],
                    fiscal_year: fy,
                    carried_in: bal ? Number(bal.carried_in) : 0,
                    entitled_per_year: ent?.max_days_per_year != null ? Number(ent.max_days_per_year) : null,
                };
            }),
            profile: profile ?? null,
        };
    } catch (error: any) {
        return serverError(set, 'getMyLeaveRequests', error);
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
                SELECT id, user_id, status, leave_type_id, start_date, total_days, days_deducted
                FROM hr_leave_requests WHERE id = ${requestId} FOR UPDATE
            `;
            if (!req) return fail(set, 404, 'ไม่พบใบลานี้');
            if (Number(req.user_id) !== uid) return fail(set, 403, 'แก้ไขได้เฉพาะใบลาของตัวเอง');
            if (req.status !== 'PENDING') return fail(set, 409, `ใบลาสถานะ ${req.status} แก้ไขไม่ได้`, 'NOT_EDITABLE');
            const [acted] = await tx`SELECT count(*)::int AS n FROM hr_leave_approvals WHERE request_id = ${requestId}`;
            if (Number(acted.n) > 0) {
                return fail(set, 409, 'ใบลานี้มีผู้อนุมัติดำเนินการไปแล้ว แก้ไขไม่ได้ — ใช้การถอนใบลาแล้วยื่นใหม่', 'ALREADY_ACTIONED');
            }

            const checked = await checkLeaveInput(uid, body, set, {
                id: requestId,
                leave_type_id: Number(req.leave_type_id),
                start_date: req.start_date,
                total_days: Number(req.total_days),
            }, await isHrOrAdmin(uid));
            if ('error' in checked) return checked.error;

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
                    reason = ${reason ?? null},
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

        const rows = await core_kon`
            SELECT r.id, r.user_id, CONCAT(u.pname, u.fname, ' ', u.lname) AS employee_name,
                   up.position_name, sm.name AS submajor_name, ma.name AS major_name, mi.name AS mission_name,
                   r.leave_type_id, t.name_th AS leave_type_name, t.code AS leave_type_code,
                   r.start_date, r.end_date, r.total_days, r.actual_days,
                   r.is_half_day, r.half_day_period, r.status, r.reason, r.reject_reason,
                   r.document_url, r.approval_chain, r.current_step, r.created_at,
                   step.value AS my_step
            FROM hr_leave_requests r
            JOIN hr_leave_types t ON t.id = r.leave_type_id
            JOIN users u ON u.id = r.user_id
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
            LEFT JOIN majors ma ON ma.major_id = u.major_id
            LEFT JOIN missions mi ON mi.mission_id = u.mission_id
            CROSS JOIN LATERAL jsonb_array_elements(r.approval_chain) AS step(value)
            WHERE jsonb_typeof(r.approval_chain) = 'array'
              AND (step.value ->> 'approver_id')::int = ${uid}
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
        SELECT a.request_id, a.step, a.action, a.comment, a.actioned_at,
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

            if (Number(step.approver_id) !== uid) {
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
        return;
    }
    if (days <= 0) return;   // ไม่มีแถวอยู่แล้ว และเป็นการคืนยอด — ไม่ต้องสร้างแถวเปล่า
    // ใส่สิทธิ์ตามประเภทเจ้าหน้าที่ไว้ด้วย ไม่งั้นแถวที่ entitled = 0 ทำให้เพดานวันลาไม่ถูกบังคับ
    const entitled = (await entitlementFor(userId, leaveTypeId)) ?? 0;
    await tx`
        INSERT INTO hr_leave_balances (user_id, leave_type_id, fiscal_year, carried_in, entitled, used, note, auto_created)
        VALUES (${userId}, ${leaveTypeId}, ${fy}, 0, ${entitled}, ${days}, 'สร้างอัตโนมัติจากการบันทึกใบลา', TRUE)
    `;
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
        if (String(error?.message ?? '').includes('hr_leave_cancellations_request_id_key')) {
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
            if (Number(step.approver_id) !== uid) {
                return fail(set, 403, `ขั้นนี้รออนุมัติจาก${step.level_name} (${step.approver_name})`, 'NOT_YOUR_STEP');
            }

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

            await tx`
                UPDATE hr_leave_cancellations SET status = 'APPROVED', updated_at = now()
                WHERE id = ${req.cancellation_id}
            `;
            await tx`
                UPDATE hr_leave_requests SET status = 'CANCELLED', updated_at = now() WHERE id = ${requestId}
            `;
            // คืนยอดที่หักไว้ — ใบเก่าก่อนมี days_deducted ถูกหักตอนอนุมัติ ใช้ total_days แทน
            const deducted = Number(req.days_deducted) > 0 ? Number(req.days_deducted)
                : (req.status_before === 'APPROVED' ? Number(req.total_days) : 0);
            await setDeduction(tx, { ...req, days_deducted: deducted }, 0);
            return { success: true, data: { id: requestId, status: 'CANCELLED' }, message: 'ยกเลิกใบลาเรียบร้อย คืนยอดวันลาแล้ว' };
        });
    } catch (error: any) {
        return serverError(set, 'actOnCancellation', error);
    }
};

export const approveCancellation = (ctx: any) => actOnCancellation(ctx, 'APPROVED');
export const rejectCancellation = (ctx: any) => actOnCancellation(ctx, 'REJECTED');

// ── รายละเอียดใบลาใบเดียว ───────────────────────────────────────────────────
// เห็นได้เฉพาะเจ้าของใบ ผู้ที่อยู่ในสายอนุมัติของใบนั้น และ ADMIN
export const getLeaveRequestById = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [row] = await core_kon`
            SELECT r.*, t.name_th AS leave_type_name, t.code AS leave_type_code,
                   CONCAT(u.pname, u.fname, ' ', u.lname) AS employee_name,
                   c.id AS cancellation_id, c.status AS cancellation_status, c.reason AS cancellation_reason
            FROM hr_leave_requests r
            JOIN hr_leave_types t ON t.id = r.leave_type_id
            JOIN users u ON u.id = r.user_id
            LEFT JOIN hr_leave_cancellations c ON c.request_id = r.id
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
                   po.position_name, ut.type_name AS user_type_name,
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
                   po.position_name, COALESCE(sm.name, ma.name) AS unit_name,
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
                // เหตุผลการลาเป็นข้อมูลส่วนตัว — ส่งเฉพาะใบของตัวเอง (is_mine) ไม่ว่าจะดูขอบเขตไหน
                // เพื่อนร่วมกลุ่มงาน: ประเภทการลา (เช่น ลาป่วย) ก็ส่งเฉพาะของตัวเองเช่นกัน
                events: rows.map((r: any) => {
                    const mine = Number(r.user_id) === uid;
                    // รออนุมัติ → ผู้อนุมัติลำดับที่ใบกำลังรออยู่ (ลำดับ 1 กดแล้วจะเลื่อนเป็นลำดับ 2 ...)
                    const { approval_chain, current_step, ...rest } = r;
                    const steps = parseChain(approval_chain);
                    const cur = r.status === 'PENDING' ? stepFor(steps, Number(current_step)) : null;
                    return {
                        ...rest,
                        waiting_for: cur
                            ? { step: cur.step, total: steps.length, level_name: cur.level_name, approver_name: cur.approver_name, is_acting: cur.is_acting }
                            : null,
                        is_mine: mine,
                        reason: mine ? r.reason : null,
                        ...(masked && !mine ? { leave_type_code: null, leave_type_name: null } : {}),
                    };
                }),
            },
        };
    } catch (error: any) {
        return serverError(set, 'getLeaveCalendar', error);
    }
};
