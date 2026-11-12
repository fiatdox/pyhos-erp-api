import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getAllowanceLog, getAllowanceMeta, getAllowances, getAllowanceTierLog, setAllowances, updateAllowanceTier } from '../controllers/hrdTravelController';
import { createRoute, deleteRoute, getTransport, getTransportLog, updateRoute, updateVehicleRate } from '../controllers/hrdTravelTransportController';
import {
    approveRequest, cancelRequest, createRequest, getApprovalCount, getHrdTasks, getRequestById, getRequestMeta, getRequests, getTravelerStats, getTravelHistory,
    recordActual, recordDirector, rejectRequest, searchTravelPeople, updateRequest,
} from '../controllers/hrdTravelRequestController';
import { createBudget, createBudgetType, getBudgetDashboard, getBudgetLog, getBudgets, getBudgetTypes, updateBudget, updateBudgetType } from '../controllers/hrdTravelBudgetController';
import { deleteLodgingPerson, getLodging, getLodgingLog, setLodgingLevel, setLodgingPerson, updateLodgingClass } from '../controllers/hrdTravelLodgingController';
import { getSignModeLog, getSignModes, setSignMode } from '../controllers/hrdTravelSignModeController';

const anyBody = t.Record(t.String(), t.Any());

// เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — สิทธิ์ตรวจที่ controller (ADMIN / HRD)
const detail = { tags: ['HrdTravel'] };
const idParam = { params: t.Object({ id: t.Numeric() }) };

