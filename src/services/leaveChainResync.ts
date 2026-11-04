import { core_kon } from '../db/db';
import { parseChain, resolveApprovalChain, type ChainStep } from './leaveChain';
import { legacyConfigured, legacyStepApprovals, type LegacyStepApprovals } from './legacyImport';

// ── ปรับสายอนุมัติของใบลาที่ยื่นไปแล้วให้ตรงผังปัจจุบัน (ADMIN) ─────────────────────
//
// resyncPendingChains (leaveChain.ts) ปรับเองเฉพาะ "ขั้นที่ยังไม่ถึง" ตอนแก้ผัง ขั้นที่กดแล้วคงไว้
// ที่นี่คือการแก้ข้อมูลโดยผู้ดูแล: แก้ทั้งสายรวมถึงขั้นที่กดแล้ว (เช่น ใบที่โอนจากโปรแกรมเดิมตอนผังยังไม่ถูก)
//
// กติกาการปรับแถวการอนุมัติ — เทียบตามระดับ (level)
//   ก) ขั้นที่มีระดับเดิมอยู่: คงวันที่และความเห็น เปลี่ยนผู้อนุมัติ / หน่วย / ลำดับตามผัง
//   ข) ระดับที่ไม่มีในผังแล้ว: ลบแถวนั้น (ค่าเดิมเก็บใน hr_leave_chain_resync_log)
//   ค) ขั้นใหม่ที่ไม่เคยมีแถว: ไม่สร้างการกดขึ้นเอง — ยกเว้นใบจากโปรแกรมเดิมที่ระดับนั้นกดไว้จริง ใช้วันที่และความเห็นจากใบเดิม
//   ง) ใบอนุมัติแล้ว ขั้นสุดท้ายต้องมีการกด — ระดับสุดท้ายเปลี่ยน (เช่น ภารกิจ → ผอ.) ใช้แถวระดับสูงสุดที่เหลือ
//
// ไม่แตะสถานะใบลาและยอดวันลา · ใบที่จะทำให้สถานะต้องเปลี่ยน (รออนุมัติแต่ผังใหม่กดครบแล้ว) ให้ผู้ดูแลตรวจเอง
// ใบที่จบแล้วแบบไม่มีผล (ไม่อนุมัติ / ยกเลิก) ไม่ปรับ
// ปรับได้ทีละใบเท่านั้น — ผู้ดูแลกดจากใบนั้นเองหลังเห็นผลที่จะเกิด ไม่มีการปรับทั้งหมด/หลายใบพร้อมกัน

const RESYNC_STATUSES = ['APPROVED', 'PENDING', 'CANCEL_PENDING'];

interface ReqRow {
    id: number; user_id: number; status: string; current_step: number; approval_chain: unknown;
    legacy_leave_id: number | null; owner_name?: string; unit_name?: string; leave_type_name?: string;
    start_date?: string; end_date?: string; cancel_acts: number;
}
interface ApprovalRow {
    id: number; request_id: number; step: number; approver_id: number; approver_name: string;
    level: string; action: string; actioned_at: string; comment: string | null;
}
interface Plan {
    blocked: string | null;
    next_step: number;
    deletes: ApprovalRow[];
    updates: { row: ApprovalRow; step: ChainStep }[];
    inserts: { step: ChainStep; at: string; comment: string }[];
    changes: string[];
    /** ใบที่สร้างในระบบใหม่ — แถวที่จะเปลี่ยน/ลบคือการกดจริงของผู้อนุมัติ */
    rewrites_real_clicks: boolean;
}

const chainKey = (xs: ChainStep[]) =>
    JSON.stringify(xs.map(s => [s.level, Number(s.approver_id), s.unit_type ?? null, s.unit_id == null ? null : Number(s.unit_id), !!s.is_acting]));

/** ใบนี้ไม่ตรงผัง — สายต่างจากผัง หรือผู้กดไม่ตรงกับคนในสาย (เช่น ถูกแก้ตารางเองแค่ฝั่งเดียว) */
const outOfSync = (chain: ChainStep[], rows: ApprovalRow[], fresh: ChainStep[] | null) => {
    if (fresh && chainKey(chain) !== chainKey(fresh)) return true;
    return rows.some(a => {
        const s = chain.find(x => Number(x.step) === Number(a.step));
        return !s || (!s.external && Number(s.approver_id) !== Number(a.approver_id));
    });
};

