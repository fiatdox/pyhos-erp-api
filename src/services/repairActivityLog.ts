import { core_kon } from '../db/db';

// ── บันทึกกิจกรรม IT อัตโนมัติจากระบบแจ้งซ่อม ──────────────────────────────────
//
// หนึ่งการกดในระบบแจ้งซ่อม (= หนึ่งแถวใน it_repair_requests_track) → กิจกรรมหนึ่งแถว
// เฉพาะผู้กดที่อยู่ในรายชื่อบันทึกกิจกรรม (it_activity_staff.user_id) ไม่อยู่ = ข้าม
// ช่วงเวลา = ช่องชั่วโมงที่กด (เวลาไทย) เหมือนที่เจ้าหน้าที่ลงเอง (ฟอร์มและตารางรายวันทำงานเป็นช่องชั่วโมง)
// ส่วนเวลาที่ใช้จริงอยู่ใน minutes_used ตามค่าตั้งต้นของขั้นนั้น เจ้าหน้าที่แก้เองได้ภายหลัง
// auto_ref = repair_track:<track id> มี unique index กันบันทึกซ้ำ
// ไม่ throw — ถ้าพลาด งานซ่อมยังสำเร็จตามปกติ แค่เขียน log ไว้ (เหมือนการแจ้ง MOPH)

export type RepairEvent =
    | 'receive' | 'reject' | 'assess' | 'extend' | 'progress'
    | 'header_approve' | 'mission_approve' | 'pr' | 'complete';

const EVENTS: Record<RepairEvent, { label: string; type: string; minutes: number }> = {
    receive:         { label: 'รับงานซ่อม',                    type: 'maintenance',  minutes: 15 },
    assess:          { label: 'ประเมินผลการซ่อม',              type: 'maintenance',  minutes: 30 },
    progress:        { label: 'ดำเนินการซ่อม (อัพเดทความคืบหน้า)', type: 'maintenance',  minutes: 30 },
    complete:        { label: 'ปิดงานซ่อม',                    type: 'maintenance',  minutes: 30 },
    reject:          { label: 'ปฏิเสธงานซ่อม',                 type: 'coordination', minutes: 10 },
    extend:          { label: 'ขอขยายเวลางานซ่อม',              type: 'coordination', minutes: 10 },
    header_approve:  { label: 'พิจารณาคำร้องซ่อม (หัวหน้า IT)',  type: 'documents',    minutes: 10 },
    mission_approve: { label: 'พิจารณาคำร้องซ่อม (หัวหน้ากลุ่มภารกิจ)', type: 'documents', minutes: 10 },
    pr:              { label: 'บันทึกใบ PR งานซ่อม',            type: 'documents',    minutes: 15 },
};

// ประเภทอุปกรณ์ (it_equipment_types.id) → ระบบของกิจกรรม (it_activity_systems.system_code)
const SYSTEM_BY_EQUIPMENT: Record<number, string> = {
    1: 'pc', 2: 'pc', 4: 'pc', 5: 'pc',   // คอมพิวเตอร์ตั้งโต๊ะ โน้ตบุ๊ก จอภาพ เครื่องสำรองไฟ
    3: 'printer', 8: 'printer',            // เครื่องพิมพ์ Scanner
    6: 'network',                          // Switch / Hub / อุปกรณ์เครือข่าย
    7: 'server',                           // เครื่องแม่ข่าย
};
const NETWORK_PROBLEM_CATEGORY = 3;       // it_problem_category: เครือข่าย/อินเทอร์เน็ต
const URGENT_PRIORITY_LEVELS = [3, 4];    // it_priority_levels: เร่งด่วน วิกฤต

const DAY_START = 8 * 60;
const DAY_END = 17 * 60;
const BKK_OFFSET_MS = 7 * 3600_000;       // ประเทศไทยไม่มี DST

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const cut = (s: string | null | undefined, n: number) => (s ? String(s).trim().slice(0, n) : '') || null;

