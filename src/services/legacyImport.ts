// ── โอนข้อมูลจากโปรแกรมการลาเดิม (MySQL DB_LEAVE_*) เข้าระบบใหม่ ─────────────────
//
// ใช้ทั้งสคริปต์ (src/scripts/importLegacy*.ts) และหน้า HR /hr/leave/legacy-import (งานเบื้องหลัง)
//
// 1) ประวัติการลา (runLegacyLeaveImport)
//    เชื่อมบุคลากรด้วย tb_employee.id_card = users.id_card · ปีงบดูจากวันที่ลา (tb_leave.year_id ไม่ตรงทุกใบ)
//    วันที่ที่บันทึกเป็นปี พ.ศ. ในฐานเดิมแปลงเป็น ค.ศ. ให้ · รันซ้ำได้ ใบที่โอนแล้วข้าม (legacy_leave_id)
//    สถานะ: อนุมัติ → APPROVED · รออนุมัติ → PENDING (เริ่มสายอนุมัติใหม่ขั้นที่ 1 ตามผังปัจจุบัน)
//           ไม่อนุมัติ → REJECTED · มีคำขอยกเลิกรออนุมัติ → CANCEL_PENDING · ยกเลิกสำเร็จ → CANCELLED
//    ยอดวันลา: หักตามจำนวนวันของใบที่ยังมีผล (เหมือนบันทึกในระบบใหม่)
//    ลาพักผ่อน: tb_leave_setday.setday = วันลาสะสมที่ยกมาจากปีก่อน (ไม่ใช่สิทธิ์ทั้งปี)
//      → ยกมา = setday (ติดลบเป็น 0) + สิทธิ์ปีนี้ตามประเภทเจ้าหน้าที่/อายุงาน
//      ระบบเดิมคุมเพดานสะสมเองแล้ว ใช้ค่าตามนั้น — เกินเพดานที่ระบบใหม่คำนวณ (ประเภท/วันเริ่มงานไม่ตรงกัน) แจ้งในรายงานให้ HR ตรวจ
//    ไม่โอน: ประเภท "สาย" / "ขาดราชการ" (ไม่ใช่การลา) และใบที่ทับวันกับใบที่ยื่นในระบบใหม่แล้ว — แสดงในรายงาน
//    ใบที่อนุมัติแล้ว: สร้างประวัติการอนุมัติตามระดับในระบบเดิม (header/major/branch) — วันที่/ผู้อนุมัติ/ความเห็นจริง
//    ที่ติดต่อระหว่างลา (leave_contact) และผู้ปฏิบัติหน้าที่แทน (leave_instead = tb_employee.id) โอนมาด้วย
//    ไฟล์แนบ (file_sick เช่นใบรับรองแพทย์) → document_url เก็บเฉพาะชื่อไฟล์ ตัวไฟล์คัดลอกไว้ที่ uploads/hr-leave/legacy/
//    ใบที่โอนไปก่อนหน้านี้ เติมย้อนหลังได้ด้วย backfillLegacyDetails (src/scripts/backfillLegacyLeaveDetails.ts)
//
// 2) วันเริ่มงาน (runLegacyServiceDates) — tb_employee.appoint_date → hr_leave_service_dates
//    และเลือกเติม users.hire_date ที่ยังว่างได้ (ไม่เขียนทับค่าเดิม)
import mysql from 'mysql2/promise';
import { core_kon } from '../db/db';
import { resolveApprovalChain, parseChain, type ChainStep } from './leaveChain';
import { countLeaveDays } from './leaveDays';
import { entitlementsOf, fiscalYearStart } from './leaveRollover';

export type Log = (line: string) => void;
export type Progress = (done: number, total: number) => void | Promise<void>;

export const legacyConfigured = () => !!(process.env.DB_LEAVE_HOST && process.env.DB_LEAVE_DATABASE);

const connectLegacy = () => mysql.createConnection({
    host: process.env.DB_LEAVE_HOST, port: Number(process.env.DB_LEAVE_PORT || 3306),
    user: process.env.DB_LEAVE_USERNAME, password: process.env.DB_LEAVE_PASSWORD, database: process.env.DB_LEAVE_DATABASE,
    dateStrings: true,
});

// ประเภทการลาเดิม (tb_type_leave) → hr_leave_types.code · null = ไม่โอน
const TYPE_MAP: Record<number, string | null> = {
    1: 'SICK', 2: 'ANNUAL', 3: 'PERS', 4: null /* สาย */, 5: 'MAT', 6: 'ORDAIN',
    7: 'PERS' /* ลากิจเลี้ยงดูบุตร */, 8: null /* ขาดราชการ */, 9: null /* ลาไปต่างประเทศ — ต้องกำหนดประเภทก่อนโอน */,
};

/**
 * คำที่ต้องมีในชื่อประเภทเดิม (tb_type_leave.type_leave_name) — ตรวจก่อนโอนทุกครั้ง
 * ถ้ารหัสในฐานเดิมถูกเปลี่ยนความหมาย การจับคู่ด้วยตัวเลขจะโอนผิดประเภททั้งชุด จึงหยุดโอนทันที
 */
const LEGACY_TYPE_NAME: Record<number, string> = {
    1: 'ป่วย', 2: 'พักผ่อน', 3: 'กิจ', 4: 'สาย', 5: 'คลอด', 6: 'อุปสมบท', 7: 'เลี้ยงดูบุตร', 8: 'ขาดราชการ', 9: 'ต่างประเทศ',
};
/** ระบบเดิมใช้ "คลอด" (#5) ทั้งหญิงและชาย — ผู้ชายคือการลาไปช่วยเหลือภริยาคลอดบุตร (นับวันทำการ ไม่เกิน 15 วัน) */
const typeCodeFor = (legacyType: number, gender: string | null): string | null | undefined => {
    const code = TYPE_MAP[legacyType];
    return code === 'MAT' && gender === 'M' ? 'PAT' : code;
};
const GENDER_OK: Record<string, (g: string | null) => boolean> = {
    MALE: g => g == null || g === 'M', FEMALE: g => g == null || g === 'F',
};

