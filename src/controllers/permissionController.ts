import { core_kon } from '../db/db';

// ==================== PERMISSIONS ====================

export const getAllPermissions = async ({ set }: any) => {
    try {
        const permissions = await core_kon`
            SELECT id, permission_name, description, created_at
            FROM user_permissions
            ORDER BY id ASC
        `;
        return { success: true, data: permissions };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const getPermissionById = async ({ params, set }: any) => {
    try {
        const permissions = await core_kon`
            SELECT id, permission_name, description, created_at
            FROM user_permissions
            WHERE id = ${params.id}
        `;
        if (permissions.length === 0) {
            set.status = 404;
            return { success: false, message: 'Permission not found' };
        }
        return { success: true, data: permissions[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const createPermission = async ({ body, set }: any) => {
    try {
        const { permission_name, description } = body as any;
        const result = await core_kon`
            INSERT INTO user_permissions (permission_name, description)
            VALUES (${permission_name}, ${description ?? null})
            RETURNING id, permission_name
        `;
        set.status = 201;
        return { success: true, message: 'Permission created successfully', data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const updatePermission = async ({ params, body, set }: any) => {
    try {
        const { permission_name, description } = body as any;
        const result = await core_kon`
            UPDATE user_permissions
            SET
                permission_name = COALESCE(${permission_name ?? null}, permission_name),
                description     = COALESCE(${description ?? null}, description)
            WHERE id = ${params.id}
            RETURNING id, permission_name
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Permission not found' };
        }
        return { success: true, message: 'Permission updated successfully', data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const deletePermission = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            DELETE FROM user_permissions
            WHERE id = ${params.id}
            RETURNING id
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Permission not found' };
        }
        return { success: true, message: 'Permission deleted successfully' };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ==================== ROLES ====================

export const getAllRoles = async ({ set }: any) => {
    try {
        const roles = await core_kon`
            SELECT id, role_name, description, created_at
            FROM user_roles
            ORDER BY id ASC
        `;
        return { success: true, data: roles };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const getRoleById = async ({ params, set }: any) => {
    try {
        const roles = await core_kon`
            SELECT id, role_name, description, created_at
            FROM user_roles
            WHERE id = ${params.id}
        `;
        if (roles.length === 0) {
            set.status = 404;
            return { success: false, message: 'Role not found' };
        }
        return { success: true, data: roles[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const createRole = async ({ body, set }: any) => {
    try {
        const { role_name, description } = body as any;
        const result = await core_kon`
            INSERT INTO user_roles (role_name, description)
            VALUES (${role_name}, ${description ?? null})
            RETURNING id, role_name
        `;
        set.status = 201;
        return { success: true, message: 'Role created successfully', data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const updateRole = async ({ params, body, set }: any) => {
    try {
        const { role_name, description } = body as any;
        const result = await core_kon`
            UPDATE user_roles
            SET
                role_name   = COALESCE(${role_name ?? null}, role_name),
                description = COALESCE(${description ?? null}, description)
            WHERE id = ${params.id}
            RETURNING id, role_name
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Role not found' };
        }
        return { success: true, message: 'Role updated successfully', data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const deleteRole = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            DELETE FROM user_roles
            WHERE id = ${params.id}
            RETURNING id
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Role not found' };
        }
        return { success: true, message: 'Role deleted successfully' };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ==================== USER-ROLES MAPPING ====================

export const getRolesByUserId = async ({ params, set }: any) => {
    try {
        const roles = await core_kon`
            SELECT r.id, r.role_name, r.description, ur.assigned_at
            FROM user_m_users_roles ur
            JOIN user_roles r ON ur.role_id = r.id
            WHERE ur.user_id = ${params.id}
            ORDER BY r.id ASC
        `;
        return { success: true, data: roles };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const assignRoleToUser = async ({ params, body, set }: any) => {
    try {
        await core_kon`
            INSERT INTO user_m_users_roles (user_id, role_id)
            VALUES (${params.id}, ${(body as any).role_id})
            ON CONFLICT DO NOTHING
        `;
        return { success: true, message: 'Role assigned to user successfully' };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const removeRoleFromUser = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            DELETE FROM user_m_users_roles
            WHERE user_id = ${params.id} AND role_id = ${params.roleId}
            RETURNING user_id
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'User-Role mapping not found' };
        }
        return { success: true, message: 'Role removed from user successfully' };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ==================== ROLE-PERMISSIONS MAPPING ====================

export const getPermissionsByRoleId = async ({ params, set }: any) => {
    try {
        const permissions = await core_kon`
            SELECT p.id, p.permission_name, p.description
            FROM user_m_roles_permissions rp
            JOIN user_permissions p ON rp.permission_id = p.id
            WHERE rp.role_id = ${params.id}
            ORDER BY p.id ASC
        `;
        return { success: true, data: permissions };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const assignPermissionToRole = async ({ params, body, set }: any) => {
    try {
        await core_kon`
            INSERT INTO user_m_roles_permissions (role_id, permission_id)
            VALUES (${params.id}, ${(body as any).permission_id})
            ON CONFLICT DO NOTHING
        `;
        return { success: true, message: 'Permission assigned to role successfully' };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

export const removePermissionFromRole = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            DELETE FROM user_m_roles_permissions
            WHERE role_id = ${params.id} AND permission_id = ${params.permissionId}
            RETURNING role_id
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Role-Permission mapping not found' };
        }
        return { success: true, message: 'Permission removed from role successfully' };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};
