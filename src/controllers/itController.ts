import { join } from 'path';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { core_kon, inventoryPool } from '../db/db';
import { mophItMatenance, mophReceiveAssignment, mophRepairAssessment, mophRejectAssignment, mophRequestExtension, mophHeaderApprove, mophMissionApprove, mophRepairPr, mophRepairProgress } from '../utils/mophNotify';
import { sendRepairRejectedAlert, sendRepairReceivedAlert, sendRepairExtensionAlert, sendHeaderApproveAlert, sendMissionApproveAlert, sendRepairPrAlert, sendRepairProgressAlert } from '../utils/mophAlert';

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
                    m2.name AS submajor_name,
                    r.assigned_to,
                    CONCAT(au.pname, au.fname, ' ', au.lname) AS assigned_to_name,
                    r.assign_datetime,
                    r.estimated_days,
                    r.estimated_completion_date,
                    r.technician_priority_id,
                    tpl.name AS technician_priority_name
                FROM it_repair_requests r
                LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
                LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
                LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
                LEFT JOIN it_priority_levels tpl ON tpl.it_priority_level_id = r.technician_priority_id
                LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
                LEFT JOIN users u ON u.id = r.created_by
                LEFT JOIN users au ON au.id = r.assigned_to
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
                    m2.name AS submajor_name,
                    r.assigned_to,
                    CONCAT(au.pname, au.fname, ' ', au.lname) AS assigned_to_name,
                    r.assign_datetime,
                    r.estimated_days,
                    r.estimated_completion_date,
                    r.technician_priority_id,
                    tpl.name AS technician_priority_name
                FROM it_repair_requests r
                LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
                LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
                LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
                LEFT JOIN it_priority_levels tpl ON tpl.it_priority_level_id = r.technician_priority_id
                LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
                LEFT JOIN users u ON u.id = r.created_by
                LEFT JOIN users au ON au.id = r.assigned_to
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
                    m2.name AS submajor_name,
                    up.position_name,
                    r.assigned_to,
                    CONCAT(au.pname, au.fname, ' ', au.lname) AS assigned_to_name,
                    r.header_approve,
                    r.header_comment,
                    r.mission_approve,
                    r.mission_comment,
                    r.repair_assessment_id,
                    ia.assessment_name,
                    r.assessment_detail,
                    r.parts_used,
                    r.replacement_recommendation,
                    r.external_service_detail,
                    r.return_status_id
                FROM it_repair_requests r
                LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
                LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
                LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
                LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
                LEFT JOIN it_repair_assessments ia ON ia.repair_assessment_id = r.repair_assessment_id
                LEFT JOIN users u ON u.id = r.created_by
                LEFT JOIN users au ON au.id = r.assigned_to
                LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
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
                    m2.name AS submajor_name,
                    up.position_name,
                    r.assigned_to,
                    CONCAT(au.pname, au.fname, ' ', au.lname) AS assigned_to_name,
                    r.header_approve,
                    r.header_comment,
                    r.mission_approve,
                    r.mission_comment,
                    r.repair_assessment_id,
                    ia.assessment_name,
                    r.assessment_detail,
                    r.parts_used,
                    r.replacement_recommendation,
                    r.external_service_detail,
                    r.return_status_id
                FROM it_repair_requests r
                LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
                LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
                LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
                LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
                LEFT JOIN it_repair_assessments ia ON ia.repair_assessment_id = r.repair_assessment_id
                LEFT JOIN users u ON u.id = r.created_by
                LEFT JOIN users au ON au.id = r.assigned_to
                LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
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

