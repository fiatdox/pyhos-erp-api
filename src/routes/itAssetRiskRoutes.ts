import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { createAssetRisk, getAssetRiskHistory, getCurrentAssetRisks } from '../controllers/itAssetRiskController';

// ประเมินความเสี่ยงทรัพย์สินงาน IT — เฉพาะเจ้าหน้าที่ IT (หน้าเว็บซ่อนเมนูและกั้น URL ด้วย)
const IT_ROLES = ['ADMIN', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT', 'IT_STAFF'];
const detail = { tags: ['IT'] };

export const itAssetRiskRoutes = new Elysia({ prefix: '/api/v1/it/asset-risks' })
    .use(authMiddleware)
    .use(requireRoles(...IT_ROLES))
    .get('/', getCurrentAssetRisks, { detail: { ...detail, summary: 'ผลประเมินความเสี่ยงล่าสุดของครุภัณฑ์ทุกรายการที่เคยประเมิน' } })
    .get('/history', getAssetRiskHistory, {
        query: t.Object({ asset_key: t.String() }),
        detail: { ...detail, summary: 'ประวัติการประเมินความเสี่ยงของครุภัณฑ์หนึ่งรายการ' },
    })
    .post('/', createAssetRisk, {
        body: t.Any(),
        detail: { ...detail, summary: 'บันทึกผลประเมินความเสี่ยง (เพิ่มแถวใหม่ทุกครั้ง ผู้ประเมินจาก token)' },
    });
