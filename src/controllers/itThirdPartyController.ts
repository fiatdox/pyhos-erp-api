import { core_kon } from '../db/db';
import { Bad, withRecorder } from './itRiskRegisterController';

// ── การประเมินความเสี่ยงของบุคคลภายนอก (3rd Party Risk Assessment) ─────────────
// ตาราง it_tp_assessments / it_tp_items / it_tp_log + แม่แบบ it_tp_clusters / it_tp_template (src/db/it_third_party_risk.sql)
// สร้างการประเมินใหม่: คัดลอกข้อประเมินจากแม่แบบ (10 หมวด × 8 ข้อ) หรือยกทุกข้อจากการประเมินครั้งก่อน (copy_from) มาทบทวน
// ระดับความเสี่ยงคำนวณที่หน้าเว็บ · ผู้บันทึก = บัญชีเจ้าหน้าที่ IT (ใช้ร่วมกับทะเบียนความเสี่ยง) · ผู้แก้ไข = ผู้ใช้จาก token

const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, field }; };
const handle = (set: any, tag: string, e: any) => {
    if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
    console.error(`[ItThirdParty] ${tag}:`, e?.message);
    return fail(set, 500, 'บันทึกไม่สำเร็จ');
};

const TREATMENTS = ['mitigate', 'accept', 'transfer', 'avoid', 'monitor'];
const CIA = ['C', 'I', 'A'];
const AREAS = ['F', 'S', 'R', 'I', 'L', 'O'];

const txt = (v: unknown, max: number, field: string, required = false) => {
    const s = String(v ?? '').trim();
    if (required && !s) throw new Bad(400, 'กรุณากรอกข้อมูล', field);
    if (s.length > max) throw new Bad(400, `ข้อความยาวเกิน ${max} ตัวอักษร`, field);
    return s || null;
};
const day = (v: unknown, field: string) => {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Bad(400, 'วันที่ไม่ถูกต้อง', field);
    return s;
};
const lvl = (v: unknown, field: string) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new Bad(400, 'ต้องเป็นจำนวนเต็ม 1–5', field);
    return n;
};
const subset = (v: unknown, allowed: string[], field: string) => {
    const arr = Array.isArray(v) ? [...new Set(v.map(String))] : [];
    if (arr.some(x => !allowed.includes(x))) throw new Bad(400, 'ค่าที่เลือกไม่ถูกต้อง', field);
    return allowed.filter(x => arr.includes(x));   // เรียงตามแบบฟอร์มเสมอ
};
const posId = (v: unknown, field: string) => {
    if (v === '' || v == null) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Bad(400, 'ค่าที่เลือกไม่ถูกต้อง', field);
    return n;
};

const readHeader = (b: any) => {
    const rid = Number(b?.recorder_id);
    if (!Number.isInteger(rid) || rid <= 0) throw new Bad(400, 'กรุณาเลือกผู้บันทึกจากบัญชีเจ้าหน้าที่ IT', 'recorder_id');
    return {
        vendor_name: txt(b?.vendor_name, 255, 'vendor_name', true)!, service_name: txt(b?.service_name, 255, 'service_name'),
        bia_service_id: posId(b?.bia_service_id, 'bia_service_id'), reviewer: txt(b?.reviewer, 255, 'reviewer'),
        recorder_id: rid, recorder_role: txt(b?.recorder_role, 150, 'recorder_role'),
        meeting_date: day(b?.meeting_date, 'meeting_date'), notes: txt(b?.notes, 2000, 'notes'),
    };
};

