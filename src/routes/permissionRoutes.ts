import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
    getAllPermissions,
    getPermissionById,
    createPermission,
    updatePermission,
    deletePermission,
    getAllRoles,
    getRoleById,
    createRole,
    updateRole,
    deleteRole,
    getRolesByUserId,
    assignRoleToUser,
    removeRoleFromUser,
    getPermissionsByRoleId,
    assignPermissionToRole,
    removePermissionFromRole,
} from '../controllers/permissionController';

const permissionSchema = t.Object({
    permission_name: t.String(),
    description: t.Optional(t.Nullable(t.String())),
});

const roleSchema = t.Object({
    role_name: t.String(),
    description: t.Optional(t.Nullable(t.String())),
});

export const permissionRoutes = new Elysia({ prefix: '/api/v1/permissions' })
    .use(authMiddleware)
    .get('/', getAllPermissions, {
        detail: { tags: ['Users - Permissions'] }
    })
    .get('/:id', getPermissionById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users - Permissions'] }
    })
    .post('/', createPermission, {
        body: permissionSchema,
        detail: { tags: ['Users - Permissions'] }
    })
    .put('/:id', updatePermission, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Partial(permissionSchema),
        detail: { tags: ['Users - Permissions'] }
    })
    .delete('/:id', deletePermission, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users - Permissions'] }
    });

export const roleRoutes = new Elysia({ prefix: '/api/v1/roles' })
    .use(authMiddleware)
    .get('/', getAllRoles, {
        detail: { tags: ['Users - Roles'] }
    })
    .get('/:id', getRoleById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users - Roles'] }
    })
    .post('/', createRole, {
        body: roleSchema,
        detail: { tags: ['Users - Roles'] }
    })
    .put('/:id', updateRole, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Partial(roleSchema),
        detail: { tags: ['Users - Roles'] }
    })
    .delete('/:id', deleteRole, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users - Roles'] }
    })
    // Role-Permissions mapping (user_m_roles_permissions)
    .get('/:id/permissions', getPermissionsByRoleId, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users - Roles'] }
    })
    .post('/:id/permissions', assignPermissionToRole, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ permission_id: t.Numeric() }),
        detail: { tags: ['Users - Roles'] }
    })
    .delete('/:id/permissions/:permissionId', removePermissionFromRole, {
        params: t.Object({ id: t.Numeric(), permissionId: t.Numeric() }),
        detail: { tags: ['Users - Roles'] }
    });

export const userRoleRoutes = new Elysia({ prefix: '/api/v1/users' })
    .use(authMiddleware)
    // User-Roles mapping (user_m_users_roles)
    .get('/:id/roles', getRolesByUserId, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users'] }
    })
    .post('/:id/roles', assignRoleToUser, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ role_id: t.Numeric() }),
        detail: { tags: ['Users'] }
    })
    .delete('/:id/roles/:roleId', removeRoleFromUser, {
        params: t.Object({ id: t.Numeric(), roleId: t.Numeric() }),
        detail: { tags: ['Users'] }
    });
