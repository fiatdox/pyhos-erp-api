// ทะเบียนโมดูล — เปิด/ปิดการมองเห็นแต่ละระบบจากหน้าผู้ดูแลระบบ
//
// รายการเปิด/ปิดถูกอ่านทุกครั้งที่ผู้ใช้เปลี่ยนหน้า (Navbar + หน้าหลัก) จึงแคชไว้ในหน่วยความจำ
// ไม่งั้นจะกลายเป็นคิวรีเพิ่มต่อ 1 request ของผู้ใช้ทั้งองค์กร
import { core_kon } from '../db/db';

export interface AppModule {
    module_key: string;
    label: string;
    group_label: string;
    route_prefix: string;
    enabled: boolean;
    sort: number;
    note: string | null;
    updated_at: string | null;
    updated_by: string | null;
}

const CACHE_TTL_MS = 30_000;
let cache: { at: number; disabled: string[] } | null = null;

/** ล้างแคชทันทีที่มีการบันทึก — ไม่ต้องรอ TTL หมด */
const invalidate = () => { cache = null; };

/**
 * เส้นทางของโมดูลที่ถูกปิดอยู่ (route_prefix)
 * ล้มเหลว = คืนรายการว่าง (ถือว่าเปิดหมด) — สวิตช์นี้ต้องไม่ทำให้เมนูหายทั้งระบบเพราะ DB สะดุด
 */
export async function getDisabledPrefixes(): Promise<string[]> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.disabled;
    try {
        const rows = await core_kon`
            SELECT route_prefix FROM app_modules WHERE enabled <> 'Y'`;
        const disabled = rows.map((r: any) => String(r.route_prefix));
        cache = { at: Date.now(), disabled };
        return disabled;
    } catch (e: any) {
        console.error('[modules] อ่านทะเบียนโมดูลไม่สำเร็จ:', e?.message);
        return [];
    }
}

// ── ผู้ใช้ทั่วไป: รายการเส้นทางที่ถูกปิด (ใช้กรองเมนูฝั่งหน้าเว็บ) ──────────────
export const getDisabledModules = async () => {
    const disabled = await getDisabledPrefixes();
    return { success: true, data: { disabled } };
};

// ── ผู้ดูแลระบบ: ทะเบียนโมดูลทั้งหมดพร้อมสถานะ ──────────────────────────────
export const getModules = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT module_key, label, group_label, route_prefix, enabled, sort, note, updated_at, updated_by
            FROM app_modules
            ORDER BY group_label, sort, label`;
        const data: AppModule[] = rows.map((r: any) => ({
            module_key: r.module_key,
            label: r.label,
            group_label: r.group_label,
            route_prefix: r.route_prefix,
            enabled: String(r.enabled) === 'Y',
            sort: Number(r.sort ?? 0),
            note: r.note ?? null,
            updated_at: r.updated_at ?? null,
            updated_by: r.updated_by ?? null,
        }));
        return { success: true, data };
    } catch (e: any) {
        console.error('[modules] อ่านทะเบียนโมดูลไม่สำเร็จ:', e?.message);
        set.status = 500;
        return { success: false, message: 'อ่านทะเบียนโมดูลไม่สำเร็จ' };
    }
};

// ── ผู้ดูแลระบบ: บันทึกสถานะเปิด/ปิด (ส่งมาทีเดียวทั้งชุด) ────────────────────
export const updateModules = async ({ body, user, set }: any) => {
    try {
        const items = Array.isArray(body?.modules) ? body.modules : [];
        if (items.length === 0) {
            set.status = 400;
            return { success: false, message: 'ไม่มีรายการที่จะบันทึก' };
        }

        // ตรวจก่อนเขียน — คีย์ที่ไม่มีในทะเบียนถือว่าผิดพลาด ไม่เขียนอะไรเลยสักรายการ
        const keys = items.map((m: any) => String(m?.module_key ?? ''));
        const known = await core_kon`SELECT module_key FROM app_modules WHERE module_key = ANY(${keys})`;
        const knownSet = new Set(known.map((r: any) => String(r.module_key)));
        const unknown = keys.filter((k: string) => !knownSet.has(k));
        if (unknown.length > 0) {
            set.status = 400;
            return { success: false, message: `ไม่รู้จักโมดูล: ${unknown.join(', ')}` };
        }

        const actor = String(user?.username ?? '').slice(0, 100);
        let changed = 0;
        for (const m of items) {
            const key = String(m.module_key);
            const enabled = m.enabled === true || String(m.enabled) === 'Y' ? 'Y' : 'N';
            const res = await core_kon`
                UPDATE app_modules
                SET enabled = ${enabled}, updated_at = NOW(), updated_by = ${actor}
                WHERE module_key = ${key} AND enabled <> ${enabled}`;
            changed += res.count ?? 0;
        }

        invalidate();
        const disabled = await getDisabledPrefixes();
        return {
            success: true,
            data: { changed, disabled_count: disabled.length },
            message: changed > 0 ? `บันทึกแล้ว ${changed} รายการ` : 'ไม่มีรายการที่เปลี่ยนแปลง',
        };
    } catch (e: any) {
        console.error('[modules] บันทึกทะเบียนโมดูลไม่สำเร็จ:', e?.message);
        set.status = 500;
        return { success: false, message: 'บันทึกไม่สำเร็จ' };
    }
};
