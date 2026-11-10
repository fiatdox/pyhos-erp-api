import { core_kon } from '../db/db';
import {
    addDays, dueState, guaranteeExpiresTooSoon, isValidDate, planTasks, todayBkk, totalWarrantyMonths, type Rules,
} from '../services/contractRules';

// ระบบคืนหลักประกันสัญญา — สิทธิ์แยกตามหน่วยงานและหน้าที่
//   พัสดุ / การเงิน : ดูจาก users.major_id หรือเป็นหัวหน้า/รักษาการกลุ่มงาน ไม่ต้องแจก role ทีละคน
//   กรรมการ ผู้ควบคุมงาน ผู้ครอบครองพัสดุ ผู้อนุมัติ : ดูจาก proc_contract_staff รายสัญญา
//   ผู้บริหาร (ผอ. / หัวหน้ากลุ่มภารกิจ และรักษาการ) : ดูวันหมดประกันได้ ไม่เห็นยอดเงิน
//   ADMIN : ดูได้ทุกหน้า แก้หน้าตั้งค่าได้ เพิ่ม/แก้ไข/ลบสัญญาและหลักประกันได้
//           ขั้นตอนตามหน้าที่ (ตรวจรับ เสนอคืน อนุมัติคืน จ่ายคืน) ยังเป็นของผู้มีหน้าที่ ADMIN ทำแทนไม่ได้

class Bad extends Error {
    constructor(public status: number, message: string, public field?: string) { super(message); }
}

