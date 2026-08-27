// หน้าตั้งค่า MFA สำหรับผู้ดูแลระบบ — เปิด/ปิด, กำหนดขอบเขต, จัดการรายชื่อผู้ทดสอบ, ดู audit
import { core_kon } from '../db/db';
import { getMfaSettings, logMfa } from '../utils/mfa';
import { getPasswordPolicy } from '../utils/passwordPolicy';
import { getUsernamePolicy } from '../utils/usernamePolicy';

const err = (set: any, status: number, message: string) => {
    set.status = status;
    return { success: false, message };
};

const ALLOWED_KEYS = new Set([
    'mfa_enabled', 'mfa_scope', 'mfa_roles',
    'mfa_otp_ttl_seconds', 'mfa_max_attempts',
    'mfa_resend_cooldown_seconds', 'mfa_challenge_ttl_seconds',
    'password_expiry_enabled', 'password_expiry_days', 'password_expiry_warn_days',
    'username_policy_mode', 'username_policy_scope', 'username_policy_pilot',
]);

export const getMfaConfig = async ({ set }: any) => {
    try {
        const [settings, passwordPolicy, usernamePolicy, rows, members] = await Promise.all([
            getMfaSettings(),
            getPasswordPolicy(),
            getUsernamePolicy(),
            core_kon`SELECT name, value, description, updated_at, updated_by FROM auth_settings ORDER BY name`,
            core_kon`
                SELECT m.user_id, m.added_at,
                       u.username, CONCAT(u.pname, u.fname, ' ', u.lname) AS name,
                       up.position_name,
                       (u.id_card IS NOT NULL AND LENGTH(TRIM(u.id_card)) = 13) AS has_valid_idcard
                FROM auth_mfa_users m
                LEFT JOIN users u ON u.id = m.user_id
                LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
                ORDER BY u.username`,
        ]);
        // สรุปผลกระทบของนโยบายรหัสผ่านตามค่าที่ตั้งไว้ปัจจุบัน (ให้ admin เห็นก่อนเปิดใช้)
        const [pwdImpact] = await core_kon`
            SELECT
                COUNT(*)::int AS active_users,
                COUNT(*) FILTER (WHERE password_changed_at IS NULL)::int AS never_changed,
                COUNT(*) FILTER (WHERE password_changed_at IS NOT NULL
                    AND password_changed_at < NOW() - MAKE_INTERVAL(days => ${passwordPolicy.expiryDays}))::int AS already_expired
            FROM users WHERE is_active = 'Y'`;

        // ผู้ที่ใช้เลขบัตรเป็นชื่อผู้ใช้ — ตัวเลขที่ admin ต้องเห็นก่อนสลับโหมดเป็น force
        const [unameImpact] = await core_kon`
            SELECT COUNT(*)::int AS active_users,
                   COUNT(*) FILTER (WHERE username = id_card)::int AS username_is_id_card
            FROM users WHERE is_active = 'Y'`;

        return { success: true, data: { settings, passwordPolicy, pwdImpact, usernamePolicy, unameImpact, raw: rows, members } };
    } catch (e: any) {
        console.error('[mfaAdmin] getMfaConfig:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

export const updateMfaConfig = async ({ body, user, set }: any) => {
    try {
        const entries = Object.entries(body ?? {}).filter(([k]) => ALLOWED_KEYS.has(k));
        if (entries.length === 0) return err(set, 400, 'ไม่มีค่าที่แก้ไขได้ในคำขอ');

        // กันตั้งค่าที่ทำให้ระบบใช้ไม่ได้
        for (const [k, v] of entries) {
            const s = String(v);
            if ((k === 'mfa_enabled' || k === 'password_expiry_enabled') && !['true', 'false'].includes(s))
                return err(set, 400, `${k} ต้องเป็น true หรือ false`);
            if (k === 'mfa_scope' && !['users', 'roles', 'all'].includes(s)) return err(set, 400, 'mfa_scope ต้องเป็น users, roles หรือ all');
            if (k.endsWith('_seconds') || k === 'mfa_max_attempts' || k.endsWith('_days')) {
                const n = Number(s);
                if (!Number.isFinite(n) || n <= 0) return err(set, 400, `${k} ต้องเป็นตัวเลขมากกว่า 0`);
            }
            if (k === 'password_expiry_days' && Number(s) > 3650) return err(set, 400, 'อายุรหัสผ่านต้องไม่เกิน 3650 วัน');
            if (k === 'username_policy_mode' && !['off', 'warn', 'force'].includes(s))
                return err(set, 400, 'username_policy_mode ต้องเป็น off, warn หรือ force');
            if (k === 'username_policy_scope' && !['all', 'pilot'].includes(s))
                return err(set, 400, 'username_policy_scope ต้องเป็น all หรือ pilot');
        }

        const next = Object.fromEntries(entries.map(([k, v]) => [k, String(v)]));

        // เปิด MFA แบบ scope=users แต่ยังไม่มีรายชื่อ = เปิดแล้วไม่มีผลกับใครเลย — เตือนไว้ ไม่ได้บล็อก
        let warning: string | null = null;
        const current = await getMfaSettings();
        const enabled = next.mfa_enabled ?? String(current.enabled);
        const scope = next.mfa_scope ?? current.scope;
        if (enabled === 'true' && scope === 'users') {
            const [c] = await core_kon`SELECT COUNT(*)::int AS n FROM auth_mfa_users`;
            if (c.n === 0) warning = 'เปิด MFA แล้ว แต่ยังไม่มีรายชื่อผู้ใช้ในขอบเขต — จะยังไม่มีผลกับใคร';
        }
        if (enabled === 'true' && scope === 'all') {
            warning = 'คำเตือน: บังคับ MFA กับผู้ใช้ทุกคน — ผู้ที่ยังไม่ได้เพิ่มเพื่อน/ผูกบัญชี Line หมอพร้อมจะเข้าระบบไม่ได้';
        }

        // เปิดนโยบายอายุรหัสผ่าน — บอกจำนวนคนที่จะถูกบังคับเปลี่ยนทันที
        if (next.password_expiry_enabled === 'true' || next.password_expiry_days) {
            const days = Number(next.password_expiry_days ?? (await getPasswordPolicy()).expiryDays);
            const [imp] = await core_kon`
                SELECT COUNT(*) FILTER (WHERE password_changed_at IS NULL
                        OR password_changed_at < NOW() - MAKE_INTERVAL(days => ${days}))::int AS affected
                FROM users WHERE is_active = 'Y'`;
            if (imp.affected > 0) {
                const msg = `มีผู้ใช้ ${imp.affected.toLocaleString()} คนที่รหัสผ่านเกิน ${days} วันแล้ว — จะเห็นแถบเตือนให้เปลี่ยนรหัสผ่าน (ยังเข้าใช้งานได้ตามปกติ)`;
                warning = warning ? `${warning} · ${msg}` : msg;
            }
        }

        // นโยบายชื่อผู้ใช้ — บอกจำนวนคนที่จะโดน ก่อนกดบันทึกจริง
        if (next.username_policy_mode || next.username_policy_scope || next.username_policy_pilot !== undefined) {
            const cur = await getUsernamePolicy();
            const mode = next.username_policy_mode ?? cur.mode;
            const scope = next.username_policy_scope ?? cur.scope;
            if (mode !== 'off') {
                const pilot = (next.username_policy_pilot ?? cur.pilot.join(','))
                    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                const scopeFrag = scope === 'all'
                    ? core_kon``
                    : core_kon`AND LOWER(username) = ANY(${pilot})`;
                const [imp] = await core_kon`
                    SELECT COUNT(*)::int AS affected FROM users
                    WHERE is_active = 'Y' AND username = id_card ${scopeFrag}`;
                const verb = mode === 'force'
                    ? 'จะถูกบังคับให้ตั้งชื่อผู้ใช้ใหม่ก่อนใช้งานระบบต่อ'
                    : 'จะเห็นแถบเตือนให้เปลี่ยนชื่อผู้ใช้ (ยังใช้งานได้ตามปกติ)';
                const msg = imp.affected === 0
                    ? 'ยังไม่มีผู้ใช้คนใดเข้าเงื่อนไขนโยบายชื่อผู้ใช้ — ตั้งค่าแล้วจะยังไม่มีผลกับใคร'
                    : `มีผู้ใช้ ${imp.affected.toLocaleString()} คนที่ใช้เลขบัตรเป็นชื่อผู้ใช้ — ${verb}`;
                warning = warning ? `${warning} · ${msg}` : msg;
            }
        }

        for (const [k, v] of Object.entries(next)) {
            await core_kon`
                UPDATE auth_settings SET value = ${v}, updated_at = NOW(), updated_by = ${user?.id ?? null}
                WHERE name = ${k}`;
        }

        await logMfa({
            userId: user?.id ?? null, username: user?.username ?? null, event: 'settings_changed',
            detail: Object.entries(next).map(([k, v]) => `${k}=${v}`).join(', ').slice(0, 400),
        });

        return { success: true, data: await getMfaSettings(), usernamePolicy: await getUsernamePolicy(), warning };
    } catch (e: any) {
        console.error('[mfaAdmin] updateMfaConfig:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

export const addMfaUser = async ({ body, user, set }: any) => {
    try {
        const uid = Number(body?.user_id);
        if (!Number.isInteger(uid) || uid <= 0) return err(set, 400, 'user_id ไม่ถูกต้อง');

        const [u] = await core_kon`
            SELECT id, username, (id_card IS NOT NULL AND LENGTH(TRIM(id_card)) = 13) AS ok
            FROM users WHERE id = ${uid}`;
        if (!u) return err(set, 404, 'ไม่พบผู้ใช้');
        if (!u.ok) return err(set, 400, 'ผู้ใช้รายนี้ไม่มีเลขบัตรประชาชนที่ถูกต้องในระบบ จึงส่ง OTP ไม่ได้');

        await core_kon`
            INSERT INTO auth_mfa_users (user_id, added_by) VALUES (${uid}, ${user?.id ?? null})
            ON CONFLICT (user_id) DO NOTHING`;
        await logMfa({ userId: user?.id ?? null, username: user?.username ?? null, event: 'settings_changed', detail: `เพิ่มผู้ใช้เข้าขอบเขต MFA: ${u.username}` });
        set.status = 201;
        return { success: true, data: { user_id: uid } };
    } catch (e: any) {
        console.error('[mfaAdmin] addMfaUser:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// เพิ่มผู้ปฏิบัติงานทั้งหมดเข้าขอบเขตทีเดียว
// ข้ามคนที่ไม่มีเลขบัตร 13 หลัก เพราะส่ง OTP ไม่ได้ (ใส่ไปก็ล็อกตัวเองออกเปล่าๆ)
// dryRun = true → แค่นับ ไม่เขียนจริง ใช้ให้หน้าจอถามยืนยันก่อน
export const addAllActiveMfaUsers = async ({ body, user, set }: any) => {
    try {
        const dryRun = body?.dry_run === true;

        const [preview] = await core_kon`
            SELECT
                COUNT(*) FILTER (WHERE u.id_card IS NOT NULL AND LENGTH(TRIM(u.id_card)) = 13)::int AS eligible,
                COUNT(*) FILTER (WHERE u.id_card IS NULL OR LENGTH(TRIM(u.id_card)) <> 13)::int      AS skipped_no_idcard,
                COUNT(*) FILTER (WHERE u.id_card IS NOT NULL AND LENGTH(TRIM(u.id_card)) = 13
                                   AND NOT EXISTS (SELECT 1 FROM auth_mfa_users m WHERE m.user_id = u.id))::int AS will_add
            FROM users u
            WHERE u.is_active = 'Y'`;

        if (dryRun) return { success: true, data: { ...preview, dry_run: true } };

        const inserted = await core_kon`
            INSERT INTO auth_mfa_users (user_id, added_by)
            SELECT u.id, ${user?.id ?? null}
            FROM users u
            WHERE u.is_active = 'Y'
              AND u.id_card IS NOT NULL AND LENGTH(TRIM(u.id_card)) = 13
            ON CONFLICT (user_id) DO NOTHING
            RETURNING user_id`;

        await logMfa({
            userId: user?.id ?? null, username: user?.username ?? null, event: 'settings_changed',
            detail: `เพิ่มผู้ปฏิบัติงานทั้งหมดเข้าขอบเขต MFA: เพิ่มใหม่ ${inserted.length} คน (ข้ามผู้ไม่มีเลขบัตร ${preview.skipped_no_idcard} คน)`,
        });

        return { success: true, data: { added: inserted.length, skipped_no_idcard: preview.skipped_no_idcard } };
    } catch (e: any) {
        console.error('[mfaAdmin] addAllActiveMfaUsers:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

export const removeMfaUser = async ({ params, user, set }: any) => {
    try {
        const uid = Number(params.id);
        const removed = await core_kon`DELETE FROM auth_mfa_users WHERE user_id = ${uid} RETURNING user_id`;
        if (removed.length === 0) return err(set, 404, 'ไม่พบรายชื่อนี้ในขอบเขต MFA');
        await logMfa({ userId: user?.id ?? null, username: user?.username ?? null, event: 'settings_changed', detail: `นำผู้ใช้ id=${uid} ออกจากขอบเขต MFA` });
        return { success: true };
    } catch (e: any) {
        console.error('[mfaAdmin] removeMfaUser:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// audit + สรุปอัตราส่งสำเร็จ/ความหน่วง (ใช้ประเมินก่อนขยายผล)
// ค่าเริ่มต้น: เฉพาะวันปัจจุบัน — ส่ง from/to (ISO) เพื่อกรองช่วงอื่น
export const getMfaAudit = async ({ query, set }: any) => {
    try {
        const limit = Math.min(Number(query?.limit ?? 200) || 200, 1000);

        // ไม่ระบุช่วง = ตั้งแต่เที่ยงคืนวันนี้ถึงตอนนี้
        const parse = (v: any): Date | null => {
            if (!v) return null;
            const d = new Date(String(v));
            return Number.isNaN(d.getTime()) ? null : d;
        };
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const from = parse(query?.from) ?? startOfToday;
        const to = parse(query?.to) ?? new Date();

        const rangeFrag = core_kon`AND a.created_at >= ${from} AND a.created_at <= ${to}`;

        const [rows, stats] = await Promise.all([
            core_kon`
                SELECT a.id, a.user_id, a.username, a.event, a.detail, a.send_ms, a.client_ip, a.created_at
                FROM auth_mfa_audit a
                WHERE 1=1 ${rangeFrag}
                ORDER BY a.created_at DESC
                LIMIT ${limit}`,
            core_kon`
                SELECT
                    COUNT(*) FILTER (WHERE event = 'otp_sent')::int         AS sent,
                    COUNT(*) FILTER (WHERE event = 'otp_resent')::int       AS resent,
                    COUNT(*) FILTER (WHERE event = 'otp_send_failed')::int  AS send_failed,
                    COUNT(*) FILTER (WHERE event = 'otp_verified')::int     AS verified,
                    COUNT(*) FILTER (WHERE event = 'otp_wrong')::int        AS wrong,
                    COUNT(*) FILTER (WHERE event = 'otp_expired')::int      AS expired,
                    COUNT(*) FILTER (WHERE event = 'otp_locked')::int       AS locked,
                    ROUND(AVG(send_ms) FILTER (WHERE send_ms IS NOT NULL))::int AS avg_send_ms,
                    MAX(send_ms) FILTER (WHERE send_ms IS NOT NULL)::int        AS max_send_ms
                FROM auth_mfa_audit a
                WHERE 1=1 ${rangeFrag}`,
        ]);
        return {
            success: true,
            data: { rows, stats: stats[0], range: { from, to }, limit, truncated: rows.length >= limit },
        };
    } catch (e: any) {
        console.error('[mfaAdmin] getMfaAudit:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};
