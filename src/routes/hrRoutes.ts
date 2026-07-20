import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { getLeaveTypes, getLeaveEntitlements, getLeaveEntitlementByUserTypeId, getMissionSupervisorByUserId, getMajorSupervisorByUserId, getSubMajorSupervisorByUserId, updateMissionSupervisor, updateMissionActingSupervisor, updateMajorSupervisor, updateMajorActingSupervisor, updateSubMajorSupervisor, updateSubMajorActingSupervisor, getDirector, updateDirector, updateActingDirector, getMissionHeadCheck, getLeaveTypesFull, updateLeaveType, updateLeaveEntitlement, createLeaveEntitlement, deleteLeaveEntitlement } from '../controllers/hrController';
import { getHrSummary, getStaffTypes, getPositions, getPositionBubbles, getExitReasons, getExitMonthly, getAgeGroups, getGenders, getMissionGroups } from '../controllers/hrDashboardController';
import { getLeaveBalanceMeta, getLeaveBalances, createLeaveBalance, updateLeaveBalance, rolloverLeaveBalances } from '../controllers/hrLeaveBalanceController';

export const hrRoutes = new Elysia({ prefix: '/api/v1/hr' })
    .use(authMiddleware)
    // ── HR Dashboard (แยกตามชุดข้อมูล) ───────────────────────────────────────
    .get('/dashboard/summary', getHrSummary, {
        detail: { tags: ['HR'], summary: 'HR Dashboard: การ์ด KPI ภาพรวม', description: 'บุคลากรทั้งหมด / ปฏิบัติงาน / ออกจากงานปีนี้ / อัตราคงอยู่' }
    })
    .get('/dashboard/staff-types', getStaffTypes, {
        detail: { tags: ['HR'], summary: 'HR Dashboard: จำนวนบุคลากรตามประเภทเจ้าหน้าที่' }
    })
    .get('/dashboard/positions', getPositions, {
        detail: { tags: ['HR'], summary: 'HR Dashboard: จำนวนบุคลากรตามตำแหน่ง (top 12 + อื่นๆ)' }
    })
    .get('/dashboard/position-bubbles', getPositionBubbles, {
        detail: { tags: ['HR'], summary: 'HR Dashboard: Bubble chart ตามตำแหน่ง (จำนวน × อายุเฉลี่ย × สัดส่วนหญิง)' }
    })
    .get('/dashboard/exit-reasons', getExitReasons, {
        detail: { tags: ['HR'], summary: 'HR Dashboard: สาเหตุการออกจากงาน (ปีปัจจุบัน)' }
    })
    .get('/dashboard/exit-monthly', getExitMonthly, {
        detail: { tags: ['HR'], summary: 'HR Dashboard: การออกจากงานรายเดือน (ปีปัจจุบัน)' }
    })
    .get('/dashboard/age-groups', getAgeGroups, {
        detail: { tags: ['HR'], summary: 'HR Dashboard: ช่วงอายุบุคลากร' }
    })
    .get('/dashboard/genders', getGenders, {
        detail: { tags: ['HR'], summary: 'HR Dashboard: สัดส่วนเพศ' }
    })
    .get('/dashboard/mission-groups', getMissionGroups, {
        detail: { tags: ['HR'], summary: 'HR Dashboard: จำนวนบุคลากรตามกลุ่มภารกิจ' }
    })
    // ดึงรายการประเภทการลาทั้งหมด
    .get('/leave-types', getLeaveTypes, {
        detail: { tags: ['HR'], summary: 'ดึงรายการประเภทการลาทั้งหมด', description: 'ดึงข้อมูล id, code, name_th, gender_restriction, requires_document_after_days จากตาราง hr_leave_types' }
    })
    // ดึงสิทธิ์การลาตามประเภทพนักงาน
    .get('/leave-entitlements', getLeaveEntitlements, {
        detail: { tags: ['HR'], summary: 'ดึงสิทธิ์การลาตามประเภทพนักงาน', description: 'ดึงข้อมูล id, leave_type_id, user_type_id, max_days_per_year, min_service_months, carry_over, carry_over_max_days จากตาราง hr_leave_entitlements' }
    })
    // ดึงสิทธิ์การลาตาม user_type_id ที่ระบุ
    .get('/leave-entitlements/:user_type_id', getLeaveEntitlementByUserTypeId, {
        params: t.Object({ user_type_id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'ดึงสิทธิ์การลาตาม user_type_id', description: 'ดึงข้อมูลสิทธิ์การลาจากตาราง hr_leave_entitlements โดยกรองตาม user_type_id' }
    })
    // ดึงหัวหน้าภารกิจของพนักงานตาม user id
    .get('/mission-supervisor/:id', getMissionSupervisorByUserId, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'ดึงหัวหน้าภารกิจของพนักงาน', description: 'ดึงชื่อภารกิจและหัวหน้าภารกิจของพนักงานตาม user id' }
    })
    // ดึงหัวหน้ากลุ่มงานของพนักงานตาม user id
    .get('/major-supervisor/:id', getMajorSupervisorByUserId, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'ดึงหัวหน้ากลุ่มงานของพนักงาน', description: 'ดึงชื่อกลุ่มงานและหัวหน้ากลุ่มงานของพนักงานตาม user id' }
    })
    // ดึงหัวหน้าหน่วยงานของพนักงานตาม user id
    .get('/submajor-supervisor/:id', getSubMajorSupervisorByUserId, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'ดึงหัวหน้าหน่วยงานของพนักงาน', description: 'ดึงชื่อหน่วยงานและหัวหน้าหน่วยงานของพนักงานตาม user id' }
    })
    // เช็คว่า user เป็นหัวหน้า/รักษาการกลุ่มภารกิจหรือไม่ (ใช้ตัดสินสายอนุมัติการลา)
    .get('/mission-head-check/:id', getMissionHeadCheck, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'เช็คว่า user เป็นหัวหน้า/รักษาการกลุ่มภารกิจ', description: 'true ถ้า user เป็น supervisor_id หรือ acting_supervisor_id ของ missions ใด — การลาต้องเสนอ ผอ. โดยตรง' }
    })
    // ดึงค่า ผอ. / รักษาการ ผอ. ปัจจุบัน
    .get('/director', getDirector, {
        detail: { tags: ['HR'], summary: 'ดึง ผอ. และรักษาการ ผอ. ปัจจุบัน', description: 'อ่านค่า director_id, acting_director_id จากตาราง hr_settings' }
    })
    // ── ตั้งค่ากำหนดสิทธิ์การลา / แต่งตั้งหัวหน้า — จำกัดเฉพาะ role ADMIN และ HR เท่านั้น ──
    // หมายเหตุ: requireRoles มีผลกับ route ที่ประกาศ "หลัง" บรรทัดนี้เท่านั้น (GET ด้านบนไม่โดน)
    .use(requireRoles('ADMIN', 'HR'))
    // ── วันลาสะสม (ยกยอดปีงบประมาณ / ย้ายเข้าใส่ยอดยกมา) ──────────────────────
    .get('/leave-balances/meta', getLeaveBalanceMeta, {
        detail: { tags: ['HR'], summary: 'ปีงบประมาณปัจจุบัน + ปีที่มีข้อมูลวันลาสะสม' }
    })
    .get('/leave-balances', getLeaveBalances, {
        query: t.Object({
            fiscal_year: t.Optional(t.String()),
            leave_type_id: t.Numeric(),
            mission_id: t.Optional(t.String()),
            major_id: t.Optional(t.String()),
            submajor_id: t.Optional(t.String()),
            search: t.Optional(t.String()),
        }),
        detail: { tags: ['HR'], summary: 'รายการวันลาสะสม', description: 'กรองตามกลุ่มภารกิจ/กลุ่มงาน/หน่วยงาน/ชื่อ — ต้องระบุ leave_type_id' }
    })
    .post('/leave-balances', createLeaveBalance, {
        body: t.Object({
            user_id: t.Numeric(),
            leave_type_id: t.Numeric(),
            fiscal_year: t.Numeric(),
            carried_in: t.Optional(t.Numeric()),
            used: t.Optional(t.Numeric()),
            note: t.Optional(t.Nullable(t.String())),
        }),
        detail: { tags: ['HR'], summary: 'เพิ่มยอดวันลาสะสม (เช่น ข้าราชการย้ายมา)', description: 'entitled ถูก snapshot จาก hr_leave_entitlements อัตโนมัติตาม user_type + อายุงาน — 409 ถ้ามีข้อมูลปีงบนี้อยู่แล้ว' }
    })
    .patch('/leave-balances/:id', updateLeaveBalance, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Partial(t.Object({
            carried_in: t.Numeric(),
            entitled: t.Numeric(),
            used: t.Numeric(),
            note: t.Nullable(t.String()),
        })),
        detail: { tags: ['HR'], summary: 'แก้ไขยอดวันลาสะสม' }
    })
    .post('/leave-balances/rollover', rolloverLeaveBalances, {
        body: t.Object({
            from_fiscal_year: t.Numeric(),
            to_fiscal_year: t.Numeric(),
        }),
        detail: { tags: ['HR'], summary: 'ยกยอดวันลาสะสมขึ้นปีงบประมาณใหม่', description: 'ทำเฉพาะลาพักผ่อน (ANNUAL) เท่านั้น — คัดลอกคงเหลือ (cap ตาม carry_over_max_days ของแต่ละคน) จาก from → to — ข้ามคนที่มีข้อมูลปีใหม่อยู่แล้ว (กันกดซ้ำ)' }
    })
    // ดึงประเภทการลาทั้งหมดพร้อมฟิลด์ครบ (สำหรับหน้ากำหนดสิทธิ์การลา)
    .get('/leave-types/full', getLeaveTypesFull, {
        detail: { tags: ['HR'], summary: 'ดึงประเภทการลาทั้งหมด (ฟิลด์ครบ)', description: 'สำหรับหน้าตั้งค่ากำหนดสิทธิ์การลา — เฉพาะ ADMIN/HR' }
    })
    // แก้ไขเงื่อนไขพื้นฐานของประเภทการลา
    .patch('/leave-types/:id', updateLeaveType, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Partial(t.Object({
            name_th: t.String(),
            name_en: t.Nullable(t.String()),
            requires_document: t.Boolean(),
            requires_document_after_days: t.Nullable(t.Numeric()),
            requires_approval: t.Boolean(),
            gender_restriction: t.String(),
            is_paid: t.Boolean(),
            sort_order: t.Numeric(),
            is_active: t.Boolean(),
        })),
        detail: { tags: ['HR'], summary: 'แก้ไขเงื่อนไขประเภทการลา', description: 'อัปเดต hr_leave_types (ไม่รวม code/id)' }
    })
    // แก้ไขเกณฑ์สิทธิ์การลา 1 รายการ
    .patch('/leave-entitlements/:id', updateLeaveEntitlement, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Partial(t.Object({
            max_days_per_year: t.Nullable(t.Numeric()),
            min_service_months: t.Numeric(),
            carry_over: t.Boolean(),
            carry_over_max_days: t.Nullable(t.Numeric()),
        })),
        detail: { tags: ['HR'], summary: 'แก้ไขเกณฑ์สิทธิ์การลา', description: 'อัปเดต hr_leave_entitlements ตาม id' }
    })
    // เพิ่มเกณฑ์สิทธิ์การลาใหม่ (ประเภทเจ้าหน้าที่ที่ยังไม่มีเกณฑ์ หรือเพิ่ม tier ตามอายุงาน)
    .post('/leave-entitlements', createLeaveEntitlement, {
        body: t.Object({
            leave_type_id: t.Numeric(),
            user_type_id: t.Numeric(),
            max_days_per_year: t.Optional(t.Nullable(t.Numeric())),
            min_service_months: t.Optional(t.Numeric()),
            carry_over: t.Optional(t.Boolean()),
            carry_over_max_days: t.Optional(t.Nullable(t.Numeric())),
        }),
        detail: { tags: ['HR'], summary: 'เพิ่มเกณฑ์สิทธิ์การลา', description: 'เพิ่มแถวใหม่ใน hr_leave_entitlements' }
    })
    // ลบเกณฑ์สิทธิ์การลา
    .delete('/leave-entitlements/:id', deleteLeaveEntitlement, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'ลบเกณฑ์สิทธิ์การลา', description: 'ลบแถวออกจาก hr_leave_entitlements ตาม id' }
    })
    // แต่งตั้ง/ถอดถอน ผอ.
    .patch('/director/supervisor', updateDirector, {
        body: t.Object({ supervisor_id: t.Nullable(t.Numeric()) }),
        detail: { tags: ['HR'], summary: 'แต่งตั้ง/ถอดถอนผู้อำนวยการ', description: 'อัปเดต hr_settings key director_id (null = ถอดถอน) — 409 ถ้าบุคคลนั้นเป็นรักษาการ ผอ. อยู่' }
    })
    // แต่งตั้ง/ถอดถอนรักษาการ ผอ.
    .patch('/director/acting-supervisor', updateActingDirector, {
        body: t.Object({ acting_supervisor_id: t.Nullable(t.Numeric()) }),
        detail: { tags: ['HR'], summary: 'แต่งตั้ง/ถอดถอนรักษาการผู้อำนวยการ', description: 'อัปเดต hr_settings key acting_director_id (null = ถอดถอน) — 409 ถ้าบุคคลนั้นเป็น ผอ. อยู่' }
    })
    // อัปเดตหัวหน้าภารกิจ
    .patch('/missions/:id/supervisor', updateMissionSupervisor, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ supervisor_id: t.Nullable(t.Numeric()) }),
        detail: { tags: ['HR'], summary: 'อัปเดตหัวหน้าภารกิจ', description: 'แก้ไข supervisor_id ในตาราง missions ตาม mission_id' }
    })
    // อัปเดตรักษาการภารกิจ
    .patch('/missions/:id/acting-supervisor', updateMissionActingSupervisor, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ acting_supervisor_id: t.Nullable(t.Numeric()) }),
        detail: { tags: ['HR'], summary: 'อัปเดตรักษาการภารกิจ', description: 'แก้ไข acting_supervisor_id ในตาราง missions ตาม mission_id' }
    })
    // อัปเดตหัวหน้ากลุ่มงาน
    .patch('/majors/:id/supervisor', updateMajorSupervisor, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ supervisor_id: t.Nullable(t.Numeric()) }),
        detail: { tags: ['HR'], summary: 'อัปเดตหัวหน้ากลุ่มงาน', description: 'แก้ไข supervisor_id ในตาราง majors ตาม major_id' }
    })
    // อัปเดตรักษาการกลุ่มงาน
    .patch('/majors/:id/acting-supervisor', updateMajorActingSupervisor, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ acting_supervisor_id: t.Nullable(t.Numeric()) }),
        detail: { tags: ['HR'], summary: 'อัปเดตรักษาการกลุ่มงาน', description: 'แก้ไข acting_supervisor_id ในตาราง majors ตาม major_id' }
    })
    // อัปเดตหัวหน้าหน่วยงาน
    .patch('/submajors/:id/supervisor', updateSubMajorSupervisor, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ supervisor_id: t.Nullable(t.Numeric()) }),
        detail: { tags: ['HR'], summary: 'อัปเดตหัวหน้าหน่วยงาน', description: 'แก้ไข supervisor_id ในตาราง submajors ตาม submajor_id' }
    })
    // อัปเดตรักษาการหน่วยงาน
    .patch('/submajors/:id/acting-supervisor', updateSubMajorActingSupervisor, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ acting_supervisor_id: t.Nullable(t.Numeric()) }),
        detail: { tags: ['HR'], summary: 'อัปเดตรักษาการหน่วยงาน', description: 'แก้ไข acting_supervisor_id ในตาราง submajors ตาม submajor_id' }
    });

    
