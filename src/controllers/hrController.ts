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

// ดึงหัวหน้าภารกิจของพนักงานตาม user id — จับกับ missions.supervisor_id / acting_supervisor_id
// role = 'supervisor' (ตัวจริง) | 'acting' (รักษาการ); ตัวจริงมาก่อน; ไม่คืนแถวว่างเมื่อยังไม่แต่งตั้ง
export const getMissionSupervisorByUserId = async ({ params, set }: any) => {
    try {
        const me = await core_kon`SELECT mission_id FROM users WHERE id = ${params.id}`;
        if (me.length === 0) { set.status = 404; return { success: false, message: 'User not found' }; }
        if (me[0].mission_id == null) return { success: true, data: [] };
        const result = await core_kon`
            SELECT u1.id, m.name AS mission_name, CONCAT(u1.pname, ' ', u1.fname, ' ', u1.lname) AS mission_supervisor, r.role
            FROM missions m
            CROSS JOIN LATERAL (VALUES ('supervisor', m.supervisor_id), ('acting', m.acting_supervisor_id)) AS r(role, sup_id)
            JOIN users u1 ON u1.id = r.sup_id
            WHERE m.mission_id = ${me[0].mission_id}
            ORDER BY r.role DESC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        return serverError(set, 'getMissionSupervisorByUserId', error);
    }
};

// ดึงหัวหน้ากลุ่มงานของพนักงานตาม user id — จับกับ majors.supervisor_id / acting_supervisor_id
export const getMajorSupervisorByUserId = async ({ params, set }: any) => {
    try {
        const me = await core_kon`SELECT major_id FROM users WHERE id = ${params.id}`;
        if (me.length === 0) { set.status = 404; return { success: false, message: 'User not found' }; }
        if (me[0].major_id == null) return { success: true, data: [] };
        const result = await core_kon`
            SELECT u1.id, m.name AS major_name, CONCAT(u1.pname, ' ', u1.fname, ' ', u1.lname) AS major_supervisor, r.role
            FROM majors m
            CROSS JOIN LATERAL (VALUES ('supervisor', m.supervisor_id), ('acting', m.acting_supervisor_id)) AS r(role, sup_id)
            JOIN users u1 ON u1.id = r.sup_id
            WHERE m.major_id = ${me[0].major_id}
            ORDER BY r.role DESC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        return serverError(set, 'getMajorSupervisorByUserId', error);
    }
};

