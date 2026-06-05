import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
    getAllUserRoles,
    getUserRolesByRoleId,
    getUserRole,
    createUserRole,
    updateUserRole,
    deleteUserRole,
} from '../controllers/userRolesController';

const userRoleSchema = t.Object({
    user_id: t.Numeric(),
    role_id: t.Numeric(),
});

// รับได้ทั้งแบบเดี่ยวและแบบชุด (array)
const createUserRoleSchema = t.Union([
    userRoleSchema,
    t.Array(userRoleSchema),
]);

export const userRolesRoutes = new Elysia({ prefix: '/api/v1/user-roles' })
    .use(authMiddleware)
    // ดึงรายการ user-role ทั้งหมด
    .get('/', getAllUserRoles, {
        detail: { tags: ['Users - Roles'], summary: 'ดึงรายการ user-role ทั้งหมด', description: 'ดึงข้อมูล user_id, role_id, assigned_at จากตาราง user_m_users_roles' }
    })
    // ดึงรายการ user-role ตาม role_id
    .get('/role/:roleId', getUserRolesByRoleId, {
        params: t.Object({ roleId: t.Numeric() }),
        detail: { tags: ['Users - Roles'], summary: 'ดึง user-role ตาม role_id', description: 'ดึงรายชื่อ user ทั้งหมดที่ถูกกำหนด role นี้' }
    })
    // ดึง user-role รายตัว
    .get('/:userId/:roleId', getUserRole, {
        params: t.Object({ userId: t.Numeric(), roleId: t.Numeric() }),
        detail: { tags: ['Users - Roles'], summary: 'ดึง user-role รายตัว', description: 'ดึง mapping ตาม user_id และ role_id' }
    })
    // สร้าง user-role
    .post('/', createUserRole, {
        body: createUserRoleSchema,
        detail: { tags: ['Users - Roles'], summary: 'สร้าง user-role (เดี่ยว/ชุด)', description: 'เพิ่ม mapping user_id, role_id ลงตาราง user_m_users_roles รับได้ทั้ง object เดียวหรือ array หลายรายการ (ข้ามรายการที่ซ้ำอัตโนมัติ)' }
    })
    // แก้ไข user-role
    .put('/:userId/:roleId', updateUserRole, {
        params: t.Object({ userId: t.Numeric(), roleId: t.Numeric() }),
        body: t.Partial(userRoleSchema),
        detail: { tags: ['Users - Roles'], summary: 'แก้ไข user-role', description: 'แก้ไข user_id/role_id ของ mapping เดิม' }
    })
    // ลบ user-role
    .delete('/:userId/:roleId', deleteUserRole, {
        params: t.Object({ userId: t.Numeric(), roleId: t.Numeric() }),
        detail: { tags: ['Users - Roles'], summary: 'ลบ user-role', description: 'ลบ mapping ตาม user_id และ role_id' }
    });
