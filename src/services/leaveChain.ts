import { core_kon } from '../db/db';

// ── สร้างสายอนุมัติการลาตามสายบังคับบัญชา ────────────────────────────────────
//
// สายปกติ 3 ขั้น: หัวหน้าหน่วยงาน → หัวหน้ากลุ่มงาน → หัวหน้าภารกิจ
// หัวหน้าภารกิจยื่นลาเอง: เสนอ ผอ. โดยตรงขั้นเดียว
//
// กติกาที่ตกลงไว้ (ตั้งต้น — ปรับได้ที่ค่าคงที่ด้านล่าง)
//   ก) ถ้าผู้ยื่นเป็นหัวหน้าของหน่วยตัวเองในขั้นไหน ให้ "ข้ามขั้นนั้น" ขึ้นไปขั้นบนแทน
//      (ไม่มีใครอนุมัติลาให้ตัวเองได้)
//   ข) หน่วยที่ไม่มีหัวหน้า หรือผู้ยื่นไม่ได้สังกัดหน่วยนั้น ให้ข้ามขั้นนั้นไป
//      ไม่บล็อกการยื่น เพราะในฐานข้อมูลจริงมีคนไม่มีหน่วยงานอยู่หลายร้อยคน
//   ค) ไม่อนุมัติขั้นใดขั้นหนึ่ง = ใบลานั้นจบ (REJECTED) ยื่นใบใหม่ได้
//
// สายอนุมัติเก็บลง hr_leave_requests.approval_chain ตั้งแต่วันยื่น
// ขั้นที่กดไปแล้วคงไว้ตามเดิม (ตรวจย้อนหลังได้ว่าใครมีอำนาจ ณ ตอนนั้น) แต่ขั้นที่ยังไม่ถึง
// จะถูกคำนวณใหม่ตามผังปัจจุบันเมื่อแต่งตั้ง/ถอดหัวหน้า หรือย้ายหน่วย — ดู resyncPendingChains

export type ApprovalLevel = 'SUBMAJOR' | 'MAJOR' | 'MISSION' | 'DIRECTOR';

export interface ChainStep {
    step: number;                 // ลำดับขั้น เริ่มที่ 1 (นับเฉพาะขั้นที่ต้องอนุมัติจริง)
    level: ApprovalLevel;
    level_name: string;           // ชื่อไทยไว้แสดงผล
    approver_id: number;
    approver_name: string;
    unit_type: 'submajor' | 'major' | 'mission' | null;
    unit_id: number | null;
    unit_name: string | null;
    is_acting: boolean;           // อนุมัติในฐานะรักษาการ
}

/** ขั้นที่ถูกข้าม เก็บไว้เพื่ออธิบายให้ผู้ใช้เห็นว่าทำไมสายอนุมัติสั้นลง */
export interface SkippedStep {
    level: ApprovalLevel;
    level_name: string;
    reason: string;
}

export interface ResolvedChain {
    steps: ChainStep[];
    skipped: SkippedStep[];
}

const LEVEL_NAME: Record<ApprovalLevel, string> = {
    SUBMAJOR: 'หัวหน้าหน่วยงาน',
    MAJOR: 'หัวหน้ากลุ่มงาน',
    MISSION: 'หัวหน้ากลุ่มภารกิจ',
    DIRECTOR: 'ผู้อำนวยการ',
};

