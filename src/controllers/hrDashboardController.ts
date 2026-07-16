import { core_kon } from '../db/db';

// =============================================================================
// HR Dashboard — สรุปข้อมูลบุคลากรจากตาราง users + lookup จริง
// นิยาม:
//   - บุคลากรปัจจุบัน (current staff)  = users.is_active = 'Y'
//   - ปฏิบัติงาน (active)             = is_active = 'Y' AND user_status_id = 1 (ปฏิบัติงาน)
//   - ออกจากงาน (exit)               = user_status_id IN (2,3,4,6,7,10)
//       2=ลาออก 3=เกษียณอายุราชการ 4=โอนย้าย 6=ถูกให้ออก 7=ไล่ออก 10=เสียชีวิต
//   - "ปีนี้" ของการออก อ้างอิงจาก users.updated_at (เวลาที่สถานะถูกปรับล่าสุด)
//     เนื่องจากตาราง users ยังไม่มีคอลัมน์ exit_date โดยเฉพาะ
// หมายเหตุ birthday: ข้อมูลปีเกิดมีทั้ง พ.ศ. และ ค.ศ. ปนกัน — normalize โดยหักปีที่ > 2200 ด้วย 543
// =============================================================================

// รหัสสถานะที่ถือว่า "ออกจากงาน"
const EXIT_STATUS_IDS = [2, 3, 4, 6, 7, 10];

// ── ตอบ 500 แบบไม่เผยรายละเอียดภายใน (SQL error ฯลฯ log ไว้ฝั่ง server เท่านั้น) ──
const serverError = (set: any, where: string, error: any) => {
    console.error(`[hrDashboardController] ${where}:`, error);
    set.status = 500;
    return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
};

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

// 1) การ์ด KPI ภาพรวม
export const getHrSummary = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT
                COUNT(*) FILTER (WHERE is_active = 'Y')                                AS total_staff,
                COUNT(*) FILTER (WHERE is_active = 'Y' AND user_status_id = 1)          AS active_staff,
                COUNT(*) FILTER (WHERE user_status_id = ANY(${EXIT_STATUS_IDS})
                                   AND EXTRACT(YEAR FROM updated_at) = EXTRACT(YEAR FROM CURRENT_DATE)) AS exit_ytd
            FROM users
        `;
        const total = Number(rows[0].total_staff);
        const active = Number(rows[0].active_staff);
        const exitYtd = Number(rows[0].exit_ytd);
        const retention = (active + exitYtd) > 0 ? Math.round((active / (active + exitYtd)) * 100) : 100;
        return { success: true, data: { total_staff: total, active_staff: active, exit_ytd: exitYtd, retention_rate: retention } };
    } catch (error: any) {
        return serverError(set, 'getHrSummary', error);
    }
};

// 2) จำนวนบุคลากรตามประเภทเจ้าหน้าที่ (ข้าราชการ / พนักงานราชการ / ...)
export const getStaffTypes = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT ut.type_name AS name, COUNT(*)::int AS value
            FROM users u
            JOIN user_types ut ON ut.user_type_id = u.user_type_id
            WHERE u.is_active = 'Y'
            GROUP BY ut.user_type_id, ut.type_name
            ORDER BY ut.user_type_id
        `;
        return { success: true, data: rows.map(r => ({ name: r.name, value: Number(r.value) })) };
    } catch (error: any) {
        return serverError(set, 'getStaffTypes', error);
    }
};

// 3) จำนวนบุคลากรตามตำแหน่ง (top 12 + รวมที่เหลือเป็น "อื่นๆ")
export const getPositions = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT COALESCE(up.position_name, 'ไม่ระบุ') AS name, COUNT(*)::int AS value
            FROM users u
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            WHERE u.is_active = 'Y'
            GROUP BY up.position_name
            ORDER BY value DESC
        `;
        const all = rows.map(r => ({ name: r.name as string, value: Number(r.value) }));
        const TOP = 12;
        if (all.length <= TOP) return { success: true, data: all };
        const top = all.slice(0, TOP);
        const othersTotal = all.slice(TOP).reduce((s, r) => s + r.value, 0);
        return { success: true, data: [...top, { name: 'อื่นๆ', value: othersTotal }] };
    } catch (error: any) {
        return serverError(set, 'getPositions', error);
    }
};

// 3.5) Bubble chart ตามตำแหน่ง — ขนาดฟอง = จำนวน, สีฟอง = สัดส่วนเพศ (หญิง/ชาย)
// แสดงทุกตำแหน่งของบุคลากรที่ยังทำงานอยู่ (is_active='Y') — ครอบคลุมครบ 100%
export const getPositionBubbles = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT
                up.position_name AS name,
                COUNT(*)::int AS count,
                COUNT(*) FILTER (WHERE u.gender = 'F')::int AS female,
                COUNT(*) FILTER (WHERE u.gender = 'M')::int AS male,
                ROUND(100.0 * COUNT(*) FILTER (WHERE u.gender = 'F') / NULLIF(COUNT(*), 0))::int AS female_pct
            FROM users u
            JOIN user_positions up ON up.user_position_id = u.user_position_id
            WHERE u.is_active = 'Y'
            GROUP BY up.position_name
            ORDER BY count DESC
        `;
        return {
            success: true,
            data: rows.map(r => ({
                name: r.name,
                count: Number(r.count),
                female: Number(r.female),
                male: Number(r.male),
                female_pct: r.female_pct == null ? 0 : Number(r.female_pct),
            })),
        };
    } catch (error: any) {
        return serverError(set, 'getPositionBubbles', error);
    }
};

