// แก้ไขข้อมูลใบส่งซ่อม IT — ช่าง/งาน IT แก้สิ่งที่ผู้แจ้งกรอกผิด (ชื่อครุภัณฑ์ ยี่ห้อ เลขครุภัณฑ์ ประเภท ฯลฯ)
// · เฉพาะ role งาน IT (ตรวจจาก DB) · แก้ได้ทุกสถานะ (แก้ทะเบียนให้ถูกแม้ปิดงานแล้ว)
// · ไม่แตะอาการที่ผู้แจ้งเขียน / ความเร่งด่วน / สถานะ / ผู้รับงาน — พวกนั้นมีขั้นตอนของตัวเอง
// · ทุกครั้งที่มีการเปลี่ยนจริง เก็บค่าก่อน/หลังลง it_repair_request_edits
import { core_kon } from '../db/db';

const IT_ROLES = ['ADMIN', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT', 'IT_STAFF'];
const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, ...(field ? { field } : {}) }; };

const isItStaff = async (uid: number) => {
    if (!uid) return false;
    const rows = await core_kon`
        SELECT 1 FROM user_m_users_roles mu JOIN user_roles r ON r.id = mu.role_id
        WHERE mu.user_id = ${uid} AND UPPER(r.role_name) IN ${core_kon(IT_ROLES)} LIMIT 1`;
    return rows.length > 0;
};

/** ช่องที่แก้ได้ + ชื่อไทย (ใช้ในประวัติ) */
export const EDIT_FIELDS = {
    equipment_name: 'ชื่อครุภัณฑ์',
    brand: 'ยี่ห้อ/รุ่น',
    equipment_number: 'เลขครุภัณฑ์',
    it_equipment_type_id: 'ประเภทอุปกรณ์',
    problem_category_id: 'หมวดปัญหา',
    location: 'สถานที่ตั้ง',
    company_name: 'บริษัทผู้ขาย',
    budget_year: 'ปีงบประมาณที่ได้มา',
    unit_price: 'ราคาต่อหน่วย',
} as const;
type Field = keyof typeof EDIT_FIELDS;
const TEXT_MAX: Partial<Record<Field, number>> = { equipment_name: 255, brand: 100, equipment_number: 100, location: 500, company_name: 150 };

const current = async (id: number) => (await core_kon`
    SELECT r.it_repair_request_id, r.equipment_name, r.brand, r.equipment_number, r.it_equipment_type_id, r.problem_category_id,
           r.location, r.company_name, r.budget_year, r.unit_price::float8 AS unit_price
    FROM it_repair_requests r WHERE r.it_repair_request_id = ${id}`)[0];

// ข้อมูลปัจจุบันของช่องที่แก้ได้ + ตัวเลือก + ประวัติการแก้ไข
export const getRepairEdit = async ({ params, user, set }: any) => {
    try {
        if (!(await isItStaff(Number(user?.id)))) return fail(set, 403, 'เฉพาะเจ้าหน้าที่งาน IT');
        const id = Number(params?.id);
        const row = await current(id);
        if (!row) return fail(set, 404, 'ไม่พบใบส่งซ่อม');
        const [types, categories, history] = await Promise.all([
            core_kon`SELECT id, name FROM it_equipment_types ORDER BY id`,
            core_kon`SELECT it_problem_category_id AS id, name FROM it_problem_category ORDER BY it_problem_category_id`,
            core_kon`
                SELECT e.id, e.changes, e.edited_at, NULLIF(BTRIM(CONCAT(u.pname, u.fname, ' ', u.lname)), '') AS edited_by_name
                FROM it_repair_request_edits e LEFT JOIN users u ON u.id = e.edited_by
                WHERE e.it_repair_request_id = ${id} ORDER BY e.edited_at DESC, e.id DESC LIMIT 50`,
        ]);
        return { success: true, data: { request: row, equipment_types: types, problem_categories: categories, labels: EDIT_FIELDS, history } };
    } catch (e: any) {
        console.error('[IT Repair] edit load:', e?.message);
        return fail(set, 500, 'โหลดข้อมูลใบส่งซ่อมไม่สำเร็จ');
    }
};

