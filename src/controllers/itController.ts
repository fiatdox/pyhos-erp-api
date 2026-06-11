import { join } from 'path';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { core_kon } from '../db/db';
import { mophItMatenance, mophReceiveAssignment, mophRepairAssessment, mophRejectAssignment, mophRequestExtension, mophHeaderApprove } from '../utils/mophNotify';
import { sendRepairRejectedAlert, sendRepairReceivedAlert, sendRepairExtensionAlert, sendHeaderApproveAlert } from '../utils/mophAlert';

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
                    r.repair_assessment_id,
                    ia.assessment_name,
                    r.assessment_detail
                FROM it_repair_requests r
                LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
                LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
                LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
                LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
                LEFT JOIN it_repair_assessments ia ON ia.repair_assessment_id = r.repair_assessment_id
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
                    m2.name AS submajor_name,
                    r.repair_assessment_id,
                    ia.assessment_name,
                    r.assessment_detail
                FROM it_repair_requests r
                LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
                LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
                LEFT JOIN it_priority_levels pl ON pl.it_priority_level_id = r.it_priority_level_id
                LEFT JOIN it_process_statuses ps ON ps.id = r.process_status_id
                LEFT JOIN it_repair_assessments ia ON ia.repair_assessment_id = r.repair_assessment_id
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
