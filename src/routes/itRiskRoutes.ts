import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
    getRiskMaster,
    getAssessments,
    createAssessment,
    getAssessmentById,
    patchAssessment,
    updateAssessmentItem,
    bulkUpdateAssessmentItems,
    getAssessmentSummary,
} from '../controllers/itRiskController';

const AssessmentItemBody = t.Object({
    probability:        t.Optional(t.Union([t.Integer({ minimum: 1, maximum: 5 }), t.Null()])),
    impact:             t.Optional(t.Union([t.Integer({ minimum: 1, maximum: 5 }), t.Null()])),
    existing_control:   t.Optional(t.Union([t.String(), t.Null()])),
    additional_control: t.Optional(t.Union([t.String(), t.Null()])),
    responsible_person: t.Optional(t.Union([t.String(), t.Null()])),
    target_date:        t.Optional(t.Union([t.String(), t.Null()])),
    notes:              t.Optional(t.Union([t.String(), t.Null()])),
});

export const itRiskRoutes = new Elysia({ prefix: '/api/v1/it/risk' })
    .use(authMiddleware)

    // 1) Master data
    .get('/master', getRiskMaster, {
        detail: { tags: ['IT Risk'], summary: 'Master data (categories, items, scale levels)' }
    })

    // 2) รายการรอบประเมิน
    .get('/assessments', getAssessments, {
        query: t.Object({
            year:   t.Optional(t.Numeric()),
            status: t.Optional(t.String()),
            page:   t.Optional(t.Numeric()),
            limit:  t.Optional(t.Numeric()),
        }),
        detail: { tags: ['IT Risk'], summary: 'รายการรอบประเมินทั้งหมด' }
    })

    // 3) สร้างรอบประเมินใหม่
    .post('/assessments', createAssessment, {
        body: t.Object({
            assessment_code:  t.String({ maxLength: 50 }),
            assessment_year:  t.Integer({ minimum: 2500, maximum: 2700 }),
            assessment_round: t.Optional(t.Integer()),
            department:       t.Optional(t.String({ maxLength: 255 })),
            assessed_by:      t.Optional(t.String({ maxLength: 255 })),
            assessed_date:    t.Optional(t.String()),
            notes:            t.Optional(t.String()),
        }),
        detail: { tags: ['IT Risk'], summary: 'สร้างรอบประเมินใหม่ (auto-init items)' }
    })

    // 4) รายละเอียดรอบประเมิน
    .get('/assessments/:id', getAssessmentById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT Risk'], summary: 'รายละเอียดรอบประเมิน (header + items)' }
    })

    // 5) แก้ไข header
    .patch('/assessments/:id', patchAssessment, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            status:        t.Optional(t.String()),
            approved_by:   t.Optional(t.Union([t.String(), t.Null()])),
            approved_date: t.Optional(t.Union([t.String(), t.Null()])),
            notes:         t.Optional(t.Union([t.String(), t.Null()])),
        }),
        detail: { tags: ['IT Risk'], summary: 'แก้ไข header รอบประเมิน (status, approved_by)' }
    })

    // 8) Summary + Matrix  (ต้องอยู่ก่อน :id/items/:itemId เพื่อกัน route conflict)
    .get('/assessments/:id/summary', getAssessmentSummary, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT Risk'], summary: 'สรุป stats + Risk Matrix + Top Risks' }
    })

    // 7) Bulk update items
    .post('/assessments/:id/items/bulk', bulkUpdateAssessmentItems, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            items: t.Array(t.Object({
                item_id:     t.Integer(),
                probability: t.Union([t.Integer({ minimum: 1, maximum: 5 }), t.Null()]),
                impact:      t.Union([t.Integer({ minimum: 1, maximum: 5 }), t.Null()]),
            }))
        }),
        detail: { tags: ['IT Risk'], summary: 'บันทึกหลายรายการพร้อมกัน (bulk, transactional)' }
    })

    // 6) Update item รายข้อ
    .put('/assessments/:id/items/:itemId', updateAssessmentItem, {
        params: t.Object({ id: t.Numeric(), itemId: t.Numeric() }),
        body: AssessmentItemBody,
        detail: { tags: ['IT Risk'], summary: 'บันทึก P/I รายข้อ (auto-save)' }
    });
