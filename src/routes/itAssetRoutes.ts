import { Elysia } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { getItAssets } from '../controllers/itAssetController';

// ทะเบียนทรัพย์สินงาน IT — เฉพาะเจ้าหน้าที่ IT (หน้าเว็บซ่อนเมนูและกั้น URL ด้วย)
const IT_ROLES = ['ADMIN', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT', 'IT_STAFF'];

export const itAssetRoutes = new Elysia({ prefix: '/api/v1/it/assets' })
    .use(authMiddleware)
    .use(requireRoles(...IT_ROLES))
    .get('/', getItAssets, {
        detail: {
            tags: ['IT'],
            summary: 'ทะเบียนทรัพย์สินงาน IT (ครุภัณฑ์คอมพิวเตอร์)',
            description: 'ครุภัณฑ์หมวดคอมพิวเตอร์จากทะเบียน V3 (ปัจจุบัน) และ V2 (เดิม) รวมเป็นรูปแบบเดียว พร้อมชนิดอุปกรณ์ IT สถานะ และจำนวนครั้งที่แจ้งซ่อม — อ่านอย่างเดียว ตัวกรองทำที่หน้าเว็บ',
        },
    });
