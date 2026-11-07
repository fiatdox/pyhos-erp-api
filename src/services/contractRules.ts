// กฎวันที่ของระบบคืนหลักประกันสัญญา — ฟังก์ชันล้วน ไม่แตะฐานข้อมูล
// วันที่ทุกตัวเป็นสตริง YYYY-MM-DD เพื่อไม่ให้เขตเวลาเลื่อนวัน

export type Rules = Record<string, number>;

export const isValidDate = (s: unknown): s is string => {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const addDays = (iso: string, days: number): string => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
};

// สิ้นเดือนไม่ล้นไปเดือนถัดไป: 31 ม.ค. + 1 เดือน = 28/29 ก.พ.
export const addMonths = (iso: string, months: number): string => {
    const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
    const total = y * 12 + (m - 1) + months;
    const ny = Math.floor(total / 12);
    const nm = total - ny * 12;
    const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
    return `${String(ny).padStart(4, '0')}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};

export const todayBkk = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

export interface ScheduleInput {
    accepted_date: string | null;
    warranty_end_date: string | null;   // เจ้าหน้าที่พัสดุเป็นผู้ตั้ง
    warranty_months: number;
    periodic_months: number | null;
    amendments: { add_warranty_months: number }[];
}

export interface TaskPlan {
    code: string;
    round: number;
    title: string;
    duty: 'procurement' | 'finance' | 'committee' | 'custodian' | 'approver';
    due_date: string;
}

export const totalWarrantyMonths = (c: Pick<ScheduleInput, 'warranty_months' | 'amendments'>) =>
    c.warranty_months + c.amendments.reduce((sum, a) => sum + a.add_warranty_months, 0);

// ตรวจรอบสุดท้าย: ประกันระยะสั้นตรวจก่อน 15 วัน เกินกว่านั้นก่อน 30 วัน (ค่าทั้งหมดมาจาก ctr_rules)
export const finalInspectionDue = (end: string, months: number, r: Rules) =>
    addDays(end, -(months <= r.warranty_short_months! ? r.final_short_days! : r.final_long_days!));

// แผนงานทั้งสัญญาจากวันหมดประกันที่เจ้าหน้าที่ตั้ง — เรียกซ้ำได้ งานที่ปิดแล้วจะไม่ถูกแตะ
export const planTasks = (c: ScheduleInput, r: Rules): { end: string | null; tasks: TaskPlan[] } => {
    const end = c.warranty_end_date;
    if (!c.accepted_date || !end) return { end, tasks: [] };
    const months = totalWarrantyMonths(c);
    const tasks: TaskPlan[] = [
        { code: 'NOTIFY_WARRANTY', round: 0, title: 'แจ้งวันหมดประกันให้ผู้ครอบครองพัสดุ', duty: 'procurement', due_date: c.accepted_date },
        { code: 'REGISTER_GUARANTEE', round: 0, title: 'บันทึกทะเบียนคุมหลักประกัน', duty: 'finance', due_date: c.accepted_date },
        { code: 'SCHEDULE_FINAL', round: 0, title: 'นัดหมายกรรมการตรวจรอบสุดท้าย', duty: 'procurement', due_date: addDays(end, -r.schedule_lead_days!) },
        { code: 'FINAL_INSPECTION', round: 0, title: 'ตรวจรอบสุดท้าย', duty: 'committee', due_date: finalInspectionDue(end, months, r) },
        { code: 'PROPOSE_RETURN', round: 0, title: 'ยืนยันพ้นภาระและทำบันทึกเสนอคืน', duty: 'procurement', due_date: end },
        { code: 'APPROVE_RETURN', round: 0, title: 'อนุมัติคืนหลักประกัน', duty: 'approver', due_date: addDays(end, r.approve_after_t_days!) },
        { code: 'PAY_RETURN', round: 0, title: 'จ่ายเงิน/คืนหนังสือค้ำประกัน', duty: 'finance', due_date: addDays(end, r.return_days!) },
    ];
    if (c.periodic_months) {
        for (let k = 1; ; k++) {
            const due = addMonths(c.accepted_date, c.periodic_months * k);
            if (due >= end) break;
            tasks.push({ code: 'PERIODIC_INSPECTION', round: k, title: `ตรวจตามรอบสัญญา ครั้งที่ ${k}`, duty: 'committee', due_date: due });
        }
    }
    return { end, tasks };
};

// หนังสือค้ำประกันต้องอยู่ถึง T + ระยะเผื่อ ถ้าหมดก่อนต้องเรียกต่ออายุ
export const guaranteeExpiresTooSoon = (expiry: string | null, end: string | null, r: Rules) =>
    !!expiry && !!end && expiry <= addDays(end, r.guarantee_margin_days!);

export type DueState = 'overdue' | 'near' | 'normal';
export const dueState = (due: string, r: Rules, today = todayBkk()): DueState =>
    due < today ? 'overdue' : due <= addDays(today, r.near_due_days!) ? 'near' : 'normal';
