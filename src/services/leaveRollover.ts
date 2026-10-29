import { core_kon } from '../db/db';

// ── ยกยอดวันลาพักผ่อนข้ามปีงบประมาณ ─────────────────────────────────────────
//
// ใช้ทั้งปุ่ม "ยกยอด" ของงาน HR และงานอัตโนมัติเมื่อข้ามปีงบ (startLeaveRolloverJob)
// ทำเฉพาะ "ลาพักผ่อน" (hr_leave_types.code = 'ANNUAL') — ตามระเบียบที่ให้สะสมลาพักผ่อนได้เป็นหลัก
//
// คนที่ไม่มีแถวของปีเดิม = ไม่เคยลาเลย ถือว่าเหลือเต็มสิทธิ์ · ยกได้ไม่เกิน carry_over_max_days
// แถวของปีใหม่ที่มีอยู่แล้ว: ถ้าระบบสร้างเองตอนบันทึกใบลา (auto_created) และยังไม่ได้ยกยอด
// จะเติมยอดยกมาให้ · แถวที่ HR สร้าง/แก้เอง หรือยกยอดไปแล้ว ไม่แตะ (กดซ้ำได้ ไม่สร้างซ้ำ)

/** ปีงบประมาณไทย (1 ต.ค. – 30 ก.ย.) เรียกตาม พ.ศ. ของปีที่ปีงบสิ้นสุด — ตามเวลาไทย */
export const currentFiscalYear = (now = new Date()): number => {
    const bkk = new Date(now.getTime() + 7 * 3_600_000);
    return (bkk.getUTCMonth() >= 9 ? bkk.getUTCFullYear() + 1 : bkk.getUTCFullYear()) + 543;
};

export interface RolloverResult { created: number; filled: number; skipped_existing: number; skipped_no_entitlement: number }

/** สิทธิ์ลาพักผ่อนตามประเภทเจ้าหน้าที่ + อายุงาน — ไม่มี hire_date ใช้เกณฑ์ขั้นต่ำ (กติกาเดียวกับตอนยื่นใบลา) */
const entitlementsOf = async (sql: any, leaveTypeId: number) => {
    const rows = await sql`
        SELECT DISTINCT ON (u.id) u.id AS user_id, e.max_days_per_year, e.carry_over, e.carry_over_max_days
        FROM users u
        JOIN hr_leave_entitlements e ON e.user_type_id = u.user_type_id AND e.leave_type_id = ${leaveTypeId}
        WHERE u.is_active = 'Y'
          AND (u.hire_date IS NULL
               OR e.min_service_months <= EXTRACT(YEAR FROM AGE(now(), u.hire_date))::int * 12
                                        + EXTRACT(MONTH FROM AGE(now(), u.hire_date))::int)
        ORDER BY u.id,
                 CASE WHEN u.hire_date IS NULL THEN e.min_service_months END ASC,
                 e.min_service_months DESC`;
    return new Map<number, any>(rows.map((r: any) => [Number(r.user_id), r]));
};

export const rolloverAnnualLeave = async (
    sql: any, fromFy: number, toFy: number, actorId: number | null,
): Promise<RolloverResult> => {
    const [annual] = await sql`SELECT id FROM hr_leave_types WHERE code = 'ANNUAL'`;
    if (!annual) throw new Error('ไม่พบประเภทการลาพักผ่อน (ANNUAL) ในระบบ');
    const leaveTypeId = Number(annual.id);
    const ents = await entitlementsOf(sql, leaveTypeId);

    const users = await sql`
        SELECT u.id AS user_id,
               prev.remaining AS prev_remaining, (prev.id IS NOT NULL) AS has_prev,
               nxt.id AS next_id, nxt.auto_created AS next_auto, nxt.carried_from_fy AS next_carried_from
        FROM users u
        LEFT JOIN hr_leave_balances prev
               ON prev.user_id = u.id AND prev.leave_type_id = ${leaveTypeId} AND prev.fiscal_year = ${fromFy}
        LEFT JOIN hr_leave_balances nxt
               ON nxt.user_id = u.id AND nxt.leave_type_id = ${leaveTypeId} AND nxt.fiscal_year = ${toFy}
        WHERE u.is_active = 'Y'`;

    const out: RolloverResult = { created: 0, filled: 0, skipped_existing: 0, skipped_no_entitlement: 0 };
    const note = `ยกยอดอัตโนมัติจากปีงบประมาณ ${fromFy}`;
    for (const u of users) {
        const hasNext = u.next_id != null;
        // แถวปีใหม่ที่ HR ตั้งเอง หรือยกยอดไปแล้ว — ไม่แตะ
        if (hasNext && (!u.next_auto || u.next_carried_from != null)) { out.skipped_existing++; continue; }
        const ent = ents.get(Number(u.user_id));
        if (!ent || !ent.carry_over) { out.skipped_no_entitlement++; continue; }
        const left = u.has_prev ? Number(u.prev_remaining) : Number(ent.max_days_per_year ?? 0);
        const cap = ent.carry_over_max_days;
        const carriedIn = Math.max(cap != null ? Math.min(left, Number(cap)) : left, 0);
        if (hasNext) {
            await sql`
                UPDATE hr_leave_balances
                SET carried_in = ${carriedIn}, carried_from_fy = ${fromFy}, updated_by = ${actorId}, updated_at = now(),
                    note = ${note}
                WHERE id = ${u.next_id}`;
            out.filled++;
        } else {
            await sql`
                INSERT INTO hr_leave_balances
                    (user_id, leave_type_id, fiscal_year, carried_in, entitled, used, note, carried_from_fy, created_by, updated_by)
                VALUES (${u.user_id}, ${leaveTypeId}, ${toFy}, ${carriedIn}, ${ent.max_days_per_year ?? 0}, 0,
                        ${note}, ${fromFy}, ${actorId}, ${actorId})`;
            out.created++;
        }
    }
    return out;
};

