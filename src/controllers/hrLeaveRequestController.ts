import { core_kon } from '../db/db';
import { resolveApprovalChain, stepFor, parseChain, type ChainStep } from '../services/leaveChain';

// ── ใบลา: ยื่น → อนุมัติตามสายบังคับบัญชา → ตัดยอดวันลา → ยกเลิก ────────────────
//
// หลักที่ยึดตลอดไฟล์นี้
// 1) สิทธิ์กดอนุมัติดูจาก approval_chain ที่แช่แข็งไว้ในใบ ไม่ได้ดูจากตำแหน่งปัจจุบัน
//    หัวหน้าที่ถือหมวกหลายใบจึงเห็นเฉพาะใบที่ "รอขั้นของเขา" จริง ๆ ไม่ปนกับหน่วยอื่น
// 2) ทุกการกดบันทึกลง hr_leave_approvals พร้อมระดับและหน่วยที่ใช้อำนาจ
// 3) ตัดยอดวันลาตอนอนุมัติขั้นสุดท้ายเท่านั้น และคืนยอดเมื่อยกเลิกสำเร็จ

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
// วันที่ "ใช้ไปแล้ว" นับรวมใบที่ยังรออนุมัติด้วย ไม่งั้นยื่นค้างไว้หลายใบพร้อมกัน
// จะทะลุสิทธิ์ได้ทั้งที่แต่ละใบผ่านการตรวจตอนยื่น
export interface LeaveQuota {
    fiscal_year: number;
    has_entitlement: boolean;   // false = ยังไม่ได้กำหนดสิทธิ์ไว้ ไม่บังคับเพดาน
    entitled: number;           // สิทธิ์ของปีนี้ (รวมยอดยกมา)
    used: number;               // อนุมัติแล้ว
    pending: number;            // ยื่นค้างอยู่ ยังไม่ถึงที่สุด
    remaining: number;
}

const leaveQuota = async (userId: number, leaveTypeId: number, fy: number): Promise<LeaveQuota> => {
    const [balance, entRows, pendingRows] = await Promise.all([
        core_kon`
            SELECT carried_in, entitled, used FROM hr_leave_balances
            WHERE user_id = ${userId} AND leave_type_id = ${leaveTypeId} AND fiscal_year = ${fy}`,
        // เลือก tier ตามอายุงาน — แต่ทะเบียนบุคลากรส่วนใหญ่ยังไม่ได้กรอก hire_date
        // (1,154 จาก 1,277 คน) ถ้าไม่มีวันเริ่มงานให้ใช้ tier ต่ำสุดเป็นฐานแทน
        // ดีกว่าถือว่า "ไม่มีสิทธิ์" ซึ่งจะทำให้เพดานวันลาไม่ถูกบังคับกับเกือบทั้งองค์กร
        core_kon`
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
            LIMIT 1`,
        core_kon`
            SELECT COALESCE(SUM(total_days), 0) AS d FROM hr_leave_requests
            WHERE user_id = ${userId} AND leave_type_id = ${leaveTypeId}
              AND status IN ('PENDING', 'CANCEL_PENDING')
              AND (CASE WHEN EXTRACT(MONTH FROM start_date) >= 10
                        THEN EXTRACT(YEAR FROM start_date) + 1
                        ELSE EXTRACT(YEAR FROM start_date) END) + 543 = ${fy}`,
    ]);

    const pending = Number(pendingRows[0]?.d ?? 0);

    if (balance.length > 0) {
        const b = balance[0];
        const entitled = Number(b.carried_in ?? 0) + Number(b.entitled ?? 0);
        const used = Number(b.used ?? 0);
        return {
            fiscal_year: fy,
            has_entitlement: entitled > 0,
            entitled, used, pending,
            remaining: entitled - used - pending,
        };
    }

    if (entRows.length === 0 || entRows[0].max_days_per_year == null) {
        return { fiscal_year: fy, has_entitlement: false, entitled: 0, used: 0, pending, remaining: 0 };
    }

    const entitled = Number(entRows[0].max_days_per_year);
    return {
        fiscal_year: fy,
        has_entitlement: true,
        entitled, used: 0, pending,
        remaining: entitled - pending,
    };
};

