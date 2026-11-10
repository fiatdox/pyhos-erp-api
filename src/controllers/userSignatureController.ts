// ลายเซ็นของผู้ใช้ — ตั้งเองที่หน้า ตั้งค่าบัญชี > ลายเซ็น · ตาราง src/db/user_signatures.sql
// อ่าน/แก้ได้เฉพาะของตัวเอง (identity จาก JWT) · เอกสารที่ลงนามแล้วเก็บสำเนาภาพไว้เอง
import { core_kon } from '../db/db';

const MAX_BYTES = 200 * 1024;          // PNG หลังย่อจากหน้าเว็บปกติ < 30KB
const MIN_W = 40, MIN_H = 16, MAX_W = 1200, MAX_H = 600;
const PREFIX = 'data:image/png;base64,';
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const fail = (set: any, status: number, message: string) => { set.status = status; return { success: false, message }; };

/** ตรวจ data URL ว่าเป็น PNG จริง ขนาด/มิติอยู่ในเกณฑ์ — คืนมิติภาพ หรือข้อความผิดพลาด */
export const checkSignature = (v: unknown): { width: number; height: number } | string => {
    if (typeof v !== 'string' || !v.startsWith(PREFIX)) return 'ลายเซ็นต้องเป็นภาพ PNG';
    const b64 = v.slice(PREFIX.length);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return 'ข้อมูลภาพไม่ถูกต้อง';
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > MAX_BYTES) return `ภาพลายเซ็นใหญ่เกิน ${MAX_BYTES / 1024} KB`;
    if (buf.length < 33 || PNG_MAGIC.some((b, i) => buf[i] !== b) || buf.toString('ascii', 12, 16) !== 'IHDR') return 'ลายเซ็นต้องเป็นภาพ PNG';
    const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
    if (width < MIN_W || height < MIN_H || width > MAX_W || height > MAX_H) return `ขนาดภาพลายเซ็นต้องอยู่ระหว่าง ${MIN_W}×${MIN_H} ถึง ${MAX_W}×${MAX_H} พิกเซล`;
    return { width, height };
};

/** ลายเซ็นปัจจุบันของผู้ใช้ (data URL) — ใช้ตอนลงนามเอกสาร · ส่ง sql ของ transaction มาได้ */
export const signatureOf = async (s: any, uid: number): Promise<string | null> =>
    (await s`SELECT image FROM user_signatures WHERE user_id = ${uid}`)[0]?.image ?? null;

export const getMySignature = async ({ user, set }: any) => {
    try {
        const [row] = await core_kon`SELECT image, width, height, updated_at FROM user_signatures WHERE user_id = ${Number(user?.id)}`;
        return { success: true, data: row ?? null };
    } catch (e: any) {
        console.error('[signature] get:', e?.message);
        return fail(set, 500, 'โหลดลายเซ็นไม่สำเร็จ');
    }
};

// body { image: 'data:image/png;base64,...' }
export const setMySignature = async ({ body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const dim = checkSignature(body?.image);
        if (typeof dim === 'string') return fail(set, 400, dim);
        await core_kon.begin(async (sql: any) => {
            await sql`INSERT INTO user_signatures (user_id, image, width, height) VALUES (${uid}, ${body.image}, ${dim.width}, ${dim.height})
                ON CONFLICT (user_id) DO UPDATE SET image = EXCLUDED.image, width = EXCLUDED.width, height = EXCLUDED.height, updated_at = NOW()`;
            await sql`INSERT INTO user_signature_log (user_id, action) VALUES (${uid}, 'set')`;
        });
        return { success: true, data: { ...dim, updated_at: new Date() }, message: 'บันทึกลายเซ็นแล้ว' };
    } catch (e: any) {
        console.error('[signature] set:', e?.message);
        return fail(set, 500, 'บันทึกลายเซ็นไม่สำเร็จ');
    }
};

export const deleteMySignature = async ({ user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const deleted = await core_kon.begin(async (sql: any) => {
            const r = await sql`DELETE FROM user_signatures WHERE user_id = ${uid}`;
            if (r.count) await sql`INSERT INTO user_signature_log (user_id, action) VALUES (${uid}, 'delete')`;
            return r.count > 0;
        });
        return { success: true, data: { deleted } };
    } catch (e: any) {
        console.error('[signature] delete:', e?.message);
        return fail(set, 500, 'ลบลายเซ็นไม่สำเร็จ');
    }
};
