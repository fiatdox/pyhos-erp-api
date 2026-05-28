import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
    getIncidentMaster,
    getIncidents,
    createIncident,
    getIncidentById,
    updateIncident,
    deleteIncident,
    getIncidentDashboard,
    getIncidentReport,
} from '../controllers/itIncidentReportController';

const IncidentBody = t.Object({
    incident_date:       t.String(),
    detected_date:       t.String(),
    report_date:         t.String(),
    reported_by:         t.String({ maxLength: 100 }),
    department:          t.String({ maxLength: 100 }),
    threat_type_id:      t.Integer(),
    attack_vector_id:    t.Integer(),
    affected_system_id:  t.Integer(),
    affected_assets:     t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
    description:         t.String({ maxLength: 5000 }),
    severity:            t.Union([t.Literal('critical'), t.Literal('high'), t.Literal('medium'), t.Literal('low')]),
    impact:              t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
    affected_users:      t.Integer({ minimum: 0 }),
    data_breached:       t.Union([t.Literal('Y'), t.Literal('N')]),
    continuity_impact:   t.Union([t.Literal('Y'), t.Literal('N')]),
    root_cause:          t.Optional(t.Union([t.String({ maxLength: 5000 }), t.Null()])),
    immediate_actions:   t.Optional(t.Union([t.String({ maxLength: 5000 }), t.Null()])),
    long_term_measures:  t.Optional(t.Union([t.String({ maxLength: 5000 }), t.Null()])),
    resolution:          t.Optional(t.Union([t.String({ maxLength: 5000 }), t.Null()])),
    resolved_date:       t.Optional(t.Union([t.String(), t.Null()])),
    resolved_by:         t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
    status:              t.Union([t.Literal('open'), t.Literal('in_progress'), t.Literal('resolved'), t.Literal('closed')]),
    ncsa_reported:       t.Union([t.Literal('Y'), t.Literal('N')]),
    ncsa_report_date:    t.Optional(t.Union([t.String(), t.Null()])),
    is_sla_related:      t.Union([t.Literal('Y'), t.Literal('N')]),
});

export const itIncidentReportRoutes = new Elysia({ prefix: '/api/v1/it/incident' })
    .use(authMiddleware)

    // 1) Master data  (ก่อน /:id ทุกกรณี)
    .get('/master', getIncidentMaster, {
        detail: { tags: ['IT Incident Report'], summary: 'Master data — threat types, attack vectors, severities, statuses, affected systems' }
    })

    // 7) Dashboard
    .get('/dashboard', getIncidentDashboard, {
        query: t.Object({
            month:     t.Optional(t.String()),
            date_from: t.Optional(t.String()),
            date_to:   t.Optional(t.String()),
        }),
        detail: { tags: ['IT Incident Report'], summary: 'Dashboard — KPI + ทุก chart ใน 1 request' }
    })

    // 8) PDF report data
    .get('/report', getIncidentReport, {
        query: t.Object({ month: t.String() }),
        detail: { tags: ['IT Incident Report'], summary: 'ข้อมูลสำหรับสร้าง PDF รายงานรายเดือน' }
    })

    // 2) รายการอุบัติการณ์
    .get('/', getIncidents, {
        query: t.Object({
            date_from:     t.Optional(t.String()),
            date_to:       t.Optional(t.String()),
            month:         t.Optional(t.String()),
            status:        t.Optional(t.String()),
            severity:      t.Optional(t.String()),
            threat_type:   t.Optional(t.String()),
            data_breached: t.Optional(t.String()),
            ncsa_reported: t.Optional(t.String()),
            search:        t.Optional(t.String()),
            page:          t.Optional(t.Numeric()),
            limit:         t.Optional(t.Numeric()),
            sort:          t.Optional(t.String()),
        }),
        detail: { tags: ['IT Incident Report'], summary: 'รายการอุบัติการณ์ (filter + pagination)' }
    })

    // 3) บันทึกอุบัติการณ์ใหม่
    .post('/', createIncident, {
        body: IncidentBody,
        detail: { tags: ['IT Incident Report'], summary: 'บันทึกอุบัติการณ์ใหม่ (สร้าง incident_no อัตโนมัติ)' }
    })

    // 4) รายละเอียด
    .get('/:id', getIncidentById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT Incident Report'], summary: 'รายละเอียดอุบัติการณ์ (สำหรับเปิด Drawer edit)' }
    })

    // 5) แก้ไข
    .put('/:id', updateIncident, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Partial(IncidentBody),
        detail: { tags: ['IT Incident Report'], summary: 'แก้ไขอุบัติการณ์ (PATCH semantics)' }
    })

    // 6) ลบ (soft delete)
    .delete('/:id', deleteIncident, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT Incident Report'], summary: 'ลบอุบัติการณ์ (soft delete — is_active = N)' }
    });
