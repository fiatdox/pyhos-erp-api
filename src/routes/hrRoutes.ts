import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { getLeaveTypes, getLeaveEntitlements, getLeaveEntitlementByUserTypeId, getMissionSupervisorByUserId, getMajorSupervisorByUserId, getSubMajorSupervisorByUserId, updateMissionSupervisor, updateMissionActingSupervisor, updateMajorSupervisor, updateMajorActingSupervisor, updateSubMajorSupervisor, updateSubMajorActingSupervisor } from '../controllers/hrController';
import { getHrSummary, getStaffTypes, getPositions, getPositionBubbles, getExitReasons, getExitMonthly, getAgeGroups, getGenders, getMissionGroups } from '../controllers/hrDashboardController';

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
    // ── แต่งตั้ง/ถอดถอนหัวหน้า — จำกัดเฉพาะ role ADMIN และ HR เท่านั้น ──────────
    // หมายเหตุ: requireRoles มีผลกับ route ที่ประกาศ "หลัง" บรรทัดนี้เท่านั้น (GET ด้านบนไม่โดน)
    .use(requireRoles('ADMIN', 'HR'))
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

    