/** ช่องชั่วโมงของกิจกรรม (เวลาไทย) เช่น กด 10:20 → 10:00–11:00 · ชั่วโมง 23 จบ 23:59 (time ไม่มี 24:00) */
export const activitySlot = (at: Date, minutes: number) => {
    const b = new Date(at.getTime() + BKK_OFFSET_MS);
    const date = b.toISOString().slice(0, 10);
    const start = b.getUTCHours() * 60;
    const end = Math.min(start + 60, 23 * 60 + 59);
    return { date, dow: b.getUTCDay(), start, end, minutes, startText: hhmm(start), endText: hhmm(end) };
};

export const logRepairActivity = async (opts: {
    requestId: number | string;
    trackId: number | null | undefined;
    userId: number;
    event: RepairEvent;
    note?: string | null;
    at?: Date;
}): Promise<void> => {
    const { requestId, trackId, userId, event, note } = opts;
    if (!trackId || !userId) return;
    try {
        const [staff] = await core_kon`
            SELECT staff_id FROM it_activity_staff WHERE user_id = ${userId} AND is_active = 'Y'
        `;
        if (!staff) return;

        const [req] = await core_kon`
            SELECT it_repair_request_id, equipment_name, equipment_number, location, problem_description,
                   it_equipment_type_id, problem_category_id,
                   COALESCE(technician_priority_id, it_priority_level_id) AS priority_level_id
            FROM it_repair_requests WHERE it_repair_request_id = ${requestId}
        `;
        if (!req) return;

        const cfg = EVENTS[event];
        const slot = activitySlot(opts.at ?? new Date(), cfg.minutes);
        const [holiday] = await core_kon`SELECT 1 FROM hr_holidays WHERE is_active AND holiday_date = ${slot.date}::date`;
        const offDay = slot.dow === 0 || slot.dow === 6 || !!holiday;
        const isOvertime = offDay || slot.start < DAY_START || slot.start >= DAY_END;

        const systemCode = SYSTEM_BY_EQUIPMENT[Number(req.it_equipment_type_id)]
            ?? (Number(req.problem_category_id) === NETWORK_PROBLEM_CATEGORY ? 'network' : 'other');
        const priority = URGENT_PRIORITY_LEVELS.includes(Number(req.priority_level_id)) ? 'urgent' : 'normal';

        const equipment = [req.equipment_name, req.equipment_number ? `(${req.equipment_number})` : null].filter(Boolean).join(' ');
        const detail = cut(`${cfg.label} #${req.it_repair_request_id}${equipment ? ` ${equipment}` : ''}${req.problem_description ? ` — ${req.problem_description}` : ''}`, 2000)!;

        await core_kon`
            INSERT INTO it_activity_logs
                (log_date, staff_id, type_id, system_id, status_code,
                 start_time, end_time, minutes_used, detail, outcome,
                 priority_code, source_code, location, asset_code,
                 affected_users, is_overtime, ticket_id, created_by, auto_ref)
            SELECT ${slot.date}::date, ${staff.staff_id}, t.type_id, s.system_id, 'done',
                   ${slot.startText}::time, ${slot.endText}::time, ${slot.minutes}, ${detail}, ${cut(note, 2000)},
                   ${priority}, 'repair_system', ${cut(req.location, 200)}, ${cut(req.equipment_number, 60)},
                   1, ${isOvertime}, ${`REP-${req.it_repair_request_id}`}, ${userId}, ${`repair_track:${trackId}`}
            FROM it_activity_types t, it_activity_systems s
            WHERE t.type_code = ${cfg.type} AND s.system_code = ${systemCode}
            ON CONFLICT (auto_ref) WHERE auto_ref IS NOT NULL DO NOTHING
        `;
    } catch (err: any) {
        console.error(`[repairActivityLog] ${event} #${requestId} failed:`, err.message);
    }
};