// บันทึกการแก้ไข — ส่งมาเฉพาะช่องที่ต้องการแก้ก็ได้ ช่องที่ไม่ส่งคงเดิม
export const updateRepairRequest = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        if (!(await isItStaff(uid))) return fail(set, 403, 'เฉพาะเจ้าหน้าที่งาน IT');
        const id = Number(params?.id);
        const before = await current(id);
        if (!before) return fail(set, 404, 'ไม่พบใบส่งซ่อม');

        const next: Record<string, any> = {};
        const has = (k: Field) => body && Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
        // ข้อความ — ตัดช่องว่าง, ว่าง = NULL (ยกเว้นชื่อครุภัณฑ์ที่ห้ามว่าง)
        for (const k of ['equipment_name', 'brand', 'equipment_number', 'location', 'company_name'] as Field[]) {
            if (!has(k)) continue;
            const v = body[k] == null ? '' : String(body[k]).trim();
            if (v.length > TEXT_MAX[k]!) return fail(set, 400, `${EDIT_FIELDS[k]}ยาวเกิน ${TEXT_MAX[k]} ตัวอักษร`, k);
            if (k === 'equipment_name' && !v) return fail(set, 400, 'กรุณาระบุชื่อครุภัณฑ์', k);
            next[k] = v || null;
        }
        if (has('budget_year')) {
            const v = body.budget_year == null ? '' : String(body.budget_year).trim();
            if (v && !/^\d{4}$/.test(v)) return fail(set, 400, 'ปีงบประมาณต้องเป็นตัวเลข 4 หลัก', 'budget_year');
            next.budget_year = v || null;
        }
        if (has('unit_price')) {
            const raw = body.unit_price;
            if (raw == null || raw === '') next.unit_price = null;
            else {
                const n = Number(raw);
                if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999) return fail(set, 400, 'ราคาต่อหน่วยไม่ถูกต้อง', 'unit_price');
                next.unit_price = Math.round(n * 100) / 100;
            }
        }
        if (has('it_equipment_type_id')) {
            const n = Number(body.it_equipment_type_id);
            if (!Number.isInteger(n) || !(await core_kon`SELECT 1 FROM it_equipment_types WHERE id = ${n}`).length)
                return fail(set, 400, 'ไม่พบประเภทอุปกรณ์ที่เลือก', 'it_equipment_type_id');
            next.it_equipment_type_id = n;
        }
        if (has('problem_category_id')) {
            const n = Number(body.problem_category_id);
            if (!Number.isInteger(n) || !(await core_kon`SELECT 1 FROM it_problem_category WHERE it_problem_category_id = ${n}`).length)
                return fail(set, 400, 'ไม่พบหมวดปัญหาที่เลือก', 'problem_category_id');
            next.problem_category_id = n;
        }

        // เก็บเฉพาะช่องที่ค่าเปลี่ยนจริง
        const changes: Record<string, { from: any; to: any }> = {};
        for (const k of Object.keys(next)) {
            const a = before[k] ?? null, b = next[k] ?? null;
            if (a !== b) changes[k] = { from: a, to: b };
        }
        const keys = Object.keys(changes);
        if (keys.length === 0) return { success: true, data: { request: before, changed: [] }, message: 'ไม่มีข้อมูลที่เปลี่ยนแปลง' };

        const patch = Object.fromEntries(keys.map(k => [k, next[k]]));
        await core_kon.begin(async (tx: any) => {
            await tx`UPDATE it_repair_requests SET ${tx(patch)}, updated_at = NOW(), updated_by = ${uid} WHERE it_repair_request_id = ${id}`;
            await tx`INSERT INTO it_repair_request_edits (it_repair_request_id, changes, edited_by) VALUES (${id}, ${tx.json(changes)}, ${uid})`;
        });
        const [names] = await core_kon`
            SELECT et.name AS equipment_type_name, pc.name AS problem_category_name
            FROM it_repair_requests r
            LEFT JOIN it_equipment_types et ON et.id = r.it_equipment_type_id
            LEFT JOIN it_problem_category pc ON pc.it_problem_category_id = r.problem_category_id
            WHERE r.it_repair_request_id = ${id}`;
        return { success: true, data: { request: { ...(await current(id)), ...names }, changed: keys }, message: 'บันทึกการแก้ไขแล้ว' };
    } catch (e: any) {
        console.error('[IT Repair] edit save:', e?.message);
        return fail(set, 500, 'บันทึกการแก้ไขไม่สำเร็จ');
    }
};
