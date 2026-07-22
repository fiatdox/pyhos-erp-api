import { core_kon } from '../db/db';
import { join } from 'path';
import { mkdir } from 'fs/promises';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'medical-stat');
const HEAD_ROLES = ['CHIEF_GROUP_MEDSTAT', 'ADMIN'];

// ─── helpers ────────────────────────────────────────────────────────────────
const err = (set: any, status: number, code: string, message: string, field?: string) => {
    set.status = status;
    return { success: false, error: { code, message, ...(field ? { field } : {}) } };
};

async function userRoles(userId: number): Promise<string[]> {
    const rows = await core_kon`
        SELECT r.role_name FROM core_kon.user_m_users_roles mu
        LEFT JOIN core_kon.user_roles r ON r.id = mu.role_id
        WHERE mu.user_id = ${userId}`;
    return rows.map((x: any) => String(x.role_name ?? '').toUpperCase());
}
const hasAnyRole = (roles: string[], allowed: string[]) =>
    roles.some(r => allowed.map(a => a.toUpperCase()).includes(r));

async function addHistory(requestId: number, stepName: string, actorId: number | null, action: string, note?: string | null) {
    await core_kon`
        INSERT INTO stat_request_history (request_id, step_name, actor_id, action, note)
        VALUES (${requestId}, ${stepName}, ${actorId}, ${action}, ${note ?? null})`;
}

// SELECT fragment: 1 คำขอ + ชื่อ/สังกัดผู้ขอ + master + ผู้เกี่ยวข้อง
const requestSelect = (whereExtra: any) => core_kon`
    SELECT
        r.id, r.request_no, r.requester_id,
        CONCAT(ru.pname, ru.fname, ' ', ru.lname) AS requester_name,
        COALESCE(sm."name", mj."name", ms."name") AS requester_department,
        r.email,
        r.purpose_category_id, pc.name AS purpose_category_name,
        r.purpose_detail, r.data_detail,
        r.period_from, r.period_to, r.format,
        r.urgency_id, ul.name AS urgency_name, ul.color_hex AS urgency_color,
        r.status, r.review_type, r.review_note,
        r.reviewed_by, CONCAT(rv.pname, rv.fname, ' ', rv.lname) AS reviewed_by_name, r.reviewed_at,
        r.assigned_to, CONCAT(au.pname, au.fname, ' ', au.lname) AS assigned_to_name,
        r.delivered_note, r.delivered_by, r.delivered_at,
        r.created_at, r.updated_at
    FROM stat_requests r
    LEFT JOIN users ru ON ru.id = r.requester_id
    LEFT JOIN missions  ms ON ms.mission_id  = ru.mission_id
    LEFT JOIN majors    mj ON mj.major_id    = ru.major_id
    LEFT JOIN submajors sm ON sm.submajor_id = ru.submajor_id
    LEFT JOIN stat_purpose_categories pc ON pc.id = r.purpose_category_id
    LEFT JOIN stat_urgency_levels     ul ON ul.id = r.urgency_id
    LEFT JOIN users rv ON rv.id = r.reviewed_by
    LEFT JOIN users au ON au.id = r.assigned_to
    WHERE 1=1 ${whereExtra}
    ORDER BY r.created_at DESC`;

