import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
    getActivityMaster,
    getActivityLogs,
    createActivityLog,
    getActivityLogById,
    updateActivityLog,
    deleteActivityLog,
    getDailySchedule,
    getActivityDashboard,
} from '../controllers/itActivityController';

const LogBody = t.Object({
    log_date:       t.String(),
    staff_id:       t.Integer(),
    type_code:      t.String(),
    system_code:    t.String(),
    status_code:    t.String(),
    start_time:     t.String(),
    end_time:       t.String(),
    minutes_used:   t.Integer({ minimum: 1, maximum: 600 }),
    detail:         t.String({ maxLength: 2000 }),
    outcome:        t.Optional(t.Union([t.String(), t.Null()])),
    priority_code:  t.Optional(t.String()),
    source_code:    t.Optional(t.String()),
    location:       t.Optional(t.Union([t.String({ maxLength: 200 }), t.Null()])),
    asset_code:     t.Optional(t.Union([t.String({ maxLength: 60 }), t.Null()])),
    affected_users: t.Optional(t.Integer({ minimum: 0, maximum: 10000 })),
    is_overtime:    t.Optional(t.Boolean()),
    ticket_id:      t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
});

export const itActivityRoutes = new Elysia({ prefix: '/api/v1/it/activity' })
    .use(authMiddleware)

    // 1) Master data
    .get('/master', getActivityMaster, {
        detail: { tags: ['IT Activity'], summary: 'Master data (staff, types, systems, statuses, priorities, sources)' }
    })

    // 2) รายการกิจกรรม
    .get('/logs', getActivityLogs, {
        query: t.Object({
            date_from:   t.Optional(t.String()),
            date_to:     t.Optional(t.String()),
            fiscal_year: t.Optional(t.Numeric()),
            staff_id:    t.Optional(t.Numeric()),
            type_code:   t.Optional(t.String()),
            system_code: t.Optional(t.String()),
            status_code: t.Optional(t.String()),
            priority:    t.Optional(t.String()),
            source:      t.Optional(t.String()),
            is_overtime: t.Optional(t.String()),
            is_closed:   t.Optional(t.String()),
            search:      t.Optional(t.String()),
            page:        t.Optional(t.Numeric()),
            limit:       t.Optional(t.Numeric()),
            sort:        t.Optional(t.String()),
        }),
        detail: { tags: ['IT Activity'], summary: 'รายการกิจกรรม (filter + pagination)' }
    })

    // 7) ตารางงานรายวัน  (ต้องอยู่ก่อน /logs/:id เพื่อกัน route conflict)
    .get('/daily', getDailySchedule, {
        query: t.Object({
            date:     t.String(),
            staff_id: t.Optional(t.Numeric()),
        }),
        detail: { tags: ['IT Activity'], summary: 'ตารางงานรายวัน (slot-based, row = staff)' }
    })

    // 8) Dashboard
    .get('/dashboard', getActivityDashboard, {
        query: t.Object({
            fiscal_year: t.Numeric(),
            staff_id:    t.Optional(t.Numeric()),
        }),
        detail: { tags: ['IT Activity'], summary: 'Dashboard — ทุก chart ใน 1 request (KPI, trend, heatmap ฯลฯ)' }
    })

    // 3) สร้างกิจกรรมใหม่
    .post('/logs', createActivityLog, {
        body: LogBody,
        detail: { tags: ['IT Activity'], summary: 'บันทึกกิจกรรมใหม่' }
    })

    // 4) รายละเอียดกิจกรรม
    .get('/logs/:id', getActivityLogById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT Activity'], summary: 'รายละเอียดกิจกรรม (สำหรับเปิด Drawer edit)' }
    })

    // 5) แก้ไขกิจกรรม
    .put('/logs/:id', updateActivityLog, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Partial(LogBody),
        detail: { tags: ['IT Activity'], summary: 'แก้ไขกิจกรรม (PATCH semantics — ส่งเฉพาะ field ที่เปลี่ยน)' }
    })

    // 6) ลบกิจกรรม
    .delete('/logs/:id', deleteActivityLog, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT Activity'], summary: 'ลบกิจกรรม (hard delete)' }
    });