const wrap = (fn: (ctx: any) => Promise<any>) => async (ctx: any) => {
    try {
        return await fn(ctx);
    } catch (e: any) {
        if (e instanceof Bad) {
            ctx.set.status = e.status;
            return { success: false, error: { code: e.status === 403 ? 'FORBIDDEN' : 'INVALID', message: e.message, ...(e.field ? { field: e.field } : {}) } };
        }
        if (e?.code === '23505') {
            ctx.set.status = 409;
            return { success: false, error: { code: 'DUPLICATE', message: 'ข้อมูลนี้มีอยู่แล้วในระบบ' } };
        }
        console.error('[contracts]', ctx.request?.method, ctx.path, e?.code ?? '', e?.message ?? e);
        ctx.set.status = 500;
        return { success: false, error: { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดในระบบ' } };
    }
};

type Sql = any;

const loadRules = async (sql: Sql = core_kon): Promise<Rules> =>
    Object.fromEntries((await sql`SELECT key, value FROM ctr_rules`).map((r: any) => [r.key, Number(r.value)]));

interface Access {
    uid: number;
    isAdmin: boolean;
    isDirector: boolean;
    isExecutive: boolean;
    procurement: boolean;
    finance: boolean;
    canEditRules: boolean;
    editContracts: boolean;   // เพิ่ม/แก้ไขสัญญา ผู้รับผิดชอบ เอกสาร = พัสดุ หรือ ADMIN
    editGuarantees: boolean;  // เพิ่ม/แก้ไขหลักประกัน = การเงิน หรือ ADMIN
    seeAll: boolean;
    duties: string[];
}

const accessOf = async (uid: number): Promise<Access> => {
    const [[u], roles, rules, dirs, duties, heads, missionHead] = await Promise.all([
        core_kon`SELECT major_id FROM users WHERE id = ${uid}`,
        core_kon`SELECT UPPER(r.role_name) AS role FROM core_kon.user_m_users_roles mu JOIN core_kon.user_roles r ON r.id = mu.role_id WHERE mu.user_id = ${uid}`,
        loadRules(),
        core_kon`SELECT value FROM hr_settings WHERE name IN ('director_id', 'acting_director_id') AND value <> ''`,
        core_kon`SELECT DISTINCT s.duty FROM proc_contract_staff s JOIN proc_contracts c ON c.id = s.contract_id
                 WHERE c.status = 'active' AND (s.user_id = ${uid} OR s.backup_user_id = ${uid})`,
        core_kon`SELECT major_id FROM majors WHERE supervisor_id = ${uid} OR acting_supervisor_id = ${uid}`,
        core_kon`SELECT 1 FROM missions WHERE is_active = 'Y' AND (supervisor_id = ${uid} OR acting_supervisor_id = ${uid}) LIMIT 1`,
    ]);
    const roleNames = roles.map((r: any) => r.role as string);
    const isAdmin = roleNames.includes('ADMIN');
    const isDirector = dirs.some((d: any) => Number(d.value) === uid);
    const major = u?.major_id == null ? null : Number(u.major_id);
    const headOf = (id?: number) => heads.some((h: any) => Number(h.major_id) === id);
    // ADMIN ไม่นับเป็นพัสดุ/การเงิน แม้จะสังกัดหน่วยนั้น จึงไม่ได้งานในกล่องงานและทำขั้นตอนตามหน้าที่ไม่ได้
    // สิทธิ์แก้ข้อมูลของ ADMIN ให้ผ่าน editContracts / editGuarantees แทน
    const procurement = !isAdmin && (major === rules.proc_major_id || headOf(rules.proc_major_id));
    const finance = !isAdmin && (major === rules.fin_major_id || headOf(rules.fin_major_id) || roleNames.includes('FINANCE'));
    return {
        uid, isAdmin, isDirector, isExecutive: isDirector || missionHead.length > 0, procurement, finance,
        canEditRules: isAdmin,
        editContracts: isAdmin || procurement,
        editGuarantees: isAdmin || finance,
        seeAll: isAdmin || procurement || finance,
        duties: duties.map((d: any) => d.duty),
    };
};

const dutiesOn = async (uid: number, contractId: number): Promise<string[]> =>
    (await core_kon`SELECT duty FROM proc_contract_staff WHERE contract_id = ${contractId} AND (user_id = ${uid} OR backup_user_id = ${uid})`).map((r: any) => r.duty);

const FIELD_DUTIES = ['committee', 'supervisor', 'custodian'];

const need = (ok: boolean, message = 'ไม่มีสิทธิ์ทำรายการนี้') => { if (!ok) throw new Bad(403, message); };
const check = (ok: boolean, message: string, field?: string) => { if (!ok) throw new Bad(400, message, field); };
const optDate = (v: unknown, field: string): string | null => {
    if (v == null || v === '') return null;
    check(isValidDate(v), 'รูปแบบวันที่ไม่ถูกต้อง', field);
    return v as string;
};
const reqDate = (v: unknown, field: string): string => {
    check(isValidDate(v), 'กรุณาระบุวันที่ให้ถูกต้อง', field);
    return v as string;
};
const text = (v: unknown): string | null => {
    const s = String(v ?? '').trim();
    return s === '' ? null : s;
};
const reqText = (v: unknown, field: string, label: string): string => {
    const s = text(v);
    check(!!s, `กรุณาระบุ${label}`, field);
    return s as string;
};

const audit = (sql: Sql, a: { actor: number; action: string; entity: string; entity_id?: number | null; contract_id?: number | null; before?: unknown; after?: unknown }) =>
    sql`INSERT INTO ctr_audit_log (actor_id, action, entity, entity_id, contract_id, before_data, after_data)
        VALUES (${a.actor}, ${a.action}, ${a.entity}, ${a.entity_id ?? null}, ${a.contract_id ?? null},
                ${a.before ? sql.json(a.before as any) : null}, ${a.after ? sql.json(a.after as any) : null})`;

// ปรับกำหนดงานที่ยังเปิดอยู่ตามวันหมดประกันที่เจ้าหน้าที่ตั้ง เรียกทุกครั้งที่วันที่ของสัญญาเปลี่ยน
const syncTasks = async (sql: Sql, contractId: number, rules: Rules) => {
    const [c] = await sql`
        SELECT accepted_date::text, warranty_end_date::text, warranty_months, periodic_months, status
        FROM proc_contracts WHERE id = ${contractId}`;
    const amendments = await sql`SELECT add_warranty_months FROM proc_contract_amendments WHERE contract_id = ${contractId}`;
    const { tasks } = planTasks({ ...c, amendments: [...amendments] }, rules);
    if (c.status !== 'active') return;
    for (const t of tasks) {
        await sql`
            INSERT INTO ctr_tasks (contract_id, code, round, title, duty, due_date)
            VALUES (${contractId}, ${t.code}, ${t.round}, ${t.title}, ${t.duty}, ${t.due_date})
            ON CONFLICT (contract_id, code, round) DO UPDATE
                SET due_date = EXCLUDED.due_date, title = EXCLUDED.title,
                    status = CASE WHEN ctr_tasks.status = 'cancelled' THEN 'open' ELSE ctr_tasks.status END
                WHERE ctr_tasks.status <> 'done'`;
    }
    // งานที่แผนใหม่ไม่มีแล้ว เช่น ลดรอบตรวจหรือเอาวันตรวจรับออก
    const keys = tasks.map(t => `${t.code}#${t.round}`);
    await sql`
        UPDATE ctr_tasks SET status = 'cancelled'
        WHERE contract_id = ${contractId} AND status = 'open'
          AND (code || '#' || round) NOT IN ${sql(keys.length ? keys : ['-'])}`;
    // มีเรื่องเสนอคืนแล้ว กำหนดจ่ายนับจากวันพ้นภาระจริง ไม่ใช่จาก T
    await sql`
        UPDATE ctr_tasks t SET due_date = r.due_date FROM proc_contract_returns r
        WHERE t.contract_id = ${contractId} AND t.code = 'PAY_RETURN' AND t.status = 'open'
          AND r.contract_id = t.contract_id AND r.status IN ('pending', 'approved')`;
};

const closeTask = (sql: Sql, contractId: number, code: string, uid: number) =>
    sql`UPDATE ctr_tasks SET status = 'done', done_by = ${uid}, done_at = NOW()
        WHERE contract_id = ${contractId} AND code = ${code} AND status = 'open'`;

const activeContract = async (sql: Sql, id: number) => {
    const [c] = await sql`SELECT id, status, warranty_end_date::text FROM proc_contracts WHERE id = ${id} FOR UPDATE`;
    if (!c) throw new Bad(404, 'ไม่พบสัญญา');
    if (c.status !== 'active') throw new Bad(409, 'สัญญานี้ปิดแล้ว แก้ไขไม่ได้');
    return c;
};

const hasLiveReturn = async (sql: Sql, id: number) =>
    (await sql`SELECT 1 FROM proc_contract_returns WHERE contract_id = ${id} AND status IN ('pending', 'approved')`).length > 0;

// ═══════════════ ผู้ใช้ปัจจุบัน / ภาพรวม ═══════════════
export const getContractMe = wrap(async ({ user }) => {
    const a = await accessOf(Number(user.id));
    const field = !a.isAdmin && a.duties.some(d => FIELD_DUTIES.includes(d));
    return {
        success: true,
        data: {
            ...a,
            screens: {
                procurement: a.isAdmin || a.procurement,
                finance: a.isAdmin || a.finance,
                inspection: a.isAdmin || field,
                custodian: a.isAdmin || a.procurement || field,
                approval: a.isAdmin || a.isDirector || a.duties.includes('approver'),
                executive: a.isAdmin || a.isExecutive,
                settings: a.seeAll,
                vendors: a.seeAll,
            },
        },
    };
});

const myTasks = async (a: Access) => {
    const direct = ['none', ...(a.procurement ? ['procurement'] : []), ...(a.finance ? ['finance'] : []), ...(a.isDirector ? ['approver'] : [])];
    return core_kon`
        SELECT t.id, t.contract_id, t.code, t.title, t.duty, t.due_date::text, c.contract_no, c.project_name
        FROM ctr_tasks t JOIN proc_contracts c ON c.id = t.contract_id
        WHERE t.status = 'open' AND c.status = 'active'
          AND (t.duty IN ${core_kon(direct)} OR EXISTS (
                SELECT 1 FROM proc_contract_staff s
                WHERE s.contract_id = t.contract_id AND (s.user_id = ${a.uid} OR s.backup_user_id = ${a.uid})
                  AND ((t.duty = 'approver' AND s.duty = 'approver') OR (t.duty = 'committee' AND s.duty IN ('committee', 'supervisor', 'custodian')))))
          -- งานอนุมัติ/จ่าย ขึ้นเมื่อมีเรื่องให้ทำจริง ไม่ขึ้นล่วงหน้าทั้งที่ยังกดอะไรไม่ได้
          AND (t.code <> 'APPROVE_RETURN' OR EXISTS (SELECT 1 FROM proc_contract_returns r WHERE r.contract_id = t.contract_id AND r.status = 'pending'))
          AND (t.code <> 'PAY_RETURN' OR EXISTS (SELECT 1 FROM proc_contract_returns r WHERE r.contract_id = t.contract_id AND r.status = 'approved'))
        ORDER BY t.due_date, t.id LIMIT 200`;
};

export const getContractOverview = wrap(async ({ user }) => {
    const a = await accessOf(Number(user.id));
    const rules = await loadRules();
    const today = todayBkk();
    const tasks = (await myTasks(a)).map((t: any) => ({ ...t, due_state: dueState(t.due_date, rules, today) }));
    if (!a.seeAll) return { success: true, data: { tasks, summary: null, rules } };

    const near = addDays(today, rules.near_due_days!);
    const [[contracts], byDuty, [money], [kpi]] = await Promise.all([
        core_kon`
            SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
                   count(*) FILTER (WHERE status = 'returned')::int AS returned,
                   count(*) FILTER (WHERE status = 'active' AND warranty_end_date IS NULL)::int AS no_t
            FROM proc_contracts`,
        core_kon`
            SELECT t.duty, count(*)::int AS open,
                   count(*) FILTER (WHERE t.due_date < ${today})::int AS overdue,
                   count(*) FILTER (WHERE t.due_date >= ${today} AND t.due_date <= ${near})::int AS near
            FROM ctr_tasks t JOIN proc_contracts c ON c.id = t.contract_id
            WHERE t.status = 'open' AND c.status = 'active' GROUP BY t.duty`,
        core_kon`
            SELECT COALESCE(sum(g.amount), 0)::float8 AS held,
                   COALESCE(sum(g.amount) FILTER (WHERE r.due_date < ${today}), 0)::float8 AS overdue_amount,
                   count(*) FILTER (WHERE g.expiry_date IS NOT NULL AND g.expiry_date <= (c.warranty_end_date + ${rules.guarantee_margin_days!}::int))::int AS expiring
            FROM fin_guarantees g JOIN proc_contracts c ON c.id = g.contract_id
            LEFT JOIN proc_contract_returns r ON r.contract_id = c.id AND r.status IN ('pending', 'approved')
            WHERE g.status = 'held'`,
        core_kon`
            SELECT count(*)::int AS total, count(*) FILTER (WHERE last_paid <= due_date)::int AS on_time
            FROM (SELECT r.due_date, max(p.paid_date) AS last_paid
                  FROM proc_contract_returns r JOIN proc_contracts c ON c.id = r.contract_id AND c.status = 'returned'
                  JOIN fin_guarantees g ON g.contract_id = c.id JOIN fin_guarantee_payouts p ON p.guarantee_id = g.id
                  WHERE r.status = 'approved' GROUP BY r.id, r.due_date) x`,
    ]);
    // ข้อมูลกราฟหน้ารวม: สัญญาอยู่ขั้นไหน · หลักประกันที่ต้องคืนตามเดือนหมดประกัน · หลักประกันแยกประเภท
    const [stages, expiry, byType] = await Promise.all([
        core_kon`
            SELECT stage, count(*)::int AS n FROM (
                SELECT CASE WHEN c.status = 'returned' THEN 'returned'
                            WHEN EXISTS (SELECT 1 FROM proc_contract_returns r WHERE r.contract_id = c.id AND r.status = 'approved') THEN 'approved'
                            WHEN EXISTS (SELECT 1 FROM proc_contract_returns r WHERE r.contract_id = c.id AND r.status = 'pending') THEN 'pending'
                            WHEN c.warranty_end_date IS NULL THEN 'no_t'
                            WHEN c.warranty_end_date > ${today} THEN 'warranty'
                            ELSE 'expired' END AS stage
                FROM proc_contracts c WHERE c.status <> 'cancelled') x
            GROUP BY stage`,
        core_kon`
            SELECT CASE WHEN c.warranty_end_date <= ${today} THEN 'past' ELSE to_char(c.warranty_end_date, 'YYYY-MM') END AS month,
                   count(*)::int AS contracts, COALESCE(sum(h.held), 0)::float8 AS amount
            FROM proc_contracts c
            LEFT JOIN LATERAL (SELECT sum(g.amount) AS held FROM fin_guarantees g WHERE g.contract_id = c.id AND g.status = 'held') h ON TRUE
            WHERE c.status = 'active' AND c.warranty_end_date IS NOT NULL
              AND c.warranty_end_date < (date_trunc('month', ${today}::date) + interval '12 months')
            GROUP BY 1 ORDER BY 1`,
        core_kon`
            SELECT g.guarantee_type, count(*)::int AS n, COALESCE(sum(g.amount), 0)::float8 AS amount
            FROM fin_guarantees g JOIN proc_contracts c ON c.id = g.contract_id
            WHERE g.status = 'held' GROUP BY 1`,
    ]);
    return { success: true, data: { tasks, rules, summary: { contracts, by_duty: byDuty, money, kpi, charts: { stages, expiry, by_type: byType } } } };
});

export const getContractMeta = wrap(async () => {
    const [majors, rules] = await Promise.all([core_kon`SELECT major_id, name FROM majors WHERE is_active = 'Y' ORDER BY name`, loadRules()]);
    return { success: true, data: { majors, defaults: { warranty_months: rules.default_warranty_months ?? 0 } } };
});

// วันหมดประกันทุกสัญญาสำหรับผู้บริหาร — ไม่มียอดเงินและข้อมูลผู้ติดต่อ
export const getWarrantyBoard = wrap(async ({ user }) => {
    const a = await accessOf(Number(user.id));
    need(a.seeAll || a.isExecutive);
    const rules = await loadRules();
    const today = todayBkk();
    const rows = await core_kon`
        SELECT c.id, c.contract_no, c.project_name, c.work_type, c.status, c.accepted_date::text, c.warranty_end_date::text,
               v.name AS vendor_name, m.name AS owner_major_name,
               (SELECT r.status FROM proc_contract_returns r WHERE r.contract_id = c.id AND r.status IN ('pending', 'approved')) AS return_status
        FROM proc_contracts c JOIN proc_vendors v ON v.id = c.vendor_id LEFT JOIN majors m ON m.major_id = c.owner_major_id
        WHERE c.status <> 'cancelled'
        ORDER BY (c.status = 'active') DESC, c.warranty_end_date NULLS LAST, c.id DESC LIMIT 1000`;
    return {
        success: true,
        data: rows.map((r: any) => ({ ...r, due_state: r.status === 'active' && r.warranty_end_date ? dueState(r.warranty_end_date, rules, today) : null })),
    };
});

export const getContractUserOptions = wrap(async ({ user, query }) => {
    need((await accessOf(Number(user.id))).procurement);
    const q = text(query?.search);
    const rows = await core_kon`
        SELECT u.id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, up.position_name
        FROM users u LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
        WHERE u.is_active = 'Y' ${q ? core_kon`AND CONCAT(u.pname, u.fname, ' ', u.lname) ILIKE ${'%' + q + '%'}` : core_kon``}
        ORDER BY u.fname LIMIT 30`;
    return { success: true, data: rows };
});

// ═══════════════ ค่าเริ่มต้นและกฎ (ctr_rules) ═══════════════
const MIN_ONE_RULES = ['return_days', 'default_warranty_months'];

export const getContractRules = wrap(async ({ user }) => {
    const a = await accessOf(Number(user.id));
    const rows = await core_kon`
        SELECT r.key, r.label, r.value, r.unit, r.ref_doc, r.is_proposal, r.sort, r.updated_at,
               CASE WHEN r.updated_by IS NULL THEN NULL ELSE (SELECT CONCAT(u.pname, u.fname, ' ', u.lname) FROM users u WHERE u.id = r.updated_by) END AS updated_by_name
        FROM ctr_rules r ORDER BY r.sort`;
    return { success: true, data: rows.map((r: any) => ({ ...r, editable: a.canEditRules })) };
});

export const updateContractRule = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id);
    need((await accessOf(uid)).canEditRules, 'เฉพาะผู้ดูแลระบบ');
    const value = Number(body.value);
    const min = MIN_ONE_RULES.includes(params.key) ? 1 : 0;
    check(Number.isInteger(value) && value >= min && value <= 3650, `ค่าต้องเป็นจำนวนเต็มตั้งแต่ ${min} ถึง 3650`, 'value');
    if (params.key === 'block_same_approver') check(value === 0 || value === 1, 'ค่าต้องเป็น 0 หรือ 1', 'value');
    if (params.key === 'proc_major_id' || params.key === 'fin_major_id') {
        check((await core_kon`SELECT 1 FROM majors WHERE major_id = ${value}`).length > 0, 'ไม่พบกลุ่มงานรหัสนี้', 'value');
    }
    await core_kon.begin(async (sql: Sql) => {
        const [before] = await sql`SELECT key, value, ref_doc FROM ctr_rules WHERE key = ${params.key} FOR UPDATE`;
        if (!before) throw new Bad(404, 'ไม่พบกฎนี้');
        const refDoc = body.ref_doc === undefined ? before.ref_doc : text(body.ref_doc);
        await sql`UPDATE ctr_rules SET value = ${value}, ref_doc = ${refDoc}, updated_by = ${uid}, updated_at = NOW() WHERE key = ${params.key}`;
        await audit(sql, { actor: uid, action: 'update', entity: 'ctr_rules', before, after: { key: params.key, value, ref_doc: refDoc } });
        const rules = await loadRules(sql);
        for (const c of await sql`SELECT id FROM proc_contracts WHERE status = 'active'`) await syncTasks(sql, c.id, rules);
    });
    return { success: true };
});

// ═══════════════ ผู้รับจ้าง (ทะเบียนกลาง) ═══════════════
export const getContractVendors = wrap(async ({ user }) => {
    const a = await accessOf(Number(user.id));
    need(a.seeAll);
    const rows = await core_kon`
        SELECT v.id, v.name, v.tax_id, v.contact_name, v.phone, v.email, v.address,
               (SELECT count(*)::int FROM proc_contracts c WHERE c.vendor_id = v.id AND c.status <> 'cancelled') AS contract_count,
               (SELECT COALESCE(sum(c.contract_value), 0)::float8 FROM proc_contracts c WHERE c.vendor_id = v.id AND c.status <> 'cancelled') AS contract_total,
               (SELECT COALESCE(sum(g.amount), 0)::float8 FROM fin_guarantees g JOIN proc_contracts c ON c.id = g.contract_id WHERE c.vendor_id = v.id AND g.status = 'held') AS guarantee_held,
               COALESCE(b.payable_total, 0)::float8 AS payable_total, COALESCE(b.paid_total, 0)::float8 AS paid_total,
               COALESCE(b.outstanding, 0)::float8 AS outstanding, COALESCE(b.overdue_amount, 0)::float8 AS overdue_amount
        FROM proc_vendors v LEFT JOIN fin_vendor_balances b ON b.vendor_id = v.id
        ORDER BY outstanding DESC, v.name`;
    return { success: true, data: rows };
});

