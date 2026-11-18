import { Elysia } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { canViewExecutive, getExecutiveDashboard } from '../controllers/itExecutiveController';

// Dashboard ผู้บริหาร (ทะเบียนความเสี่ยง + ทรัพย์สินงาน IT) — ADMIN · CHIEF_MISSION_IT · CHIEF_GROUP_IT · IT_STAFF · ผอ./รักษาการ ผอ.
// ผอ. ไม่ใช่ role (มาจาก hr_settings) จึงใช้ guard ของตัวเองแทน requireRoles
export const itExecutiveRoutes = new Elysia({ prefix: '/api/v1/it/executive-dashboard' })
    .use(authMiddleware)
    .onBeforeHandle(async ({ user, set }: any) => {
        if (!user?.id) { set.status = 401; return { success: false, message: 'Unauthorized' }; }
        if (!(await canViewExecutive(Number(user.id)))) { set.status = 403; return { success: false, message: 'เฉพาะเจ้าหน้าที่และหัวหน้างาน IT และผู้อำนวยการ' }; }
    })
    .get('/', getExecutiveDashboard, {
        detail: { tags: ['IT'], summary: 'Dashboard ผู้บริหาร: ทะเบียนความเสี่ยงทุกรอบ + สรุปทะเบียนทรัพย์สินงาน IT และผลประเมินความเสี่ยงทรัพย์สิน (ตัวเลขสรุปเท่านั้น)' },
    });
