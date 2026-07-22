import { core_kon } from '../db/db';

const THAI_DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
const MONTH_LABELS = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];

const fyToRange = (fy: number) => {
    const ce = fy - 543;
    return { start: `${ce - 1}-10-01`, end: `${ce}-09-30` };
};

const fmtDateTh = (d: any): string | null => {
    if (!d) return null;
    const [y, m, day] = String(d).substring(0, 10).split('-');
    return `${day}/${m}/${y}`;
};

const parseTimeToMinutes = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
};

// 1) GET /master
export const getActivityMaster = async ({ set }: any) => {
    try {
        const [staff, types, systems, statuses, priorities, sources] = await Promise.all([
            core_kon`SELECT staff_id, staff_code, full_name_th, role_th FROM it_activity_staff WHERE is_active = 'Y' ORDER BY staff_id`,
            core_kon`SELECT type_id, type_code, type_name_th, nature, color_hint FROM it_activity_types WHERE is_active = 'Y' ORDER BY sort_order`,
            core_kon`SELECT system_id, system_code, system_name_th FROM it_activity_systems WHERE is_active = 'Y' ORDER BY sort_order`,
            core_kon`SELECT status_code, status_name_th, color_hex, is_closed, sort_order FROM it_activity_statuses ORDER BY sort_order`,
            core_kon`SELECT priority_code, priority_name_th, color_hex FROM it_activity_priorities ORDER BY sort_order`,
            core_kon`SELECT source_code, source_name_th, is_planned FROM it_activity_request_sources ORDER BY sort_order`,
        ]);
        return {
            success: true,
            data: {
                staff, types, systems, statuses, priorities,
                request_sources: sources,
                config: { day_start_hour: 8, day_end_hour: 17 },
            },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 2) GET /logs
export const getActivityLogs = async ({ query, set }: any) => {
    try {
        const page = Math.max(1, Number(query?.page) || 1);
        // เพดานสูงพอให้ดึงข้อมูลทั้งปีงบมาสรุป Dashboard ฝั่ง client ได้ (เดิม 200 ทำให้เห็นแค่เดือนล่าสุด)
        const limit = Math.min(20000, Math.max(1, Number(query?.limit) || 50));
        const offset = (page - 1) * limit;

        let start: string | null = query?.date_from || null;
        let end: string | null = query?.date_to || null;
        if (query?.fiscal_year) {
            const range = fyToRange(Number(query.fiscal_year));
            start = range.start;
            end = range.end;
        }

        const staffId = query?.staff_id ? Number(query.staff_id) : null;
        const typeCode = query?.type_code || null;
        const systemCode = query?.system_code || null;
        const statusCode = query?.status_code || null;
        const priority = query?.priority || null;
        const source = query?.source || null;
        const search = query?.search || null;
        const isOvertime = query?.is_overtime === 'true' ? true : query?.is_overtime === 'false' ? false : null;
        const isClosed = query?.is_closed === 'true' ? true : query?.is_closed === 'false' ? false : null;

        const rows = await core_kon`
            SELECT * FROM it_activity_log_summary
            WHERE 1=1
            ${start ? core_kon`AND log_date >= ${start}::date` : core_kon``}
            ${end ? core_kon`AND log_date <= ${end}::date` : core_kon``}
            ${staffId ? core_kon`AND staff_id = ${staffId}` : core_kon``}
            ${typeCode ? core_kon`AND type_code = ${typeCode}` : core_kon``}
            ${systemCode ? core_kon`AND system_code = ${systemCode}` : core_kon``}
            ${statusCode ? core_kon`AND status_code = ${statusCode}` : core_kon``}
            ${priority ? core_kon`AND priority_code = ${priority}` : core_kon``}
            ${source ? core_kon`AND source_code = ${source}` : core_kon``}
            ${isOvertime !== null ? core_kon`AND is_overtime = ${isOvertime}` : core_kon``}
            ${isClosed !== null ? core_kon`AND is_closed = ${isClosed}` : core_kon``}
            ${search ? core_kon`AND (
                detail ILIKE ${'%' + search + '%'}
                OR COALESCE(outcome, '') ILIKE ${'%' + search + '%'}
                OR staff_name ILIKE ${'%' + search + '%'}
                OR COALESCE(asset_code, '') ILIKE ${'%' + search + '%'}
                OR COALESCE(ticket_id, '') ILIKE ${'%' + search + '%'}
                OR COALESCE(location, '') ILIKE ${'%' + search + '%'}
            )` : core_kon``}
            ORDER BY log_date DESC, start_time ASC
            LIMIT ${limit} OFFSET ${offset}
        `;

        const [countRow] = await core_kon`
            SELECT COUNT(*) AS total FROM it_activity_log_summary
            WHERE 1=1
            ${start ? core_kon`AND log_date >= ${start}::date` : core_kon``}
            ${end ? core_kon`AND log_date <= ${end}::date` : core_kon``}
            ${staffId ? core_kon`AND staff_id = ${staffId}` : core_kon``}
            ${typeCode ? core_kon`AND type_code = ${typeCode}` : core_kon``}
            ${systemCode ? core_kon`AND system_code = ${systemCode}` : core_kon``}
            ${statusCode ? core_kon`AND status_code = ${statusCode}` : core_kon``}
            ${priority ? core_kon`AND priority_code = ${priority}` : core_kon``}
            ${source ? core_kon`AND source_code = ${source}` : core_kon``}
            ${isOvertime !== null ? core_kon`AND is_overtime = ${isOvertime}` : core_kon``}
            ${isClosed !== null ? core_kon`AND is_closed = ${isClosed}` : core_kon``}
            ${search ? core_kon`AND (
                detail ILIKE ${'%' + search + '%'}
                OR COALESCE(outcome, '') ILIKE ${'%' + search + '%'}
                OR staff_name ILIKE ${'%' + search + '%'}
                OR COALESCE(asset_code, '') ILIKE ${'%' + search + '%'}
                OR COALESCE(ticket_id, '') ILIKE ${'%' + search + '%'}
                OR COALESCE(location, '') ILIKE ${'%' + search + '%'}
            )` : core_kon``}
        `;

        const total = Number(countRow.total);
        return {
            success: true,
            data: (rows as any[]).map((r) => ({
                ...r,
                duration_hours: r.duration_hours != null ? Number(r.duration_hours) : null,
                hours_used: r.hours_used != null ? Number(r.hours_used) : null,
                affected_users: r.affected_users != null ? Number(r.affected_users) : null,
            })),
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 3) POST /logs
export const createActivityLog = async ({ body, set }: any) => {
    try {
        const {
            log_date, staff_id, type_code, system_code, status_code,
            start_time, end_time, minutes_used, detail,
            outcome = null, priority_code = 'normal', source_code = 'other',
            location = null, asset_code = null, affected_users = 1,
            is_overtime = false, ticket_id = null,
        } = body;

        const startMin = parseTimeToMinutes(start_time);
        const endMin = parseTimeToMinutes(end_time);
        if (endMin <= startMin) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'end_time ต้องมากกว่า start_time', field: 'end_time' } };
        }

        const [[typeRow], [systemRow]] = await Promise.all([
            core_kon`SELECT type_id FROM it_activity_types WHERE type_code = ${type_code}`,
            core_kon`SELECT system_id FROM it_activity_systems WHERE system_code = ${system_code}`,
        ]);
        if (!typeRow) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'type_code ไม่พบ', field: 'type_code' } };
        }
        if (!systemRow) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'system_code ไม่พบ', field: 'system_code' } };
        }

        const [log] = await core_kon`
            INSERT INTO it_activity_logs
                (log_date, staff_id, type_id, system_id, status_code,
                 start_time, end_time, minutes_used, detail, outcome,
                 priority_code, source_code, location, asset_code,
                 affected_users, is_overtime, ticket_id)
            VALUES
                (${log_date}::date, ${staff_id}, ${typeRow.type_id}, ${systemRow.system_id}, ${status_code},
                 ${start_time}::time, ${end_time}::time, ${minutes_used}, ${detail}, ${outcome},
                 ${priority_code}, ${source_code}, ${location}, ${asset_code},
                 ${affected_users}, ${is_overtime}, ${ticket_id})
            RETURNING log_id, log_date, duration_hours, hours_used, created_at
        `;

        set.status = 201;
        return {
            success: true,
            data: {
                log_id: log.log_id,
                log_date: String(log.log_date).substring(0, 10),
                duration_hours: log.duration_hours != null ? Number(log.duration_hours) : (endMin - startMin) / 60,
                hours_used: log.hours_used != null ? Number(log.hours_used) : Number(minutes_used) / 60,
                created_at: log.created_at,
            },
        };
    } catch (error: any) {
        if (error.code === '23505') {
            set.status = 409;
            return { success: false, error: { code: 'CONFLICT', message: 'ticket_id ซ้ำ', field: 'ticket_id' } };
        }
        if (error.code === '23503') {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'FK ไม่พบ (staff_id, type_code, system_code หรือ status_code)' } };
        }
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 4) GET /logs/:id
export const getActivityLogById = async ({ params, set }: any) => {
    try {
        const id = Number(params.id);
        const [row] = await core_kon`
            SELECT * FROM it_activity_log_summary WHERE log_id = ${id}
        `;
        if (!row) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบกิจกรรม' } };
        }
        return {
            success: true,
            data: {
                ...row,
                duration_hours: row.duration_hours != null ? Number(row.duration_hours) : null,
                hours_used: row.hours_used != null ? Number(row.hours_used) : null,
            },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 5) PUT /logs/:id  (PATCH semantics — only update provided fields)
export const updateActivityLog = async ({ params, body, set }: any) => {
    try {
        const id = Number(params.id);
        const {
            log_date, staff_id, type_code, system_code, status_code,
            start_time, end_time, minutes_used, detail,
            outcome, priority_code, source_code,
            location, asset_code, affected_users, is_overtime, ticket_id,
        } = body;

        if (start_time !== undefined && end_time !== undefined) {
            if (parseTimeToMinutes(end_time) <= parseTimeToMinutes(start_time)) {
                set.status = 400;
                return { success: false, error: { code: 'VALIDATION_ERROR', message: 'end_time ต้องมากกว่า start_time', field: 'end_time' } };
            }
        }

        const updates: Record<string, any> = {};
        if (log_date !== undefined)   updates.log_date    = log_date;
        if (staff_id !== undefined)   updates.staff_id    = staff_id;
        if (status_code !== undefined) updates.status_code = status_code;

        if (type_code !== undefined) {
            const [typeRow] = await core_kon`SELECT type_id FROM it_activity_types WHERE type_code = ${type_code}`;
            if (!typeRow) {
                set.status = 404;
                return { success: false, error: { code: 'NOT_FOUND', message: 'type_code ไม่พบ', field: 'type_code' } };
            }
            updates.type_id = typeRow.type_id;
        }
        if (system_code !== undefined) {
            const [systemRow] = await core_kon`SELECT system_id FROM it_activity_systems WHERE system_code = ${system_code}`;
            if (!systemRow) {
                set.status = 404;
                return { success: false, error: { code: 'NOT_FOUND', message: 'system_code ไม่พบ', field: 'system_code' } };
            }
            updates.system_id = systemRow.system_id;
        }
        if (start_time !== undefined)    updates.start_time     = start_time;
        if (end_time !== undefined)      updates.end_time       = end_time;
        if (minutes_used !== undefined)  updates.minutes_used   = minutes_used;
        if (detail !== undefined)        updates.detail         = detail;
        if (outcome !== undefined)       updates.outcome        = outcome;
        if (priority_code !== undefined) updates.priority_code  = priority_code;
        if (source_code !== undefined)   updates.source_code    = source_code;
        if (location !== undefined)      updates.location       = location;
        if (asset_code !== undefined)    updates.asset_code     = asset_code;
        if (affected_users !== undefined) updates.affected_users = affected_users;
        if (is_overtime !== undefined)   updates.is_overtime    = is_overtime;
        if (ticket_id !== undefined)     updates.ticket_id      = ticket_id;

        if (Object.keys(updates).length === 0) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'ไม่มี field ที่ต้องการแก้ไข' } };
        }

        const [updated] = await core_kon`
            UPDATE it_activity_logs
            SET ${core_kon(updates)}, updated_at = NOW()
            WHERE log_id = ${id}
            RETURNING log_id, updated_at
        `;

        if (!updated) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบกิจกรรม' } };
        }

        return { success: true, data: updated };
    } catch (error: any) {
        if (error.code === '23503') {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'FK ไม่พบ' } };
        }
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 6) DELETE /logs/:id
export const deleteActivityLog = async ({ params, set }: any) => {
    try {
        const id = Number(params.id);
        const [deleted] = await core_kon`
            DELETE FROM it_activity_logs WHERE log_id = ${id} RETURNING log_id
        `;
        if (!deleted) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบกิจกรรม' } };
        }
        return { success: true, data: { log_id: id } };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 7) GET /daily
