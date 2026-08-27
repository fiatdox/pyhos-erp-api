// ตรรกะกลางของ MFA — ใช้ร่วมกันระหว่าง authController และหน้าตั้งค่าของ admin
import { core_kon } from '../db/db';

export interface MfaSettings {
    enabled: boolean;
    scope: 'users' | 'roles' | 'all';
    roles: string[];
    otpTtlSeconds: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
    challengeTtlSeconds: number;
}

const DEFAULTS: MfaSettings = {
    enabled: false,
    scope: 'users',
    roles: [],
    otpTtlSeconds: 300,
    maxAttempts: 5,
    resendCooldownSeconds: 60,
    challengeTtlSeconds: 600,
};

// อ่านค่าตั้ง — ถ้าตารางยังไม่มี/พังด้วยเหตุใด ให้ถือว่า "ปิด" เพื่อไม่ให้ระบบ login ล่มทั้งระบบ
export async function getMfaSettings(): Promise<MfaSettings> {
    try {
        const rows = await core_kon`SELECT name, value FROM auth_settings`;
        const m = new Map(rows.map((r: any) => [r.name, r.value]));
        const num = (k: string, d: number) => {
            const n = Number(m.get(k));
            return Number.isFinite(n) && n > 0 ? n : d;
        };
        const scope = String(m.get('mfa_scope') ?? 'users');
        return {
            enabled: String(m.get('mfa_enabled') ?? 'false') === 'true',
            scope: (['users', 'roles', 'all'].includes(scope) ? scope : 'users') as MfaSettings['scope'],
            roles: String(m.get('mfa_roles') ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean),
            otpTtlSeconds: num('mfa_otp_ttl_seconds', 300),
            maxAttempts: num('mfa_max_attempts', 5),
            resendCooldownSeconds: num('mfa_resend_cooldown_seconds', 60),
            challengeTtlSeconds: num('mfa_challenge_ttl_seconds', 600),
        };
    } catch (e: any) {
        console.error('[MFA] อ่านค่าตั้งไม่สำเร็จ — ถือว่าปิด MFA:', e?.message);
        return { ...DEFAULTS };
    }
}

// ผู้ใช้คนนี้ต้องยืนยัน OTP หรือไม่
export async function isMfaRequiredFor(userId: number, settings: MfaSettings): Promise<boolean> {
    if (!settings.enabled) return false;
    if (settings.scope === 'all') return true;

    if (settings.scope === 'users') {
        const rows = await core_kon`SELECT 1 FROM auth_mfa_users WHERE user_id = ${userId} LIMIT 1`;
        return rows.length > 0;
    }

    // scope === 'roles'
    if (settings.roles.length === 0) return false;
    const rows = await core_kon`
        SELECT r.role_name
        FROM core_kon.user_m_users_roles mu
        LEFT JOIN core_kon.user_roles r ON r.id = mu.role_id
        WHERE mu.user_id = ${userId}`;
    const mine = rows.map((r: any) => String(r.role_name ?? '').toUpperCase());
    return mine.some(r => settings.roles.includes(r));
}

// OTP 6 หลัก จากตัวสุ่มเชิงเข้ารหัส (ไม่ใช้ Math.random)
export function generateOtp(): string {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return String(buf[0]! % 1_000_000).padStart(6, '0');
}

export const hashOtp = (otp: string) => Bun.password.hash(otp, 'argon2id');
export const verifyOtpHash = (otp: string, hash: string) => Bun.password.verify(otp, hash, 'argon2id');

export async function logMfa(entry: {
    userId?: number | null; username?: string | null; event: string;
    detail?: string | null; sendMs?: number | null; clientIp?: string | null;
}): Promise<void> {
    try {
        await core_kon`
            INSERT INTO auth_mfa_audit (user_id, username, event, detail, send_ms, client_ip)
            VALUES (${entry.userId ?? null}, ${entry.username ?? null}, ${entry.event},
                    ${entry.detail ?? null}, ${entry.sendMs ?? null}, ${entry.clientIp ?? null})`;
    } catch (e: any) {
        // audit ล้มเหลวต้องไม่ทำให้ login ล่ม
        console.error('[MFA] เขียน audit ไม่สำเร็จ:', e?.message);
    }
}
