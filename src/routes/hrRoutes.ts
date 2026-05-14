import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getLeaveTypes, getLeaveEntitlements, getLeaveEntitlementByUserTypeId, getMissionSupervisorByUserId, getMajorSupervisorByUserId, getSubMajorSupervisorByUserId, updateMissionSupervisor, updateMissionActingSupervisor, updateMajorSupervisor, updateMajorActingSupervisor, updateSubMajorSupervisor, updateSubMajorActingSupervisor } from '../controllers/hrController';

export const hrRoutes = new Elysia({ prefix: '/api/v1/hr' })
    .use(authMiddleware)
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

    
