// เดินทางไปราชการ — ไฟล์แนบของคำขอ · ตาราง src/db/hrd_travel_files.sql
//   source = หนังสือต้นเรื่อง · plane = หนังสืออนุมัติเดินทางโดยเครื่องบิน · private_car = หนังสือขออนุมัติใช้รถยนต์ส่วนตัว
// เก็บที่ uploads/hrd-travel/<uuid>.<ext> · ดูได้ = ผู้มีสิทธิ์ดูคำขอ (canView)
// แนบ/ลบ = ผู้ขอ หรือ ADMIN/HRD ขณะคำขอยังเป็น submitted (ยกเลิก/ไม่อนุมัติแล้วแก้ไม่ได้ — เก็บเป็นหลักฐาน)
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { core_kon } from '../db/db';
import { canManage } from './hrdTravelController';
import { canViewRequest } from './hrdTravelRequestController';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'hrd-travel');
await mkdir(UPLOAD_DIR, { recursive: true }).catch(() => {});

export const FILE_KINDS = ['source', 'plane', 'private_car', 'vehicle_use'] as const;
type Kind = typeof FILE_KINDS[number];
const KIND_LABEL: Record<Kind, string> = { source: 'หนังสือต้นเรื่อง', plane: 'หนังสืออนุมัติเดินทางโดยเครื่องบิน', private_car: 'หนังสือขออนุมัติใช้รถยนต์ส่วนตัว', vehicle_use: 'หนังสือขออนุมัติใช้รถ' };
const MIME: Record<string, string> = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
};
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PER_KIND = 5;

const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, ...(field ? { field } : {}) }; };

/** คำขอที่แก้ไฟล์แนบได้ (ผู้ขอ / ADMIN / HRD · ยังเป็น submitted) */
const editable = async (uid: number, id: number) => {
    const [r] = await core_kon`SELECT id, requester_id, status FROM hrd_travel_requests WHERE id = ${id}`;
    if (!r) return { error: [404, 'ไม่พบคำขอ'] as const };
    if (r.requester_id !== uid && !(await canManage(uid))) return { error: [403, 'แนบไฟล์ได้เฉพาะผู้ขอ หรือเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล'] as const };
    if (r.status !== 'submitted') return { error: [409, 'คำขอนี้ยกเลิกหรือไม่อนุมัติแล้ว แก้ไฟล์แนบไม่ได้'] as const };
    return { r };
};

// POST /requests/:id/files (multipart: kind, file)
export const uploadRequestFile = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const kind = String(body?.kind ?? '') as Kind;
        if (!FILE_KINDS.includes(kind)) return fail(set, 400, 'ประเภทไฟล์แนบไม่ถูกต้อง', 'kind');
        const file: File | null = body?.file instanceof File && body.file.size > 0 ? body.file : null;
        if (!file) return fail(set, 400, 'กรุณาเลือกไฟล์', 'file');
        // นามสกุลจากชื่อไฟล์ ไม่มีก็ดูจากชนิดไฟล์ (ไฟล์จากมือถือบางทีไม่มีนามสกุล)
        const nameExt = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
        const ext = MIME[nameExt] ? nameExt : (Object.keys(MIME).find(k => MIME[k] === String(file.type).toLowerCase()) ?? '');
        if (!MIME[ext]) return fail(set, 400, 'ไฟล์แนบต้องเป็น PDF หรือรูปภาพ (jpg, png, webp, heic)', 'file');
        if (file.size > MAX_BYTES) return fail(set, 400, 'ไฟล์แนบมีขนาดเกิน 10MB', 'file');
        const ok = await editable(uid, Number(params.id));
        if (ok.error) return fail(set, ok.error[0], ok.error[1]);
        const [{ n }] = await core_kon`SELECT count(*)::int AS n FROM hrd_travel_request_files WHERE request_id = ${ok.r.id} AND kind = ${kind}`;
        if (n >= MAX_PER_KIND) return fail(set, 400, `${KIND_LABEL[kind]}แนบได้ไม่เกิน ${MAX_PER_KIND} ไฟล์`, 'file');

        const stored = `${crypto.randomUUID()}.${ext}`;
        await Bun.write(join(UPLOAD_DIR, stored), file);
        try {
            const original = (file.name.split(/[\\/]/).pop() || `file.${ext}`).slice(0, 255);
            const [row] = await core_kon`INSERT INTO hrd_travel_request_files (request_id, kind, file_name, original_name, mime, size_bytes, uploaded_by)
                VALUES (${ok.r.id}, ${kind}, ${stored}, ${original}, ${MIME[ext]}, ${file.size}, ${uid}) RETURNING id`;
            set.status = 201;
            return { success: true, data: { id: row.id } };
        } catch (e) {
            await unlink(join(UPLOAD_DIR, stored)).catch(() => {});
            throw e;
        }
    } catch (e: any) {
        console.error('[hrdFile] upload:', e?.message);
        return fail(set, 500, 'แนบไฟล์ไม่สำเร็จ');
    }
};

// GET /requests/:id/files/:fileId — สตรีมไฟล์ (ไม่มีสิทธิ์ = 404 ไม่บอกว่ามีไฟล์)
export const getRequestFile = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [f] = await core_kon`SELECT f.file_name, f.original_name, f.mime, r.id, r.requester_id, r.sign_mode, r.approval_chain
            FROM hrd_travel_request_files f JOIN hrd_travel_requests r ON r.id = f.request_id
            WHERE f.id = ${Number(params.fileId)} AND f.request_id = ${Number(params.id)}`;
        if (!f || !(await canViewRequest(uid, f))) return fail(set, 404, 'ไม่พบไฟล์แนบ');
        const name = String(f.file_name).split(/[\\/]/).pop()!;
        const file = Bun.file(join(UPLOAD_DIR, name));
        if (!(await file.exists())) return fail(set, 404, 'ไม่พบไฟล์ในเซิร์ฟเวอร์');
        set.headers['content-type'] = f.mime;
        set.headers['content-disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(f.original_name)}`;
        set.headers['x-content-type-options'] = 'nosniff';
        return file;
    } catch (e: any) {
        console.error('[hrdFile] get:', e?.message);
        return fail(set, 500, 'เปิดไฟล์ไม่สำเร็จ');
    }
};

// POST /requests/:id/files/:fileId/delete
export const deleteRequestFile = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const ok = await editable(uid, Number(params.id));
        if (ok.error) return fail(set, ok.error[0], ok.error[1]);
        const [f] = await core_kon`DELETE FROM hrd_travel_request_files WHERE id = ${Number(params.fileId)} AND request_id = ${ok.r.id} RETURNING file_name`;
        if (!f) return fail(set, 404, 'ไม่พบไฟล์แนบ');
        await unlink(join(UPLOAD_DIR, String(f.file_name).split(/[\\/]/).pop()!)).catch(() => {});
        return { success: true, data: { deleted: true } };
    } catch (e: any) {
        console.error('[hrdFile] delete:', e?.message);
        return fail(set, 500, 'ลบไฟล์ไม่สำเร็จ');
    }
};
