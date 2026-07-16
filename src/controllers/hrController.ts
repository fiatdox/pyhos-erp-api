import { core_kon } from '../db/db';

// ── ตอบ 500 แบบไม่เผยรายละเอียดภายใน (SQL error ฯลฯ log ไว้ฝั่ง server เท่านั้น) ──
const serverError = (set: any, where: string, error: any) => {
    console.error(`[hrController] ${where}:`, error);
    set.status = 500;
    return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
};

// ── แต่งตั้ง/ถอดถอนหัวหน้า-รักษาการแบบ atomic (UPDATE เดียว กัน race condition) ──
// กันซ้ำ "ภายในหน่วยเดียวกัน": หัวหน้า (supervisor_id) และรักษาการ (acting_supervisor_id) ห้ามเป็นคนเดียวกัน
// คนละหน่วย = แต่งตั้งบุคคลเดิมซ้ำได้ · หน่วยที่ is_active <> 'Y' ไม่บังคับเงื่อนไข (คงพฤติกรรมเดิม)
// คืนค่า: { status: 'ok', row } | { status: 'not_found' } | { status: 'conflict' }
const setSupervisorColumn = async (
    table: string,
    idColumn: string,
    rowId: number,
    empId: number | null,
    column: 'supervisor_id' | 'acting_supervisor_id',
) => {
    const otherColumn = column === 'supervisor_id' ? 'acting_supervisor_id' : 'supervisor_id';
    // ถอดถอน (null) ไม่มีทางชนซ้ำ — เงื่อนไขกันซ้ำใส่เฉพาะตอนแต่งตั้ง
    const updated = empId == null
        ? await core_kon`
            UPDATE ${core_kon(table)}
            SET ${core_kon(column)} = NULL
            WHERE ${core_kon(idColumn)} = ${rowId}
            RETURNING ${core_kon(idColumn)}, name, supervisor_id, acting_supervisor_id
        `
        : await core_kon`
            UPDATE ${core_kon(table)}
            SET ${core_kon(column)} = ${empId}
            WHERE ${core_kon(idColumn)} = ${rowId}
              AND (is_active <> 'Y' OR ${core_kon(otherColumn)} IS DISTINCT FROM ${empId})
            RETURNING ${core_kon(idColumn)}, name, supervisor_id, acting_supervisor_id
        `;
    if (updated.length > 0) return { status: 'ok' as const, row: updated[0] };
    // 0 แถว = ไม่พบหน่วย หรือเงื่อนไขกันซ้ำไม่ผ่าน — เช็คแยกเพื่อเลือกข้อความ error ให้ถูก
    const exists = await core_kon`
        SELECT 1 FROM ${core_kon(table)} WHERE ${core_kon(idColumn)} = ${rowId}
    `;
    return exists.length === 0 ? { status: 'not_found' as const } : { status: 'conflict' as const };
};

// ดึงรายการประเภทการลาทั้งหมด (ชื่อ, เงื่อนไขเพศ, จำนวนวันที่ต้องมีเอกสาร)
export const getLeaveTypes = async ({ set }: any) => {
    try {
        const leaveTypes = await core_kon`
            SELECT id, code, name_th, gender_restriction, requires_document_after_days
            FROM hr_leave_types
            ORDER BY id ASC
        `;
        return { success: true, data: leaveTypes };
    } catch (error: any) {
        return serverError(set, 'getLeaveTypes', error);
    }
};

// ดึงสิทธิ์การลาทั้งหมด (จำนวนวันสูงสุด, อายุงานขั้นต่ำ, การสะสมวันลา)
export const getLeaveEntitlements = async ({ set }: any) => {
    try {
        const entitlements = await core_kon`
            SELECT id, leave_type_id, user_type_id, max_days_per_year, min_service_months, carry_over, carry_over_max_days
            FROM hr_leave_entitlements
            ORDER BY id ASC
        `;
        return { success: true, data: entitlements };
    } catch (error: any) {
        return serverError(set, 'getLeaveEntitlements', error);
    }
};

