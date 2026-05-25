import { core_kon } from '../db/db';

const getRiskLevel = (score: number | null): string | null => {
    if (score === null || score === undefined) return null;
    if (score >= 17) return 'critical';
    if (score >= 9) return 'high';
    if (score >= 4) return 'medium';
    return 'low';
};

// 1) GET /master
export const getRiskMaster = async ({ set }: any) => {
    try {
        const [categories, items, scale_levels] = await Promise.all([
            core_kon`
                SELECT category_id, category_no, category_name_th
                FROM it_risk_categories
                WHERE is_active = TRUE
                ORDER BY category_no
            `,
            core_kon`
                SELECT item_id, category_id, item_code, item_name_th, is_summary, sort_order
                FROM it_risk_items
                WHERE is_active = TRUE
                ORDER BY sort_order
            `,
            core_kon`
                SELECT level, label_th, probability_desc, impact_desc
                FROM it_risk_scale_levels
                ORDER BY level
            `,
        ]);
        return { success: true, data: { categories, items, scale_levels } };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 2) GET /assessments
export const getAssessments = async ({ query, set }: any) => {
    try {
        const page = Math.max(1, Number(query?.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(query?.limit) || 20));
        const offset = (page - 1) * limit;

        const conditions: string[] = [];
        const args: any = {};

        let whereClause = core_kon`WHERE 1=1`;

        const rows = await core_kon`
            SELECT
                a.assessment_id, a.assessment_code, a.assessment_year, a.assessment_round,
                a.department, a.assessed_by, a.assessed_date, a.status, a.updated_at,
                COUNT(d.detail_id) FILTER (WHERE d.probability IS NOT NULL AND d.impact IS NOT NULL) AS assessed_items,
                COUNT(d.detail_id) AS total_items,
                COUNT(d.detail_id) FILTER (WHERE d.risk_score >= 9) AS high_risk_count
            FROM it_risk_assessments a
            LEFT JOIN it_risk_assessment_details d ON d.assessment_id = a.assessment_id
            ${query?.year ? core_kon`AND a.assessment_year = ${Number(query.year)}` : core_kon``}
            ${query?.status ? core_kon`AND a.status = ${query.status}` : core_kon``}
            GROUP BY a.assessment_id
            ORDER BY a.assessment_id DESC
            LIMIT ${limit} OFFSET ${offset}
        `;

        const [countRow] = await core_kon`
            SELECT COUNT(*) AS total FROM it_risk_assessments a
            WHERE 1=1
            ${query?.year ? core_kon`AND a.assessment_year = ${Number(query.year)}` : core_kon``}
            ${query?.status ? core_kon`AND a.status = ${query.status}` : core_kon``}
        `;

        const total = Number(countRow.total);
        return {
            success: true,
            data: rows.map(r => ({
                ...r,
                assessed_items: Number(r.assessed_items),
                total_items: Number(r.total_items),
                high_risk_count: Number(r.high_risk_count),
            })),
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 3) POST /assessments
export const createAssessment = async ({ body, set }: any) => {
    try {
        const {
            assessment_code, assessment_year, assessment_round = 1,
            department, assessed_by, assessed_date, notes,
        } = body;

        const existing = await core_kon`
            SELECT assessment_id FROM it_risk_assessments WHERE assessment_code = ${assessment_code}
        `;
        if (existing.length > 0) {
            set.status = 409;
            return { success: false, error: { code: 'DUPLICATE', message: 'assessment_code ซ้ำ', field: 'assessment_code' } };
        }

        const [assessment] = await core_kon`
            INSERT INTO it_risk_assessments
                (assessment_code, assessment_year, assessment_round, department, assessed_by, assessed_date, notes, status)
            VALUES
                (${assessment_code}, ${assessment_year}, ${assessment_round},
                 ${department ?? null}, ${assessed_by ?? null}, ${assessed_date ?? null}, ${notes ?? null}, 'draft')
            RETURNING assessment_id, assessment_code, status
        `;

        const items = await core_kon`
            SELECT item_id FROM it_risk_items WHERE is_active = TRUE
        `;

        if (items.length > 0) {
            await core_kon`
                INSERT INTO it_risk_assessment_details (assessment_id, item_id)
                SELECT ${assessment.assessment_id}, item_id FROM it_risk_items WHERE is_active = TRUE
            `;
        }

        set.status = 201;
        return {
            success: true,
            data: { ...assessment, items_initialized: items.length },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 4) GET /assessments/:id
export const getAssessmentById = async ({ params, set }: any) => {
    try {
        const id = Number(params.id);
        const [header] = await core_kon`
            SELECT assessment_id, assessment_code, assessment_year, assessment_round,
                   department, assessed_by, assessed_date, status,
                   approved_by, approved_date, notes, created_at, updated_at
            FROM it_risk_assessments
            WHERE assessment_id = ${id}
        `;
        if (!header) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบรอบประเมิน' } };
        }

        const items = await core_kon`
            SELECT
                d.detail_id, d.item_id,
                c.category_no, c.category_name_th,
                i.item_code, i.item_name_th, i.is_summary,
                d.probability, d.impact, d.risk_score, d.risk_level,
                d.existing_control, d.additional_control,
                d.responsible_person, d.target_date, d.notes
            FROM it_risk_assessment_details d
            JOIN it_risk_items i ON i.item_id = d.item_id
            JOIN it_risk_categories c ON c.category_id = i.category_id
            WHERE d.assessment_id = ${id}
            ORDER BY i.sort_order
        `;

        return { success: true, data: { header, items } };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 5) PATCH /assessments/:id
export const patchAssessment = async ({ params, body, set }: any) => {
    try {
        const id = Number(params.id);
        const { status, approved_by, approved_date, notes } = body;

        const fields: any = {};
        if (status !== undefined) fields.status = status;
        if (approved_by !== undefined) fields.approved_by = approved_by;
        if (approved_date !== undefined) fields.approved_date = approved_date;
        if (notes !== undefined) fields.notes = notes;

        if (Object.keys(fields).length === 0) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'ไม่มี field ที่ต้องการแก้ไข' } };
        }

        const [updated] = await core_kon`
            UPDATE it_risk_assessments
            SET
                status       = COALESCE(${fields.status ?? null}, status),
                approved_by  = COALESCE(${fields.approved_by ?? null}, approved_by),
                approved_date = COALESCE(${fields.approved_date ?? null}, approved_date),
                notes        = COALESCE(${fields.notes ?? null}, notes),
                updated_at   = NOW()
            WHERE assessment_id = ${id}
            RETURNING assessment_id, status, updated_at
        `;

        if (!updated) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบรอบประเมิน' } };
        }

        return { success: true, data: updated };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 6) PUT /assessments/:id/items/:itemId
export const updateAssessmentItem = async ({ params, body, set }: any) => {
    try {
        const assessmentId = Number(params.id);
        const itemId = Number(params.itemId);
        const { probability, impact, existing_control, additional_control, responsible_person, target_date, notes } = body;

        if (probability !== null && probability !== undefined && (probability < 1 || probability > 5)) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'probability ต้องอยู่ระหว่าง 1-5', field: 'probability' } };
        }
        if (impact !== null && impact !== undefined && (impact < 1 || impact > 5)) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'impact ต้องอยู่ระหว่าง 1-5', field: 'impact' } };
        }

        const [detail] = await core_kon`
            UPDATE it_risk_assessment_details
            SET
                probability        = ${probability ?? null},
                impact             = ${impact ?? null},
                existing_control   = ${existing_control ?? null},
                additional_control = ${additional_control ?? null},
                responsible_person = ${responsible_person ?? null},
                target_date        = ${target_date ?? null},
                notes              = ${notes ?? null},
                updated_at         = NOW()
            WHERE assessment_id = ${assessmentId} AND item_id = ${itemId}
            RETURNING detail_id, item_id, probability, impact, risk_score, risk_level
        `;

        if (!detail) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบรายการประเมิน' } };
        }

        return { success: true, data: detail };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 7) POST /assessments/:id/items/bulk