/** วันที่ในฐานเดิมบางใบบันทึกเป็นปี พ.ศ. */
const ceDate = (d: string | null): string | null => {
    if (!d || d.startsWith('0000')) return null;
    const y = Number(d.slice(0, 4));
    return y > 2400 ? `${y - 543}${d.slice(4, 10)}` : d.slice(0, 10);
};
const span = (s: string, e: string) => (Date.parse(e) - Date.parse(s)) / 86_400_000 + 1;
const validDays = (n: unknown, max: number) => {
    const v = Number(n);
    return v > 0 && Number.isInteger(v * 2) && v <= max ? v : null;
};
const fyOf = (d: string) => { const [y, m] = d.split('-').map(Number); return (m >= 10 ? y + 1 : y) + 543; };

/** สิทธิ์ต่อปีตามประเภทเจ้าหน้าที่ + อายุงาน — กติกาเดียวกับตอนยื่นใบลา (ไม่มีวันเริ่มงานใช้ tier ต่ำสุด) */
const tierOf = async (sql: any, uid: number, typeId: number): Promise<number | null> => {
    const [r] = await sql`
        SELECT e.max_days_per_year FROM hr_leave_entitlements e
        JOIN users u ON u.user_type_id = e.user_type_id
        JOIN v_leave_service_start ss ON ss.user_id = u.id
        WHERE u.id = ${uid} AND e.leave_type_id = ${typeId}
          AND (ss.service_start IS NULL OR e.min_service_months <= EXTRACT(YEAR FROM age(now(), ss.service_start)) * 12 + EXTRACT(MONTH FROM age(now(), ss.service_start)))
        ORDER BY CASE WHEN ss.service_start IS NULL THEN e.min_service_months END ASC, e.min_service_months DESC LIMIT 1`;
    return r?.max_days_per_year != null ? Number(r.max_days_per_year) : null;
};

/** ลาพักผ่อนจาก tb_leave_setday (วันสะสมยกมา) → ยกมา + สิทธิ์ปีนี้ · over = ส่วนที่เกินเพดานตามอายุงาน ณ วันแรกของปีงบ */
export const annualFromSetday = async (sql: any, uid: number, typeId: number, fy: number, setday: number) => {
    const ent = (await entitlementsOf(sql, typeId, fiscalYearStart(fy), uid)).get(uid) ?? null;
    const entitled = ent?.max_days_per_year != null ? Number(ent.max_days_per_year) : 0;
    const carried = Math.max(Number(setday) || 0, 0);
    const cap = ent && !ent.carry_over ? 0 : ent?.carry_over_max_days != null ? Number(ent.carry_over_max_days) : carried;
    return { carried, entitled, over: Math.max(carried - cap, 0) };
};

/** หัก/คืนยอด — แบบเดียวกับ adjustBalance ของระบบใหม่ */
const adjust = async (sql: any, uid: number, typeId: number, fy: number, days: number) => {
    if (!days) return;
    const [b] = await sql`SELECT id, used FROM hr_leave_balances WHERE user_id = ${uid} AND leave_type_id = ${typeId} AND fiscal_year = ${fy} FOR UPDATE`;
    if (b) { await sql`UPDATE hr_leave_balances SET used = ${Math.max(Number(b.used) + days, 0)}, updated_at = now() WHERE id = ${b.id}`; return; }
    if (days < 0) return;
    await sql`
        INSERT INTO hr_leave_balances (user_id, leave_type_id, fiscal_year, carried_in, entitled, used, note, auto_created)
        VALUES (${uid}, ${typeId}, ${fy}, 0, ${(await tierOf(sql, uid, typeId)) ?? 0}, ${days}, 'นำเข้าจากโปรแกรมเดิม', TRUE)`;
};

const STATUS_TH: Record<string, string> = { APPROVED: 'อนุมัติ', PENDING: 'รออนุมัติ', REJECTED: 'ไม่อนุมัติ', CANCEL_PENDING: 'ขอยกเลิก', CANCELLED: 'ยกเลิกแล้ว' };

export interface LeaveImportOptions {
    fy: number;
    scope: 'all' | 'mission' | 'user' | 'name';
    missionId?: number;
    userId?: number;
    name?: string;
    commit: boolean;
    undo?: boolean;
}
// ── ข้อมูลประกอบใบลาจากระบบเดิม: การอนุมัติ / ที่ติดต่อ / ผู้ปฏิบัติแทน ─────────────
type Lq = (q: string, params?: unknown[]) => Promise<any[]>;
type EmpUser = (empId: unknown) => Promise<number | null>;

/** วันเวลาในฐานเดิม (บางแถวเป็นปี พ.ศ.) → ISO เวลาไทย · ใช้ไม่ได้ = null */
const ceStamp = (d: unknown): string | null => {
    const v = String(d ?? '');
    if (!/^\d{4}-\d{2}-\d{2}/.test(v) || v.startsWith('0000')) return null;
    const y = Number(v.slice(0, 4));
    const iso = `${y > 2400 ? y - 543 : y}${v.slice(4, 10)}T${v.slice(11, 19) || '00:00:00'}+07:00`;
    return Number.isFinite(Date.parse(iso)) ? iso : null;
};

// ขั้นในสายอนุมัติใหม่ ↔ ระดับการอนุมัติในระบบเดิม (หัวหน้างาน / หัวหน้ากลุ่มงาน / หัวหน้าภารกิจ)
type LegacyLevel = 'header' | 'major' | 'branch';
const LEGACY_LEVEL: Record<string, LegacyLevel> = { SUBMAJOR: 'header', MAJOR: 'major', MISSION: 'branch', DIRECTOR: 'branch' };

/** tb_employee.id → users.id (จับคู่ด้วยเลขบัตรประชาชน) */
const makeEmpUser = (lq: Lq): EmpUser => {
    const cache = new Map<number, number | null>();
    return async (empId) => {
        const id = Number(empId);
        if (!Number.isInteger(id) || id <= 0) return null;
        if (cache.has(id)) return cache.get(id)!;
        const [e] = await lq('SELECT TRIM(id_card) AS c FROM tb_employee WHERE id = ?', [id]);
        let uid: number | null = null;
        if (e?.c) {
            const [u] = await core_kon`SELECT id FROM users WHERE TRIM(id_card) = ${e.c} ORDER BY (is_active = 'Y') DESC, id DESC LIMIT 1`;
            uid = u ? Number(u.id) : null;
        }
        cache.set(id, uid);
        return uid;
    };
};

interface LegacyApproval { step: number; level: string; unit_type: string | null; unit_id: number | null; approver: number; date: string; comment: string }