const fullName = (r: any) =>
    [r?.pname, r?.fname, r?.lname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

/** หัวหน้าของหน่วยหนึ่ง — เลือกตัวจริงก่อน ไม่มีจึงใช้รักษาการ */
const pickHead = (unit: any): { id: number; is_acting: boolean } | null => {
    if (unit?.supervisor_id != null) return { id: Number(unit.supervisor_id), is_acting: false };
    if (unit?.acting_supervisor_id != null) return { id: Number(unit.acting_supervisor_id), is_acting: true };
    return null;
};

/**
 * สร้างสายอนุมัติของผู้ยื่นคนหนึ่ง
 * คืน null เมื่อหาผู้อนุมัติไม่ได้เลยสักขั้น (ต้องแจ้งผู้ใช้ ไม่ใช่ปล่อยให้ยื่นแล้วค้าง)
 */
export const resolveApprovalChain = async (userId: number): Promise<ResolvedChain | null> => {
    const [me] = await core_kon`
        SELECT id, submajor_id, major_id, mission_id FROM users WHERE id = ${userId}
    `;
    if (!me) return null;

    // ผู้ยื่นเป็นหัวหน้า/รักษาการกลุ่มภารกิจไหนอยู่หรือเปล่า — ถ้าใช่ เสนอ ผอ. โดยตรง
    const missionHead = await core_kon`
        SELECT 1 FROM missions
        WHERE is_active = 'Y' AND (supervisor_id = ${userId} OR acting_supervisor_id = ${userId})
        LIMIT 1
    `;

    if (missionHead.length > 0) {
        const director = await resolveDirectorStep(1);
        if (!director) return null;
        return {
            steps: [director],
            skipped: [{
                level: 'SUBMAJOR', level_name: 'สายบังคับบัญชาปกติ',
                reason: 'ผู้ยื่นเป็นหัวหน้ากลุ่มภารกิจ จึงเสนอผู้อำนวยการโดยตรง',
            }],
        };
    }

    const [submajor, major, mission] = await Promise.all([
        me.submajor_id == null ? Promise.resolve([]) : core_kon`
            SELECT submajor_id AS unit_id, name, supervisor_id, acting_supervisor_id
            FROM submajors WHERE submajor_id = ${me.submajor_id} AND is_active = 'Y'`,
        me.major_id == null ? Promise.resolve([]) : core_kon`
            SELECT major_id AS unit_id, name, supervisor_id, acting_supervisor_id
            FROM majors WHERE major_id = ${me.major_id} AND is_active = 'Y'`,
        me.mission_id == null ? Promise.resolve([]) : core_kon`
            SELECT mission_id AS unit_id, name, supervisor_id, acting_supervisor_id
            FROM missions WHERE mission_id = ${me.mission_id} AND is_active = 'Y'`,
    ]);

    const plan: { level: ApprovalLevel; unitType: ChainStep['unit_type']; row: any; missingReason: string }[] = [
        { level: 'SUBMAJOR', unitType: 'submajor', row: submajor[0], missingReason: 'ไม่ได้สังกัดหน่วยงาน หรือหน่วยงานยังไม่มีหัวหน้า' },
        { level: 'MAJOR', unitType: 'major', row: major[0], missingReason: 'ไม่ได้สังกัดกลุ่มงาน หรือกลุ่มงานยังไม่มีหัวหน้า' },
        { level: 'MISSION', unitType: 'mission', row: mission[0], missingReason: 'ไม่ได้สังกัดกลุ่มภารกิจ หรือกลุ่มภารกิจยังไม่มีหัวหน้า' },
    ];

    const steps: ChainStep[] = [];
    const skipped: SkippedStep[] = [];
    const heads: { level: ApprovalLevel; unitType: ChainStep['unit_type']; row: any; head: { id: number; is_acting: boolean } }[] = [];

    for (const p of plan) {
        const head = p.row ? pickHead(p.row) : null;
        if (!head) {
            skipped.push({ level: p.level, level_name: LEVEL_NAME[p.level], reason: p.missingReason });
            continue;
        }
        // กติกา (ก) — ไม่ให้อนุมัติลาให้ตัวเอง
        if (head.id === userId) {
            skipped.push({
                level: p.level, level_name: LEVEL_NAME[p.level],
                reason: 'ผู้ยื่นเป็นหัวหน้าของหน่วยนี้เอง จึงข้ามไปขั้นที่สูงกว่า',
            });
            continue;
        }
        heads.push({ ...p, head });
    }

    // หัวหน้าคนเดียวกันโผล่หลายขั้น (ถือหมวกหลายใบในสายเดียวกัน) ให้เหลือขั้นเดียว
    // ที่ระดับสูงสุด ไม่งั้นคนคนเดิมต้องกดอนุมัติใบเดียวกันสองรอบ
    const seen = new Map<number, number>();  // approver_id -> index ใน heads ที่จะเก็บไว้
    heads.forEach((h, i) => seen.set(h.head.id, i));

    const names = await namesOf(heads.map(h => h.head.id));

    heads.forEach((h, i) => {
        if (seen.get(h.head.id) !== i) {
            skipped.push({
                level: h.level, level_name: LEVEL_NAME[h.level],
                reason: 'หัวหน้าคนเดียวกับขั้นที่สูงกว่า จึงรวมเป็นขั้นเดียว',
            });
            return;
        }
        steps.push({
            step: steps.length + 1,
            level: h.level,
            level_name: LEVEL_NAME[h.level],
            approver_id: h.head.id,
            approver_name: names.get(h.head.id) ?? `ผู้ใช้ #${h.head.id}`,
            unit_type: h.unitType,
            unit_id: Number(h.row.unit_id),
            unit_name: h.row.name ?? null,
            is_acting: h.head.is_acting,
        });
    });

    // ไม่เหลือขั้นไหนเลย (เช่น ไม่มีหน่วยสังกัด หรือเป็นหัวหน้าทุกหน่วยที่ตัวเองอยู่)
    // ให้ตกไปที่ ผอ. เพื่อไม่ให้ใบลาลอยไม่มีผู้อนุมัติ
    if (steps.length === 0) {
        const director = await resolveDirectorStep(1);
        if (!director) return null;
        if (director.approver_id === userId) return null;  // ผอ. ยื่นลาเอง — ไม่มีผู้อนุมัติในระบบ
        steps.push(director);
    }

    return { steps, skipped };
};

/** ขั้นของ ผอ. — ใช้ตัวจริงก่อน ไม่มีจึงใช้รักษาการ */
const resolveDirectorStep = async (step: number): Promise<ChainStep | null> => {
    const rows = await core_kon`
        SELECT name, value FROM hr_settings WHERE name IN ('director_id', 'acting_director_id')
    `;
    const get = (k: string) => {
        const v = rows.find((r: any) => r.name === k)?.value;
        return v == null || v === '' ? null : Number(v);
    };
    const directorId = get('director_id');
    const actingId = get('acting_director_id');
    const id = directorId ?? actingId;
    if (id == null) return null;

    const names = await namesOf([id]);
    return {
        step,
        level: 'DIRECTOR',
        level_name: LEVEL_NAME.DIRECTOR,
        approver_id: id,
        approver_name: names.get(id) ?? `ผู้ใช้ #${id}`,
        unit_type: null,
        unit_id: null,
        unit_name: null,
        is_acting: directorId == null,
    };
};

const namesOf = async (ids: number[]): Promise<Map<number, string>> => {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await core_kon`
        SELECT id, pname, fname, lname FROM users WHERE id IN ${core_kon(unique)}
    `;
    return new Map(rows.map((r: any) => [Number(r.id), fullName(r)]));
};

/**
 * ผู้ใช้คนนี้มีสิทธิ์กดในขั้นที่ใบลากำลังรออยู่หรือไม่ — ดูจากสายอนุมัติที่เก็บไว้ในใบ
 * (ซึ่ง resyncPendingChains คอยปรับให้ตรงผังปัจจุบันอยู่แล้ว)
 */
export const stepFor = (chain: unknown, currentStep: number): ChainStep | null =>
    parseChain(chain).find(s => Number(s.step) === Number(currentStep)) ?? null;

/**
 * คอลัมน์ jsonb อ่านกลับมาเป็นสตริงหรืออาร์เรย์ก็ได้ ขึ้นกับไดรเวอร์และบริบท
 * (ใน transaction ของ bun sql ได้เป็นสตริง) จึงต้องแปลงให้เป็นอาร์เรย์เสมอก่อนใช้
 */
export const parseChain = (raw: unknown): ChainStep[] => {
    if (Array.isArray(raw)) return raw as ChainStep[];
    if (typeof raw === 'string' && raw.trim() !== '') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed as ChainStep[] : [];
        } catch { return []; }
    }
    return [];
};