// ─── meta (master สำหรับฟอร์ม) ───────────────────────────────────────────────
export const getStatMeta = async ({ set }: any) => {
    try {
        const [purposes, urgencies] = await Promise.all([
            core_kon`SELECT id, name, description FROM stat_purpose_categories WHERE is_active ORDER BY sort_order, id`,
            core_kon`SELECT id, code, name, color_hex FROM stat_urgency_levels WHERE is_active ORDER BY sort_order, id`,
        ]);
        return {
            success: true,
            data: {
                purpose_categories: purposes,
                urgency_levels: urgencies,
                formats: ['Excel (.xlsx)', 'PDF', 'CSV', 'เอกสาร (พิมพ์)'],
            },
        };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ─── รายชื่อเจ้าพนักงานเวชสถิติ (ตามตำแหน่ง) ─────────────────────────────────
export const getStatStaff = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT u.id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, up.position_name
            FROM users u
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            WHERE u.is_active = 'Y' AND up.position_name ILIKE ${'%สถิติ%'}
            ORDER BY u.fname`;
        return { success: true, data: rows };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ─── list ────────────────────────────────────────────────────────────────────
export const getStatRequests = async ({ query, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const scope = query?.scope || 'mine';           // mine | assigned | all
        const status = query?.status || null;
        const search = query?.search || null;

        let scopeFrag = core_kon`AND r.requester_id = ${uid}`;
        if (scope === 'assigned') scopeFrag = core_kon`AND r.assigned_to = ${uid}`;
        else if (scope === 'all') {
            const roles = await userRoles(uid);
            scopeFrag = hasAnyRole(roles, HEAD_ROLES) ? core_kon`` : core_kon`AND r.requester_id = ${uid}`;
        }
        const statusFrag = status ? core_kon`AND r.status = ${status}` : core_kon``;
        const searchFrag = search
            ? core_kon`AND (r.request_no ILIKE ${'%' + search + '%'} OR r.purpose_detail ILIKE ${'%' + search + '%'} OR r.data_detail ILIKE ${'%' + search + '%'} OR CONCAT(ru.pname, ru.fname, ' ', ru.lname) ILIKE ${'%' + search + '%'})`
            : core_kon``;

        const rows = await requestSelect(core_kon`${scopeFrag} ${statusFrag} ${searchFrag}`);
        return { success: true, data: rows };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ─── detail (+ files, restricted fields, history) ────────────────────────────
export const getStatRequestById = async ({ params, set }: any) => {
    try {
        const id = Number(params.id);
        const [row] = await requestSelect(core_kon`AND r.id = ${id}`);
        if (!row) return err(set, 404, 'NOT_FOUND', 'ไม่พบคำขอ');
        const [files, restricted, history] = await Promise.all([
            core_kon`SELECT id, kind, stored_name, original_name, created_at FROM stat_request_files WHERE request_id = ${id} ORDER BY id`,
            core_kon`SELECT id, field_name, note FROM stat_request_restricted_fields WHERE request_id = ${id} ORDER BY id`,
            core_kon`SELECT h.id, h.step_name, h.action, h.note, h.created_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS actor_name
                     FROM stat_request_history h LEFT JOIN users u ON u.id = h.actor_id
                     WHERE h.request_id = ${id} ORDER BY h.created_at ASC, h.id ASC`,
        ]);
        return { success: true, data: { ...row, files, restricted_fields: restricted, history } };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// running no: STAT-YYYYMM####
async function nextRequestNo(): Promise<string> {
    const now = new Date();
    const prefix = `STAT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    const [row] = await core_kon`
        SELECT COALESCE(MAX(CAST(RIGHT(request_no, 4) AS INT)), 0) AS mx
        FROM stat_requests WHERE request_no LIKE ${prefix + '%'}`;
    return `${prefix}${String(Number(row?.mx ?? 0) + 1).padStart(4, '0')}`;
}

// ─── create (multipart, sample files 1-5 required) ───────────────────────────
export const createStatRequest = async ({ body, user, set }: any) => {
    try {
        const uid = user?.id != null ? Number(user.id) : null;
        if (!uid) return err(set, 401, 'UNAUTHORIZED', 'ไม่พบผู้ใช้');

        const rawFiles = body.sample_files;
        const files: File[] = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
        if (files.length < 1) return err(set, 400, 'VALIDATION', 'กรุณาแนบไฟล์ Excel ตัวอย่างอย่างน้อย 1 ไฟล์', 'sample_files');
        if (files.length > 5) return err(set, 400, 'VALIDATION', 'แนบไฟล์ได้ไม่เกิน 5 ไฟล์', 'sample_files');
        if (!body.purpose_category_id) return err(set, 400, 'VALIDATION', 'กรุณาเลือกจุดประสงค์การขอข้อมูล', 'purpose_category_id');
        if (!body.data_detail || !String(body.data_detail).trim())
            return err(set, 400, 'VALIDATION', 'กรุณาระบุรายละเอียดข้อมูลที่ขอ', 'data_detail');
        const email = String(body.email ?? '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return err(set, 400, 'VALIDATION', 'กรุณาระบุอีเมลสำหรับรับข้อมูลให้ถูกต้อง', 'email');

        let requestNo = await nextRequestNo();
        let inserted: any;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                [inserted] = await core_kon`
                    INSERT INTO stat_requests
                        (request_no, requester_id, email, purpose_category_id, purpose_detail, data_detail,
                         period_from, period_to, format, urgency_id, status)
                    VALUES (${requestNo}, ${uid}, ${email}, ${Number(body.purpose_category_id)},
                            ${body.purpose_detail ?? null}, ${body.data_detail},
                            ${body.period_from || null}, ${body.period_to || null},
                            ${body.format ?? null}, ${body.urgency_id ? Number(body.urgency_id) : null}, 'pending')
                    RETURNING id, request_no`;
                break;
            } catch (e: any) {
                if (e.code === '23505') { requestNo = await nextRequestNo(); continue; }
                throw e;
            }
        }
        const requestId = inserted.id;

        await mkdir(UPLOAD_DIR, { recursive: true });
        for (const file of files.slice(0, 5)) {
            const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
            const stored = `${crypto.randomUUID()}.${ext}`;
            await Bun.write(join(UPLOAD_DIR, stored), file);
            await core_kon`
                INSERT INTO stat_request_files (request_id, kind, stored_name, original_name)
                VALUES (${requestId}, 'sample', ${stored}, ${file.name})`;
        }

        await addHistory(requestId, 'ยื่นคำขอ', uid, 'ยื่นคำขอข้อมูลสถิติ');
        set.status = 201;
        return { success: true, data: inserted };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ─── review (หัวหน้ากลุ่ม: PDPA + อนุมัติ/ปฏิเสธ + มอบหมาย) ───────────────────
// body: { decision: 'approve'|'reject', review_type?: 'full'|'partial',
//         assigned_to?, review_note?, restricted_fields?: [{field_name, note}] }
export const reviewStatRequest = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const roles = await userRoles(uid);
        if (!hasAnyRole(roles, HEAD_ROLES))
            return err(set, 403, 'FORBIDDEN', 'เฉพาะหัวหน้ากลุ่มงานข้อมูลทางการแพทย์เท่านั้น');

        const id = Number(params.id);
        const [req] = await core_kon`SELECT id, status FROM stat_requests WHERE id = ${id}`;
        if (!req) return err(set, 404, 'NOT_FOUND', 'ไม่พบคำขอ');
        if (req.status !== 'pending') return err(set, 409, 'CONFLICT', 'คำขอนี้ถูกพิจารณาไปแล้ว');

        const decision = body.decision;
        if (decision === 'reject') {
            const updated = await core_kon`
                UPDATE stat_requests
                SET status = 'rejected', review_type = NULL, review_note = ${body.review_note ?? null},
                    reviewed_by = ${uid}, reviewed_at = NOW(), updated_at = NOW()
                WHERE id = ${id} AND status = 'pending' RETURNING id`;
            if (updated.length === 0) return err(set, 409, 'CONFLICT', 'คำขอนี้ถูกพิจารณาไปแล้ว');
            await addHistory(id, 'ตรวจสอบ PDPA', uid, 'ปฏิเสธคำขอ', body.review_note ?? null);
            return { success: true, data: { id, status: 'rejected' } };
        }

        // approve (full | partial) + assign processor
        const reviewType = body.review_type === 'partial' ? 'partial' : 'full';
        const assignedTo = body.assigned_to ? Number(body.assigned_to) : null;
        if (!assignedTo) return err(set, 400, 'VALIDATION', 'กรุณามอบหมายเจ้าพนักงานเวชสถิติ', 'assigned_to');

        const updated = await core_kon`
            UPDATE stat_requests
            SET status = 'processing', review_type = ${reviewType}, review_note = ${body.review_note ?? null},
                reviewed_by = ${uid}, reviewed_at = NOW(), assigned_to = ${assignedTo}, updated_at = NOW()
            WHERE id = ${id} AND status = 'pending' RETURNING id`;
        if (updated.length === 0) return err(set, 409, 'CONFLICT', 'คำขอนี้ถูกพิจารณาไปแล้ว');

        // บันทึกฟิลด์ที่ห้ามส่ง (กรณี partial)
        await core_kon`DELETE FROM stat_request_restricted_fields WHERE request_id = ${id}`;
        const restricted: any[] = Array.isArray(body.restricted_fields) ? body.restricted_fields : [];
        for (const f of restricted) {
            const name = String(f?.field_name ?? '').trim();
            if (!name) continue;
            await core_kon`INSERT INTO stat_request_restricted_fields (request_id, field_name, note)
                           VALUES (${id}, ${name}, ${f?.note ?? null})`;
        }
        const [assignee] = await core_kon`SELECT CONCAT(pname, fname, ' ', lname) AS name FROM users WHERE id = ${assignedTo}`;
        await addHistory(id, 'ตรวจสอบ PDPA', uid,
            reviewType === 'partial' ? 'อนุมัติแบบมีเงื่อนไข (ตัดบางฟิลด์)' : 'อนุมัติทั้งหมด',
            `มอบหมายให้ ${assignee?.name ?? ''}${restricted.length ? ` — ห้ามส่ง ${restricted.length} ฟิลด์` : ''}${body.review_note ? ' — ' + body.review_note : ''}`);
        return { success: true, data: { id, status: 'processing', review_type: reviewType } };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ─── deliver (ผู้ประมวลผล: ส่งมอบ) ───────────────────────────────────────────
export const deliverStatRequest = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const id = Number(params.id);
        const [req] = await core_kon`SELECT id, status, assigned_to FROM stat_requests WHERE id = ${id}`;
        if (!req) return err(set, 404, 'NOT_FOUND', 'ไม่พบคำขอ');

        const roles = await userRoles(uid);
        const isOwnerOrAdmin = req.assigned_to === uid || hasAnyRole(roles, ['ADMIN']);
        if (!isOwnerOrAdmin) return err(set, 403, 'FORBIDDEN', 'เฉพาะผู้รับมอบหมายเท่านั้น');
        if (req.status !== 'processing') return err(set, 409, 'CONFLICT', 'คำขอนี้ไม่อยู่ในสถานะกำลังจัดทำ');

        const note = body.delivered_note;
        if (!note || !String(note).trim()) return err(set, 400, 'VALIDATION', 'กรุณาระบุรายละเอียดการส่งมอบ', 'delivered_note');

        const updated = await core_kon`
            UPDATE stat_requests
            SET status = 'delivered', delivered_note = ${note}, delivered_by = ${uid}, delivered_at = NOW(), updated_at = NOW()
            WHERE id = ${id} AND status = 'processing' RETURNING id`;
        if (updated.length === 0) return err(set, 409, 'CONFLICT', 'คำขอนี้ไม่อยู่ในสถานะกำลังจัดทำ');

        // ไฟล์ผลลัพธ์ (ถ้ามี)
        const rawFiles = body.result_files;
        const files: File[] = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];
        if (files.length) {
            await mkdir(UPLOAD_DIR, { recursive: true });
            for (const file of files.slice(0, 5)) {
                const ext = file.name.split('.').pop()?.toLowerCase() ?? 'bin';
                const stored = `${crypto.randomUUID()}.${ext}`;
                await Bun.write(join(UPLOAD_DIR, stored), file);
                await core_kon`INSERT INTO stat_request_files (request_id, kind, stored_name, original_name)
                               VALUES (${id}, 'result', ${stored}, ${file.name})`;
            }
        }
        await addHistory(id, 'ส่งมอบ', uid, 'ส่งมอบข้อมูล', note);
        return { success: true, data: { id, status: 'delivered' } };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ─── ดาวน์โหลดไฟล์ ───────────────────────────────────────────────────────────
export const getStatFile = async ({ params, set }: any) => {
    try {
        const [f] = await core_kon`SELECT stored_name, original_name FROM stat_request_files WHERE id = ${Number(params.fileId)}`;
        if (!f) return err(set, 404, 'NOT_FOUND', 'ไม่พบไฟล์');
        const file = Bun.file(join(UPLOAD_DIR, f.stored_name));
        if (!(await file.exists())) return err(set, 404, 'NOT_FOUND', 'ไฟล์หายไปจากระบบ');
        set.headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(f.original_name)}`;
        return file;
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ─── dashboard ───────────────────────────────────────────────────────────────
export const getStatDashboard = async ({ set }: any) => {
    try {
        const [totals, byPurpose, byUrgency, byStatus, byMonth, byDept] = await Promise.all([
            core_kon`SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
                COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
                COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected
                FROM stat_requests`,
            core_kon`SELECT COALESCE(pc.name, 'ไม่ระบุ') AS name, COUNT(*)::int AS value
                     FROM stat_requests r LEFT JOIN stat_purpose_categories pc ON pc.id = r.purpose_category_id
                     GROUP BY pc.name ORDER BY value DESC`,
            core_kon`SELECT COALESCE(ul.name, 'ไม่ระบุ') AS name, ul.color_hex AS color, COUNT(*)::int AS value
                     FROM stat_requests r LEFT JOIN stat_urgency_levels ul ON ul.id = r.urgency_id
                     GROUP BY ul.name, ul.color_hex ORDER BY value DESC`,
            core_kon`SELECT status AS name, COUNT(*)::int AS value FROM stat_requests GROUP BY status`,
            core_kon`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS ym, COUNT(*)::int AS value
                     FROM stat_requests WHERE created_at >= (CURRENT_DATE - INTERVAL '11 months')
                     GROUP BY 1 ORDER BY 1`,
            core_kon`SELECT COALESCE(sm."name", mj."name", ms."name", 'ไม่ระบุ') AS name, COUNT(*)::int AS value
                     FROM stat_requests r
                     LEFT JOIN users ru ON ru.id = r.requester_id
                     LEFT JOIN missions ms ON ms.mission_id = ru.mission_id
                     LEFT JOIN majors mj ON mj.major_id = ru.major_id
                     LEFT JOIN submajors sm ON sm.submajor_id = ru.submajor_id
                     GROUP BY 1 ORDER BY value DESC LIMIT 10`,
        ]);
        return {
            success: true,
            data: {
                totals: totals[0],
                by_purpose: byPurpose,
                by_urgency: byUrgency,
                by_status: byStatus,
                by_month: byMonth,
                by_department: byDept,
            },
        };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};
