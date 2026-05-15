import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getAllUsers, getUserById, createUser, updateUser, deactivateUser, activateUser, changePassword } from '../controllers/userController';

// สร้าง Schema สำหรับตรวจสอบข้อมูล (Validation) ให้ตรงกับโครงสร้างตาราง users
const userSchema = t.Object({
    pname: t.Optional(t.Nullable(t.String())),
    fname: t.String(),
    lname: t.String(),
    id_card: t.Optional(t.Nullable(t.String())),
    gender: t.Optional(t.Nullable(t.String())),
    birthday: t.Optional(t.Nullable(t.String())),
    hire_date: t.Optional(t.Nullable(t.String())),
    user_type_id: t.Optional(t.Nullable(t.Numeric())),
    user_position_id: t.Optional(t.Nullable(t.Numeric())),
    user_level_id: t.Optional(t.Nullable(t.Numeric())),
    user_status_id: t.Optional(t.Nullable(t.Numeric())),
    mission_id: t.Optional(t.Nullable(t.Numeric())),
    major_id: t.Optional(t.Nullable(t.Numeric())),
    submajor_id: t.Optional(t.Nullable(t.Numeric())),
    attendance_id: t.Optional(t.Nullable(t.Numeric())),
    salary_id: t.Optional(t.Nullable(t.Numeric())),
    username: t.String(),
    password: t.String(),
    is_active: t.Optional(t.Nullable(t.String())),
    hospital_lc_pid: t.Optional(t.Nullable(t.Numeric()))
});

export const userRoutes = new Elysia({ prefix: '/api/v1/users' })
    .use(authMiddleware)
    .get('/', getAllUsers, {
        detail: { tags: ['Users'] }
    })
    .get('/:id', getUserById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users'] }
    })
    .post('/', createUser, {
        body: userSchema,
        detail: { tags: ['Users'] }
    })
    .put('/:id', updateUser, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Partial(userSchema), // ใช้ Partial เพื่อให้สามารถเลือกอัปเดตแค่บางฟิลด์ได้
        detail: { tags: ['Users'] }
    })
    .patch('/:id/deactivate', deactivateUser, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users'] }
    })
    .patch('/:id/activate', activateUser, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users'] }
    })
    .patch('/:id/change-password', changePassword, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            old_password: t.String(),
            new_password: t.String()
        }),
        detail: { tags: ['Users'], summary: 'เปลี่ยนรหัสผ่าน', description: 'ตรวจสอบรหัสเก่าก่อน ถ้าตรงจึงเข้ารหัสใหม่ด้วย Argon2id แล้วอัปเดต' }
    });