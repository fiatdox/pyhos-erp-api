import { core_kon } from '../db/db';

const THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

const monthLabelTh = (month: string): string => {
    const [y, m] = month.split('-').map(Number);
    return `${THAI_MONTHS[m - 1]} ${y + 543}`;
};

const monthToRange = (month: string): { start: string; end: string } => {
    const [y, m] = month.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const end = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    return { start, end };
};

const nextIncidentNo = async (year: number): Promise<string> => {
    const [row] = await core_kon`
        SELECT COALESCE(MAX(CAST(SPLIT_PART(incident_no, '-', 3) AS INTEGER)), 0) AS max_seq
        FROM it_incident_report
        WHERE EXTRACT(YEAR FROM incident_date) = ${year}
    `;
    const seq = (Number(row.max_seq) + 1).toString().padStart(3, '0');
    return `INC-${year}-${seq}`;
};

// ────────────────────────────────────────────────────────────────
// 1) GET /master
// ────────────────────────────────────────────────────────────────
export const getIncidentMaster = async ({ set }: any) => {
    try {
        const [threatTypes, attackVectors, affectedSystems] = await Promise.all([
            core_kon`
                SELECT id, threat_code, name_th AS label, ncsa_category, severity_hint
                FROM it_threat_type
                WHERE is_active = TRUE
                ORDER BY sort_order
            `,
            core_kon`
                SELECT id, vector_code, name_th AS label, vector_category
                FROM it_attack_vector
                WHERE is_active = TRUE
                ORDER BY sort_order
            `,
            core_kon`
                SELECT id, system_code, name_th AS label, system_category, criticality
                FROM it_affected_system
                WHERE is_active = TRUE
                ORDER BY sort_order
            `,
        ]);

        return {
            success: true,
            data: {
                threat_types: threatTypes,
                attack_vectors: attackVectors,
                severities: [
                    { value: 'critical', label: 'วิกฤต (Critical) - ระดับ 4', color: '#dc2626' },
                    { value: 'high',     label: 'สูง (High) - ระดับ 3',       color: '#ea580c' },
                    { value: 'medium',   label: 'กลาง (Medium) - ระดับ 2',    color: '#ca8a04' },
                    { value: 'low',      label: 'ต่ำ (Low) - ระดับ 1',        color: '#16a34a' },
                ],
                statuses: [
                    { value: 'open',        label: 'เปิด (รายงานใหม่)',  color: '#ef4444' },
                    { value: 'in_progress', label: 'กำลังดำเนินการ',      color: '#f59e0b' },
                    { value: 'resolved',    label: 'แก้ไขแล้ว (รอปิด)',   color: '#3b82f6' },
                    { value: 'closed',      label: 'ปิดเคส',              color: '#22c55e' },
                ],
                affected_systems: affectedSystems,
            },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 2) GET /   (list + filter + pagination)
// ────────────────────────────────────────────────────────────────
export const getIncidents = async ({ query, set }: any) => {
    try {
        const page  = Math.max(1, Number(query?.page)  || 1);
        const limit = Math.min(200, Math.max(1, Number(query?.limit) || 50));
        const offset = (page - 1) * limit;

        let start: string | null = query?.date_from || null;
        let end:   string | null = query?.date_to   || null;
        if (query?.month) {
            const range = monthToRange(query.month);
            start = range.start;
            end   = range.end;
        }

        const status       = query?.status        || null;
        const severity     = query?.severity      || null;
        const threatType   = query?.threat_type   || null;
        const dataBreached = query?.data_breached || null;
        const ncsaReported = query?.ncsa_reported || null;
        const search       = query?.search        || null;

        const rows = await core_kon`
            SELECT
                r.id, r.incident_no,
                r.incident_date::text, r.detected_date::text, r.report_date::text,
                r.reported_by, r.department,
                tt.name_th   AS threat_type,   tt.ncsa_category,
                av.name_th   AS attack_vector,
                asy.name_th  AS affected_system, asy.system_category,
                r.affected_assets, r.description,
                r.severity, r.impact, r.affected_users::int,
                r.data_breached, r.continuity_impact,
                r.root_cause, r.immediate_actions, r.long_term_measures,
                r.resolution, r.resolved_date::text, r.resolved_by, r.status,
                r.ncsa_reported, r.ncsa_report_date::text, r.is_sla_related,
                (r.resolved_date - r.incident_date::date)::int AS mttr_days,
                r.is_active, r.created_by, r.created_at, r.updated_at
            FROM it_incident_report   r
            JOIN it_threat_type       tt  ON r.threat_type_id     = tt.id
            JOIN it_attack_vector     av  ON r.attack_vector_id   = av.id
            JOIN it_affected_system   asy ON r.affected_system_id = asy.id
            WHERE r.is_active = 'Y'
            ${start        ? core_kon`AND r.incident_date >= ${start}::date`  : core_kon``}
            ${end          ? core_kon`AND r.incident_date <= ${end}::date`    : core_kon``}
            ${status       ? core_kon`AND r.status        =  ${status}`       : core_kon``}
            ${severity     ? core_kon`AND r.severity      =  ${severity}`     : core_kon``}
            ${threatType   ? core_kon`AND tt.threat_code  =  ${threatType}`   : core_kon``}
            ${dataBreached ? core_kon`AND r.data_breached =  ${dataBreached}` : core_kon``}
            ${ncsaReported ? core_kon`AND r.ncsa_reported =  ${ncsaReported}` : core_kon``}
            ${search ? core_kon`AND (
                r.incident_no    ILIKE ${'%' + search + '%'}
                OR r.description ILIKE ${'%' + search + '%'}
                OR r.reported_by ILIKE ${'%' + search + '%'}
                OR r.department  ILIKE ${'%' + search + '%'}
                OR asy.name_th   ILIKE ${'%' + search + '%'}
            )` : core_kon``}
            ORDER BY r.incident_date DESC, r.id DESC
            LIMIT ${limit} OFFSET ${offset}
        `;

        const [countRow] = await core_kon`
            SELECT COUNT(*) AS total
            FROM it_incident_report   r
            JOIN it_threat_type       tt  ON r.threat_type_id     = tt.id
            JOIN it_attack_vector     av  ON r.attack_vector_id   = av.id
            JOIN it_affected_system   asy ON r.affected_system_id = asy.id
            WHERE r.is_active = 'Y'
            ${start        ? core_kon`AND r.incident_date >= ${start}::date`  : core_kon``}
            ${end          ? core_kon`AND r.incident_date <= ${end}::date`    : core_kon``}
            ${status       ? core_kon`AND r.status        =  ${status}`       : core_kon``}
            ${severity     ? core_kon`AND r.severity      =  ${severity}`     : core_kon``}
            ${threatType   ? core_kon`AND tt.threat_code  =  ${threatType}`   : core_kon``}
            ${dataBreached ? core_kon`AND r.data_breached =  ${dataBreached}` : core_kon``}
            ${ncsaReported ? core_kon`AND r.ncsa_reported =  ${ncsaReported}` : core_kon``}
            ${search ? core_kon`AND (
                r.incident_no    ILIKE ${'%' + search + '%'}
                OR r.description ILIKE ${'%' + search + '%'}
                OR r.reported_by ILIKE ${'%' + search + '%'}
                OR r.department  ILIKE ${'%' + search + '%'}
                OR asy.name_th   ILIKE ${'%' + search + '%'}
            )` : core_kon``}
        `;

        const total = Number(countRow.total);
        return {
            success: true,
            data: rows,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 3) POST /
// ────────────────────────────────────────────────────────────────
export const createIncident = async ({ body, set }: any) => {
    try {
        const {
            incident_date, detected_date, report_date,
            reported_by, department,
            threat_type_id, attack_vector_id, affected_system_id,
            affected_assets = null, description,
            severity, impact = null, affected_users = 0,
            data_breached, continuity_impact,
            root_cause = null, immediate_actions = null, long_term_measures = null,
            resolution = null, resolved_date = null, resolved_by = null,
            status, ncsa_reported, ncsa_report_date = null, is_sla_related,
        } = body;

        // วันที่ต้องสอดคล้องกัน (incident/detected = TIMESTAMP, report = DATE)
        if (new Date(detected_date) < new Date(incident_date)) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'detected_date ต้องไม่ก่อน incident_date', field: 'detected_date' } };
        }
        if (report_date < detected_date.substring(0, 10)) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'report_date ต้องไม่ก่อน detected_date', field: 'report_date' } };
        }
        if ((status === 'resolved' || status === 'closed') && !resolved_date) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'resolved_date ต้องระบุเมื่อ status เป็น resolved หรือ closed', field: 'resolved_date' } };
        }
        if (ncsa_reported === 'Y' && !ncsa_report_date) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'ncsa_report_date ต้องระบุเมื่อ ncsa_reported เป็น Y', field: 'ncsa_report_date' } };
        }

        const year = Number(incident_date.substring(0, 4));
        const incident_no = await nextIncidentNo(year);

        const [row] = await core_kon`
            INSERT INTO it_incident_report (
                incident_no, incident_date, detected_date, report_date,
                reported_by, department,
                threat_type_id, attack_vector_id, affected_system_id,
                affected_assets, description,
                severity, impact, affected_users,
                data_breached, continuity_impact,
                root_cause, immediate_actions, long_term_measures,
                resolution, resolved_date, resolved_by,
                status, ncsa_reported, ncsa_report_date, is_sla_related
            ) VALUES (
                ${incident_no},
                ${incident_date}::timestamp, ${detected_date}::timestamp, ${report_date}::date,
                ${reported_by}, ${department},
                ${threat_type_id}, ${attack_vector_id}, ${affected_system_id},
                ${affected_assets}, ${description},
                ${severity}, ${impact}, ${affected_users},
                ${data_breached}, ${continuity_impact},
                ${root_cause}, ${immediate_actions}, ${long_term_measures},
                ${resolution},
                ${resolved_date ? core_kon`${resolved_date}::date` : core_kon`NULL`},
                ${resolved_by},
                ${status}, ${ncsa_reported},
                ${ncsa_report_date ? core_kon`${ncsa_report_date}::date` : core_kon`NULL`},
                ${is_sla_related}
            )
            RETURNING id, incident_no, created_at
        `;

        set.status = 201;
        return { success: true, data: row };
    } catch (error: any) {
        if (error.code === '23505') {
            set.status = 409;
            return { success: false, error: { code: 'CONFLICT', message: 'incident_no ซ้ำ', field: 'incident_no' } };
        }
        if (error.code === '23503') {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'threat_type_id, attack_vector_id หรือ affected_system_id ไม่พบ' } };
        }
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 4) GET /:id
// ────────────────────────────────────────────────────────────────
export const getIncidentById = async ({ params, set }: any) => {
    try {
        const id = Number(params.id);
        const [row] = await core_kon`
            SELECT
                r.id, r.incident_no,
                r.incident_date::text, r.detected_date::text, r.report_date::text,
                r.reported_by, r.department,
                tt.name_th   AS threat_type,   tt.ncsa_category,
                av.name_th   AS attack_vector,
                asy.name_th  AS affected_system, asy.system_category,
                r.affected_assets, r.description,
                r.severity, r.impact, r.affected_users::int,
                r.data_breached, r.continuity_impact,
                r.root_cause, r.immediate_actions, r.long_term_measures,
                r.resolution, r.resolved_date::text, r.resolved_by, r.status,
                r.ncsa_reported, r.ncsa_report_date::text, r.is_sla_related,
                (r.resolved_date - r.incident_date::date)::int AS mttr_days,
                r.is_active, r.created_by, r.created_at, r.updated_at
            FROM it_incident_report   r
            JOIN it_threat_type       tt  ON r.threat_type_id     = tt.id
            JOIN it_attack_vector     av  ON r.attack_vector_id   = av.id
            JOIN it_affected_system   asy ON r.affected_system_id = asy.id
            WHERE r.id = ${id}
              AND r.is_active = 'Y'
        `;
        if (!row) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบรายงานเหตุการณ์' } };
        }
        return { success: true, data: row };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 5) PUT /:id
