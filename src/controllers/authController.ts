import { Context } from 'elysia';
import { core_kon } from '../db/db';
import {
    getMfaSettings, isMfaRequiredFor, generateOtp, hashOtp, verifyOtpHash,
    logMfa,
} from '../utils/mfa';
import { sendOtpAlert } from '../utils/mophOtp';
import { getPasswordPolicy, evaluatePassword } from '../utils/passwordPolicy';
import { getUsernamePolicy, evaluateUsername } from '../utils/usernamePolicy';

// ── ข้อมูลผู้ใช้ + roles ที่ส่งกลับตอน login สำเร็จ (รูปแบบเดิม ห้ามเปลี่ยน) ──
const buildLoginPayload = async (user: any, jwt: any) => {
    const [roleRows, policy, unamePolicy] = await Promise.all([
        core_kon`
            SELECT r.role_name
            FROM core_kon.user_m_users_roles mu
            LEFT JOIN core_kon.user_roles r ON r.id = mu.role_id
            WHERE mu.user_id = ${user.id}
        `,
        getPasswordPolicy(),
        getUsernamePolicy(),
    ]);
    const pwd = evaluatePassword(user.password_changed_at ?? null, policy);
    const uname = evaluateUsername(user.username, user.id_card, unamePolicy);
    // ฝังผลตรวจไว้ใน token (claim `unc`) — ด่านบังคับใน authMiddleware จะได้ไม่ต้องคิวรี DB ทุก request
    const token = await jwt.sign({ id: user.id, username: user.username, unc: uname.required });
    return {
        success: true,
        token,
        weak: user.weak ?? false,
        // นโยบายชื่อผู้ใช้ — username ที่เป็นเลขบัตรประชาชน
        username_is_id_card: uname.weak,
        username_warn: uname.warn,
        username_change_required: uname.required,
        // นโยบายอายุรหัสผ่าน — แจ้งเตือนอย่างเดียว ไม่บล็อกการเข้าใช้งาน
        // password_expired = เกินกำหนดแล้ว, password_age_days = ใช้รหัสนี้มากี่วันนับจากวันเปลี่ยนล่าสุด
        password_expired: pwd.expired,
        password_days_left: pwd.daysLeft,
        password_age_days: pwd.ageDays,
        password_changed_at: pwd.changedAt,
        password_expires_at: pwd.expiresAt,
        password_warn: pwd.shouldWarn,
        data: {
            id: user.id,
            username: user.username,
            name: user.employee_name,
            mission_name: user.mission_name,
            major_name: user.major_name,
            position_name: user.position_name,
            user_type_id: user.user_type_id,
            user_type_name: user.user_type_name,
            roles: roleRows.map((r: any) => r.role_name),
        },
    };
};

const clientIpOf = (request: any, server: any): string =>
    server?.requestIP?.(request)?.address
    ?? request?.headers?.get?.('x-forwarded-for')
    ?? 'unknown';

