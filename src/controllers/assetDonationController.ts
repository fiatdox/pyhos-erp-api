import { core_kon } from '../db/db';
import { join } from 'path';
import { mkdir } from 'fs/promises';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'asset-donation');
const ADMIN_ROLES = ['ADMIN'];
const STAFF_ROLES = ['DONATION_STAFF', 'ADMIN'];
const COMMITTEE_ROLES = ['DONATION_COMMITTEE', 'ADMIN'];
const PROCUREMENT_ROLES = ['DONATION_PROCUREMENT', 'ADMIN'];

const REPAIR_LIABILITY_CLAUSE =
    'หากครุภัณฑ์ชิ้นนี้ชำรุดเสียหายในภายหลัง การซ่อมแซมจะไม่เข้าเงื่อนไขการซ่อมบำรุงตามหลักเกณฑ์ของโรงพยาบาล หน่วยงานผู้ใช้งานเป็นผู้รับผิดชอบเอง';

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

// ปีงบประมาณไทย (พ.ศ.) — 1 ต.ค. เริ่มรอบใหม่
const fiscalYearBE = (d = new Date()) => (d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear()) + 543;

async function nextFormCode(): Promise<string> {
    const fy = fiscalYearBE();
    const prefix = `DON-${fy}-`;
    const [row] = await core_kon`
        SELECT COALESCE(MAX(CAST(RIGHT(form_code, 4) AS INT)), 0) AS mx
        FROM donation_forms WHERE form_code LIKE ${prefix + '%'}`;
    return `${prefix}${String(Number(row?.mx ?? 0) + 1).padStart(4, '0')}`;
}

