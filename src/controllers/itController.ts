import { join } from 'path';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { core_kon } from '../db/db';
import { mophItMatenance } from '../utils/mophNotify';

// ดึงรายการสถานะกระบวนการ IT ทั้งหมด (เฉพาะที่ active)
export const getProcessStatuses = async ({ set }: any) => {
    try {
        const result = await core_kon`
            SELECT id, "name" AS it_process_status_name, description
            FROM it_process_statuses
            WHERE is_active = 'Y'
            ORDER BY sort_order ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงสถานะกระบวนการ IT ตาม id
export const getProcessStatusById = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT id, "name" AS it_process_status_name, description
            FROM it_process_statuses
            WHERE id = ${params.id} AND is_active = 'Y'
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Process status not found' };
        }
        return { success: true, data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงสถานะกระบวนการ IT หลายรายการ เช่น ?ids=1,2,3
export const getProcessStatusesByIds = async ({ query, set }: any) => {
    try {
        const ids: number[] = String(query?.ids ?? '').split(',').map(Number).filter(n => !isNaN(n) && n > 0);
        if (ids.length === 0) {
            set.status = 400;
            return { success: false, message: 'กรุณาระบุ ids เช่น ?ids=1,2,3' };
        }
        const result = await core_kon`
            SELECT id, "name" AS it_process_status_name, description
            FROM it_process_statuses
            WHERE id = ANY(${ids}) AND is_active = 'Y'
            ORDER BY sort_order ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการประเภทอุปกรณ์ IT ทั้งหมด
export const getEquipmentTypes = async ({ set }: any) => {
    try {
        const result = await core_kon`
            SELECT id, name FROM it_equipment_types ORDER BY id ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงประเภทอุปกรณ์ IT ตาม id
export const getEquipmentTypeById = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT id, name FROM it_equipment_types WHERE id = ${params.id}
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Equipment type not found' };
        }
        return { success: true, data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการหมวดหมู่ปัญหา IT ทั้งหมด
export const getProblemCategories = async ({ set }: any) => {
    try {
        const result = await core_kon`
            SELECT it_problem_category_id, name, description FROM it_problem_category ORDER BY it_problem_category_id ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการระดับความสำคัญ IT ทั้งหมด (เฉพาะที่ active)
export const getPriorityLevels = async ({ set }: any) => {
    try {
        const result = await core_kon`
            SELECT it_priority_level_id, name, description, response_days, display_order
            FROM it_priority_levels
            WHERE is_active = 'Y'
            ORDER BY display_order ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงระดับความสำคัญ IT ตาม id (เฉพาะที่ active)
export const getPriorityLevelById = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT it_priority_level_id, name, description, response_days, display_order
            FROM it_priority_levels
            WHERE it_priority_level_id = ${params.id} AND is_active = 'Y' order BY display_order ASC
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Priority level not found' };
        }
        return { success: true, data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงหมวดหมู่ปัญหา IT ตาม id
export const getProblemCategoryById = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT it_problem_category_id, name, desc FROM it_problem_category WHERE it_problem_category_id = ${params.id}
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Problem category not found' };
        }
        return { success: true, data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// บันทึกคำร้องงานซ่อมคอมพิวเตอร์
export const createRepairRequest = async ({ body, user, set }: any) => {
    const {
        equipment_number, equipment_name, it_equipment_type_id,
        brand, location, unit_price, company_name, budget_year,
        problem_category_id, problem_description, it_priority_level_id,
        images,
    } = body;

    const createdBy: number | null = user?.id ?? null;
    if (!createdBy) {
        set.status = 401;
        return { success: false, message: 'กรุณา login ใหม่เพื่อรับ token ที่ถูกต้อง' };
    }

    try {
        const [userInfo] = await core_kon`
            SELECT CONCAT(pname, fname, ' ', lname) AS employee_name
                ,m1."name" as major_name
                ,m2."name" as submajor_name
            FROM users u
            left join majors m1 on u.major_id = m1.major_id
            left join submajors m2 on u.submajor_id = m2.submajor_id
            WHERE u.id = ${createdBy}
        `;

        const [newRequest] = await core_kon`
            INSERT INTO it_repair_requests (
                equipment_number, equipment_name, it_equipment_type_id,
                brand, location, unit_price, company_name, budget_year,
                problem_category_id, problem_description, it_priority_level_id,
                process_status_id, created_by, created_at
            ) VALUES (
                ${equipment_number}, ${equipment_name}, ${it_equipment_type_id},
                ${brand ?? null}, ${location}, ${unit_price ?? null}, ${company_name ?? null}, ${budget_year ?? null},
                ${problem_category_id}, ${problem_description}, ${it_priority_level_id},
                1, ${createdBy}, NOW()
            )
            RETURNING it_repair_request_id
        `;

        const requestId = newRequest.it_repair_request_id;
        const savedFiles: string[] = [];

        if (images) {
            const uploadDir = join(process.cwd(), 'uploads', 'it-repairs');
            await mkdir(uploadDir, { recursive: true });

            const fileList: File[] = Array.isArray(images) ? images : [images];
            for (const file of fileList.slice(0, 3)) {
                const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
                const filename = `${crypto.randomUUID()}.${ext}`;
                await Bun.write(join(uploadDir, filename), file);
                savedFiles.push(filename);
            }

            for (const filename of savedFiles) {
                await core_kon`
                    INSERT INTO it_repair_request_images (
                        it_repair_request_id, attach_file_name, created_at, created_by
                    ) VALUES (
                        ${requestId}, ${filename}, NOW(), ${createdBy}
                    )
                `;
            }
        }

        const [priorityRows, equipmentTypeRows, problemCategoryRows] = await Promise.all([
            core_kon`SELECT name FROM it_priority_levels WHERE it_priority_level_id = ${it_priority_level_id}`,
            core_kon`SELECT name FROM it_equipment_types WHERE id = ${it_equipment_type_id}`,
            core_kon`SELECT name FROM it_problem_category WHERE it_problem_category_id = ${problem_category_id}`,
        ]);

        const reporterUnit = [userInfo?.major_name, userInfo?.submajor_name].filter(Boolean).join(' / ');

        mophItMatenance({
            requestId,
            equipmentNumber: equipment_number,
            equipmentName: equipment_name,
            location,
            problemDescription: problem_description,
            priorityName: priorityRows[0]?.name as string | undefined,
            equipmentTypeName: equipmentTypeRows[0]?.name as string | undefined,
            problemCategoryName: problemCategoryRows[0]?.name as string | undefined,
            imageCount: savedFiles.length,
            reporterName: userInfo?.employee_name ?? undefined,
            reporterUnit: reporterUnit || undefined,
        }).catch((err: any) => console.error('[MOPH Notify] IT Maintenance failed:', err.message));

        set.status = 201;
        return {
            success: true,
            data: {
                it_repair_request_id: requestId,
                images: savedFiles,
                created_by: {
                    employee_name: userInfo?.employee_name ?? null,
                    major_name: userInfo?.major_name ?? null,
                    submajor_name: userInfo?.submajor_name ?? null,
                },
            },
        };
    } catch (error: any) {
        console.error('[IT Repair] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการซ่อมทั้งหมด ย้อนหลัง 1 ปี หรือกรองตามช่วงวันที่ { date1, date2 }
export const getAllRepairRequests = async ({ body, set }: any) => {
    try {
        const { date1, date2, status } = (body as any) ?? {};

        const from: string = date1 ?? new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().slice(0, 10);
        const to: string = date2 ?? new Date().toISOString().slice(0, 10);

        const statusIds: number[] = Array.isArray(status)
            ? status.map(Number).filter(n => !isNaN(n) && n > 0)
            : status ? String(status).split(',').map(Number).filter(n => !isNaN(n) && n > 0)
            : [];

        const rows = statusIds.length > 0
            ? await core_kon`
                SELECT r.it_repair_request_id, r.equipment_number, r.equipment_name,
                    r.brand, r.location, r.problem_description, r.created_at,
                    et.name AS equipment_type_name,
                    pc.name AS problem_category_name,
                    pl.name AS priority_name,
                    ps."name" AS process_status_name,
                    r.process_status_id,
                    CONCAT(u.pname, u.fname, ' ', u.lname) AS created_by_name,
                    m1.name AS major_name,
                    m2.name AS submajor_name
                FROM it_repair_requests r
                LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
                LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
                LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
                LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
                LEFT JOIN users u ON u.id = r.created_by
                LEFT JOIN majors m1 ON m1.major_id = u.major_id
                LEFT JOIN submajors m2 ON m2.submajor_id = u.submajor_id
                WHERE DATE(r.created_at) BETWEEN ${from} AND ${to}
                  AND r.process_status_id = ANY(${statusIds})
                ORDER BY r.created_at DESC
            `
            : await core_kon`
                SELECT r.it_repair_request_id, r.equipment_number, r.equipment_name,
                    r.brand, r.location, r.problem_description, r.created_at,
                    et.name AS equipment_type_name,
                    pc.name AS problem_category_name,
                    pl.name AS priority_name,
                    ps."name" AS process_status_name,
                    r.process_status_id,
                    CONCAT(u.pname, u.fname, ' ', u.lname) AS created_by_name,
                    m1.name AS major_name,
                    m2.name AS submajor_name
                FROM it_repair_requests r
                LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
                LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
                LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
                LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
                LEFT JOIN users u ON u.id = r.created_by
                LEFT JOIN majors m1 ON m1.major_id = u.major_id
                LEFT JOIN submajors m2 ON m2.submajor_id = u.submajor_id
                WHERE DATE(r.created_at) BETWEEN ${from} AND ${to}
                ORDER BY r.created_at DESC
            `;

        return { success: true, date_from: from, date_to: to, total: rows.length, data: rows };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการคำร้องซ่อมคอมพิวเตอร์ กรองด้วย process_status_id (ส่งหลาย status ได้)
export const getRepairRequests = async ({ query, set }: any) => {
    try {
        const rawStatus = query?.status;
        const statusIds: number[] = rawStatus
            ? String(rawStatus).split(',').map(Number).filter(n => !isNaN(n) && n > 0)
            : [];

        const threeYearsAgo = new Date();
        threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);
        const from = threeYearsAgo.toISOString().slice(0, 10);
        const to = new Date().toISOString().slice(0, 10);

        const rows = statusIds.length > 0
            ? await core_kon`
                SELECT r.it_repair_request_id, r.equipment_number, r.equipment_name,
                    r.brand, r.location, r.problem_description, r.created_at,
                    et.name AS equipment_type_name,
                    pc.name AS problem_category_name,
                    pl.name AS priority_name,
                    ps.name AS process_status_name,
                    r.process_status_id,
                    CONCAT(u.pname, u.fname, ' ', u.lname) AS created_by_name,
                    m1.name AS major_name,
                    m2.name AS submajor_name
                FROM it_repair_requests r
                LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
                LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
                LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
                LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
                LEFT JOIN users u ON u.id = r.created_by
                LEFT JOIN majors m1 ON m1.major_id = u.major_id
                LEFT JOIN submajors m2 ON m2.submajor_id = u.submajor_id
                WHERE r.process_status_id = ANY(${statusIds})
                  AND DATE(r.created_at) BETWEEN ${from} AND ${to}
                ORDER BY r.created_at DESC
            `
            : await core_kon`
                SELECT r.it_repair_request_id, r.equipment_number, r.equipment_name,
                    r.brand, r.location, r.problem_description, r.created_at,
                    et.name AS equipment_type_name,
                    pc.name AS problem_category_name,
                    pl.name AS priority_name,
                    ps.name AS process_status_name,
                    r.process_status_id,
                    CONCAT(u.pname, u.fname, ' ', u.lname) AS created_by_name,
                    m1.name AS major_name,
                    m2.name AS submajor_name
                FROM it_repair_requests r
                LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
                LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
                LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
                LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
                LEFT JOIN users u ON u.id = r.created_by
                LEFT JOIN majors m1 ON m1.major_id = u.major_id
                LEFT JOIN submajors m2 ON m2.submajor_id = u.submajor_id
                WHERE DATE(r.created_at) BETWEEN ${from} AND ${to}
                ORDER BY r.created_at DESC
            `;

        return { success: true, data: rows };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการภาพทั้งหมดตาม it_repair_request_id
export const getRepairRequestImages = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT it_repair_request_image_id, it_repair_request_id,
                   attach_file_name, created_at, created_by
            FROM it_repair_request_images
            WHERE it_repair_request_id = ${params.id}
            ORDER BY it_repair_request_image_id ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// รับมอบหมายงานซ่อม: อัปเดต assign_to/assign_datetime และเพิ่ม timeline (process_status_id = 2 กำลังดำเนินการ)
export const receiveAssignment = async ({ params, user, set }: any) => {
    const actionBy: number | null = user?.id ?? null;
    if (!actionBy) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    try {
        const result = await core_kon.begin(async (sql) => {
            const updated = await sql`
                UPDATE it_repair_requests
                SET assigned_to = ${actionBy},
                    assign_datetime = NOW(),
                    process_status_id = 2
                WHERE it_repair_request_id = ${params.id}
                RETURNING it_repair_request_id, assigned_to, assign_datetime
            `;

            if (updated.length === 0) {
                return null;
            }

            const [timeline] = await sql`
                INSERT INTO it_repair_request_timelines (
                    it_repair_request_id, process_status_id, action_by, action_datetime
                ) VALUES (
                    ${params.id}, 2, ${actionBy}, NOW()
                )
                RETURNING timeline_id
            `;

            return { request: updated[0], timeline };
        });

        if (!result) {
            set.status = 404;
            return { success: false, message: 'ไม่พบคำร้องซ่อม' };
        }

        return { success: true, data: result };
    } catch (error: any) {
        console.error('[receiveAssignment] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// อัปเดตผลการประเมินซ่อมในตาราง it_repair_requests
export const updateRepairAssessment = async ({ params, body, user, set }: any) => {
    const actionBy: number | null = user?.id ?? null;
    if (!actionBy) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    const {
        repair_assessment_id,
        assessment_detail,
        parts_used,
        replacement_recommendation,
        return_status_id,
        external_service_detail,
    } = body;

    if (![1, 2, 3, 4, 5].includes(repair_assessment_id)) {
        set.status = 400;
        return { success: false, message: 'repair_assessment_id ต้องเป็น 1-5' };
    }

    if (!assessment_detail || String(assessment_detail).trim() === '') {
        set.status = 400;
        return { success: false, message: 'assessment_detail จำเป็นต้องระบุ' };
    }

    if ((repair_assessment_id === 2 || repair_assessment_id === 3) && !parts_used) {
        set.status = 400;
        return { success: false, message: 'parts_used จำเป็นต้องระบุเมื่อ repair_assessment_id = 2 หรือ 3' };
    }

    if (repair_assessment_id === 4) {
        if (!replacement_recommendation) {
            set.status = 400;
            return { success: false, message: 'replacement_recommendation จำเป็นต้องระบุเมื่อ repair_assessment_id = 4' };
        }
        if (![1, 2].includes(return_status_id)) {
            set.status = 400;
            return { success: false, message: 'return_status_id ต้องเป็น 1 หรือ 2 เมื่อ repair_assessment_id = 4' };
        }
    }

    if (repair_assessment_id === 5 && !external_service_detail) {
        set.status = 400;
        return { success: false, message: 'external_service_detail จำเป็นต้องระบุเมื่อ repair_assessment_id = 5' };
    }

    try {
        const [assessment] = await core_kon`
            SELECT process_status_id FROM it_repair_assessments
            WHERE repair_assessment_id = ${repair_assessment_id}
        `;

        if (!assessment) {
            set.status = 400;
            return { success: false, message: 'ไม่พบ repair_assessment_id ที่ระบุ' };
        }

        const payload: Record<string, any> = {
            repair_assessment_id,
            assessment_detail,
            parts_used: (repair_assessment_id === 2 || repair_assessment_id === 3) ? parts_used : null,
            replacement_recommendation: repair_assessment_id === 4 ? replacement_recommendation : null,
            return_status_id: repair_assessment_id === 4 ? return_status_id : null,
            external_service_detail: repair_assessment_id === 5 ? external_service_detail : null,
            process_status_id: assessment.process_status_id,
        };

        const result = await core_kon`
            UPDATE it_repair_requests SET ${core_kon(payload)}
            WHERE it_repair_request_id = ${params.id}
            RETURNING it_repair_request_id, repair_assessment_id, assessment_detail,
                      parts_used, replacement_recommendation, return_status_id,
                      external_service_detail, process_status_id
        `;

        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'ไม่พบคำร้องซ่อม' };
        }

        return { success: true, data: result[0] };
    } catch (error: any) {
        console.error('[updateRepairAssessment] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการผลการประเมินซ่อมทั้งหมด (เฉพาะที่ active)
export const getRepairAssessments = async ({ set }: any) => {
    try {
        const result = await core_kon`
            SELECT repair_assessment_id, assessment_name, is_active, created_at
            FROM it_repair_assessments
            WHERE is_active = 'Y'
            ORDER BY repair_assessment_id ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงผลการประเมินซ่อมตาม id
export const getRepairAssessmentById = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT repair_assessment_id, assessment_name, is_active, created_at
            FROM it_repair_assessments
            WHERE repair_assessment_id = ${params.id}
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Repair assessment not found' };
        }
        return { success: true, data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// เรียกดูไฟล์ภาพตาม it_repair_request_image_id
export const getRepairRequestImageFile = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT attach_file_name
            FROM it_repair_request_images
            WHERE it_repair_request_image_id = ${params.imageId}
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'ไม่พบรูปภาพ' };
        }

        const filename = result[0].attach_file_name;
        const filepath = join(process.cwd(), 'uploads', 'it-repairs', filename);

        if (!existsSync(filepath)) {
            set.status = 404;
            return { success: false, message: 'ไม่พบไฟล์บนเซิร์ฟเวอร์' };
        }

        const ext = filename.split('.').pop()?.toLowerCase() ?? '';
        const mimeMap: Record<string, string> = {
            jpg: 'image/jpeg', jpeg: 'image/jpeg',
            png: 'image/png', gif: 'image/gif', webp: 'image/webp',
        };
        set.headers['Content-Type'] = mimeMap[ext] ?? 'application/octet-stream';
        set.headers['Content-Disposition'] = `inline; filename="${filename}"`;

        return Bun.file(filepath);
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};