const LEVEL_RANK: Record<ApprovalLevel, number> = { SUBMAJOR: 0, MAJOR: 1, MISSION: 2, DIRECTOR: 3 };

/**
 * ปรับสายอนุมัติของใบลาที่ยังรออนุมัติ (PENDING) ให้ตรงกับผังเจ้าหน้าที่ปัจจุบัน
 * เรียกหลังแต่งตั้ง/ถอดหัวหน้า-รักษาการ-ผอ. หรือหลังย้ายหน่วยของบุคลากร
 *
 * - ขั้นที่อนุมัติไปแล้ว (step < current_step) คงไว้ทั้งหมด
 * - ขั้นที่เหลือ = สายใหม่ที่ระดับสูงกว่าขั้นล่าสุดที่อนุมัติแล้ว และไม่ใช่คนที่อนุมัติไปแล้ว
 * - สายใหม่ไม่เหลือขั้นถัดไป → เสนอ ผอ. แทน · หา ผอ. ไม่ได้ → ไม่แตะใบนั้น (ไม่ปล่อยให้ผ่านเองโดยไม่มีคนกด)
 * - ใบที่ขอยกเลิก (CANCEL_PENDING) ไม่ปรับ เพราะเป็นการเดินสายเดิมซ้ำเพื่อยกเลิก
 *
 * คืนจำนวนใบที่ถูกปรับ · ใส่ userId เพื่อปรับเฉพาะใบของคนนั้น
 */