// ─── meta (master สำหรับฟอร์ม: หน่วยงาน + กรรมการ) ───────────────────────────
export const getDonationMeta = async ({ set }: any) => {
    try {
        const [departments, majors, submajors, committee] = await Promise.all([
            core_kon`SELECT id, name FROM donation_departments WHERE active ORDER BY sort, name`,
            core_kon`SELECT major_id, name FROM majors WHERE is_active = 'Y' ORDER BY name`,
            core_kon`SELECT submajor_id, major_id, name FROM submajors WHERE is_active = 'Y' ORDER BY name`,
            core_kon`
                SELECT m.id, m.user_id, m.committee_position,
                       CONCAT(u.pname, u.fname, ' ', u.lname) AS name
                FROM donation_committee_members m
                LEFT JOIN users u ON u.id = m.user_id
                WHERE m.active ORDER BY m.sort, m.id`,
        ]);
        return {
            success: true,
            data: {
                departments,
                majors,
                submajors,
                committee,
                used_exterior_conditions: ['ดีมาก', 'ดี', 'พอใช้', 'ทรุดโทรม'],
            },
        };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ─── ค้นหาผู้ใช้ (สำหรับ admin เลือกเพิ่มกรรมการ) ─────────────────────────────
export const getDonationUserOptions = async ({ query, set }: any) => {
    try {
        const search = String(query?.search ?? '').trim();
        const rows = await core_kon`
            SELECT u.id, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, up.position_name
            FROM users u
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            WHERE u.is_active = 'Y'
              ${search ? core_kon`AND CONCAT(u.pname, u.fname, ' ', u.lname) ILIKE ${'%' + search + '%'}` : core_kon``}
            ORDER BY u.fname LIMIT 30`;
        return { success: true, data: rows };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ══════════════════════════ Admin: master หน่วยงาน ══════════════════════════
export const getDonationDepartments = async ({ user, set }: any) => {
    try {
        if (!hasAnyRole(await userRoles(Number(user?.id)), ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
        const rows = await core_kon`SELECT id, name, sort, active FROM donation_departments ORDER BY sort, name`;
        return { success: true, data: rows };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};
export const createDonationDepartment = async ({ body, user, set }: any) => {
    try {
        if (!hasAnyRole(await userRoles(Number(user?.id)), ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
        if (!body.name || !String(body.name).trim()) return err(set, 400, 'VALIDATION', 'กรุณาระบุชื่อหน่วยงาน', 'name');
        const [row] = await core_kon`
            INSERT INTO donation_departments (name, sort, active)
            VALUES (${body.name}, ${body.sort ?? 0}, ${body.active ?? true}) RETURNING id`;
        set.status = 201;
        return { success: true, data: row };
    } catch (e: any) {
        if (e.code === '23505') return err(set, 409, 'CONFLICT', 'มีชื่อหน่วยงานนี้อยู่แล้ว');
        return err(set, 500, 'INTERNAL', e.message);
    }
};
export const updateDonationDepartment = async ({ params, body, user, set }: any) => {
    try {
        if (!hasAnyRole(await userRoles(Number(user?.id)), ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
        const [row] = await core_kon`
            UPDATE donation_departments SET name = ${body.name}, sort = ${body.sort ?? 0}, active = ${body.active ?? true}
            WHERE id = ${Number(params.id)} RETURNING id`;
        if (!row) return err(set, 404, 'NOT_FOUND', 'ไม่พบหน่วยงาน');
        return { success: true, data: row };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};
export const deleteDonationDepartment = async ({ params, user, set }: any) => {
    try {
        if (!hasAnyRole(await userRoles(Number(user?.id)), ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
        await core_kon`DELETE FROM donation_departments WHERE id = ${Number(params.id)}`;
        return { success: true };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ══════════════════════════ Admin: master กรรมการ ═══════════════════════════
export const getDonationCommitteeMembers = async ({ user, set }: any) => {
    try {
        if (!hasAnyRole(await userRoles(Number(user?.id)), ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
        const rows = await core_kon`
            SELECT m.id, m.user_id, m.committee_position, m.sort, m.active,
                   CONCAT(u.pname, u.fname, ' ', u.lname) AS name, up.position_name
            FROM donation_committee_members m
            LEFT JOIN users u ON u.id = m.user_id
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            ORDER BY m.sort, m.id`;
        return { success: true, data: rows };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};
export const createDonationCommitteeMember = async ({ body, user, set }: any) => {
    try {
        if (!hasAnyRole(await userRoles(Number(user?.id)), ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
        if (!body.user_id) return err(set, 400, 'VALIDATION', 'กรุณาเลือกผู้ใช้', 'user_id');
        if (!body.committee_position || !String(body.committee_position).trim())
            return err(set, 400, 'VALIDATION', 'กรุณาระบุตำแหน่งในคณะกรรมการ', 'committee_position');
        const [row] = await core_kon`
            INSERT INTO donation_committee_members (user_id, committee_position, sort, active)
            VALUES (${Number(body.user_id)}, ${body.committee_position}, ${body.sort ?? 0}, ${body.active ?? true}) RETURNING id`;
        set.status = 201;
        return { success: true, data: row };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};
export const updateDonationCommitteeMember = async ({ params, body, user, set }: any) => {
    try {
        if (!hasAnyRole(await userRoles(Number(user?.id)), ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
        const [row] = await core_kon`
            UPDATE donation_committee_members
            SET committee_position = ${body.committee_position}, sort = ${body.sort ?? 0}, active = ${body.active ?? true}
            WHERE id = ${Number(params.id)} RETURNING id`;
        if (!row) return err(set, 404, 'NOT_FOUND', 'ไม่พบกรรมการ');
        return { success: true, data: row };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};
export const deleteDonationCommitteeMember = async ({ params, user, set }: any) => {
    try {
        if (!hasAnyRole(await userRoles(Number(user?.id)), ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
        await core_kon`DELETE FROM donation_committee_members WHERE id = ${Number(params.id)}`;
        return { success: true };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ══════════════════════════ Form 1: สร้าง / แก้ไข (donation_staff) ══════════
const itemsWithImages = async (formId: number) => {
    const items = await core_kon`
        SELECT id, item_no, item_name, item_brand_model, item_qty, item_unit, item_est_value, item_condition_general,
               asset_registration_no, depreciation_start_date, useful_life_years, custodian_department,
               repair_condition_note, recorded_by_user_id, recorded_date
        FROM donation_items WHERE donation_form_id = ${formId} ORDER BY item_no`;
    const images = await core_kon`
        SELECT i.id, i.donation_item_id, i.file_name, i.original_name, i.uploaded_at
        FROM donation_item_images i
        JOIN donation_items it ON it.id = i.donation_item_id
        WHERE it.donation_form_id = ${formId} ORDER BY i.id`;
    return items.map((it: any) => ({
        ...it,
        images: images.filter((im: any) => im.donation_item_id === it.id),
    }));
};

const formSelect = (whereExtra: any) => core_kon`
    SELECT f.*,
        (SELECT COUNT(*)::int FROM donation_items di WHERE di.donation_form_id = f.id) AS item_count
    FROM donation_forms f
    WHERE 1=1 ${whereExtra}
    ORDER BY f.created_at DESC`;

export const getDonationForms = async ({ query, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const scope = query?.scope || 'mine';
        const status = query?.status || null;
        const statusFrag = status ? core_kon`AND f.status = ${status}` : core_kon``;

        let rows;
        if (scope === 'committee-pending') {
            const roles = await userRoles(uid);
            if (!hasAnyRole(roles, COMMITTEE_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะคณะกรรมการรับบริจาค');
            rows = await formSelect(core_kon`
                AND f.status = 'pending_approval'
                AND NOT EXISTS (SELECT 1 FROM donation_committee_reviews cr WHERE cr.donation_form_id = f.id AND cr.committee_user_id = ${uid})`);
        } else if (scope === 'committee-history') {
            const roles = await userRoles(uid);
            if (!hasAnyRole(roles, COMMITTEE_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะคณะกรรมการรับบริจาค');
            rows = await formSelect(core_kon`
                AND EXISTS (SELECT 1 FROM donation_committee_reviews cr WHERE cr.donation_form_id = f.id AND cr.committee_user_id = ${uid})
                ${statusFrag}`);
        } else if (scope === 'procurement-pending') {
            const roles = await userRoles(uid);
            if (!hasAnyRole(roles, PROCUREMENT_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะฝ่ายพัสดุ');
            rows = await formSelect(core_kon`AND f.status = 'pending_registration'`);
        } else if (scope === 'procurement-history') {
            const roles = await userRoles(uid);
            if (!hasAnyRole(roles, PROCUREMENT_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะฝ่ายพัสดุ');
            rows = await formSelect(core_kon`AND f.status = 'registered' ${statusFrag}`);
        } else if (scope === 'all') {
            const roles = await userRoles(uid);
            if (!hasAnyRole(roles, ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะผู้ดูแลระบบ');
            rows = await formSelect(statusFrag);
        } else {
            // mine — ของเจ้าหน้าที่รับบริจาคเอง
            rows = await formSelect(core_kon`AND f.submitted_by_user_id = ${uid} ${statusFrag}`);
        }
        return { success: true, data: rows };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

export const getDonationFormById = async ({ params, user, set }: any) => {
    try {
        const id = Number(params.id);
        const [form] = await formSelect(core_kon`AND f.id = ${id}`);
        if (!form) return err(set, 404, 'NOT_FOUND', 'ไม่พบแบบฟอร์ม');
        const [items, reviews] = await Promise.all([
            itemsWithImages(id),
            core_kon`
                SELECT cr.id, cr.committee_user_id, cr.committee_position, cr.decision, cr.comment, cr.reviewed_date,
                       CONCAT(u.pname, u.fname, ' ', u.lname) AS committee_name
                FROM donation_committee_reviews cr
                LEFT JOIN users u ON u.id = cr.committee_user_id
                WHERE cr.donation_form_id = ${id} ORDER BY cr.reviewed_date`,
        ]);
        const uid = Number(user?.id);
        const myReview = reviews.find((r: any) => r.committee_user_id === uid) ?? null;
        return { success: true, data: { ...form, items, committee_reviews: reviews, my_review: myReview } };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// แปลง major_id/submajor_id -> ข้อความหน่วยงานปลายทาง (major › submajor) พร้อม validate ว่ามีจริง
async function resolveReceivingDept(majorId: any, submajorId: any, fallback?: string): Promise<{ name: string | null; major_id: number | null; submajor_id: number | null }> {
    const mid = majorId != null ? Number(majorId) : null;
    const sid = submajorId != null ? Number(submajorId) : null;
    if (!mid) return { name: fallback ?? null, major_id: null, submajor_id: null };
    const [mj] = await core_kon`SELECT name FROM majors WHERE major_id = ${mid}`;
    if (!mj) return { name: fallback ?? null, major_id: null, submajor_id: null };
    let name = mj.name as string;
    let validSid: number | null = null;
    if (sid) {
        const [sm] = await core_kon`SELECT name FROM submajors WHERE submajor_id = ${sid} AND major_id = ${mid}`;
        if (sm) { name = `${name} › ${sm.name}`; validSid = sid; }
    }
    return { name, major_id: mid, submajor_id: validSid };
}

export const createDonationForm = async ({ body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        if (!hasAnyRole(await userRoles(uid), STAFF_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะเจ้าหน้าที่รับบริจาค');

        const [u] = await core_kon`
            SELECT CONCAT(pname, fname, ' ', lname) AS name, up.position_name
            FROM users LEFT JOIN user_positions up ON up.user_position_id = users.user_position_id
            WHERE users.id = ${uid}`;

        const donationType = body.donation_type === 'used' ? 'used' : 'new';
        if (!body.donor_name || !String(body.donor_name).trim()) return err(set, 400, 'VALIDATION', 'กรุณาระบุชื่อผู้บริจาค', 'donor_name');
        const dept = await resolveReceivingDept(body.major_id, body.submajor_id, body.receiving_department);
        if (!dept.name) return err(set, 400, 'VALIDATION', 'กรุณาเลือกหน่วยงานปลายทาง', 'major_id');

        let formCode = await nextFormCode();
        let inserted: any;
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                [inserted] = await core_kon`
                    INSERT INTO donation_forms
                        (form_code, submitted_by_user_id, submitted_by_name, submitted_by_position, submitted_date,
                         donor_name, donor_address, donor_phone, donor_purpose, receiving_department, major_id, submajor_id, donation_type,
                         used_exterior_condition, used_tested_working, used_estimated_age_years, used_condition_notes,
                         used_acknowledged_by, used_acknowledged_date, status)
                    VALUES (${formCode}, ${uid}, ${body.submitted_by_name ?? u?.name ?? null}, ${body.submitted_by_position ?? u?.position_name ?? null},
                            ${body.submitted_date || new Date().toISOString().slice(0, 10)},
                            ${body.donor_name}, ${body.donor_address ?? null}, ${body.donor_phone ?? null}, ${body.donor_purpose ?? null},
                            ${dept.name}, ${dept.major_id}, ${dept.submajor_id}, ${donationType},
                            ${donationType === 'used' ? body.used_exterior_condition ?? null : null},
                            ${donationType === 'used' ? (body.used_tested_working ?? null) : null},
                            ${donationType === 'used' ? body.used_estimated_age_years ?? null : null},
                            ${donationType === 'used' ? body.used_condition_notes ?? null : null},
                            ${donationType === 'used' ? body.used_acknowledged_by ?? null : null},
                            ${donationType === 'used' ? body.used_acknowledged_date ?? null : null},
                            'draft')
                    RETURNING id, form_code`;
                break;
            } catch (e: any) {
                if (e.code === '23505') { formCode = await nextFormCode(); continue; }
                throw e;
            }
        }

        await syncDonationItems(inserted.id, Array.isArray(body.items) ? body.items : []);
        set.status = 201;
        return { success: true, data: inserted };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// sync items[] ของ form (แทนที่ทั้งชุด — ลบรายการที่ถูกตัดออก, อัปเดต/เพิ่มที่เหลือ)
async function syncDonationItems(formId: number, items: any[]) {
    const existing = await core_kon`SELECT id FROM donation_items WHERE donation_form_id = ${formId}`;
    const existingIds = new Set(existing.map((r: any) => r.id));
    const keepIds = new Set(items.filter(it => it.id).map(it => Number(it.id)));
    const toDelete = [...existingIds].filter(id => !keepIds.has(id as number));
    for (const id of toDelete) await core_kon`DELETE FROM donation_items WHERE id = ${id}`;

    let no = 1;
    for (const it of items) {
        if (it.id && existingIds.has(Number(it.id))) {
            await core_kon`
                UPDATE donation_items SET
                    item_no = ${no}, item_name = ${it.item_name}, item_brand_model = ${it.item_brand_model ?? null},
                    item_qty = ${it.item_qty}, item_unit = ${it.item_unit}, item_est_value = ${it.item_est_value ?? null},
                    item_condition_general = ${it.item_condition_general ?? null}
                WHERE id = ${Number(it.id)}`;
        } else {
            await core_kon`
                INSERT INTO donation_items (donation_form_id, item_no, item_name, item_brand_model, item_qty, item_unit, item_est_value, item_condition_general)
                VALUES (${formId}, ${no}, ${it.item_name}, ${it.item_brand_model ?? null}, ${it.item_qty}, ${it.item_unit}, ${it.item_est_value ?? null}, ${it.item_condition_general ?? null})`;
        }
        no++;
    }
}

export const updateDonationForm = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const id = Number(params.id);
        const [form] = await core_kon`SELECT id, status, submitted_by_user_id, donation_type FROM donation_forms WHERE id = ${id}`;
        if (!form) return err(set, 404, 'NOT_FOUND', 'ไม่พบแบบฟอร์ม');
        const roles = await userRoles(uid);
        const isOwner = form.submitted_by_user_id === uid;
        if (!isOwner && !hasAnyRole(roles, ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'แก้ไขได้เฉพาะเจ้าของฟอร์ม');
        if (form.status !== 'draft') return err(set, 409, 'CONFLICT', 'แก้ไขได้เฉพาะฟอร์มที่ยังเป็นร่าง (draft) เท่านั้น');

        const donationType = body.donation_type === 'used' ? 'used' : 'new';
        const dept = await resolveReceivingDept(body.major_id, body.submajor_id, body.receiving_department);
        if (!dept.name) return err(set, 400, 'VALIDATION', 'กรุณาเลือกหน่วยงานปลายทาง', 'major_id');
        await core_kon`
            UPDATE donation_forms SET
                submitted_by_name = ${body.submitted_by_name ?? null}, submitted_by_position = ${body.submitted_by_position ?? null},
                submitted_date = ${body.submitted_date || new Date().toISOString().slice(0, 10)},
                donor_name = ${body.donor_name}, donor_address = ${body.donor_address ?? null}, donor_phone = ${body.donor_phone ?? null},
                donor_purpose = ${body.donor_purpose ?? null},
                receiving_department = ${dept.name}, major_id = ${dept.major_id}, submajor_id = ${dept.submajor_id},
                donation_type = ${donationType},
                used_exterior_condition = ${donationType === 'used' ? body.used_exterior_condition ?? null : null},
                used_tested_working = ${donationType === 'used' ? (body.used_tested_working ?? null) : null},
                used_estimated_age_years = ${donationType === 'used' ? body.used_estimated_age_years ?? null : null},
                used_condition_notes = ${donationType === 'used' ? body.used_condition_notes ?? null : null},
                used_acknowledged_by = ${donationType === 'used' ? body.used_acknowledged_by ?? null : null},
                used_acknowledged_date = ${donationType === 'used' ? body.used_acknowledged_date ?? null : null},
                updated_at = NOW()
            WHERE id = ${id}`;

        await syncDonationItems(id, Array.isArray(body.items) ? body.items : []);
        return { success: true, data: { id } };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

export const deleteDonationForm = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const id = Number(params.id);
        const [form] = await core_kon`SELECT id, status, submitted_by_user_id FROM donation_forms WHERE id = ${id}`;
        if (!form) return err(set, 404, 'NOT_FOUND', 'ไม่พบแบบฟอร์ม');
        const roles = await userRoles(uid);
        const isOwner = form.submitted_by_user_id === uid;
        if (!isOwner && !hasAnyRole(roles, ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'ลบได้เฉพาะเจ้าของฟอร์ม');
        if (form.status !== 'draft') return err(set, 409, 'CONFLICT', 'ลบได้เฉพาะฟอร์มที่ยังเป็นร่าง (draft) เท่านั้น');
        await core_kon`DELETE FROM donation_forms WHERE id = ${id}`;
        return { success: true };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ─── อัปโหลด/ลบรูปครุภัณฑ์ (เฉพาะตอน draft, เจ้าของฟอร์ม) ─────────────────────
const ALLOWED_IMG_EXT = ['jpg', 'jpeg', 'png'];
const MAX_IMG_BYTES = 5 * 1024 * 1024;

export const uploadDonationItemImages = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const formId = Number(params.id);
        const itemId = Number(params.itemId);
        const [row] = await core_kon`
            SELECT f.id AS form_id, f.status, f.submitted_by_user_id
            FROM donation_items di JOIN donation_forms f ON f.id = di.donation_form_id
            WHERE di.id = ${itemId} AND di.donation_form_id = ${formId}`;
        if (!row) return err(set, 404, 'NOT_FOUND', 'ไม่พบรายการครุภัณฑ์');
        const roles = await userRoles(uid);
        if (row.submitted_by_user_id !== uid && !hasAnyRole(roles, ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'แก้ไขได้เฉพาะเจ้าของฟอร์ม');
        if (row.status !== 'draft') return err(set, 409, 'CONFLICT', 'แก้ไขรูปได้เฉพาะฟอร์มที่ยังเป็นร่าง (draft) เท่านั้น');

        const raw = body.images;
        const files: File[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
        if (files.length === 0) return err(set, 400, 'VALIDATION', 'กรุณาแนบรูปอย่างน้อย 1 รูป', 'images');
        for (const f of files) {
            const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
            if (!ALLOWED_IMG_EXT.includes(ext)) return err(set, 400, 'VALIDATION', `ไฟล์ ${f.name} ต้องเป็น jpg/png เท่านั้น`, 'images');
            if (f.size > MAX_IMG_BYTES) return err(set, 400, 'VALIDATION', `ไฟล์ ${f.name} มีขนาดเกิน 5MB`, 'images');
        }

        await mkdir(UPLOAD_DIR, { recursive: true });
        const saved = [];
        for (const file of files) {
            const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
            const stored = `${crypto.randomUUID()}.${ext}`;
            await Bun.write(join(UPLOAD_DIR, stored), file);
            const [img] = await core_kon`
                INSERT INTO donation_item_images (donation_item_id, file_name, original_name)
                VALUES (${itemId}, ${stored}, ${file.name}) RETURNING id, file_name, original_name`;
            saved.push(img);
        }
        set.status = 201;
        return { success: true, data: saved };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

export const deleteDonationItemImage = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const imageId = Number(params.imageId);
        const [row] = await core_kon`
            SELECT f.status, f.submitted_by_user_id
            FROM donation_item_images im
            JOIN donation_items di ON di.id = im.donation_item_id
            JOIN donation_forms f ON f.id = di.donation_form_id
            WHERE im.id = ${imageId}`;
        if (!row) return err(set, 404, 'NOT_FOUND', 'ไม่พบรูปภาพ');
        const roles = await userRoles(uid);
        if (row.submitted_by_user_id !== uid && !hasAnyRole(roles, ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'แก้ไขได้เฉพาะเจ้าของฟอร์ม');
        if (row.status !== 'draft') return err(set, 409, 'CONFLICT', 'แก้ไขรูปได้เฉพาะฟอร์มที่ยังเป็นร่าง (draft) เท่านั้น');
        await core_kon`DELETE FROM donation_item_images WHERE id = ${imageId}`;
        return { success: true };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

export const getDonationItemImageFile = async ({ params, set }: any) => {
    try {
        const [f] = await core_kon`SELECT file_name, original_name FROM donation_item_images WHERE id = ${Number(params.imageId)}`;
        if (!f) return err(set, 404, 'NOT_FOUND', 'ไม่พบไฟล์');
        const file = Bun.file(join(UPLOAD_DIR, f.file_name));
        if (!(await file.exists())) return err(set, 404, 'NOT_FOUND', 'ไฟล์หายไปจากระบบ');
        return file;
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ─── submit: draft -> pending_approval (ตรวจครบทุกเงื่อนไข) ─────────────────
export const submitDonationForm = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const id = Number(params.id);
        const [form] = await core_kon`SELECT * FROM donation_forms WHERE id = ${id}`;
        if (!form) return err(set, 404, 'NOT_FOUND', 'ไม่พบแบบฟอร์ม');
        const roles = await userRoles(uid);
        if (form.submitted_by_user_id !== uid && !hasAnyRole(roles, ADMIN_ROLES)) return err(set, 403, 'FORBIDDEN', 'ส่งได้เฉพาะเจ้าของฟอร์ม');
        if (form.status !== 'draft') return err(set, 409, 'CONFLICT', 'ฟอร์มนี้ถูกส่งไปแล้ว');

        if (!form.donor_name) return err(set, 400, 'VALIDATION', 'กรุณาระบุชื่อผู้บริจาค', 'donor_name');
        if (!form.receiving_department) return err(set, 400, 'VALIDATION', 'กรุณาเลือกหน่วยงานปลายทาง', 'receiving_department');
        if (form.donation_type === 'used') {
            if (!form.used_exterior_condition) return err(set, 400, 'VALIDATION', 'กรุณาระบุสภาพภายนอก', 'used_exterior_condition');
            if (form.used_tested_working === null) return err(set, 400, 'VALIDATION', 'กรุณาระบุผลการทดลองใช้งาน', 'used_tested_working');
            if (!form.used_acknowledged_by) return err(set, 400, 'VALIDATION', 'กรุณาระบุผู้รับทราบเงื่อนไข', 'used_acknowledged_by');
            if (!form.used_acknowledged_date) return err(set, 400, 'VALIDATION', 'กรุณาระบุวันที่รับทราบเงื่อนไข', 'used_acknowledged_date');
        }

        const items = await itemsWithImages(id);
        if (items.length === 0) return err(set, 400, 'VALIDATION', 'ต้องมีรายการครุภัณฑ์อย่างน้อย 1 รายการ', 'items');
        for (const it of items) {
            if (!it.images || it.images.length === 0)
                return err(set, 400, 'VALIDATION', `รายการ "${it.item_name}" ต้องมีรูปภาพอย่างน้อย 1 รูป`, 'items');
        }

        await core_kon`UPDATE donation_forms SET status = 'pending_approval', updated_at = NOW() WHERE id = ${id} AND status = 'draft'`;
        return { success: true, data: { id, status: 'pending_approval' } };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ══════════════════════════ กรรมการ: ลงมติ ══════════════════════════════════
// สรุปผล: อนุมัติเมื่อเสียงข้างมาก (>=2/3) เลือก approved, ไม่อนุมัติเมื่อ >=2/3 เลือก rejected
// สรุปผลทันทีที่ครบเงื่อนไขเสียงข้างมาก ไม่ต้องรอครบทั้ง 3 ท่าน
export const submitCommitteeReview = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const id = Number(params.id);

        const [member] = await core_kon`SELECT committee_position FROM donation_committee_members WHERE user_id = ${uid} AND active`;
        if (!member) return err(set, 403, 'FORBIDDEN', 'คุณไม่ได้เป็นคณะกรรมการรับบริจาค');

        const [form] = await core_kon`SELECT id, status FROM donation_forms WHERE id = ${id}`;
        if (!form) return err(set, 404, 'NOT_FOUND', 'ไม่พบแบบฟอร์ม');
        if (form.status !== 'pending_approval') return err(set, 409, 'CONFLICT', 'ฟอร์มนี้ไม่อยู่ในสถานะรอกรรมการพิจารณา');

        const decision = body.decision === 'rejected' ? 'rejected' : body.decision === 'approved' ? 'approved' : null;
        if (!decision) return err(set, 400, 'VALIDATION', 'กรุณาระบุมติ (approved/rejected)', 'decision');
        const comment = String(body.comment ?? '').trim();
        if (!comment) return err(set, 400, 'VALIDATION', 'กรุณากรอกความเห็นประกอบมติ', 'comment');

        try {
            await core_kon`
                INSERT INTO donation_committee_reviews (donation_form_id, committee_user_id, committee_position, decision, comment)
                VALUES (${id}, ${uid}, ${member.committee_position}, ${decision}, ${comment})`;
        } catch (e: any) {
            if (e.code === '23505') return err(set, 409, 'CONFLICT', 'คุณได้ลงมติสำหรับฟอร์มนี้ไปแล้ว');
            throw e;
        }

        const counts = await core_kon`
            SELECT decision, COUNT(*)::int AS n FROM donation_committee_reviews
            WHERE donation_form_id = ${id} GROUP BY decision`;
        const approvedN = counts.find((c: any) => c.decision === 'approved')?.n ?? 0;
        const rejectedN = counts.find((c: any) => c.decision === 'rejected')?.n ?? 0;

        let finalStatus: string | null = null;
        if (approvedN >= 2) finalStatus = 'pending_registration';
        else if (rejectedN >= 2) finalStatus = 'rejected';

        if (finalStatus) {
            await core_kon`
                UPDATE donation_forms SET status = ${finalStatus}, approval_date = CURRENT_DATE, updated_at = NOW()
                WHERE id = ${id} AND status = 'pending_approval'`;
        }

        return { success: true, data: { id, form_status: finalStatus ?? 'pending_approval', approved: approvedN, rejected: rejectedN } };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};

// ══════════════════════════ ฝ่ายพัสดุ: Form 2 ขึ้นทะเบียน ═══════════════════
export const registerDonationForm = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        if (!hasAnyRole(await userRoles(uid), PROCUREMENT_ROLES)) return err(set, 403, 'FORBIDDEN', 'เฉพาะฝ่ายพัสดุ');

        const id = Number(params.id);
        const [form] = await core_kon`SELECT id, status, donation_type, receiving_department, used_condition_notes FROM donation_forms WHERE id = ${id}`;
        if (!form) return err(set, 404, 'NOT_FOUND', 'ไม่พบแบบฟอร์ม');
        if (form.status !== 'pending_registration') return err(set, 409, 'CONFLICT', 'ฟอร์มนี้ไม่อยู่ในสถานะรอขึ้นทะเบียน');

        const items: any[] = Array.isArray(body.items) ? body.items : [];
        const dbItems = await core_kon`SELECT id FROM donation_items WHERE donation_form_id = ${id}`;
        const dbIds = new Set(dbItems.map((r: any) => r.id));

        if (form.donation_type === 'new') {
            for (const it of items) {
                if (!it.id || !dbIds.has(Number(it.id))) continue;
                if (!it.asset_registration_no) return err(set, 400, 'VALIDATION', 'กรุณาระบุเลขทะเบียนครุภัณฑ์ทุกรายการ', 'asset_registration_no');
                if (!it.depreciation_start_date) return err(set, 400, 'VALIDATION', 'กรุณาระบุวันที่เริ่มคิดค่าเสื่อมราคา', 'depreciation_start_date');
                if (!it.useful_life_years) return err(set, 400, 'VALIDATION', 'กรุณาระบุอายุการใช้งานตามเกณฑ์', 'useful_life_years');
                await core_kon`
                    UPDATE donation_items SET
                        asset_registration_no = ${it.asset_registration_no},
                        depreciation_start_date = ${it.depreciation_start_date},
                        useful_life_years = ${it.useful_life_years},
                        custodian_department = ${it.custodian_department || form.receiving_department},
                        recorded_by_user_id = ${uid}, recorded_date = CURRENT_DATE
                    WHERE id = ${Number(it.id)}`;
            }
        } else {
            const note = [form.used_condition_notes, REPAIR_LIABILITY_CLAUSE].filter(Boolean).join(' — ');
            for (const dbIt of dbItems) {
                await core_kon`
                    UPDATE donation_items SET
                        asset_registration_no = 'ไม่ออกทะเบียน',
                        repair_condition_note = ${note},
                        recorded_by_user_id = ${uid}, recorded_date = CURRENT_DATE
                    WHERE id = ${dbIt.id}`;
            }
        }

        await core_kon`UPDATE donation_forms SET status = 'registered', updated_at = NOW() WHERE id = ${id} AND status = 'pending_registration'`;
        return { success: true, data: { id, status: 'registered' } };
    } catch (e: any) { return err(set, 500, 'INTERNAL', e.message); }
};