const vendorValues = async (b: any, id = 0) => {
    const taxId = text(b.tax_id)?.replace(/\D/g, '') || null;
    const v = {
        name: reqText(b.name, 'name', 'ชื่อผู้รับจ้าง'),
        tax_id: taxId, contact_name: text(b.contact_name), phone: text(b.phone), email: text(b.email), address: text(b.address),
    };
    if (taxId) check(taxId.length === 13, 'เลขผู้เสียภาษีต้องมี 13 หลัก', 'tax_id');
    // บริษัทเดียวกันมีสองรหัส ประวัติงานและยอดเจ้าหนี้จะแตกเป็นสองก้อน
    const dup = await core_kon`SELECT 1 FROM proc_vendors WHERE LOWER(TRIM(name)) = LOWER(${v.name}) AND id <> ${id}`;
    check(dup.length === 0, 'มีผู้รับจ้างชื่อนี้ในทะเบียนแล้ว', 'name');
    return v;
};

export const createContractVendor = wrap(async ({ user, body }) => {
    const uid = Number(user.id);
    // ฟอร์มเพิ่มสัญญามีปุ่มเพิ่มผู้รับจ้าง ผู้ที่เพิ่มสัญญาได้จึงต้องเพิ่มผู้รับจ้างได้ด้วย
    need((await accessOf(uid)).editContracts);
    const v = await vendorValues(body);
    const row = await core_kon.begin(async (sql: Sql) => {
        const [r] = await sql`INSERT INTO proc_vendors ${sql({ ...v, created_by: uid })} RETURNING id, name`;
        await audit(sql, { actor: uid, action: 'create', entity: 'proc_vendors', entity_id: r.id, after: v });
        return r;
    });
    return { success: true, data: row };
});

export const updateContractVendor = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id);
    need((await accessOf(uid)).procurement);
    const v = await vendorValues(body, Number(params.id));
    await core_kon.begin(async (sql: Sql) => {
        const [before] = await sql`SELECT name, tax_id, contact_name, phone, email, address FROM proc_vendors WHERE id = ${params.id} FOR UPDATE`;
        if (!before) throw new Bad(404, 'ไม่พบผู้รับจ้าง');
        await sql`UPDATE proc_vendors SET ${sql(v)}, updated_at = NOW() WHERE id = ${params.id}`;
        await audit(sql, { actor: uid, action: 'update', entity: 'proc_vendors', entity_id: Number(params.id), before, after: v });
    });
    return { success: true };
});

// ═══════════════ เจ้าหนี้ ═══════════════
const payableRows = (where: any) => core_kon`
    SELECT p.id, p.vendor_id, v.name AS vendor_name, p.contract_id, c.contract_no, p.source_module, p.source_ref, p.description, p.invoice_no,
           p.invoice_date::text, p.due_date::text, p.amount::float8 AS amount, p.cancelled_at, p.cancel_reason,
           COALESCE(x.paid, 0)::float8 AS paid_amount, (p.amount - COALESCE(x.paid, 0))::float8 AS balance, x.last_paid::text AS last_paid_date
    FROM fin_payables p
    JOIN proc_vendors v ON v.id = p.vendor_id
    LEFT JOIN proc_contracts c ON c.id = p.contract_id
    LEFT JOIN LATERAL (SELECT sum(y.amount) AS paid, max(y.paid_date) AS last_paid FROM fin_payable_payments y WHERE y.payable_id = p.id AND y.voided_at IS NULL) x ON TRUE
    WHERE ${where}
    ORDER BY (p.cancelled_at IS NULL AND p.amount > COALESCE(x.paid, 0)) DESC, p.due_date NULLS LAST, p.id DESC LIMIT 1000`;

const withPayableState = (rows: any[], rules: Rules) => {
    const today = todayBkk();
    return rows.map(p => ({
        ...p,
        pay_status: p.cancelled_at ? 'cancelled' : p.balance <= 0 ? 'paid' : p.paid_amount > 0 ? 'partial' : 'unpaid',
        due_state: !p.cancelled_at && p.balance > 0 && p.due_date ? dueState(p.due_date, rules, today) : null,
    }));
};

export const getPayables = wrap(async ({ user, query }) => {
    need((await accessOf(Number(user.id))).seeAll);
    const q = text(query?.search);
    const rows = await payableRows(q
        ? core_kon`(v.name ILIKE ${'%' + q + '%'} OR p.invoice_no ILIKE ${'%' + q + '%'} OR p.description ILIKE ${'%' + q + '%'} OR c.contract_no ILIKE ${'%' + q + '%'})`
        : core_kon`TRUE`);
    return { success: true, data: withPayableState([...rows], await loadRules()) };
});

// การจ่ายที่ยังมีผล ใช้ทำยอดจ่ายรายเดือนและระยะเวลาจ่าย
export const getPayablePayments = wrap(async ({ user, query }) => {
    need((await accessOf(Number(user.id))).seeAll);
    const from = optDate(query?.from, 'from'), to = optDate(query?.to, 'to');
    const rows = await core_kon`
        SELECT y.id, y.payable_id, y.paid_date::text, y.amount::float8 AS amount, y.voucher_no,
               p.vendor_id, v.name AS vendor_name, p.invoice_no, p.description, p.invoice_date::text, p.due_date::text
        FROM fin_payable_payments y
        JOIN fin_payables p ON p.id = y.payable_id
        JOIN proc_vendors v ON v.id = p.vendor_id
        WHERE y.voided_at IS NULL
          ${from ? core_kon`AND y.paid_date >= ${from}` : core_kon``}
          ${to ? core_kon`AND y.paid_date <= ${to}` : core_kon``}
        ORDER BY y.paid_date DESC, y.id DESC LIMIT 5000`;
    return { success: true, data: rows };
});

export const getVendorById = wrap(async ({ user, params }) => {
    need((await accessOf(Number(user.id))).seeAll);
    const id = Number(params.id);
    const [vendor] = await core_kon`SELECT id, name, tax_id, contact_name, phone, email, address FROM proc_vendors WHERE id = ${id}`;
    if (!vendor) throw new Bad(404, 'ไม่พบผู้รับจ้าง');
    const [contracts, payables, payments, [balance], rules] = await Promise.all([
        core_kon`
            SELECT c.id, c.contract_no, c.project_name, c.work_type, c.status, c.contract_value::float8 AS contract_value,
                   c.signed_date::text, c.accepted_date::text, c.warranty_end_date::text,
                   (SELECT COALESCE(sum(g.amount), 0)::float8 FROM fin_guarantees g WHERE g.contract_id = c.id AND g.status = 'held') AS guarantee_held,
                   (SELECT count(*)::int FROM proc_contract_defects d WHERE d.contract_id = c.id) AS defect_count
            FROM proc_contracts c WHERE c.vendor_id = ${id} AND c.status <> 'cancelled'
            ORDER BY COALESCE(c.signed_date, c.accepted_date) DESC NULLS LAST, c.id DESC`,
        payableRows(core_kon`p.vendor_id = ${id}`),
        core_kon`
            SELECT y.id, y.payable_id, y.paid_date::text, y.amount::float8 AS amount, y.voucher_no, y.note, y.voided_at, y.void_reason,
                   p.invoice_no, p.description, CONCAT(u.pname, u.fname, ' ', u.lname) AS paid_by_name
            FROM fin_payable_payments y JOIN fin_payables p ON p.id = y.payable_id LEFT JOIN users u ON u.id = y.paid_by
            WHERE p.vendor_id = ${id} ORDER BY y.paid_date DESC, y.id DESC`,
        core_kon`SELECT payable_total::float8 AS payable_total, paid_total::float8 AS paid_total, outstanding::float8 AS outstanding, overdue_amount::float8 AS overdue_amount FROM fin_vendor_balances WHERE vendor_id = ${id}`,
        loadRules(),
    ]);
    return {
        success: true,
        data: {
            ...vendor,
            summary: {
                payable_total: balance?.payable_total ?? 0, paid_total: balance?.paid_total ?? 0, outstanding: balance?.outstanding ?? 0, overdue_amount: balance?.overdue_amount ?? 0,
                contract_count: contracts.length,
                contract_total: contracts.reduce((n: number, c: any) => n + (c.contract_value ?? 0), 0),
                guarantee_held: contracts.reduce((n: number, c: any) => n + c.guarantee_held, 0),
            },
            contracts, payments, payables: withPayableState([...payables], rules),
        },
    };
});

const payableValues = (b: any) => {
    const v = {
        description: reqText(b.description, 'description', 'รายการ'),
        invoice_no: text(b.invoice_no),
        invoice_date: reqDate(b.invoice_date, 'invoice_date'),
        due_date: optDate(b.due_date, 'due_date'),
        amount: Number(b.amount),
        contract_id: b.contract_id == null ? null : Number(b.contract_id),
        source_module: text(b.source_module),
        source_ref: text(b.source_ref),
    };
    check(Number.isFinite(v.amount) && v.amount > 0, 'จำนวนเงินต้องมากกว่า 0', 'amount');
    if (v.due_date) check(v.due_date >= v.invoice_date, 'วันครบกำหนดต้องไม่ก่อนวันที่ใบแจ้งหนี้', 'due_date');
    return v;
};

// ยอดเจ้าหนี้เกินวงเงินสัญญาอาจถูกต้องได้ (มีบันทึกแก้ไขวงเงิน) จึงเตือน ไม่ห้าม
const overContract = async (sql: Sql, contractId: number | null) => {
    if (contractId == null) return false;
    const [r] = await sql`
        SELECT c.contract_value::float8 AS contract_value,
               (SELECT COALESCE(sum(p.amount), 0)::float8 FROM fin_payables p WHERE p.contract_id = c.id AND p.cancelled_at IS NULL) AS total
        FROM proc_contracts c WHERE c.id = ${contractId}`;
    return r?.contract_value != null && r.total > r.contract_value;
};

const checkPayableContract = async (sql: Sql, contractId: number | null, vendorId: number) => {
    if (contractId == null) return;
    const [c] = await sql`SELECT vendor_id FROM proc_contracts WHERE id = ${contractId}`;
    check(!!c && Number(c.vendor_id) === vendorId, 'สัญญานี้ไม่ใช่ของผู้รับจ้างรายนี้', 'contract_id');
};

