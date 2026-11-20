import { core_kon } from '../db/db';

// ── สร้างสายอนุมัติการลาตามสายบังคับบัญชา ────────────────────────────────────
//
// สายปกติ 3 ขั้น: หัวหน้าหน่วยงาน → หัวหน้ากลุ่มงาน → หัวหน้าภารกิจ
// หัวหน้าภารกิจยื่นลาเอง: เสนอ ผอ. โดยตรงขั้นเดียว
// ผอ. ยื่นลาเอง: เสนอนายแพทย์สาธารณสุขจังหวัด (นพ.สสจ.) ขั้นเดียว — อยู่นอกระบบ งาน HR / ADMIN บันทึกผลตามหนังสือที่ลงนามแล้ว
//
// กติกาที่ตกลงไว้ (ตั้งต้น — ปรับได้ที่ค่าคงที่ด้านล่าง)
//   ก) ถ้าผู้ยื่นเป็นหัวหน้าของหน่วยตัวเองในขั้นไหน ให้ "ข้ามขั้นนั้น" ขึ้นไปขั้นบนแทน
//      (ไม่มีใครอนุมัติลาให้ตัวเองได้) — และข้ามทุกขั้นที่ต่ำกว่าด้วย: หัวหน้าระดับล่างเป็นผู้ใต้บังคับบัญชา
//      อนุมัติลาให้หัวหน้าระดับบนไม่ได้ (เช่น หัวหน้ากลุ่มงานที่สังกัดหน่วยงานหนึ่ง ไม่เสนอผ่านหัวหน้าหน่วยงานนั้น)
//   ข) หน่วยที่ไม่มีหัวหน้า หรือผู้ยื่นไม่ได้สังกัดหน่วยนั้น ให้ข้ามขั้นนั้นไป
//      ไม่บล็อกการยื่น เพราะในฐานข้อมูลจริงมีคนไม่มีหน่วยงานอยู่หลายร้อยคน
//   ค) ไม่อนุมัติขั้นใดขั้นหนึ่ง = ใบลานั้นจบ (REJECTED) ยื่นใบใหม่ได้
//   ง) หัวหน้าที่พ้นจากการปฏิบัติงานแล้ว (เกษียณ ลาออก โอนย้าย ลาศึกษาต่อ ฯลฯ หรือเลยวันสิ้นสุดการทำงาน)
//      ไม่นับเป็นผู้อนุมัติ — ใช้รักษาการแทน ไม่มีรักษาการให้ข้ามขึ้นขั้นบน (ผังยังไม่ได้แต่งตั้งคนใหม่)
//
// สายอนุมัติเก็บลง hr_leave_requests.approval_chain ตั้งแต่วันยื่น
// ขั้นที่กดไปแล้วคงไว้ตามเดิม (ตรวจย้อนหลังได้ว่าใครมีอำนาจ ณ ตอนนั้น) แต่ขั้นที่ยังไม่ถึง
// จะถูกคำนวณใหม่ตามผังปัจจุบันเมื่อแต่งตั้ง/ถอดหัวหน้า หรือย้ายหน่วย — ดู resyncPendingChains

export type ApprovalLevel = 'SUBMAJOR' | 'MAJOR' | 'MISSION' | 'DIRECTOR' | 'PROVINCIAL';

export interface ChainStep {
    step: number;                 // ลำดับขั้น เริ่มที่ 1 (นับเฉพาะขั้นที่ต้องอนุมัติจริง)
    level: ApprovalLevel;
    level_name: string;           // ชื่อไทยไว้แสดงผล
    approver_id: number;          // ขั้นนอกระบบ (external) = 0
    approver_name: string;
    unit_type: 'submajor' | 'major' | 'mission' | null;
    unit_id: number | null;
    unit_name: string | null;
    is_acting: boolean;           // อนุมัติในฐานะรักษาการ
    external?: boolean;           // ผู้อนุมัติไม่มีบัญชีในระบบ (นพ.สสจ.) — HR / ADMIN เป็นผู้บันทึกผล
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
    PROVINCIAL: 'นายแพทย์สาธารณสุขจังหวัด',
};

/** ชื่อที่แสดงของ นพ.สสจ. — ตั้งชื่อบุคคลได้ที่ hr_settings.provincial_officer_name (ไม่ตั้ง = ชื่อตำแหน่ง) */
const PROVINCIAL_DEFAULT = 'นายแพทย์สาธารณสุขจังหวัดพะเยา';
const PROVINCIAL_UNIT = 'สำนักงานสาธารณสุขจังหวัดพะเยา';