export const loginCOREKON = async ({ body, set, jwt, request, server }: Context & { jwt: any; server?: any }) => {
    const { username, password } = body as { username: string; password: string };

    try {
        const rows = await core_kon`
            SELECT u.id,u.username, u.password, u.id_card, u.is_active, u.work_end_date, u.password_changed_at, CONCAT(pname, fname, ' ', lname) AS employee_name ,m."name" as mission_name,m1."name" as major_name,up.position_name
            ,ut.user_type_id,ut.type_name as user_type_name
            FROM users u
            left join missions m on u.mission_id =m.mission_id
            left join majors m1 on u.major_id  =m1.major_id
            left join user_positions up on up.user_position_id =u.user_position_id
            left join user_types ut on ut.user_type_id =u.user_type_id
            WHERE username = ${username}
        `;

        if (rows.length === 0) {
            set.status = 401;
            return { success: false, message: 'Invalid username or password' };
        }

        const user = rows[0];
        const isMatch = await Bun.password.verify(password, user.password, 'argon2id');

        if (!isMatch) {
            set.status = 401;
            return { success: false, message: 'Invalid username or password' };
        }

        // ตรวจสอบสถานะการใช้งาน — ผู้ที่ไม่ได้ปฏิบัติงาน (is_active = 'N') ห้าม login
        // ตรวจหลังยืนยันรหัสผ่านถูกต้อง เพื่อไม่เปิดเผยสถานะบัญชีให้ผู้ที่ไม่รู้รหัสผ่าน
        if (String(user.is_active ?? '').toUpperCase() === 'N') {
            set.status = 403;
            return {
                success: false,
                message: 'บัญชีนี้ถูกระงับการใช้งาน (ไม่ได้ปฏิบัติงาน) กรุณาติดต่อฝ่ายบุคคล'
            };
        }

        user.weak = password === user.id_card;

        // ── ด่านที่ 2: MFA ────────────────────────────────────────────────────
        // ถ้าปิดอยู่หรือผู้ใช้คนนี้ไม่อยู่ในขอบเขต → ตอบกลับรูปแบบเดิมทุกประการ
        const settings = await getMfaSettings();
        const needMfa = await isMfaRequiredFor(user.id, settings);
        if (!needMfa) return await buildLoginPayload(user, jwt);

        const clientIp = clientIpOf(request, server);
        const idCard = String(user.id_card ?? '').trim();

        // ไม่มีเลขบัตร = ส่ง OTP ไม่ได้ → ไม่ปล่อยผ่าน (ไม่งั้น MFA จะเลี่ยงได้ด้วยการลบเลขบัตร)
        if (idCard.length !== 13) {
            await logMfa({ userId: user.id, username: user.username, event: 'otp_send_failed', detail: 'ไม่มีเลขบัตรประชาชนที่ถูกต้องในระบบ', clientIp });
            set.status = 403;
            return {
                success: false,
                message: 'บัญชีนี้ต้องยืนยันตัวตนผ่าน Line หมอพร้อม แต่ไม่พบเลขบัตรประชาชนที่ถูกต้องในระบบ กรุณาติดต่อฝ่ายบุคคล',
            };
        }

        const otp = generateOtp();
        const otpHash = await hashOtp(otp);
        const now = Date.now();

        const [challenge] = await core_kon`
            INSERT INTO auth_otp_challenges
                (challenge_token, user_id, otp_hash, max_attempts, expires_at, challenge_expires_at, client_ip)
            VALUES (gen_random_uuid(), ${user.id}, ${otpHash}, ${settings.maxAttempts},
                    ${new Date(now + settings.otpTtlSeconds * 1000)},
                    ${new Date(now + settings.challengeTtlSeconds * 1000)},
                    ${clientIp})
            RETURNING challenge_token, expires_at`;

        const sent = await sendOtpAlert(idCard, otp, settings.otpTtlSeconds);
        await logMfa({
            userId: user.id, username: user.username,
            event: sent.ok ? 'otp_sent' : 'otp_send_failed',
            detail: sent.ok ? `HTTP ${sent.status}` : `HTTP ${sent.status} ${sent.error ?? ''}`.trim(),
            sendMs: sent.ms, clientIp,
        });

        if (!sent.ok) {
            // ส่งไม่ออก → ยกเลิก challenge ทิ้ง ไม่ให้ค้างเป็นขยะ
            await core_kon`UPDATE auth_otp_challenges SET failed_at = NOW() WHERE challenge_token = ${challenge.challenge_token}`;
            set.status = 502;
            return {
                success: false,
                message: 'ส่งรหัสยืนยันไปยัง Line หมอพร้อมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง หากยังไม่สำเร็จ กรุณาติดต่อทีม IT',
            };
        }

        // ยังไม่ออก JWT — ต้องยืนยัน OTP ก่อน
        return {
            success: true,
            mfa_required: true,
            challenge_token: challenge.challenge_token,
            expires_at: challenge.expires_at,
            resend_after_seconds: settings.resendCooldownSeconds,
            // ไม่ส่งเลขบัตร (แม้ปิดบังบางส่วน) กลับไปฝั่ง client — ผู้ที่ได้รหัสผ่านมาไม่ควรได้ข้อมูลตัวตนเพิ่ม
            message: 'ส่งรหัสยืนยันไปยัง Line หมอพร้อมแล้ว',
        };
    } catch (error) {
        console.error('Login error:', error);
        set.status = 500;
        return { success: false, message: 'Internal Server Error' };
    }
};