export const createPayable = wrap(async ({ user, body }) => {
    const uid = Number(user.id);
    need((await accessOf(uid)).finance, 'เฉพาะเจ้าหน้าที่การเงิน');
    const vendorId = Number(body.vendor_id);
    const v = payableValues(body);
    const data = await core_kon.begin(async (sql: Sql) => {
        check(Number.isInteger(vendorId) && (await sql`SELECT 1 FROM proc_vendors WHERE id = ${vendorId}`).length > 0, 'กรุณาเลือกผู้รับจ้าง', 'vendor_id');
        await checkPayableContract(sql, v.contract_id, vendorId);
        const [r] = await sql`INSERT INTO fin_payables ${sql({ ...v, vendor_id: vendorId, created_by: uid, updated_by: uid })} RETURNING id`;
        await audit(sql, { actor: uid, action: 'create', entity: 'fin_payables', entity_id: r.id, contract_id: v.contract_id, after: { ...v, vendor_id: vendorId } });
        return { id: r.id, over_contract: await overContract(sql, v.contract_id) };
    });
    return { success: true, data };
});

const lockPayable = async (sql: Sql, id: number) => {
    const [p] = await sql`SELECT id, vendor_id, contract_id, amount::float8 AS amount, cancelled_at, description, invoice_no, invoice_date::text, due_date::text FROM fin_payables WHERE id = ${id} FOR UPDATE`;
    if (!p) throw new Bad(404, 'ไม่พบรายการเจ้าหนี้');
    if (p.cancelled_at) throw new Bad(409, 'รายการนี้ถูกยกเลิกแล้ว');
    const [{ paid }] = await sql`SELECT COALESCE(sum(amount), 0)::float8 AS paid FROM fin_payable_payments WHERE payable_id = ${id} AND voided_at IS NULL`;
    return { ...p, paid };
};

export const updatePayable = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).finance, 'เฉพาะเจ้าหน้าที่การเงิน');
    // รหัสอ้างอิงระบบต้นทางแก้จากหน้านี้ไม่ได้ ไม่งั้นรายการจะหลุดจากงานเดิม
    const { source_module: _module, source_ref: _ref, ...v } = payableValues(body);
    const data = await core_kon.begin(async (sql: Sql) => {
        const before = await lockPayable(sql, id);
        check(v.amount >= before.paid, `จำนวนเงินต้องไม่น้อยกว่ายอดที่จ่ายแล้ว (${before.paid})`, 'amount');
        await checkPayableContract(sql, v.contract_id, Number(before.vendor_id));
        await sql`UPDATE fin_payables SET ${sql({ ...v, updated_by: uid })}, updated_at = NOW() WHERE id = ${id}`;
        await audit(sql, { actor: uid, action: 'update', entity: 'fin_payables', entity_id: id, contract_id: v.contract_id, before, after: v });
        return { over_contract: await overContract(sql, v.contract_id) };
    });
    return { success: true, data };
});

export const cancelPayable = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).finance, 'เฉพาะเจ้าหน้าที่การเงิน');
    const reason = reqText(body.reason, 'reason', 'เหตุผล');
    await core_kon.begin(async (sql: Sql) => {
        const p = await lockPayable(sql, id);
        if (p.paid > 0) throw new Bad(409, 'รายการนี้มีการจ่ายแล้ว ต้องยกเลิกการจ่ายก่อน');
        await sql`UPDATE fin_payables SET cancelled_at = NOW(), cancelled_by = ${uid}, cancel_reason = ${reason}, updated_by = ${uid}, updated_at = NOW() WHERE id = ${id}`;
        await audit(sql, { actor: uid, action: 'cancel', entity: 'fin_payables', entity_id: id, contract_id: p.contract_id, after: { reason } });
    });
    return { success: true };
});

export const createPayablePayment = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).finance, 'เฉพาะเจ้าหน้าที่การเงิน');
    const v = {
        paid_date: reqDate(body.paid_date, 'paid_date'), amount: Number(body.amount),
        voucher_no: reqText(body.voucher_no, 'voucher_no', 'เลขที่ใบสำคัญจ่าย'), note: text(body.note),
    };
    check(Number.isFinite(v.amount) && v.amount > 0, 'จำนวนเงินต้องมากกว่า 0', 'amount');
    check(v.paid_date <= todayBkk(), 'วันที่จ่ายต้องไม่เกินวันนี้', 'paid_date');
    const data = await core_kon.begin(async (sql: Sql) => {
        const p = await lockPayable(sql, id);
        const balance = Math.round((p.amount - p.paid) * 100) / 100;
        check(balance > 0, 'รายการนี้จ่ายครบแล้ว');
        check(v.amount <= balance, `จ่ายเกินยอดค้าง (ค้าง ${balance})`, 'amount');
        check(v.paid_date >= p.invoice_date, 'วันที่จ่ายต้องไม่ก่อนวันที่ใบแจ้งหนี้', 'paid_date');
        const [r] = await sql`INSERT INTO fin_payable_payments ${sql({ ...v, payable_id: id, paid_by: uid })} RETURNING id`;
        await audit(sql, { actor: uid, action: 'pay', entity: 'fin_payable_payments', entity_id: r.id, contract_id: p.contract_id, after: { ...v, payable_id: id } });
        return { balance: Math.round((balance - v.amount) * 100) / 100 };
    });
    return { success: true, data };
});

export const voidPayablePayment = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).finance, 'เฉพาะเจ้าหน้าที่การเงิน');
    const reason = reqText(body.reason, 'reason', 'เหตุผล');
    await core_kon.begin(async (sql: Sql) => {
        const [y] = await sql`SELECT y.payable_id, y.voided_at, p.contract_id FROM fin_payable_payments y JOIN fin_payables p ON p.id = y.payable_id WHERE y.id = ${id} FOR UPDATE OF y`;
        if (!y) throw new Bad(404, 'ไม่พบรายการจ่าย');
        if (y.voided_at) throw new Bad(409, 'รายการจ่ายนี้ถูกยกเลิกแล้ว');
        await sql`UPDATE fin_payable_payments SET voided_at = NOW(), voided_by = ${uid}, void_reason = ${reason} WHERE id = ${id}`;
        await audit(sql, { actor: uid, action: 'void', entity: 'fin_payable_payments', entity_id: id, contract_id: y.contract_id, after: { reason } });
    });
    return { success: true };
});

// ═══════════════ ทะเบียนสัญญา ═══════════════
export const getContracts = wrap(async ({ user, query }) => {
    const a = await accessOf(Number(user.id));
    const rules = await loadRules();
    const q = text(query?.search);
    // ระบุ duty = หน้าจอของหน้าที่นั้น: ผู้รับมอบหมายเห็นเฉพาะสัญญาของตน แม้จะอยู่พัสดุก็ตาม
    const duties = query?.duty === 'approver' ? ['approver'] : query?.duty === 'field' ? FIELD_DUTIES : query?.duty === 'custodian' ? ['custodian', 'committee', 'supervisor'] : null;
    const seeAll = a.seeAll && (!duties || a.isAdmin || (query?.duty === 'custodian' && a.procurement));
    const rows = await core_kon`
        SELECT c.id, c.contract_no, c.project_name, c.work_type, c.status, c.accepted_date::text, c.warranty_end_date::text,
               c.warranty_months, v.name AS vendor_name, m.name AS owner_major_name,
               c.contract_value::float8 AS contract_value,
               (SELECT COALESCE(sum(g.amount), 0)::float8 FROM fin_guarantees g WHERE g.contract_id = c.id AND g.status = 'held') AS held_amount,
               (SELECT min(t.due_date)::text FROM ctr_tasks t WHERE t.contract_id = c.id AND t.status = 'open') AS next_due,
               (SELECT t.title FROM ctr_tasks t WHERE t.contract_id = c.id AND t.status = 'open' ORDER BY t.due_date, t.id LIMIT 1) AS next_task,
               (SELECT count(*)::int FROM proc_contract_defects d WHERE d.contract_id = c.id AND d.fixed_date IS NULL) AS open_defects,
               (SELECT count(*)::int FROM proc_contract_documents d WHERE d.contract_id = c.id) AS doc_count,
               (SELECT i.result FROM proc_contract_inspections i WHERE i.contract_id = c.id AND i.kind = 'final' ORDER BY i.inspected_date DESC, i.id DESC LIMIT 1) AS final_result,
               (SELECT string_agg(DISTINCT s.duty, ',') FROM proc_contract_staff s WHERE s.contract_id = c.id AND (s.user_id = ${a.uid} OR s.backup_user_id = ${a.uid})) AS my_duties
        FROM proc_contracts c
        JOIN proc_vendors v ON v.id = c.vendor_id
        LEFT JOIN majors m ON m.major_id = c.owner_major_id
        WHERE TRUE
          ${q ? core_kon`AND (c.contract_no ILIKE ${'%' + q + '%'} OR c.project_name ILIKE ${'%' + q + '%'} OR v.name ILIKE ${'%' + q + '%'})` : core_kon``}
          ${seeAll ? core_kon`` : core_kon`AND EXISTS (SELECT 1 FROM proc_contract_staff s WHERE s.contract_id = c.id AND (s.user_id = ${a.uid} OR s.backup_user_id = ${a.uid})
                ${duties ? core_kon`AND s.duty IN ${core_kon(duties)}` : core_kon``})`}
        ORDER BY (c.status = 'active') DESC, next_due NULLS LAST, c.id DESC LIMIT 1000`;
    const today = todayBkk();
    return {
        success: true,
        data: rows.map((r: any) => {
            const myDuties: string[] = r.my_duties ? r.my_duties.split(',') : [];
            const money = a.seeAll || myDuties.includes('approver');
            return {
                ...r,
                contract_value: money ? r.contract_value : null,
                held_amount: money ? r.held_amount : null,
                due_state: r.status === 'active' && r.next_due ? dueState(r.next_due, rules, today) : null,
            };
        }),
    };
});

const contractValues = async (b: any) => {
    const v = {
        contract_no: reqText(b.contract_no, 'contract_no', 'เลขที่สัญญา'),
        project_name: reqText(b.project_name, 'project_name', 'ชื่อโครงการ'),
        work_type: String(b.work_type ?? ''),
        vendor_id: Number(b.vendor_id),
        contract_value: b.contract_value == null ? null : Number(b.contract_value),
        owner_major_id: b.owner_major_id == null ? null : Number(b.owner_major_id),
        signed_date: optDate(b.signed_date, 'signed_date'),
        delivered_date: optDate(b.delivered_date, 'delivered_date'),
        accepted_date: optDate(b.accepted_date, 'accepted_date'),
        warranty_end_date: optDate(b.warranty_end_date, 'warranty_end_date'),
        warranty_months: Number(b.warranty_months ?? 0),
        periodic_months: b.periodic_months == null ? null : Number(b.periodic_months),
        special_terms: text(b.special_terms),
    };
    check(['construction', 'purchase', 'hire', 'maintenance'].includes(v.work_type), 'กรุณาเลือกประเภทงาน', 'work_type');
    check((await core_kon`SELECT 1 FROM proc_vendors WHERE id = ${v.vendor_id}`).length > 0, 'กรุณาเลือกผู้รับจ้าง', 'vendor_id');
    check(v.contract_value == null || v.contract_value >= 0, 'วงเงินต้องไม่ติดลบ', 'contract_value');
    check(Number.isInteger(v.warranty_months) && v.warranty_months >= 0 && v.warranty_months <= 600, 'ระยะประกันต้องเป็นจำนวนเดือน', 'warranty_months');
    check(v.periodic_months == null || (Number.isInteger(v.periodic_months) && v.periodic_months > 0), 'รอบตรวจต้องเป็นจำนวนเดือน', 'periodic_months');
    // ลำดับวันที่ผิดเป็นต้นเหตุหลักของการแจ้งเตือนผิดเวลา จึงกันตั้งแต่ตอนกรอก
    if (v.signed_date && v.delivered_date) check(v.signed_date <= v.delivered_date, 'วันส่งมอบต้องไม่ก่อนวันลงนาม', 'delivered_date');
    if (v.delivered_date && v.accepted_date) check(v.delivered_date <= v.accepted_date, 'วันตรวจรับต้องไม่ก่อนวันส่งมอบ', 'accepted_date');
    if (v.signed_date && v.accepted_date) check(v.signed_date <= v.accepted_date, 'วันตรวจรับต้องไม่ก่อนวันลงนาม', 'accepted_date');
    if (v.warranty_end_date) {
        check(!!v.accepted_date, 'ตั้งวันหมดประกันได้เมื่อมีวันตรวจรับแล้ว', 'accepted_date');
        check(v.warranty_end_date > (v.accepted_date as string), 'วันหมดประกันต้องหลังวันตรวจรับ', 'warranty_end_date');
        check(v.warranty_months >= 1, 'ต้องระบุระยะประกัน เพราะใช้กำหนดวันตรวจรอบสุดท้าย', 'warranty_months');
    }
    return v;
};

