// จัดการข้อมูลเข้าสู่ระบบของบุคลากร: username / รหัสผ่าน / เลขบัตรประชาชน
// สิทธิ์: ADMIN · IT_STAFF เท่านั้น
//
// ทั้ง 3 อย่างเป็นข้อมูลยืนยันตัวตน โดยเฉพาะเลขบัตรซึ่งเป็นปลายทางส่ง OTP ของ Line หมอพร้อม
// การแก้ไขทุกครั้งจึงบันทึก audit และไม่เก็บค่ารหัสผ่านลงที่ใดทั้งสิ้น
import { core_kon } from '../db/db';
import { sendCredentialIssuedAlert } from '../utils/mophAlert';
import { checkPassword } from '../utils/passwordStrength';

export const CREDENTIAL_ROLES = ['ADMIN', 'IT_STAFF'];

const err = (set: any, status: number, message: string, field?: string) => {
    set.status = status;
    return { success: false, message, field };
};

async function userRoles(userId: number): Promise<string[]> {
    const rows = await core_kon`
        SELECT r.role_name
        FROM core_kon.user_m_users_roles mu
        LEFT JOIN core_kon.user_roles r ON r.id = mu.role_id
        WHERE mu.user_id = ${userId}`;
    return rows.map((r: any) => String(r.role_name ?? '').toUpperCase());
}

const hasAccess = (roles: string[]) => roles.some(r => CREDENTIAL_ROLES.includes(r));

const maskTail = (v: string) => (v && v.length >= 4 ? `****${v.slice(-4)}` : '****');

const clientIpOf = (request: any, server: any): string =>
    server?.requestIP?.(request)?.address
    ?? request?.headers?.get?.('x-forwarded-for')
    ?? 'unknown';

async function audit(entry: {
    targetId: number; targetUsername?: string | null;
    actorId: number; actorUsername?: string | null;
    field: string; oldValue?: string | null; newValue?: string | null; ip?: string | null;
}) {
    try {
        await core_kon`
            INSERT INTO user_credential_audit
                (target_user_id, target_username, actor_user_id, actor_username, field, old_value, new_value, client_ip)
            VALUES (${entry.targetId}, ${entry.targetUsername ?? null}, ${entry.actorId}, ${entry.actorUsername ?? null},
                    ${entry.field}, ${entry.oldValue ?? null}, ${entry.newValue ?? null}, ${entry.ip ?? null})`;
    } catch (e: any) {
        // audit ล้มเหลวต้องไม่ทำให้การแก้ไขล่ม แต่ต้องเห็นใน log ฝั่ง server
        console.error('[credential] เขียน audit ไม่สำเร็จ:', e?.message);
    }
}