const readItem = (b: any) => {
    const treatment = String(b?.treatment ?? '');
    if (!TREATMENTS.includes(treatment)) throw new Bad(400, 'กรุณาเลือกตัวเลือกการตอบสนอง', 'treatment');
    const progress = b?.progress_pct === '' || b?.progress_pct == null ? 0 : Number(b.progress_pct);
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) throw new Bad(400, 'ความคืบหน้าต้องเป็น 0–100', 'progress_pct');
    const l = lvl(b?.likelihood, 'likelihood'), i = lvl(b?.impact, 'impact');
    if ((l == null) !== (i == null)) throw new Bad(400, 'ต้องระบุทั้งโอกาสเกิดและความรุนแรง', l == null ? 'likelihood' : 'impact');
    const rl = lvl(b?.residual_likelihood, 'residual_likelihood'), ri = lvl(b?.residual_impact, 'residual_impact');
    if ((rl == null) !== (ri == null)) throw new Bad(400, 'ความเสี่ยงคงเหลือต้องระบุทั้งโอกาสเกิดและความรุนแรง', rl == null ? 'residual_likelihood' : 'residual_impact');
    return {
        risk: txt(b?.risk, 1000, 'risk', true)!, threat: txt(b?.threat, 1000, 'threat'), vulnerability: txt(b?.vulnerability, 2000, 'vulnerability'),
        cia: subset(b?.cia, CIA, 'cia'), impact_areas: subset(b?.impact_areas, AREAS, 'impact_areas'), likelihood: l, impact: i,
        treatment, treatment_plan: txt(b?.treatment_plan, 4000, 'treatment_plan'), owner: txt(b?.owner, 255, 'owner'),
        progress_pct: progress, due_date: day(b?.due_date, 'due_date'),
        residual_cia: subset(b?.residual_cia, CIA, 'residual_cia'), residual_areas: subset(b?.residual_areas, AREAS, 'residual_areas'),
        residual_likelihood: rl, residual_impact: ri, further_action: txt(b?.further_action, 2000, 'further_action'),
    };
};
const ITEM_FIELDS = ['risk', 'threat', 'vulnerability', 'cia', 'impact_areas', 'likelihood', 'impact', 'treatment', 'treatment_plan', 'owner', 'progress_pct',
    'due_date', 'residual_cia', 'residual_areas', 'residual_likelihood', 'residual_impact', 'further_action'];
const snapItem = (r: any) => Object.fromEntries(ITEM_FIELDS.map(k => [k, r[k]]));

const HEADER_COLS = core_kon`
    a.id, a.vendor_name, a.service_name, a.bia_service_id, b.name AS bia_service_name, a.reviewer, a.recorder_id, a.recorder_name, a.recorder_role,
    to_char(a.meeting_date, 'YYYY-MM-DD') AS meeting_date, a.notes, a.updated_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name`;
const ITEM_COLS = core_kon`
    i.id, i.assessment_id, i.cluster_no, i.cluster_name, i.item_no, i.sort, i.risk, i.threat, i.vulnerability, i.cia, i.impact_areas,
    i.likelihood, i.impact, i.score, i.treatment, i.treatment_plan, i.owner, i.progress_pct, to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
    i.residual_cia, i.residual_areas, i.residual_likelihood, i.residual_impact, i.residual_score, i.further_action, i.copied_from,
    i.updated_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name`;
const ITEM_RAW = core_kon`*, to_char(due_date, 'YYYY-MM-DD') AS due_date`;