// ── ยืนยัน OTP → ออก JWT ──────────────────────────────────────────────────────
export const verifyOtp = async ({ body, set, jwt, request, server }: Context & { jwt: any; server?: any }) => {
    const { challenge_token, otp } = body as { challenge_token: string; otp: string };
    const clientIp = clientIpOf(request, server);

    try {
        const [ch] = await core_kon`
            SELECT * FROM auth_otp_challenges WHERE challenge_token = ${challenge_token}`;

        // ข้อความเดียวกันทุกกรณีที่ challenge ใช้ไม่ได้ — ไม่บอกใบ้ว่าเพราะอะไร
        const invalid = () => {
            set.status = 400;
            return { success: false, message: 'รอบยืนยันตัวตนไม่ถูกต้องหรือหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่' };
        };
        if (!ch || ch.consumed_at || ch.failed_at) return invalid();
        if (new Date(ch.challenge_expires_at).getTime() < Date.now()) return invalid();

        if (new Date(ch.expires_at).getTime() < Date.now()) {
            await logMfa({ userId: ch.user_id, event: 'otp_expired', clientIp });
            set.status = 400;
            return { success: false, message: 'รหัสยืนยันหมดอายุแล้ว กรุณากดขอรหัสใหม่', can_resend: true };
        }

        if (ch.attempts >= ch.max_attempts) {
            await core_kon`UPDATE auth_otp_challenges SET failed_at = NOW() WHERE id = ${ch.id}`;
            await logMfa({ userId: ch.user_id, event: 'otp_locked', detail: `ผิดครบ ${ch.max_attempts} ครั้ง`, clientIp });
            set.status = 429;
            return { success: false, message: 'กรอกรหัสผิดเกินจำนวนครั้งที่กำหนด กรุณาเข้าสู่ระบบใหม่' };
        }

        const ok = await verifyOtpHash(String(otp ?? ''), ch.otp_hash);
        if (!ok) {
            const [updated] = await core_kon`
                UPDATE auth_otp_challenges SET attempts = attempts + 1
                WHERE id = ${ch.id} RETURNING attempts, max_attempts`;
            const left = Math.max(0, updated.max_attempts - updated.attempts);
            await logMfa({ userId: ch.user_id, event: 'otp_wrong', detail: `เหลือ ${left} ครั้ง`, clientIp });
            if (left === 0) {
                await core_kon`UPDATE auth_otp_challenges SET failed_at = NOW() WHERE id = ${ch.id}`;
                set.status = 429;
                return { success: false, message: 'กรอกรหัสผิดเกินจำนวนครั้งที่กำหนด กรุณาเข้าสู่ระบบใหม่' };
            }
            set.status = 401;
            return { success: false, message: `รหัสยืนยันไม่ถูกต้อง (เหลืออีก ${left} ครั้ง)`, attempts_left: left };
        }

        // ถูกต้อง — ปิด challenge แบบ atomic กันใช้ token เดิมซ้ำจากหลาย request พร้อมกัน
        const consumed = await core_kon`
            UPDATE auth_otp_challenges SET consumed_at = NOW()
            WHERE id = ${ch.id} AND consumed_at IS NULL
            RETURNING id`;
        if (consumed.length === 0) return invalid();

        const rows = await core_kon`
            SELECT u.id,u.username, u.id_card, u.is_active, u.password_changed_at, CONCAT(pname, fname, ' ', lname) AS employee_name
            ,m."name" as mission_name,m1."name" as major_name,up.position_name
            ,ut.user_type_id,ut.type_name as user_type_name
            FROM users u
            left join missions m on u.mission_id =m.mission_id
            left join majors m1 on u.major_id  =m1.major_id
            left join user_positions up on up.user_position_id =u.user_position_id
            left join user_types ut on ut.user_type_id =u.user_type_id
            WHERE u.id = ${ch.user_id}`;

        if (rows.length === 0 || String(rows[0].is_active ?? '').toUpperCase() === 'N') {
            set.status = 403;
            return { success: false, message: 'บัญชีนี้ไม่สามารถเข้าใช้งานได้ กรุณาติดต่อฝ่ายบุคคล' };
        }

        await logMfa({ userId: ch.user_id, username: rows[0].username, event: 'otp_verified', clientIp });
        return await buildLoginPayload(rows[0], jwt);
    } catch (error) {
        console.error('Verify OTP error:', error);
        set.status = 500;
        return { success: false, message: 'Internal Server Error' };
    }
};