/**
 * ที่ติดต่อ / ผู้ปฏิบัติแทน / การอนุมัติของใบเดิม
 * การอนุมัติ: เฉพาะใบที่อนุมัติในระบบเดิม (leave_status = 1) — ขั้นในสายใหม่ที่ระดับเดิมกดอนุมัติไว้
 * วันที่ขั้นนั้นว่าง ใช้วันของขั้นถัดไปที่มี ไม่มีเลยใช้วันยื่น
 * ผู้อนุมัติ = ผู้อนุมัติของขั้นนั้นตามผังการลาปัจจุบันเสมอ (ไม่ใช้ชื่อผู้กดในระบบเดิม) — เก็บแค่วันที่และความเห็นจากใบเดิม
 * ขั้นสุดท้ายต้องมีเสมอ (ใบอนุมัติแล้ว) — ระดับเดิมไม่ตรงกับสายใหม่ ใช้การอนุมัติระดับสูงสุดของใบเดิม
 * ระบบเดิมบางใบผู้ลากดอนุมัติขั้นของตัวเอง — ไม่นับเป็นการอนุมัติ (ขั้นสุดท้ายใช้ผู้อนุมัติตามสายแทน)
 */
/** ชื่อไฟล์แนบในระบบเดิม (tb_leave.file_sick) — เก็บเฉพาะชื่อไฟล์ ตัดส่วน path ทิ้ง กันอ้างไฟล์นอกโฟลเดอร์ */
export const legacyFileName = (v: unknown): string | null => {
    const name = String(v ?? '').trim().split(/[\\/]/).pop() ?? '';
    return name && name !== '.' && name !== '..' ? name.slice(0, 255) : null;
};

const legacyDetails = async (l: any, steps: ChainStep[], uid: number, empUser: EmpUser) => {
    const contact = String(l.leave_contact ?? '').trim().slice(0, 255) || null;
    const document = legacyFileName(l.file_sick);
    const sub = await empUser(l.leave_instead);
    const substitute = sub != null && sub !== uid ? sub : null;

    const approvals: LegacyApproval[] = [];
    const ok = (lv: LegacyLevel) => String(l[`${lv}_approve`]) === '1';
    const dateOf = (lv: LegacyLevel) => ceStamp(l[`${lv}_approve_date`]);
    const lastStep = steps.length ? Number(steps[steps.length - 1].step) : 0;
    const make = async (s: ChainStep, lv: LegacyLevel, later: LegacyLevel[]) => {
        const date = dateOf(lv) ?? later.map(dateOf).find(Boolean) ?? ceStamp(l.leave_create);
        if (!date) return;
        // ผู้ลากดอนุมัติขั้นของตัวเองในระบบเดิม — ไม่นับ (ยกเว้นขั้นสุดท้าย ใบอนุมัติแล้วต้องมีเสมอ)
        if (await empUser(l[`${lv}_user_approve`]) === uid && Number(s.step) !== lastStep) return;
        approvals.push({
            step: Number(s.step), level: s.level, unit_type: s.unit_type, unit_id: s.unit_id,
            approver: Number(s.approver_id),
            date, comment: String(l[`${lv}_comment`] ?? '').trim() || 'อนุมัติ',
        });
    };
    if (String(l.leave_status) === '2' && steps.length) {
        // ใบที่ระบบเดิมยังรออนุมัติ — เก็บขั้นที่ระดับเดิมกดไว้แล้ว "ต่อเนื่องตั้งแต่ขั้นแรก" ใบจะไปรอที่ขั้นที่ยังไม่มีใครกด
        // (ขั้นที่ข้ามไปไม่ได้: ถ้าขั้นแรกยังไม่กด ขั้นหลังที่กดไว้ก็ไม่นับ เพราะในสายใหม่ต้องผ่านตามลำดับ)
        for (const [i, s] of steps.entries()) {
            const lv = LEGACY_LEVEL[s.level];
            if (!lv || !ok(lv)) break;
            const before = approvals.length;
            await make(s, lv, steps.slice(i + 1).map(x => LEGACY_LEVEL[x.level]).filter(Boolean));
            if (approvals.length === before) break;
        }
    }
    if (String(l.leave_status) === '1' && steps.length) {
        for (const [i, s] of steps.entries()) {
            const lv = LEGACY_LEVEL[s.level];
            if (!lv || !ok(lv)) continue;
            await make(s, lv, steps.slice(i + 1).map(x => LEGACY_LEVEL[x.level]).filter(Boolean));
        }
        const last = steps[steps.length - 1];
        if (!approvals.some(a => a.step === lastStep)) {
            const top = (['branch', 'major', 'header'] as const).find(ok);
            if (top) await make(last, top, []);
        }
    }
    return { contact, substitute, document, approvals };
};

const insertLegacyApprovals = async (sql: any, requestId: number, approvals: LegacyApproval[]) => {
    for (const a of approvals) {
        await sql`
            INSERT INTO hr_leave_approvals (request_id, approver_id, step, action, comment, actioned_at, level, unit_type, unit_id)
            VALUES (${requestId}, ${a.approver}, ${a.step}, 'APPROVED', ${a.comment}, ${a.date}, ${a.level}, ${a.unit_type}, ${a.unit_id})`;
    }
};
const APPROVED_LIKE = ['APPROVED', 'CANCEL_PENDING', 'CANCELLED'];

export interface LeaveImportTotals {
    targets: number; employees: number; imported: number; skipped: number; already: number; undone: number;
    /** ใบที่จะโอน แยกตามรหัสประเภทในระบบใหม่ · ใบที่ข้ามเพราะประเภทเดิมไม่มีในระบบใหม่ แยกตามชื่อเดิม */
    by_type?: Record<string, number>; skipped_type?: Record<string, number>;
    /** จุดที่ HR ควรตรวจ: เพศไม่ตรงประเภท · จำนวนวันเดิมไม่ตรงกฎการนับของประเภท · ไม่มีสายอนุมัติตามผัง */
    gender_mismatch?: number; day_mismatch?: number; no_chain?: number;
    /** ใบรออนุมัติในระบบเดิม: ต่อจากขั้นที่กดแล้ว / ผ่านครบสายใหม่จึงอนุมัติ / ยังไม่มีใครกด */
    pending_resumed?: number; pending_completed?: number; pending_fresh?: number;
}

