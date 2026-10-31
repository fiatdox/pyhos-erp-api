import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { getLeaveTypes, getLeaveEntitlements, getLeaveEntitlementByUserTypeId, getMissionSupervisorByUserId, getMajorSupervisorByUserId, getSubMajorSupervisorByUserId, updateMissionSupervisor, updateMissionActingSupervisor, updateMajorSupervisor, updateMajorActingSupervisor, updateSubMajorSupervisor, updateSubMajorActingSupervisor, getDirector, updateDirector, updateActingDirector, getMissionHeadCheck, getLeaveApproverCheck, getLeaveTypesFull, updateLeaveType, updateLeaveEntitlement, createLeaveEntitlement, deleteLeaveEntitlement } from '../controllers/hrController';
import { getHrSummary, getStaffTypes, getPositions, getPositionBubbles, getExitReasons, getExitMonthly, getAgeGroups, getGenders, getMissionGroups, getHrPeople, getHrAgeIssues } from '../controllers/hrDashboardController';
import {
    createLeaveRequest, previewApprovalChain, getMyLeaveRequests, getPendingApprovals,
    approveLeaveRequest, rejectLeaveRequest, requestCancellation,
    approveCancellation, rejectCancellation, getLeaveRequestById, getLeavePrintData, getLeaveDocument, getStaffLeaveHistory, getLeaveSummary, getLeaveQuota, getLeaveCalendar,
    deleteLeaveRequest, updateLeaveRequest, getMyLeaveOverview, bulkApproveLeaveRequests, bulkApproveCancellations,
} from '../controllers/hrLeaveRequestController';
import { getLeaveRules } from '../services/leaveRules';
import { getLeaveAnalytics } from '../controllers/hrLeaveAnalyticsController';
import { getLegacyImportOptions, listLegacyImportRuns, getLegacyImportRun, startLegacyImportRun } from '../controllers/hrLegacyImportController';
import { getLeaveDayCount, getHolidays, createHoliday, updateHoliday, deleteHoliday, getLeaveDayCheck, verifyLeaveDays, adjustLeaveDays, cancelLeaveDayCheck } from '../controllers/hrLeaveDayController';
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
    // ประเภทการลาที่ผู้ล็อกอินลาได้ (กรองตามเพศในทะเบียนบุคลากร)
    .get('/leave-types', getLeaveTypes, {
        detail: { tags: ['HR'], summary: 'ประเภทการลาที่ผู้ล็อกอินลาได้', description: 'เฉพาะที่เปิดใช้งาน และตรงกับเพศในทะเบียน (ลาคลอด = หญิง, ลาช่วยภริยาคลอด = ชาย) ไม่ระบุเพศ = เห็นทุกประเภท' }
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
    // เช็คสิทธิ์เข้าหน้าอนุมัติการลาของผู้ใช้ที่ล็อกอินอยู่ (ใช้ user จาก JWT ไม่รับ param)
    .get('/leave-approver-check', getLeaveApproverCheck, {
        detail: {
            tags: ['HR'],
            summary: 'เช็คสิทธิ์เข้าหน้าอนุมัติการลา',
            description: 'is_approver = true เมื่อผู้ใช้เป็นหัวหน้า/รักษาการของกลุ่มภารกิจ, กลุ่มงาน หรือหน่วยงาน (หรือเป็น ผอ./รักษาการ ผอ./ADMIN) พร้อมคืนรายชื่อหน่วยที่ดูแล'
        }
    })
    // ดึงค่า ผอ. / รักษาการ ผอ. ปัจจุบัน
    .get('/director', getDirector, {
        detail: { tags: ['HR'], summary: 'ดึง ผอ. และรักษาการ ผอ. ปัจจุบัน', description: 'อ่านค่า director_id, acting_director_id จากตาราง hr_settings' }
    })
    // ── ใบลา ────────────────────────────────────────────────────────────────
    // ทุกเส้นทางใช้ user.id จาก JWT เสมอ ไม่รับ user_id จาก body
    // สิทธิ์กดอนุมัติเช็คจาก approval_chain ในใบ ไม่ได้เช็คจากตำแหน่งปัจจุบัน
    .get('/leave-requests/approval-chain', previewApprovalChain, {
        detail: { tags: ['HR'], summary: 'ดูสายอนุมัติของตัวเองก่อนยื่นใบลา' }
    })
    .get('/leave-requests/summary', getLeaveSummary, {
        query: t.Object({ from: t.Optional(t.String()), to: t.Optional(t.String()) }),
        detail: {
            tags: ['HR'],
            summary: 'สรุปรายการลาตามขอบเขตที่ผู้เรียกมีสิทธิ์เห็น',
            description: 'ADMIN/HR เห็นทุกคน · หัวหน้าเห็นเฉพาะหน่วยที่ตัวเองคุม · พนักงานทั่วไปเห็นเฉพาะของตัวเอง',
        }
    })
    .get('/leave-calendar', getLeaveCalendar, {
        query: t.Object({ from: t.String(), to: t.String(), scope: t.Optional(t.String()) }),
        detail: {
            tags: ['HR'],
            summary: 'ปฏิทินการลาตามขอบเขตที่ผู้เรียกมีสิทธิ์',
            description: 'scope: all (ADMIN/HR) · chain (ใบที่สายอนุมัติระบุรหัสของฉัน — หัวหน้า/รักษาการทุกระดับ และ ผอ. ซึ่งเห็นเฉพาะใบของหัวหน้ากลุ่มภารกิจ) · team (เพื่อนร่วมกลุ่มงาน — ซ่อนประเภทการลา) · me — ตอบ options ให้หน้าเว็บทำ select ช่วงไม่เกิน 62 วัน',
        }
    })
    .get('/leave-requests/quota', getLeaveQuota, {
        query: t.Object({ leave_type_id: t.String(), start_date: t.Optional(t.String()), user_id: t.Optional(t.String()) }),
        detail: { tags: ['HR'], summary: 'สิทธิ์วันลาคงเหลือของตัวเอง (ตามประเภทการลาและปีงบ)' }
    })
    .get('/leave-requests/overview', getMyLeaveOverview, {
        detail: { tags: ['HR'], summary: 'สรุปวันลาปีงบปัจจุบันของฉัน (ลาพักผ่อน ลากิจ ลาป่วย ลาคลอด)' }
    })
    .get('/leave-requests/mine', getMyLeaveRequests, {
        query: t.Object({ status: t.Optional(t.String()) }),
        detail: { tags: ['HR'], summary: 'ใบลาของฉัน' }
    })
    .get('/leave-requests/pending-approval', getPendingApprovals, {
        query: t.Object({ scope: t.Optional(t.String()) }),
        detail: {
            tags: ['HR'],
            summary: 'ใบลาที่รอฉันอนุมัติ',
            description: 'scope=pending (ค่าตั้งต้น) = เฉพาะที่รอขั้นของฉันตอนนี้ · scope=all = ใบที่ผ่านมือฉันทั้งหมด',
        }
    })
    .get('/leave-requests/:id/print', getLeavePrintData, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'ข้อมูลพิมพ์แบบใบลา (เจ้าของใบ / สายอนุมัติ / หัวหน้าหน่วยที่สังกัด / ADMIN / HR)' }
    })
    .get('/leave-requests/:id/document', getLeaveDocument, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'เปิดไฟล์แนบของใบลา (สิทธิ์เดียวกับการพิมพ์ใบลา)' }
    })
    .get('/leave-requests/:id', getLeaveRequestById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'รายละเอียดใบลา (เจ้าของใบ / ผู้อยู่ในสายอนุมัติ / ADMIN)' }
    })
    .put('/leave-requests/:id', updateLeaveRequest, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            leave_type_id: t.Numeric(),
            start_date: t.String({ minLength: 10, maxLength: 10 }),
            end_date: t.String({ minLength: 10, maxLength: 10 }),
            total_days: t.Numeric(),
            is_half_day: t.Optional(t.Boolean()),
            half_day_period: t.Optional(t.Nullable(t.String())),
            reason: t.Optional(t.Nullable(t.String())),
            substitute_user_id: t.Optional(t.Nullable(t.Numeric())),
            contact_info: t.Optional(t.Nullable(t.String())),
        }),
        detail: {
            tags: ['HR'],
            summary: 'แก้ไขใบลาของตัวเอง',
            description: 'แก้ได้เฉพาะใบ PENDING ที่ยังไม่มีผู้อนุมัติคนใดกด — ตรวจซ้อนทับ/สิทธิ์วันลา/เพศเหมือนตอนยื่น และคำนวณสายอนุมัติใหม่',
        }
    })
    .delete('/leave-requests/:id', deleteLeaveRequest, {
        params: t.Object({ id: t.Numeric() }),
        detail: {
            tags: ['HR'],
            summary: 'ลบใบลาของตัวเอง',
            description: 'ลบได้เฉพาะใบที่ยังไม่มีผู้อนุมัติคนใดกด — ถ้ามีการกดแล้วต้องใช้การถอนใบลาแทน',
        }
    })
    .post('/leave-requests', createLeaveRequest, {
        body: t.Object({
            // HR / ADMIN ยื่นแทนบุคลากร (เช่น ลาพักผ่อนย้อนหลัง) — ไม่ระบุ = ยื่นของตัวเอง
            user_id: t.Optional(t.Nullable(t.Numeric())),
            leave_type_id: t.Numeric(),
            start_date: t.String({ minLength: 10, maxLength: 10 }),
            end_date: t.String({ minLength: 10, maxLength: 10 }),
            total_days: t.Numeric(),
            is_half_day: t.Optional(t.Boolean()),
            half_day_period: t.Optional(t.Nullable(t.String())),
            reason: t.Optional(t.Nullable(t.String())),
            substitute_user_id: t.Optional(t.Nullable(t.Numeric())),
            contact_info: t.Optional(t.Nullable(t.String())),
            document_url: t.Optional(t.Nullable(t.String())),
        }),
        detail: { tags: ['HR'], summary: 'ยื่นใบลา' },
        error({ code, set }) {
            if (code === 'VALIDATION') {
                set.status = 400;
                return { success: false, message: 'ข้อมูลใบลาไม่ครบถ้วนหรือรูปแบบไม่ถูกต้อง' };
            }
        },
    })
    .post('/leave-requests/bulk/approve', bulkApproveLeaveRequests, {
        body: t.Object({ ids: t.Array(t.Numeric(), { minItems: 1, maxItems: 100 }), comment: t.Optional(t.Nullable(t.String())) }),
        detail: { tags: ['HR'], summary: 'อนุมัติใบลาแบบกลุ่ม (เฉพาะใบที่ถึงคิวผู้กด)' }
    })
    .post('/leave-requests/bulk/cancel-approve', bulkApproveCancellations, {
        body: t.Object({ ids: t.Array(t.Numeric(), { minItems: 1, maxItems: 100 }), comment: t.Optional(t.Nullable(t.String())) }),
        detail: { tags: ['HR'], summary: 'อนุมัติการยกเลิกใบลาแบบกลุ่ม (ขั้นสุดท้ายคืนวันลาทันที)' }
    })
    .post('/leave-requests/:id/approve', approveLeaveRequest, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ comment: t.Optional(t.Nullable(t.String())) }),
        detail: { tags: ['HR'], summary: 'อนุมัติใบลา (ขั้นที่ใบกำลังรออยู่)' }
    })
    .post('/leave-requests/:id/reject', rejectLeaveRequest, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ comment: t.String({ minLength: 1 }) }),
        detail: { tags: ['HR'], summary: 'ไม่อนุมัติใบลา (ต้องระบุเหตุผล)' },
        error({ code, set }) {
            if (code === 'VALIDATION') {
                set.status = 400;
                return { success: false, message: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' };
            }
        },
    })
    .post('/leave-requests/:id/cancel', requestCancellation, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ reason: t.Optional(t.Nullable(t.String())) }),
        detail: {
            tags: ['HR'],
            summary: 'ขอยกเลิกใบลา',
            description: 'ใบที่ยังไม่มีใครอนุมัติ = ถอนได้ทันที · ใบที่อนุมัติแล้ว = เข้าสายอนุมัติชุดเดิมอีกรอบ',
        }
    })
    .post('/leave-requests/:id/cancel/approve', approveCancellation, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ comment: t.Optional(t.Nullable(t.String())) }),
        detail: { tags: ['HR'], summary: 'อนุมัติการยกเลิกใบลา' }
    })
    .post('/leave-requests/:id/cancel/reject', rejectCancellation, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ comment: t.String({ minLength: 1 }) }),
        detail: { tags: ['HR'], summary: 'ไม่อนุมัติการยกเลิกใบลา' },
        error({ code, set }) {
            if (code === 'VALIDATION') {
                set.status = 400;
                return { success: false, message: 'กรุณาระบุเหตุผลที่ไม่อนุมัติการยกเลิก' };
            }
        },
    })

    // ── นับวันลา / วันหยุดราชการ (อ่านได้ทุกคน — ฟอร์มยื่นลาใช้เติมจำนวนวันให้อัตโนมัติ) ──
    .get('/leave-days/count', getLeaveDayCount, {
        query: t.Object({
            start_date: t.String(), end_date: t.String(),
            leave_type_id: t.Optional(t.String()), is_half_day: t.Optional(t.String()),
        }),
        detail: { tags: ['HR'], summary: 'นับจำนวนวันลาของช่วงวันที่', description: 'ประเภทที่นับวันทำการไม่นับเสาร์-อาทิตย์และวันหยุดราชการ (hr_holidays) · ลาครึ่งวันหัก 0.5' }
    })
    .get('/leave-rules', getLeaveRules, {
        detail: { tags: ['HR'], summary: 'ค่าตั้งของระบบลา', description: 'max_advance_days = ลาล่วงหน้าได้สูงสุดกี่วัน (env LEAVE_MAX_ADVANCE_DAYS ค่าเริ่มต้น 300)' }
    })
    .get('/holidays', getHolidays, {
        query: t.Object({ year: t.Optional(t.String()), from: t.Optional(t.String()), to: t.Optional(t.String()) }),
        detail: { tags: ['HR'], summary: 'วันหยุดราชการ', description: 'ระบุปี ค.ศ. (year) หรือช่วง from / to' }
    })

    // ── ตั้งค่ากำหนดสิทธิ์การลา / แต่งตั้งหัวหน้า — จำกัดเฉพาะ role ADMIN และ HR เท่านั้น ──
    // หมายเหตุ: requireRoles มีผลกับ route ที่ประกาศ "หลัง" บรรทัดนี้เท่านั้น (GET ด้านบนไม่โดน)
    .use(requireRoles('ADMIN', 'HR'))
    .get('/leave-analytics', getLeaveAnalytics, {
        query: t.Object({ fiscal_year: t.Optional(t.String()) }),
        detail: { tags: ['HR'], summary: 'วิเคราะห์การลาเชิงลึกรายปีงบ (ADMIN/HR)', description: 'ใบลารายใบ + บุคลากรต่อกลุ่มงาน + ยอดวันลาพักผ่อน — หน้าเว็บสรุปเอง' }
    })
    .get('/leave-requests/staff-history', getStaffLeaveHistory, {
        query: t.Object({
            fiscal_year: t.Optional(t.String()), leave_type_id: t.Optional(t.String()), status: t.Optional(t.String()),
            q: t.Optional(t.String()), has_document: t.Optional(t.String()), check: t.Optional(t.String()),
            page: t.Optional(t.String()), page_size: t.Optional(t.String()),
        }),
        detail: { tags: ['HR'], summary: 'ประวัติการลาเจ้าหน้าที่ทุกคน พร้อมรายละเอียดและไฟล์แนบ (ADMIN/HR)' }
    })
    // ── จัดการวันหยุดราชการ ────────────────────────────────────────────────
    .post('/holidays', createHoliday, {
        body: t.Object({
            holiday_date: t.String(), name_th: t.String(),
            holiday_type: t.Optional(t.String()), note: t.Optional(t.Nullable(t.String())),
        }),
        detail: { tags: ['HR'], summary: 'เพิ่มวันหยุดราชการ (ADMIN/HR)' }
    })
    .patch('/holidays/:id', updateHoliday, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            holiday_date: t.String(), name_th: t.String(),
            holiday_type: t.Optional(t.String()), note: t.Optional(t.Nullable(t.String())),
        }),
        detail: { tags: ['HR'], summary: 'แก้ไขวันหยุดราชการ (ADMIN/HR)' }
    })
    .delete('/holidays/:id', deleteHoliday, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'ลบวันหยุดราชการ (ADMIN/HR)', description: 'soft delete — is_active = false' }
    })
    // ── ตรวจจำนวนวันลาที่คร่อมวันหยุด ─────────────────────────────────────────
    // โอนข้อมูลจากโปรแกรมการลาเดิม — รันเบื้องหลัง ดูความคืบหน้า/รายงานจาก runs
    .get('/legacy-import/options', getLegacyImportOptions, {
        detail: { tags: ['HR'], summary: 'ตัวเลือกการโอนข้อมูลจากโปรแกรมการลาเดิม' }
    })
    .get('/legacy-import/runs', listLegacyImportRuns, {
        detail: { tags: ['HR'], summary: 'ประวัติการโอนข้อมูลจากโปรแกรมการลาเดิม (50 ครั้งล่าสุด)' }
    })
    .get('/legacy-import/runs/:id', getLegacyImportRun, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'รายละเอียด/รายงานของงานโอนข้อมูล' }
    })
    .post('/legacy-import/runs', startLegacyImportRun, {
        body: t.Object({
            kind: t.Union([t.Literal('LEAVE'), t.Literal('SERVICE_DATES')]),
            mode: t.Union([t.Literal('DRY_RUN'), t.Literal('COMMIT'), t.Literal('UNDO')]),
            fiscal_year: t.Optional(t.Numeric()),
            scope: t.Optional(t.Union([t.Literal('all'), t.Literal('mission'), t.Literal('user')])),
            mission_id: t.Optional(t.Nullable(t.Numeric())),
            user_id: t.Optional(t.Nullable(t.Numeric())),
            fill_hire_date: t.Optional(t.Boolean()),
        }),
        detail: {
            tags: ['HR'], summary: 'เริ่มงานโอนข้อมูลจากโปรแกรมการลาเดิม',
            description: 'LEAVE = ประวัติการลาปีงบที่เลือก · SERVICE_DATES = วันเริ่มงาน · DRY_RUN ทดลอง / COMMIT โอนจริง / UNDO ถอน (เฉพาะ LEAVE) · รันทีละงาน',
        }
    })
    .get('/leave-day-check', getLeaveDayCheck, {
        query: t.Object({ from: t.String(), to: t.String(), filter: t.Optional(t.String()) }),
        detail: { tags: ['HR'], summary: 'ใบลาที่ควรตรวจจำนวนวัน (ADMIN/HR)', description: 'filter: review (ค่าเริ่มต้น) | spans | mismatch | checked | all' }
    })
    .post('/leave-day-check/:id/verify', verifyLeaveDays, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ note: t.Optional(t.Nullable(t.String())) }),
        detail: { tags: ['HR'], summary: 'ยืนยันจำนวนวันลา (ADMIN/HR)' }
    })
    .post('/leave-day-check/:id/adjust', adjustLeaveDays, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({ total_days: t.Numeric(), note: t.String() }),
        detail: { tags: ['HR'], summary: 'แก้จำนวนวันลา (ADMIN/HR)', description: 'ปรับยอดวันลาที่หักไว้ตามส่วนต่างทันที' }
    })
    .post('/leave-day-check/:id/cancel', cancelLeaveDayCheck, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['HR'], summary: 'ยกเลิกผลการตรวจจำนวนวันลา (ADMIN/HR)', description: 'ล้างสถานะตรวจ — จำนวนวันที่เคยแก้คงไว้' }
    })
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
    })
    // HR Dashboard เชิงลึก — ข้อมูลรายบุคคล (ไม่ระบุตัวตน) แยกได้ถึงหน่วยงาน จึงอยู่หลัง requireRoles เหมือนกัน
    .get('/dashboard/people', getHrPeople, {
        detail: {
            tags: ['HR'], summary: 'HR Dashboard: ข้อมูลรายบุคคลแบบไม่ระบุตัวตน (ADMIN/HR)',
            description: 'บุคลากรปัจจุบัน + ผู้ที่ออกจากงาน: รหัสหน่วยงาน/ประเภท/ตำแหน่ง เพศ อายุ ปีงบเกษียณ ปีงบที่ออก พร้อมตารางชื่อ — หน้าเว็บสรุปตามตัวกรองเอง',
        },
    })
    // รายชื่อที่ข้อมูลอายุต้องแก้ (มีชื่อ + วันเกิด) — ADMIN/HR เท่านั้น
    .get('/dashboard/age-issues', getHrAgeIssues, {
        detail: {
            tags: ['HR'], summary: 'HR Dashboard: บุคลากรที่เลยปีงบเกษียณ / วันเกิดผิดปกติ (ADMIN/HR)',
            description: 'overdue = เลยปีงบเกษียณแต่ยังเป็นบุคลากรปัจจุบัน, implausible = อายุคำนวณได้นอกช่วง 18–70 ปี',
        },
    });
