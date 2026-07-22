import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import {
    getRoadmap, getRoadmapMeta, createTask, updateTask, deleteTask, addProgress, createLink, deleteLink, resetRoadmap,
    createKpi, updateKpi, deleteKpi,
} from '../controllers/itRoadmapController';

const IT_ROLES = ['ADMIN', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT', 'IT_STAFF'];

// Swagger tag ของโมดูลนี้ — ประกาศไว้ที่นี่เพื่อแก้ไขง่าย (index.ts นำไปรวม)
export const IT_ROADMAP_TAG = 'IT Roadmap';
export const itRoadmapSwaggerTags = [
    { name: IT_ROADMAP_TAG, description: 'IT Project Roadmap — แผนโครงการ/งานย่อย/หมุดหมาย + dependency + ความคืบหน้า + งบประมาณ/KPI แยกตามปีงบประมาณ (อ่านได้ทุกคน, แก้ไขเฉพาะเจ้าหน้าที่ IT)' },
];
const d = (summary: string) => ({ tags: [IT_ROADMAP_TAG], summary });

const taskBody = t.Object({
    text: t.String(),
    type: t.String(),
    mission: t.String(),
    start: t.String(),
    end: t.String(),
    code: t.Optional(t.Nullable(t.String())),
    parent: t.Optional(t.Nullable(t.String())),
    fiscalYear: t.Optional(t.Nullable(t.Number())),
    progress: t.Optional(t.Nullable(t.Number())),
    status: t.Optional(t.Nullable(t.String())),
    priority: t.Optional(t.Nullable(t.String())),
    owner: t.Optional(t.Nullable(t.String())),
    ownerUserId: t.Optional(t.Nullable(t.Number())),
    ownerPosition: t.Optional(t.Nullable(t.String())),
    department: t.Optional(t.Nullable(t.String())),
    contact: t.Optional(t.Nullable(t.String())),
    team: t.Optional(t.Nullable(t.Array(t.String()))),
    budgetRequested: t.Optional(t.Nullable(t.Number())),
    budgetApproved: t.Optional(t.Nullable(t.Number())),
    budgetSpent: t.Optional(t.Nullable(t.Number())),
    budgetSource: t.Optional(t.Nullable(t.String())),
    kpiCode: t.Optional(t.Nullable(t.String())),
    kpiName: t.Optional(t.Nullable(t.String())),
    kpiTarget: t.Optional(t.Nullable(t.String())),
    description: t.Optional(t.Nullable(t.String())),
    expectedOutcome: t.Optional(t.Nullable(t.String())),
    vendor: t.Optional(t.Nullable(t.String())),
    documents: t.Optional(t.Nullable(t.Array(t.String()))),
    riskNote: t.Optional(t.Nullable(t.String())),
});

const progressBody = t.Object({
    progress: t.Number(),
    note: t.Optional(t.Nullable(t.String())),
    reportedBy: t.Optional(t.Nullable(t.String())),
    budgetSpentDelta: t.Optional(t.Nullable(t.Number())),
    date: t.Optional(t.String()),
});

const linkBody = t.Object({ source: t.String(), target: t.String(), type: t.Optional(t.Number()) });

const kpiBody = t.Object({
    code: t.Optional(t.String()),
    name: t.String(),
    target: t.Optional(t.Nullable(t.String())),
    sort: t.Optional(t.Number()),
    active: t.Optional(t.Boolean()),
    years: t.Optional(t.Array(t.Number())),
});

export const itRoadmapRoutes = new Elysia({ prefix: '/api/v1/it/roadmap' })
    .use(authMiddleware)
    // ── อ่านได้ทุกคนที่ล็อกอิน ──
    .get('/', getRoadmap, { detail: d('ดึงแผนงานทั้งหมด (tasks + links)') })
    .get('/meta', getRoadmapMeta, { detail: d('ตัวเลือก master (สถานะ/ลำดับ/กลุ่มงาน/KPI/หน่วยงาน) + รายชื่อเจ้าหน้าที่ IT') })
    // ── แก้ไข เฉพาะเจ้าหน้าที่ IT (มีผลกับ route ที่ประกาศหลังบรรทัดนี้) ──
    .use(requireRoles(...IT_ROLES))
    .post('/tasks', createTask, { body: taskBody, detail: d('เพิ่มโครงการ/กิจกรรม/หมุดหมาย') })
    .put('/tasks/:id', updateTask, { params: t.Object({ id: t.Numeric() }), body: taskBody, detail: d('แก้ไขงาน') })
    .delete('/tasks/:id', deleteTask, { params: t.Object({ id: t.Numeric() }), detail: d('ลบงาน (งานย่อย/ลิงก์/ล็อก cascade)') })
    .post('/tasks/:id/progress', addProgress, { params: t.Object({ id: t.Numeric() }), body: progressBody, detail: d('บันทึกความคืบหน้า (+ อัปเดต progress/งบเบิกจ่าย)') })
    .post('/links', createLink, { body: linkBody, detail: d('เพิ่ม dependency ระหว่างงาน') })
    .delete('/links/:id', deleteLink, { params: t.Object({ id: t.Numeric() }), detail: d('ลบ dependency') })
    .post('/kpi', createKpi, { body: kpiBody, detail: d('เพิ่ม KPI + กำหนดปีงบที่ใช้งาน') })
    .put('/kpi/:code', updateKpi, { params: t.Object({ code: t.String() }), body: kpiBody, detail: d('แก้ไข KPI + ปีงบที่ใช้งาน') })
    .delete('/kpi/:code', deleteKpi, { params: t.Object({ code: t.String() }), detail: d('ลบ KPI') })
    .post('/reset', resetRoadmap, { detail: d('รีเซ็ตเป็นข้อมูลตัวอย่าง (seed master + tasks)') });
