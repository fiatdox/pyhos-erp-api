// ประชาสัมพันธ์งานทรัพยากรบุคคล + เอกสารระเบียบการลา (ตาราง hr_posts, หน้า /hr/leave)
// ทุกคนที่ล็อกอินอ่านได้เฉพาะที่เผยแพร่ ADMIN / HR เห็นทั้งหมดและจัดการได้
import { core_kon } from '../db/db';
import { join } from 'path';
import { mkdir } from 'fs/promises';

export const HR_POST_MANAGER_ROLES = ['ADMIN', 'HR'];

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'hr-posts');
const ALLOWED_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'jpg', 'jpeg', 'png'];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
// popup = ป๊อปอัปรูปภาพที่เด้งเมื่อผู้ใช้เข้าหน้าแรก / หน้างาน HR ต้องมีรูปแนบเสมอ
const KINDS = ['news', 'document', 'popup'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIME: Record<string, string> = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

const fail = (set: any, status: number, message: string) => {
    set.status = status;
    return { success: false, message };
};

const missingTable = (e: any) => e?.code === '42P01';
const MISSING_TABLE_MSG = 'ยังไม่ได้สร้างตาราง hr_posts — รันไฟล์ src/db/hr_posts.sql ก่อน';

async function isManager(userId: number): Promise<boolean> {
    const rows = await core_kon`
        SELECT r.role_name FROM core_kon.user_m_users_roles mu
        LEFT JOIN core_kon.user_roles r ON r.id = mu.role_id
        WHERE mu.user_id = ${userId}`;
    return rows.some((x: any) => HR_POST_MANAGER_ROLES.includes(String(x.role_name ?? '').toUpperCase()));
}

const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
const flag = (v: unknown) => v === true || v === 'true' || v === '1';
const text = (v: unknown, max: number) => {
    const s = typeof v === 'string' ? v.trim() : '';
    return s ? s.slice(0, max) : null;
};

const COLUMNS = core_kon`
    p.id, p.kind, p.title, p.body, p.category, p.link_url, p.original_name, p.file_size,
    (p.file_name IS NOT NULL) AS has_file, p.is_pinned, p.is_published, p.created_at, p.updated_at,
    to_char(p.show_from, 'YYYY-MM-DD') AS show_from, to_char(p.show_until, 'YYYY-MM-DD') AS show_until,
    NULLIF(TRIM(CONCAT(COALESCE(u.pname, ''), u.fname, ' ', u.lname)), '') AS updated_by_name`;

// หน้าอ่าน (/hr/leave) — เฉพาะข่าว/เอกสารที่เผยแพร่ ป๊อปอัปดึงแยกที่ getActiveHrPopups
export const getHrPosts = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT ${COLUMNS} FROM hr_posts p LEFT JOIN users u ON u.id = COALESCE(p.updated_by, p.created_by)
            WHERE p.is_active AND p.is_published AND p.kind <> 'popup'
            ORDER BY p.is_pinned DESC, p.created_at DESC`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[hr-posts] โหลดไม่สำเร็จ:', e?.message);
        return fail(set, 500, missingTable(e) ? MISSING_TABLE_MSG : 'โหลดข้อมูลไม่สำเร็จ');
    }
};

// หน้าจัดการ (/hr/leave/posts, ADMIN / HR) — ทุกรายการรวมที่ยังไม่เผยแพร่และป๊อปอัป
export const getHrPostsForManage = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT ${COLUMNS} FROM hr_posts p LEFT JOIN users u ON u.id = COALESCE(p.updated_by, p.created_by)
            WHERE p.is_active ORDER BY p.is_pinned DESC, p.created_at DESC`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[hr-posts] โหลดไม่สำเร็จ:', e?.message);
        return fail(set, 500, missingTable(e) ? MISSING_TABLE_MSG : 'โหลดข้อมูลไม่สำเร็จ');
    }
};