const planOf = (r: ReqRow, rows: ApprovalRow[], fresh: ChainStep[] | null, legacy: LegacyStepApprovals | undefined): Plan => {
    const plan: Plan = { blocked: null, next_step: 0, deletes: [], updates: [], inserts: [], changes: [], rewrites_real_clicks: false };
    if (!fresh?.length) { plan.blocked = 'ไม่พบผู้อนุมัติตามผังปัจจุบัน — ตรวจสังกัดของผู้ลาหรือแต่งตั้งหัวหน้าก่อน'; return plan; }
    // ขอยกเลิก: เดินสายซ้ำ ถ้ามีคนกดของรอบยกเลิกไปแล้ว การเปลี่ยนสายจะทำให้ลำดับรอบนั้นคลาดเคลื่อน
    if (r.status === 'CANCEL_PENDING' && (r.cancel_acts > 0 || Number(r.current_step) > 1)) {
        plan.blocked = 'คำขอยกเลิกมีผู้กดไปแล้ว — ปรับได้หลังคำขอนี้จบ';
        return plan;
    }
    const done = r.status !== 'PENDING';   // ใบอนุมัติแล้ว (รวมที่กำลังขอยกเลิก)
    const left = [...rows].sort((a, b) => Number(a.step) - Number(b.step));
    const assigned = new Map<number, ApprovalRow>();
    for (const s of fresh) {
        const i = left.findIndex(a => a.level === s.level);
        if (i >= 0) assigned.set(Number(s.step), left.splice(i, 1)[0]!);
    }
    const last = fresh[fresh.length - 1]!;
    if (done && !assigned.has(Number(last.step)) && left.length) assigned.set(Number(last.step), left.pop()!);

    for (const s of fresh) {
        const row = assigned.get(Number(s.step));
        if (row) {
            const who = !s.external && Number(row.approver_id) !== Number(s.approver_id);
            if (who) plan.changes.push(`ขั้น ${s.step} ${s.level_name}: เปลี่ยนผู้อนุมัติจาก ${row.approver_name} เป็น ${s.approver_name}`);
            plan.updates.push({ row, step: s });
            if (who && !r.legacy_leave_id) plan.rewrites_real_clicks = true;
        } else if (done) {
            const l = legacy?.[s.level];
            if (l && !s.external) {
                plan.inserts.push({ step: s, at: l.at, comment: l.comment });
                plan.changes.push(`ขั้น ${s.step} ${s.level_name} (${s.approver_name}): เพิ่มการกดจากโปรแกรมเดิม`);
            } else {
                plan.changes.push(`ขั้น ${s.step} ${s.level_name} (${s.approver_name}): เพิ่มในสาย ไม่มีบันทึกการกด`);
            }
        }
    }
    for (const a of left) {
        plan.deletes.push(a);
        plan.changes.push(`ลบการอนุมัติของ ${a.approver_name} (ไม่มีระดับนี้ในผังแล้ว)`);
        if (!r.legacy_leave_id) plan.rewrites_real_clicks = true;
    }

    if (r.status === 'APPROVED') plan.next_step = fresh.length + 1;
    else if (r.status === 'CANCEL_PENDING') plan.next_step = 1;
    else {
        plan.next_step = Math.max(0, ...assigned.keys()) + 1;
        if (plan.next_step > fresh.length) {
            plan.blocked = 'ทุกขั้นตามผังใหม่กดแล้ว ใบควรเป็นอนุมัติ — ต้องตรวจเอง (ระบบไม่เปลี่ยนสถานะให้)';
            return plan;
        }
    }
    if (!plan.changes.length) plan.changes.push('ปรับข้อมูลสายให้ตรงผัง (หน่วยงาน / รักษาการ)');
    return plan;
};

const loadApprovals = async (ids: number[], db: any = core_kon): Promise<Map<number, ApprovalRow[]>> => {
    const out = new Map<number, ApprovalRow[]>();
    if (!ids.length) return out;
    const rows = await db`
        SELECT a.id, a.request_id, a.step, a.approver_id, a.level, a.action, a.actioned_at, a.comment,
               TRIM(CONCAT(u.pname, u.fname, ' ', u.lname)) AS approver_name
        FROM hr_leave_approvals a LEFT JOIN users u ON u.id = a.approver_id
        WHERE a.request_id IN ${db(ids)}
        ORDER BY a.step, a.id`;
    for (const a of rows as ApprovalRow[]) {
        const k = Number(a.request_id);
        if (!out.has(k)) out.set(k, []);
        out.get(k)!.push(a);
    }
    return out;
};

/** ผู้ใช้ทีละชุด — ผังคนละคนคำนวณแยกกัน แต่คนเดียวกันใช้ซ้ำ */
const resolveCharts = async (userIds: number[]) => {
    const out = new Map<number, ChainStep[] | null>();
    const unique = [...new Set(userIds)];
    for (let i = 0; i < unique.length; i += 20) {
        await Promise.all(unique.slice(i, i + 20).map(async u => {
            out.set(u, (await resolveApprovalChain(u))?.steps ?? null);
        }));
    }
    return out;
};