// ดึงหัวหน้าหน่วยงานของพนักงานตาม user id — จับกับ submajors.supervisor_id / acting_supervisor_id
export const getSubMajorSupervisorByUserId = async ({ params, set }: any) => {
    try {
        const me = await core_kon`SELECT submajor_id FROM users WHERE id = ${params.id}`;
        if (me.length === 0) { set.status = 404; return { success: false, message: 'User not found' }; }
        if (me[0].submajor_id == null) return { success: true, data: [] };
        const result = await core_kon`
            SELECT u1.id, m.name AS major_name, CONCAT(u1.pname, ' ', u1.fname, ' ', u1.lname) AS major_supervisor, r.role
            FROM submajors m
            CROSS JOIN LATERAL (VALUES ('supervisor', m.supervisor_id), ('acting', m.acting_supervisor_id)) AS r(role, sup_id)
            JOIN users u1 ON u1.id = r.sup_id
            WHERE m.submajor_id = ${me[0].submajor_id}
            ORDER BY r.role DESC
        `;
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

// ── ผู้อำนวยการ / รักษาการผู้อำนวยการ — เก็บใน hr_settings (key-value) ─────────

// ตั้ง/ถอดถอนค่าใน hr_settings แบบ atomic — กันบุคคลเดียวกันเป็นทั้ง ผอ. และรักษาการ
// upsert ครอบกรณี key ยังไม่ถูก seed; conflict check อยู่ใน WHERE ของ DO UPDATE (single statement กัน race)
const setDirectorKey = async (key: string, otherKey: string, empId: number | null, updatedBy: number | null) => {
    if (empId == null) {
        const cleared = await core_kon`
            INSERT INTO hr_settings (name, value, updated_by) VALUES (${key}, NULL, ${updatedBy})
            ON CONFLICT (name) DO UPDATE SET value = NULL, updated_at = now(), updated_by = ${updatedBy}
            RETURNING name, value`;
        return { status: 'ok' as const, row: cleared[0] };
    }
    const updated = await core_kon`
        INSERT INTO hr_settings (name, value, updated_by) VALUES (${key}, ${String(empId)}, ${updatedBy})
        ON CONFLICT (name) DO UPDATE SET value = ${String(empId)}, updated_at = now(), updated_by = ${updatedBy}
        WHERE NOT EXISTS (SELECT 1 FROM hr_settings o WHERE o.name = ${otherKey} AND o.value = ${String(empId)})
        RETURNING name, value`;
    return updated.length > 0 ? { status: 'ok' as const, row: updated[0] } : { status: 'conflict' as const };
};

// ดึงค่า ผอ. / รักษาการ ผอ. ปัจจุบันจาก hr_settings (พร้อมชื่อจากตาราง users)
export const getDirector = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT s.name, s.value, CONCAT(u.pname, ' ', u.fname, ' ', u.lname) AS full_name
            FROM hr_settings s
            LEFT JOIN users u ON u.id = NULLIF(s.value, '')::int
            WHERE s.name IN ('director_id', 'acting_director_id')`;
        const map: Record<string, number | string | null> = {
            director_id: null, acting_director_id: null,
            director_name: null, acting_director_name: null,
        };
        rows.forEach((r: any) => {
            map[r.name] = r.value != null ? Number(r.value) : null;
            const nameKey = r.name === 'director_id' ? 'director_name' : 'acting_director_name';
            map[nameKey] = r.value != null ? (r.full_name?.trim() || null) : null;
        });
        return { success: true, data: map };
    } catch (error: any) { return serverError(set, 'getDirector', error); }
};

// เช็คว่า user คนนี้เป็นหัวหน้าหรือรักษาการของกลุ่มภารกิจใดหรือไม่ — ถ้าใช่ การลาต้องเสนอ ผอ. โดยตรง
export const getMissionHeadCheck = async ({ params, set }: any) => {
    try {
        const rows = await core_kon`
            SELECT 1 FROM missions
            WHERE supervisor_id = ${params.id} OR acting_supervisor_id = ${params.id}
            LIMIT 1`;
        return { success: true, data: { is_mission_head: rows.length > 0 } };
    } catch (error: any) { return serverError(set, 'getMissionHeadCheck', error); }
};

// ── สิทธิ์เข้าถึงหน้าอนุมัติการลา ────────────────────────────────────────────
// อนุมัติการลาได้เฉพาะผู้ที่ "เป็นหัวหน้า/รักษาการ" ของหน่วยใดหน่วยหนึ่งจริงเท่านั้น
// (กลุ่มภารกิจ / กลุ่มงาน / หน่วยงาน) หรือเป็น ผอ./รักษาการ ผอ. — ADMIN เข้าดูได้เพื่อดูแลระบบ
// ใช้ user.id จาก JWT เสมอ (ไม่รับ param) เพื่อไม่ให้เช็คสิทธิ์แทนคนอื่นได้
export const getLeaveApproverCheck = async ({ user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [missions, majors, submajors, directorRows, roleRows] = await Promise.all([
            core_kon`
                SELECT mission_id AS id, name, (supervisor_id = ${uid}) AS is_primary
                FROM missions
                WHERE is_active = 'Y' AND (supervisor_id = ${uid} OR acting_supervisor_id = ${uid})
                ORDER BY name`,
            core_kon`
                SELECT major_id AS id, name, (supervisor_id = ${uid}) AS is_primary
                FROM majors
                WHERE is_active = 'Y' AND (supervisor_id = ${uid} OR acting_supervisor_id = ${uid})
                ORDER BY name`,
            core_kon`
                SELECT submajor_id AS id, name, (supervisor_id = ${uid}) AS is_primary
                FROM submajors
                WHERE is_active = 'Y' AND (supervisor_id = ${uid} OR acting_supervisor_id = ${uid})
                ORDER BY name`,
            core_kon`
                SELECT name, value FROM hr_settings
                WHERE name IN ('director_id', 'acting_director_id')`,
            core_kon`
                SELECT r.role_name
                FROM core_kon.user_m_users_roles mu
                LEFT JOIN core_kon.user_roles r ON r.id = mu.role_id
                WHERE mu.user_id = ${uid}`,
        ]);

        const isDirector = directorRows.some((r: any) => r.value != null && Number(r.value) === uid);
        const roles = roleRows.map((r: any) => String(r.role_name ?? '').toUpperCase());
        const isAdmin = roles.includes('ADMIN');

        return {
            success: true,
            data: {
                is_approver: missions.length > 0 || majors.length > 0 || submajors.length > 0 || isDirector || isAdmin,
                is_director: isDirector,
                is_admin: isAdmin,
                missions,
                majors,
                submajors,
            },
        };
    } catch (error: any) { return serverError(set, 'getLeaveApproverCheck', error); }
};

// แต่งตั้ง/ถอดถอน ผอ. — กันซ้ำกับผู้ที่เป็นรักษาการ ผอ. อยู่
export const updateDirector = async ({ body, set, user }: any) => {
    try {
        const r = await setDirectorKey('director_id', 'acting_director_id', body.supervisor_id ?? null, user?.id ?? null);
        if (r.status === 'conflict') { set.status = 409; return { success: false, message: 'ไม่สามารถแต่งตั้งเป็นผู้อำนวยการได้ เพราะบุคลากรนี้เป็นรักษาการผู้อำนวยการอยู่แล้ว' }; }
        return { success: true, data: r.row };
    } catch (error: any) { return serverError(set, 'updateDirector', error); }
};

// แต่งตั้ง/ถอดถอนรักษาการ ผอ. — กันซ้ำกับผู้ที่เป็น ผอ. อยู่
export const updateActingDirector = async ({ body, set, user }: any) => {
    try {
        const r = await setDirectorKey('acting_director_id', 'director_id', body.acting_supervisor_id ?? null, user?.id ?? null);
        if (r.status === 'conflict') { set.status = 409; return { success: false, message: 'ไม่สามารถแต่งตั้งเป็นรักษาการได้ เพราะบุคลากรนี้เป็นผู้อำนวยการอยู่แล้ว' }; }
        return { success: true, data: r.row };
    } catch (error: any) { return serverError(set, 'updateActingDirector', error); }
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

// ── กำหนดค่าสิทธิ์การลาแต่ละประเภท (hr_leave_types + hr_leave_entitlements) ────────
// ใช้ในเมนู HR settings: กำหนดสิทธิ์การลา — จำกัดเฉพาะ ADMIN/HR (requireRoles ใน route)

// ดึงประเภทการลาทั้งหมดพร้อมฟิลด์ครบ (สำหรับหน้าแก้ไขการตั้งค่า)
export const getLeaveTypesFull = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT id, code, name_th, name_en, requires_document, requires_document_after_days,
                   requires_approval, gender_restriction, is_paid, sort_order, is_active
            FROM hr_leave_types
            ORDER BY sort_order ASC, id ASC`;
        return { success: true, data: rows };
    } catch (error: any) { return serverError(set, 'getLeaveTypesFull', error); }
};

