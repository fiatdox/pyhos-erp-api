import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { getAllUsers, getUserById, getUserInfo, createUser, updateUser, deactivateUser, activateUser, changePassword, getMyPasswordStatus, getMyUsernameStatus, checkMyUsername, changeMyUsername, getMySalaryId, setMySalaryId, updateMyCodes, getMyColleagues } from '../controllers/userController';

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
    work_end_date: t.Optional(t.Nullable(t.String())),
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
    .get('/me/password-status', getMyPasswordStatus, {
        detail: {
            tags: ['Users'],
            summary: 'สถานะอายุรหัสผ่านของตัวเอง',
            description: 'คำนวณจากวันที่เปลี่ยนรหัสผ่านล่าสุด — คืน ageDays, daysLeft, expired, shouldWarn (ปิดนโยบายอยู่จะคืนค่า null ทั้งหมด)'
        }
    })
    // นโยบายชื่อผู้ใช้ — เจ้าของบัญชีตั้งชื่อใหม่เองได้ (ต้องเรียกได้แม้ติดด่านบังคับใน authMiddleware)
    .get('/me/username-status', getMyUsernameStatus, {
        detail: {
            tags: ['Users'],
            summary: 'สถานะชื่อผู้ใช้ของตัวเอง',
            description: 'ตรวจว่า username เป็นเลขบัตรประชาชนหรือไม่ และนโยบายปัจจุบันสั่งให้เตือน (warn) หรือบังคับเปลี่ยน (required)'
        }
    })
    .get('/me/username-check', checkMyUsername, {
        query: t.Object({ username: t.String() }),
        detail: {
            tags: ['Users'],
            summary: 'ตรวจชื่อผู้ใช้ก่อนบันทึก',
            description: 'คืน available + เหตุผล ใช้ตรรกะชุดเดียวกับตอนบันทึกจริง — ให้หน้าจอบอกชื่อซ้ำได้ทันทีขณะพิมพ์'
        }
    })
    .patch('/me/username', changeMyUsername, {
        body: t.Object({ username: t.String() }),
        detail: {
            tags: ['Users'],
            summary: 'ตั้งชื่อผู้ใช้ใหม่ด้วยตัวเอง',
            description: 'ตรวจรูปแบบ 4-50 ตัว (a-z A-Z 0-9 . _ -), ห้ามเป็นเลขบัตร/ตัวเลข 13 หลัก, กันชื่อซ้ำ (409) — สำเร็จแล้วคืน token ใหม่ ต้องเก็บทับของเดิม'
        }
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
    // เปลี่ยนรหัสผ่าน — เจ้าของบัญชีทำเองได้ (ตรวจสิทธิ์เจ้าของ/ADMIN ใน controller)
    // ประกาศ "ก่อน" requireRoles ด้านล่าง เพื่อไม่ให้ผู้ใช้ทั่วไปเปลี่ยนรหัสของตัวเองไม่ได้
    .patch('/:id/change-password', changePassword, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            old_password: t.String(),
            new_password: t.String()
        }),
        detail: { tags: ['Users'], summary: 'เปลี่ยนรหัสผ่าน', description: 'ตรวจสอบรหัสเก่าก่อน ถ้าตรงจึงเข้ารหัสใหม่ด้วย Argon2id แล้วอัปเดต' }
    })
    // ── สร้าง/แก้ไข/ระงับบัญชีผู้ใช้ — จำกัดสิทธิ์ ──────────────────────────────
    // เดิมไม่มี guard ทำให้ผู้ใช้ที่ล็อกอินคนใดก็ได้แก้ username/รหัสผ่าน/เลขบัตรของคนอื่นได้
    // หมายเหตุ: requireRoles มีผลกับ route ที่ประกาศ "หลัง" บรรทัดนี้เท่านั้น
    .use(requireRoles('ADMIN', 'HR', 'IT_STAFF'))
    .post('/', createUser, {
        body: userSchema,
        detail: { tags: ['Users'], description: 'เฉพาะ ADMIN, HR, IT_STAFF' }
    })
    .put('/:id', updateUser, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Partial(userSchema), // ใช้ Partial เพื่อให้สามารถเลือกอัปเดตแค่บางฟิลด์ได้
        detail: { tags: ['Users'], description: 'เฉพาะ ADMIN, HR, IT_STAFF' }
    })
    .patch('/:id/deactivate', deactivateUser, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users'], description: 'เฉพาะ ADMIN, HR, IT_STAFF' }
    })
    .patch('/:id/activate', activateUser, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['Users'], description: 'เฉพาะ ADMIN, HR, IT_STAFF' }
    });