const legacyFor = async (rows: ReqRow[]) => {
    const wanted = rows.filter(r => r.legacy_leave_id && r.status !== 'PENDING');
    if (!wanted.length || !legacyConfigured()) return new Map<number, LegacyStepApprovals>();
    try {
        return await legacyStepApprovals(wanted.map(r => ({ legacy_id: Number(r.legacy_leave_id), user_id: Number(r.user_id) })));
    } catch (e: any) {
        // ต่อโปรแกรมเดิมไม่ได้ก็ยังปรับได้ เพียงแต่ขั้นใหม่จะไม่มีบันทึกการกด
        console.error('[leaveChainResync] legacy:', e?.message);
        return new Map<number, LegacyStepApprovals>();
    }
};

const reqSelect = (db: any) => db`
    SELECT r.id, r.user_id, r.status, r.current_step, r.approval_chain, r.legacy_leave_id,
           TRIM(CONCAT(u.pname, u.fname, ' ', u.lname)) AS owner_name,
           COALESCE(sm.name, mj.name, ms.name, '-') AS unit_name, t.name_th AS leave_type_name,
           to_char(r.start_date, 'YYYY-MM-DD') AS start_date, to_char(r.end_date, 'YYYY-MM-DD') AS end_date,
           (SELECT count(*)::int FROM hr_leave_cancellations c JOIN hr_leave_approvals ca ON ca.cancellation_id = c.id
            WHERE c.request_id = r.id AND c.status = 'PENDING') AS cancel_acts
    FROM hr_leave_requests r
    JOIN users u ON u.id = r.user_id
    LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
    LEFT JOIN majors mj ON mj.major_id = u.major_id
    LEFT JOIN missions ms ON ms.mission_id = u.mission_id
    LEFT JOIN hr_leave_types t ON t.id = r.leave_type_id`;

export const logTableReady = async () => {
    const [row] = await core_kon`SELECT to_regclass('hr_leave_chain_resync_log') IS NOT NULL AS ok`;
    return !!row?.ok;
};

const toItem = (r: ReqRow, rows: ApprovalRow[], fresh: ChainStep[] | null, legacy: Map<number, LegacyStepApprovals>) => {
    const plan = planOf(r, rows, fresh, r.legacy_leave_id ? legacy.get(Number(r.legacy_leave_id)) : undefined);
    return {
        id: Number(r.id), user_id: Number(r.user_id), owner_name: r.owner_name, unit_name: r.unit_name,
        leave_type_name: r.leave_type_name, start_date: r.start_date, end_date: r.end_date,
        status: r.status, is_legacy: !!r.legacy_leave_id, current_step: Number(r.current_step),
        chain: parseChain(r.approval_chain), chart: fresh ?? [], next_step: plan.next_step,
        changes: plan.changes, blocked: plan.blocked, rewrites_real_clicks: plan.rewrites_real_clicks,
        in_sync: !!fresh && !outOfSync(parseChain(r.approval_chain), rows, fresh),
    };
};

/** ผลที่จะเกิดถ้าปรับใบนี้ (อ่านอย่างเดียว) — null = ไม่พบใบลา */
export const previewChainResync = async (id: number) => {
    const [r] = await core_kon`${reqSelect(core_kon)} WHERE r.id = ${id}` as unknown as ReqRow[];
    if (!r) return null;
    const fresh = (await resolveApprovalChain(Number(r.user_id)))?.steps ?? null;
    const rows = (await loadApprovals([id])).get(id) ?? [];
    const item = toItem(r, rows, fresh, await legacyFor([r]));
    return {
        ...item,
        blocked: RESYNC_STATUSES.includes(r.status) ? item.blocked : `ใบสถานะนี้จบแล้ว (${r.status}) — ไม่ปรับสายอนุมัติ`,
        log_ready: await logTableReady(),
    };
};

/** ใบที่สายไม่ตรงผังปัจจุบัน พร้อมผลที่จะเกิดถ้าปรับ (อ่านอย่างเดียว) */
export const listChainMismatches = async () => {
    const reqs = await core_kon`
        ${reqSelect(core_kon)}
        WHERE r.status IN ${core_kon(RESYNC_STATUSES)}
        ORDER BY r.id DESC` as unknown as ReqRow[];
    const approvals = await loadApprovals(reqs.map(r => Number(r.id)));
    const charts = await resolveCharts(reqs.map(r => Number(r.user_id)));

    const flagged = reqs.filter(r => {
        const fresh = charts.get(Number(r.user_id)) ?? null;
        const rows = approvals.get(Number(r.id)) ?? [];
        return !fresh || outOfSync(parseChain(r.approval_chain), rows, fresh);
    });
    const legacy = await legacyFor(flagged);

    const items = flagged.map(r => toItem(r, approvals.get(Number(r.id)) ?? [], charts.get(Number(r.user_id)) ?? null, legacy));
    return { items, scanned: reqs.length, legacy_configured: legacyConfigured(), log_ready: await logTableReady() };
};