// แก้ไขเงื่อนไขพื้นฐานของประเภทการลา (ไม่แก้ code/id — เป็นคีย์อ้างอิงของระบบ)
export const updateLeaveType = async ({ params, body, set }: any) => {
    try {
        const allowed = ['name_th', 'name_en', 'requires_document', 'requires_document_after_days',
            'requires_approval', 'gender_restriction', 'is_paid', 'sort_order', 'is_active'];
        const patch: Record<string, any> = {};
        for (const k of allowed) if (k in body) patch[k] = body[k];
        if (Object.keys(patch).length === 0) {
            set.status = 400;
            return { success: false, message: 'ไม่มีข้อมูลให้บันทึก' };
        }
        patch.updated_at = new Date();
        const rows = await core_kon`
            UPDATE hr_leave_types SET ${core_kon(patch)}
            WHERE id = ${params.id}
            RETURNING id, code, name_th, name_en, requires_document, requires_document_after_days,
                      requires_approval, gender_restriction, is_paid, sort_order, is_active`;
        if (rows.length === 0) { set.status = 404; return { success: false, message: 'ไม่พบประเภทการลานี้' }; }
        return { success: true, data: rows[0] };
    } catch (error: any) { return serverError(set, 'updateLeaveType', error); }
};

// แก้ไขสิทธิ์การลา 1 เกณฑ์ (leave_type × user_type อาจมีหลายเกณฑ์ตามอายุงาน)
export const updateLeaveEntitlement = async ({ params, body, set }: any) => {
    try {
        const allowed = ['max_days_per_year', 'min_service_months', 'carry_over', 'carry_over_max_days'];
        const patch: Record<string, any> = {};
        for (const k of allowed) if (k in body) patch[k] = body[k];
        if (Object.keys(patch).length === 0) {
            set.status = 400;
            return { success: false, message: 'ไม่มีข้อมูลให้บันทึก' };
        }
        const rows = await core_kon`
            UPDATE hr_leave_entitlements SET ${core_kon(patch)}
            WHERE id = ${params.id}
            RETURNING id, leave_type_id, user_type_id, max_days_per_year, min_service_months, carry_over, carry_over_max_days`;
        if (rows.length === 0) { set.status = 404; return { success: false, message: 'ไม่พบเกณฑ์สิทธิ์การลานี้' }; }
        return { success: true, data: rows[0] };
    } catch (error: any) { return serverError(set, 'updateLeaveEntitlement', error); }
};