export const resyncPendingChains = async (userId?: number): Promise<number> => {
    const rows = await core_kon`
        SELECT id, user_id, approval_chain, current_step FROM hr_leave_requests
        WHERE status = 'PENDING' ${userId == null ? core_kon`` : core_kon`AND user_id = ${userId}`}
    `;
    let changed = 0;
    for (const r of rows as any[]) {
        const chain = parseChain(r.approval_chain);
        const cs = Number(r.current_step);
        const done = chain.filter(s => Number(s.step) < cs);
        if (done.length !== cs - 1) continue;  // ข้อมูลไม่ต่อเนื่อง ไม่เดาแทน

        const fresh = await resolveApprovalChain(Number(r.user_id));
        if (!fresh) continue;
        const lastRank = done.length ? LEVEL_RANK[done[done.length - 1].level] ?? -1 : -1;
        const doneIds = new Set(done.map(s => Number(s.approver_id)));
        let rest = fresh.steps
            .filter(s => LEVEL_RANK[s.level] > lastRank && !doneIds.has(Number(s.approver_id)));
        // ผังใหม่ไม่เหลือขั้นถัดไป (เช่น ถอดหัวหน้าภารกิจที่ไม่มีรักษาการ) แต่ใบยังมีขั้นค้าง
        // → เสนอ ผอ. แทน ไม่ปล่อยใบค้างกับคนที่พ้นตำแหน่งไปแล้ว และไม่ปล่อยให้ผ่านเองโดยไม่มีคนกด
        if (rest.length === 0) {
            const director = await resolveDirectorStep(cs);
            if (director && director.approver_id !== Number(r.user_id) && !doneIds.has(director.approver_id)) rest = [director];
        }
        if (rest.length === 0) continue;
        rest = rest.map((s, i) => ({ ...s, step: cs + i }));

        const key = (xs: ChainStep[]) => JSON.stringify(xs.map(s => [s.level, s.approver_id, s.unit_type, s.unit_id, s.is_acting]));
        if (key(rest) === key(chain.filter(s => Number(s.step) >= cs))) continue;

        const next = [...done, ...rest];
        const res = await core_kon`
            UPDATE hr_leave_requests
            SET approval_chain = ${JSON.stringify(next)}::text::jsonb, updated_at = NOW()
            WHERE id = ${r.id} AND status = 'PENDING' AND current_step = ${cs}
        `;
        changed += res.count ?? 0;
    }
    return changed;
};

/** ปรับสายอนุมัติแบบไม่ให้ความผิดพลาดย้อนไปทำให้การแก้ผัง/ข้อมูลบุคลากรล้ม — log ไว้ฝั่ง server */
export const resyncPendingChainsSafe = async (userId?: number) => {
    try {
        const n = await resyncPendingChains(userId);
        if (n > 0) console.log(`[leaveChain] ปรับสายอนุมัติใบลาที่รออยู่ ${n} ใบตามผังปัจจุบัน`);
    } catch (error) {
        console.error('[leaveChain] resyncPendingChains:', error);
    }
};