// ดึงหัวหน้าภารกิจของพนักงานตาม user id
export const getMissionSupervisorByUserId = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT u1.id, m.name AS mission_name, CONCAT(u1.pname, ' ', u1.fname, ' ', u1.lname) AS mission_supervisor
            FROM users u
            LEFT JOIN missions m ON m.mission_id = u.mission_id
            LEFT JOIN users u1 ON u1.id = m.supervisor_id
            WHERE u.id = ${params.id}

            UNION

            SELECT u1.id, m.name AS mission_name, CONCAT(u1.pname, ' ', u1.fname, ' ', u1.lname) AS mission_supervisor
            FROM users u
            LEFT JOIN missions m ON m.mission_id = u.mission_id
            LEFT JOIN users u1 ON u1.id = m.acting_supervisor_id
            WHERE u.id = ${params.id}
              AND m.acting_supervisor_id IS NOT NULL
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }
        return { success: true, data: result };
    } catch (error: any) {
        return serverError(set, 'getMissionSupervisorByUserId', error);
    }
};

// ดึงหัวหน้ากลุ่มงานของพนักงานตาม user id
export const getMajorSupervisorByUserId = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT u1.id, m.name AS major_name, CONCAT(u1.pname, ' ', u1.fname, ' ', u1.lname) AS major_supervisor
            FROM users u
            LEFT JOIN majors m ON m.major_id = u.major_id
            LEFT JOIN users u1 ON u1.id = m.supervisor_id
            WHERE u.id = ${params.id}

            UNION

            SELECT u1.id, m.name AS major_name, CONCAT(u1.pname, ' ', u1.fname, ' ', u1.lname) AS major_supervisor
            FROM users u
            LEFT JOIN majors m ON m.major_id = u.major_id
            LEFT JOIN users u1 ON u1.id = m.acting_supervisor_id
            WHERE u.id = ${params.id}
              AND m.acting_supervisor_id IS NOT NULL
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }
        return { success: true, data: result };
    } catch (error: any) {
        return serverError(set, 'getMajorSupervisorByUserId', error);
    }
};

// ดึงหัวหน้าหน่วยงานของพนักงานตาม user id
export const getSubMajorSupervisorByUserId = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT u1.id, m.name AS major_name, CONCAT(u1.pname, ' ', u1.fname, ' ', u1.lname) AS major_supervisor
            FROM users u
            LEFT JOIN submajors m ON m.submajor_id = u.submajor_id
            LEFT JOIN users u1 ON u1.id = m.supervisor_id
            WHERE u.id = ${params.id}

            UNION

            SELECT u1.id, m.name AS major_name, CONCAT(u1.pname, ' ', u1.fname, ' ', u1.lname) AS major_supervisor
            FROM users u
            LEFT JOIN submajors m ON m.submajor_id = u.submajor_id
            LEFT JOIN users u1 ON u1.id = m.acting_supervisor_id
            WHERE u.id = ${params.id}
              AND m.acting_supervisor_id IS NOT NULL
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }
        return { success: true, data: result };
    } catch (error: any) {
        return serverError(set, 'getSubMajorSupervisorByUserId', error);
    }
};

// แต่งตั้งหัวหน้าภารกิจ (supervisor_id) ตาม mission_id — กันแต่งตั้งซ้ำด้วย id เดียวกัน
export const updateMissionSupervisor = async ({ params, body, set }: any) => {
    try {
        const r = await setSupervisorColumn('missions', 'mission_id', params.id, body.supervisor_id ?? null, 'supervisor_id');
        if (r.status === 'not_found') { set.status = 404; return { success: false, message: 'Mission not found' }; }
        if (r.status === 'conflict') { set.status = 409; return { success: false, message: 'ไม่สามารถแต่งตั้งเป็นหัวหน้าภารกิจได้ เพราะบุคลากรนี้เป็นรักษาการของภารกิจนี้อยู่แล้ว' }; }
        return { success: true, data: r.row };
    } catch (error: any) { return serverError(set, 'updateMissionSupervisor', error); }
};

// แต่งตั้งรักษาการภารกิจ (acting_supervisor_id) ตาม mission_id — กันแต่งตั้งซ้ำด้วย id เดียวกัน
export const updateMissionActingSupervisor = async ({ params, body, set }: any) => {
    try {
        const r = await setSupervisorColumn('missions', 'mission_id', params.id, body.acting_supervisor_id ?? null, 'acting_supervisor_id');
        if (r.status === 'not_found') { set.status = 404; return { success: false, message: 'Mission not found' }; }
        if (r.status === 'conflict') { set.status = 409; return { success: false, message: 'ไม่สามารถแต่งตั้งเป็นรักษาการได้ เพราะบุคลากรนี้เป็นหัวหน้าภารกิจของภารกิจนี้อยู่แล้ว' }; }
        return { success: true, data: r.row };
    } catch (error: any) { return serverError(set, 'updateMissionActingSupervisor', error); }
};