// ────────────────────────────────────────────────────────────────
export const updateIncident = async ({ params, body, set }: any) => {
    try {
        const id = Number(params.id);

        const [existing] = await core_kon`
            SELECT id, incident_no, incident_date::text, detected_date::text, report_date::text, status, ncsa_reported
            FROM it_incident_report WHERE id = ${id} AND is_active = 'Y'
        `;
        if (!existing) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบรายงานเหตุการณ์' } };
        }

        const {
            incident_date, detected_date, report_date,
            reported_by, department,
            threat_type_id, attack_vector_id, affected_system_id,
            affected_assets, description,
            severity, impact, affected_users,
            data_breached, continuity_impact,
            root_cause, immediate_actions, long_term_measures,
            resolution, resolved_date, resolved_by,
            status, ncsa_reported, ncsa_report_date, is_sla_related,
        } = body;

        // ตรวจสอบวันที่โดยใช้ค่าที่ส่งมา หรือค่าเดิมถ้าไม่ส่ง
        const effIncidentDate  = incident_date  ?? existing.incident_date;
        const effDetectedDate  = detected_date  ?? existing.detected_date;
        const effReportDate    = report_date    ?? existing.report_date;
        const effStatus        = status         ?? existing.status;
        const effNcsaReported  = ncsa_reported  ?? existing.ncsa_reported;
        const effResolvedDate  = resolved_date  !== undefined ? resolved_date : undefined;
        const effNcsaReportDate = ncsa_report_date !== undefined ? ncsa_report_date : undefined;

        if (new Date(effDetectedDate) < new Date(effIncidentDate)) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'detected_date ต้องไม่ก่อน incident_date', field: 'detected_date' } };
        }
        if (effReportDate < effDetectedDate.substring(0, 10)) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'report_date ต้องไม่ก่อน detected_date', field: 'report_date' } };
        }
        if ((effStatus === 'resolved' || effStatus === 'closed') && effResolvedDate === null) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'resolved_date ต้องระบุเมื่อ status เป็น resolved หรือ closed', field: 'resolved_date' } };
        }
        if (effNcsaReported === 'Y' && effNcsaReportDate === null) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'ncsa_report_date ต้องระบุเมื่อ ncsa_reported เป็น Y', field: 'ncsa_report_date' } };
        }

        const updates: Record<string, any> = {};
        if (incident_date      !== undefined) updates.incident_date      = incident_date;
        if (detected_date      !== undefined) updates.detected_date      = detected_date;
        if (report_date        !== undefined) updates.report_date        = report_date;
        if (reported_by        !== undefined) updates.reported_by        = reported_by;
        if (department         !== undefined) updates.department         = department;
        if (threat_type_id     !== undefined) updates.threat_type_id     = threat_type_id;
        if (attack_vector_id   !== undefined) updates.attack_vector_id   = attack_vector_id;
        if (affected_system_id !== undefined) updates.affected_system_id = affected_system_id;
        if (affected_assets    !== undefined) updates.affected_assets    = affected_assets;
        if (description        !== undefined) updates.description        = description;
        if (severity           !== undefined) updates.severity           = severity;
        if (impact             !== undefined) updates.impact             = impact;
        if (affected_users     !== undefined) updates.affected_users     = affected_users;
        if (data_breached      !== undefined) updates.data_breached      = data_breached;
        if (continuity_impact  !== undefined) updates.continuity_impact  = continuity_impact;
        if (root_cause         !== undefined) updates.root_cause         = root_cause;
        if (immediate_actions  !== undefined) updates.immediate_actions  = immediate_actions;
        if (long_term_measures !== undefined) updates.long_term_measures = long_term_measures;
        if (resolution         !== undefined) updates.resolution         = resolution;
        if (resolved_date      !== undefined) updates.resolved_date      = resolved_date;
        if (resolved_by        !== undefined) updates.resolved_by        = resolved_by;
        if (status             !== undefined) updates.status             = status;
        if (ncsa_reported      !== undefined) updates.ncsa_reported      = ncsa_reported;
        if (ncsa_report_date   !== undefined) updates.ncsa_report_date   = ncsa_report_date;
        if (is_sla_related     !== undefined) updates.is_sla_related     = is_sla_related;

        if (Object.keys(updates).length === 0) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'ไม่มี field ที่ต้องการแก้ไข' } };
        }

        const [updated] = await core_kon`
            UPDATE it_incident_report
            SET ${core_kon(updates)}, updated_at = NOW()
            WHERE id = ${id}
            RETURNING id, incident_no, updated_at
        `;

        return { success: true, data: updated };
    } catch (error: any) {
        if (error.code === '23503') {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'threat_type_id, attack_vector_id หรือ affected_system_id ไม่พบ' } };
        }
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 6) DELETE /:id  (soft delete)
// ────────────────────────────────────────────────────────────────
export const deleteIncident = async ({ params, set }: any) => {
    try {
        const id = Number(params.id);
        const [deleted] = await core_kon`
            UPDATE it_incident_report
            SET is_active = 'N', updated_at = NOW()
            WHERE id = ${id} AND is_active = 'Y'
            RETURNING id, incident_no
        `;
        if (!deleted) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบรายงานเหตุการณ์' } };
        }
        return { success: true, data: { id: deleted.id, incident_no: deleted.incident_no } };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 7) GET /dashboard
