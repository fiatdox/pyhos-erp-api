import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getSessions, deleteSession, deleteSessionsBulk } from '../controllers/hisController';

export const hisRoutes = new Elysia({ prefix: '/api/v1/his' })
    .use(authMiddleware)
    .get('/sessions', getSessions, {
        detail: { tags: ['HIS'], summary: 'ดึงรายการ session ที่ online อยู่', description: 'ดึง onlineid, kskloginname, computername, servername, client_version, department จากตาราง onlineuser' }
    })
    .delete('/sessions/:sessionId', deleteSession, {
        params: t.Object({ sessionId: t.String() }),
        detail: { tags: ['HIS'], summary: 'ลบ session ตาม onlineid' }
    })
    .delete('/sessions', deleteSessionsBulk, {
        body: t.Object({ ids: t.Array(t.Union([t.String(), t.Number()])) }),
        detail: { tags: ['HIS'], summary: 'ลบ session แบบกลุ่ม (bulk)', description: 'ส่ง body: { ids: [onlineid, ...] } เพื่อลบหลาย session พร้อมกัน' }
    });
