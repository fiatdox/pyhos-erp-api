import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { createItem, createRegister, listStaff, deleteItem, getRegister, getRegisterLog, listRegisters, updateItem, updateRegister } from '../controllers/itRiskRegisterController';

// ทะเบียนความเสี่ยง (Risk Register) ปีงบประมาณละ 2 ครั้ง — เฉพาะเจ้าหน้าที่ IT (หน้าเว็บซ่อนเมนูและกั้น URL ด้วย)
const IT_ROLES = ['ADMIN', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT', 'IT_STAFF'];
const detail = { tags: ['IT'] };
const id = { params: t.Object({ id: t.Numeric() }) };
const itemId = { params: t.Object({ itemId: t.Numeric() }) };

export const itRiskRegisterRoutes = new Elysia({ prefix: '/api/v1/it/risk-register' })
    .use(authMiddleware)
    .use(requireRoles(...IT_ROLES))
    .get('/', listRegisters, { detail: { ...detail, summary: 'ทะเบียนความเสี่ยงทุกรอบ + จำนวนรายการและคะแนนเฉลี่ย' } })
    .post('/', createRegister, { body: t.Any(), detail: { ...detail, summary: 'สร้างทะเบียนรอบใหม่ (copy_from = ยกรายการที่ยัง Open จากทะเบียนรอบก่อน)' } })
    .get('/staff', listStaff, { detail: { ...detail, summary: 'บัญชีเจ้าหน้าที่ IT สำหรับเลือกเป็นผู้บันทึก (me = ผู้ใช้ปัจจุบัน)' } })
    // /items/... ต้องมาก่อน /:id
    .put('/items/:itemId', updateItem, { ...itemId, body: t.Any(), detail: { ...detail, summary: 'แก้ไขรายการความเสี่ยง' } })
    .delete('/items/:itemId', deleteItem, { ...itemId, detail: { ...detail, summary: 'ลบรายการความเสี่ยง (เก็บค่าเดิมใน log)' } })
    .get('/:id', getRegister, { ...id, detail: { ...detail, summary: 'หัวทะเบียน + รายการความเสี่ยงทั้งหมดของรอบ' } })
    .put('/:id', updateRegister, { ...id, body: t.Any(), detail: { ...detail, summary: 'แก้ไขหัวทะเบียน' } })
    .post('/:id/items', createItem, { ...id, body: t.Any(), detail: { ...detail, summary: 'เพิ่มรายการความเสี่ยง' } })
    .get('/:id/log', getRegisterLog, { ...id, detail: { ...detail, summary: 'ประวัติการแก้ไขทะเบียนและรายการ' } });