// รายการการประเมินทั้งหมด (ล่าสุดก่อน) + จำนวนข้อ ข้อที่ประเมินแล้ว และค่าเฉลี่ย
export const listAssessments = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT ${HEADER_COLS}, count(i.id)::int AS items, count(i.score)::int AS assessed,
                   ROUND(AVG(i.score)::numeric, 2)::float8 AS avg_score, ROUND(AVG(i.residual_score)::numeric, 2)::float8 AS avg_residual,
                   ROUND(AVG(i.progress_pct)::numeric, 1)::float8 AS avg_progress
            FROM it_tp_assessments a LEFT JOIN users u ON u.id = a.updated_by LEFT JOIN it_bia_services b ON b.id = a.bia_service_id
            LEFT JOIN it_tp_items i ON i.assessment_id = a.id
            GROUP BY a.id, b.name, u.pname, u.fname, u.lname ORDER BY a.meeting_date DESC NULLS LAST, a.id DESC`;
        return { success: true, data: rows };
    } catch (e: any) { return handle(set, 'list', e); }
};

export const getAssessment = async ({ params, set }: any) => {
    try {
        const [header] = await core_kon`SELECT ${HEADER_COLS} FROM it_tp_assessments a LEFT JOIN users u ON u.id = a.updated_by LEFT JOIN it_bia_services b ON b.id = a.bia_service_id WHERE a.id = ${Number(params.id)}`;
        if (!header) return fail(set, 404, 'ไม่พบการประเมิน');
        const [items, clusters] = await Promise.all([
            core_kon`SELECT ${ITEM_COLS} FROM it_tp_items i LEFT JOIN users u ON u.id = i.updated_by WHERE i.assessment_id = ${header.id} ORDER BY i.sort, i.id`,
            core_kon`SELECT cluster_no, name FROM it_tp_clusters ORDER BY cluster_no`,
        ]);
        return { success: true, data: { ...header, items, clusters } };
    } catch (e: any) { return handle(set, 'get', e); }
};

const checkBia = async (sql: any, id: number | null) => {
    if (id && !(await sql`SELECT 1 FROM it_bia_services WHERE id = ${id}`).length) throw new Bad(400, 'ไม่พบบริการในทะเบียน BIA', 'bia_service_id');
};

// สร้างการประเมินใหม่ — copy_from = id การประเมินครั้งก่อน: ยกทุกข้อพร้อมค่าที่ประเมินไว้ · ไม่ระบุ = คัดลอกแม่แบบ (ยังไม่ให้คะแนน)
export const createAssessment = async ({ body, user, set }: any) => {
    try {
        const actor = Number(user.id);
        const copyFrom = posId(body?.copy_from, 'copy_from');
        const out = await core_kon.begin(async (sql: any) => {
            const h = await withRecorder(sql, readHeader(body));
            await checkBia(sql, h.bia_service_id);
            const [a] = await sql`INSERT INTO it_tp_assessments ${sql({ ...h, created_by: actor, updated_by: actor } as any)} RETURNING id`;
            await sql`INSERT INTO it_tp_log (assessment_id, action, after, changed_by) VALUES (${a.id}, 'create_assessment', ${sql.json(h)}, ${actor})`;
            let res;
            if (copyFrom) {
                if (!(await sql`SELECT 1 FROM it_tp_assessments WHERE id = ${copyFrom}`).length) throw new Bad(400, 'ไม่พบการประเมินที่จะยกค่ามา', 'copy_from');
                res = await sql`
                    INSERT INTO it_tp_items (assessment_id, cluster_no, cluster_name, item_no, sort, risk, threat, vulnerability, cia, impact_areas, likelihood, impact,
                        treatment, treatment_plan, owner, progress_pct, due_date, residual_cia, residual_areas, residual_likelihood, residual_impact, further_action,
                        copied_from, created_by, updated_by)
                    SELECT ${a.id}, cluster_no, cluster_name, item_no, sort, risk, threat, vulnerability, cia, impact_areas, likelihood, impact,
                        treatment, treatment_plan, owner, progress_pct, due_date, residual_cia, residual_areas, residual_likelihood, residual_impact, further_action,
                        id, ${actor}, ${actor}
                    FROM it_tp_items WHERE assessment_id = ${copyFrom} ORDER BY sort, id`;
                await sql`INSERT INTO it_tp_log (assessment_id, action, after, changed_by) VALUES (${a.id}, 'copy', ${sql.json({ from_assessment: copyFrom, items: res.count })}, ${actor})`;
            } else {
                // แม่แบบ: กระทบ C/I/A และความรุนแรงทุกด้านตามแบบฟอร์ม ให้ผู้ประเมินตัดออกเอง · โอกาส/ความรุนแรงยังว่าง (ยังไม่ประเมิน)
                res = await sql`
                    INSERT INTO it_tp_items (assessment_id, cluster_no, cluster_name, item_no, sort, risk, threat, vulnerability, cia, impact_areas,
                        treatment_plan, residual_cia, residual_areas, created_by, updated_by)
                    SELECT ${a.id}, t.cluster_no, c.name, t.item_no, t.sort, t.risk, t.threat, t.vulnerability, ${CIA}::text[], ${AREAS}::text[],
                        t.treatment_plan, ${CIA}::text[], ${AREAS}::text[], ${actor}, ${actor}
                    FROM it_tp_template t JOIN it_tp_clusters c ON c.cluster_no = t.cluster_no WHERE t.is_active ORDER BY t.sort`;
            }
            return { id: a.id, items: res.count };
        });
        return { success: true, data: out };
    } catch (e: any) { return handle(set, 'create assessment', e); }
};

export const updateAssessment = async ({ params, body, user, set }: any) => {
    try {
        const h0 = readHeader(body);
        const actor = Number(user.id), id = Number(params.id);
        await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT vendor_name, service_name, bia_service_id, reviewer, recorder_id, recorder_name, recorder_role, to_char(meeting_date, 'YYYY-MM-DD') AS meeting_date, notes FROM it_tp_assessments WHERE id = ${id} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบการประเมิน');
            const h = await withRecorder(sql, h0, cur);
            await checkBia(sql, h.bia_service_id);
            await sql`UPDATE it_tp_assessments SET ${sql({ ...h, updated_by: actor, updated_at: new Date() } as any)} WHERE id = ${id}`;
            await sql`INSERT INTO it_tp_log (assessment_id, action, before, after, changed_by) VALUES (${id}, 'update_assessment', ${sql.json({ ...cur })}, ${sql.json(h)}, ${actor})`;
        });
        return { success: true };
    } catch (e: any) { return handle(set, 'update assessment', e); }
};

// เพิ่มข้อประเมินเองในหมวดที่มีอยู่ — เลขข้อ = ข้อถัดไปของหมวด (เช่น 1.9)
export const createItem = async ({ params, body, user, set }: any) => {
    try {
        const it = readItem(body);
        const clusterNo = Number(body?.cluster_no);
        const actor = Number(user.id), aid = Number(params.id);
        const id = await core_kon.begin(async (sql: any) => {
            if (!(await sql`SELECT 1 FROM it_tp_assessments WHERE id = ${aid} FOR UPDATE`).length) throw new Bad(404, 'ไม่พบการประเมิน');
            const [c] = Number.isInteger(clusterNo) ? await sql`SELECT cluster_no, name FROM it_tp_clusters WHERE cluster_no = ${clusterNo}` : [];
            if (!c) throw new Bad(400, 'กรุณาเลือกหมวดความเสี่ยง', 'cluster_no');
            const nos = await sql`SELECT item_no, sort FROM it_tp_items WHERE assessment_id = ${aid} AND cluster_no = ${c.cluster_no}`;
            const next = nos.reduce((m: number, r: any) => Math.max(m, Number(String(r.item_no).split('.')[1]) || 0), 0) + 1;
            const [{ s }] = await sql`SELECT COALESCE(MAX(sort), ${c.cluster_no * 100}) + 1 AS s FROM it_tp_items WHERE assessment_id = ${aid} AND cluster_no <= ${c.cluster_no}`;
            // เลื่อนข้อของหมวดถัดไปลง เพื่อให้ข้อใหม่อยู่ท้ายหมวดของตัวเอง
            await sql`UPDATE it_tp_items SET sort = sort + 1 WHERE assessment_id = ${aid} AND sort >= ${s}`;
            const row = { ...it, assessment_id: aid, cluster_no: c.cluster_no, cluster_name: c.name, item_no: `${c.cluster_no}.${next}`, sort: s, created_by: actor, updated_by: actor };
            const [r] = await sql`INSERT INTO it_tp_items ${sql(row as any)} RETURNING id`;
            await sql`INSERT INTO it_tp_log (assessment_id, item_id, action, after, changed_by) VALUES (${aid}, ${r.id}, 'create', ${sql.json({ item_no: row.item_no, ...it })}, ${actor})`;
            return r.id;
        });
        return { success: true, data: { id } };
    } catch (e: any) { return handle(set, 'create item', e); }
};

export const updateItem = async ({ params, body, user, set }: any) => {
    try {
        const it = readItem(body);
        const actor = Number(user.id), id = Number(params.itemId);
        const changed = await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT ${ITEM_RAW} FROM it_tp_items WHERE id = ${id} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบข้อประเมิน');
            const before = snapItem(cur);
            if (JSON.stringify(before) === JSON.stringify(it)) return false;
            await sql`UPDATE it_tp_items SET ${sql({ ...it, updated_by: actor, updated_at: new Date() } as any)} WHERE id = ${id}`;
            await sql`INSERT INTO it_tp_log (assessment_id, item_id, action, before, after, changed_by) VALUES (${cur.assessment_id}, ${id}, 'update', ${sql.json({ item_no: cur.item_no, ...before })}, ${sql.json({ item_no: cur.item_no, ...it })}, ${actor})`;
            return true;
        });
        return { success: true, data: { changed } };
    } catch (e: any) { return handle(set, 'update item', e); }
};

export const deleteItem = async ({ params, user, set }: any) => {
    try {
        const actor = Number(user.id), id = Number(params.itemId);
        await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT ${ITEM_RAW} FROM it_tp_items WHERE id = ${id} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบข้อประเมิน');
            await sql`UPDATE it_tp_items SET copied_from = NULL WHERE copied_from = ${id}`;
            await sql`DELETE FROM it_tp_items WHERE id = ${id}`;
            await sql`INSERT INTO it_tp_log (assessment_id, item_id, action, before, changed_by) VALUES (${cur.assessment_id}, ${id}, 'delete', ${sql.json({ item_no: cur.item_no, ...snapItem(cur) })}, ${actor})`;
        });
        return { success: true };
    } catch (e: any) { return handle(set, 'delete item', e); }
};

export const getAssessmentLog = async ({ params, set }: any) => {
    try {
        const rows = await core_kon`
            SELECT l.id, l.item_id, l.action, l.changed_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS changed_by_name,
                   COALESCE(l.after->>'item_no', l.before->>'item_no') AS item_no, COALESCE(l.after->>'risk', l.before->>'risk') AS risk
            FROM it_tp_log l LEFT JOIN users u ON u.id = l.changed_by
            WHERE l.assessment_id = ${Number(params.id)} ORDER BY l.changed_at DESC, l.id DESC LIMIT 300`;
        return { success: true, data: rows };
    } catch (e: any) { return handle(set, 'log', e); }
};
