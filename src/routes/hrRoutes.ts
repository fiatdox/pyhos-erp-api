import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getLeaveTypes, getLeaveEntitlements, getLeaveEntitlementByUserTypeId, getMissionSupervisorByUserId, getMajorSupervisorByUserId } from '../controllers/hrController';

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
    });

    