export const createContract = wrap(async ({ user, body }) => {
    const uid = Number(user.id);
    need((await accessOf(uid)).editContracts);
    const v = await contractValues(body);
    const rules = await loadRules();
    const id = await core_kon.begin(async (sql: Sql) => {
        const [r] = await sql`INSERT INTO proc_contracts ${sql({ ...v, created_by: uid, updated_by: uid })} RETURNING id`;
        await syncTasks(sql, r.id, rules);
        await audit(sql, { actor: uid, action: 'create', entity: 'proc_contracts', entity_id: r.id, contract_id: r.id, after: v });
        return r.id;
    });
    return { success: true, data: { id } };
});

export const updateContract = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).editContracts);
    const v = await contractValues(body);
    const rules = await loadRules();
    await core_kon.begin(async (sql: Sql) => {
        await activeContract(sql, id);
        if (await hasLiveReturn(sql, id)) throw new Bad(409, 'มีเรื่องเสนอคืนค้างอยู่ ต้องให้ผู้อนุมัติส่งกลับก่อนจึงแก้ไขสัญญาได้');
        const [before] = await sql`SELECT contract_no, project_name, work_type, vendor_id, contract_value, owner_major_id, signed_date::text, delivered_date::text, accepted_date::text, warranty_end_date::text, warranty_months, periodic_months, special_terms FROM proc_contracts WHERE id = ${id}`;
        await sql`UPDATE proc_contracts SET ${sql({ ...v, updated_by: uid })}, updated_at = NOW() WHERE id = ${id}`;
        await syncTasks(sql, id, rules);
        await audit(sql, { actor: uid, action: 'update', entity: 'proc_contracts', entity_id: id, contract_id: id, before, after: v });
    });
    return { success: true };
});

export const cancelContract = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).editContracts);
    const reason = reqText(body.reason, 'reason', 'เหตุผล');
    await core_kon.begin(async (sql: Sql) => {
        await activeContract(sql, id);
        // หลักประกันอาจต้องคืนหรือริบ ซึ่งพัสดุ/ฝ่ายกฎหมายต้องตัดสินก่อน ระบบจึงไม่ปิดให้เอง
        check((await sql`SELECT 1 FROM fin_guarantees WHERE contract_id = ${id} AND status = 'held'`).length === 0, 'ยังมีหลักประกันค้างอยู่ ยกเลิกสัญญาไม่ได้');
        await sql`UPDATE proc_contracts SET status = 'cancelled', cancel_reason = ${reason}, updated_by = ${uid}, updated_at = NOW() WHERE id = ${id}`;
        await sql`UPDATE ctr_tasks SET status = 'cancelled' WHERE contract_id = ${id} AND status = 'open'`;
        await audit(sql, { actor: uid, action: 'cancel', entity: 'proc_contracts', entity_id: id, contract_id: id, after: { reason } });
    });
    return { success: true };
});

// เหตุที่ลบสัญญาไม่ได้ · null = ลบได้
// หลักประกันและเจ้าหนี้เป็นเงินจริง ต้องลบ/ยกเลิกทางหน้าการเงินก่อน ระบบไม่ลบตามไปเอง
const contractDeleteBlock = async (sql: Sql, id: number): Promise<string | null> => {
    const [r] = await sql`
        SELECT (SELECT count(*)::int FROM fin_guarantees WHERE contract_id = ${id}) AS guarantees,
               (SELECT count(*)::int FROM fin_payables WHERE contract_id = ${id}) AS payables`;
    if (r.guarantees > 0) return `มีหลักประกัน ${r.guarantees} รายการ ต้องลบหลักประกันก่อน (หลักประกันที่คืนแล้วลบไม่ได้)`;
    if (r.payables > 0) return `มีเจ้าหนี้ผูกกับสัญญานี้ ${r.payables} รายการ`;
    return null;
};

// ลบถาวร ใช้กับสัญญาที่บันทึกผิด เฉพาะ ADMIN · ประวัติใน ctr_audit_log ยังอยู่
export const deleteContract = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).isAdmin, 'เฉพาะผู้ดูแลระบบ');
    const reason = reqText(body?.reason, 'reason', 'เหตุผลที่ลบ');
    await core_kon.begin(async (sql: Sql) => {
        const [before] = await sql`SELECT * FROM proc_contracts WHERE id = ${id} FOR UPDATE`;
        if (!before) throw new Bad(404, 'ไม่พบสัญญา');
        const block = await contractDeleteBlock(sql, id);
        if (block) throw new Bad(409, `ลบไม่ได้: ${block}`);
        // เก็บสำเนาข้อมูลลูกไว้ใน audit เผื่อต้องตรวจย้อนหลังว่าลบอะไรไป
        const children = {
            staff: [...await sql`DELETE FROM proc_contract_staff WHERE contract_id = ${id} RETURNING duty, user_id, backup_user_id`],
            amendments: [...await sql`DELETE FROM proc_contract_amendments WHERE contract_id = ${id} RETURNING amendment_no, amendment_date::text, change_type, detail`],
            documents: [...await sql`DELETE FROM proc_contract_documents WHERE contract_id = ${id} RETURNING doc_type, title, location`],
            inspections: [...await sql`DELETE FROM proc_contract_inspections WHERE contract_id = ${id} RETURNING kind, inspected_date::text, result`],
            defects: [...await sql`DELETE FROM proc_contract_defects WHERE contract_id = ${id} RETURNING found_date::text, detail, fixed_date::text`],
            returns: [...await sql`DELETE FROM proc_contract_returns WHERE contract_id = ${id} RETURNING released_date::text, status`],
            tasks: (await sql`DELETE FROM ctr_tasks WHERE contract_id = ${id} RETURNING id`).length,
        };
        await sql`DELETE FROM proc_contracts WHERE id = ${id}`;
        await audit(sql, { actor: uid, action: 'delete', entity: 'proc_contracts', entity_id: id, contract_id: id, before: { ...before, ...children }, after: { reason } });
    });
    return { success: true };
});

export const getContractById = wrap(async ({ user, params }) => {
    const a = await accessOf(Number(user.id));
    const id = Number(params.id);
    const myDuties = await dutiesOn(a.uid, id);
    need(a.seeAll || a.isDirector || myDuties.length > 0, 'ไม่มีสิทธิ์ดูสัญญานี้');
    // ผอ. เห็นยอดเงินเฉพาะสัญญาที่มีเรื่องเสนอคืนมาให้พิจารณา
    const directorReview = a.isDirector && (await core_kon`SELECT 1 FROM proc_contract_returns WHERE contract_id = ${id} LIMIT 1`).length > 0;
    const money = a.seeAll || myDuties.includes('approver') || directorReview;
    const [c] = await core_kon`
        SELECT c.id, c.contract_no, c.project_name, c.work_type, c.vendor_id, c.owner_major_id, m.name AS owner_major_name,
               c.contract_value::float8 AS contract_value, c.signed_date::text, c.delivered_date::text, c.accepted_date::text,
               c.warranty_months, c.warranty_end_date::text, c.periodic_months, c.special_terms,
               c.status, c.cancel_reason, v.name AS vendor_name, v.tax_id AS vendor_tax_id, v.contact_name AS vendor_contact, v.phone AS vendor_phone
        FROM proc_contracts c JOIN proc_vendors v ON v.id = c.vendor_id LEFT JOIN majors m ON m.major_id = c.owner_major_id
        WHERE c.id = ${id}`;
    if (!c) throw new Bad(404, 'ไม่พบสัญญา');
    const nameOf = (col: string) => core_kon`(SELECT CONCAT(u.pname, u.fname, ' ', u.lname) FROM users u WHERE u.id = ${core_kon(col)})`;
    const rules = await loadRules();
    const [amendments, staff, documents, inspections, defects, returns, guarantees, tasks, auditRows] = await Promise.all([
        core_kon`SELECT id, amendment_no, amendment_date::text, change_type, detail, old_warranty_end_date::text, new_warranty_end_date::text, add_warranty_months FROM proc_contract_amendments WHERE contract_id = ${id} ORDER BY amendment_date, id`,
        core_kon`SELECT id, duty, user_id, backup_user_id, ${nameOf('user_id')} AS user_name, ${nameOf('backup_user_id')} AS backup_name FROM proc_contract_staff WHERE contract_id = ${id} ORDER BY duty, id`,
        money ? core_kon`SELECT id, doc_type, title, holder_user_id, backup_user_id, ${nameOf('holder_user_id')} AS holder_name, ${nameOf('backup_user_id')} AS backup_name, location, scan_ref, last_checked_date::text, check_result, note FROM proc_contract_documents WHERE contract_id = ${id} ORDER BY id` : [],
        core_kon`SELECT id, kind, inspected_date::text, inspector_id, ${nameOf('inspector_id')} AS inspector_name, result, detail FROM proc_contract_inspections WHERE contract_id = ${id} ORDER BY inspected_date DESC, id DESC`,
        core_kon`SELECT id, found_date::text, detail, reported_by, ${nameOf('reported_by')} AS reporter_name, notified_vendor_date::text, fixed_date::text, fixed_note FROM proc_contract_defects WHERE contract_id = ${id} ORDER BY found_date DESC, id DESC`,
        money ? core_kon`SELECT id, released_date::text, due_date::text, memo, status, proposed_by, ${nameOf('proposed_by')} AS proposer_name, decided_by, ${nameOf('decided_by')} AS decider_name, decided_at, decision_note FROM proc_contract_returns WHERE contract_id = ${id} ORDER BY id DESC` : [],
        money ? core_kon`
            SELECT g.id, g.guarantee_type, g.purpose, g.amount::float8 AS amount, g.bank_name, g.doc_no, g.expiry_date::text, g.storage_location, g.status,
                   p.method, p.paid_date::text, p.deduct_amount::float8 AS deduct_amount, p.deduct_reason, p.net_amount::float8 AS net_amount, p.receiver_name, p.voucher_no
            FROM fin_guarantees g LEFT JOIN fin_guarantee_payouts p ON p.guarantee_id = g.id WHERE g.contract_id = ${id} ORDER BY g.id` : [],
        core_kon`SELECT id, code, round, title, duty, due_date::text, status, done_at FROM ctr_tasks WHERE contract_id = ${id} AND status <> 'cancelled' ORDER BY due_date, id`,
        a.seeAll ? core_kon`SELECT l.id, l.action, l.entity, l.created_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS actor_name FROM ctr_audit_log l LEFT JOIN users u ON u.id = l.actor_id WHERE l.contract_id = ${id} ORDER BY l.id DESC LIMIT 50` : [],
    ]);
    const today = todayBkk();
    const active = c.status === 'active';
    const liveReturn = (returns as any[]).find(r => r.status === 'pending' || r.status === 'approved') ?? null;
    const deleteBlock = a.isAdmin ? await contractDeleteBlock(core_kon, id) : null;
    return {
        success: true,
        data: {
            ...c,
            contract_value: money ? c.contract_value : null,
            vendor_tax_id: money ? c.vendor_tax_id : null,
            vendor_contact: money ? c.vendor_contact : null,
            vendor_phone: money ? c.vendor_phone : null,
            amendments, staff, documents, inspections, defects, returns, tasks: tasks.map((t: any) => ({ ...t, due_state: t.status === 'open' ? dueState(t.due_date, rules, today) : null })),
            guarantees: (guarantees as any[]).map(g => ({ ...g, expiring: g.status === 'held' && guaranteeExpiresTooSoon(g.expiry_date, c.warranty_end_date, rules) })),
            audit: auditRows,
            can: {
                edit: active && a.editContracts,
                // ขั้นตอนของพัสดุ (เสนอคืน ปิดงาน ติดตามชำรุด) ADMIN ทำแทนไม่ได้
                procure: active && a.procurement,
                finance: active && a.editGuarantees,
                delete: a.isAdmin && !deleteBlock,
                delete_block: a.isAdmin ? deleteBlock : null,
                inspect: active && !a.isAdmin && myDuties.some(d => FIELD_DUTIES.includes(d)),
                report_defect: active && (a.procurement || (!a.isAdmin && myDuties.some(d => FIELD_DUTIES.includes(d)))),
                decide: active && !a.isAdmin && liveReturn?.status === 'pending' && (a.isDirector || myDuties.includes('approver')),
                see_money: money,
            },
        },
    };
});

