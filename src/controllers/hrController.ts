import { core_kon } from '../db/db';

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
        set.status = 500;
        return { success: false, message: error.message };
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
        set.status = 500;
        return { success: false, message: error.message };
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
        set.status = 500;
        return { success: false, message: error.message };
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
        set.status = 500;
        return { success: false, message: error.message };
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
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// อัปเดตหัวหน้าภารกิจ ตาม mission_id
export const updateMissionSupervisor = async ({ params, body, set }: any) => {
    try {
        const result = await core_kon`
            UPDATE missions
            SET supervisor_id = ${body.supervisor_id ?? null}
            WHERE mission_id = ${params.id}
            RETURNING mission_id, name, supervisor_id, acting_supervisor_id
        `;
        if (result.length === 0) { set.status = 404; return { success: false, message: 'Mission not found' }; }
        return { success: true, data: result[0] };
    } catch (error: any) { set.status = 500; return { success: false, message: error.message }; }
};

// อัปเดตรักษาการภารกิจ ตาม mission_id
export const updateMissionActingSupervisor = async ({ params, body, set }: any) => {
    try {
        const result = await core_kon`
            UPDATE missions
            SET acting_supervisor_id = ${body.acting_supervisor_id ?? null}
            WHERE mission_id = ${params.id}
            RETURNING mission_id, name, supervisor_id, acting_supervisor_id
        `;
        if (result.length === 0) { set.status = 404; return { success: false, message: 'Mission not found' }; }
        return { success: true, data: result[0] };
    } catch (error: any) { set.status = 500; return { success: false, message: error.message }; }
};

// อัปเดตหัวหน้ากลุ่มงาน ตาม major_id
export const updateMajorSupervisor = async ({ params, body, set }: any) => {
    try {
        const result = await core_kon`
            UPDATE majors
            SET supervisor_id = ${body.supervisor_id ?? null}
            WHERE major_id = ${params.id}
            RETURNING major_id, name, supervisor_id, acting_supervisor_id
        `;
        if (result.length === 0) { set.status = 404; return { success: false, message: 'Major not found' }; }
        return { success: true, data: result[0] };
    } catch (error: any) { set.status = 500; return { success: false, message: error.message }; }
};

// อัปเดตรักษาการกลุ่มงาน ตาม major_id
export const updateMajorActingSupervisor = async ({ params, body, set }: any) => {
    try {
        const result = await core_kon`
            UPDATE majors
            SET acting_supervisor_id = ${body.acting_supervisor_id ?? null}
            WHERE major_id = ${params.id}
            RETURNING major_id, name, supervisor_id, acting_supervisor_id
        `;
        if (result.length === 0) { set.status = 404; return { success: false, message: 'Major not found' }; }
        return { success: true, data: result[0] };
    } catch (error: any) { set.status = 500; return { success: false, message: error.message }; }
};

// อัปเดตหัวหน้าหน่วยงาน ตาม submajor_id
export const updateSubMajorSupervisor = async ({ params, body, set }: any) => {
    try {
        const result = await core_kon`
            UPDATE submajors
            SET supervisor_id = ${body.supervisor_id ?? null}
            WHERE submajor_id = ${params.id}
            RETURNING submajor_id, name, supervisor_id, acting_supervisor_id
        `;
        if (result.length === 0) { set.status = 404; return { success: false, message: 'SubMajor not found' }; }
        return { success: true, data: result[0] };
    } catch (error: any) { set.status = 500; return { success: false, message: error.message }; }
};

// อัปเดตรักษาการหน่วยงาน ตาม submajor_id
export const updateSubMajorActingSupervisor = async ({ params, body, set }: any) => {
    try {
        const result = await core_kon`
            UPDATE submajors
            SET acting_supervisor_id = ${body.acting_supervisor_id ?? null}
            WHERE submajor_id = ${params.id}
            RETURNING submajor_id, name, supervisor_id, acting_supervisor_id
        `;
        if (result.length === 0) { set.status = 404; return { success: false, message: 'SubMajor not found' }; }
        return { success: true, data: result[0] };
    } catch (error: any) { set.status = 500; return { success: false, message: error.message }; }
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
        set.status = 500;
        return { success: false, message: error.message };
    }
};
