import { core_kon } from '../db/db';
import { seedRoadmap, deriveFiscalYear } from '../db/roadmapSeed';
import { seedRoadmapMeta } from '../db/roadmapMetaSeed';

const errRes = (set: any, status: number, message: string) => { set.status = status; return { success: false, message }; };
const num = (v: any) => (v == null ? undefined : Number(v));

// ปีงบของงาน: ใช้ค่าที่ส่งมา > ปีงบของโครงการแม่ (inherit) > คำนวณจากวันที่เริ่ม
const resolveFiscalYear = async (b: any): Promise<number> => {
    if (b.fiscalYear != null) return Number(b.fiscalYear);
    if (b.parent) {
        const [p] = await core_kon`SELECT fiscal_year FROM it_roadmap_tasks WHERE id = ${Number(b.parent)}`;
        if (p?.fiscal_year != null) return Number(p.fiscal_year);
    }
    return deriveFiscalYear(b.start);
};

// map DB row -> frontend Task shape (id/parent เป็น string, start/end เป็น ISO)
const mapTask = (r: any, logs: any[]) => ({
    id: String(r.id),
    code: r.code ?? undefined,
    text: r.text,
    type: r.type,
    parent: r.parent_id != null ? String(r.parent_id) : undefined,
    mission: r.mission,
    fiscalYear: r.fiscal_year != null ? Number(r.fiscal_year) : undefined,
    start: r.start_date,
    end: r.end_date,
    progress: r.progress ?? undefined,
    status: r.status ?? undefined,
    priority: r.priority ?? undefined,
    owner: r.owner ?? undefined,
    ownerUserId: r.owner_user_id != null ? Number(r.owner_user_id) : undefined,
    ownerPosition: r.owner_position ?? undefined,
    department: r.department ?? undefined,
    contact: r.contact ?? undefined,
    team: r.team ?? undefined,
    budgetRequested: num(r.budget_requested),
    budgetApproved: num(r.budget_approved),
    budgetSpent: num(r.budget_spent),
    budgetSource: r.budget_source ?? undefined,
    kpiCode: r.kpi_code ?? undefined,
    kpiName: r.kpi_name ?? undefined,
    kpiTarget: r.kpi_target ?? undefined,
    description: r.description ?? undefined,
    expectedOutcome: r.expected_outcome ?? undefined,
    vendor: r.vendor ?? undefined,
    documents: r.documents ?? undefined,
    riskNote: r.risk_note ?? undefined,
    progressLog: (logs ?? [])
        .filter(l => l.task_id === r.id)
        .map(l => ({ id: String(l.id), date: l.log_date, progress: l.progress, note: l.note, reportedBy: l.reported_by, budgetSpentDelta: num(l.budget_spent_delta) })),
});