// ── รายชื่อบุคลากรสำหรับหน้าจัดการบัญชี ─────────────────────────────────────
export const getCredentialUsers = async ({ query, user, set }: any) => {
    try {
        if (!hasAccess(await userRoles(Number(user?.id)))) return err(set, 403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');

        const search = String(query?.search ?? '').trim();
        const limit = Math.min(Number(query?.limit ?? 50) || 50, 200);
        const offset = Math.max(Number(query?.offset ?? 0) || 0, 0);
        const activeOnly = String(query?.active ?? 'Y') === 'Y';

        const searchFrag = search
            ? core_kon`AND (CONCAT(u.pname, u.fname, ' ', u.lname) ILIKE ${'%' + search + '%'}
                        OR u.username ILIKE ${'%' + search + '%'}
                        OR u.id_card LIKE ${'%' + search + '%'})`
            : core_kon``;
        const activeFrag = activeOnly ? core_kon`AND u.is_active = 'Y'` : core_kon``;

        const [rows, countRows] = await Promise.all([
            core_kon`
                SELECT u.id, u.username, u.is_active,
                       CONCAT(u.pname, u.fname, ' ', u.lname) AS name,
                       up.position_name, mj.name AS major_name,
                       -- ไม่ส่งเลขบัตรเต็มออกจาก server แสดงแค่ 4 ตัวท้ายไว้ยืนยันตัวตน
                       CASE WHEN u.id_card IS NULL OR TRIM(u.id_card) = '' THEN NULL
                            ELSE CONCAT('****', RIGHT(TRIM(u.id_card), 4)) END AS id_card_masked,
                       (u.id_card IS NOT NULL AND LENGTH(TRIM(u.id_card)) = 13) AS id_card_valid,
                       u.password_changed_at
                FROM users u
                LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
                LEFT JOIN majors mj ON mj.major_id = u.major_id
                WHERE 1=1 ${activeFrag} ${searchFrag}
                ORDER BY u.fname, u.lname
                LIMIT ${limit} OFFSET ${offset}`,
            core_kon`SELECT COUNT(*)::int AS total FROM users u WHERE 1=1 ${activeFrag} ${searchFrag}`,
        ]);

        return { success: true, data: { rows, total: countRows[0].total, limit, offset } };
    } catch (e: any) {
        console.error('[credential] getCredentialUsers:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// ── แก้ไข username / รหัสผ่าน / เลขบัตร ─────────────────────────────────────
// ส่งเฉพาะฟิลด์ที่ต้องการเปลี่ยน ฟิลด์ที่ไม่ส่งจะไม่ถูกแตะ
export const updateUserCredentials = async ({ params, body, user, set, request, server }: any) => {
    try {
        const actorId = Number(user?.id);
        const roles = await userRoles(actorId);
        if (!hasAccess(roles)) return err(set, 403, 'ไม่มีสิทธิ์แก้ไขข้อมูลนี้');

        const targetId = Number(params.id);
        const [target] = await core_kon`
            SELECT id, username, id_card, is_active, CONCAT(pname, fname, ' ', lname) AS name
            FROM users WHERE id = ${targetId}`;
        if (!target) return err(set, 404, 'ไม่พบบุคลากรรายนี้');

        const [actor] = await core_kon`SELECT username FROM users WHERE id = ${actorId}`;
        const ip = clientIpOf(request, server);

        const newUsername = body?.username !== undefined ? String(body.username).trim() : null;
        const newPassword = body?.password !== undefined ? String(body.password) : null;
        const newIdCard = body?.id_card !== undefined ? String(body.id_card).replace(/\D/g, '') : null;

        if (newUsername === null && newPassword === null && newIdCard === null) {
            return err(set, 400, 'ไม่มีข้อมูลที่ต้องการแก้ไข');
        }

        // ── ตรวจความถูกต้องทั้งหมดก่อน แล้วค่อยเขียน (กันแก้ได้ครึ่งเดียว) ──
        if (newUsername !== null) {
            if (!/^[a-zA-Z0-9._-]{4,50}$/.test(newUsername)) {
                return err(set, 400, 'ชื่อผู้ใช้ต้องยาว 4-50 ตัว ใช้ได้เฉพาะ a-z A-Z 0-9 . _ -', 'username');
            }
            const [dup] = await core_kon`
                SELECT id, CONCAT(pname, fname, ' ', lname) AS name FROM users
                WHERE LOWER(username) = LOWER(${newUsername}) AND id <> ${targetId}`;
            if (dup) return err(set, 409, `ชื่อผู้ใช้ "${newUsername}" ถูกใช้โดย ${dup.name} แล้ว`, 'username');
        }

        if (newPassword !== null) {
            // ใช้กติกาเดียวกับหน้าเปลี่ยนรหัสผ่าน (utils/passwordStrength)
            const check = checkPassword(newPassword, {
                idCard: newIdCard ?? target.id_card,
                username: newUsername ?? target.username,
            });
            if (!check.ok) {
                set.status = 400;
                return { success: false, message: check.message, field: 'password', failed: check.failed };
            }
        }

        if (newIdCard !== null) {
            if (newIdCard.length !== 13) return err(set, 400, 'เลขบัตรประชาชนต้องมี 13 หลัก', 'id_card');
            const [dup] = await core_kon`
                SELECT id, CONCAT(pname, fname, ' ', lname) AS name FROM users
                WHERE TRIM(id_card) = ${newIdCard} AND id <> ${targetId}`;
            if (dup) return err(set, 409, `เลขบัตรประชาชนนี้ถูกใช้โดย ${dup.name} แล้ว`, 'id_card');
        }

        // ── เขียนทีละฟิลด์ + audit ──
        const changed: string[] = [];

        if (newUsername !== null && newUsername !== target.username) {
            await core_kon`UPDATE users SET username = ${newUsername}, updated_at = NOW() WHERE id = ${targetId}`;
            await audit({ targetId, targetUsername: target.username, actorId, actorUsername: actor?.username,
                field: 'username', oldValue: target.username, newValue: newUsername, ip });
            changed.push('username');
        }

        if (newIdCard !== null && newIdCard !== String(target.id_card ?? '')) {
            await core_kon`UPDATE users SET id_card = ${newIdCard}, updated_at = NOW() WHERE id = ${targetId}`;
            await audit({ targetId, targetUsername: target.username, actorId, actorUsername: actor?.username,
                field: 'id_card', oldValue: maskTail(String(target.id_card ?? '')), newValue: maskTail(newIdCard), ip });
            changed.push('id_card');
        }

        if (newPassword !== null) {
            const hashed = await Bun.password.hash(newPassword, { algorithm: 'argon2id' });
            // password_changed_at = NULL → นโยบายอายุรหัสผ่านถือเป็นรหัสชั่วคราว
            // บังคับให้เจ้าของบัญชีตั้งรหัสของตัวเองเมื่อเข้าระบบครั้งถัดไป
            await core_kon`
                UPDATE users SET password = ${hashed}, password_changed_at = NULL, updated_at = NOW()
                WHERE id = ${targetId}`;
            await audit({ targetId, targetUsername: target.username, actorId, actorUsername: actor?.username,
                field: 'password', oldValue: null, newValue: null, ip });
            changed.push('password');
        }

        if (changed.length === 0) return { success: true, data: { changed: [], message: 'ไม่มีค่าใดเปลี่ยนแปลง' } };

        // ── แจ้งเจ้าของบัญชีผ่าน Line หมอพร้อม (ถ้าเลือกให้แจ้ง) ──
        let notified: boolean | null = null;
        if (body?.notify === true && changed.includes('password')) {
            const cid = newIdCard ?? String(target.id_card ?? '').trim();
            if (cid.length === 13) {
                try {
                    await sendCredentialIssuedAlert(cid, {
                        requestNo: `ADMIN-${targetId}`,
                        username: newUsername ?? target.username,
                        password: newPassword!,
                        systemName: 'PYHOS-EXP',
                        issuedBy: actor?.username ?? 'ผู้ดูแลระบบ',
                        note: 'กรุณาเปลี่ยนรหัสผ่านเป็นของท่านเองหลังเข้าสู่ระบบ',
                    });
                    notified = true;
                } catch (e: any) {
                    console.error('[credential] แจ้งเตือนไม่สำเร็จ:', e?.message);
                    notified = false;
                }
            } else {
                notified = false;
            }
        }

        console.log(`[credential] actor=${actorId} แก้ ${changed.join(',')} ของ user=${targetId}`);
        return { success: true, data: { changed, notified } };
    } catch (e: any) {
        console.error('[credential] updateUserCredentials:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// ── ประวัติการแก้ไข ──────────────────────────────────────────────────────────
export const getCredentialAudit = async ({ query, user, set }: any) => {
    try {
        if (!hasAccess(await userRoles(Number(user?.id)))) return err(set, 403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
        const limit = Math.min(Number(query?.limit ?? 100) || 100, 500);
        const targetId = query?.target_user_id ? Number(query.target_user_id) : null;
        const targetFrag = targetId ? core_kon`AND a.target_user_id = ${targetId}` : core_kon``;

        const rows = await core_kon`
            SELECT a.id, a.target_user_id, a.target_username, a.actor_user_id, a.actor_username,
                   a.field, a.old_value, a.new_value, a.client_ip, a.created_at,
                   CONCAT(t.pname, t.fname, ' ', t.lname) AS target_name
            FROM user_credential_audit a
            LEFT JOIN users t ON t.id = a.target_user_id
            WHERE 1=1 ${targetFrag}
            ORDER BY a.created_at DESC
            LIMIT ${limit}`;
        return { success: true, data: { rows } };
    } catch (e: any) {
        console.error('[credential] getCredentialAudit:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};