// ป๊อปอัปที่ถึงช่วงแสดงวันนี้ (เวลาไทย) — หน้าแรก / หน้างาน HR เรียกตอนเปิดหน้า
export const getActiveHrPopups = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT p.id, p.title, p.body, p.link_url, p.updated_at
            FROM hr_posts p
            WHERE p.kind = 'popup' AND p.is_active AND p.is_published AND p.file_name IS NOT NULL
              AND (p.show_from IS NULL OR p.show_from <= (NOW() AT TIME ZONE 'Asia/Bangkok')::date)
              AND (p.show_until IS NULL OR p.show_until >= (NOW() AT TIME ZONE 'Asia/Bangkok')::date)
            ORDER BY p.is_pinned DESC, p.created_at DESC
            LIMIT 5`;
        return { success: true, data: rows };
    } catch (e: any) {
        // ป๊อปอัปโหลดไม่ได้ไม่ควรกระทบหน้าที่เปิด — ตอบรายการว่าง
        if (!missingTable(e)) console.error('[hr-posts] โหลดป๊อปอัปไม่สำเร็จ:', e?.message);
        return { success: true, data: [] };
    }
};

/** ตรวจ + แปลงค่าจาก multipart form (ทุกช่องมาเป็น string) */
function parseBody(body: any): { error?: string; values?: any; file?: File | null } {
    const kind = String(body?.kind ?? '');
    if (!KINDS.includes(kind)) return { error: 'ประเภทไม่ถูกต้อง' };
    const title = text(body?.title, 300);
    if (!title) return { error: 'กรุณาระบุหัวข้อ' };
    const linkUrl = text(body?.link_url, 500);
    if (linkUrl && !/^https?:\/\//i.test(linkUrl)) return { error: 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://' };

    const file: File | null = body?.file instanceof File && body.file.size > 0 ? body.file : null;
    if (file) {
        if (!ALLOWED_EXT.includes(extOf(file.name))) return { error: `ไฟล์ต้องเป็น ${ALLOWED_EXT.join(', ')}` };
        if (file.size > MAX_FILE_BYTES) return { error: 'ไฟล์มีขนาดเกิน 20MB' };
        if (kind === 'popup' && !IMAGE_EXT.includes(extOf(file.name))) return { error: 'ป๊อปอัปต้องแนบรูป jpg หรือ png' };
    }
    // ช่วงวันที่แสดงป๊อปอัป (รวมทั้งสองวัน) — ว่าง = ไม่จำกัด
    const showFrom = kind === 'popup' ? text(body?.show_from, 10) : null;
    const showUntil = kind === 'popup' ? text(body?.show_until, 10) : null;
    if ((showFrom && !DATE_RE.test(showFrom)) || (showUntil && !DATE_RE.test(showUntil))) return { error: 'วันที่แสดงไม่ถูกต้อง' };
    if (showFrom && showUntil && showFrom > showUntil) return { error: 'วันเริ่มแสดงต้องไม่หลังวันสิ้นสุด' };
    return {
        file,
        values: {
            kind, title,
            body: text(body?.body, 20000),
            category: kind === 'document' ? text(body?.category, 100) : null,
            link_url: linkUrl,
            is_pinned: flag(body?.is_pinned),
            is_published: body?.is_published === undefined ? true : flag(body?.is_published),
            show_from: showFrom,
            show_until: showUntil,
        },
    };
}

async function saveFile(file: File) {
    await mkdir(UPLOAD_DIR, { recursive: true });
    const stored = `${crypto.randomUUID()}.${extOf(file.name)}`;
    await Bun.write(join(UPLOAD_DIR, stored), file);
    return { file_name: stored, original_name: file.name.slice(0, 255), file_size: file.size };
}

export const createHrPost = async ({ body, user, set }: any) => {
    const parsed = parseBody(body);
    if (parsed.error) return fail(set, 400, parsed.error);
    if (parsed.values.kind === 'popup' && !parsed.file) return fail(set, 400, 'ป๊อปอัปต้องแนบรูป');
    try {
        const f = parsed.file ? await saveFile(parsed.file) : { file_name: null, original_name: null, file_size: null };
        const v = parsed.values;
        const [row] = await core_kon`
            INSERT INTO hr_posts (kind, title, body, category, link_url, file_name, original_name, file_size,
                                  is_pinned, is_published, show_from, show_until, created_by)
            VALUES (${v.kind}, ${v.title}, ${v.body}, ${v.category}, ${v.link_url}, ${f.file_name}, ${f.original_name},
                    ${f.file_size}, ${v.is_pinned}, ${v.is_published}, ${v.show_from}, ${v.show_until}, ${user.id})
            RETURNING id`;
        set.status = 201;
        return { success: true, data: { id: row.id } };
    } catch (e: any) {
        console.error('[hr-posts] เพิ่มไม่สำเร็จ:', e?.message);
        return fail(set, 500, missingTable(e) ? MISSING_TABLE_MSG : 'บันทึกไม่สำเร็จ');
    }
};

export const updateHrPost = async ({ params, body, user, set }: any) => {
    const parsed = parseBody(body);
    if (parsed.error) return fail(set, 400, parsed.error);
    try {
        const id = Number(params.id);
        const [cur] = await core_kon`SELECT id, file_name FROM hr_posts WHERE id = ${id} AND is_active`;
        if (!cur) return fail(set, 404, 'ไม่พบรายการ');
        const v = parsed.values;
        if (v.kind === 'popup' && !parsed.file
            && (flag(body?.remove_file) || !cur.file_name || !IMAGE_EXT.includes(extOf(cur.file_name)))) {
            return fail(set, 400, 'ป๊อปอัปต้องแนบรูป jpg หรือ png');
        }
        // ไฟล์ใหม่แทนไฟล์เดิม / remove_file = ลบไฟล์แนบออก / ไม่ส่งทั้งคู่ = คงไฟล์เดิม
        const fileFrag = parsed.file
            ? (({ file_name, original_name, file_size }) =>
                core_kon`, file_name = ${file_name}, original_name = ${original_name}, file_size = ${file_size}`)(await saveFile(parsed.file))
            : flag(body?.remove_file)
                ? core_kon`, file_name = NULL, original_name = NULL, file_size = NULL`
                : core_kon``;
        await core_kon`
            UPDATE hr_posts SET kind = ${v.kind}, title = ${v.title}, body = ${v.body}, category = ${v.category},
                   link_url = ${v.link_url}, is_pinned = ${v.is_pinned}, is_published = ${v.is_published},
                   show_from = ${v.show_from}, show_until = ${v.show_until},
                   updated_by = ${user.id}, updated_at = NOW() ${fileFrag}
            WHERE id = ${id}`;
        return { success: true, data: { id } };
    } catch (e: any) {
        console.error('[hr-posts] แก้ไขไม่สำเร็จ:', e?.message);
        return fail(set, 500, missingTable(e) ? MISSING_TABLE_MSG : 'บันทึกไม่สำเร็จ');
    }
};

export const deleteHrPost = async ({ params, user, set }: any) => {
    try {
        const rows = await core_kon`
            UPDATE hr_posts SET is_active = FALSE, updated_by = ${user.id}, updated_at = NOW()
            WHERE id = ${Number(params.id)} AND is_active RETURNING id`;
        if (!rows.length) return fail(set, 404, 'ไม่พบรายการ');
        return { success: true };
    } catch (e: any) {
        console.error('[hr-posts] ลบไม่สำเร็จ:', e?.message);
        return fail(set, 500, 'ลบไม่สำเร็จ');
    }
};

export const getHrPostFile = async ({ params, user, set }: any) => {
    try {
        const [p] = await core_kon`
            SELECT file_name, original_name, is_published FROM hr_posts
            WHERE id = ${Number(params.id)} AND is_active AND file_name IS NOT NULL`;
        // รายการที่ยังไม่เผยแพร่ ให้เปิดได้เฉพาะผู้จัดการ — ตอบ 404 เหมือนไม่มี ไม่บอกว่ามีอยู่
        if (!p || (!p.is_published && !(await isManager(Number(user?.id))))) return fail(set, 404, 'ไม่พบไฟล์');
        const file = Bun.file(join(UPLOAD_DIR, p.file_name));
        if (!(await file.exists())) return fail(set, 404, 'ไฟล์หายไปจากระบบ');
        const ext = extOf(p.file_name);
        set.headers['content-type'] = MIME[ext] ?? 'application/octet-stream';
        // inline — PDF/รูปเปิดในแท็บใหม่ได้เลย ชนิดอื่นเบราว์เซอร์ดาวน์โหลดเอง
        set.headers['content-disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(p.original_name ?? p.file_name)}`;
        return file;
    } catch (e: any) {
        console.error('[hr-posts] เปิดไฟล์ไม่สำเร็จ:', e?.message);
        return fail(set, 500, 'เปิดไฟล์ไม่สำเร็จ');
    }
};