// ── งานอัตโนมัติ: เมื่อข้ามปีงบ ยกยอดจากปีก่อนให้เอง ───────────────────────────
//
// hr_settings.leave_rollover_fy = ปีงบล่าสุดที่ยกยอดแล้ว
//   ยังไม่มีค่า (ติดตั้งครั้งแรก) → ตั้งเป็นปีปัจจุบันโดยไม่ยกยอด เพราะข้อมูลการลาของปีก่อน
//   ไม่ได้อยู่ในระบบนี้ ยกยอดไปทุกคนจะได้เต็มสิทธิ์ซึ่งผิด (ปีแรก HR กดยกยอดเองได้ที่หน้าวันลาสะสม)
//   ค่าน้อยกว่าปีปัจจุบัน → ยกยอดทีละปีจนถึงปีปัจจุบัน
// ตรวจตอนเริ่มเซิร์ฟเวอร์และทุก 6 ชั่วโมง · ปิดได้ด้วย LEAVE_AUTO_ROLLOVER=false
// ล็อกด้วย advisory lock — รันหลาย instance พร้อมกันก็ยกยอดครั้งเดียว
const ROLLOVER_KEY = 'leave_rollover_fy';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

export const autoRolloverEnabled = () => String(process.env.LEAVE_AUTO_ROLLOVER ?? 'true').toLowerCase() !== 'false';

export const runAutoRollover = async (now = new Date()) => core_kon.begin(async (sql: any) => {
    const [lock] = await sql`SELECT pg_try_advisory_xact_lock(hashtext(${ROLLOVER_KEY})) AS ok`;
    if (!lock?.ok) return { status: 'locked' as const };
    const fy = currentFiscalYear(now);
    const [row] = await sql`SELECT value FROM hr_settings WHERE name = ${ROLLOVER_KEY} FOR UPDATE`;
    const done = row?.value ? Number(row.value) : null;
    const save = (v: number) => sql`
        INSERT INTO hr_settings (name, description, value) VALUES (${ROLLOVER_KEY}, 'ปีงบประมาณล่าสุดที่ยกยอดวันลาพักผ่อนอัตโนมัติแล้ว (พ.ศ.)', ${String(v)})
        ON CONFLICT (name) DO UPDATE SET value = ${String(v)}, updated_at = now()`;
    if (done == null) { await save(fy); return { status: 'baseline' as const, fiscal_year: fy }; }
    if (done >= fy) return { status: 'up_to_date' as const, fiscal_year: fy };
    const results: Record<number, RolloverResult> = {};
    for (let to = done + 1; to <= fy; to++) results[to] = await rolloverAnnualLeave(sql, to - 1, to, null);
    await save(fy);
    return { status: 'rolled' as const, fiscal_year: fy, results };
});

let timer: ReturnType<typeof setInterval> | null = null;
export const startLeaveRolloverJob = () => {
    if (!autoRolloverEnabled() || timer) return;
    const tick = async () => {
        try {
            const r = await runAutoRollover();
            if (r.status === 'rolled') console.log(`[leaveRollover] ยกยอดลาพักผ่อนอัตโนมัติถึงปีงบ ${r.fiscal_year}`, JSON.stringify(r.results));
            if (r.status === 'baseline') console.log(`[leaveRollover] เริ่มนับยกยอดอัตโนมัติจากปีงบ ${r.fiscal_year} (ปีนี้ไม่ยกยอดย้อนหลัง)`);
        } catch (error) {
            console.error('[leaveRollover] ยกยอดอัตโนมัติไม่สำเร็จ:', error);
        }
    };
    setTimeout(tick, 30_000);   // รอให้เซิร์ฟเวอร์พร้อมก่อน
    timer = setInterval(tick, CHECK_EVERY_MS);
};
