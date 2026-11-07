import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
    cancelContract, cancelPayable, completeTask, createAmendment, createContract, createContractDocument, createContractVendor,
    createDefect, createGuarantee, createInspection, createPayable, createPayablePayment, decideReturn, getContractById, getContractMe, getContractMeta,
    getContractOverview, getContractReturns, getContractRules, getContracts, getContractUserOptions, getContractVendors,
    getGuarantees, getPayablePayments, getPayables, getVendorById, getWarrantyBoard, payoutGuarantee, proposeReturn, replaceContractStaff, updateContract, updateContractDocument,
    updateContractRule, updateContractVendor, updateDefect, updateGuarantee, updatePayable, voidPayablePayment,
} from '../controllers/contractGuaranteeController';

const TAG = 'ContractGuarantee';
const detail = { tags: [TAG] };
const idParam = { params: t.Object({ id: t.Numeric() }) };
// รายละเอียดฟิลด์ตรวจที่ controller เพื่อให้ตอบเป็นข้อความภาษาไทยชี้ช่องที่ผิด
const anyBody = t.Record(t.String(), t.Any());

export const contractGuaranteeRoutes = new Elysia({ prefix: '/api/v1/contracts' })
    .use(authMiddleware)
    .get('/me', getContractMe, { detail })
    .get('/overview', getContractOverview, { detail })
    .get('/meta', getContractMeta, { detail })
    .get('/warranty-board', getWarrantyBoard, { detail: { ...detail, description: 'วันหมดประกันสำหรับผู้บริหาร ไม่มียอดเงิน' } })
    .get('/user-options', getContractUserOptions, { query: t.Object({ search: t.Optional(t.String()) }), detail })
    .get('/rules', getContractRules, { detail })
    .put('/rules/:key', updateContractRule, { params: t.Object({ key: t.String() }), body: anyBody, detail: { ...detail, description: 'เฉพาะ ADMIN · ปรับกำหนดงานที่เปิดอยู่ใหม่ทุกสัญญา' } })

    .get('/vendors', getContractVendors, { detail })
    .get('/vendors/:id', getVendorById, { ...idParam, detail: { ...detail, description: 'ประวัติงาน เจ้าหนี้ และยอดค้างจ่ายของผู้รับจ้างรายนี้' } })
    .post('/vendors', createContractVendor, { body: anyBody, detail })
    .put('/vendors/:id', updateContractVendor, { ...idParam, body: anyBody, detail })

    .get('/payables', getPayables, { query: t.Object({ search: t.Optional(t.String()) }), detail })
    .post('/payables', createPayable, { body: anyBody, detail: { ...detail, description: 'เฉพาะการเงิน · ระบบอื่นผูกด้วย vendor_id + source_module/source_ref' } })
    .put('/payables/:id', updatePayable, { ...idParam, body: anyBody, detail })
    .post('/payables/:id/cancel', cancelPayable, { ...idParam, body: anyBody, detail: { ...detail, description: 'ยกเลิกได้เมื่อยังไม่มีการจ่าย' } })
    .post('/payables/:id/payments', createPayablePayment, { ...idParam, body: anyBody, detail: { ...detail, description: 'จ่ายได้หลายงวด ห้ามเกินยอดค้าง' } })
    .get('/payments', getPayablePayments, { query: t.Object({ from: t.Optional(t.String()), to: t.Optional(t.String()) }), detail: { ...detail, description: 'การจ่ายที่ยังมีผล กรองตามวันที่จ่าย' } })
    .post('/payments/:id/void', voidPayablePayment, { ...idParam, body: anyBody, detail: { ...detail, description: 'ยกเลิกการจ่าย ไม่ลบแถว' } })

    .get('/list', getContracts, { query: t.Object({ search: t.Optional(t.String()), duty: t.Optional(t.String()) }), detail })
    .post('/list', createContract, { body: anyBody, detail })
    .get('/list/:id', getContractById, { ...idParam, detail })
    .put('/list/:id', updateContract, { ...idParam, body: anyBody, detail })
    .post('/list/:id/cancel', cancelContract, { ...idParam, body: anyBody, detail })
    .post('/list/:id/amendments', createAmendment, { ...idParam, body: anyBody, detail: { ...detail, description: 'ตั้งวันหมดประกันใหม่ได้ และเตือนหลักประกันที่ไม่คุ้มระยะเวลาใหม่' } })
    .put('/list/:id/staff', replaceContractStaff, {
        ...idParam,
        body: t.Object({ staff: t.Array(t.Object({ duty: t.String(), user_id: t.Numeric(), backup_user_id: t.Optional(t.Nullable(t.Numeric())) })) }),
        detail,
    })
    .post('/list/:id/documents', createContractDocument, { ...idParam, body: anyBody, detail })
    .put('/documents/:id', updateContractDocument, { ...idParam, body: anyBody, detail })
    .post('/list/:id/inspections', createInspection, { ...idParam, body: anyBody, detail: { ...detail, description: 'เฉพาะกรรมการ/ผู้ควบคุมงาน/ผู้ครอบครองพัสดุของสัญญานั้น' } })
    .post('/list/:id/defects', createDefect, { ...idParam, body: anyBody, detail })
    .put('/defects/:id', updateDefect, { ...idParam, body: anyBody, detail })
    .post('/list/:id/returns', proposeReturn, { ...idParam, body: anyBody, detail: { ...detail, description: 'ต้องผ่านตรวจรอบสุดท้าย ไม่มีชำรุดค้าง และมีหลักประกัน' } })
    .get('/returns', getContractReturns, { query: t.Object({ status: t.Optional(t.String()) }), detail })
    .post('/returns/:id/decision', decideReturn, { ...idParam, body: anyBody, detail: { ...detail, description: 'เฉพาะ ผอ. หรือผู้อนุมัติของสัญญา · ผู้เสนอ/ผู้ตรวจอนุมัติเองไม่ได้' } })

    .get('/guarantees', getGuarantees, { query: t.Object({ search: t.Optional(t.String()) }), detail })
    .post('/list/:id/guarantees', createGuarantee, { ...idParam, body: anyBody, detail })
    .put('/guarantees/:id', updateGuarantee, { ...idParam, body: anyBody, detail })
    .post('/guarantees/:id/payout', payoutGuarantee, { ...idParam, body: anyBody, detail: { ...detail, description: 'ต้องได้รับอนุมัติคืนแล้ว · คืนครบทุกรายการแล้วปิดสัญญาอัตโนมัติ' } })

    .post('/tasks/:id/done', completeTask, { ...idParam, detail: { ...detail, description: 'ปิดเองได้เฉพาะงานที่ระบบไม่มีเหตุการณ์ให้จับ' } });