export const bulkUpdateAssessmentItems = async ({ params, body, set }: any) => {
    try {
        const assessmentId = Number(params.id);
        const { items } = body as { items: { item_id: number; probability: number | null; impact: number | null }[] };

        if (!items || items.length === 0) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'items ต้องไม่ว่างเปล่า' } };
        }

        let updatedCount = 0;
        const failed: { item_id: number; reason: string }[] = [];

        await core_kon.begin(async sql => {
            for (const item of items) {
                const { item_id, probability, impact } = item;
                try {
                    const [result] = await sql`
                        UPDATE it_risk_assessment_details
                        SET
                            probability = ${probability ?? null},
                            impact      = ${impact ?? null},
                            updated_at  = NOW()
                        WHERE assessment_id = ${assessmentId} AND item_id = ${item_id}
                        RETURNING detail_id
                    `;
                    if (result) updatedCount++;
                    else failed.push({ item_id, reason: 'NOT_FOUND' });
                } catch (e: any) {
                    failed.push({ item_id, reason: e.message });
                }
            }
        });

        return { success: true, data: { updated_count: updatedCount, failed } };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 8) GET /assessments/:id/summary
export const getAssessmentSummary = async ({ params, set }: any) => {
    try {
        const id = Number(params.id);

        const exists = await core_kon`SELECT assessment_id FROM it_risk_assessments WHERE assessment_id = ${id}`;
        if (exists.length === 0) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบรอบประเมิน' } };
        }

        const details = await core_kon`
            SELECT d.probability, d.impact, d.risk_score, d.risk_level,
                   i.item_code, i.item_name_th
            FROM it_risk_assessment_details d
            JOIN it_risk_items i ON i.item_id = d.item_id
            WHERE d.assessment_id = ${id} AND i.is_active = TRUE
        `;

        const totalItems = details.length;
        const assessed = details.filter((d: any) => d.probability !== null && d.impact !== null);
        const stats = {
            total_items: totalItems,
            assessed_items: assessed.length,
            critical_count: assessed.filter((d: any) => d.risk_level === 'critical').length,
            high_count: assessed.filter((d: any) => d.risk_level === 'high').length,
            medium_count: assessed.filter((d: any) => d.risk_level === 'medium').length,
            low_count: assessed.filter((d: any) => d.risk_level === 'low').length,
        };

        // group matrix by probability+impact
        const matrixMap = new Map<string, any>();
        for (const d of assessed as any[]) {
            const key = `${d.probability}-${d.impact}`;
            if (!matrixMap.has(key)) {
                matrixMap.set(key, {
                    probability: Number(d.probability),
                    impact: Number(d.impact),
                    score: Number(d.risk_score),
                    level: d.risk_level,
                    items: [],
                });
            }
            matrixMap.get(key).items.push({ item_code: d.item_code, item_name_th: d.item_name_th });
        }

        const topRisks = [...assessed as any[]]
            .filter((d: any) => d.risk_score !== null)
            .sort((a: any, b: any) => Number(b.risk_score) - Number(a.risk_score))
            .slice(0, 10)
            .map((d: any) => ({
                item_code: d.item_code,
                item_name_th: d.item_name_th,
                probability: Number(d.probability),
                impact: Number(d.impact),
                risk_score: Number(d.risk_score),
                risk_level: d.risk_level,
            }));

        return {
            success: true,
            data: {
                stats,
                matrix: [...matrixMap.values()],
                top_risks: topRisks,
            },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};