export interface ApplyResult { id: number; ok: boolean; message?: string }

/** ปรับใบเดียวใน transaction — คำนวณใหม่ใต้ล็อก ไม่เชื่อข้อมูลที่หน้าจอเห็นตอนโหลด */
export const applyOne = async (id: number, actorId: number, note: string | null): Promise<ApplyResult> => {
    const [peek] = await core_kon`${reqSelect(core_kon)} WHERE r.id = ${id}` as unknown as ReqRow[];
    if (!peek) return { id, ok: false, message: 'ไม่พบใบลา' };
    if (!RESYNC_STATUSES.includes(peek.status)) return { id, ok: false, message: `สถานะ ${peek.status} ไม่ปรับ` };
    const fresh = (await resolveApprovalChain(Number(peek.user_id)))?.steps ?? null;
    const legacy = await legacyFor([peek]);
    return core_kon.begin((tx: any) => applyInTx(tx, id, actorId, note, fresh, legacy)) as Promise<ApplyResult>;
};

export const applyInTx = async (
    tx: any, id: number, actorId: number, note: string | null,
    fresh: ChainStep[] | null, legacy: Map<number, LegacyStepApprovals>,
): Promise<ApplyResult> => {
    const [lock] = await tx`SELECT id FROM hr_leave_requests WHERE id = ${id} FOR UPDATE`;
    if (!lock) return { id, ok: false, message: 'ไม่พบใบลา' };
    const [r] = await tx`${reqSelect(tx)} WHERE r.id = ${id}` as ReqRow[];
    if (!RESYNC_STATUSES.includes(r!.status)) return { id, ok: false, message: `สถานะ ${r!.status} ไม่ปรับ` };
    const rows = (await loadApprovals([id], tx)).get(id) ?? [];
    const chain = parseChain(r!.approval_chain);
    if (fresh && !outOfSync(chain, rows, fresh)) return { id, ok: false, message: 'ตรงผังอยู่แล้ว' };
    const plan = planOf(r!, rows, fresh, r!.legacy_leave_id ? legacy.get(Number(r!.legacy_leave_id)) : undefined);
    if (plan.blocked) return { id, ok: false, message: plan.blocked };

    await tx`
        INSERT INTO hr_leave_chain_resync_log (request_id, actor_id, note, before, after)
        VALUES (${id}, ${actorId}, ${note},
                ${JSON.stringify({ current_step: r!.current_step, approval_chain: chain, approvals: rows })}::text::jsonb,
                ${JSON.stringify({ current_step: plan.next_step, approval_chain: fresh, changes: plan.changes })}::text::jsonb)`;

    for (const a of plan.deletes) await tx`DELETE FROM hr_leave_approvals WHERE id = ${a.id}`;
    // (request_id, step) ห้ามซ้ำ — ย้ายออกไปเลขชั่วคราวก่อน กันชนกันตอนสลับลำดับ
    for (const { row } of plan.updates) await tx`UPDATE hr_leave_approvals SET step = ${1000 + Number(row.step)} WHERE id = ${row.id}`;
    for (const { row, step } of plan.updates) {
        await tx`
            UPDATE hr_leave_approvals
            SET step = ${step.step}, level = ${step.level}, unit_type = ${step.unit_type}, unit_id = ${step.unit_id},
                approver_id = ${step.external ? row.approver_id : step.approver_id}
            WHERE id = ${row.id}`;
    }
    for (const { step, at, comment } of plan.inserts) {
        await tx`
            INSERT INTO hr_leave_approvals (request_id, approver_id, step, action, comment, actioned_at, level, unit_type, unit_id)
            VALUES (${id}, ${step.approver_id}, ${step.step}, 'APPROVED', ${comment}, ${at}::timestamptz, ${step.level}, ${step.unit_type}, ${step.unit_id})`;
    }
    await tx`
        UPDATE hr_leave_requests
        SET approval_chain = ${JSON.stringify(fresh)}::text::jsonb, current_step = ${plan.next_step}, updated_at = now()
        WHERE id = ${id}`;
    return { id, ok: true };
};

export const listResyncLog = async (limit: number) => core_kon`
    SELECT l.id, l.request_id, l.note, l.before, l.after, l.created_at,
           TRIM(CONCAT(a.pname, a.fname, ' ', a.lname)) AS actor_name,
           TRIM(CONCAT(u.pname, u.fname, ' ', u.lname)) AS owner_name
    FROM hr_leave_chain_resync_log l
    LEFT JOIN users a ON a.id = l.actor_id
    LEFT JOIN hr_leave_requests r ON r.id = l.request_id
    LEFT JOIN users u ON u.id = r.user_id
    ORDER BY l.id DESC
    LIMIT ${limit}`;