// ═══════════════ แก้ไขสัญญา ผู้รับผิดชอบ เอกสาร ═══════════════
export const createAmendment = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).editContracts);
    const v = {
        amendment_no: reqText(body.amendment_no, 'amendment_no', 'เลขที่บันทึกแก้ไข'),
        amendment_date: reqDate(body.amendment_date, 'amendment_date'),
        change_type: String(body.change_type ?? ''),
        detail: reqText(body.detail, 'detail', 'รายละเอียดที่เปลี่ยน'),
        new_warranty_end_date: optDate(body.new_warranty_end_date, 'new_warranty_end_date'),
        add_warranty_months: Number(body.add_warranty_months ?? 0),
    };
    check(['extend_time', 'value', 'warranty', 'other'].includes(v.change_type), 'กรุณาเลือกประเภทการแก้ไข', 'change_type');
    check(Number.isInteger(v.add_warranty_months), 'จำนวนเดือนไม่ถูกต้อง', 'add_warranty_months');
    const rules = await loadRules();
    const warnings = await core_kon.begin(async (sql: Sql) => {
        await activeContract(sql, id);
        if (await hasLiveReturn(sql, id)) throw new Bad(409, 'มีเรื่องเสนอคืนค้างอยู่ ต้องให้ผู้อนุมัติส่งกลับก่อนจึงแก้ไขสัญญาได้');
        const [c] = await sql`SELECT accepted_date::text, warranty_end_date::text, warranty_months FROM proc_contracts WHERE id = ${id}`;
        const end = v.new_warranty_end_date ?? c.warranty_end_date;
        if (v.new_warranty_end_date) {
            check(!!c.accepted_date, 'ตั้งวันหมดประกันได้เมื่อมีวันตรวจรับแล้ว', 'new_warranty_end_date');
            check(v.new_warranty_end_date > c.accepted_date, 'วันหมดประกันต้องหลังวันตรวจรับ', 'new_warranty_end_date');
        }
        const prev = await sql`SELECT add_warranty_months FROM proc_contract_amendments WHERE contract_id = ${id}`;
        const months = totalWarrantyMonths({ warranty_months: c.warranty_months, amendments: [...prev, v] });
        check(months >= (end ? 1 : 0), end ? 'ระยะประกันหลังแก้ไขต้องอย่างน้อย 1 เดือน' : 'ระยะประกันหลังแก้ไขติดลบ', 'add_warranty_months');
        const [r] = await sql`INSERT INTO proc_contract_amendments ${sql({ ...v, old_warranty_end_date: v.new_warranty_end_date ? c.warranty_end_date : null, contract_id: id, created_by: uid })} RETURNING id`;
        if (v.new_warranty_end_date) await sql`UPDATE proc_contracts SET warranty_end_date = ${v.new_warranty_end_date}, updated_by = ${uid}, updated_at = NOW() WHERE id = ${id}`;
        await syncTasks(sql, id, rules);
        await audit(sql, { actor: uid, action: 'amend', entity: 'proc_contract_amendments', entity_id: r.id, contract_id: id, before: { warranty_end_date: c.warranty_end_date }, after: v });
        // วันหมดประกันเปลี่ยนแล้ว หลักประกันอาจไม่คุ้มระยะเวลาใหม่ ให้การเงินเรียกต่ออายุ
        const held = await sql`SELECT doc_no, expiry_date::text FROM fin_guarantees WHERE contract_id = ${id} AND status = 'held' AND expiry_date IS NOT NULL`;
        return held.filter((g: any) => guaranteeExpiresTooSoon(g.expiry_date, end, rules)).map((g: any) => `หนังสือค้ำประกัน ${g.doc_no ?? ''} หมดอายุ ${g.expiry_date} ไม่คุ้มวันหมดประกัน ${end}`);
    });
    return { success: true, data: { warnings } };
});

export const replaceContractStaff = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).editContracts);
    const rows = body.staff.map((s: any) => ({
        duty: String(s.duty), user_id: Number(s.user_id), backup_user_id: s.backup_user_id == null ? null : Number(s.backup_user_id),
    }));
    const ids = [...new Set(rows.flatMap((s: any) => [s.user_id, s.backup_user_id]).filter((x: any) => x != null))] as number[];
    if (ids.length) {
        const found = await core_kon`SELECT id FROM users WHERE id IN ${core_kon(ids)} AND is_active = 'Y'`;
        check(found.length === ids.length, 'พบรายชื่อที่ไม่อยู่ในระบบหรือพ้นสภาพแล้ว');
    }
    for (const s of rows) {
        check(['committee', 'supervisor', 'custodian', 'approver'].includes(s.duty), 'หน้าที่ไม่ถูกต้อง');
        check(s.backup_user_id !== s.user_id, 'ผู้สำรองต้องเป็นคนละคนกับผู้รับผิดชอบ');
    }
    const rules = await loadRules();
    if (rules.block_same_approver) {
        const inspectors = new Set(rows.filter((s: any) => s.duty !== 'approver').map((s: any) => s.user_id));
        check(!rows.some((s: any) => s.duty === 'approver' && inspectors.has(s.user_id)), 'ผู้อนุมัติต้องไม่เป็นผู้ตรวจในสัญญาเดียวกัน');
    }
    await core_kon.begin(async (sql: Sql) => {
        await activeContract(sql, id);
        const before = await sql`SELECT duty, user_id, backup_user_id FROM proc_contract_staff WHERE contract_id = ${id}`;
        await sql`DELETE FROM proc_contract_staff WHERE contract_id = ${id}`;
        if (rows.length) await sql`INSERT INTO proc_contract_staff ${sql(rows.map((s: any) => ({ ...s, contract_id: id })))}`;
        await audit(sql, { actor: uid, action: 'assign', entity: 'proc_contract_staff', contract_id: id, before: [...before], after: rows });
    });
    return { success: true };
});

const documentValues = (b: any) => ({
    doc_type: reqText(b.doc_type, 'doc_type', 'ประเภทเอกสาร'),
    title: reqText(b.title, 'title', 'ชื่อเอกสาร'),
    holder_user_id: Number(b.holder_user_id),
    backup_user_id: b.backup_user_id == null ? null : Number(b.backup_user_id),
    location: reqText(b.location, 'location', 'สถานที่เก็บ'),
    scan_ref: text(b.scan_ref),
    last_checked_date: optDate(b.last_checked_date, 'last_checked_date'),
    check_result: b.check_result ?? null,
    note: text(b.note),
});

export const createContractDocument = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).editContracts);
    const v = documentValues(body);
    check(Number.isInteger(v.holder_user_id) && v.holder_user_id > 0, 'กรุณาเลือกผู้ถือต้นฉบับ', 'holder_user_id');
    await core_kon.begin(async (sql: Sql) => {
        await activeContract(sql, id);
        const [r] = await sql`INSERT INTO proc_contract_documents ${sql({ ...v, contract_id: id, created_by: uid })} RETURNING id`;
        await audit(sql, { actor: uid, action: 'create', entity: 'proc_contract_documents', entity_id: r.id, contract_id: id, after: v });
    });
    return { success: true };
});

export const updateContractDocument = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), docId = Number(params.id);
    need((await accessOf(uid)).editContracts);
    const v = documentValues(body);
    check(Number.isInteger(v.holder_user_id) && v.holder_user_id > 0, 'กรุณาเลือกผู้ถือต้นฉบับ', 'holder_user_id');
    await core_kon.begin(async (sql: Sql) => {
        const [before] = await sql`SELECT contract_id, doc_type, title, holder_user_id, backup_user_id, location, scan_ref, last_checked_date::text, check_result, note FROM proc_contract_documents WHERE id = ${docId} FOR UPDATE`;
        if (!before) throw new Bad(404, 'ไม่พบเอกสาร');
        await sql`UPDATE proc_contract_documents SET ${sql(v)}, updated_at = NOW() WHERE id = ${docId}`;
        await audit(sql, { actor: uid, action: 'update', entity: 'proc_contract_documents', entity_id: docId, contract_id: before.contract_id, before, after: v });
    });
    return { success: true };
});

// ═══════════════ กรรมการ / ผู้ครอบครองพัสดุ ═══════════════
export const createInspection = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    const [a, duties] = await Promise.all([accessOf(uid), dutiesOn(uid, id)]);
    need(!a.isAdmin && duties.some(d => FIELD_DUTIES.includes(d)), 'เฉพาะกรรมการ ผู้ควบคุมงาน หรือผู้ครอบครองพัสดุของสัญญานี้');
    const v = {
        kind: String(body.kind ?? ''), inspected_date: reqDate(body.inspected_date, 'inspected_date'),
        result: String(body.result ?? ''), detail: text(body.detail),
    };
    check(['periodic', 'final'].includes(v.kind), 'กรุณาเลือกรอบการตรวจ', 'kind');
    check(['pass', 'defect'].includes(v.result), 'กรุณาเลือกผลการตรวจ', 'result');
    check(v.inspected_date <= todayBkk(), 'วันที่ตรวจต้องไม่เกินวันนี้', 'inspected_date');
    if (v.result === 'defect') check(!!v.detail, 'พบชำรุดต้องระบุรายละเอียด', 'detail');
    await core_kon.begin(async (sql: Sql) => {
        await activeContract(sql, id);
        const [r] = await sql`INSERT INTO proc_contract_inspections ${sql({ ...v, contract_id: id, inspector_id: uid })} RETURNING id`;
        if (v.result === 'defect') {
            await sql`INSERT INTO proc_contract_defects (contract_id, found_date, detail, reported_by) VALUES (${id}, ${v.inspected_date}, ${v.detail}, ${uid})`;
        }
        if (v.kind === 'final' && v.result === 'pass') await closeTask(sql, id, 'FINAL_INSPECTION', uid);
        if (v.kind === 'periodic') {
            await sql`UPDATE ctr_tasks SET status = 'done', done_by = ${uid}, done_at = NOW()
                      WHERE id = (SELECT id FROM ctr_tasks WHERE contract_id = ${id} AND code = 'PERIODIC_INSPECTION' AND status = 'open' ORDER BY round LIMIT 1)`;
        }
        await audit(sql, { actor: uid, action: 'inspect', entity: 'proc_contract_inspections', entity_id: r.id, contract_id: id, after: v });
    });
    return { success: true };
});

