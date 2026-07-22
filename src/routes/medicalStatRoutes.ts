import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
    getStatMeta, getStatStaff, getStatRequests, getStatRequestById,
    createStatRequest, reviewStatRequest, deliverStatRequest, getStatFile, getStatDashboard,
} from '../controllers/medicalStatController';

const createBody = t.Object({
    email: t.String(),
    purpose_category_id: t.String(),
    purpose_detail: t.Optional(t.String()),
    data_detail: t.String(),
    period_from: t.Optional(t.String()),
    period_to: t.Optional(t.String()),
    format: t.Optional(t.String()),
    urgency_id: t.Optional(t.String()),
    sample_files: t.Union([t.File(), t.Array(t.File())]),   // 1-5 (ตรวจใน controller)
});

const reviewBody = t.Object({
    decision: t.String(),                                   // 'approve' | 'reject'
    review_type: t.Optional(t.String()),                    // 'full' | 'partial'
    assigned_to: t.Optional(t.Numeric()),
    review_note: t.Optional(t.String()),
    restricted_fields: t.Optional(t.Array(t.Object({
        field_name: t.String(),
        note: t.Optional(t.Nullable(t.String())),
    }))),
});

const deliverBody = t.Object({
    delivered_note: t.String(),
    result_files: t.Optional(t.Union([t.File(), t.Array(t.File())])),
});

export const medicalStatRoutes = new Elysia({ prefix: '/api/v1/medical-stat' })
    .use(authMiddleware)
    // static ก่อน dynamic กัน route conflict
    .get('/meta', getStatMeta, { detail: { tags: ['MedicalStat'] } })
    .get('/staff', getStatStaff, { detail: { tags: ['MedicalStat'] } })
    .get('/dashboard', getStatDashboard, { detail: { tags: ['MedicalStat'] } })
    .get('/', getStatRequests, {
        query: t.Object({
            scope: t.Optional(t.String()),
            status: t.Optional(t.String()),
            search: t.Optional(t.String()),
        }),
        detail: { tags: ['MedicalStat'] },
    })
    .post('/', createStatRequest, { body: createBody, detail: { tags: ['MedicalStat'], description: 'ยื่นคำขอ (multipart/form-data)' } })
    .get('/:id', getStatRequestById, { params: t.Object({ id: t.Numeric() }), detail: { tags: ['MedicalStat'] } })
    .get('/:id/files/:fileId', getStatFile, { params: t.Object({ id: t.Numeric(), fileId: t.Numeric() }), detail: { tags: ['MedicalStat'] } })
    .post('/:id/review', reviewStatRequest, { params: t.Object({ id: t.Numeric() }), body: reviewBody, detail: { tags: ['MedicalStat'] } })
    .post('/:id/deliver', deliverStatRequest, { params: t.Object({ id: t.Numeric() }), body: deliverBody, detail: { tags: ['MedicalStat'], description: 'ส่งมอบ (multipart/form-data)' } });