export const runLegacyLeaveImport = async (opts: LeaveImportOptions, log: Log, progress?: Progress): Promise<LeaveImportTotals> => {
    const { fy: FY, commit: COMMIT, undo: UNDO = false } = opts;
    if (!Number.isInteger(FY) || FY < 2500 || FY > 2700) throw new Error('ปีงบประมาณไม่ถูกต้อง');
    const fyStart = `${FY - 544}-10-01`, fyEnd = `${FY - 543}-09-30`;

    const sel = core_kon`SELECT id, CONCAT(fname, ' ', lname) AS name, TRIM(id_card) AS id_card, gender FROM users`;
    let rows: any[];
    if (opts.scope === 'all') {
        rows = await core_kon`${sel} WHERE id_card IS NOT NULL AND TRIM(id_card) <> '' ORDER BY id`;
    } else if (opts.scope === 'user') {
        rows = await core_kon`${sel} WHERE id = ${Number(opts.userId)}`;
    } else if (opts.scope === 'mission') {
        rows = await core_kon`${sel} WHERE mission_id = ${Number(opts.missionId)} AND is_active <> 'N' AND id_card IS NOT NULL AND TRIM(id_card) <> '' ORDER BY id`;
    } else {
        const [f, l] = String(opts.name ?? '').trim().split(/\s+/);
        rows = await core_kon`${sel} WHERE fname = ${f ?? ''} AND lname = ${l ?? ''}`;
    }
    const targets = rows.map((u: any) => ({ uid: Number(u.id), name: u.name as string, idCard: u.id_card as string, gender: (u.gender ?? null) as string | null }));
    const totals: LeaveImportTotals = {
        targets: targets.length, employees: 0, imported: 0, skipped: 0, already: 0, undone: 0,
        by_type: {}, skipped_type: {}, gender_mismatch: 0, day_mismatch: 0, no_chain: 0,
        pending_resumed: 0, pending_completed: 0, pending_fresh: 0,
    };
    const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };
    if (!targets.length) { log('ไม่พบบุคลากรในระบบใหม่'); return totals; }

    const types = new Map((await core_kon`SELECT id, code, name_th, count_working_days_only, gender_restriction FROM hr_leave_types`).map((t: any) => [t.code, t]));
    const annual: any = types.get('ANNUAL');
    const legacy = await connectLegacy();
    const lq = async (q: string, params: unknown[] = []) => (await legacy.query(q, params))[0] as any[];
    const empUser = makeEmpUser(lq);
    try {
        // ── ตรวจการจับคู่ประเภทการลาก่อนโอน ──
        const legacyTypes = new Map((await lq('SELECT type_leave_id, type_leave_name FROM tb_type_leave'))
            .map((r: any) => [Number(r.type_leave_id), String(r.type_leave_name ?? '').trim()]));
        const wrong = Object.entries(LEGACY_TYPE_NAME)
            .filter(([id, word]) => legacyTypes.has(Number(id)) && !legacyTypes.get(Number(id))!.includes(word))
            .map(([id, word]) => `#${id} "${legacyTypes.get(Number(id))}" (คาดว่าเป็น "${word}")`);
        if (wrong.length) throw new Error(`ประเภทการลาในระบบเดิมไม่ตรงกับที่จับคู่ไว้: ${wrong.join(', ')} — หยุดโอนเพื่อกันโอนผิดประเภท`);
        const missing = [...new Set([...Object.values(TYPE_MAP), 'PAT'].filter((c): c is string => !!c))].filter(c => !types.has(c));
        if (missing.length) throw new Error(`ไม่พบประเภทการลาในระบบใหม่: ${missing.join(', ')}`);
        log('การจับคู่ประเภทการลา (ระบบเดิม → ระบบใหม่):\n' + [...legacyTypes.entries()].sort(([a], [b]) => a - b).map(([id, name]) => {
            const code = TYPE_MAP[id];
            const t: any = code ? types.get(code) : null;
            return `  #${id} ${name} → ${t ? `${t.name_th} (${code} · นับ${t.count_working_days_only ? 'วันทำการ' : 'วันปฏิทิน'})` : 'ไม่โอน'}`
                + (code === 'MAT' ? ` · ผู้ชาย → ${(types.get('PAT') as any).name_th} (PAT · นับวันทำการ)` : '');
        }).join('\n') + '\n');

        let n = 0;
        for (const t of targets) {
            if (++n % 10 === 0 || n === targets.length) await progress?.(n, targets.length);
            const [emp] = await lq('SELECT id FROM tb_employee WHERE TRIM(id_card) = ? ORDER BY status_work = "1" DESC, id DESC LIMIT 1', [t.idCard]);
            if (!emp) continue;
            totals.employees++;
            const lines: string[] = [];

            if (UNDO) {
                const done = await core_kon`
                    SELECT id, leave_type_id, to_char(start_date, 'YYYY-MM-DD') AS start_date, days_deducted FROM hr_leave_requests
                    WHERE user_id = ${t.uid} AND legacy_leave_id IS NOT NULL AND start_date BETWEEN ${fyStart} AND ${fyEnd}`;
                if (COMMIT) await core_kon.begin(async (sql: any) => {
                    for (const r of done) {
                        await adjust(sql, t.uid, Number(r.leave_type_id), fyOf(r.start_date), -Number(r.days_deducted));
                        await sql`DELETE FROM hr_leave_approvals WHERE request_id = ${r.id} OR cancellation_id IN (SELECT id FROM hr_leave_cancellations WHERE request_id = ${r.id})`;
                        await sql`DELETE FROM hr_leave_cancellations WHERE request_id = ${r.id}`;
                        await sql`DELETE FROM hr_leave_requests WHERE id = ${r.id}`;
                    }
                    await sql`UPDATE hr_leave_balances SET carried_in = 0, legacy_setday = NULL, updated_at = now()
                              WHERE user_id = ${t.uid} AND fiscal_year = ${FY} AND legacy_setday IS NOT NULL`;
                    await sql`DELETE FROM hr_leave_balances WHERE user_id = ${t.uid} AND fiscal_year = ${FY} AND note = 'นำเข้าจากโปรแกรมเดิม' AND used = 0`;
                });
                totals.undone += done.length;
                if (done.length) log(`${t.name} (users #${t.uid}): ${COMMIT ? 'ถอน' : 'จะถอน'} ${done.length} ใบ`);
                continue;
            }

            const leaves = await lq(`
                SELECT l.*, c.cancle_status, c.cancle_detail
                FROM tb_leave l LEFT JOIN tb_leave_cancle c ON c.leave_id = l.leave_id
                WHERE l.employee_id = ?
                  AND (CASE WHEN YEAR(l.date_start) > 2400 THEN DATE_SUB(l.date_start, INTERVAL 543 YEAR) ELSE l.date_start END) BETWEEN ? AND ?
                ORDER BY l.date_start, l.leave_id`, [emp.id, fyStart, fyEnd]);
            const [setday] = await lq('SELECT setday FROM tb_leave_setday WHERE employee_id = ? AND year_setday = ? ORDER BY id DESC LIMIT 1', [emp.id, String(FY)]);
            if (!leaves.length && !setday) continue;
            const chain = await resolveApprovalChain(t.uid);

            const plan: any[] = [];
            for (const l of leaves) {
                const id = Number(l.leave_id);
                const start = ceDate(l.date_start), end = ceDate(l.date_end) ?? start;
                const code = typeCodeFor(Number(l.type_leave_id), t.gender);
                const skip = (why: string) => { plan.push({ id, skip: why }); };
                if (code === undefined || code === null) {
                    const name = legacyTypes.get(Number(l.type_leave_id)) ?? `รหัส ${l.type_leave_id}`;
                    bump(totals.skipped_type!, name);
                    skip(`ประเภทเดิม "${name}" ไม่มีในระบบใหม่`);
                    continue;
                }
                const type: any = types.get(code);
                if (!type) { skip(`ไม่พบประเภท ${code}`); continue; }
                if (!start || !end || end < start) { skip(`วันที่ไม่ถูกต้อง (${l.date_start} – ${l.date_end})`); continue; }
                const flags: string[] = [];
                if (!(GENDER_OK[type.gender_restriction]?.(t.gender) ?? true)) {
                    flags.push(`! ${type.name_th} ใช้ได้เฉพาะ${type.gender_restriction === 'FEMALE' ? 'เพศหญิง' : 'เพศชาย'} แต่เพศในทะเบียนไม่ตรง — ให้ HR ตรวจประเภท`);
                }

                let status: string;
                if (Number(l.cancle_status) === 5) status = 'CANCELLED';
                else if (Number(l.cancle_status) === 4) status = 'CANCEL_PENDING';
                else if (l.leave_status === '1') status = 'APPROVED';
                else if (l.leave_status === '2') status = 'PENDING';
                else if (l.leave_status === '3') status = 'REJECTED';
                else { skip(`สถานะเดิมว่าง (${l.leave_status})`); continue; }

                // ใบรออนุมัติ: ตรวจกับสายอนุมัติตามผังใหม่ว่าระบบเดิมกดไปแล้วกี่ขั้น
                let done = 0, statusNote = '';
                if (status === 'PENDING' && chain?.steps.length) {
                    done = (await legacyDetails(l, chain.steps, t.uid, empUser)).approvals.length;
                    if (done >= chain.steps.length) {
                        status = 'APPROVED';
                        statusNote = ` (ระบบเดิมยังรออนุมัติ แต่ผ่านครบทุกขั้นของสายตามผังใหม่แล้ว ${done} ขั้น → อนุมัติ)`;
                    } else if (done > 0) {
                        statusNote = ` (ระบบเดิมอนุมัติแล้ว ${done} ขั้น → รอขั้นที่ ${done + 1} ${chain.steps[done].level_name})`;
                    }
                }

                const sp = span(start, end);
                const half = Number(l.leave_day) % 1 !== 0 || l.time_start === '0.5' || l.time_end === '0.5';
                let days = validDays(l.leave_day, half ? sp - 0.5 : sp) ?? validDays(l.countday, half ? sp - 0.5 : sp);
                let dayNote = '';
                // นับตามกฎของประเภทในระบบใหม่ (วันทำการ = ไม่นับเสาร์-อาทิตย์/วันหยุดราชการ · วันปฏิทิน = ทุกวัน)
                const rule = (await countLeaveDays(start, end, !!type.count_working_days_only, half)).computed_days || (half ? 0.5 : 1);
                if (days == null) {
                    days = rule;
                    dayNote = ` (จำนวนวันเดิม ${l.leave_day} ใช้ไม่ได้ — นับจากปฏิทิน ${days})`;
                } else if (!type.count_working_days_only && days !== rule) {
                    // ประเภทที่นับวันปฏิทิน (ลาคลอด อุปสมบท ฯลฯ) ระบบเดิมนับแบบวันทำการ — ใช้ตามกฎระบบใหม่
                    dayNote = ` (ระบบเดิม ${days} วัน → นับวันปฏิทินตามประเภท ${rule} วัน)`;
                    days = rule;
                } else if (days !== rule) {
                    flags.push(`! จำนวนวันเดิม ${days} วัน แต่นับวันทำการได้ ${rule} วัน — ใช้ตามเดิม ให้ HR ตรวจที่หน้าตรวจวันลา`);
                }
                const isHalf = days % 1 !== 0;
                plan.push({
                    id, code, typeId: Number(type.id), start, end, days, isHalf, status, dayNote: dayNote + statusNote, flags, done,
                    reason: String(l.leave_detail ?? '').trim() || null,
                    reject: [l.header_comment, l.major_comment, l.branch_comment].map(x => String(x ?? '').trim()).filter(Boolean).join(' / ') || null,
                    created: l.leave_create && !String(l.leave_create).startsWith('0000') ? l.leave_create : null,
                    cancelReason: String(l.cancle_detail ?? '').trim() || null,
                    raw: l,
                });
            }

            // ใบที่โอนแล้ว / ทับวันกับใบที่ยื่นในระบบใหม่
            const done = new Set((await core_kon`SELECT legacy_leave_id FROM hr_leave_requests WHERE legacy_leave_id IN ${core_kon(plan.map(p => p.id).concat([0]))}`)
                .map((r: any) => Number(r.legacy_leave_id)));
            const native = await core_kon`
                SELECT id, to_char(start_date, 'YYYY-MM-DD') AS s, to_char(end_date, 'YYYY-MM-DD') AS e FROM hr_leave_requests
                WHERE user_id = ${t.uid} AND legacy_leave_id IS NULL AND status IN ('PENDING', 'APPROVED', 'CANCEL_PENDING')`;
            for (const p of plan) {
                if (p.skip) continue;
                if (done.has(p.id)) { p.already = true; continue; }
                const hit = native.find((x: any) => x.s <= p.end && x.e >= p.start);
                if (hit && ['APPROVED', 'PENDING', 'CANCEL_PENDING'].includes(p.status)) p.skip = `ทับวันกับใบในระบบใหม่ #${hit.id}`;
            }

            const willImport = plan.filter(p => !p.skip && !p.already);
            lines.push(`${t.name} (users #${t.uid} · ระบบเดิม employee #${emp.id}) — ปีงบ ${FY}: ใบลาเดิม ${leaves.length} ใบ`);
            if (annual && setday) {
                const a = await annualFromSetday(core_kon, t.uid, Number(annual.id), FY, Number(setday.setday));
                lines.push(`  ลาพักผ่อน: วันสะสมยกมาจากระบบเดิม ${setday.setday} วัน → ยกมา ${a.carried} + ปีนี้ ${a.entitled} = ${a.carried + a.entitled}`
                    + (a.over > 0 ? ` ! เกินเพดานสะสมตามประเภท/อายุงานในระบบใหม่ ${a.over} วัน — ใช้ค่าตามระบบเดิม ให้ HR ตรวจ` : '')
                    + (a.carried > 0 && a.entitled === 0 ? ' ! ไม่มีสิทธิ์ลาพักผ่อนปีนี้ตามประเภท/อายุงาน แต่ระบบเดิมมีวันสะสม — ให้ HR ตรวจ' : ''));
            }
            for (const p of plan) {
                if (p.skip) lines.push(`  - #${p.id} ข้าม: ${p.skip}`);
                else {
                    lines.push(`  ${p.already ? '= ' : '+ '}#${p.id} ${p.code} ${p.start}${p.end !== p.start ? `–${p.end}` : ''} ${p.days} วัน${p.isHalf ? ' (มีครึ่งวัน)' : ''} · ${STATUS_TH[p.status]}${p.already ? ' (โอนแล้ว)' : ''}${p.dayNote}`);
                    for (const f of p.flags) lines.push(`      ${f}`);
                }
            }
            for (const p of willImport) {
                bump(totals.by_type!, p.code);
                if (p.flags.some((f: string) => f.includes('เพศ'))) totals.gender_mismatch!++;
                if (p.flags.some((f: string) => f.includes('จำนวนวันเดิม'))) totals.day_mismatch!++;
                if (p.raw.leave_status === '2' && !p.raw.cancle_status) {
                    if (p.status === 'APPROVED') totals.pending_completed!++;
                    else if (p.done > 0) totals.pending_resumed!++;
                    else totals.pending_fresh!++;
                }
            }
            // สายอนุมัติตามผังใหม่ — ไม่มีสาย: ใบที่อนุมัติแล้วไม่มีประวัติการอนุมัติ ใบที่รออยู่จะค้าง
            if (!chain?.steps.length && willImport.length) {
                totals.no_chain!++;
                lines.push(willImport.some(p => ['PENDING', 'CANCEL_PENDING'].includes(p.status))
                    ? '  ! ไม่พบผู้อนุมัติในผัง — ใบที่ยังรออนุมัติจะค้าง และใบที่อนุมัติแล้วไม่มีประวัติการอนุมัติ'
                    : '  ! ไม่พบผู้อนุมัติในผัง — ใบที่อนุมัติแล้วจะไม่มีประวัติการอนุมัติ');
            }
            log(lines.join('\n'));
            totals.imported += willImport.length;
            totals.skipped += plan.filter(p => p.skip).length;
            totals.already += plan.filter(p => p.already).length;
            if (!COMMIT) continue;

            await core_kon.begin(async (sql: any) => {
                // ลาพักผ่อน: ตั้งสิทธิ์ทั้งปีจาก tb_leave_setday ครั้งเดียว (แยกเป็นยอดยกมา + สิทธิ์ปีนี้)
                if (annual && setday) {
                    const { carried, entitled } = await annualFromSetday(sql, t.uid, Number(annual.id), FY, Number(setday.setday));
                    const [b] = await sql`SELECT id, legacy_setday FROM hr_leave_balances WHERE user_id = ${t.uid} AND leave_type_id = ${annual.id} AND fiscal_year = ${FY} FOR UPDATE`;
                    if (!b) {
                        await sql`
                            INSERT INTO hr_leave_balances (user_id, leave_type_id, fiscal_year, carried_in, entitled, used, note, legacy_setday, carried_from_fy)
                            VALUES (${t.uid}, ${annual.id}, ${FY}, ${carried}, ${entitled}, 0, 'นำเข้าจากโปรแกรมเดิม', ${setday.setday}, ${FY - 1})`;
                    } else if (b.legacy_setday == null) {
                        await sql`
                            UPDATE hr_leave_balances SET carried_in = ${carried}, entitled = ${entitled}, legacy_setday = ${setday.setday},
                                carried_from_fy = ${FY - 1}, updated_at = now()
                            WHERE id = ${b.id}`;
                    }
                }
                for (const p of willImport) {
                    const active = ['APPROVED', 'PENDING', 'CANCEL_PENDING'].includes(p.status);
                    const steps = chain?.steps ?? [];
                    // รออนุมัติ: ต่อจากขั้นที่ระบบเดิมกดไว้ · ขอยกเลิก: เดินสายใหม่ตั้งแต่ขั้นแรก · อื่น ๆ: ครบสายแล้ว
                    const step = p.status === 'PENDING' ? p.done + 1 : p.status === 'CANCEL_PENDING' ? 1 : steps.length + 1;
                    const extra = await legacyDetails(p.raw, steps, t.uid, empUser);
                    const [row] = await sql`
                        INSERT INTO hr_leave_requests
                            (user_id, leave_type_id, start_date, end_date, total_days, actual_days, is_half_day, half_day_period,
                             status, reason, reject_reason, approval_chain, current_step, days_deducted, legacy_leave_id,
                             contact_info, substitute_user_id, document_url, created_at, updated_at)
                        VALUES (${t.uid}, ${p.typeId}, ${p.start}, ${p.end}, ${p.days}, ${p.days}, ${p.isHalf}, ${p.isHalf ? 'AM' : null},
                                ${p.status}, ${p.reason}, ${p.status === 'REJECTED' ? p.reject : null},
                                ${JSON.stringify(steps)}::text::jsonb, ${step}, ${active ? p.days : 0}, ${p.id},
                                ${extra.contact}, ${extra.substitute}, ${extra.document}, ${p.created ?? sql`now()`}, now())
                        RETURNING id`;
                    if (APPROVED_LIKE.includes(p.status) || p.status === 'PENDING') await insertLegacyApprovals(sql, Number(row.id), extra.approvals);
                    if (active) await adjust(sql, t.uid, p.typeId, fyOf(p.start), p.days);
                    if (p.status === 'CANCEL_PENDING' || p.status === 'CANCELLED') {
                        await sql`
                            INSERT INTO hr_leave_cancellations (request_id, cancelled_by, reason, status_before, status, refunded_days)
                            VALUES (${row.id}, ${t.uid}, ${p.cancelReason}, 'APPROVED', ${p.status === 'CANCELLED' ? 'APPROVED' : 'PENDING'}, NULL)`;
                    }
                }
            });
        }
    } finally {
        await legacy.end();
    }
    log(`\n${COMMIT ? 'บันทึกแล้ว' : 'ทดลอง (ยังไม่บันทึก)'} · บุคลากรที่พบในระบบเดิม ${totals.employees} จาก ${totals.targets} คน`
        + (UNDO ? ` · ถอน ${totals.undone} ใบ` : ` · โอน ${totals.imported} ใบ · โอนแล้วก่อนหน้า ${totals.already} ใบ · ข้าม ${totals.skipped} ใบ`));
    if (!UNDO) {
        const nameOf = (c: string) => (types.get(c) as any)?.name_th ?? c;
        log('ตรวจประเภทการลา:'
            + `\n  โอนแยกตามประเภท: ${Object.entries(totals.by_type!).map(([c, n]) => `${nameOf(c)} ${n}`).join(' · ') || '-'}`
            + `\n  ข้ามเพราะประเภทเดิมไม่มีในระบบใหม่: ${Object.entries(totals.skipped_type!).map(([c, n]) => `${c} ${n}`).join(' · ') || '-'}`
            + `\n  เพศไม่ตรงกับประเภท: ${totals.gender_mismatch} ใบ · จำนวนวันเดิมไม่ตรงการนับวันทำการ: ${totals.day_mismatch} ใบ`
            + `\n  ไม่มีสายอนุมัติตามผัง: ${totals.no_chain} คน`
            + `\nตรวจสถานะใบที่ระบบเดิมยังรออนุมัติ (เทียบกับสายตามผังใหม่):`
            + `\n  ยังไม่มีใครกด → รอขั้นที่ 1: ${totals.pending_fresh} ใบ`
            + `\n  กดไปแล้วบางขั้น → รอขั้นที่ค้างจริง: ${totals.pending_resumed} ใบ`
            + `\n  ผ่านครบทุกขั้นของสายใหม่ → อนุมัติ: ${totals.pending_completed} ใบ`);
    }
    return totals;
};

