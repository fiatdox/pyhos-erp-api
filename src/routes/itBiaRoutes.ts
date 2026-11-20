import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { createBiaService, getBiaLog, getBiaServices, updateBiaService } from '../controllers/itBiaController';
import { getBiaAssets } from '../controllers/itAssetController';

// Business Impact Analysis — เฉพาะเจ้าหน้าที่ IT (หน้าเว็บซ่อนเมนูและกั้น URL ด้วย)
const IT_ROLES = ['ADMIN', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT', 'IT_STAFF'];
const detail = { tags: ['IT'] };
const idParam = { params: t.Object({ id: t.Numeric() }) };

export const itBiaRoutes = new Elysia({ prefix: '/api/v1/it/bia' })
    .use(authMiddleware)
    .use(requireRoles(...IT_ROLES))
    .get('/', getBiaServices, { detail: { ...detail, summary: 'ทะเบียน BIA: บริการ/ระบบงานสำคัญ ผลกระทบ RTO/RPO และสิ่งที่พึ่งพา' } })
    .get('/assets', getBiaAssets, { query: t.Object({ search: t.Optional(t.String()), keys: t.Optional(t.String()) }), detail: { ...detail, summary: 'ครุภัณฑ์เป้าหมายที่ผูกกับ BIA ได้ (นอกหมวดคอมพิวเตอร์): ซอฟต์แวร์ ไฟฟ้าสำรอง/สื่อสาร ปรับอากาศ/โทรศัพท์ · เครื่องมือแพทย์ต้องค้นหา' } })
    .post('/', createBiaService, { body: t.Any(), detail: { ...detail, summary: 'เพิ่มบริการในทะเบียน BIA' } })
    .put('/:id', updateBiaService, { ...idParam, body: t.Any(), detail: { ...detail, summary: 'แก้ไข/ปิดใช้บริการในทะเบียน BIA (เก็บค่าก่อน-หลังใน log)' } })
    .get('/:id/log', getBiaLog, { ...idParam, detail: { ...detail, summary: 'ประวัติการแก้ไขบริการในทะเบียน BIA' } });
