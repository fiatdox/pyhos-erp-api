import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getEquipmentTypes, getEquipmentTypeById, getProblemCategories, getProblemCategoryById, getPriorityLevels, getPriorityLevelById, getProcessStatuses, getProcessStatusById, getProcessStatusesByIds, createRepairRequest, getRepairRequests, getAllRepairRequests, getRepairRequestImages, getRepairRequestImageFile, receiveAssignment, rejectAssignment, requestExtension, getRepairExtensions, approveByHeader, approveByMission, getRepairAssessments, getRepairAssessmentById, updateRepairAssessment, getPrDocumentTypes, getRepairPr, recordRepairPr, getRepairPrStatus, getRepairWorkSteps, getRepairProgress, recordRepairProgress, completeRepair } from '../controllers/itController';

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
    // ช่างขอเวลาเพิ่ม (บันทึก extension + track โดยคงกำหนดเดิมไว้)
    .patch('/repair-requests/:id/request-extension', requestExtension, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            new_estimated_completion_date: t.String({ minLength: 1 }),
            extension_reason: t.String({ minLength: 1 }),
            extension_days: t.Optional(t.Nullable(t.Numeric())),
        }),
        detail: {
            tags: ['IT'],
            summary: 'ขอเวลาเพิ่มในการดำเนินการ',
            description: 'บันทึกการขอเวลาเพิ่มลง it_repair_requests_extension (วันที่ขอ + เหตุผล + กำหนดเสร็จใหม่) และเพิ่ม track (process_status_id = 2) โดยไม่แก้ estimated_completion_date เดิมใน it_repair_requests',
        },
    })
    // ดึงประวัติการขอเวลาเพิ่มของคำร้องซ่อม
    .get('/repair-requests/:id/extensions', getRepairExtensions, {
        params: t.Object({ id: t.Numeric() }),
        detail: {
            tags: ['IT'],
            summary: 'ประวัติการขอเวลาเพิ่ม',
            description: 'ดึงรายการขอเวลาเพิ่มทั้งหมดของคำร้องซ่อม (เรียงจากล่าสุดไปเก่าสุด) พร้อมชื่อผู้ขอ',
        },
    })
    // หัวหน้า IT อนุมัติ/ไม่อนุมัติคำร้องซ่อม
    .patch('/repair-requests/:id/header-approve', approveByHeader, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            header_approve: t.Numeric({ minimum: 1, maximum: 2 }),
            header_comment: t.Optional(t.String()),
        }),
        detail: {
            tags: ['IT'],
            summary: 'หัวหน้า IT อนุมัติคำร้องซ่อม',
            description: 'อัปเดต header_approve (1=อนุมัติ, 2=ไม่อนุมัติ) และ header_comment ใน it_repair_requests — กรณีไม่อนุมัติ (2) ต้องระบุ header_comment',
        },
    })
    // หัวหน้ากลุ่มภารกิจอนุมัติ/ไม่อนุมัติคำร้องซ่อม (จากสถานะ 9)
    .patch('/repair-requests/:id/mission-approve', approveByMission, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            mission_approve: t.Numeric({ minimum: 1, maximum: 2 }),
            mission_comment: t.Optional(t.String()),
        }),
        detail: {
            tags: ['IT'],
            summary: 'หัวหน้ากลุ่มภารกิจอนุมัติคำร้องซ่อม',
            description: 'ปฏิเสธ (2) → process_status_id = 10; อนุมัติ (1) → ใช้ approve_process_id ของ assessment ที่ช่างเลือกเป็นสถานะถัดไป (สั่งซื้ออะไหล่/จ้างภายนอก → 3 ออกใบ PR, แนะนำซื้อทดแทน → 11 อนุมัติซื้อทดแทน) พร้อมเพิ่ม track',
        },
    })
    // ดึงรายการขั้นงานย่อย (เช็กลิสต์ในฟอร์มอัพเดทความคืบหน้า)
    .get('/repair-work-steps', getRepairWorkSteps, {
        detail: {
            tags: ['IT'],
            summary: 'ดึงรายการขั้นงานย่อยงานซ่อม',
            description: 'ดึง id, step_code, name_th, sort_order จากตาราง it_repair_work_steps เฉพาะที่ is_active = Y (ใช้ render checkbox ในฟอร์มอัพเดทความคืบหน้า)',
        },
    })
    // ดึงประวัติการอัพเดทความคืบหน้าของคำร้องซ่อม
    .get('/repair-requests/:id/progress', getRepairProgress, {
        params: t.Object({ id: t.Numeric() }),
        detail: {
            tags: ['IT'],
            summary: 'ประวัติการอัพเดทความคืบหน้า',
            description: 'ดึงรายการอัพเดทความคืบหน้าทั้งหมด (ล่าสุดไปเก่าสุด) พร้อม array ขั้นงานที่ติ๊กแต่ละครั้งและชื่อช่างผู้อัพเดท — ชุดของแถวล่าสุด = ความคืบหน้าปัจจุบัน',
        },
    })
    // บันทึกการอัพเดทความคืบหน้างานซ่อม (ระหว่าง status 2, append-only)
    .post('/repair-requests/:id/progress', recordRepairProgress, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            note: t.Optional(t.String({ maxLength: 500 })),
            work_step_ids: t.Optional(t.Array(t.Numeric())),
            // สถานะปลายทาง (เลือกจาก select ในโมดัลอัพเดทงาน) — ย้ายงานไปสถานะถัดไป เช่น 8 "รอรับของ / รับอะไหล่"
            // ต้องประกาศไว้ในสคีมา ไม่งั้น Elysia จะ strip ทิ้งก่อนถึง controller ทำให้เปลี่ยนสถานะไม่ได้
            process_status_id: t.Optional(t.Numeric()),
        }),
        detail: {
            tags: ['IT'],
            summary: 'อัพเดทความคืบหน้างานซ่อม',
            description: 'บันทึก it_repair_progress (note) + it_repair_progress_steps ตามขั้นงานที่ติ๊ก, เพิ่ม track และแจ้งเตือน MOPH 2 ทาง — ต้องมี note, work_step_ids หรือ process_status_id อย่างน้อย 1 อย่าง; ถ้าส่ง process_status_id จะย้ายงานไปสถานะนั้น (เช่น 8 รอรับของ) ไม่งั้นคงสถานะเดิม, บันทึกได้หลายครั้ง (history)',
        },
    })
    // ปิดงานซ่อม (รับอะไหล่ / เสร็จสิ้น) จากสถานะ 8 → process_status_id = 5 (ซ่อมเสร็จแล้ว)
    .post('/repair-requests/:id/complete', completeRepair, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            // เวลาที่ซ่อมเสร็จจริง (ISO string) — ไม่ส่ง = ใช้เวลาปัจจุบัน
            completed_at: t.Optional(t.String()),
            note: t.Optional(t.String({ maxLength: 500 })),
        }),
        detail: {
            tags: ['IT'],
            summary: 'ปิดงานซ่อม (รับอะไหล่ / เสร็จสิ้น)',
            description: 'บันทึก completed_at (เวลาซ่อมเสร็จจริง) + completion_note, เลื่อน process_status_id = 5 (ซ่อมเสร็จแล้ว) และเพิ่ม track',
        },
    })
    // ดึงรายการประเภทเอกสารที่เสนอ ผอ. (เช็กลิสต์ในฟอร์มบันทึกใบ PR)
    .get('/pr-document-types', getPrDocumentTypes, {
        detail: {
            tags: ['IT'],
            summary: 'ดึงรายการประเภทเอกสารที่เสนอ ผอ.',
            description: 'ดึง id, doc_code, name_th, sort_order จากตาราง it_pr_document_types เฉพาะที่ is_active = Y (ใช้ render checkbox ในฟอร์มบันทึกใบ PR)',
        },
    })
    // ดึงใบ PR ของคำร้องซ่อม พร้อมเอกสารที่ติ๊ก
    .get('/repair-requests/:id/pr', getRepairPr, {
        params: t.Object({ id: t.Numeric() }),
        detail: {
            tags: ['IT'],
            summary: 'ดึงใบ PR ของคำร้องซ่อม',
            description: 'ดึง it_repair_prs (pr_number, pr_detail, ผู้บันทึก) พร้อม array เอกสารที่ติ๊กจาก it_repair_pr_documents',
        },
    })
    // ติดตามสถานะการออกเลข PR จากระบบ inventory (MySQL)
    .get('/repair-requests/:id/pr-status', getRepairPrStatus, {
        params: t.Object({ id: t.Numeric() }),
        detail: {
            tags: ['IT'],
            summary: 'ติดตามสถานะการออกเลข PR จากระบบ inventory',
            description: 'ดึง pr_number ที่บันทึกไว้ (= request_id ของระบบ inventory) แล้ว query stock_request เพื่อตรวจสอบว่าออกเลขแล้วหรือยัง (stock_approve_date ไม่ว่าง = ออกเลขแล้ว) พร้อมคืน request_no, stock_approve_date, stock_user_approve_id',
        },
    })
    // บันทึกใบ PR + เอกสารเตรียมนำเสนอ ผอ. (จากสถานะ 3) → เลื่อนไป process_status_id = 7
    .post('/repair-requests/:id/pr', recordRepairPr, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            pr_number: t.String({ minLength: 1 }),
            pr_detail: t.Optional(t.String()),
            document_type_ids: t.Optional(t.Array(t.Numeric())),
        }),
        detail: {
            tags: ['IT'],
            summary: 'บันทึกใบ PR เตรียมนำเสนอ ผอ.',
            description: 'บันทึก it_repair_prs (1 คำร้อง → 1 ใบ PR) + it_repair_pr_documents ตามเอกสารที่ติ๊ก, เลื่อน process_status_id = 7 (ขั้นตอน PO โดยพัสดุ / เสนอผู้อำนวยการ), เพิ่ม track และแจ้งเตือน MOPH 2 ทาง — บันทึกซ้ำคำร้องเดิมจะได้ 409',
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
