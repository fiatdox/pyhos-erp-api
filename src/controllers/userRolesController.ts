import { core_kon } from '../db/db';

// ==================== USER-ROLES CRUD (user_m_users_roles) ====================

// ดึงรายการ user-role ทั้งหมด
export const getAllUserRoles = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT
                ur.user_id,
                ur.role_id,
                ur.assigned_at,
                u.fname,
                u.lname,
                r.role_name
            FROM user_m_users_roles ur
            JOIN users u ON ur.user_id = u.id
            JOIN user_roles r ON ur.role_id = r.id
            ORDER BY ur.user_id ASC, ur.role_id ASC
        `;
        return { success: true, data: rows };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการ user-role ตาม role_id
export const getUserRolesByRoleId = async ({ params, set }: any) => {
    try {
        const rows = await core_kon`
            SELECT
                ur.user_id,
                ur.role_id,
                ur.assigned_at,
                u.fname,
                u.lname,
                r.role_name
            FROM user_m_users_roles ur
            JOIN users u ON ur.user_id = u.id
            JOIN user_roles r ON ur.role_id = r.id
            WHERE ur.role_id = ${params.roleId}
            ORDER BY ur.user_id ASC
        `;
        return { success: true, data: rows };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึง user-role รายตัวตาม user_id + role_id
export const getUserRole = async ({ params, set }: any) => {
    try {
        const rows = await core_kon`
            SELECT
                ur.user_id,
                ur.role_id,
                ur.assigned_at,
                u.fname,
                u.lname,
                r.role_name
            FROM user_m_users_roles ur
            JOIN users u ON ur.user_id = u.id
            JOIN user_roles r ON ur.role_id = r.id
            WHERE ur.user_id = ${params.userId} AND ur.role_id = ${params.roleId}
        `;
        if (rows.length === 0) {
            set.status = 404;
            return { success: false, message: 'User-Role mapping not found' };
        }
        return { success: true, data: rows[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// สร้าง user-role (รับได้ทั้งแบบเดี่ยวและแบบชุด)
export const createUserRole = async ({ body, set }: any) => {
    try {
        // รองรับทั้ง { user_id, role_id } และ [{ user_id, role_id }, ...]
        const items: any[] = Array.isArray(body) ? body : [body];

        if (items.length === 0) {
            set.status = 400;
            return { success: false, message: 'ต้องระบุข้อมูลอย่างน้อย 1 รายการ' };
        }

        const values = items.map((it) => ({ user_id: it.user_id, role_id: it.role_id }));

        // เพิ่มทีละชุด ข้ามรายการที่ซ้ำ (ON CONFLICT DO NOTHING)
        const result = await core_kon`
            INSERT INTO user_m_users_roles ${core_kon(values, 'user_id', 'role_id')}
            ON CONFLICT (user_id, role_id) DO NOTHING
            RETURNING user_id, role_id, assigned_at
        `;

        set.status = 201;
        return {
            success: true,
            message: `เพิ่ม user-role สำเร็จ ${result.length} รายการ (ข้ามที่ซ้ำ ${items.length - result.length} รายการ)`,
            inserted: result.length,
            skipped: items.length - result.length,
            data: result,
        };
    } catch (error: any) {
        if (error.code === '23503') {
            set.status = 400;
            return { success: false, message: 'user_id หรือ role_id ไม่มีอยู่ในระบบ' };
        }
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// แก้ไข user-role (เปลี่ยน user_id/role_id ของ mapping เดิม)
export const updateUserRole = async ({ params, body, set }: any) => {
    try {
        const { user_id, role_id } = body as any;
        const result = await core_kon`
            UPDATE user_m_users_roles
            SET
                user_id = COALESCE(${user_id ?? null}, user_id),
                role_id = COALESCE(${role_id ?? null}, role_id)
            WHERE user_id = ${params.userId} AND role_id = ${params.roleId}
            RETURNING user_id, role_id, assigned_at
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'User-Role mapping not found' };
        }
        return { success: true, message: 'User-Role updated successfully', data: result[0] };
    } catch (error: any) {
        if (error.code === '23505') {
            set.status = 409;
            return { success: false, message: 'มีการกำหนด role นี้ให้ user นี้อยู่แล้ว' };
        }
        if (error.code === '23503') {
            set.status = 400;
            return { success: false, message: 'user_id หรือ role_id ไม่มีอยู่ในระบบ' };
        }
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ลบ user-role
export const deleteUserRole = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            DELETE FROM user_m_users_roles
            WHERE user_id = ${params.userId} AND role_id = ${params.roleId}
            RETURNING user_id
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'User-Role mapping not found' };
        }
        return { success: true, message: 'User-Role deleted successfully' };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};