// แต่งตั้งหัวหน้ากลุ่มงาน (supervisor_id) ตาม major_id — กันซ้ำกับรักษาการของกลุ่มงานเดียวกัน
export const updateMajorSupervisor = async ({ params, body, set }: any) => {
    try {
        const r = await setSupervisorColumn('majors', 'major_id', params.id, body.supervisor_id ?? null, 'supervisor_id');
        if (r.status === 'not_found') { set.status = 404; return { success: false, message: 'Major not found' }; }
        if (r.status === 'conflict') { set.status = 409; return { success: false, message: 'ไม่สามารถแต่งตั้งเป็นหัวหน้ากลุ่มงานได้ เพราะบุคลากรนี้เป็นรักษาการของกลุ่มงานนี้อยู่แล้ว' }; }
        return { success: true, data: r.row };
    } catch (error: any) { return serverError(set, 'updateMajorSupervisor', error); }
};

// แต่งตั้งรักษาการกลุ่มงาน (acting_supervisor_id) ตาม major_id — กันซ้ำกับหัวหน้าของกลุ่มงานเดียวกัน
export const updateMajorActingSupervisor = async ({ params, body, set }: any) => {
    try {
        const r = await setSupervisorColumn('majors', 'major_id', params.id, body.acting_supervisor_id ?? null, 'acting_supervisor_id');
        if (r.status === 'not_found') { set.status = 404; return { success: false, message: 'Major not found' }; }
        if (r.status === 'conflict') { set.status = 409; return { success: false, message: 'ไม่สามารถแต่งตั้งเป็นรักษาการได้ เพราะบุคลากรนี้เป็นหัวหน้ากลุ่มงานของกลุ่มงานนี้อยู่แล้ว' }; }
        return { success: true, data: r.row };
    } catch (error: any) { return serverError(set, 'updateMajorActingSupervisor', error); }
};

// แต่งตั้งหัวหน้าหน่วยงาน (supervisor_id) ตาม submajor_id — กันซ้ำกับรักษาการของหน่วยงานเดียวกัน
export const updateSubMajorSupervisor = async ({ params, body, set }: any) => {
    try {
        const r = await setSupervisorColumn('submajors', 'submajor_id', params.id, body.supervisor_id ?? null, 'supervisor_id');
        if (r.status === 'not_found') { set.status = 404; return { success: false, message: 'SubMajor not found' }; }
        if (r.status === 'conflict') { set.status = 409; return { success: false, message: 'ไม่สามารถแต่งตั้งเป็นหัวหน้าหน่วยงานได้ เพราะบุคลากรนี้เป็นรักษาการของหน่วยงานนี้อยู่แล้ว' }; }
        return { success: true, data: r.row };
    } catch (error: any) { return serverError(set, 'updateSubMajorSupervisor', error); }
};

// แต่งตั้งรักษาการหน่วยงาน (acting_supervisor_id) ตาม submajor_id — กันซ้ำกับหัวหน้าของหน่วยงานเดียวกัน
export const updateSubMajorActingSupervisor = async ({ params, body, set }: any) => {
    try {
        const r = await setSupervisorColumn('submajors', 'submajor_id', params.id, body.acting_supervisor_id ?? null, 'acting_supervisor_id');
        if (r.status === 'not_found') { set.status = 404; return { success: false, message: 'SubMajor not found' }; }
        if (r.status === 'conflict') { set.status = 409; return { success: false, message: 'ไม่สามารถแต่งตั้งเป็นรักษาการได้ เพราะบุคลากรนี้เป็นหัวหน้าหน่วยงานของหน่วยงานนี้อยู่แล้ว' }; }
        return { success: true, data: r.row };
    } catch (error: any) { return serverError(set, 'updateSubMajorActingSupervisor', error); }
};

// ดึงสิทธิ์การลาตาม user_type_id ที่ระบุ
export const getLeaveEntitlementByUserTypeId = async ({ params, set }: any) => {
    try {
        const entitlements = await core_kon`
            SELECT id, leave_type_id, user_type_id, max_days_per_year, min_service_months, carry_over, carry_over_max_days
            FROM hr_leave_entitlements
            WHERE user_type_id = ${params.user_type_id}
            ORDER BY id ASC
        `;
        if (entitlements.length === 0) {
            set.status = 404;
            return { success: false, message: 'No entitlements found for this user type' };
        }
        return { success: true, data: entitlements };
    } catch (error: any) {
        return serverError(set, 'getLeaveEntitlementByUserTypeId', error);
    }
};