// ── ขอรหัสใหม่ (ไม่ยืดอายุ challenge รวม) ─────────────────────────────────────
export const resendOtp = async ({ body, set, request, server }: Context & { server?: any }) => {
    const { challenge_token } = body as { challenge_token: string };
    const clientIp = clientIpOf(request, server);

    try {
        const [ch] = await core_kon`
            SELECT c.*, u.id_card, u.username, u.is_active
            FROM auth_otp_challenges c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE c.challenge_token = ${challenge_token}`;

        if (!ch || ch.consumed_at || ch.failed_at
            || new Date(ch.challenge_expires_at).getTime() < Date.now()
            || String(ch.is_active ?? '').toUpperCase() === 'N') {
            set.status = 400;
            return { success: false, message: 'รอบยืนยันตัวตนไม่ถูกต้องหรือหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่' };
        }

        const settings = await getMfaSettings();
        const waited = (Date.now() - new Date(ch.last_sent_at).getTime()) / 1000;
        if (waited < settings.resendCooldownSeconds) {
            set.status = 429;
            return {
                success: false,
                message: `กรุณารออีก ${Math.ceil(settings.resendCooldownSeconds - waited)} วินาทีก่อนขอรหัสใหม่`,
                retry_after_seconds: Math.ceil(settings.resendCooldownSeconds - waited),
            };
        }
        if (ch.resend_count >= 3) {
            set.status = 429;
            return { success: false, message: 'ขอรหัสใหม่เกินจำนวนที่กำหนด กรุณาเข้าสู่ระบบใหม่' };
        }

        const otp = generateOtp();
        const otpHash = await hashOtp(otp);
        const sent = await sendOtpAlert(String(ch.id_card), otp, settings.otpTtlSeconds);

        await logMfa({
            userId: ch.user_id, username: ch.username,
            event: sent.ok ? 'otp_resent' : 'otp_send_failed',
            detail: `HTTP ${sent.status}`, sendMs: sent.ms, clientIp,
        });

        if (!sent.ok) {
            set.status = 502;
            return { success: false, message: 'ส่งรหัสยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' };
        }

        // รีเซ็ต attempts ให้รหัสใหม่ แต่ challenge_expires_at คงเดิม (กันยืดเวลาไม่รู้จบ)
        const [updated] = await core_kon`
            UPDATE auth_otp_challenges
            SET otp_hash = ${otpHash}, attempts = 0, resend_count = resend_count + 1,
                expires_at = ${new Date(Date.now() + settings.otpTtlSeconds * 1000)}, last_sent_at = NOW()
            WHERE id = ${ch.id} RETURNING expires_at`;

        return {
            success: true,
            expires_at: updated.expires_at,
            resend_after_seconds: settings.resendCooldownSeconds,
            message: 'ส่งรหัสยืนยันใหม่แล้ว',
        };
    } catch (error) {
        console.error('Resend OTP error:', error);
        set.status = 500;
        return { success: false, message: 'Internal Server Error' };
    }
};
