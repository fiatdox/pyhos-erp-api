import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { createAssessment, createItem, deleteItem, getAssessment, getAssessmentLog, listAssessments, updateAssessment, updateItem } from '../controllers/itThirdPartyController';

// การประเมินความเสี่ยงของบุคคลภายนอก (3rd Party Risk Assessment) — เฉพาะเจ้าหน้าที่ IT (หน้าเว็บซ่อนเมนูและกั้น URL ด้วย)
// รายชื่อผู้บันทึกใช้ GET /api/v1/it/risk-register/staff ร่วมกับทะเบียนความเสี่ยง
const IT_ROLES = ['ADMIN', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT', 'IT_STAFF'];
const detail = { tags: ['IT'] };
const id = { params: t.Object({ id: t.Numeric() }) };
const itemId = { params: t.Object({ itemId: t.Numeric() }) };

export const itThirdPartyRoutes = new Elysia({ prefix: '/api/v1/it/third-party' })
    .use(authMiddleware)
    .use(requireRoles(...IT_ROLES))
    .get('/', listAssessments, { detail: { ...detail, summary: 'การประเมินความเสี่ยงบุคคลภายนอกทั้งหมด + จำนวนข้อและค่าเฉลี่ย' } })
    .post('/', createAssessment, { body: t.Any(), detail: { ...detail, summary: 'สร้างการประเมินใหม่จากแม่แบบ 10 หมวด (copy_from = ยกค่าจากการประเมินครั้งก่อน)' } })
    // /items/... ต้องมาก่อน /:id
    .put('/items/:itemId', updateItem, { ...itemId, body: t.Any(), detail: { ...detail, summary: 'แก้ไขข้อประเมิน' } })
    .delete('/items/:itemId', deleteItem, { ...itemId, detail: { ...detail, summary: 'ลบข้อประเมิน (เก็บค่าเดิมใน log)' } })
    .get('/:id', getAssessment, { ...id, detail: { ...detail, summary: 'หัวการประเมิน + ข้อประเมินทั้งหมด + หมวด' } })
    .put('/:id', updateAssessment, { ...id, body: t.Any(), detail: { ...detail, summary: 'แก้ไขหัวการประเมิน' } })
    .post('/:id/items', createItem, { ...id, body: t.Any(), detail: { ...detail, summary: 'เพิ่มข้อประเมินในหมวด (เลขข้อต่อท้ายหมวด)' } })
    .get('/:id/log', getAssessmentLog, { ...id, detail: { ...detail, summary: 'ประวัติการแก้ไข' } });
