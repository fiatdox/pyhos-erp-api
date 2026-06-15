import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
    getUserSystems,
    getUserRequests,
    createUserRequest,
    getUserRequestById,
    issueCredential,
    rejectUserRequest,
    cancelUserRequest,
    getUserRequestDashboard,
} from '../controllers/itUserRequestController';

const CreateBody = t.Object({
    requester_user_id: t.Optional(t.Union([t.Integer(), t.Null()])),
    requester_name:    t.String({ minLength: 1, maxLength: 150 }),
    position_name:     t.Optional(t.Union([t.String({ maxLength: 150 }), t.Null()])),
    department:        t.Optional(t.Union([t.String({ maxLength: 150 }), t.Null()])),
    phone:             t.Optional(t.Union([t.String({ maxLength: 30 }), t.Null()])),
    system_id:         t.Integer({ minimum: 1 }),
    purpose:           t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
    note:              t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
});

const IssueBody = t.Object({
    username:        t.String({ minLength: 1, maxLength: 60 }),
    password:        t.String({ minLength: 1 }),
    morprom_target:  t.Object({
        citizen_id: t.String({ minLength: 1 }),
        user_ref:   t.Optional(t.Union([t.Integer(), t.Null()])),
    }),
    issued_by:       t.Optional(t.String({ maxLength: 100 })),
    note:            t.Optional(t.String({ maxLength: 2000 })),
});

const ActionBody = t.Object({
    reason: t.Optional(t.String({ maxLength: 2000 })),
    actor:  t.String({ minLength: 1, maxLength: 100 }),
});

export const itUserRequestRoutes = new Elysia({ prefix: '/api/v1/it/user-requests' })
    .use(authMiddleware)

    // 1) master ระบบ (ต้องมาก่อน /:id)
    .get('/systems', getUserSystems, {
        query: t.Object({ active_only: t.Optional(t.String()) }),
        detail: { tags: ['IT User Request'], summary: 'โหลด dropdown ระบบที่ขอใช้งาน' },
    })

    // 7) dashboard (ต้องมาก่อน /:id)
    .get('/dashboard', getUserRequestDashboard, {
        query: t.Object({
            date_from: t.Optional(t.String()),
            date_to:   t.Optional(t.String()),
        }),
        detail: { tags: ['IT User Request'], summary: 'แดชบอร์ดสรุป — KPI + ทุก chart ใน 1 request' },
    })

    // 2) รายการคำร้อง
    .get('/', getUserRequests, {
        query: t.Object({
            status:    t.Optional(t.String()),
            system_id: t.Optional(t.Numeric()),
            date_from: t.Optional(t.String()),
            date_to:   t.Optional(t.String()),
            search:    t.Optional(t.String()),
            page:      t.Optional(t.Numeric()),
            limit:     t.Optional(t.Numeric()),
            sort:      t.Optional(t.String()),
        }),
        detail: { tags: ['IT User Request'], summary: 'รายการคำร้อง (filter + pagination)' },
    })

    // 3) สร้างคำร้องใหม่
    .post('/', createUserRequest, {
        body: CreateBody,
        detail: { tags: ['IT User Request'], summary: 'สร้างคำร้องขอบัญชี (สร้าง request_no อัตโนมัติ, status=pending)' },
    })

    // 4) รายละเอียดคำร้อง
    .get('/:id', getUserRequestById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT User Request'], summary: 'รายละเอียดคำร้องรายเดียว' },
    })

    // 5) ออกรหัส + ส่งหมอพร้อม → issued
    .post('/:id/issue', issueCredential, {
        params: t.Object({ id: t.Numeric() }),
        body: IssueBody,
        detail: {
            tags: ['IT User Request'],
            summary: 'ออกรหัสและส่ง username/password ผ่านหมอพร้อม',
            description: 'ตรวจสถานะต้องเป็น pending → ส่งหมอพร้อม → สำเร็จจึงตั้ง issued + notified_at. username/password เป็น transient ไม่บันทึก/ไม่ log. ส่งหมอพร้อมไม่สำเร็จคืน 502 (คงสถานะ pending)',
        },
    })

    // 6) ปฏิเสธคำร้อง → rejected
    .post('/:id/reject', rejectUserRequest, {
        params: t.Object({ id: t.Numeric() }),
        body: ActionBody,
        detail: { tags: ['IT User Request'], summary: 'ปฏิเสธคำร้อง (จาก pending → rejected)' },
    })

    // 6) ยกเลิกคำร้อง → cancelled
    .post('/:id/cancel', cancelUserRequest, {
        params: t.Object({ id: t.Numeric() }),
        body: ActionBody,
        detail: { tags: ['IT User Request'], summary: 'ยกเลิกคำร้อง (จาก pending → cancelled)' },
    });
