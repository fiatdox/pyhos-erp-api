import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getAllUsers, getUserById, getUserInfo, createUser, updateUser, deactivateUser, activateUser, changePassword, getMySalaryId, setMySalaryId, updateMyCodes, getMyColleagues } from '../controllers/userController';

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
    // เลขที่เงินเดือนของผู้ login (identity จาก JWT) — ประกาศก่อน /:id กันชนกับ dynamic route
    .get('/me/colleagues', getMyColleagues, {
        detail: { tags: ['Users'], summary: 'ดึงเพื่อนร่วมกลุ่มภารกิจของตัวเอง', description: 'ดึงบุคลากรทั้งหมดใน mission_id เดียวกัน — ใช้เลือกผู้ปฏิบัติงานแทนตอนลา (ผู้ใช้เลือกเองจากทั้งกลุ่มภารกิจ)' }
    })
    .get('/me/salary-id', getMySalaryId, {
        detail: { tags: ['Users'], summary: 'ดึงเลขที่เงินเดือนของตัวเอง', description: 'อ่าน users.salary_id ของผู้ login — ใช้เช็คก่อนแสดงข้อมูลเงินเดือน' }
    })
    .patch('/me/salary-id', setMySalaryId, {
        body: t.Object({ salary_id: t.Numeric() }),
        detail: { tags: ['Users'], summary: 'บันทึกเลขที่เงินเดือนของตัวเอง', description: 'ตั้งได้เฉพาะตอน salary_id ยังว่าง — 409 ถ้ามีค่าแล้วหรือเลขซ้ำกับผู้ใช้อื่น' }
    })
    // แก้ไขรหัสประจำตัวของตัวเอง (เปลี่ยนเองได้จากหน้า account/settings)
    .patch('/me/codes', updateMyCodes, {
        body: t.Object({
            salary_id: t.Optional(t.Nullable(t.Numeric())),
            attendance_id: t.Optional(t.Nullable(t.Numeric())),
        }),
        detail: { tags: ['Users'], summary: 'แก้ไขรหัสประจำตัวของตัวเอง', description: 'อัปเดต users.salary_id / attendance_id ของผู้ login — salary_id กันซ้ำกับผู้ใช้อื่น (409), null = ล้างค่า' }
    })
    .get('/:id', getUserById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users'] }
    })
    .get('/:id/info', getUserInfo, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users'], summary: 'ดึงข้อมูลผู้ใช้พร้อมรายละเอียด' }
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