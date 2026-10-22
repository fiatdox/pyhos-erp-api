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

// 9) ข้อมูลรายบุคคลแบบไม่ระบุตัวตน — สำหรับ dashboard เชิงลึกที่กรอง/เจาะลึกตามหน่วยงานได้ทันทีที่หน้าเว็บ
//    บุคลากรทั้งหมด ~1,300 คน เล็กพอส่งทีเดียว แล้วให้หน้าเว็บสรุปตามตัวกรองเอง ไม่ต้องยิง API ทุกครั้งที่เปลี่ยน
//    ไม่ส่งชื่อ เลขบัตร หรือวันเกิด — ส่งแค่รหัสหน่วยงาน/ประเภท/ตำแหน่ง เพศ อายุ (ปีเต็ม) และปีงบที่เกษียณ
//    แต่แยกถึงระดับหน่วยงานแล้วหน่วยเล็ก ๆ ก็พอระบุตัวคนได้ route นี้จึงอยู่หลัง requireRoles('ADMIN','HR')
//
//    ปีงบที่ออกจากงาน: ใช้ work_end_date ถ้ามี ไม่มีใช้ updated_at แทน (ed บอกว่ามาจากวันที่จริงหรือไม่)
//    — ข้อมูลเก่าส่วนใหญ่ยังไม่มี work_end_date หน้าเว็บต้องบอกผู้ใช้ว่าตัวเลขรายปีเชื่อได้แค่ไหน
// อายุที่คำนวณได้นอกช่วงนี้ถือว่าวันเกิดบันทึกผิด (เจอทั้งอายุ 0 ปี) — ไม่เอามาคิดอายุ/เกษียณ
const PLAUSIBLE_AGE = { min: 18, max: 70 };

/** ปีงบประมาณ (พ.ศ.) ของวันที่ — ต.ค.–ธ.ค. นับเป็นปีงบถัดไป */
const fiscalYearBE = (d: Date) => d.getFullYear() + (d.getMonth() >= 9 ? 1 : 0) + 543;

export const getHrPeople = async ({ set }: any) => {
    try {
        const [rows, missions, majors, submajors, types, positions, levels, statuses] = await Promise.all([
            core_kon`
                WITH p AS (
                    SELECT u.*,
                        -- ปีเกิดปน พ.ศ./ค.ศ. — แปลงเป็น ค.ศ. ก่อนคำนวณ
                        CASE WHEN EXTRACT(YEAR FROM u.birthday) > 2200
                             THEN (u.birthday - INTERVAL '543 years')::date ELSE u.birthday::date END AS bd,
                        COALESCE(u.work_end_date::date, u.updated_at::date) AS exit_date
                    FROM users u
                    WHERE u.is_active = 'Y' OR u.user_status_id = ANY(${EXIT_STATUS_IDS})
                )
                SELECT
                    mission_id AS m, major_id AS w, submajor_id AS u,
                    user_type_id AS t, user_position_id AS p, user_level_id AS l, user_status_id AS s,
                    (is_active = 'Y') AS a, gender AS g,
                    date_part('year', age(CURRENT_DATE, bd))::int AS age,
                    -- เกษียณ ณ สิ้นปีงบที่อายุครบ 60 ปีบริบูรณ์ ซึ่งครบในวันก่อนวันเกิด
                    -- (เกิด 1 ต.ค. ครบ 30 ก.ย. เกษียณปีงบนั้น / เกิด 2 ต.ค. ไปเกษียณปีงบถัดไป)
                    (EXTRACT(YEAR FROM (bd + INTERVAL '60 years' - INTERVAL '1 day'))
                      + CASE WHEN EXTRACT(MONTH FROM (bd + INTERVAL '60 years' - INTERVAL '1 day')) >= 10 THEN 1 ELSE 0 END
                      + 543)::int AS retire_fy,
                    (hire_date IS NOT NULL) AS h,
                    CASE WHEN user_status_id = ANY(${EXIT_STATUS_IDS}) THEN
                        (EXTRACT(YEAR FROM exit_date) + CASE WHEN EXTRACT(MONTH FROM exit_date) >= 10 THEN 1 ELSE 0 END + 543)::int
                    END AS exit_fy,
                    (work_end_date IS NOT NULL) AS ed
                FROM p
            `,
            core_kon`SELECT mission_id AS id, "name" FROM missions ORDER BY mission_id`,
            core_kon`SELECT major_id AS id, "name", mission_id AS parent FROM majors ORDER BY major_id`,
            core_kon`SELECT submajor_id AS id, "name", major_id AS parent FROM submajors ORDER BY submajor_id`,
            core_kon`SELECT user_type_id AS id, type_name AS "name" FROM user_types ORDER BY user_type_id`,
            core_kon`SELECT user_position_id AS id, position_name AS "name" FROM user_positions`,
            core_kon`SELECT user_level_id AS id, level_name AS "name" FROM user_levels`,
            core_kon`SELECT user_status_id AS id, "name" FROM user_statuses ORDER BY user_status_id`,
        ]);

        const people = rows.map((r: any) => {
            const age = r.age == null ? null : Number(r.age);
            const plausible = age != null && age >= PLAUSIBLE_AGE.min && age <= PLAUSIBLE_AGE.max;
            return {
                m: r.m, w: r.w, u: r.u, t: r.t, p: r.p, l: r.l, s: r.s,
                a: r.a === true, g: r.g === 'F' || r.g === 'M' ? r.g : null,
                age: plausible ? age : null,
                retire_fy: plausible ? Number(r.retire_fy) : null,
                // วันเกิด: 0 = ไม่มี, 1 = ใช้ได้, 2 = มีแต่ผิดปกติ
                bd: age == null ? 0 : plausible ? 1 : 2,
                h: r.h === true,
                exit_fy: r.exit_fy == null ? null : Number(r.exit_fy),
                ed: r.ed === true,
            };
        });
        const named = (list: any[]) => list.map(r => ({
            id: Number(r.id), name: String(r.name ?? '').trim(),
            ...(r.parent !== undefined ? { parent: r.parent == null ? null : Number(r.parent) } : {}),
        }));

        const today = new Date();
        return {
            success: true,
            data: {
                people,
                lookups: {
                    missions: named(missions), majors: named(majors), submajors: named(submajors),
                    types: named(types), positions: named(positions), levels: named(levels), statuses: named(statuses),
                },
                exit_status_ids: EXIT_STATUS_IDS,
                current_fy: fiscalYearBE(today),
                as_of: today.toLocaleDateString('sv-SE'),
            },
        };
    } catch (error: any) {
        return serverError(set, 'getHrPeople', error);
    }
};