// 4) สาเหตุการออกจากงาน (ปีปัจจุบัน)
export const getExitReasons = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT us."name" AS name, COUNT(*)::int AS value
            FROM users u
            JOIN user_statuses us ON us.user_status_id = u.user_status_id
            WHERE u.user_status_id = ANY(${EXIT_STATUS_IDS})
              AND EXTRACT(YEAR FROM u.updated_at) = EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY us."name"
            ORDER BY value DESC
        `;
        return { success: true, data: rows.map(r => ({ name: r.name, value: Number(r.value) })) };
    } catch (error: any) {
        return serverError(set, 'getExitReasons', error);
    }
};

// 5) การออกจากงานรายเดือน (ปีปัจจุบัน) — zero-fill 12 เดือน
export const getExitMonthly = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT EXTRACT(MONTH FROM updated_at)::int AS month, COUNT(*)::int AS value
            FROM users
            WHERE user_status_id = ANY(${EXIT_STATUS_IDS})
              AND EXTRACT(YEAR FROM updated_at) = EXTRACT(YEAR FROM CURRENT_DATE)
            GROUP BY month
        `;
        const map = new Map<number, number>(rows.map(r => [Number(r.month), Number(r.value)]));
        const data = THAI_MONTHS.map((m, i) => ({ m, value: map.get(i + 1) ?? 0 }));
        return { success: true, data };
    } catch (error: any) {
        return serverError(set, 'getExitMonthly', error);
    }
};

// 6) ช่วงอายุบุคลากร (normalize ปีเกิด พ.ศ./ค.ศ.) — เรียงตามช่วงคงที่
export const getAgeGroups = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT bucket, COUNT(*)::int AS value FROM (
                SELECT CASE
                    WHEN age < 30 THEN '20-29 ปี'
                    WHEN age < 40 THEN '30-39 ปี'
                    WHEN age < 50 THEN '40-49 ปี'
                    WHEN age < 60 THEN '50-59 ปี'
                    ELSE '60+ ปี'
                END AS bucket
                FROM (
                    SELECT (
                        EXTRACT(YEAR FROM CURRENT_DATE)::int -
                        (CASE WHEN EXTRACT(YEAR FROM birthday) > 2200
                              THEN EXTRACT(YEAR FROM birthday) - 543
                              ELSE EXTRACT(YEAR FROM birthday) END)::int
                    ) AS age
                    FROM users
                    WHERE is_active = 'Y' AND birthday IS NOT NULL
                ) a
            ) b
            GROUP BY bucket
        `;
        const order = ['20-29 ปี', '30-39 ปี', '40-49 ปี', '50-59 ปี', '60+ ปี'];
        const map = new Map<string, number>(rows.map(r => [r.bucket as string, Number(r.value)]));
        const data = order.map(name => ({ name, value: map.get(name) ?? 0 }));
        return { success: true, data };
    } catch (error: any) {
        return serverError(set, 'getAgeGroups', error);
    }
};

// 7) เพศ (M → ชาย, F → หญิง)
export const getGenders = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT gender, COUNT(*)::int AS value
            FROM users
            WHERE is_active = 'Y' AND gender IN ('M', 'F')
            GROUP BY gender
        `;
        const map = new Map<string, number>(rows.map(r => [r.gender as string, Number(r.value)]));
        const data = [
            { name: 'หญิง', value: map.get('F') ?? 0 },
            { name: 'ชาย', value: map.get('M') ?? 0 },
        ];
        return { success: true, data };
    } catch (error: any) {
        return serverError(set, 'getGenders', error);
    }
};

// 8) กลุ่มภารกิจ
export const getMissionGroups = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT COALESCE(m."name", 'ไม่ระบุ') AS name, COUNT(*)::int AS value
            FROM users u
            LEFT JOIN missions m ON m.mission_id = u.mission_id
            WHERE u.is_active = 'Y'
            GROUP BY m."name"
            ORDER BY value DESC
        `;
        return { success: true, data: rows.map(r => ({ name: r.name, value: Number(r.value) })) };
    } catch (error: any) {
        return serverError(set, 'getMissionGroups', error);
    }
};