export const getDailySchedule = async ({ query, set }: any) => {
    try {
        const date: string = query?.date;
        if (!date) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'date is required', field: 'date' } };
        }

        const staffId = query?.staff_id ? Number(query.staff_id) : null;
        const dow = new Date(date).getDay();

        const rows = await core_kon`
            SELECT
                l.log_id, l.staff_id, s.full_name_th AS staff_name,
                t.type_name_th, t.color_hint AS type_color,
                l.status_code, st.color_hex AS status_color,
                l.priority_code, l.is_overtime,
                EXTRACT(HOUR FROM l.start_time)::int AS start_hour,
                EXTRACT(HOUR FROM l.end_time)::int AS end_hour,
                l.minutes_used,
                LEFT(l.detail, 80) AS detail
            FROM it_activity_logs l
            JOIN it_activity_staff s ON s.staff_id = l.staff_id
            JOIN it_activity_types t ON t.type_id = l.type_id
            JOIN it_activity_statuses st ON st.status_code = l.status_code
            WHERE l.log_date = ${date}::date
            ${staffId ? core_kon`AND l.staff_id = ${staffId}` : core_kon``}
            ORDER BY s.staff_id, l.start_time
        `;

        const staffMap = new Map<number, any>();
        for (const r of rows as any[]) {
            if (!staffMap.has(r.staff_id)) {
                staffMap.set(r.staff_id, {
                    staff_id: r.staff_id,
                    staff_name: r.staff_name,
                    total_minutes: 0,
                    task_count: 0,
                    tasks: [],
                });
            }
            const entry = staffMap.get(r.staff_id);
            entry.total_minutes += Number(r.minutes_used) || 0;
            entry.task_count += 1;
            entry.tasks.push({
                log_id: r.log_id,
                type_name_th: r.type_name_th,
                type_color: r.type_color,
                status_code: r.status_code,
                status_color: r.status_color,
                priority_code: r.priority_code,
                is_overtime: r.is_overtime,
                start_hour: Number(r.start_hour),
                end_hour: Number(r.end_hour),
                minutes_used: Number(r.minutes_used),
                detail: r.detail,
            });
        }

        const slots = Array.from({ length: 9 }, (_, i) => ({
            hour: i + 8,
            label: `${String(i + 8).padStart(2, '0')}:00`,
        }));

        return {
            success: true,
            data: {
                date,
                date_th: fmtDateTh(date),
                day_of_week_th: THAI_DAYS[dow],
                slots,
                rows: [...staffMap.values()],
            },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// 8) GET /dashboard
export const getActivityDashboard = async ({ query, set }: any) => {
    try {
        const fy = Number(query?.fiscal_year);
        if (!fy) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'fiscal_year is required', field: 'fiscal_year' } };
        }

        const { start, end } = fyToRange(fy);
        const staffId = query?.staff_id ? Number(query.staff_id) : null;

        const [
            kpiRows, byType, bySystem, monthlyRaw, natureByMonthRaw,
            staffByStatusRaw, heatmapRaw, byPriority, bySource, topAssets,
        ] = await Promise.all([
            core_kon`
                SELECT
                    COUNT(*)::int AS total_tasks,
                    COALESCE(SUM(minutes_used), 0)::int AS total_minutes,
                    COALESCE(SUM(CASE WHEN is_closed THEN 1 ELSE 0 END), 0)::int AS closed_tasks,
                    COALESCE(SUM(CASE WHEN NOT is_closed THEN 1 ELSE 0 END), 0)::int AS open_tasks,
                    COALESCE(SUM(CASE WHEN is_overtime THEN 1 ELSE 0 END), 0)::int AS overtime_tasks,
                    COALESCE(SUM(CASE WHEN activity_nature = 'reactive'  THEN minutes_used ELSE 0 END), 0)::int AS reactive_minutes,
                    COALESCE(SUM(CASE WHEN activity_nature = 'proactive' THEN minutes_used ELSE 0 END), 0)::int AS proactive_minutes,
                    COALESCE(SUM(CASE WHEN activity_nature NOT IN ('reactive','proactive') THEN minutes_used ELSE 0 END), 0)::int AS neutral_minutes
                FROM it_activity_log_summary
                WHERE log_date BETWEEN ${start}::date AND ${end}::date
                ${staffId ? core_kon`AND staff_id = ${staffId}` : core_kon``}
            `,
            core_kon`
                SELECT t.type_code, t.type_name_th,
                    COUNT(*)::int AS task_count,
                    COALESCE(SUM(l.minutes_used), 0)::int AS minutes
                FROM it_activity_logs l
                JOIN it_activity_types t ON t.type_id = l.type_id
                WHERE l.log_date BETWEEN ${start}::date AND ${end}::date
                ${staffId ? core_kon`AND l.staff_id = ${staffId}` : core_kon``}
                GROUP BY t.type_code, t.type_name_th
                ORDER BY task_count DESC
            `,
            core_kon`
                SELECT sys.system_code, sys.system_name_th,
                    COUNT(*)::int AS task_count,
                    COALESCE(SUM(l.minutes_used), 0)::int AS minutes
                FROM it_activity_logs l
                JOIN it_activity_systems sys ON sys.system_id = l.system_id
                WHERE l.log_date BETWEEN ${start}::date AND ${end}::date
                ${staffId ? core_kon`AND l.staff_id = ${staffId}` : core_kon``}
                GROUP BY sys.system_code, sys.system_name_th
                ORDER BY task_count DESC
            `,
            core_kon`
                SELECT
                    CASE WHEN EXTRACT(MONTH FROM log_date) >= 10
                         THEN EXTRACT(MONTH FROM log_date)::int - 10
                         ELSE EXTRACT(MONTH FROM log_date)::int + 2
                    END AS month_idx,
                    EXTRACT(YEAR FROM log_date)::int + 543 AS year_be,
                    COALESCE(SUM(minutes_used), 0)::int AS total_minutes,
                    COALESCE(SUM(CASE WHEN activity_nature = 'reactive' THEN minutes_used ELSE 0 END), 0)::int AS reactive_minutes
                FROM it_activity_log_summary
                WHERE log_date BETWEEN ${start}::date AND ${end}::date
                ${staffId ? core_kon`AND staff_id = ${staffId}` : core_kon``}
                GROUP BY month_idx, year_be
                ORDER BY month_idx
            `,
            core_kon`
                SELECT
                    CASE WHEN EXTRACT(MONTH FROM log_date) >= 10
                         THEN EXTRACT(MONTH FROM log_date)::int - 10
                         ELSE EXTRACT(MONTH FROM log_date)::int + 2
                    END AS month_idx,
                    COALESCE(SUM(CASE WHEN activity_nature = 'reactive'  THEN minutes_used ELSE 0 END), 0)::int AS reactive,
                    COALESCE(SUM(CASE WHEN activity_nature = 'proactive' THEN minutes_used ELSE 0 END), 0)::int AS proactive,
                    COALESCE(SUM(CASE WHEN activity_nature NOT IN ('reactive','proactive') THEN minutes_used ELSE 0 END), 0)::int AS neutral
                FROM it_activity_log_summary
                WHERE log_date BETWEEN ${start}::date AND ${end}::date
                ${staffId ? core_kon`AND staff_id = ${staffId}` : core_kon``}
                GROUP BY month_idx
                ORDER BY month_idx
            `,
            core_kon`
                SELECT s.full_name_th AS staff_name, l.status_code, COUNT(*)::int AS cnt
                FROM it_activity_logs l
                JOIN it_activity_staff s ON s.staff_id = l.staff_id
                WHERE l.log_date BETWEEN ${start}::date AND ${end}::date
                ${staffId ? core_kon`AND l.staff_id = ${staffId}` : core_kon``}
                GROUP BY s.full_name_th, l.status_code
                ORDER BY s.full_name_th, l.status_code
            `,
            core_kon`
                SELECT
                    EXTRACT(DOW FROM log_date)::int AS dow,
                    EXTRACT(HOUR FROM start_time)::int AS hour,
                    COUNT(*)::int AS count
                FROM it_activity_logs
                WHERE log_date BETWEEN ${start}::date AND ${end}::date
                ${staffId ? core_kon`AND staff_id = ${staffId}` : core_kon``}
                GROUP BY dow, hour
                ORDER BY dow, hour
            `,
            core_kon`
                SELECT p.priority_code, p.priority_name_th,
                    COUNT(*)::int AS task_count,
                    COALESCE(SUM(l.minutes_used), 0)::int AS minutes
                FROM it_activity_logs l
                JOIN it_activity_priorities p ON p.priority_code = l.priority_code
                WHERE l.log_date BETWEEN ${start}::date AND ${end}::date
                ${staffId ? core_kon`AND l.staff_id = ${staffId}` : core_kon``}
                GROUP BY p.priority_code, p.priority_name_th
                ORDER BY task_count DESC
            `,
            core_kon`
                SELECT rs.source_code, rs.source_name_th, rs.is_planned,
                    COUNT(*)::int AS task_count,
                    COALESCE(SUM(l.minutes_used), 0)::int AS minutes
                FROM it_activity_logs l
                JOIN it_activity_request_sources rs ON rs.source_code = l.source_code
                WHERE l.log_date BETWEEN ${start}::date AND ${end}::date
                ${staffId ? core_kon`AND l.staff_id = ${staffId}` : core_kon``}
                GROUP BY rs.source_code, rs.source_name_th, rs.is_planned
                ORDER BY task_count DESC
            `,
            core_kon`
                SELECT asset_code, COUNT(*)::int AS repair_count,
                    COALESCE(SUM(minutes_used), 0)::int AS minutes
                FROM it_activity_logs
                WHERE log_date BETWEEN ${start}::date AND ${end}::date
                AND asset_code IS NOT NULL AND asset_code <> ''
                ${staffId ? core_kon`AND staff_id = ${staffId}` : core_kon``}
                GROUP BY asset_code
                ORDER BY repair_count DESC, minutes DESC
                LIMIT 10
            `,
        ]);

        const k = kpiRows[0] || {} as any;
        const totalMin = Number(k.total_minutes) || 0;
        const reactiveMin = Number(k.reactive_minutes) || 0;
        const proactiveMin = Number(k.proactive_minutes) || 0;
        const neutralMin = Number(k.neutral_minutes) || 0;
        const pctBase = (reactiveMin + proactiveMin + neutralMin) || 1;

        const kpi = {
            total_tasks:    Number(k.total_tasks) || 0,
            total_minutes:  totalMin,
            total_hours:    Math.round((totalMin / 60) * 10) / 10,
            closed_tasks:   Number(k.closed_tasks) || 0,
            open_tasks:     Number(k.open_tasks) || 0,
            overtime_tasks: Number(k.overtime_tasks) || 0,
            reactive_pct:   Math.round((reactiveMin  / pctBase) * 1000) / 10,
            proactive_pct:  Math.round((proactiveMin / pctBase) * 1000) / 10,
            neutral_pct:    Math.round((neutralMin   / pctBase) * 1000) / 10,
        };

        // Pivot staff_by_status
        const staffStatusMap = new Map<string, any>();
        for (const r of staffByStatusRaw as any[]) {
            if (!staffStatusMap.has(r.staff_name)) {
                staffStatusMap.set(r.staff_name, { staff_name: r.staff_name, done: 0, in_progress: 0, waiting: 0, pending: 0 });
            }
            const entry = staffStatusMap.get(r.staff_name);
            if (r.status_code in entry) entry[r.status_code] = Number(r.cnt);
        }

        // Source summary
        const totalSrcTasks = (bySource as any[]).reduce((a, r) => a + Number(r.task_count), 0) || 1;
        const plannedTasks = (bySource as any[]).filter((r: any) => r.is_planned).reduce((a, r) => a + Number(r.task_count), 0);
        const sourceSummary = {
            planned_pct:   Math.round((plannedTasks / totalSrcTasks) * 1000) / 10,
            interrupt_pct: Math.round(((totalSrcTasks - plannedTasks) / totalSrcTasks) * 1000) / 10,
        };

        const monthlyTrend = (monthlyRaw as any[]).map((r: any) => ({
            month_idx:        Number(r.month_idx),
            month_label:      MONTH_LABELS[Number(r.month_idx)] ?? '',
            year_be:          Number(r.year_be),
            total_minutes:    Number(r.total_minutes),
            reactive_minutes: Number(r.reactive_minutes),
        }));

        return {
            success: true,
            data: {
                fiscal_year: fy,
                period: { start, end },
                kpi,
                by_type:          byType,
                by_system:        bySystem,
                monthly_trend:    monthlyTrend,
                nature_by_month:  natureByMonthRaw,
                staff_by_status:  [...staffStatusMap.values()],
                slot_heatmap:     heatmapRaw,
                by_priority:      byPriority,
                by_source:        bySource,
                source_summary:   sourceSummary,
                top_assets:       topAssets,
            },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};
