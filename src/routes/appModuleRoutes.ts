import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { getDisabledModules, getModules, updateModules } from '../controllers/appModuleController';

const TAG = 'Modules';

export const appModuleRoutes = new Elysia({ prefix: '/api/v1/modules' })
    .use(authMiddleware)
    // ── อ่านรายการที่ปิดอยู่ — ทุกคนที่ล็อกอิน (หน้าเว็บใช้กรองเมนู) ──
    .get('/disabled', getDisabledModules, {
        detail: { tags: [TAG], summary: 'เส้นทางของโมดูลที่ปิดการมองเห็นอยู่', description: 'ผลถูกแคชฝั่ง server 30 วินาที' }
    })
    // ── จัดการทะเบียน — เฉพาะ ADMIN (มีผลกับ route ที่ประกาศหลังบรรทัดนี้) ──
    .use(requireRoles('ADMIN'))
    .get('/', getModules, {
        detail: { tags: [TAG], summary: 'ทะเบียนโมดูลทั้งหมดพร้อมสถานะเปิด/ปิด' }
    })
    .put('/', updateModules, {
        body: t.Object({
            modules: t.Array(t.Object({
                module_key: t.String(),
                enabled: t.Boolean(),
            })),
        }),
        detail: { tags: [TAG], summary: 'บันทึกสถานะเปิด/ปิดทั้งชุด', description: 'คีย์ที่ไม่มีในทะเบียนทำให้ 400 และไม่เขียนรายการใดเลย' }
    });
