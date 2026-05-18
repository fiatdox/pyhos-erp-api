import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { searchEquipment } from '../controllers/equipmentController';

export const equipmentRoutes = new Elysia({ prefix: '/api/v1/equipment' })
    .use(authMiddleware)
    .get('/search', searchEquipment, {
        query: t.Object({ keyword: t.String({ minLength: 1 }) }),
        detail: {
            tags: ['Equipment'],
            summary: 'ค้นหาครุภัณฑ์',
            description: 'ค้นหาจากตาราง deprecia โดย noid, names, models, locates, fy, docno, notes, companyname (max 200 รายการ)',
        },
        error({ code, set }) {
            if (code === 'VALIDATION') {
                set.status = 400;
                return { success: false, message: 'กรุณาระบุ keyword ในการค้นหา' };
            }
        },
    });
