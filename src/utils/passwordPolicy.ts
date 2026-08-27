// นโยบายอายุรหัสผ่าน — บังคับเปลี่ยนรหัสผ่านทุก N วัน
import { core_kon } from '../db/db';

export interface PasswordPolicy {
    enabled: boolean;
    expiryDays: number;
    warnDays: number;
}

const DEFAULTS: PasswordPolicy = { enabled: false, expiryDays: 90, warnDays: 7 };

// อ่านค่าตั้ง — พังเมื่อไหร่ให้ถือว่า "ปิด" เพื่อไม่ให้ระบบ login ล่มทั้งองค์กร
export async function getPasswordPolicy(): Promise<PasswordPolicy> {
    try {
        const rows = await core_kon`
            SELECT name, value FROM auth_settings
            WHERE name IN ('password_expiry_enabled', 'password_expiry_days', 'password_expiry_warn_days')`;
        const m = new Map(rows.map((r: any) => [r.name, r.value]));
        const num = (k: string, d: number) => {
            const n = Number(m.get(k));
            return Number.isFinite(n) && n > 0 ? n : d;
        };
        return {
            enabled: String(m.get('password_expiry_enabled') ?? 'false') === 'true',
            expiryDays: num('password_expiry_days', 90),
            warnDays: num('password_expiry_warn_days', 7),
        };
    } catch (e: any) {
        console.error('[PasswordPolicy] อ่านค่าตั้งไม่สำเร็จ — ถือว่าปิด:', e?.message);
        return { ...DEFAULTS };
    }
}

export interface PasswordStatus {
    expired: boolean;            // เกินกำหนดแล้ว — เตือนให้เปลี่ยน (ไม่บล็อกการใช้งาน)
    daysLeft: number | null;     // null = ปิดนโยบายอยู่
    ageDays: number | null;      // ใช้งานรหัสผ่านนี้มากี่วันแล้ว (นับจากวันเปลี่ยนล่าสุด)
    changedAt: string | null;    // วันที่เปลี่ยนรหัสผ่านล่าสุด
    expiresAt: string | null;
    shouldWarn: boolean;         // ใกล้ครบกำหนด
}

const DAY_MS = 86_400_000;
const OFF: PasswordStatus = {
    expired: false, daysLeft: null, ageDays: null, changedAt: null, expiresAt: null, shouldWarn: false,
};

// คำนวณสถานะรหัสผ่านของผู้ใช้ 1 คน จาก "จำนวนวันนับจากวันเปลี่ยนรหัสล่าสุด"
// changedAt เป็น null (ผู้ดูแลตั้งรหัสให้/ผู้ใช้สร้างใหม่) → ถือว่าถึงกำหนดต้องตั้งรหัสของตัวเอง
export function evaluatePassword(changedAt: Date | string | null, policy: PasswordPolicy): PasswordStatus {
    if (!policy.enabled) return { ...OFF };
    if (!changedAt) return { ...OFF, expired: true, daysLeft: 0, shouldWarn: true };

    const changed = new Date(changedAt).getTime();
    if (Number.isNaN(changed)) return { ...OFF, expired: true, daysLeft: 0, shouldWarn: true };

    const ageDays = Math.floor((Date.now() - changed) / DAY_MS);
    const expiresAt = changed + policy.expiryDays * DAY_MS;
    const msLeft = expiresAt - Date.now();
    const daysLeft = Math.ceil(msLeft / DAY_MS);

    return {
        expired: msLeft <= 0,
        daysLeft: Math.max(0, daysLeft),
        ageDays,
        changedAt: new Date(changed).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        shouldWarn: msLeft > 0 && daysLeft <= policy.warnDays,
    };
}