export const hrdTravelRoutes = new Elysia({ prefix: '/api/v1/hrd/travel' })
    .use(authMiddleware)
    .get('/allowance/meta', getAllowanceMeta, { detail: { ...detail, description: 'อัตราเบี้ยเลี้ยงพร้อมราคา และหน่วยงานสำหรับตัวกรอง' } })
    .get('/allowance', getAllowances, {
        query: t.Object({
            search: t.Optional(t.String()), tier_id: t.Optional(t.String()),
            mission_id: t.Optional(t.String()), major_id: t.Optional(t.String()), submajor_id: t.Optional(t.String()),
            user_type_id: t.Optional(t.String()), user_level_id: t.Optional(t.String()),
            limit: t.Optional(t.String()), offset: t.Optional(t.String()),
        }),
        detail: { ...detail, description: 'บุคลากรสถานะปฏิบัติงาน พร้อมอัตราเบี้ยเลี้ยง (ไม่ได้ตั้ง = อัตราค่าเริ่มต้น)' },
    })
    .put('/allowance', setAllowances, {
        body: t.Object({
            tier_id: t.Numeric(),
            user_ids: t.Optional(t.Array(t.Numeric())),
            filter: t.Optional(t.Record(t.String(), t.Any())),
            expected_total: t.Optional(t.Numeric()),
        }),
        detail: { ...detail, description: 'ย้ายอัตราให้คนที่เลือก (user_ids ≤ 500) หรือทั้งหมดที่กรอง (filter + expected_total) · เก็บประวัติทุกครั้ง' },
    })
    .get('/allowance/:id/log', getAllowanceLog, { ...idParam, detail })
    .put('/allowance/tiers/:id', updateAllowanceTier, {
        ...idParam,
        body: t.Object({ amount: t.Numeric(), name: t.Optional(t.String()) }),
        detail: { ...detail, description: 'แก้ราคา/ชื่ออัตรา · มีผลกับทุกคนในอัตรานี้ทันที · เก็บประวัติ' },
    })
    .get('/allowance/tiers/:id/log', getAllowanceTierLog, { ...idParam, detail })

    // ตั้งค่าการเดินทาง — อ่านได้ทุกคนที่ล็อกอิน (แบบฟอร์มขอไปราชการใช้เพดานราคา) แก้ไขเฉพาะ ADMIN / HRD
    .get('/transport', getTransport, { detail: { ...detail, description: 'อัตราค่าน้ำมันบาท/กม. และเพดานราคารถโดยสาร/เครื่องบินตามเส้นทาง' } })
    .get('/transport/log', getTransportLog, {
        query: t.Object({ entity: t.Optional(t.String()), id: t.Optional(t.String()), mode: t.Optional(t.String()) }),
        detail: { ...detail, description: 'ประวัติการแก้ไขอัตรา/เส้นทาง' },
    })
    .put('/transport/vehicles/:id', updateVehicleRate, {
        ...idParam, body: t.Object({ rate_per_km: t.Numeric(), name: t.Optional(t.String()) }),
        detail: { ...detail, description: 'แก้อัตราค่าน้ำมันบาท/กม. ของประเภทรถ' },
    })
    .post('/transport/routes', createRoute, { body: t.Record(t.String(), t.Any()), detail: { ...detail, description: 'เพิ่มเส้นทาง bus/plane · ห้ามซ้ำไม่ว่าทิศไหน' } })
    .put('/transport/routes/:id', updateRoute, { ...idParam, body: t.Record(t.String(), t.Any()), detail })
    .post('/transport/routes/:id/delete', deleteRoute, { ...idParam, detail: { ...detail, description: 'ปิดใช้งานเส้นทาง (ไม่ลบแถว)' } })

    // ตั้งค่าค่าเช่าที่พัก — ADMIN / HRD (แบบฟอร์มได้อัตรารายคนจาก /requests/meta และ /requests/people)
    .get('/lodging', getLodging, { detail: { ...detail, description: 'ระดับสิทธิ์ที่พัก (เหมาจ่าย/ห้องเดี่ยว/ห้องคู่/ชั้นเครื่องบิน) การจับคู่ระดับตำแหน่ง และกำหนดรายบุคคล' } })
    .get('/lodging/log', getLodgingLog, { query: t.Object({ entity: t.Optional(t.String()), id: t.Optional(t.String()) }), detail })
    .put('/lodging/classes/:id', updateLodgingClass, { ...idParam, body: anyBody, detail: { ...detail, description: 'แก้ชื่อ/อัตราของระดับสิทธิ์ที่พัก · มีผลกับคำขอใหม่' } })
    .put('/lodging/levels/:id', setLodgingLevel, { ...idParam, body: anyBody, detail: { ...detail, description: 'จับคู่ระดับตำแหน่ง → ระดับสิทธิ์ที่พัก (class_id null = ค่าเริ่มต้น)' } })
    .post('/lodging/people', setLodgingPerson, { body: anyBody, detail: { ...detail, description: 'กำหนดระดับสิทธิ์ที่พักรายบุคคล (ยกเว้นจากระดับตำแหน่ง)' } })
    .post('/lodging/people/:id/delete', deleteLodgingPerson, { ...idParam, detail: { ...detail, description: 'เลิกกำหนดรายบุคคล กลับไปใช้ตามระดับตำแหน่ง' } })

    // โหมดการลงนามตามกลุ่ม (ลงนามในระบบ / เดินเอกสาร) — ADMIN / HRD
    .get('/sign-modes', getSignModes, { detail: { ...detail, description: 'ค่าเริ่มต้น + โหมดที่ตั้งรายกลุ่มภารกิจ/กลุ่มงาน (null = ตามระดับบน)' } })
    .get('/sign-modes/log', getSignModeLog, { detail })
    .put('/sign-modes', setSignMode, { body: anyBody, detail: { ...detail, description: 'body { unit_type: default|mission|major, unit_id, mode: esign|paper|null } · มีผลกับคำขอที่ยื่น/แก้ไขหลังจากนี้' } })

    // คำขออนุมัติเดินทางไปราชการ — ทุกคนยื่นได้ · ยอดเงินคำนวณ/ตรวจที่ server
    .get('/requests/meta', getRequestMeta, { detail: { ...detail, description: 'ข้อมูลตั้งต้นแบบฟอร์ม: ผู้ขอ อัตราเบี้ยเลี้ยง ประเภทรถ เส้นทาง งบประมาณ' } })
    .get('/requests/people', searchTravelPeople, {
        query: t.Object({ search: t.Optional(t.String()), ids: t.Optional(t.String()), fiscal_year: t.Optional(t.String()), except_id: t.Optional(t.String()) }),
        detail: { ...detail, description: 'ค้นหาผู้ร่วมเดินทางพร้อมอัตราเบี้ยเลี้ยง และจำนวนครั้งที่ไปราชการในปีงบ' },
    })
    .get('/requests/travel-history', getTravelHistory, {
        query: t.Object({ user_id: t.Optional(t.String()), fiscal_year: t.Optional(t.String()) }),
        detail: { ...detail, description: 'ประวัติการไปราชการรายบุคคลในปีงบ — ADMIN/HRD ดูได้ทุกคน คนอื่นดูของตัวเอง' },
    })
    .get('/requests/traveler-stats', getTravelerStats, {
        query: t.Object({ fiscal_year: t.Optional(t.String()), search: t.Optional(t.String()), limit: t.Optional(t.String()), offset: t.Optional(t.String()) }),
        detail: { ...detail, description: 'สรุปรายบุคคลในปีงบ (ครั้ง/วัน/เบี้ยเลี้ยง) — ADMIN/HRD' },
    })
    .get('/requests/hrd-tasks', getHrdTasks, { detail: { ...detail, description: 'งานที่ต้องดำเนินการของ HRD: รอบันทึกผล ผอ. · รอยอดการเงิน · ใกล้เดินทางแต่ยังไม่อนุมัติ · งบที่เกินวงเงิน (ADMIN/HRD)' } })
    .get('/requests/approvals/count', getApprovalCount, { detail: { ...detail, description: 'จำนวนคำขอที่รอผู้ใช้อนุมัติ และเคยอยู่ในสายอนุมัติหรือไม่' } })
    .get('/requests', getRequests, {
        query: t.Object({
            scope: t.Optional(t.String()), search: t.Optional(t.String()), status: t.Optional(t.String()), pending: t.Optional(t.String()), task: t.Optional(t.String()),
            limit: t.Optional(t.String()), offset: t.Optional(t.String()),
        }),
        detail: { ...detail, description: 'scope=mine (ของฉัน/ร่วมเดินทาง) · scope=approve (รอฉันอนุมัติ/อยู่ในสาย · pending=1 เฉพาะที่รอ) · scope=all เฉพาะ ADMIN/HRD (task=director|actual|soon = งานที่ต้องดำเนินการ)' },
    })
    .get('/requests/:id', getRequestById, { ...idParam, detail: { ...detail, description: 'คำขอ + ผู้เดินทาง + ผู้ลงนามตามผัง (พิมพ์ PDF)' } })
    .post('/requests', createRequest, { body: anyBody, detail: { ...detail, description: 'ยื่นคำขอ · ยอดเงินเกินคงเหลือของงบไม่ได้' } })
    .put('/requests/:id', updateRequest, { ...idParam, body: anyBody, detail: { ...detail, description: 'ผู้ขอแก้ไข (ยังไม่ยกเลิก/ยังไม่บันทึกเบิกจ่ายจริง)' } })
    .post('/requests/:id/cancel', cancelRequest, { ...idParam, body: anyBody, detail: { ...detail, description: 'ยกเลิก = คืนยอดจองให้งบ' } })
    .post('/requests/:id/approve', approveRequest, { ...idParam, body: anyBody, detail: { ...detail, description: 'ผู้อนุมัติขั้นปัจจุบันอนุมัติพร้อมลายเซ็น (ต้องตั้งลายเซ็นก่อน) · ขั้นสุดท้าย → รอ ผอ. ลงนามบนกระดาษ' } })
    .post('/requests/:id/reject', rejectRequest, { ...idParam, body: anyBody, detail: { ...detail, description: 'ไม่อนุมัติ (ต้องมีเหตุผล) พร้อมลายเซ็น = จบคำขอ' } })
    .post('/requests/:id/director', recordDirector, { ...idParam, body: anyBody, detail: { ...detail, description: 'ADMIN/HRD บันทึกผลคำสั่ง ผอ. ตามบันทึกข้อความที่ลงนามจริง' } })
    .put('/requests/:id/actual', recordActual, { ...idParam, body: anyBody, detail: { ...detail, description: 'ADMIN/HRD บันทึกเบิกจ่ายจริง (null = ล้าง) — ตัดงบด้วยยอดจริง' } })

    // งบประมาณ + dashboard — ADMIN / HRD
    .get('/budgets', getBudgets, { query: t.Object({ fiscal_year: t.Optional(t.String()) }), detail })
    .get('/budgets/dashboard', getBudgetDashboard, {
        query: t.Object({
            fiscal_year: t.Optional(t.String()), budget_id: t.Optional(t.String()), budget_type: t.Optional(t.String()),
            mission_id: t.Optional(t.String()), major_id: t.Optional(t.String()), user_id: t.Optional(t.String()), status: t.Optional(t.String()),
        }),
        detail: { ...detail, description: 'ภาพรวมงบ + เจาะลึกตามตัวกรอง: รายงบ รายเดือน กลุ่มงาน รายบุคคล รายการคำขอ (ยอดรายคน = เบี้ยเลี้ยงของคนนั้น + ค่าใช้จ่ายร่วมหารเท่ากัน)' },
    })
    .post('/budgets', createBudget, { body: anyBody, detail })
    .put('/budgets/:id', updateBudget, { ...idParam, body: anyBody, detail: { ...detail, description: 'ลดวงเงินต่ำกว่ายอดที่ใช้ไม่ได้' } })
    .get('/budgets/:id/log', getBudgetLog, { ...idParam, detail })
    // ประเภทงบ (ช่องที่ติ๊กในบันทึกข้อความ) — อ่านได้ทุกคน · เพิ่ม/แก้ ADMIN / HRD
    .get('/budget-types', getBudgetTypes, { detail: { ...detail, description: 'ประเภทงบทั้งหมด (รวมที่ปิดใช้) + จำนวนงบที่ใช้ประเภทนั้น' } })
    .post('/budget-types', createBudgetType, { body: anyBody, detail: { ...detail, description: 'เพิ่มประเภท — ระบบตั้งรหัสภายในให้ (t4, t5, ...) · ref_code = รหัสงบของการเงิน เช่น P20' } })
    .put('/budget-types/:code', updateBudgetType, { params: t.Object({ code: t.String() }), body: anyBody, detail: { ...detail, description: 'แก้ชื่อ / รหัสงบ / ข้อความหน้าชื่องบ / ลำดับ / เปิด-ปิดใช้ (ไม่มีลบ)' } });
