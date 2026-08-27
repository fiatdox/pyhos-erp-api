// นโยบายชื่อผู้ใช้ — บังคับ/เตือนให้เปลี่ยน username ที่เป็นเลขบัตรประชาชน
// ใช้ร่วมกันระหว่าง authController (ตอน login), authMiddleware (ด่านบังคับ) และหน้าตั้งค่าของ admin
import { core_kon } from '../db/db';

export type UsernamePolicyMode = 'off' | 'warn' | 'force';

export interface UsernamePolicy {
    mode: UsernamePolicyMode;
    scope: 'all' | 'pilot';
    pilot: string[];            // username ตัวพิมพ์เล็ก
}

const DEFAULTS: UsernamePolicy = { mode: 'off', scope: 'pilot', pilot: [] };

// อ่านค่าตั้ง — พังเมื่อไหร่ให้ถือว่า "ปิด" เพื่อไม่ให้ระบบ login ล่มทั้งองค์กร
export async function getUsernamePolicy(): Promise<UsernamePolicy> {
    try {
        const rows = await core_kon`
            SELECT name, value FROM auth_settings
            WHERE name IN ('username_policy_mode', 'username_policy_scope', 'username_policy_pilot')`;
        const m = new Map(rows.map((r: any) => [r.name, r.value]));
        const mode = String(m.get('username_policy_mode') ?? 'off');
        const scope = String(m.get('username_policy_scope') ?? 'pilot');
        return {
            mode: (['off', 'warn', 'force'].includes(mode) ? mode : 'off') as UsernamePolicyMode,
            scope: (scope === 'all' ? 'all' : 'pilot'),
            pilot: String(m.get('username_policy_pilot') ?? '')
                .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
        };
    } catch (e: any) {
        console.error('[UsernamePolicy] อ่านค่าตั้งไม่สำเร็จ — ถือว่าปิด:', e?.message);
        return { ...DEFAULTS };
    }
}

// ชื่อผู้ใช้ "อ่อน" = ตรงกับเลขบัตรประชาชนของเจ้าของบัญชีเอง
export function isUsernameWeak(username: string | null, idCard: string | null): boolean {
    const u = String(username ?? '').trim();
    const c = String(idCard ?? '').trim();
    return u.length > 0 && c.length > 0 && u === c;
}

export interface UsernameStatus {
    weak: boolean;       // username = เลขบัตร
    inScope: boolean;    // อยู่ในขอบเขตที่นโยบายมีผล
    warn: boolean;       // แสดงแถบเตือน (ใช้งานต่อได้)
    required: boolean;   // ต้องตั้งชื่อใหม่ก่อนจึงใช้งานระบบต่อได้
    mode: UsernamePolicyMode;
}

export function evaluateUsername(
    username: string | null, idCard: string | null, policy: UsernamePolicy,
): UsernameStatus {
    const weak = isUsernameWeak(username, idCard);
    const inScope = policy.scope === 'all'
        || policy.pilot.includes(String(username ?? '').trim().toLowerCase());
    const active = weak && inScope && policy.mode !== 'off';
    return {
        weak,
        inScope,
        warn: active && policy.mode === 'warn',
        required: active && policy.mode === 'force',
        mode: policy.mode,
    };
}

// ── กติกาของชื่อผู้ใช้ใหม่ ────────────────────────────────────────────────────
// ต้องตรงกับที่หน้าเว็บแสดง และกับ userCredentialController (ผู้ดูแลตั้งให้)
export const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{4,50}$/;

export interface UsernameCheck { ok: boolean; message: string }

export function checkUsername(value: string, opts?: { idCard?: string | null }): UsernameCheck {
    const v = String(value ?? '').trim();
    if (!USERNAME_PATTERN.test(v))
        return { ok: false, message: 'ชื่อผู้ใช้ต้องยาว 4-50 ตัว ใช้ได้เฉพาะ a-z A-Z 0-9 . _ -' };
    // กันตั้งกลับเป็นเลขบัตร หรือเป็นตัวเลขล้วน 13 หลัก (เดาว่าเป็นเลขบัตรคนอื่น)
    if (/^\d{13}$/.test(v))
        return { ok: false, message: 'ชื่อผู้ใช้ต้องไม่เป็นตัวเลข 13 หลัก (รูปแบบเลขบัตรประชาชน)' };
    const idCard = String(opts?.idCard ?? '').trim();
    if (idCard && v === idCard)
        return { ok: false, message: 'ชื่อผู้ใช้ต้องไม่เป็นเลขบัตรประชาชน' };
    return { ok: true, message: '' };
}