/** สิทธิ์คงเหลือของประเภทการลาหนึ่ง — ฟอร์มเรียกก่อนยื่นเพื่อแสดงให้เห็น */
export const getLeaveQuota = async ({ query, user, set }: any) => {
    try {
        const leaveTypeId = Number(query?.leave_type_id);
        if (!Number.isInteger(leaveTypeId)) return fail(set, 400, 'กรุณาระบุประเภทการลา');
        const fy = query?.start_date ? fiscalYearOf(query.start_date) : fiscalYearOf(new Date());
        return { success: true, data: await leaveQuota(Number(user?.id), leaveTypeId, fy) };
    } catch (error: any) {
        return serverError(set, 'getLeaveQuota', error);
    }
};

// ── ยื่นใบลา ────────────────────────────────────────────────────────────────
export const createLeaveRequest = async ({ body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const { leave_type_id, start_date, end_date, total_days, is_half_day, half_day_period, reason, document_url } = body;

        if (end_date < start_date) return fail(set, 400, 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มลา');
        if (Number(total_days) <= 0) return fail(set, 400, 'จำนวนวันลาต้องมากกว่า 0');
        if (is_half_day && !half_day_period) return fail(set, 400, 'ลาครึ่งวันต้องระบุช่วงเช้า/บ่าย');
        if (!is_half_day && half_day_period) return fail(set, 400, 'ระบุช่วงเช้า/บ่ายได้เฉพาะเมื่อลาครึ่งวัน');

        const [leaveType] = await core_kon`
            SELECT id, name_th FROM hr_leave_types WHERE id = ${leave_type_id} AND is_active = true
        `;
        if (!leaveType) return fail(set, 400, 'ไม่พบประเภทการลาที่เลือก');

        // ซ้อนทับกับใบที่ยังมีผลอยู่ไม่ได้ — กันลาซ้ำช่วงเดียวกันโดยไม่ตั้งใจ
        const overlap = await core_kon`
            SELECT id, start_date, end_date FROM hr_leave_requests
            WHERE user_id = ${uid}
              AND status IN ('PENDING', 'APPROVED', 'CANCEL_PENDING')
              AND start_date <= ${end_date} AND end_date >= ${start_date}
            LIMIT 1
        `;
        if (overlap.length > 0) {
            return fail(set, 409, `มีใบลาที่ยังมีผลอยู่ทับช่วงวันที่นี้แล้ว (ใบเลขที่ ${overlap[0].id})`, 'OVERLAP');
        }

        // ตรวจสิทธิ์วันลา — นับรวมใบที่ยังค้างอยู่ด้วย กันยื่นหลายใบพร้อมกันจนทะลุสิทธิ์
        const quota = await leaveQuota(uid, Number(leave_type_id), fiscalYearOf(start_date));
        if (quota.has_entitlement && Number(total_days) > quota.remaining) {
            set.status = 409;
            return {
                success: false,
                code: 'QUOTA_EXCEEDED',
                message: `${leaveType.name_th}ปีงบ ${quota.fiscal_year} คงเหลือ ${quota.remaining} วัน`
                    + (quota.pending > 0 ? ` (มีใบค้างอยู่ ${quota.pending} วัน)` : '')
                    + ` แต่ใบนี้ขอลา ${total_days} วัน`,
                data: quota,
            };
        }

        const chain = await resolveApprovalChain(uid);
        if (!chain || chain.steps.length === 0) {
            return fail(set, 422,
                'ไม่พบผู้อนุมัติในสายบังคับบัญชาของคุณ กรุณาติดต่อฝ่ายบุคคลเพื่อตั้งค่าหัวหน้าหน่วยงาน',
                'NO_APPROVER');
        }

        const [row] = await core_kon`
            INSERT INTO hr_leave_requests
                (user_id, leave_type_id, start_date, end_date, total_days, actual_days,
                 is_half_day, half_day_period, status, reason, document_url,
                 approval_chain, current_step)
            VALUES (${uid}, ${leave_type_id}, ${start_date}, ${end_date}, ${total_days}, ${total_days},
                    ${!!is_half_day}, ${half_day_period ?? null}, 'PENDING', ${reason ?? null}, ${document_url ?? null},
                    ${JSON.stringify(chain.steps)}::text::jsonb, 1)
            RETURNING id, status, current_step, created_at
        `;

        return {
            success: true,
            data: { ...row, approval_chain: chain.steps, skipped: chain.skipped, quota },
            message: `ส่งใบลาเรียบร้อย รออนุมัติจาก${chain.steps[0].level_name} (${chain.steps[0].approver_name})`,
        };
    } catch (error: any) {
        return serverError(set, 'createLeaveRequest', error);
    }
};

/** ดูสายอนุมัติล่วงหน้าก่อนยื่น — ฟอร์มใช้แสดงให้ผู้ยื่นเห็นว่าใบจะวิ่งไปหาใครบ้าง */
export const previewApprovalChain = async ({ user, set }: any) => {
    try {
        const chain = await resolveApprovalChain(Number(user?.id));
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
// ยอดวันลาไม่ต้องคืน เพราะใบที่ยังไม่อนุมัติไม่เคยถูกหักออกจาก hr_leave_balances
// (สิทธิ์คงเหลือนับใบค้างจากตารางใบลาโดยตรง ลบแล้วยอดกลับมาเอง)
export const deleteLeaveRequest = async ({ params, user, set }: any) => {
    const uid = Number(user?.id);
    const requestId = Number(params?.id);
    try {
        return await core_kon.begin(async (tx: any) => {
            const [req] = await tx`
                SELECT id, user_id, status FROM hr_leave_requests WHERE id = ${requestId} FOR UPDATE
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

            await tx`DELETE FROM hr_leave_cancellations WHERE request_id = ${requestId}`;
            await tx`DELETE FROM hr_leave_requests WHERE id = ${requestId}`;
            return { success: true, data: { id: requestId }, message: 'ลบใบลาเรียบร้อย' };
        });
    } catch (error: any) {
        return serverError(set, 'deleteLeaveRequest', error);
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
        return { success: true, data: rows.map((r: any) => ({ ...r, actions: actions.get(Number(r.id)) ?? [] })) };
    } catch (error: any) {
        return serverError(set, 'getPendingApprovals', error);
    }
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
                SELECT id, user_id, leave_type_id, start_date, total_days, status, approval_chain, current_step
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
            // ตัดยอดวันลาเมื่อผ่านครบทุกขั้นเท่านั้น
            await adjustBalance(tx, Number(req.user_id), Number(req.leave_type_id), req.start_date, Number(req.total_days));

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
    await tx`
        INSERT INTO hr_leave_balances (user_id, leave_type_id, fiscal_year, carried_in, entitled, used, note)
        VALUES (${userId}, ${leaveTypeId}, ${fy}, 0, 0, ${days}, 'สร้างอัตโนมัติจากการอนุมัติใบลา')
    `;
};

// ── ขอยกเลิกใบลาที่อนุมัติแล้ว ──────────────────────────────────────────────
export const requestCancellation = async ({ params, body, user, set }: any) => {
    const uid = Number(user?.id);
    const requestId = Number(params?.id);
    try {
        return await core_kon.begin(async (tx: any) => {
            const [req] = await tx`
                SELECT id, user_id, status, approval_chain FROM hr_leave_requests
                WHERE id = ${requestId} FOR UPDATE
            `;
            if (!req) return fail(set, 404, 'ไม่พบใบลานี้');
            if (Number(req.user_id) !== uid) return fail(set, 403, 'ยกเลิกได้เฉพาะใบลาของตัวเอง');

            // ยังไม่มีใครอนุมัติ = ถอนใบได้เลย ไม่ต้องเข้าสายอนุมัติ
            if (req.status === 'PENDING') {
                await tx`
                    UPDATE hr_leave_requests SET status = 'CANCELLED', updated_at = now() WHERE id = ${requestId}
                `;
                return { success: true, data: { id: requestId, status: 'CANCELLED' }, message: 'ถอนใบลาเรียบร้อย' };
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
                SELECT r.id, r.user_id, r.leave_type_id, r.start_date, r.total_days, r.status,
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
            // ใบที่เคยอนุมัติจนตัดยอดไปแล้ว ต้องคืนยอดกลับ
            if (req.status_before === 'APPROVED') {
                await adjustBalance(tx, Number(req.user_id), Number(req.leave_type_id), req.start_date, -Number(req.total_days));
            }
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
