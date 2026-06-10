import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getEquipmentTypes, getEquipmentTypeById, getProblemCategories, getProblemCategoryById, getPriorityLevels, getPriorityLevelById, getProcessStatuses, getProcessStatusById, getProcessStatusesByIds, createRepairRequest, getRepairRequests, getAllRepairRequests, getRepairRequestImages, getRepairRequestImageFile, receiveAssignment, rejectAssignment, getRepairAssessments, getRepairAssessmentById, updateRepairAssessment } from '../controllers/itController';

export const itRoutes = new Elysia({ prefix: '/api/v1/it' })
    .use(authMiddleware)
    // ดึงรายการประเภทอุปกรณ์ IT ทั้งหมด
    .get('/equipment-types', getEquipmentTypes, {
        detail: { tags: ['IT'], summary: 'ดึงรายการประเภทอุปกรณ์ IT ทั้งหมด', description: 'ดึงข้อมูล id, name จากตาราง it_equipment_types' }
    })
    // ดึงประเภทอุปกรณ์ IT ตาม id
    .get('/equipment-types/:id', getEquipmentTypeById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT'], summary: 'ดึงประเภทอุปกรณ์ IT ตาม id', description: 'ดึงข้อมูล id, name จากตาราง it_equipment_types ตาม id' }
    })
    // ดึงรายการหมวดหมู่ปัญหา IT ทั้งหมด
    .get('/problem-categories', getProblemCategories, {
        detail: { tags: ['IT'], summary: 'ดึงรายการหมวดหมู่ปัญหา IT ทั้งหมด', description: 'ดึงข้อมูล it_problem_category_id, name, desc จากตาราง it_problem_category' }
    })
    // ดึงหมวดหมู่ปัญหา IT ตาม id
    .get('/problem-categories/:id', getProblemCategoryById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT'], summary: 'ดึงหมวดหมู่ปัญหา IT ตาม id', description: 'ดึงข้อมูล it_problem_category_id, name, desc จากตาราง it_problem_category ตาม id' }
    })
    // ดึงรายการระดับความสำคัญ IT ทั้งหมด
    .get('/priority-levels', getPriorityLevels, {
        detail: { tags: ['IT'], summary: 'ดึงรายการระดับความสำคัญ IT ทั้งหมด', description: 'ดึงข้อมูล it_priority_level_id, name, description, response_days, display_order จากตาราง it_priority_levels เฉพาะที่ is_active = Y' }
    })
    // ดึงระดับความสำคัญ IT ตาม id
    .get('/priority-levels/:id', getPriorityLevelById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT'], summary: 'ดึงระดับความสำคัญ IT ตาม id', description: 'ดึงข้อมูล it_priority_level_id, name, description, response_days, display_order จากตาราง it_priority_levels ตาม id เฉพาะที่ is_active = Y' }
    })
    // ดึงรายการสถานะกระบวนการ IT ทั้งหมด
    .get('/process-statuses', getProcessStatuses, {
        detail: { tags: ['IT'], summary: 'ดึงรายการสถานะกระบวนการ IT ทั้งหมด' }
    })
    // ดึงสถานะกระบวนการ IT หลายรายการ เช่น ?ids=1,2,3
    .get('/process-statuses/by-ids', getProcessStatusesByIds, {
        query: t.Object({ ids: t.String() }),
        detail: { tags: ['IT'], summary: 'ดึงสถานะกระบวนการ IT หลายรายการ', description: 'ส่ง ?ids=1,2,3' }
    })
    // ดึงสถานะกระบวนการ IT ตาม id
    .get('/process-statuses/:id', getProcessStatusById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT'], summary: 'ดึงสถานะกระบวนการ IT ตาม id' }
    })
    // ดึงรายการซ่อมทั้งหมด ย้อนหลัง 1 ปี หรือกรองตามช่วงวันที่
    .post('/repair-requests/all', getAllRepairRequests, {
        body: t.Object({
            date1: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
            date2: t.Optional(t.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
            status: t.Optional(t.Union([t.Array(t.Numeric()), t.String()])),
        }),
        detail: {
            tags: ['IT'],
            summary: 'ดึงรายการซ่อมทั้งหมด',
            description: 'ค่าเริ่มต้นย้อนหลัง 1 ปี หรือส่ง { date1, date2 } รูปแบบ YYYY-MM-DD เพื่อกำหนดช่วงเอง',
        },
    })
    // ดึงรายการคำร้องซ่อมคอมพิวเตอร์ (กรอง status ได้ เช่น ?status=1,2,3)
    .get('/repair-requests', getRepairRequests, {
        query: t.Object({ status: t.Optional(t.String()) }),
        detail: {
            tags: ['IT'],
            summary: 'ดึงรายการคำร้องซ่อมคอมพิวเตอร์',
            description: 'ส่ง ?status=1 หรือ ?status=1,2,3 เพื่อกรองตาม process_status_id ถ้าไม่ส่งจะดึงทั้งหมด',
        },
    })
    // บันทึกคำร้องงานซ่อมคอมพิวเตอร์
    .post('/repair-requests', createRepairRequest, {
        body: t.Object({
            equipment_number: t.String({ minLength: 1 }),
            equipment_name: t.String({ minLength: 1 }),
            it_equipment_type_id: t.Numeric(),
            brand: t.Optional(t.String()),
            location: t.String({ minLength: 1 }),
            unit_price: t.Optional(t.Numeric()),
            company_name: t.Optional(t.String()),
            budget_year: t.Optional(t.String({ maxLength: 4 })),
            problem_category_id: t.Numeric(),
            problem_description: t.String({ minLength: 1 }),
            it_priority_level_id: t.Numeric(),
            images: t.Optional(t.Union([t.File(), t.Array(t.File())])),
        }),
        detail: {
            tags: ['IT'],
            summary: 'บันทึกคำร้องงานซ่อมคอมพิวเตอร์',
            description: 'บันทึกลงตาราง it_repair_requests และ it_repair_request_images (รูป 0-3 ภาพ) รับข้อมูลเป็น multipart/form-data',
        },
    })
    // ดึงรายการภาพทั้งหมดตาม it_repair_request_id
    .get('/repair-requests/:id/images', getRepairRequestImages, {
        params: t.Object({ id: t.Numeric() }),
        detail: {
            tags: ['IT'],
            summary: 'ดึงรายการภาพตาม it_repair_request_id',
            description: 'ดึงข้อมูล it_repair_request_image_id, attach_file_name, created_at, created_by จากตาราง it_repair_request_images',
        },
    })
    // ดึงรายการผลการประเมินซ่อมทั้งหมด
    .get('/repair-assessments', getRepairAssessments, {
        detail: {
            tags: ['IT'],
            summary: 'ดึงรายการผลการประเมินซ่อมทั้งหมด',
            description: 'ดึงข้อมูลจากตาราง repair_assessments เฉพาะที่ is_active = Y',
        },
    })
    // ดึงผลการประเมินซ่อมตาม id
    .get('/repair-assessments/:id', getRepairAssessmentById, {
        params: t.Object({ id: t.Numeric() }),
        detail: {
            tags: ['IT'],
            summary: 'ดึงผลการประเมินซ่อมตาม id',
            description: 'ดึงข้อมูลจากตาราง repair_assessments ตาม repair_assessment_id',
        },
    })
    // อัปเดตผลการประเมินซ่อม
    .patch('/repair-requests/:id/assessment', updateRepairAssessment, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            repair_assessment_id: t.Numeric({ minimum: 1, maximum: 5 }),
            assessment_detail: t.String({ minLength: 1 }),
            parts_used: t.Optional(t.String()),
            replacement_recommendation: t.Optional(t.String()),
            return_status_id: t.Optional(t.Numeric({ minimum: 1, maximum: 2 })),
            external_service_detail: t.Optional(t.String()),
        }),
        detail: {
            tags: ['IT'],
            summary: 'อัปเดตผลการประเมินซ่อม',
            description: 'อัปเดต repair_assessment_id, assessment_detail และฟิวด์เสริมตามประเภท (id=2,3 ต้องมี parts_used; id=4 ต้องมี replacement_recommendation+return_status_id; id=5 ต้องมี external_service_detail)',
        },
    })
    // รับมอบหมายงานซ่อม (assign ตัวเอง + เพิ่ม track กำลังดำเนินการ)
    .patch('/repair-requests/:id/receive-assignment', receiveAssignment, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Optional(t.Object({
            estimated_days: t.Optional(t.Nullable(t.Numeric())),
            estimated_completion_date: t.Optional(t.Nullable(t.String())),
            technician_priority_id: t.Optional(t.Nullable(t.Numeric())),
        })),
        detail: {
            tags: ['IT'],
            summary: 'รับมอบหมายงานซ่อม',
            description: 'อัปเดต assign_to, assign_datetime, estimated_days, estimated_completion_date ใน it_repair_requests และเพิ่ม track (process_status_id = 2 กำลังดำเนินการ) — estimated_days/estimated_completion_date เป็น optional',
        },
    })
    // ปฏิเสธงานซ่อม (process_status_id = 10 ปฏิเสธ + ใส่เหตุผลลง track)
    .patch('/repair-requests/:id/reject-assignment', rejectAssignment, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            reject_reason: t.String({ minLength: 1 }),
        }),
        detail: {
            tags: ['IT'],
            summary: 'ปฏิเสธงานซ่อม',
            description: 'อัปเดต process_status_id = 10 (ปฏิเสธ) ใน it_repair_requests และเพิ่ม track โดยใส่ reject_reason ลงใน note',
        },
    })
    // เรียกดูไฟล์ภาพตาม it_repair_request_image_id
    .get('/repair-request-images/:imageId/file', getRepairRequestImageFile, {
        params: t.Object({ imageId: t.Numeric() }),
        detail: {
            tags: ['IT'],
            summary: 'เรียกดูไฟล์ภาพตาม it_repair_request_image_id',
            description: 'คืนค่าไฟล์ภาพจริง (image/jpeg, image/png, ฯลฯ) สำหรับแสดงในเบราว์เซอร์',
        },
    });