// รับมอบหมายงานซ่อม: อัปเดต assign_to/assign_datetime และเพิ่ม track (process_status_id = 2 กำลังดำเนินการ)
export const receiveAssignment = async ({ params, body, user, set }: any) => {
    const actionBy: number | null = user?.id ?? null;
    if (!actionBy) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    const estimatedDays = (body as any)?.estimated_days ?? null;
    const estimatedCompletionDate = (body as any)?.estimated_completion_date ?? null;
    const technicianPriorityId = (body as any)?.technician_priority_id ?? null;

    try {
        const result = await core_kon.begin(async (sql) => {
            const updated = await sql`
                UPDATE it_repair_requests
                SET assigned_to = ${actionBy},
                    assign_datetime = NOW(),
                    process_status_id = 2,
                    estimated_days = COALESCE(${estimatedDays}, estimated_days),
                    estimated_completion_date = COALESCE(${estimatedCompletionDate}, estimated_completion_date),
                    technician_priority_id = COALESCE(${technicianPriorityId}, technician_priority_id)
                WHERE it_repair_request_id = ${params.id}
                RETURNING it_repair_request_id, assigned_to, assign_datetime,
                          estimated_days, estimated_completion_date, technician_priority_id
            `;

            if (updated.length === 0) {
                return null;
            }

            const [track] = await sql`
                INSERT INTO it_repair_requests_track (
                    it_repair_request_id, process_status_id, assigned_to, note, created_by
                ) VALUES (
                    ${params.id}, 2, ${actionBy}, 'ช่างรับมอบหมายงานซ่อมและเริ่มดำเนินการ', ${actionBy}
                )
                RETURNING it_repair_request_track_id
            `;

            return { request: updated[0], track };
        });

        if (!result) {
            set.status = 404;
            return { success: false, message: 'ไม่พบคำร้องซ่อม' };
        }

        const [notifyInfo] = await core_kon`
            SELECT r.equipment_number, r.equipment_name, r.location, r.problem_description, r.created_at,
                   et.name AS equipment_type_name,
                   pc.name AS problem_category_name,
                   pl.name AS priority_name,
                   tpl.name AS technician_priority_name,
                   ru.id_card,
                   CONCAT(u.pname, u.fname, ' ', u.lname) AS technician_name
            FROM it_repair_requests r
            LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
            LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
            LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
            LEFT JOIN it_priority_levels tpl ON tpl.it_priority_level_id = r.technician_priority_id
            LEFT JOIN users u ON u.id = ${actionBy}
            LEFT JOIN users ru ON ru.id = r.created_by
            WHERE r.it_repair_request_id = ${params.id}
        `;

        if (notifyInfo) {
            const estimatedCompletionDate = result.request.estimated_completion_date
                ? (() => {
                    const d = new Date(result.request.estimated_completion_date);
                    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
                })()
                : undefined;
            const requestedAt = notifyInfo.created_at ? new Date(notifyInfo.created_at).toISOString() : undefined;

            // ทางที่ 1: แจ้งเข้าหน่วยงาน IT ผ่าน MOPH Notify
            mophReceiveAssignment({
                requestId: params.id,
                equipmentNumber: notifyInfo.equipment_number,
                equipmentName: notifyInfo.equipment_name,
                location: notifyInfo.location,
                problemDescription: notifyInfo.problem_description,
                equipmentTypeName: notifyInfo.equipment_type_name ?? undefined,
                problemCategoryName: notifyInfo.problem_category_name ?? undefined,
                priorityName: notifyInfo.priority_name ?? undefined,
                technicianPriorityName: notifyInfo.technician_priority_name ?? undefined,
                technicianName: notifyInfo.technician_name ?? undefined,
                estimatedDays: result.request.estimated_days ?? undefined,
                estimatedCompletionDate,
            }).catch((err: any) => console.error('[MOPH Notify] Receive Assignment failed:', err.message));

            // ทางที่ 2: แจ้งกลับผู้ส่งซ่อม (created_by) ผ่าน MOPH Alert โดยใช้ id_card
            if (notifyInfo.id_card) {
                sendRepairReceivedAlert(notifyInfo.id_card, {
                    requestId: params.id,
                    equipmentName: notifyInfo.equipment_name ?? undefined,
                    equipmentNumber: notifyInfo.equipment_number ?? undefined,
                    location: notifyInfo.location ?? undefined,
                    problemDescription: notifyInfo.problem_description ?? undefined,
                    equipmentTypeName: notifyInfo.equipment_type_name ?? undefined,
                    problemCategoryName: notifyInfo.problem_category_name ?? undefined,
                    priorityName: notifyInfo.priority_name ?? undefined,
                    technicianName: notifyInfo.technician_name ?? undefined,
                    technicianPriorityName: notifyInfo.technician_priority_name ?? undefined,
                    estimatedDays: result.request.estimated_days ?? undefined,
                    estimatedCompletionDate,
                    requestedAt,
                }).catch((err: any) => console.error('[MOPH Alert] Repair Received failed:', err.message));
            }
        }

        return { success: true, data: result };
    } catch (error: any) {
        console.error('[receiveAssignment] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ปฏิเสธงานซ่อม: อัปเดต process_status_id = 10 (ปฏิเสธ) และเพิ่ม track โดยใส่เหตุผลลงใน note
export const rejectAssignment = async ({ params, body, user, set }: any) => {
    const actionBy: number | null = user?.id ?? null;
    if (!actionBy) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    const rejectReason: string = ((body as any)?.reject_reason ?? '').trim();
    if (!rejectReason) {
        set.status = 400;
        return { success: false, message: 'กรุณาระบุเหตุผลการปฏิเสธ (reject_reason)' };
    }

    try {
        const result = await core_kon.begin(async (sql) => {
            const updated = await sql`
                UPDATE it_repair_requests
                SET process_status_id = 10
                WHERE it_repair_request_id = ${params.id}
                RETURNING it_repair_request_id, process_status_id
            `;

            if (updated.length === 0) {
                return null;
            }

            const [track] = await sql`
                INSERT INTO it_repair_requests_track (
                    it_repair_request_id, process_status_id, assigned_to, note, created_by
                ) VALUES (
                    ${params.id}, 10, ${actionBy}, ${rejectReason}, ${actionBy}
                )
                RETURNING it_repair_request_track_id
            `;

            return { request: updated[0], track };
        });

        if (!result) {
            set.status = 404;
            return { success: false, message: 'ไม่พบคำร้องซ่อม' };
        }

        // ดึงข้อมูลคำร้องสำหรับแจ้งเตือน 2 ทาง
        const [reqInfo] = await core_kon`
            SELECT ru.id_card, r.equipment_name, r.equipment_number, r.location, r.problem_description, r.created_at,
                   et.name AS equipment_type_name,
                   pc.name AS problem_category_name,
                   pl.name AS priority_name,
                   CONCAT(tu.pname, tu.fname, ' ', tu.lname) AS technician_name
            FROM it_repair_requests r
            LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
            LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
            LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
            LEFT JOIN users ru ON ru.id = r.created_by
            LEFT JOIN users tu ON tu.id = ${actionBy}
            WHERE r.it_repair_request_id = ${params.id}
        `;

        if (reqInfo) {
            // ทางที่ 1: แจ้งกลับผู้ส่งซ่อม (created_by) ผ่าน MOPH Alert โดยใช้ id_card
            if (reqInfo.id_card) {
                sendRepairRejectedAlert(reqInfo.id_card, {
                    requestId: params.id,
                    equipmentName: reqInfo.equipment_name ?? undefined,
                    equipmentNumber: reqInfo.equipment_number ?? undefined,
                    location: reqInfo.location ?? undefined,
                    problemDescription: reqInfo.problem_description ?? undefined,
                    equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                    problemCategoryName: reqInfo.problem_category_name ?? undefined,
                    priorityName: reqInfo.priority_name ?? undefined,
                    technicianName: reqInfo.technician_name ?? undefined,
                    rejectReason,
                    requestedAt: reqInfo.created_at ? new Date(reqInfo.created_at).toISOString() : undefined,
                }).catch((err: any) => console.error('[MOPH Alert] Repair Rejected failed:', err.message));
            }

            // ทางที่ 2: แจ้งเข้าหน่วยงาน IT ผ่าน MOPH Notify (เหมือนตอนรับงาน)
            mophRejectAssignment({
                requestId: params.id,
                equipmentNumber: reqInfo.equipment_number,
                equipmentName: reqInfo.equipment_name,
                location: reqInfo.location ?? undefined,
                problemDescription: reqInfo.problem_description ?? undefined,
                equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                problemCategoryName: reqInfo.problem_category_name ?? undefined,
                priorityName: reqInfo.priority_name ?? undefined,
                technicianName: reqInfo.technician_name ?? undefined,
                rejectReason,
                requestedAt: reqInfo.created_at ? new Date(reqInfo.created_at).toISOString() : undefined,
            }).catch((err: any) => console.error('[MOPH Notify] Reject Assignment failed:', err.message));
        }

        return { success: true, message: 'ปฏิเสธงานซ่อมเรียบร้อย', data: result };
    } catch (error: any) {
        console.error('[rejectAssignment] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงประวัติการขอเวลาเพิ่มของคำร้องซ่อม (เรียงจากล่าสุดไปเก่าสุด)
export const getRepairExtensions = async ({ params, set }: any) => {
    try {
        const extensions = await core_kon`
            SELECT e.it_repair_request_extension_id,
                   e.it_repair_request_id,
                   e.previous_estimated_completion_date,
                   e.new_estimated_completion_date,
                   e.extension_days,
                   e.extension_reason,
                   e.requested_at,
                   e.requested_by,
                   CONCAT(u.pname, u.fname, ' ', u.lname) AS requested_by_name
            FROM it_repair_requests_extension e
            LEFT JOIN users u ON u.id = e.requested_by
            WHERE e.it_repair_request_id = ${params.id}
            ORDER BY e.requested_at DESC
        `;

        return { success: true, data: extensions };
    } catch (error: any) {
        console.error('[getRepairExtensions] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ช่างขอเวลาเพิ่มในการดำเนินการ: บันทึกลง it_repair_requests_extension + เพิ่ม track
// หมายเหตุ: ไม่แก้ estimated_completion_date เดิมใน it_repair_requests (เก็บกำหนดเดิมไว้คงเดิม)
export const requestExtension = async ({ params, body, user, set }: any) => {
    const actionBy: number | null = user?.id ?? null;
    if (!actionBy) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    const newCompletionDate: string = ((body as any)?.new_estimated_completion_date ?? '').trim();
    const extensionReason: string = ((body as any)?.extension_reason ?? '').trim();
    const extensionDays = (body as any)?.extension_days ?? null;

    if (!newCompletionDate) {
        set.status = 400;
        return { success: false, message: 'กรุณาระบุกำหนดเสร็จใหม่ (new_estimated_completion_date)' };
    }
    if (!extensionReason) {
        set.status = 400;
        return { success: false, message: 'กรุณาระบุเหตุผลที่ขอเวลาเพิ่ม (extension_reason)' };
    }

    try {
        const result = await core_kon.begin(async (sql) => {
            // ดึงกำหนดเดิมไว้เก็บเป็น snapshot (ไม่แก้ค่าใน it_repair_requests)
            const [req] = await sql`
                SELECT estimated_completion_date
                FROM it_repair_requests
                WHERE it_repair_request_id = ${params.id}
            `;

            if (!req) {
                return null;
            }

            const [extension] = await sql`
                INSERT INTO it_repair_requests_extension (
                    it_repair_request_id, previous_estimated_completion_date,
                    new_estimated_completion_date, extension_days, extension_reason, requested_by
                ) VALUES (
                    ${params.id}, ${req.estimated_completion_date ?? null},
                    ${newCompletionDate}, ${extensionDays}, ${extensionReason}, ${actionBy}
                )
                RETURNING it_repair_request_extension_id, requested_at
            `;

            // เพิ่ม track โดยคงสถานะ "กำลังดำเนินการ" (process_status_id = 2)
            const [track] = await sql`
                INSERT INTO it_repair_requests_track (
                    it_repair_request_id, process_status_id, assigned_to, note, created_by
                ) VALUES (
                    ${params.id}, 2, ${actionBy},
                    ${`ช่างขอเวลาเพิ่ม (กำหนดเสร็จใหม่ ${newCompletionDate}): ${extensionReason}`},
                    ${actionBy}
                )
                RETURNING it_repair_request_track_id
            `;

            return { extension, track };
        });

        if (!result) {
            set.status = 404;
            return { success: false, message: 'ไม่พบคำร้องซ่อม' };
        }

        // ดึงข้อมูลคำร้องสำหรับแจ้งเตือน 2 ทาง (estimated_completion_date คือกำหนดเดิมที่ยังไม่แก้)
        const [reqInfo] = await core_kon`
            SELECT ru.id_card, r.equipment_name, r.equipment_number, r.location, r.problem_description,
                   r.estimated_completion_date, r.created_at,
                   et.name AS equipment_type_name,
                   pc.name AS problem_category_name,
                   CONCAT(tu.pname, tu.fname, ' ', tu.lname) AS technician_name
            FROM it_repair_requests r
            LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
            LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
            LEFT JOIN users ru ON ru.id = r.created_by
            LEFT JOIN users tu ON tu.id = ${actionBy}
            WHERE r.it_repair_request_id = ${params.id}
        `;

        if (reqInfo) {
            const previousCompletionDate = reqInfo.estimated_completion_date
                ? new Date(reqInfo.estimated_completion_date).toISOString()
                : undefined;
            const requestedAt = reqInfo.created_at ? new Date(reqInfo.created_at).toISOString() : undefined;

            // ทางที่ 1: แจ้งเข้าหน่วยงาน IT ผ่าน MOPH Notify
            mophRequestExtension({
                requestId: params.id,
                equipmentNumber: reqInfo.equipment_number,
                equipmentName: reqInfo.equipment_name,
                location: reqInfo.location ?? undefined,
                problemDescription: reqInfo.problem_description ?? undefined,
                equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                problemCategoryName: reqInfo.problem_category_name ?? undefined,
                technicianName: reqInfo.technician_name ?? undefined,
                requestedAt,
                previousCompletionDate,
                newCompletionDate,
                extensionDays: extensionDays ?? undefined,
                extensionReason,
            }).catch((err: any) => console.error('[MOPH Notify] Request Extension failed:', err.message));

            // ทางที่ 2: แจ้งกลับผู้ส่งซ่อม (created_by) ผ่าน MOPH Alert โดยใช้ id_card
            if (reqInfo.id_card) {
                sendRepairExtensionAlert(reqInfo.id_card, {
                    requestId: params.id,
                    equipmentName: reqInfo.equipment_name ?? undefined,
                    equipmentNumber: reqInfo.equipment_number ?? undefined,
                    location: reqInfo.location ?? undefined,
                    problemDescription: reqInfo.problem_description ?? undefined,
                    equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                    problemCategoryName: reqInfo.problem_category_name ?? undefined,
                    technicianName: reqInfo.technician_name ?? undefined,
                    requestedAt,
                    previousCompletionDate,
                    newCompletionDate,
                    extensionDays: extensionDays ?? undefined,
                    extensionReason,
                }).catch((err: any) => console.error('[MOPH Alert] Repair Extension failed:', err.message));
            }
        }

        return { success: true, message: 'บันทึกการขอเวลาเพิ่มเรียบร้อย', data: result };
    } catch (error: any) {
        console.error('[requestExtension] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// หัวหน้า IT อนุมัติ/ไม่อนุมัติคำร้องซ่อม: อัปเดต header_approve (1=อนุมัติ, 2=ไม่อนุมัติ) + header_comment
export const approveByHeader = async ({ params, body, user, set }: any) => {
    const actionBy: number | null = user?.id ?? null;
    if (!actionBy) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    const headerApprove = (body as any)?.header_approve;
    const headerComment: string | null = ((body as any)?.header_comment ?? '').trim() || null;

    if (![1, 2].includes(headerApprove)) {
        set.status = 400;
        return { success: false, message: 'header_approve ต้องเป็น 1 (อนุมัติ) หรือ 2 (ไม่อนุมัติ)' };
    }

    // กรณีไม่อนุมัติ ต้องระบุเหตุผล
    if (headerApprove === 2 && !headerComment) {
        set.status = 400;
        return { success: false, message: 'กรุณาระบุเหตุผล (header_comment) เมื่อไม่อนุมัติ' };
    }

    // ทั้งอนุมัติ/ไม่อนุมัติ → เลื่อนไป process_status_id = 9 (รออนุมัติจากหัวหน้ากลุ่มภารกิจ)
    const NEXT_STATUS_ID = 9;

    try {
        const result = await core_kon.begin(async (sql) => {
            const updated = await sql`
                UPDATE it_repair_requests
                SET header_approve = ${headerApprove},
                    header_comment = ${headerComment},
                    process_status_id = ${NEXT_STATUS_ID}
                WHERE it_repair_request_id = ${params.id}
                RETURNING it_repair_request_id, header_approve, header_comment, process_status_id
            `;

            if (updated.length === 0) {
                return null;
            }

            // เพิ่ม track log การพิจารณาของหัวหน้า IT
            const note = headerApprove === 1
                ? `หัวหน้า IT อนุมัติ${headerComment ? `: ${headerComment}` : ''} (ส่งให้หัวหน้ากลุ่มภารกิจพิจารณา)`
                : `หัวหน้า IT ไม่อนุมัติ: ${headerComment} (ส่งให้หัวหน้ากลุ่มภารกิจพิจารณา)`;

            await sql`
                INSERT INTO it_repair_requests_track (
                    it_repair_request_id, process_status_id, assigned_to, note, created_by
                ) VALUES (
                    ${params.id}, ${NEXT_STATUS_ID}, ${actionBy}, ${note}, ${actionBy}
                )
            `;

            return updated;
        });

        if (!result) {
            set.status = 404;
            return { success: false, message: 'ไม่พบคำร้องซ่อม' };
        }

        // ดึงข้อมูลคำร้องสำหรับแจ้งเตือน 2 ทาง
        const [reqInfo] = await core_kon`
            SELECT ru.id_card, r.equipment_name, r.equipment_number, r.location, r.problem_description, r.created_at,
                   et.name AS equipment_type_name,
                   pc.name AS problem_category_name,
                   CONCAT(au.pname, au.fname, ' ', au.lname) AS technician_name,
                   CONCAT(hu.pname, hu.fname, ' ', hu.lname) AS approver_name
            FROM it_repair_requests r
            LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
            LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
            LEFT JOIN users ru ON ru.id = r.created_by
            LEFT JOIN users au ON au.id = r.assigned_to
            LEFT JOIN users hu ON hu.id = ${actionBy}
            WHERE r.it_repair_request_id = ${params.id}
        `;

        if (reqInfo) {
            const requestedAt = reqInfo.created_at ? new Date(reqInfo.created_at).toISOString() : undefined;

            // ทางที่ 1: แจ้งเข้าหน่วยงาน IT ผ่าน MOPH Notify
            mophHeaderApprove({
                requestId: params.id,
                equipmentNumber: reqInfo.equipment_number,
                equipmentName: reqInfo.equipment_name,
                location: reqInfo.location ?? undefined,
                problemDescription: reqInfo.problem_description ?? undefined,
                equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                problemCategoryName: reqInfo.problem_category_name ?? undefined,
                technicianName: reqInfo.technician_name ?? undefined,
                approverName: reqInfo.approver_name ?? undefined,
                requestedAt,
                headerApprove,
                headerComment: headerComment ?? undefined,
            }).catch((err: any) => console.error('[MOPH Notify] Header Approve failed:', err.message));

            // ทางที่ 2: แจ้งกลับผู้ส่งซ่อม (created_by) ผ่าน MOPH Alert โดยใช้ id_card
            if (reqInfo.id_card) {
                sendHeaderApproveAlert(reqInfo.id_card, {
                    requestId: params.id,
                    equipmentName: reqInfo.equipment_name ?? undefined,
                    equipmentNumber: reqInfo.equipment_number ?? undefined,
                    location: reqInfo.location ?? undefined,
                    problemDescription: reqInfo.problem_description ?? undefined,
                    equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                    problemCategoryName: reqInfo.problem_category_name ?? undefined,
                    technicianName: reqInfo.technician_name ?? undefined,
                    approverName: reqInfo.approver_name ?? undefined,
                    requestedAt,
                    headerApprove,
                    headerComment: headerComment ?? undefined,
                }).catch((err: any) => console.error('[MOPH Alert] Header Approve failed:', err.message));
            }
        }

        const message = headerApprove === 1 ? 'อนุมัติคำร้องซ่อมเรียบร้อย' : 'บันทึกการไม่อนุมัติเรียบร้อย';
        return { success: true, message, data: result[0] };
    } catch (error: any) {
        console.error('[approveByHeader] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// หัวหน้ากลุ่มภารกิจอนุมัติ/ไม่อนุมัติคำร้องซ่อม (จากสถานะ 9 รออนุมัติ)
// ปฏิเสธ (2) → process_status_id = 10 (ปฏิเสธ)
// อนุมัติ (1) → ใช้ approve_process_id ของ assessment ที่ช่างเลือกเป็นสถานะถัดไป
//   เช่น สั่งซื้ออะไหล่(3)/จ้างภายนอก(5) → 3 (ออกใบ PR), แนะนำซื้อทดแทน(4) → 11 (อนุมัติซื้อทดแทน)
export const approveByMission = async ({ params, body, user, set }: any) => {
    const actionBy: number | null = user?.id ?? null;
    if (!actionBy) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    const missionApprove = (body as any)?.mission_approve;
    const missionComment: string | null = ((body as any)?.mission_comment ?? '').trim() || null;

    if (![1, 2].includes(missionApprove)) {
        set.status = 400;
        return { success: false, message: 'mission_approve ต้องเป็น 1 (อนุมัติ) หรือ 2 (ไม่อนุมัติ)' };
    }

    // กรณีไม่อนุมัติ ต้องระบุเหตุผล
    if (missionApprove === 2 && !missionComment) {
        set.status = 400;
        return { success: false, message: 'กรุณาระบุเหตุผล (mission_comment) เมื่อไม่อนุมัติ' };
    }

    try {
        const result = await core_kon.begin(async (sql) => {
            // หาคำร้อง + approve_process_id ของ assessment ที่ช่างเลือก
            const [req] = await sql`
                SELECT r.it_repair_request_id, r.repair_assessment_id,
                       ia.assessment_name, ia.approve_process_id
                FROM it_repair_requests r
                LEFT JOIN it_repair_assessments ia ON ia.repair_assessment_id = r.repair_assessment_id
                WHERE r.it_repair_request_id = ${params.id}
            `;

            if (!req) {
                return { notFound: true };
            }

            // อนุมัติแต่หา approve_process_id ไม่ได้ → assessment นี้ไม่รองรับขั้นอนุมัติจัดซื้อ
            if (missionApprove === 1 && !req.approve_process_id) {
                return { noApproveProcess: true };
            }

            const nextStatus = missionApprove === 1 ? req.approve_process_id : 10;

            const updated = await sql`
                UPDATE it_repair_requests
                SET process_status_id = ${nextStatus}
                WHERE it_repair_request_id = ${params.id}
                RETURNING it_repair_request_id, process_status_id, repair_assessment_id
            `;

            const note = missionApprove === 1
                ? `หัวหน้ากลุ่มภารกิจอนุมัติ (${req.assessment_name ?? '-'})${missionComment ? `: ${missionComment}` : ''}`
                : `หัวหน้ากลุ่มภารกิจไม่อนุมัติ: ${missionComment}`;

            await sql`
                INSERT INTO it_repair_requests_track (
                    it_repair_request_id, process_status_id, assigned_to, note, created_by
                ) VALUES (
                    ${params.id}, ${nextStatus}, ${actionBy}, ${note}, ${actionBy}
                )
            `;

            return { request: updated[0] };
        });

        if (result.notFound) {
            set.status = 404;
            return { success: false, message: 'ไม่พบคำร้องซ่อม' };
        }
        if (result.noApproveProcess) {
            set.status = 400;
            return { success: false, message: 'คำร้องนี้ไม่มี approve_process_id (ผลประเมินของช่างไม่รองรับขั้นอนุมัติจัดซื้อ)' };
        }

        // ดึงข้อมูลคำร้องสำหรับแจ้งเตือน 2 ทาง (ps = สถานะถัดไปที่เพิ่งอัปเดต, ia = ผลประเมินช่าง)
        const [reqInfo] = await core_kon`
            SELECT ru.id_card, r.equipment_name, r.equipment_number, r.location, r.problem_description, r.created_at,
                   et.name AS equipment_type_name,
                   pc.name AS problem_category_name,
                   ia.assessment_name,
                   ps.name AS next_status_name,
                   CONCAT(au.pname, au.fname, ' ', au.lname) AS technician_name,
                   CONCAT(mu.pname, mu.fname, ' ', mu.lname) AS approver_name
            FROM it_repair_requests r
            LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
            LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
            LEFT JOIN it_repair_assessments ia ON ia.repair_assessment_id = r.repair_assessment_id
            LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
            LEFT JOIN users ru ON ru.id = r.created_by
            LEFT JOIN users au ON au.id = r.assigned_to
            LEFT JOIN users mu ON mu.id = ${actionBy}
            WHERE r.it_repair_request_id = ${params.id}
        `;

        if (reqInfo) {
            const requestedAt = reqInfo.created_at ? new Date(reqInfo.created_at).toISOString() : undefined;

            // ทางที่ 1: แจ้งเข้าหน่วยงาน IT ผ่าน MOPH Notify
            mophMissionApprove({
                requestId: params.id,
                equipmentNumber: reqInfo.equipment_number,
                equipmentName: reqInfo.equipment_name,
                location: reqInfo.location ?? undefined,
                problemDescription: reqInfo.problem_description ?? undefined,
                equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                problemCategoryName: reqInfo.problem_category_name ?? undefined,
                technicianName: reqInfo.technician_name ?? undefined,
                approverName: reqInfo.approver_name ?? undefined,
                assessmentName: reqInfo.assessment_name ?? undefined,
                nextStatusName: reqInfo.next_status_name ?? undefined,
                requestedAt,
                missionApprove,
                missionComment: missionComment ?? undefined,
            }).catch((err: any) => console.error('[MOPH Notify] Mission Approve failed:', err.message));

            // ทางที่ 2: แจ้งกลับผู้ส่งซ่อม (created_by) ผ่าน MOPH Alert โดยใช้ id_card
            if (reqInfo.id_card) {
                sendMissionApproveAlert(reqInfo.id_card, {
                    requestId: params.id,
                    equipmentName: reqInfo.equipment_name ?? undefined,
                    equipmentNumber: reqInfo.equipment_number ?? undefined,
                    location: reqInfo.location ?? undefined,
                    problemDescription: reqInfo.problem_description ?? undefined,
                    equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                    problemCategoryName: reqInfo.problem_category_name ?? undefined,
                    technicianName: reqInfo.technician_name ?? undefined,
                    approverName: reqInfo.approver_name ?? undefined,
                    assessmentName: reqInfo.assessment_name ?? undefined,
                    nextStatusName: reqInfo.next_status_name ?? undefined,
                    nextStatusId: result.request?.process_status_id,
                    requestedAt,
                    missionApprove,
                    missionComment: missionComment ?? undefined,
                }).catch((err: any) => console.error('[MOPH Alert] Mission Approve failed:', err.message));
            }
        }

        const message = missionApprove === 1 ? 'หัวหน้ากลุ่มภารกิจอนุมัติเรียบร้อย' : 'บันทึกการไม่อนุมัติเรียบร้อย';
        return { success: true, message, data: result.request };
    } catch (error: any) {
        console.error('[approveByMission] DB Error:', error.message);
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

        await core_kon`
            INSERT INTO it_repair_requests_track (
                it_repair_request_id, process_status_id, assigned_to, note, created_by
            ) VALUES (
                ${params.id}, ${assessment.process_status_id}, ${actionBy}, ${assessment_detail}, ${actionBy}
            )
        `;

        const [notifyInfo] = await core_kon`
            SELECT r.equipment_number, r.equipment_name,
                   ia.assessment_name,
                   ps.name AS process_status_name,
                   CONCAT(u.pname, u.fname, ' ', u.lname) AS technician_name
            FROM it_repair_requests r
            LEFT JOIN it_repair_assessments ia ON ia.repair_assessment_id = r.repair_assessment_id
            LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
            LEFT JOIN users u ON u.id = ${actionBy}
            WHERE r.it_repair_request_id = ${params.id}
        `;

        if (notifyInfo) {
            mophRepairAssessment({
                requestId: params.id,
                equipmentNumber: notifyInfo.equipment_number,
                equipmentName: notifyInfo.equipment_name,
                assessmentName: notifyInfo.assessment_name ?? '',
                assessmentDetail: assessment_detail,
                processStatusName: notifyInfo.process_status_name ?? '',
                technicianName: notifyInfo.technician_name ?? undefined,
                partsUsed: payload.parts_used ?? undefined,
                replacementRecommendation: payload.replacement_recommendation ?? undefined,
                externalServiceDetail: payload.external_service_detail ?? undefined,
            }).catch((err: any) => console.error('[MOPH Notify] Repair Assessment failed:', err.message));
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
            SELECT repair_assessment_id, assessment_name, approve_process_id, is_active, created_at
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
            SELECT repair_assessment_id, assessment_name, approve_process_id, is_active, created_at
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

// ดึงรายการประเภทเอกสารที่เสนอ ผอ. (เช็กลิสต์ในฟอร์มบันทึกใบ PR) เฉพาะที่ active
export const getPrDocumentTypes = async ({ set }: any) => {
    try {
        const result = await core_kon`
            SELECT id, doc_code, name_th, sort_order
            FROM it_pr_document_types
            WHERE is_active = 'Y'
            ORDER BY sort_order ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงใบ PR ของคำร้องซ่อม พร้อมรายการเอกสารที่ติ๊ก (1 คำร้อง → 1 ใบ PR)
export const getRepairPr = async ({ params, set }: any) => {
    try {
        const [pr] = await core_kon`
            SELECT p.id, p.it_repair_request_id, p.pr_number, p.pr_detail,
                   p.created_by,
                   CONCAT(u.pname, u.fname, ' ', u.lname) AS created_by_name,
                   p.created_at, p.updated_at,
                   COALESCE(
                       json_agg(
                           json_build_object('id', t.id, 'doc_code', t.doc_code, 'name_th', t.name_th)
                           ORDER BY t.sort_order
                       ) FILTER (WHERE t.id IS NOT NULL),
                       '[]'
                   ) AS documents
            FROM it_repair_prs p
            LEFT JOIN users u ON u.id = p.created_by
            LEFT JOIN it_repair_pr_documents d ON d.it_repair_pr_id = p.id
            LEFT JOIN it_pr_document_types t ON t.id = d.pr_document_type_id
            WHERE p.it_repair_request_id = ${params.id}
            GROUP BY p.id, u.pname, u.fname, u.lname
        `;

        if (!pr) {
            set.status = 404;
            return { success: false, message: 'ยังไม่มีการบันทึกใบ PR ของคำร้องนี้' };
        }

        return { success: true, data: pr };
    } catch (error: any) {
        console.error('[getRepairPr] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ติดตามสถานะการออกเลข PR จากระบบ inventory (MySQL)
// ดึง pr_number ที่บันทึกไว้ (= request_id ของระบบ inventory) แล้ว query stock_request
// ว่าออกเลขแล้วหรือยัง (stock_approve_date ไม่ว่าง = อนุมัติ/ออกเลขแล้ว) พร้อมเลขเอกสารจริง (request_no)
export const getRepairPrStatus = async ({ params, set }: any) => {
    try {
        // หาใบ PR ที่บันทึกไว้ของคำร้องนี้ (1 คำร้อง → 1 ใบ PR)
        const [pr] = await core_kon`
            SELECT id, it_repair_request_id, pr_number
            FROM it_repair_prs
            WHERE it_repair_request_id = ${params.id}
        `;

        if (!pr) {
            set.status = 404;
            return { success: false, message: 'ยังไม่มีการบันทึกใบ PR ของคำร้องนี้' };
        }

        // pr_number ที่บันทึกไว้คือ request_id (pr_id) ของระบบ inventory — ต้องเป็นตัวเลข
        const requestId = Number(String(pr.pr_number).trim());
        if (!Number.isInteger(requestId) || requestId <= 0) {
            set.status = 400;
            return {
                success: false,
                message: `เลข PR ที่บันทึกไว้ (${pr.pr_number}) ไม่ใช่ request_id ที่ตรวจสอบกับระบบ inventory ได้`,
                data: { it_repair_request_id: pr.it_repair_request_id, pr_number: pr.pr_number },
            };
        }

        // ตรวจสอบสถานะการออกเลขในระบบ inventory
        const [rows]: any = await inventoryPool.query(
            `SELECT sr.stock_approve_date, sr.stock_user_approve_id, sr.request_id AS pr_id, sr.request_no,stock_po_id,request_receive_date
             FROM stock_request sr
             WHERE sr.request_id = ?`,
            [requestId]
        );

        const stock = rows?.[0];
        if (!stock) {
            return {
                success: true,
                data: {
                    it_repair_request_id: pr.it_repair_request_id,
                    pr_number: pr.pr_number,
                    found: false,
                    issued: false,
                    message: 'ไม่พบ request_id นี้ในระบบ inventory',
                },
            };
        }

        // ออกเลขแล้ว = มี stock_approve_date (อนุมัติ/ออกเลขในระบบ inventory)
        const issued = stock.stock_approve_date != null;

        // ถ้ามี stock_po_id → ดึงสถานะการจ่ายเงินของใบ PO (paid_status_name)
        let paidStatusName: string | null = null;
        if (stock.stock_po_id != null) {
            const [poRows]: any = await inventoryPool.query(
                `SELECT sps.paid_status_name
                 FROM stock_po a
                 LEFT JOIN stock_paid_status sps ON sps.paid_status_id = a.paid_status_id
                 WHERE a.stock_po_id = ?`,
                [stock.stock_po_id]
            );
            paidStatusName = poRows?.[0]?.paid_status_name ?? null;
        }

        return {
            success: true,
            data: {
                it_repair_request_id: pr.it_repair_request_id,
                pr_number: pr.pr_number,
                found: true,
                issued,
                pr_id: stock.pr_id,
                request_no: stock.request_no ?? null,
                stock_approve_date: stock.stock_approve_date ?? null,
                stock_user_approve_id: stock.stock_user_approve_id ?? null,
                request_receive_date: stock.request_receive_date ?? null,
                stock_po_id: stock.stock_po_id ?? null,
                paid_status_name: paidStatusName,
                message: issued ? 'PR ออกเลขแล้ว' : 'PR ยังไม่ออกเลข (รออนุมัติในระบบ inventory)',
            },
        };
    } catch (error: any) {
        console.error('[getRepairPrStatus] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// บันทึกใบ PR + เอกสารเตรียมนำเสนอ ผอ. (จากสถานะ 3 ออกใบ PR) → เลื่อนไป process_status_id = 7
// บันทึก it_repair_prs (1:1) + it_repair_pr_documents (เอกสารที่ติ๊ก) + เพิ่ม track + แจ้ง MOPH 2 ทาง
export const recordRepairPr = async ({ params, body, user, set }: any) => {
    const actionBy: number | null = user?.id ?? null;
    if (!actionBy) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    const prNumber: string = ((body as any)?.pr_number ?? '').trim();
    const prDetail: string | null = ((body as any)?.pr_detail ?? '').trim() || null;
    const rawDocIds = (body as any)?.document_type_ids;
    const docIds: number[] = Array.isArray(rawDocIds)
        ? rawDocIds.map(Number).filter((n: number) => !isNaN(n) && n > 0)
        : [];

    if (!prNumber) {
        set.status = 400;
        return { success: false, message: 'กรุณาระบุเลขที่ใบ PR (pr_number)' };
    }

    // สถานะถัดไปหลังบันทึกใบ PR = 7 (ขั้นตอน PO โดยพัสดุ / เสนอผู้อำนวยการ)
    const NEXT_STATUS_ID = 7;

    try {
        const result = await core_kon.begin(async (sql) => {
            // ตรวจว่าคำร้องมีอยู่จริง
            const [req] = await sql`
                SELECT it_repair_request_id FROM it_repair_requests
                WHERE it_repair_request_id = ${params.id}
            `;
            if (!req) {
                return { notFound: true };
            }

            // กันบันทึกซ้ำ (1 คำร้อง → 1 ใบ PR)
            const [existing] = await sql`
                SELECT id FROM it_repair_prs WHERE it_repair_request_id = ${params.id}
            `;
            if (existing) {
                return { conflict: true };
            }

            // เก็บเฉพาะ doc id ที่มีจริงและ active + ดึงชื่อไว้ใช้แจ้งเตือน
            const docRows = docIds.length > 0
                ? await sql`
                    SELECT id, name_th FROM it_pr_document_types
                    WHERE id = ANY(${docIds}) AND is_active = 'Y'
                    ORDER BY sort_order ASC
                `
                : [];

            const [pr] = await sql`
                INSERT INTO it_repair_prs (
                    it_repair_request_id, pr_number, pr_detail, created_by
                ) VALUES (
                    ${params.id}, ${prNumber}, ${prDetail}, ${actionBy}
                )
                RETURNING id, it_repair_request_id, pr_number, pr_detail, created_at
            `;

            for (const doc of docRows) {
                await sql`
                    INSERT INTO it_repair_pr_documents (it_repair_pr_id, pr_document_type_id)
                    VALUES (${pr.id}, ${doc.id})
                `;
            }

            await sql`
                UPDATE it_repair_requests
                SET process_status_id = ${NEXT_STATUS_ID}
                WHERE it_repair_request_id = ${params.id}
            `;

            const docNames = docRows.map((d: any) => d.name_th);
            const note = `บันทึกใบ PR เลขที่ ${prNumber}${docNames.length > 0 ? ` (เอกสาร: ${docNames.join(', ')})` : ''}`;

            await sql`
                INSERT INTO it_repair_requests_track (
                    it_repair_request_id, process_status_id, assigned_to, note, created_by
                ) VALUES (
                    ${params.id}, ${NEXT_STATUS_ID}, ${actionBy}, ${note}, ${actionBy}
                )
            `;

            return { pr, docNames };
        });

        if (result.notFound) {
            set.status = 404;
            return { success: false, message: 'ไม่พบคำร้องซ่อม' };
        }
        if (result.conflict) {
            set.status = 409;
            return { success: false, message: 'บันทึกใบ PR ของคำร้องนี้ไปแล้ว' };
        }

        // ดึงข้อมูลคำร้องสำหรับแจ้งเตือน 2 ทาง (ps = สถานะถัดไปที่เพิ่งอัปเดต)
        const [reqInfo] = await core_kon`
            SELECT ru.id_card, r.equipment_name, r.equipment_number, r.location, r.problem_description, r.created_at,
                   et.name AS equipment_type_name,
                   ps.name AS next_status_name,
                   CONCAT(cu.pname, cu.fname, ' ', cu.lname) AS recorded_by_name
            FROM it_repair_requests r
            LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
            LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
            LEFT JOIN users ru ON ru.id = r.created_by
            LEFT JOIN users cu ON cu.id = ${actionBy}
            WHERE r.it_repair_request_id = ${params.id}
        `;

        if (reqInfo) {
            const requestedAt = reqInfo.created_at ? new Date(reqInfo.created_at).toISOString() : undefined;
            const documentNames: string[] = result.docNames ?? [];

            // ทางที่ 1: แจ้งเข้าหน่วยงาน IT ผ่าน MOPH Notify
            mophRepairPr({
                requestId: params.id,
                equipmentNumber: reqInfo.equipment_number,
                equipmentName: reqInfo.equipment_name,
                location: reqInfo.location ?? undefined,
                problemDescription: reqInfo.problem_description ?? undefined,
                equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                prNumber,
                prDetail: prDetail ?? undefined,
                documentNames,
                recordedByName: reqInfo.recorded_by_name ?? undefined,
                nextStatusName: reqInfo.next_status_name ?? undefined,
                requestedAt,
            }).catch((err: any) => console.error('[MOPH Notify] Repair PR failed:', err.message));

            // ทางที่ 2: แจ้งกลับผู้ส่งซ่อม (created_by) ผ่าน MOPH Alert โดยใช้ id_card
            if (reqInfo.id_card) {
                sendRepairPrAlert(reqInfo.id_card, {
                    requestId: params.id,
                    equipmentName: reqInfo.equipment_name ?? undefined,
                    equipmentNumber: reqInfo.equipment_number ?? undefined,
                    location: reqInfo.location ?? undefined,
                    problemDescription: reqInfo.problem_description ?? undefined,
                    equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                    prNumber,
                    prDetail: prDetail ?? undefined,
                    documentNames,
                    recordedByName: reqInfo.recorded_by_name ?? undefined,
                    nextStatusName: reqInfo.next_status_name ?? undefined,
                    requestedAt,
                }).catch((err: any) => console.error('[MOPH Alert] Repair PR failed:', err.message));
            }
        }

        return { success: true, message: 'บันทึกใบ PR เรียบร้อย', data: result.pr };
    } catch (error: any) {
        console.error('[recordRepairPr] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการขั้นงานย่อย (เช็กลิสต์ในฟอร์มอัพเดทความคืบหน้า) เฉพาะที่ active
export const getRepairWorkSteps = async ({ set }: any) => {
    try {
        const result = await core_kon`
            SELECT id, step_code, name_th, sort_order
            FROM it_repair_work_steps
            WHERE is_active = 'Y'
            ORDER BY sort_order ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงประวัติการอัพเดทความคืบหน้าของคำร้องซ่อม (ล่าสุดไปเก่าสุด) พร้อมขั้นงานที่ติ๊กแต่ละครั้ง
export const getRepairProgress = async ({ params, set }: any) => {
    try {
        const rows = await core_kon`
            SELECT p.id, p.it_repair_request_id, p.note,
                   p.created_by,
                   CONCAT(u.pname, u.fname, ' ', u.lname) AS created_by_name,
                   p.created_at,
                   COALESCE(
                       json_agg(
                           json_build_object('id', s.id, 'step_code', s.step_code, 'name_th', s.name_th)
                           ORDER BY s.sort_order
                       ) FILTER (WHERE s.id IS NOT NULL),
                       '[]'
                   ) AS completed_steps
            FROM it_repair_progress p
            LEFT JOIN users u ON u.id = p.created_by
            LEFT JOIN it_repair_progress_steps ps ON ps.it_repair_progress_id = p.id
            LEFT JOIN it_repair_work_steps s ON s.id = ps.work_step_id
            WHERE p.it_repair_request_id = ${params.id} AND p.is_active = 'Y'
            GROUP BY p.id, u.pname, u.fname, u.lname
            ORDER BY p.created_at DESC
        `;

        return { success: true, data: rows };
    } catch (error: any) {
        console.error('[getRepairProgress] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// บันทึกการอัพเดทความคืบหน้างานซ่อม (ระหว่าง status 2) — append-only, สถานะคงที่ 2
// บันทึก it_repair_progress (note) + it_repair_progress_steps (ขั้นงานที่ติ๊ก) + track + แจ้ง MOPH 2 ทาง
export const recordRepairProgress = async ({ params, body, user, set }: any) => {
    const actionBy: number | null = user?.id ?? null;
    if (!actionBy) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }

    // _debug ชั่วคราว: ดู body ดิบที่ frontend ส่งมาจริง — ลบออกเมื่อแก้เสร็จ
    console.log('[recordRepairProgress] raw body:', JSON.stringify(body));

    const note: string | null = ((body as any)?.note ?? '').trim() || null;
    const rawStepIds = (body as any)?.work_step_ids;
    const stepIds: number[] = Array.isArray(rawStepIds)
        ? rawStepIds.map(Number).filter((n: number) => !isNaN(n) && n > 0)
        : [];

    // ต้องมีอย่างน้อยหมายเหตุ หรือ ขั้นงานที่ติ๊ก อย่างใดอย่างหนึ่ง
    if (!note && stepIds.length === 0) {
        set.status = 400;
        return { success: false, message: 'กรุณาระบุหมายเหตุ หรือติ๊กขั้นงานที่ทำเสร็จอย่างน้อย 1 รายการ' };
    }

    // สถานะคงที่ระหว่างดำเนินการ
    const STATUS_ID = 2;

    try {
        const result = await core_kon.begin(async (sql) => {
            const [req] = await sql`
                SELECT it_repair_request_id FROM it_repair_requests
                WHERE it_repair_request_id = ${params.id}
            `;
            if (!req) {
                return { notFound: true };
            }

            // เก็บเฉพาะ step id ที่มีจริงและ active + ดึงชื่อไว้ใช้แจ้งเตือน
            const stepRows = stepIds.length > 0
                ? await sql`
                    SELECT id, name_th FROM it_repair_work_steps
                    WHERE id = ANY(${stepIds}) AND is_active = 'Y'
                    ORDER BY sort_order ASC
                `
                : [];

            // วินิจฉัย: ติ๊กมาแต่ไม่ตรง master (seed ยังไม่ได้รัน / id ไม่ตรง) → ขั้นงานจะไม่ขึ้นใน alert
            if (stepIds.length > 0 && stepRows.length === 0) {
                console.warn(`[recordRepairProgress] work_step_ids=[${stepIds.join(',')}] ไม่ตรงกับ it_repair_work_steps (master ว่างหรือ id ไม่ตรง/ไม่ active) — ขั้นงานจะไม่แสดงใน alert`);
            }

            const [progress] = await sql`
                INSERT INTO it_repair_progress (
                    it_repair_request_id, note, created_by
                ) VALUES (
                    ${params.id}, ${note}, ${actionBy}
                )
                RETURNING id, it_repair_request_id, note, created_at
            `;

            for (const step of stepRows) {
                await sql`
                    INSERT INTO it_repair_progress_steps (it_repair_progress_id, work_step_id)
                    VALUES (${progress.id}, ${step.id})
                `;
            }

            const stepNames = stepRows.map((s: any) => s.name_th);
            const trackNote = `อัพเดทความคืบหน้า${stepNames.length > 0 ? ` (เสร็จแล้ว: ${stepNames.join(', ')})` : ''}${note ? ` — ${note}` : ''}`;

            await sql`
                INSERT INTO it_repair_requests_track (
                    it_repair_request_id, process_status_id, assigned_to, note, created_by
                ) VALUES (
                    ${params.id}, ${STATUS_ID}, ${actionBy}, ${trackNote}, ${actionBy}
                )
            `;

            return { progress, stepNames };
        });

        if (result.notFound) {
            set.status = 404;
            return { success: false, message: 'ไม่พบคำร้องซ่อม' };
        }

        // ดึงข้อมูลคำร้องสำหรับแจ้งเตือน 2 ทาง
        const [reqInfo] = await core_kon`
            SELECT ru.id_card, r.equipment_name, r.equipment_number, r.location, r.problem_description, r.created_at,
                   et.name AS equipment_type_name,
                   CONCAT(tu.pname, tu.fname, ' ', tu.lname) AS technician_name
            FROM it_repair_requests r
            LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
            LEFT JOIN users ru ON ru.id = r.created_by
            LEFT JOIN users tu ON tu.id = ${actionBy}
            WHERE r.it_repair_request_id = ${params.id}
        `;

        if (reqInfo) {
            const requestedAt = reqInfo.created_at ? new Date(reqInfo.created_at).toISOString() : undefined;
            const completedStepNames: string[] = result.stepNames ?? [];

            // ทางที่ 1: แจ้งเข้าหน่วยงาน IT ผ่าน MOPH Notify
            mophRepairProgress({
                requestId: params.id,
                equipmentNumber: reqInfo.equipment_number,
                equipmentName: reqInfo.equipment_name,
                location: reqInfo.location ?? undefined,
                problemDescription: reqInfo.problem_description ?? undefined,
                equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                completedStepNames,
                note: note ?? undefined,
                technicianName: reqInfo.technician_name ?? undefined,
                requestedAt,
            }).catch((err: any) => console.error('[MOPH Notify] Repair Progress failed:', err.message));

            // ทางที่ 2: แจ้งกลับผู้ส่งซ่อม (created_by) ผ่าน MOPH Alert โดยใช้ id_card
            if (reqInfo.id_card) {
                sendRepairProgressAlert(reqInfo.id_card, {
                    requestId: params.id,
                    equipmentName: reqInfo.equipment_name ?? undefined,
                    equipmentNumber: reqInfo.equipment_number ?? undefined,
                    location: reqInfo.location ?? undefined,
                    problemDescription: reqInfo.problem_description ?? undefined,
                    equipmentTypeName: reqInfo.equipment_type_name ?? undefined,
                    completedStepNames,
                    note: note ?? undefined,
                    technicianName: reqInfo.technician_name ?? undefined,
                    requestedAt,
                }).catch((err: any) => console.error('[MOPH Alert] Repair Progress failed:', err.message));
            }
        }

        return {
            success: true,
            message: 'บันทึกความคืบหน้าเรียบร้อย',
            data: result.progress,
            // _debug: ชั่วคราวเพื่อไล่ปัญหาขั้นงานไม่ขึ้นใน alert — ลบออกได้เมื่อแก้เสร็จ
            _debug: {
                received_step_ids: stepIds,
                matched_step_names: result.stepNames ?? [],
            },
        };
    } catch (error: any) {
        console.error('[recordRepairProgress] DB Error:', error.message);
        set.status = 500;
        return { success: false, message: error.message };
    }
};
