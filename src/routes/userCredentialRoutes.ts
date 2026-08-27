import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { getCredentialUsers, updateUserCredentials, getCredentialAudit } from '../controllers/userCredentialController';

const TAG = 'UserCredential';

// จัดการข้อมูลเข้าสู่ระบบของบุคลากร — เฉพาะ ADMIN และ IT_STAFF
// กัน 2 ชั้น: requireRoles ที่ route + เช็คซ้ำใน controller
export const userCredentialRoutes = new Elysia({ prefix: '/api/v1/user-credentials' })
    .use(authMiddleware)
    .use(requireRoles('ADMIN', 'IT_STAFF'))
    .get('/', getCredentialUsers, {
        query: t.Object({
            search: t.Optional(t.String()),
            active: t.Optional(t.String()),
            limit: t.Optional(t.Numeric()),
            offset: t.Optional(t.Numeric()),
        }),
        detail: {
            tags: [TAG],
            summary: 'รายชื่อบุคลากรสำหรับจัดการบัญชีเข้าใช้งาน',
            description: 'คืนเลขบัตรแบบปิดบัง (****1234) เท่านั้น ไม่ส่งเลขเต็มออกจากเซิร์ฟเวอร์',
        }
    })
    .patch('/:id', updateUserCredentials, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            username: t.Optional(t.String()),
            password: t.Optional(t.String()),
            id_card: t.Optional(t.String()),
            notify: t.Optional(t.Boolean()),
        }),
        detail: {
            tags: [TAG],
            summary: 'แก้ไข username / รหัสผ่าน / เลขบัตรประชาชน',
            description: 'ส่งเฉพาะฟิลด์ที่ต้องการเปลี่ยน · ตั้งรหัสผ่านใหม่จะบังคับให้เจ้าของบัญชีเปลี่ยนเองครั้งถัดไป · notify=true ส่งรหัสให้เจ้าตัวผ่าน Line หมอพร้อม',
        }
    })
    .get('/audit', getCredentialAudit, {
        query: t.Object({ limit: t.Optional(t.Numeric()), target_user_id: t.Optional(t.Numeric()) }),
        detail: { tags: [TAG], summary: 'ประวัติการแก้ไขบัญชีเข้าใช้งาน' }
    });