// role ที่ถือว่าเป็น "เจ้าหน้าที่ IT" สำหรับเลือกเป็นผู้รับผิดชอบหลัก
const OWNER_ROLES = ['IT_STAFF', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT'];

// ─── GET meta: ตัวเลือกทั้งหมด (จากตาราง master) + รายชื่อเจ้าหน้าที่ IT ─────────
export const getRoadmapMeta = async ({ set }: any) => {
    try {
        const [missions, statuses, priorities, kpis, departments, staff] = await Promise.all([
            core_kon`SELECT value, label, color FROM it_roadmap_mission  WHERE active ORDER BY sort, value`,
            core_kon`SELECT value, label, color FROM it_roadmap_status    WHERE active ORDER BY sort, value`,
            core_kon`SELECT value, label, color FROM it_roadmap_priority  WHERE active ORDER BY sort, value`,
            core_kon`
                SELECT k.code, k.name, k.target,
                       COALESCE(ARRAY_AGG(y.fiscal_year ORDER BY y.fiscal_year) FILTER (WHERE y.fiscal_year IS NOT NULL), '{}') AS years
                FROM it_roadmap_kpi k
                LEFT JOIN it_roadmap_kpi_years y ON y.kpi_code = k.code
                WHERE k.active
                GROUP BY k.code, k.name, k.target, k.sort
                ORDER BY k.sort, k.code`,
            core_kon`SELECT name                 FROM it_roadmap_department WHERE active ORDER BY sort, name`,
            core_kon`
                SELECT DISTINCT u.id,
                       CONCAT(u.pname, u.fname, ' ', u.lname) AS name,
                       up.position_name
                FROM core_kon.user_m_users_roles mu
                JOIN users u ON u.id = mu.user_id
                LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
                LEFT JOIN core_kon.user_roles r ON r.id = mu.role_id
                WHERE UPPER(r.role_name) = ANY(${OWNER_ROLES})
                  AND COALESCE(UPPER(u.is_active), 'Y') <> 'N'
                ORDER BY name`,
        ]);
        return {
            success: true,
            data: {
                missions, statuses, priorities,
                kpis: kpis.map((k: any) => ({ code: k.code, name: k.name, target: k.target ?? undefined, years: (k.years ?? []).map(Number) })),
                departments: departments.map((d: any) => d.name),
                staff: staff.map((s: any) => ({ id: s.id, name: s.name, position: s.position_name ?? undefined })),
            },
        };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

// ─── GET ทั้ง roadmap (tasks + links) ────────────────────────────────────────
export const getRoadmap = async ({ set }: any) => {
    try {
        const [tasks, logs, links] = await Promise.all([
            core_kon`SELECT * FROM it_roadmap_tasks ORDER BY id`,
            core_kon`SELECT * FROM it_roadmap_progress_logs ORDER BY log_date ASC, id ASC`,
            core_kon`SELECT * FROM it_roadmap_links ORDER BY id`,
        ]);
        return {
            success: true,
            data: {
                tasks: tasks.map((t: any) => mapTask(t, logs as any)),
                links: links.map((l: any) => ({ id: String(l.id), source: String(l.source_id), target: String(l.target_id), type: l.link_type })),
            },
        };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

// ─── create task ─────────────────────────────────────────────────────────────
export const createTask = async ({ body, user, set }: any) => {
    try {
        const b = body;
        if (!b.text || !b.type || !b.mission || !b.start || !b.end) return errRes(set, 400, 'ข้อมูลไม่ครบ (text/type/mission/start/end)');
        const fy = await resolveFiscalYear(b);
        const [row] = await core_kon`
            INSERT INTO it_roadmap_tasks
                (code, text, type, parent_id, mission, fiscal_year, start_date, end_date, progress, status, priority,
                 owner, owner_user_id, owner_position, department, contact, team, budget_requested, budget_approved, budget_spent,
                 budget_source, kpi_code, kpi_name, kpi_target, description, expected_outcome, vendor, documents, risk_note, created_by)
            VALUES (${b.code ?? null}, ${b.text}, ${b.type}, ${b.parent ? Number(b.parent) : null}, ${b.mission},
                    ${fy},
                    ${b.start}, ${b.end}, ${b.progress ?? null}, ${b.status ?? null}, ${b.priority ?? null},
                    ${b.owner ?? null}, ${b.ownerUserId ?? null}, ${b.ownerPosition ?? null}, ${b.department ?? null}, ${b.contact ?? null},
                    ${b.team ? core_kon.json(b.team) : null}, ${b.budgetRequested ?? null}, ${b.budgetApproved ?? null},
                    ${b.budgetSpent ?? null}, ${b.budgetSource ?? null}, ${b.kpiCode ?? null}, ${b.kpiName ?? null},
                    ${b.kpiTarget ?? null}, ${b.description ?? null}, ${b.expectedOutcome ?? null}, ${b.vendor ?? null},
                    ${b.documents ? core_kon.json(b.documents) : null}, ${b.riskNote ?? null}, ${user?.id ?? null})
            RETURNING id`;
        set.status = 201;
        return { success: true, data: { id: String(row.id) } };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

// ─── update task ─────────────────────────────────────────────────────────────
export const updateTask = async ({ params, body, set }: any) => {
    try {
        const b = body; const id = Number(params.id);
        const fy = await resolveFiscalYear(b);
        const [row] = await core_kon`
            UPDATE it_roadmap_tasks SET
                code = ${b.code ?? null}, text = ${b.text}, type = ${b.type},
                parent_id = ${b.parent ? Number(b.parent) : null}, mission = ${b.mission},
                fiscal_year = ${fy},
                start_date = ${b.start}, end_date = ${b.end}, progress = ${b.progress ?? null},
                status = ${b.status ?? null}, priority = ${b.priority ?? null},
                owner = ${b.owner ?? null}, owner_user_id = ${b.ownerUserId ?? null}, owner_position = ${b.ownerPosition ?? null},
                department = ${b.department ?? null}, contact = ${b.contact ?? null},
                team = ${b.team ? core_kon.json(b.team) : null},
                budget_requested = ${b.budgetRequested ?? null}, budget_approved = ${b.budgetApproved ?? null},
                budget_spent = ${b.budgetSpent ?? null}, budget_source = ${b.budgetSource ?? null},
                kpi_code = ${b.kpiCode ?? null}, kpi_name = ${b.kpiName ?? null}, kpi_target = ${b.kpiTarget ?? null},
                description = ${b.description ?? null}, expected_outcome = ${b.expectedOutcome ?? null},
                vendor = ${b.vendor ?? null}, documents = ${b.documents ? core_kon.json(b.documents) : null},
                risk_note = ${b.riskNote ?? null}, updated_at = NOW()
            WHERE id = ${id}
            RETURNING id`;
        if (!row) return errRes(set, 404, 'ไม่พบรายการ');
        return { success: true, data: { id: String(row.id) } };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

// ─── delete task (children/links/logs cascade ผ่าน FK) ───────────────────────
export const deleteTask = async ({ params, set }: any) => {
    try {
        const [row] = await core_kon`DELETE FROM it_roadmap_tasks WHERE id = ${Number(params.id)} RETURNING id`;
        if (!row) return errRes(set, 404, 'ไม่พบรายการ');
        return { success: true };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

// ─── add progress log (+ อัปเดต progress และ budget_spent ของ task) ──────────
export const addProgress = async ({ params, body, set }: any) => {
    try {
        const id = Number(params.id);
        const b = body;
        if (b.progress == null) return errRes(set, 400, 'กรุณาระบุความคืบหน้า');
        const [task] = await core_kon`SELECT id FROM it_roadmap_tasks WHERE id = ${id}`;
        if (!task) return errRes(set, 404, 'ไม่พบรายการ');
        await core_kon`
            INSERT INTO it_roadmap_progress_logs (task_id, log_date, progress, note, reported_by, budget_spent_delta)
            VALUES (${id}, ${b.date || new Date().toISOString()}, ${b.progress}, ${b.note ?? null}, ${b.reportedBy ?? null}, ${b.budgetSpentDelta ?? null})`;
        await core_kon`
            UPDATE it_roadmap_tasks
            SET progress = ${b.progress},
                budget_spent = COALESCE(budget_spent, 0) + ${b.budgetSpentDelta ?? 0},
                updated_at = NOW()
            WHERE id = ${id}`;
        return { success: true };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

// ─── links ───────────────────────────────────────────────────────────────────
export const createLink = async ({ body, set }: any) => {
    try {
        const [row] = await core_kon`
            INSERT INTO it_roadmap_links (source_id, target_id, link_type)
            VALUES (${Number(body.source)}, ${Number(body.target)}, ${body.type ?? 0})
            RETURNING id`;
        set.status = 201;
        return { success: true, data: { id: String(row.id) } };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

export const deleteLink = async ({ params, set }: any) => {
    try {
        await core_kon`DELETE FROM it_roadmap_links WHERE id = ${Number(params.id)}`;
        return { success: true };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

// ─── KPI master (เพิ่ม/แก้/ลบ + กำหนดปีงบที่ active) ──────────────────────────
const syncKpiYears = async (code: string, years: any) => {
    await core_kon`DELETE FROM it_roadmap_kpi_years WHERE kpi_code = ${code}`;
    const list = Array.isArray(years) ? [...new Set(years.map((y: any) => Number(y)).filter((y: number) => Number.isFinite(y)))] : [];
    for (const y of list) {
        await core_kon`INSERT INTO it_roadmap_kpi_years (kpi_code, fiscal_year) VALUES (${code}, ${y}) ON CONFLICT DO NOTHING`;
    }
};

export const createKpi = async ({ body, set }: any) => {
    try {
        const b = body;
        if (!b.code || !b.name) return errRes(set, 400, 'ต้องระบุรหัสและชื่อ KPI');
        const [dup] = await core_kon`SELECT code FROM it_roadmap_kpi WHERE code = ${b.code}`;
        if (dup) return errRes(set, 409, 'รหัส KPI นี้มีอยู่แล้ว');
        await core_kon`
            INSERT INTO it_roadmap_kpi (code, name, target, sort, active)
            VALUES (${b.code}, ${b.name}, ${b.target ?? null}, ${b.sort ?? 99}, ${b.active ?? true})`;
        await syncKpiYears(b.code, b.years);
        set.status = 201;
        return { success: true, data: { code: b.code } };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

export const updateKpi = async ({ params, body, set }: any) => {
    try {
        const b = body; const code = params.code;
        const [row] = await core_kon`
            UPDATE it_roadmap_kpi SET
                name = ${b.name}, target = ${b.target ?? null},
                sort = ${b.sort ?? 99}, active = ${b.active ?? true}
            WHERE code = ${code}
            RETURNING code`;
        if (!row) return errRes(set, 404, 'ไม่พบ KPI');
        await syncKpiYears(code, b.years);
        return { success: true, data: { code } };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

export const deleteKpi = async ({ params, set }: any) => {
    try {
        const [row] = await core_kon`DELETE FROM it_roadmap_kpi WHERE code = ${params.code} RETURNING code`;
        if (!row) return errRes(set, 404, 'ไม่พบ KPI');
        return { success: true };
    } catch (e: any) { return errRes(set, 500, e.message); }
};

// ─── reset (คืนค่าเป็นข้อมูลตัวอย่าง) ─────────────────────────────────────────
export const resetRoadmap = async ({ set }: any) => {
    try {
        await seedRoadmapMeta(core_kon as any);   // ค่า master (ไม่ทับของเดิม)
        await seedRoadmap(core_kon as any);
        return { success: true };
    } catch (e: any) { return errRes(set, 500, e.message); }
};