const resolveProvincialStep = async (step: number): Promise<ChainStep> => {
    const [row] = await core_kon`SELECT value FROM hr_settings WHERE name = 'provincial_officer_name'`;
    const name = String(row?.value ?? '').trim();
    return {
        step, level: 'PROVINCIAL', level_name: LEVEL_NAME.PROVINCIAL,
        approver_id: 0, approver_name: name || PROVINCIAL_DEFAULT,
        unit_type: null, unit_id: null, unit_name: PROVINCIAL_UNIT,
        is_acting: false, external: true,
    };
};

const fullName = (r: any) =>
    [r?.pname, r?.fname, r?.lname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

/** ผู้ที่ยังปฏิบัติงานอยู่ (อนุมัติได้) จากรายชื่อที่ให้มา — กติกา (ง) */
const activeApprovers = async (ids: (number | null | undefined)[]): Promise<Set<number>> => {
    const unique = [...new Set(ids.filter((x): x is number => x != null).map(Number))];
    if (unique.length === 0) return new Set();
    const rows = await core_kon`
        SELECT id FROM users
        WHERE id IN ${core_kon(unique)} AND is_active = 'Y' AND COALESCE(user_status_id, 1) = 1
          AND (work_end_date IS NULL OR work_end_date >= CURRENT_DATE)`;
    return new Set(rows.map((r: any) => Number(r.id)));
};

/** หัวหน้าของหน่วยหนึ่ง — เลือกตัวจริงก่อน ไม่มี (หรือพ้นจากการปฏิบัติงานแล้ว) จึงใช้รักษาการ */
const pickHead = (unit: any, active: Set<number>): { id: number; is_acting: boolean } | null => {
    if (unit?.supervisor_id != null && active.has(Number(unit.supervisor_id))) return { id: Number(unit.supervisor_id), is_acting: false };
    if (unit?.acting_supervisor_id != null && active.has(Number(unit.acting_supervisor_id))) return { id: Number(unit.acting_supervisor_id), is_acting: true };
    return null;
};
/** หน่วยมีหัวหน้า/รักษาการตั้งไว้ แต่ทุกคนพ้นจากการปฏิบัติงานแล้ว */
const headsGone = (unit: any) => unit?.supervisor_id != null || unit?.acting_supervisor_id != null;

/**
 * สร้างสายอนุมัติของผู้ยื่นคนหนึ่ง
 * คืน null เมื่อหาผู้อนุมัติไม่ได้เลยสักขั้น (ต้องแจ้งผู้ใช้ ไม่ใช่ปล่อยให้ยื่นแล้วค้าง)
 */
export const resolveApprovalChain = async (userId: number): Promise<ResolvedChain | null> => {
    const [me] = await core_kon`
        SELECT id, submajor_id, major_id, mission_id FROM users WHERE id = ${userId}
    `;
    if (!me) return null;

    // ผู้ยื่นคือผู้ที่ทำหน้าที่ ผอ. อยู่ (ตัวจริง หรือรักษาการเมื่อไม่มีตัวจริง) — ลากับ นพ.สสจ. ไม่ผ่านสายใน รพ.
    const top = await resolveDirectorStep(1);
    if (top && top.approver_id === userId) {
        return {
            steps: [await resolveProvincialStep(1)],
            skipped: [{
                level: 'DIRECTOR', level_name: LEVEL_NAME.DIRECTOR,
                reason: 'ผู้ยื่นเป็นผู้อำนวยการ จึงเสนอนายแพทย์สาธารณสุขจังหวัด (งานทรัพยากรบุคคลบันทึกผลตามหนังสือที่ลงนามแล้ว)',
            }],
        };
    }

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

    // ผู้ยื่นที่เป็นหัวหน้า/รักษาการ: สายเดินตามผังของหน่วยที่ตัวเองเป็นหัวหน้า (หน่วย → กลุ่มงานแม่ → ภารกิจแม่)
    // ไม่ใช่ตามสังกัดในข้อมูลบุคลากร — หัวหน้าบางคนสังกัดอีกกลุ่มงานหนึ่ง ถ้าเดินตามสังกัดจะเสนอหัวหน้าระดับเดียวกันที่ไม่ใช่ผู้บังคับบัญชา
    // หัวหน้าหลายหน่วยใช้หน่วยระดับสูงสุด (หน่วยที่ตรงกับสังกัดของตัวเองก่อน)
    // หน่วยแม่ในผังที่ปิดใช้งานแล้ว/ไม่ได้ระบุ (ผังค้างข้อมูลเก่า) ใช้สังกัดของบุคลากรแทนตั้งแต่ระดับนั้นขึ้นไป
    let { submajor_id: subId, major_id: majId, mission_id: misId } = me;
    const [headOfMajor] = await core_kon`
        SELECT m.major_id, mi.mission_id FROM majors m
        LEFT JOIN missions mi ON mi.mission_id = m.mission_id AND mi.is_active = 'Y'
        WHERE m.is_active = 'Y' AND (m.supervisor_id = ${userId} OR m.acting_supervisor_id = ${userId})
        ORDER BY (m.major_id = ${me.major_id ?? 0}) DESC, m.major_id LIMIT 1`;
    if (headOfMajor) {
        subId = null; majId = headOfMajor.major_id; misId = headOfMajor.mission_id ?? me.mission_id;
    } else {
        const [headOfSub] = await core_kon`
            SELECT s.submajor_id, m.major_id, mi.mission_id FROM submajors s
            LEFT JOIN majors m ON m.major_id = s.major_id AND m.is_active = 'Y'
            LEFT JOIN missions mi ON mi.mission_id = m.mission_id AND mi.is_active = 'Y'
            WHERE s.is_active = 'Y' AND (s.supervisor_id = ${userId} OR s.acting_supervisor_id = ${userId})
            ORDER BY (s.submajor_id = ${me.submajor_id ?? 0}) DESC, s.submajor_id LIMIT 1`;
        if (headOfSub) {
            subId = headOfSub.submajor_id;
            if (headOfSub.major_id != null) { majId = headOfSub.major_id; misId = headOfSub.mission_id ?? me.mission_id; }
        }
    }

    const [submajor, major, mission] = await Promise.all([
        subId == null ? Promise.resolve([]) : core_kon`
            SELECT submajor_id AS unit_id, name, supervisor_id, acting_supervisor_id
            FROM submajors WHERE submajor_id = ${subId} AND is_active = 'Y'`,
        majId == null ? Promise.resolve([]) : core_kon`
            SELECT major_id AS unit_id, name, supervisor_id, acting_supervisor_id
            FROM majors WHERE major_id = ${majId} AND is_active = 'Y'`,
        misId == null ? Promise.resolve([]) : core_kon`
            SELECT mission_id AS unit_id, name, supervisor_id, acting_supervisor_id
            FROM missions WHERE mission_id = ${misId} AND is_active = 'Y'`,
    ]);

    const plan: { level: ApprovalLevel; unitType: ChainStep['unit_type']; row: any; missingReason: string }[] = [
        { level: 'SUBMAJOR', unitType: 'submajor', row: submajor[0], missingReason: 'ไม่ได้สังกัดหน่วยงาน หรือหน่วยงานยังไม่มีหัวหน้า' },
        { level: 'MAJOR', unitType: 'major', row: major[0], missingReason: 'ไม่ได้สังกัดกลุ่มงาน หรือกลุ่มงานยังไม่มีหัวหน้า' },
        { level: 'MISSION', unitType: 'mission', row: mission[0], missingReason: 'ไม่ได้สังกัดกลุ่มภารกิจ หรือกลุ่มภารกิจยังไม่มีหัวหน้า' },
    ];

    const steps: ChainStep[] = [];
    const skipped: SkippedStep[] = [];
    const heads: { level: ApprovalLevel; unitType: ChainStep['unit_type']; row: any; head: { id: number; is_acting: boolean } }[] = [];
    const active = await activeApprovers(plan.flatMap(p => [p.row?.supervisor_id, p.row?.acting_supervisor_id]));

    // ระดับสูงสุดที่ผู้ยื่นเป็นหัวหน้า/รักษาการของหน่วยตัวเอง — ขั้นที่ต่ำกว่าระดับนี้ข้ามทั้งหมด (กติกา ก)
    const ownTop = plan.reduce((top, p, i) =>
        p.row && (Number(p.row.supervisor_id) === userId || Number(p.row.acting_supervisor_id) === userId) ? i : top, -1);

    for (const [i, p] of plan.entries()) {
        if (i < ownTop) {
            skipped.push({
                level: p.level, level_name: LEVEL_NAME[p.level],
                reason: `ผู้ยื่นเป็น${LEVEL_NAME[plan[ownTop].level]}ซึ่งสูงกว่าขั้นนี้ จึงไม่เสนอผ่านหัวหน้าระดับล่าง`,
            });
            continue;
        }
        const head = p.row ? pickHead(p.row, active) : null;
        if (!head) {
            const reason = p.row && headsGone(p.row)
                ? `หัวหน้า${p.row.name ? ` ${p.row.name}` : ''} พ้นจากการปฏิบัติงานแล้ว และยังไม่ได้แต่งตั้งคนใหม่/รักษาการ จึงข้ามไปขั้นที่สูงกว่า`
                : p.missingReason;
            skipped.push({ level: p.level, level_name: LEVEL_NAME[p.level], reason });
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

// ── ขออนุมัติในฐานะ (ระบบเดินทางไปราชการ) ─────────────────────────────────────
// คนที่เป็นหัวหน้าหลายหน่วย (เช่น หัวหน้ากลุ่มงานอายุรกรรม ในภารกิจตติยภูมิ + หัวหน้ากลุ่มภารกิจด้านสุขภาพดิจิทัล)
// เลือกได้ว่ายื่นในฐานะใด สายจึงต่างกัน: หัวหน้าภารกิจ = เสนอ ผอ. โดยตรง · หัวหน้ากลุ่มงาน = ผ่านหัวหน้าภารกิจต้นสังกัดของกลุ่มงาน
// บุคลากรในสังกัด = หัวหน้ากลุ่มงานต้นสังกัด → หัวหน้าภารกิจ (เมื่อไม่ได้เป็นหัวหน้ากลุ่มงานของตัวเอง)
export type CapacityType = 'mission' | 'major' | 'member';
export interface ApprovalCapacity {
    key: string;                  // mission:7 · major:20 · member:20
    type: CapacityType;
    unit_id: number;
    unit_name: string;            // ชื่อหน่วยที่พิมพ์ในบันทึกข้อความ (กลุ่มงาน/กลุ่มภารกิจ)
    label: string;                // ข้อความที่แสดง เช่น "หัวหน้ากลุ่มภารกิจด้านสุขภาพดิจิทัล"
    is_acting: boolean;
    steps: ChainStep[];           // ขั้นหัวหน้าในระบบ (MAJOR/MISSION) — ว่าง = เสนอ ผอ. โดยตรง
}
const majorName = (n: string | null) => { const t = String(n ?? '').trim(); return t.startsWith('กลุ่มงาน') ? t : `กลุ่มงาน${t}`; };
const missionName = (n: string | null) => { const t = String(n ?? '').trim(); return t.startsWith('กลุ่มภารกิจ') ? t : `กลุ่มภารกิจ${t}`; };

/**
 * ฐานะที่ผู้ใช้เลือกยื่นได้ เรียงตามลำดับ: หัวหน้าภารกิจ → หัวหน้ากลุ่มงาน → บุคลากรในสังกัด
 * นับเฉพาะหน่วยที่ผู้ใช้ "ทำหน้าที่หัวหน้าอยู่จริง" (ตัวจริง หรือรักษาการเมื่อตัวจริงไม่ปฏิบัติงาน — กติกาเดียวกับ pickHead)
 * ฐานะที่สายออกมาเหมือนกันรวมเป็นตัวเลือกเดียว (เก็บตัวแรก) · ไม่ได้เป็นหัวหน้าที่ไหน = [] (ไม่ต้องเลือก)
 */
export const approvalCapacitiesOf = async (userId: number): Promise<ApprovalCapacity[]> => {
    const [missions, majors, [me]] = await Promise.all([
        core_kon`SELECT mission_id AS unit_id, name, supervisor_id, acting_supervisor_id FROM missions
                 WHERE is_active = 'Y' AND (supervisor_id = ${userId} OR acting_supervisor_id = ${userId}) ORDER BY mission_id`,
        core_kon`SELECT m.major_id AS unit_id, m.name, m.supervisor_id, m.acting_supervisor_id, m.mission_id FROM majors m
                 WHERE m.is_active = 'Y' AND (m.supervisor_id = ${userId} OR m.acting_supervisor_id = ${userId}) ORDER BY m.major_id`,
        core_kon`SELECT u.major_id, m.name AS major_name, m.mission_id FROM users u LEFT JOIN majors m ON m.major_id = u.major_id AND m.is_active = 'Y' WHERE u.id = ${userId}`,
    ]);
    const active0 = await activeApprovers([...missions, ...majors].flatMap((u: any) => [u.supervisor_id, u.acting_supervisor_id]));
    const isHead = (u: any) => pickHead(u, active0)?.id === userId;
    const myMissions = missions.filter(isHead), myMajors = majors.filter(isHead);
    if (!myMissions.length && !myMajors.length) return [];

    // หัวหน้าของกลุ่มงาน/ภารกิจที่เกี่ยวข้อง (ไว้สร้างขั้น)
    const missionIds = [...new Set([...myMajors.map((m: any) => m.mission_id), me?.mission_id].filter((x: any) => x != null).map(Number))];
    // ฐานะบุคลากรในสังกัด: เฉพาะเมื่อกลุ่มงานของตัวเองอยู่คนละภารกิจกับหน่วยที่ตัวเองเป็นหัวหน้า
    // (ภารกิจเดียวกัน = หัวหน้ากลุ่มงานนั้นเป็นผู้ใต้บังคับบัญชาหรือระดับเดียวกัน อนุมัติให้ไม่ได้ — กติกา ก)
    const headedMissionIds = new Set([...myMissions.map((m: any) => Number(m.unit_id)), ...myMajors.map((m: any) => Number(m.mission_id))]);
    const ownMajorHeaded = me?.major_id == null || myMajors.some((m: any) => Number(m.unit_id) === Number(me.major_id))
        || headedMissionIds.has(Number(me.mission_id));
    const [missionRows, ownMajor] = await Promise.all([
        missionIds.length ? core_kon`SELECT mission_id AS unit_id, name, supervisor_id, acting_supervisor_id FROM missions WHERE is_active = 'Y' AND mission_id IN ${core_kon(missionIds)}` : Promise.resolve([]),
        me?.major_id != null && !ownMajorHeaded ? core_kon`SELECT major_id AS unit_id, name, supervisor_id, acting_supervisor_id, mission_id FROM majors WHERE is_active = 'Y' AND major_id = ${me.major_id}` : Promise.resolve([]),
    ]);
    const active = await activeApprovers([...missionRows, ...ownMajor].flatMap((u: any) => [u.supervisor_id, u.acting_supervisor_id]));
    const raw: { level: ApprovalLevel; unit: any; head: { id: number; is_acting: boolean } }[][] = [];
    const stepOf = (level: ApprovalLevel, unit: any) => {
        const head = unit ? pickHead(unit, active) : null;
        return head && head.id !== userId ? [{ level, unit, head }] : [];
    };
    const missionRow = (id: unknown) => missionRows.find((x: any) => Number(x.unit_id) === Number(id));

    const out: Omit<ApprovalCapacity, 'steps'>[] = [];
    for (const m of myMissions) {
        out.push({ key: `mission:${m.unit_id}`, type: 'mission', unit_id: Number(m.unit_id), unit_name: missionName(m.name), label: `หัวหน้า${missionName(m.name)}`, is_acting: Number(m.supervisor_id) !== userId });
        raw.push([]);
    }
    for (const m of myMajors) {
        out.push({ key: `major:${m.unit_id}`, type: 'major', unit_id: Number(m.unit_id), unit_name: majorName(m.name), label: `หัวหน้า${majorName(m.name)}`, is_acting: Number(m.supervisor_id) !== userId });
        raw.push(stepOf('MISSION', missionRow(m.mission_id)));
    }
    if (ownMajor[0]) {
        const om = ownMajor[0];
        out.push({ key: `member:${om.unit_id}`, type: 'member', unit_id: Number(om.unit_id), unit_name: majorName(om.name), label: `บุคลากร${majorName(om.name)}`, is_acting: false });
        raw.push([...stepOf('MAJOR', om), ...stepOf('MISSION', missionRow(om.mission_id ?? me.mission_id))]);
    }
    const names = await namesOf(raw.flat().map(s => s.head.id));
    const seen = new Set<string>();
    const result: ApprovalCapacity[] = [];
    out.forEach((c, i) => {
        // หัวหน้าคนเดียวกันสองขั้น (กลุ่มงาน + ภารกิจ) รวมเป็นขั้นบนขั้นเดียว
        const hs = raw[i].filter((s, k, a) => !a.slice(k + 1).some(x => x.head.id === s.head.id));
        const steps: ChainStep[] = hs.map((s, k) => ({
            step: k + 1, level: s.level, level_name: LEVEL_NAME[s.level], approver_id: s.head.id,
            approver_name: names.get(s.head.id) ?? `ผู้ใช้ #${s.head.id}`, unit_type: s.level === 'MAJOR' ? 'major' : 'mission',
            unit_id: Number(s.unit.unit_id), unit_name: s.unit.name ?? null, is_acting: s.head.is_acting,
        }));
        const sig = steps.map(s => `${s.level}:${s.approver_id}`).join('>');
        if (seen.has(sig)) return;
        seen.add(sig);
        result.push({ ...c, steps });
    });
    return result;
};

/** ขั้นของ ผอ. — ใช้ตัวจริงก่อน ไม่มี (หรือพ้นจากการปฏิบัติงานแล้ว) จึงใช้รักษาการ */
export const resolveDirectorStep = async (step: number): Promise<ChainStep | null> => {
    const rows = await core_kon`
        SELECT name, value FROM hr_settings WHERE name IN ('director_id', 'acting_director_id')
    `;
    const get = (k: string) => {
        const v = rows.find((r: any) => r.name === k)?.value;
        return v == null || v === '' ? null : Number(v);
    };
    const active = await activeApprovers([get('director_id'), get('acting_director_id')]);
    const ok = (k: string) => { const v = get(k); return v != null && active.has(v) ? v : null; };
    const directorId = ok('director_id');
    const actingId = ok('acting_director_id');
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

/** ผู้ใช้คนนี้กดในขั้นนี้ได้ไหม — ขั้นปกติต้องเป็นผู้อนุมัติที่ระบุ · ขั้นนอกระบบ (นพ.สสจ.) งาน HR / ADMIN บันทึกผลแทน */
export const canActOnStep = (step: ChainStep, uid: number, isHr: boolean) =>
    step.external ? isHr : Number(step.approver_id) === uid;

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

const LEVEL_RANK: Record<ApprovalLevel, number> = { SUBMAJOR: 0, MAJOR: 1, MISSION: 2, DIRECTOR: 3, PROVINCIAL: 4 };

/**
 * ปรับสายอนุมัติของใบลาที่ยังรออนุมัติ (PENDING) ให้ตรงกับผังเจ้าหน้าที่ปัจจุบัน
 * เรียกหลังแต่งตั้ง/ถอดหัวหน้า-รักษาการ-ผอ. หรือหลังย้ายหน่วยของบุคลากร
 *
 * - ขั้นที่อนุมัติไปแล้ว (step < current_step) คงไว้ทั้งหมด
 * - ขั้นที่เหลือ = สายใหม่ที่ระดับสูงกว่าขั้นล่าสุดที่อนุมัติแล้ว และไม่ใช่คนที่อนุมัติไปแล้ว
 * - สายใหม่ไม่เหลือขั้นถัดไป → เสนอ ผอ. แทน · หา ผอ. ไม่ได้ → ไม่แตะใบนั้น (ไม่ปล่อยให้ผ่านเองโดยไม่มีคนกด)
 * - ใบที่ขอยกเลิก (CANCEL_PENDING) เดินสายเดิมซ้ำเพื่อยกเลิก — ปรับเฉพาะเมื่อขั้นที่เหลือมีผู้อนุมัติ
 *   ที่พ้นจากการปฏิบัติงานแล้ว (ไม่งั้นค้างตลอดไป)
 *
 * คืนจำนวนใบที่ถูกปรับ · ใส่ userId เพื่อปรับเฉพาะใบของคนนั้น
 */
export const resyncPendingChains = async (userId?: number): Promise<number> => {
    const rows = await core_kon`
        SELECT id, user_id, status, approval_chain, current_step FROM hr_leave_requests
        WHERE status IN ('PENDING', 'CANCEL_PENDING') ${userId == null ? core_kon`` : core_kon`AND user_id = ${userId}`}
    `;
    const remainingIds = (rows as any[]).flatMap(r => parseChain(r.approval_chain)
        .filter(s => Number(s.step) >= Number(r.current_step) && !s.external).map(s => Number(s.approver_id)));
    const active = await activeApprovers(remainingIds);
    let changed = 0;
    for (const r of rows as any[]) {
        const chain = parseChain(r.approval_chain);
        const cs = Number(r.current_step);
        const done = chain.filter(s => Number(s.step) < cs);
        if (done.length !== cs - 1) continue;  // ข้อมูลไม่ต่อเนื่อง ไม่เดาแทน
        if (r.status === 'CANCEL_PENDING'
            && chain.filter(s => Number(s.step) >= cs).every(s => s.external || active.has(Number(s.approver_id)))) continue;

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
            WHERE id = ${r.id} AND status = ${r.status} AND current_step = ${cs}
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
