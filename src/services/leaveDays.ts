import { core_kon } from '../db/db';

// ── นับจำนวนวันลาตามปฏิทินวันหยุด ─────────────────────────────────────────────
//
// ประเภทที่นับ "วันทำการ" (hr_leave_types.count_working_days_only) ไม่นับเสาร์-อาทิตย์
// และวันหยุดราชการใน hr_holidays · ประเภทอื่นนับวันปฏิทินต่อเนื่อง
// ลาครึ่งวัน = มีหนึ่งวันในช่วงที่นับครึ่งเดียว
//
// ผลนี้เป็น "ค่าที่ควรเป็น" — ผู้ลาแก้จำนวนวันเองได้ (เช่น เจ้าหน้าที่เวรที่วันเสาร์เป็นวันทำงาน)
// งาน HR จึงมีหน้าตรวจใบที่คร่อมวันหยุดอีกชั้นหนึ่ง

export interface HolidayInRange { date: string; name: string }

export interface LeaveDayCount {
    calendar_days: number;
    weekend_days: number;            // เสาร์-อาทิตย์ในช่วง
    holidays: HolidayInRange[];      // วันหยุดราชการที่ตรงวันจันทร์-ศุกร์ (ตรงเสาร์-อาทิตย์นับเป็นวันหยุดอยู่แล้ว)
    working_days: number;
    working_days_only: boolean;      // ประเภทนี้นับเฉพาะวันทำการหรือไม่
    computed_days: number;           // จำนวนวันที่ควรตัดยอด
    spans_non_working: boolean;      // ช่วงลามีวันหยุดคร่อมอยู่ (งาน HR ควรตรวจ)
}

const DAY = 86_400_000;
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);

/** วันหยุดราชการที่เปิดใช้งานในช่วง — key = YYYY-MM-DD */
export const holidaysBetween = async (start: string, end: string): Promise<Map<string, string>> => {
    const rows = await core_kon`
        SELECT to_char(holiday_date, 'YYYY-MM-DD') AS d, name_th FROM hr_holidays
        WHERE is_active AND holiday_date BETWEEN ${start} AND ${end}
    `;
    return new Map(rows.map((r: any) => [String(r.d), String(r.name_th)]));
};

/** นับวันในช่วง โดยใช้รายการวันหยุดที่โหลดไว้แล้ว (ใช้ซ้ำได้หลายใบโดยไม่ query ทีละใบ) */
export const countWithHolidays = (
    start: string, end: string, workingDaysOnly: boolean, halfDay: boolean, holidays: Map<string, string>,
): LeaveDayCount => {
    const from = Date.parse(`${start}T00:00:00Z`);
    const to = Date.parse(`${end}T00:00:00Z`);
    let calendar = 0, weekend = 0;
    const hit: HolidayInRange[] = [];
    for (let t = from; t <= to; t += DAY) {
        calendar++;
        const dow = new Date(t).getUTCDay();
        if (dow === 0 || dow === 6) { weekend++; continue; }
        const name = holidays.get(isoOf(t));
        if (name) hit.push({ date: isoOf(t), name });
    }
    const working = calendar - weekend - hit.length;
    let computed = workingDaysOnly ? working : calendar;
    if (halfDay && computed > 0) computed -= 0.5;
    return {
        calendar_days: calendar,
        weekend_days: weekend,
        holidays: hit,
        working_days: working,
        working_days_only: workingDaysOnly,
        computed_days: computed,
        spans_non_working: weekend + hit.length > 0,
    };
};

export const countLeaveDays = async (
    start: string, end: string, workingDaysOnly: boolean, halfDay = false,
): Promise<LeaveDayCount> => countWithHolidays(start, end, workingDaysOnly, halfDay, await holidaysBetween(start, end));