// เพิ่มเกณฑ์สิทธิ์การลาใหม่ — ใช้ทั้งเพิ่มประเภทเจ้าหน้าที่ที่ยังไม่มีเกณฑ์ และเพิ่มเกณฑ์ตามอายุงาน (tier) ให้ combo เดิม
export const createLeaveEntitlement = async ({ body, set }: any) => {
    try {
        const { leave_type_id, user_type_id, max_days_per_year, min_service_months, carry_over, carry_over_max_days } = body;
        const rows = await core_kon`
            INSERT INTO hr_leave_entitlements (leave_type_id, user_type_id, max_days_per_year, min_service_months, carry_over, carry_over_max_days)
            VALUES (${leave_type_id}, ${user_type_id}, ${max_days_per_year ?? null}, ${min_service_months ?? 0}, ${carry_over ?? false}, ${carry_over_max_days ?? null})
            RETURNING id, leave_type_id, user_type_id, max_days_per_year, min_service_months, carry_over, carry_over_max_days`;
        set.status = 201;
        return { success: true, data: rows[0] };
    } catch (error: any) { return serverError(set, 'createLeaveEntitlement', error); }
};

// ลบเกณฑ์สิทธิ์การลา (เช่น ลบ tier ที่ตั้งผิด)
export const deleteLeaveEntitlement = async ({ params, set }: any) => {
    try {
        const rows = await core_kon`DELETE FROM hr_leave_entitlements WHERE id = ${params.id} RETURNING id`;
        if (rows.length === 0) { set.status = 404; return { success: false, message: 'ไม่พบเกณฑ์สิทธิ์การลานี้' }; }
        return { success: true, message: 'ลบเกณฑ์สิทธิ์การลาเรียบร้อย' };
    } catch (error: any) { return serverError(set, 'deleteLeaveEntitlement', error); }
};