export const createDefect = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    const a = await accessOf(uid);
    need(a.procurement || (!a.isAdmin && (await dutiesOn(uid, id)).some(d => FIELD_DUTIES.includes(d))), 'เฉพาะผู้ครอบครองพัสดุ กรรมการ หรือเจ้าหน้าที่พัสดุ');
    const v = { found_date: reqDate(body.found_date, 'found_date'), detail: reqText(body.detail, 'detail', 'รายละเอียดความชำรุด') };
    check(v.found_date <= todayBkk(), 'วันที่พบต้องไม่เกินวันนี้', 'found_date');
    await core_kon.begin(async (sql: Sql) => {
        await activeContract(sql, id);
        const [r] = await sql`INSERT INTO proc_contract_defects ${sql({ ...v, contract_id: id, reported_by: uid })} RETURNING id`;
        await audit(sql, { actor: uid, action: 'report', entity: 'proc_contract_defects', entity_id: r.id, contract_id: id, after: v });
    });
    return { success: true };
});

export const updateDefect = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), defectId = Number(params.id);
    need((await accessOf(uid)).procurement);
    const v = {
        notified_vendor_date: optDate(body.notified_vendor_date, 'notified_vendor_date'),
        fixed_date: optDate(body.fixed_date, 'fixed_date'),
        fixed_note: text(body.fixed_note),
    };
    await core_kon.begin(async (sql: Sql) => {
        const [before] = await sql`SELECT contract_id, found_date::text, notified_vendor_date::text, fixed_date::text, fixed_note FROM proc_contract_defects WHERE id = ${defectId} FOR UPDATE`;
        if (!before) throw new Bad(404, 'ไม่พบรายการชำรุด');
        if (v.notified_vendor_date) check(v.notified_vendor_date >= before.found_date, 'วันแจ้งต้องไม่ก่อนวันที่พบ', 'notified_vendor_date');
        if (v.fixed_date) {
            check(v.fixed_date >= before.found_date, 'วันซ่อมเสร็จต้องไม่ก่อนวันที่พบ', 'fixed_date');
            check(v.fixed_date <= todayBkk(), 'วันซ่อมเสร็จต้องไม่เกินวันนี้', 'fixed_date');
        }
        await sql`UPDATE proc_contract_defects SET ${sql(v)}, updated_at = NOW() WHERE id = ${defectId}`;
        await audit(sql, { actor: uid, action: 'update', entity: 'proc_contract_defects', entity_id: defectId, contract_id: before.contract_id, before, after: v });
    });
    return { success: true };
});

// ═══════════════ เสนอคืน / อนุมัติ ═══════════════
export const proposeReturn = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).procurement);
    const released = reqDate(body.released_date, 'released_date');
    const rules = await loadRules();
    const row = await core_kon.begin(async (sql: Sql) => {
        const c = await activeContract(sql, id);
        if (!c.warranty_end_date) throw new Bad(400, 'สัญญานี้ยังไม่มีวันหมดประกัน');
        check(released >= c.warranty_end_date, `วันพ้นภาระต้องไม่ก่อนวันหมดประกัน (${c.warranty_end_date})`, 'released_date');
        check(released <= todayBkk(), 'วันพ้นภาระต้องไม่เกินวันนี้', 'released_date');
        if (await hasLiveReturn(sql, id)) throw new Bad(409, 'สัญญานี้มีเรื่องเสนอคืนอยู่แล้ว');
        const [last] = await sql`SELECT result FROM proc_contract_inspections WHERE contract_id = ${id} AND kind = 'final' ORDER BY inspected_date DESC, id DESC LIMIT 1`;
        check(last?.result === 'pass', 'ต้องมีผลตรวจรอบสุดท้ายที่ไม่พบชำรุดก่อนเสนอคืน');
        check((await sql`SELECT 1 FROM proc_contract_defects WHERE contract_id = ${id} AND fixed_date IS NULL`).length === 0, 'ยังมีรายการชำรุดที่ซ่อมไม่เสร็จ');
        check((await sql`SELECT 1 FROM fin_guarantees WHERE contract_id = ${id} AND status = 'held'`).length > 0, 'การเงินยังไม่ได้บันทึกหลักประกันของสัญญานี้');
        const due = addDays(released, rules.return_days!);
        const [r] = await sql`INSERT INTO proc_contract_returns (contract_id, released_date, due_date, memo, proposed_by)
                              VALUES (${id}, ${released}, ${due}, ${text(body.memo)}, ${uid}) RETURNING id`;
        await closeTask(sql, id, 'PROPOSE_RETURN', uid);
        await syncTasks(sql, id, rules);
        await audit(sql, { actor: uid, action: 'propose', entity: 'proc_contract_returns', entity_id: r.id, contract_id: id, after: { released_date: released, due_date: due } });
        return { id: r.id, due_date: due };
    });
    return { success: true, data: row };
});

export const getContractReturns = wrap(async ({ user, query }) => {
    const a = await accessOf(Number(user.id));
    const pending = query?.status !== 'decided';
    const rows = await core_kon`
        SELECT r.id, r.contract_id, r.released_date::text, r.due_date::text, r.memo, r.status, r.decided_at, r.decision_note, r.proposed_by,
               c.contract_no, c.project_name, c.warranty_end_date::text, v.name AS vendor_name,
               (SELECT CONCAT(u.pname, u.fname, ' ', u.lname) FROM users u WHERE u.id = r.proposed_by) AS proposer_name,
               (SELECT CONCAT(u.pname, u.fname, ' ', u.lname) FROM users u WHERE u.id = r.decided_by) AS decider_name,
               (SELECT COALESCE(sum(g.amount), 0)::float8 FROM fin_guarantees g WHERE g.contract_id = c.id AND g.status = 'held') AS held_amount,
               (SELECT i.inspected_date::text FROM proc_contract_inspections i WHERE i.contract_id = c.id AND i.kind = 'final' ORDER BY i.inspected_date DESC, i.id DESC LIMIT 1) AS final_date,
               (SELECT i.inspector_id FROM proc_contract_inspections i WHERE i.contract_id = c.id AND i.kind = 'final' ORDER BY i.inspected_date DESC, i.id DESC LIMIT 1) AS final_inspector,
               (SELECT count(*)::int FROM proc_contract_documents d WHERE d.contract_id = c.id) AS doc_count,
               EXISTS (SELECT 1 FROM proc_contract_staff s WHERE s.contract_id = c.id AND s.duty = 'approver' AND (s.user_id = ${a.uid} OR s.backup_user_id = ${a.uid})) AS is_approver
        FROM proc_contract_returns r JOIN proc_contracts c ON c.id = r.contract_id JOIN proc_vendors v ON v.id = c.vendor_id
        WHERE ${pending ? core_kon`r.status = 'pending'` : core_kon`r.status <> 'pending'`}
        ORDER BY r.due_date ${pending ? core_kon`ASC` : core_kon`DESC`}, r.id DESC LIMIT 500`;
    const rules = await loadRules();
    const data = rows
        .filter((r: any) => a.seeAll || a.isDirector || r.is_approver)
        .map((r: any) => {
            const authorised = !a.isAdmin && (a.isDirector || r.is_approver);
            const conflict = !!rules.block_same_approver && (Number(r.proposed_by) === a.uid || Number(r.final_inspector) === a.uid);
            return { ...r, can_decide: r.status === 'pending' && authorised && !conflict, conflict: authorised && conflict, due_state: r.status === 'pending' ? dueState(r.due_date, rules) : null };
        });
    return { success: true, data };
});

export const decideReturn = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), returnId = Number(params.id);
    const a = await accessOf(uid);
    const decision = String(body.decision ?? '');
    check(['approved', 'sent_back'].includes(decision), 'กรุณาเลือกผลการพิจารณา', 'decision');
    const note = text(body.note);
    if (decision === 'sent_back') check(!!note, 'ส่งกลับต้องระบุเหตุผล', 'note');
    const rules = await loadRules();
    await core_kon.begin(async (sql: Sql) => {
        const [r] = await sql`SELECT id, contract_id, status, proposed_by FROM proc_contract_returns WHERE id = ${returnId} FOR UPDATE`;
        if (!r) throw new Bad(404, 'ไม่พบเรื่องเสนอคืน');
        if (r.status !== 'pending') throw new Bad(409, 'เรื่องนี้พิจารณาแล้ว');
        need(!a.isAdmin && (a.isDirector || (await dutiesOn(uid, r.contract_id)).includes('approver')), 'เฉพาะหัวหน้าหน่วยงานหรือผู้รับมอบอำนาจของสัญญานี้');
        if (rules.block_same_approver) {
            const [fin] = await sql`SELECT inspector_id FROM proc_contract_inspections WHERE contract_id = ${r.contract_id} AND kind = 'final' ORDER BY inspected_date DESC, id DESC LIMIT 1`;
            need(Number(r.proposed_by) !== uid && Number(fin?.inspector_id) !== uid, 'ผู้เสนอหรือผู้ตรวจรอบสุดท้ายอนุมัติเรื่องนี้เองไม่ได้');
        }
        await sql`UPDATE proc_contract_returns SET status = ${decision}, decided_by = ${uid}, decided_at = NOW(), decision_note = ${note} WHERE id = ${returnId}`;
        if (decision === 'approved') {
            await closeTask(sql, r.contract_id, 'APPROVE_RETURN', uid);
        } else {
            await sql`UPDATE ctr_tasks SET status = 'open', done_by = NULL, done_at = NULL WHERE contract_id = ${r.contract_id} AND code = 'PROPOSE_RETURN'`;
            await syncTasks(sql, r.contract_id, rules);
        }
        await audit(sql, { actor: uid, action: decision, entity: 'proc_contract_returns', entity_id: returnId, contract_id: r.contract_id, after: { decision, note } });
    });
    return { success: true };
});