// ── เติมย้อนหลังให้ใบที่โอนมาก่อนหน้า: การอนุมัติ / ที่ติดต่อ / ผู้ปฏิบัติแทน / ไฟล์แนบ ─────────
// เติมเฉพาะส่วนที่ยังว่าง (ใบที่มีประวัติการอนุมัติแล้วไม่แตะ · ที่ติดต่อ/ผู้ปฏิบัติแทน/ไฟล์แนบที่มีค่าแล้วไม่ทับ) — รันซ้ำได้
export interface BackfillTotals { requests: number; legacy_found: number; approvals_added: number; requests_with_approvals: number; contact_filled: number; substitute_filled: number; document_filled: number }

export const backfillLegacyDetails = async (opts: { commit: boolean }, log: Log): Promise<BackfillTotals> => {
    const reqs = await core_kon`
        SELECT r.id, r.user_id, r.status, r.legacy_leave_id, r.approval_chain, r.contact_info, r.substitute_user_id, r.document_url,
               EXISTS (SELECT 1 FROM hr_leave_approvals a WHERE a.request_id = r.id) AS has_approvals
        FROM hr_leave_requests r WHERE r.legacy_leave_id IS NOT NULL ORDER BY r.id`;
    const totals: BackfillTotals = { requests: reqs.length, legacy_found: 0, approvals_added: 0, requests_with_approvals: 0, contact_filled: 0, substitute_filled: 0, document_filled: 0 };
    if (!reqs.length) return totals;
    const legacy = await connectLegacy();
    const lq: Lq = async (q, params = []) => (await legacy.query(q, params))[0] as any[];
    const empUser = makeEmpUser(lq);
    try {
        const byId = new Map<number, any>();
        const ids = reqs.map((r: any) => Number(r.legacy_leave_id));
        for (let i = 0; i < ids.length; i += 500) {
            for (const l of await lq('SELECT * FROM tb_leave WHERE leave_id IN (?)', [ids.slice(i, i + 500)])) byId.set(Number(l.leave_id), l);
        }
        const plan: { r: any; extra: Awaited<ReturnType<typeof legacyDetails>> }[] = [];
        for (const r of reqs as any[]) {
            const l = byId.get(Number(r.legacy_leave_id));
            if (!l) continue;
            totals.legacy_found++;
            const extra = await legacyDetails(l, parseChain(r.approval_chain), Number(r.user_id), empUser);
            const addApprovals = !r.has_approvals && APPROVED_LIKE.includes(r.status) ? extra.approvals : [];
            const fillContact = r.contact_info == null && extra.contact != null;
            const fillSub = r.substitute_user_id == null && extra.substitute != null;
            const fillDoc = r.document_url == null && extra.document != null;
            if (!addApprovals.length && !fillContact && !fillSub && !fillDoc) continue;
            totals.approvals_added += addApprovals.length;
            if (addApprovals.length) totals.requests_with_approvals++;
            if (fillContact) totals.contact_filled++;
            if (fillSub) totals.substitute_filled++;
            if (fillDoc) totals.document_filled++;
            plan.push({ r, extra: { ...extra, approvals: addApprovals, contact: fillContact ? extra.contact : null, substitute: fillSub ? extra.substitute : null, document: fillDoc ? extra.document : null } });
        }
        log(`ใบที่โอนมา ${totals.requests} ใบ (พบในระบบเดิม ${totals.legacy_found}) · เติมการอนุมัติ ${totals.requests_with_approvals} ใบ (${totals.approvals_added} ขั้น)`
            + ` · ที่ติดต่อ ${totals.contact_filled} ใบ · ผู้ปฏิบัติแทน ${totals.substitute_filled} ใบ · ไฟล์แนบ ${totals.document_filled} ใบ`);
        if (opts.commit && plan.length) {
            await core_kon.begin(async (sql: any) => {
                for (const { r, extra } of plan) {
                    await insertLegacyApprovals(sql, Number(r.id), extra.approvals);
                    if (extra.contact != null || extra.substitute != null || extra.document != null) {
                        await sql`
                            UPDATE hr_leave_requests
                            SET contact_info = COALESCE(contact_info, ${extra.contact}),
                                substitute_user_id = COALESCE(substitute_user_id, ${extra.substitute}),
                                document_url = COALESCE(document_url, ${extra.document})
                            WHERE id = ${r.id}`;
                    }
                }
            });
            log('บันทึกแล้ว');
        } else if (!opts.commit) log('ทดลอง (ยังไม่บันทึก)');
    } finally {
        await legacy.end();
    }
    return totals;
};