// 10) รายชื่อบุคลากรปัจจุบันที่ข้อมูลอายุต้องแก้ — ให้ HR เปิดแก้ทีละคนได้จาก dashboard
//     overdue = เลยปีงบเกษียณแล้วแต่ยัง is_active = 'Y' (สถานะ หรือวันเกิด อย่างใดอย่างหนึ่งผิด)
//     implausible = วันเกิดที่คำนวณอายุได้นอกช่วง PLAUSIBLE_AGE (เช่นบันทึกปีผิด)
//     ส่งชื่อและวันเกิดด้วย route นี้จึงอยู่หลัง requireRoles('ADMIN','HR') เหมือน /dashboard/people
export const getHrAgeIssues = async ({ set }: any) => {
    try {
        const currentFy = fiscalYearBE(new Date());
        const rows = await core_kon`
            WITH p AS (
                SELECT u.*,
                    CASE WHEN EXTRACT(YEAR FROM u.birthday) > 2200
                         THEN (u.birthday - INTERVAL '543 years')::date ELSE u.birthday::date END AS bd
                FROM users u
                WHERE u.is_active = 'Y' AND u.birthday IS NOT NULL
            )
            SELECT
                id, CONCAT(COALESCE(pname, ''), fname, ' ', lname) AS name,
                mission_id AS m, major_id AS w, submajor_id AS u,
                user_type_id AS t, user_position_id AS p, user_status_id AS s,
                to_char(bd, 'YYYY-MM-DD') AS birthday,
                date_part('year', age(CURRENT_DATE, bd))::int AS age,
                (EXTRACT(YEAR FROM (bd + INTERVAL '60 years' - INTERVAL '1 day'))
                  + CASE WHEN EXTRACT(MONTH FROM (bd + INTERVAL '60 years' - INTERVAL '1 day')) >= 10 THEN 1 ELSE 0 END
                  + 543)::int AS retire_fy
            FROM p
        `;

        const issues = rows.flatMap((r: any) => {
            const age = Number(r.age);
            const plausible = age >= PLAUSIBLE_AGE.min && age <= PLAUSIBLE_AGE.max;
            const issue = !plausible ? 'implausible' : Number(r.retire_fy) < currentFy ? 'overdue' : null;
            if (!issue) return [];
            return [{
                id: r.id, name: String(r.name ?? '').trim(),
                m: r.m, w: r.w, u: r.u, t: r.t, p: r.p, s: r.s,
                birthday: r.birthday, age, retire_fy: plausible ? Number(r.retire_fy) : null, issue,
            }];
        }).sort((a: any, b: any) => b.age - a.age);

        return { success: true, data: { issues, current_fy: currentFy, age_range: PLAUSIBLE_AGE } };
    } catch (error: any) {
        return serverError(set, 'getHrAgeIssues', error);
    }
};