// ═══════════════ การเงิน ═══════════════
export const getGuarantees = wrap(async ({ user, query }) => {
    const a = await accessOf(Number(user.id));
    need(a.seeAll);
    const rules = await loadRules();
    const q = text(query?.search);
    const rows = await core_kon`
        SELECT g.id, g.contract_id, g.guarantee_type, g.purpose, g.amount::float8 AS amount, g.bank_name, g.doc_no, g.expiry_date::text, g.storage_location, g.status,
               c.contract_no, c.project_name, c.warranty_end_date::text, v.name AS vendor_name,
               r.status AS return_status, r.due_date::text AS return_due_date,
               p.method, p.paid_date::text, p.net_amount::float8 AS net_amount, p.voucher_no
        FROM fin_guarantees g
        JOIN proc_contracts c ON c.id = g.contract_id JOIN proc_vendors v ON v.id = c.vendor_id
        LEFT JOIN proc_contract_returns r ON r.contract_id = c.id AND r.status IN ('pending', 'approved')
        LEFT JOIN fin_guarantee_payouts p ON p.guarantee_id = g.id
        WHERE TRUE ${q ? core_kon`AND (c.contract_no ILIKE ${'%' + q + '%'} OR c.project_name ILIKE ${'%' + q + '%'} OR v.name ILIKE ${'%' + q + '%'} OR g.doc_no ILIKE ${'%' + q + '%'})` : core_kon``}
        ORDER BY (g.status = 'held') DESC, r.due_date NULLS LAST, g.expiry_date NULLS LAST, g.id DESC LIMIT 1000`;
    return {
        success: true,
        data: rows.map((g: any) => ({
            ...g,
            expiring: g.status === 'held' && guaranteeExpiresTooSoon(g.expiry_date, g.warranty_end_date, rules),
            can_pay: a.finance && g.status === 'held' && g.return_status === 'approved',
            can_edit: a.editGuarantees && g.status === 'held',
            can_delete: a.isAdmin && g.status === 'held' && !g.return_status,
            due_state: g.status === 'held' && g.return_due_date ? dueState(g.return_due_date, rules) : null,
        })),
    };
});

const guaranteeValues = (b: any) => {
    const v = {
        guarantee_type: String(b.guarantee_type ?? ''), purpose: String(b.purpose ?? 'performance'), amount: Number(b.amount),
        bank_name: text(b.bank_name), doc_no: text(b.doc_no), expiry_date: optDate(b.expiry_date, 'expiry_date'),
        storage_location: reqText(b.storage_location, 'storage_location', 'ที่เก็บหลักประกัน'),
    };
    check(['cash', 'bank_guarantee', 'other'].includes(v.guarantee_type), 'กรุณาเลือกประเภทหลักประกัน', 'guarantee_type');
    check(['performance', 'advance', 'other'].includes(v.purpose), 'วัตถุประสงค์ไม่ถูกต้อง', 'purpose');
    check(Number.isFinite(v.amount) && v.amount > 0, 'จำนวนเงินต้องมากกว่า 0', 'amount');
    if (v.guarantee_type === 'bank_guarantee') {
        check(!!v.bank_name, 'กรุณาระบุธนาคาร', 'bank_name');
        check(!!v.doc_no, 'กรุณาระบุเลขที่หนังสือค้ำประกัน', 'doc_no');
    }
    return v;
};

export const createGuarantee = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).editGuarantees);
    const v = guaranteeValues(body);
    const rules = await loadRules();
    const warning = await core_kon.begin(async (sql: Sql) => {
        const c = await activeContract(sql, id);
        const [r] = await sql`INSERT INTO fin_guarantees ${sql({ ...v, contract_id: id, created_by: uid, updated_by: uid })} RETURNING id`;
        await closeTask(sql, id, 'REGISTER_GUARANTEE', uid);
        await audit(sql, { actor: uid, action: 'create', entity: 'fin_guarantees', entity_id: r.id, contract_id: id, after: v });
        return guaranteeExpiresTooSoon(v.expiry_date, c.warranty_end_date, rules);
    });
    return { success: true, data: { expiring: warning } };
});

export const updateGuarantee = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), gid = Number(params.id);
    need((await accessOf(uid)).editGuarantees);
    const v = guaranteeValues(body);
    await core_kon.begin(async (sql: Sql) => {
        const [before] = await sql`SELECT contract_id, guarantee_type, purpose, amount, bank_name, doc_no, expiry_date::text, storage_location, status FROM fin_guarantees WHERE id = ${gid} FOR UPDATE`;
        if (!before) throw new Bad(404, 'ไม่พบหลักประกัน');
        if (before.status !== 'held') throw new Bad(409, 'หลักประกันนี้คืนแล้ว แก้ไขไม่ได้');
        await sql`UPDATE fin_guarantees SET ${sql({ ...v, updated_by: uid })}, updated_at = NOW() WHERE id = ${gid}`;
        await audit(sql, { actor: uid, action: 'update', entity: 'fin_guarantees', entity_id: gid, contract_id: before.contract_id, before, after: v });
    });
    return { success: true };
});

// ลบหลักประกันที่บันทึกผิด เฉพาะ ADMIN · ที่คืน/วางทรัพย์/ส่งคลังแล้วลบไม่ได้ เพราะมีหลักฐานการจ่าย
export const deleteGuarantee = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), gid = Number(params.id);
    need((await accessOf(uid)).isAdmin, 'เฉพาะผู้ดูแลระบบ');
    const reason = reqText(body?.reason, 'reason', 'เหตุผลที่ลบ');
    await core_kon.begin(async (sql: Sql) => {
        const [before] = await sql`SELECT contract_id, guarantee_type, purpose, amount, bank_name, doc_no, expiry_date::text, storage_location, status FROM fin_guarantees WHERE id = ${gid} FOR UPDATE`;
        if (!before) throw new Bad(404, 'ไม่พบหลักประกัน');
        if (before.status !== 'held') throw new Bad(409, 'หลักประกันนี้คืนแล้ว ลบไม่ได้');
        // เรื่องเสนอคืนอ้างหลักประกันชุดนี้อยู่ ลบแล้วการเงินจะจ่ายคืนไม่ครบหรือปิดสัญญาไม่ได้
        if (await hasLiveReturn(sql, before.contract_id)) throw new Bad(409, 'สัญญานี้มีเรื่องเสนอคืนค้างอยู่ ต้องให้ผู้อนุมัติส่งกลับก่อนจึงลบหลักประกันได้');
        await sql`DELETE FROM fin_guarantees WHERE id = ${gid}`;
        // ไม่เหลือหลักประกันแล้ว ให้งาน "บันทึกหลักประกัน" กลับมาเปิด การเงินจะได้เห็นว่ายังต้องลง
        const left = await sql`SELECT 1 FROM fin_guarantees WHERE contract_id = ${before.contract_id} LIMIT 1`;
        if (left.length === 0) {
            await sql`UPDATE ctr_tasks SET status = 'open', done_by = NULL, done_at = NULL
                      WHERE contract_id = ${before.contract_id} AND code = 'REGISTER_GUARANTEE' AND status = 'done'`;
        }
        await audit(sql, { actor: uid, action: 'delete', entity: 'fin_guarantees', entity_id: gid, contract_id: before.contract_id, before, after: { reason } });
    });
    return { success: true };
});

export const payoutGuarantee = wrap(async ({ user, params, body }) => {
    const uid = Number(user.id), gid = Number(params.id);
    need((await accessOf(uid)).finance);
    const v = {
        method: String(body.method ?? ''), paid_date: reqDate(body.paid_date, 'paid_date'), deduct_amount: Number(body.deduct_amount ?? 0),
        deduct_reason: text(body.deduct_reason), receiver_name: text(body.receiver_name),
        voucher_no: reqText(body.voucher_no, 'voucher_no', 'เลขที่เอกสารอ้างอิง'), note: text(body.note),
    };
    check(['returned', 'escrow', 'treasury'].includes(v.method), 'กรุณาเลือกวิธีคืน', 'method');
    check(v.paid_date <= todayBkk(), 'วันที่คืนต้องไม่เกินวันนี้', 'paid_date');
    check(Number.isFinite(v.deduct_amount) && v.deduct_amount >= 0, 'ยอดหักไม่ถูกต้อง', 'deduct_amount');
    if (v.deduct_amount > 0) check(!!v.deduct_reason, 'มียอดหักต้องระบุเหตุผล', 'deduct_reason');
    if (v.method === 'returned') check(!!v.receiver_name, 'กรุณาระบุผู้รับคืน', 'receiver_name');
    const closed = await core_kon.begin(async (sql: Sql) => {
        const [g] = await sql`SELECT contract_id, status, amount::float8 AS amount, guarantee_type FROM fin_guarantees WHERE id = ${gid} FOR UPDATE`;
        if (!g) throw new Bad(404, 'ไม่พบหลักประกัน');
        if (g.status !== 'held') throw new Bad(409, 'หลักประกันนี้คืนแล้ว');
        await activeContract(sql, g.contract_id);
        const [ret] = await sql`SELECT id FROM proc_contract_returns WHERE contract_id = ${g.contract_id} AND status = 'approved'`;
        if (!ret) throw new Bad(409, 'ยังไม่ได้รับอนุมัติให้คืนหลักประกันของสัญญานี้');
        // หนังสือค้ำประกันคืนเป็นเอกสารทั้งฉบับ หักยอดได้เฉพาะเงินสด
        if (v.deduct_amount > 0) check(g.guarantee_type === 'cash', 'หักยอดได้เฉพาะหลักประกันเงินสด', 'deduct_amount');
        check(v.deduct_amount <= g.amount, 'ยอดหักมากกว่าจำนวนหลักประกัน', 'deduct_amount');
        const net = Math.round((g.amount - v.deduct_amount) * 100) / 100;
        const [p] = await sql`INSERT INTO fin_guarantee_payouts ${sql({ ...v, guarantee_id: gid, net_amount: net, paid_by: uid })} RETURNING id`;
        await sql`UPDATE fin_guarantees SET status = ${v.method}, updated_by = ${uid}, updated_at = NOW() WHERE id = ${gid}`;
        await audit(sql, { actor: uid, action: 'payout', entity: 'fin_guarantee_payouts', entity_id: p.id, contract_id: g.contract_id, after: { ...v, net_amount: net } });
        const left = await sql`SELECT 1 FROM fin_guarantees WHERE contract_id = ${g.contract_id} AND status = 'held'`;
        if (left.length > 0) return false;
        await closeTask(sql, g.contract_id, 'PAY_RETURN', uid);
        await sql`UPDATE ctr_tasks SET status = 'cancelled' WHERE contract_id = ${g.contract_id} AND status = 'open'`;
        await sql`UPDATE proc_contracts SET status = 'returned', updated_by = ${uid}, updated_at = NOW() WHERE id = ${g.contract_id}`;
        return true;
    });
    return { success: true, data: { contract_closed: closed } };
});

// ═══════════════ งาน ═══════════════
// ปิดเองได้เฉพาะงานที่ระบบไม่มีเหตุการณ์ให้จับ งานอื่นปิดตามการกระทำจริงเท่านั้น
const MANUAL_TASKS = ['NOTIFY_WARRANTY', 'SCHEDULE_FINAL'];

export const completeTask = wrap(async ({ user, params }) => {
    const uid = Number(user.id), id = Number(params.id);
    need((await accessOf(uid)).procurement);
    await core_kon.begin(async (sql: Sql) => {
        const [t] = await sql`SELECT contract_id, code, status FROM ctr_tasks WHERE id = ${id} FOR UPDATE`;
        if (!t) throw new Bad(404, 'ไม่พบงาน');
        check(MANUAL_TASKS.includes(t.code), 'งานนี้ปิดเองไม่ได้ ระบบจะปิดให้เมื่อบันทึกขั้นตอนนั้นแล้ว');
        if (t.status !== 'open') throw new Bad(409, 'งานนี้ปิดแล้ว');
        await closeTask(sql, t.contract_id, t.code, uid);
        await audit(sql, { actor: uid, action: 'complete', entity: 'ctr_tasks', entity_id: id, contract_id: t.contract_id, after: { code: t.code } });
    });
    return { success: true };
});