// ── วันเริ่มงาน ──────────────────────────────────────────────────────────────
export interface ServiceDatesTotals {
    legacy_rows: number; legacy_bad_date: number; matched: number;
    fills_missing_hire: number; differs_from_hire: number; civil_ge10y_newly_known: number;
    saved?: number; hire_date_filled?: number;
}

/** 'YYYY-MM-DD' (ค.ศ.) หรือ null — ปีเกิน 2400 = พ.ศ. */
const toCe = (d: string | null): string | null => {
    if (!d || d.startsWith('0000')) return null;
    let y = Number(d.slice(0, 4));
    if (y > 2400) y -= 543;
    const out = `${y}${d.slice(4, 10)}`;
    const t = Date.parse(`${out}T00:00:00Z`);
    if (!Number.isFinite(t) || y < 1950 || t > Date.now()) return null;
    return out;
};

export const runLegacyServiceDates = async (
    opts: { commit: boolean; fillHireDate?: boolean }, log: Log,
): Promise<ServiceDatesTotals & { filled_ids?: number[] }> => {
    const legacy = await connectLegacy();
    let rows: any[];
    try {
        rows = (await legacy.query('SELECT id, id_card, appoint_date FROM tb_employee WHERE id_card IS NOT NULL AND id_card <> ""'))[0] as any[];
    } finally {
        await legacy.end();
    }
    const byCard = new Map<string, { id: number; date: string }>();
    let bad = 0;
    for (const r of rows) {
        const date = toCe(r.appoint_date);
        if (!date) { if (r.appoint_date) bad++; continue; }
        byCard.set(String(r.id_card).trim(), { id: Number(r.id), date });
    }
    const users = await core_kon`
        SELECT u.id, u.id_card, u.user_type_id, to_char(u.hire_date, 'YYYY-MM-DD') AS hire_date, CONCAT(u.fname, ' ', u.lname) AS name
        FROM users u WHERE u.id_card IS NOT NULL`;
    const years = (from: string) => (Date.now() - Date.parse(from)) / (365.2425 * 86_400_000);

    const matched: { user_id: number; date: string; legacy_id: number }[] = [];
    const stat: ServiceDatesTotals = { legacy_rows: rows.length, legacy_bad_date: bad, matched: 0, fills_missing_hire: 0, differs_from_hire: 0, civil_ge10y_newly_known: 0 };
    const differs: string[] = [];
    for (const u of users) {
        const l = byCard.get(String(u.id_card).trim());
        if (!l) continue;
        matched.push({ user_id: Number(u.id), date: l.date, legacy_id: l.id });
        stat.matched++;
        if (!u.hire_date) {
            stat.fills_missing_hire++;
            if (Number(u.user_type_id) === 1 && years(l.date) >= 10) stat.civil_ge10y_newly_known++;
        } else if (Math.abs(Date.parse(u.hire_date) - Date.parse(l.date)) > 365 * 86_400_000) {
            stat.differs_from_hire++;
            differs.push(`  ${u.name} (users #${u.id}): ทะเบียน ${u.hire_date} · วันบรรจุเดิม ${l.date}`);
        }
    }
    log(`บุคลากรในระบบเดิม ${stat.legacy_rows} แถว (วันที่ผิดรูป ${bad}) · จับคู่ด้วยเลขบัตรได้ ${stat.matched} คน`);
    log(`ระบบใหม่ยังไม่มีวันเริ่มงาน ${stat.fills_missing_hire} คน (ข้าราชการอายุงาน ≥ 10 ปี ${stat.civil_ge10y_newly_known} คน)`);
    if (differs.length) log(`วันเริ่มงานในทะเบียนต่างจากวันบรรจุเดิมเกิน 1 ปี ${differs.length} คน (ระบบใช้วันในทะเบียน — ไม่เขียนทับ):\n${differs.join('\n')}`);
    if (!opts.commit) { log('\nทดลอง (ยังไม่บันทึก)'); return stat; }

    let filled: number[] = [];
    await core_kon.begin(async (tx: any) => {
        for (let i = 0; i < matched.length; i += 500) {
            const chunk = matched.slice(i, i + 500).map(m => ({
                user_id: m.user_id, service_start_date: m.date, source: 'LEGACY', legacy_employee_id: m.legacy_id,
            }));
            await tx`
                INSERT INTO hr_leave_service_dates ${tx(chunk, 'user_id', 'service_start_date', 'source', 'legacy_employee_id')}
                ON CONFLICT (user_id) DO UPDATE
                   SET service_start_date = EXCLUDED.service_start_date, legacy_employee_id = EXCLUDED.legacy_employee_id, updated_at = now()
                 WHERE hr_leave_service_dates.source = 'LEGACY'`;
        }
        // เติม users.hire_date ที่ยังว่าง — คนที่มีอยู่แล้วไม่เขียนทับ แม้ไม่ตรงกับโปรแกรมเดิม
        if (opts.fillHireDate) {
            filled = (await tx`
                UPDATE users u SET hire_date = d.service_start_date, updated_at = now()
                FROM hr_leave_service_dates d
                WHERE d.user_id = u.id AND d.source = 'LEGACY' AND u.hire_date IS NULL
                RETURNING u.id`).map((r: any) => Number(r.id));
        }
    });
    stat.saved = matched.length;
    log(`\nบันทึกวันบรรจุ ${matched.length} คน` + (opts.fillHireDate ? ` · เติมวันเริ่มงานในทะเบียนที่ว่าง ${filled.length} คน` : ''));
    if (opts.fillHireDate) stat.hire_date_filled = filled.length;
    return { ...stat, filled_ids: filled };
};