// ────────────────────────────────────────────────────────────────
export const getIncidentDashboard = async ({ query, set }: any) => {
    try {
        let start: string | null = query?.date_from || null;
        let end:   string | null = query?.date_to   || null;
        if (query?.month) {
            const range = monthToRange(query.month);
            start = range.start;
            end   = range.end;
        }

        const dateFilter = core_kon`
            ${start ? core_kon`AND r.incident_date >= ${start}::date` : core_kon``}
            ${end   ? core_kon`AND r.incident_date <= ${end}::date`   : core_kon``}
        `;

        const [kpiRows, byThreatType, bySeverity, byAffectedSystem, byAttackVector, breachSla] = await Promise.all([
            core_kon`
                SELECT
                    COUNT(*)::int                                                                           AS total,
                    SUM(CASE WHEN r.status = 'open'        THEN 1 ELSE 0 END)::int                        AS open,
                    SUM(CASE WHEN r.status = 'in_progress' THEN 1 ELSE 0 END)::int                        AS in_progress,
                    SUM(CASE WHEN r.status = 'resolved'    THEN 1 ELSE 0 END)::int                        AS resolved,
                    SUM(CASE WHEN r.status = 'closed'      THEN 1 ELSE 0 END)::int                        AS closed,
                    SUM(CASE WHEN r.severity = 'critical'  THEN 1 ELSE 0 END)::int                        AS critical_count,
                    SUM(CASE WHEN r.data_breached = 'Y'    THEN 1 ELSE 0 END)::int                        AS data_breach_count,
                    SUM(CASE WHEN r.ncsa_reported = 'N'    THEN 1 ELSE 0 END)::int                        AS ncsa_pending,
                    ROUND(AVG((r.resolved_date - r.incident_date::date))::numeric, 1)                            AS avg_mttr_days
                FROM it_incident_report r
                WHERE r.is_active = 'Y' ${dateFilter}
            `,
            core_kon`
                SELECT tt.name_th AS threat_type, COUNT(*)::int AS count
                FROM it_incident_report r
                JOIN it_threat_type tt ON r.threat_type_id = tt.id
                WHERE r.is_active = 'Y' ${dateFilter}
                GROUP BY tt.name_th
                ORDER BY count DESC
            `,
            core_kon`
                SELECT r.severity, COUNT(*)::int AS count
                FROM it_incident_report r
                WHERE r.is_active = 'Y' ${dateFilter}
                GROUP BY r.severity
                ORDER BY CASE r.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 END
            `,
            core_kon`
                SELECT asy.name_th AS affected_system, COUNT(*)::int AS count
                FROM it_incident_report r
                JOIN it_affected_system asy ON r.affected_system_id = asy.id
                WHERE r.is_active = 'Y' ${dateFilter}
                GROUP BY asy.name_th
                ORDER BY count DESC
            `,
            core_kon`
                SELECT av.name_th AS attack_vector, COUNT(*)::int AS count
                FROM it_incident_report r
                JOIN it_attack_vector av ON r.attack_vector_id = av.id
                WHERE r.is_active = 'Y' ${dateFilter}
                GROUP BY av.name_th
                ORDER BY count DESC
            `,
            core_kon`
                SELECT
                    SUM(CASE WHEN data_breached    = 'Y' THEN 1 ELSE 0 END)::int AS breach_yes,
                    SUM(CASE WHEN data_breached    = 'N' THEN 1 ELSE 0 END)::int AS breach_no,
                    SUM(CASE WHEN is_sla_related   = 'Y' THEN 1 ELSE 0 END)::int AS sla_yes,
                    SUM(CASE WHEN is_sla_related   = 'N' THEN 1 ELSE 0 END)::int AS sla_no,
                    SUM(CASE WHEN ncsa_reported    = 'Y' THEN 1 ELSE 0 END)::int AS ncsa_yes,
                    SUM(CASE WHEN ncsa_reported    = 'N' THEN 1 ELSE 0 END)::int AS ncsa_no
                FROM it_incident_report r
                WHERE r.is_active = 'Y' ${dateFilter}
            `,
        ]);

        const k = kpiRows[0] || {} as any;
        const b = breachSla[0] || {} as any;

        return {
            success: true,
            data: {
                kpi: {
                    total:             Number(k.total)             || 0,
                    open:              Number(k.open)              || 0,
                    in_progress:       Number(k.in_progress)       || 0,
                    resolved:          Number(k.resolved)          || 0,
                    closed:            Number(k.closed)            || 0,
                    critical_count:    Number(k.critical_count)    || 0,
                    data_breach_count: Number(k.data_breach_count) || 0,
                    ncsa_pending:      Number(k.ncsa_pending)      || 0,
                    avg_mttr_days:     k.avg_mttr_days != null ? Number(k.avg_mttr_days) : null,
                },
                by_threat_type:      byThreatType,
                by_severity:         bySeverity,
                by_affected_system:  byAffectedSystem,
                by_attack_vector:    byAttackVector,
                breach_sla_ncsa: [
                    { category: 'มีข้อมูลรั่วไหล',    yes_count: Number(b.breach_yes) || 0, no_count: Number(b.breach_no) || 0 },
                    { category: 'กระทบ SLA',           yes_count: Number(b.sla_yes)    || 0, no_count: Number(b.sla_no)    || 0 },
                    { category: 'รายงาน สกมช แล้ว',   yes_count: Number(b.ncsa_yes)   || 0, no_count: Number(b.ncsa_no)   || 0 },
                ],
            },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 8) GET /report  (ข้อมูลสำหรับ PDF รายเดือน)
// ────────────────────────────────────────────────────────────────
export const getIncidentReport = async ({ query, set }: any) => {
    try {
        const month: string = query?.month;
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'month ต้องระบุในรูปแบบ YYYY-MM', field: 'month' } };
        }

        const { start, end } = monthToRange(month);

        const [summaryRows, incidents] = await Promise.all([
            core_kon`
                SELECT
                    COUNT(*)::int                                                                  AS total,
                    SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END)::int                  AS critical,
                    SUM(CASE WHEN severity = 'high'     THEN 1 ELSE 0 END)::int                  AS high,
                    SUM(CASE WHEN severity = 'medium'   THEN 1 ELSE 0 END)::int                  AS medium,
                    SUM(CASE WHEN severity = 'low'      THEN 1 ELSE 0 END)::int                  AS low,
                    SUM(CASE WHEN data_breached = 'Y'   THEN 1 ELSE 0 END)::int                  AS data_breach_count,
                    SUM(CASE WHEN ncsa_reported = 'Y'   THEN 1 ELSE 0 END)::int                  AS ncsa_reported_count,
                    SUM(CASE WHEN status NOT IN ('resolved','closed') THEN 1 ELSE 0 END)::int    AS open_count,
                    ROUND(AVG((resolved_date - incident_date::date))::numeric, 1)                  AS avg_mttr_days
                FROM it_incident_report
                WHERE is_active = 'Y'
                  AND incident_date BETWEEN ${start}::date AND ${end}::date
            `,
            core_kon`
                SELECT
                    r.incident_no, r.incident_date::text,
                    tt.name_th   AS threat_type,
                    r.severity,
                    asy.name_th  AS affected_system,
                    r.status,
                    (r.resolved_date - r.incident_date::date)::int AS mttr_days,
                    r.ncsa_reported, r.data_breached
                FROM it_incident_report   r
                JOIN it_threat_type       tt  ON r.threat_type_id     = tt.id
                JOIN it_affected_system   asy ON r.affected_system_id = asy.id
                WHERE r.is_active = 'Y'
                  AND r.incident_date BETWEEN ${start}::date AND ${end}::date
                ORDER BY r.incident_date ASC, r.id ASC
            `,
        ]);

        const s = summaryRows[0] || {} as any;

        return {
            success: true,
            data: {
                month,
                month_label_th: monthLabelTh(month),
                generated_at: new Date().toISOString(),
                summary: {
                    total:               Number(s.total)               || 0,
                    by_severity: {
                        critical: Number(s.critical) || 0,
                        high:     Number(s.high)     || 0,
                        medium:   Number(s.medium)   || 0,
                        low:      Number(s.low)      || 0,
                    },
                    data_breach_count:   Number(s.data_breach_count)   || 0,
                    ncsa_reported_count: Number(s.ncsa_reported_count) || 0,
                    avg_mttr_days:       s.avg_mttr_days != null ? Number(s.avg_mttr_days) : null,
                    open_count:          Number(s.open_count)          || 0,
                },
                incidents,
            },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};
