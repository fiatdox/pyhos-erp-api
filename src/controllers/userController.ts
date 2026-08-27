import { core_kon } from '../db/db';
import { sendChangePasswordAlert } from '../utils/mophAlert';
import { getPasswordPolicy, evaluatePassword } from '../utils/passwordPolicy';
import { checkPassword } from '../utils/passwordStrength';
import { getUsernamePolicy, evaluateUsername, checkUsername } from '../utils/usernamePolicy';

// ดึงรายชื่อผู้ใช้ทั้งหมด (ไม่ดึง password ออกมาเพื่อความปลอดภัย)
export const getAllUsers = async ({ set }: any) => {
    try {
        const users = await core_kon`
            SELECT
                u.id, u.pname, u.fname, u.lname, u.id_card, u.gender, u.birthday, u.hire_date,
                u.user_type_id, u.user_position_id, u.user_level_id, u.user_status_id,
                u.mission_id, u.major_id, u.submajor_id, u.attendance_id, u.salary_id,
                u.username, u.is_active, u.work_end_date, u.created_at, u.updated_at, u.hospital_lc_pid,
                up.position_name,
                ut.type_name AS user_type_name
            FROM users u
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            LEFT JOIN user_types     ut ON ut.user_type_id     = u.user_type_id
            ORDER BY u.id DESC
        `;
        return { success: true, data: users };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลผู้ใช้พร้อม join ทุกตาราง lookup ที่เกี่ยวข้อง (คืนทั้ง id และชื่อที่ resolve แล้ว)
export const getUserInfo = async ({ params, set }: any) => {
    try {
        const users = await core_kon`
            SELECT
                u.id, u.id_card, u.pname, u.fname, u.lname,
                CONCAT(u.pname, u.fname, ' ', u.lname) AS employee_name,
                u.gender, u.birthday, u.hire_date, u.username, u.is_active,
                u.created_at, u.updated_at,
                u.hospital_lc_pid, u.attendance_id, u.salary_id,
                u.mission_id,       m."name"       AS mission_name,
                u.major_id,         m1."name"      AS major_name,
                u.submajor_id,      m2."name"      AS submajor_name,
                u.user_position_id, up.position_name,
                u.user_type_id,     ut.type_name   AS user_type_name,
                u.user_level_id,    ul.level_name  AS user_level_name,
                u.user_status_id,   us."name"      AS user_status_name
            FROM users u
            LEFT JOIN missions       m  ON m.mission_id        = u.mission_id
            LEFT JOIN majors         m1 ON m1.major_id         = u.major_id
            LEFT JOIN submajors      m2 ON m2.submajor_id      = u.submajor_id
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            LEFT JOIN user_types     ut ON ut.user_type_id     = u.user_type_id
            LEFT JOIN user_levels    ul ON ul.user_level_id    = u.user_level_id
            LEFT JOIN user_statuses  us ON us.user_status_id   = u.user_status_id
            WHERE u.id = ${params.id}
        `;
        if (users.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }
        return { success: true, data: users[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลผู้ใช้รายบุคคล (ไม่ดึง password ออกมา)
export const getUserById = async ({ params, set }: any) => {
    try {
        const users = await core_kon`
            SELECT id, pname, fname, lname, id_card, gender, birthday, hire_date, user_type_id, user_position_id, user_level_id, user_status_id, mission_id, major_id, submajor_id, attendance_id, salary_id, username, is_active, work_end_date, created_at, updated_at, hospital_lc_pid
            FROM users
            WHERE id = ${params.id}
        `;
        if (users.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }
        return { success: true, data: users[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// สร้างผู้ใช้ใหม่
export const createUser = async ({ body, set }: any) => {
    try {
        const userData = { ...body as any };
        
        // Hash password ด้วย Argon2id ก่อนบันทึกลง Database
        if (userData.password) {
            userData.password = await Bun.password.hash(userData.password, {
                algorithm: "argon2id",
            });
        }

        const result = await core_kon`
            INSERT INTO users ${core_kon(userData)}
            RETURNING id, username
        `;
        
        set.status = 201;
        return { success: true, message: 'User created successfully', data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// อัปเดตข้อมูลผู้ใช้
export const updateUser = async ({ params, body, set }: any) => {
    try {
        const userData = { ...body as any };
        
        if (userData.password) {
            userData.password = await Bun.password.hash(userData.password, {
                algorithm: "argon2id",
            });
            // รหัสที่ผู้ดูแลตั้งให้ = รหัสชั่วคราว → ล้างวันเปลี่ยนรหัส เพื่อบังคับให้เจ้าของบัญชี
            // ตั้งรหัสของตัวเองเมื่อ login ครั้งถัดไป (มีผลเฉพาะตอนเปิดนโยบายอายุรหัสผ่าน)
            userData.password_changed_at = null;
        }

        userData.updated_at = new Date(); // อัปเดต timestamp ล่าสุด

        const result = await core_kon`
            UPDATE users SET ${core_kon(userData)}
            WHERE id = ${params.id}
            RETURNING id, username
        `;

        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }

        return { success: true, message: 'User updated successfully', data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// เปิดการใช้งานผู้ใช้ (Re-activate User)
export const activateUser = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            UPDATE users SET is_active = 'Y', updated_at = NOW()
            WHERE id = ${params.id}
            RETURNING id
        `;

        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }

        return { success: true, message: 'User activated successfully' };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// เปลี่ยนรหัสผ่าน
// สถานะรหัสผ่านของผู้ใช้ที่ล็อกอินอยู่ — คำนวณจากวันที่เปลี่ยนรหัสล่าสุด
// ใช้แสดงแถบเตือนบนทุกหน้า (ไม่บล็อกการใช้งาน)
export const getMyPasswordStatus = async ({ user, set }: any) => {
    try {
        const [row] = await core_kon`SELECT password_changed_at FROM users WHERE id = ${Number(user?.id)}`;
        if (!row) {
            set.status = 404;
            return { success: false, message: 'ไม่พบผู้ใช้' };
        }
        const policy = await getPasswordPolicy();
        return {
            success: true,
            data: { ...evaluatePassword(row.password_changed_at ?? null, policy), policy_enabled: policy.enabled, expiry_days: policy.expiryDays },
        };
    } catch (error: any) {
        console.error('[userController] getMyPasswordStatus:', error);
        set.status = 500;
        return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
    }
};

// ── นโยบายชื่อผู้ใช้: ตั้งชื่อผู้ใช้ใหม่ด้วยตัวเอง ────────────────────────────
// ผู้ใช้ 98.9% ของระบบมี username = เลขบัตรประชาชน (หน้าเพิ่มบุคลากรตั้งให้อัตโนมัติ)
// สองฟังก์ชันนี้เปิดทางให้เจ้าของบัญชีแก้เองได้ โดยไม่ต้องรอ IT ทีละคน
export const getMyUsernameStatus = async ({ user, set }: any) => {
    try {
        const [row] = await core_kon`SELECT username, id_card FROM users WHERE id = ${Number(user?.id)}`;
        if (!row) {
            set.status = 404;
            return { success: false, message: 'ไม่พบผู้ใช้' };
        }
        const policy = await getUsernamePolicy();
        return {
            success: true,
            data: { ...evaluateUsername(row.username, row.id_card, policy), username: row.username },
        };
    } catch (error: any) {
        console.error('[userController] getMyUsernameStatus:', error);
        set.status = 500;
        return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
    }
};

// ตรวจชื่อผู้ใช้ก่อนบันทึก — ให้หน้าจอบอกได้ทันทีว่าชื่อนี้ซ้ำหรือไม่
// ใช้ตรรกะชุดเดียวกับตอนบันทึกจริง (checkUsername + คิวรีชื่อซ้ำ) ผลจึงตรงกันเสมอ
export const checkMyUsername = async ({ query, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const v = String(query?.username ?? '').trim();
        if (!v) return { success: true, data: { available: false, message: '' } };

        const [row] = await core_kon`SELECT username, id_card FROM users WHERE id = ${uid}`;
        if (!row) {
            set.status = 404;
            return { success: false, message: 'ไม่พบผู้ใช้' };
        }
        if (v === row.username)
            return { success: true, data: { available: false, message: 'ชื่อผู้ใช้ใหม่ต้องไม่ซ้ำกับชื่อเดิม' } };

        const check = checkUsername(v, { idCard: row.id_card });
        if (!check.ok) return { success: true, data: { available: false, message: check.message } };

        const [dup] = await core_kon`
            SELECT 1 FROM users WHERE LOWER(username) = LOWER(${v}) AND id <> ${uid}`;
        return dup
            ? { success: true, data: { available: false, message: `ชื่อผู้ใช้ "${v}" ถูกใช้แล้ว กรุณาเลือกชื่ออื่น` } }
            : { success: true, data: { available: true, message: `ใช้ชื่อ "${v}" ได้` } };
    } catch (error: any) {
        console.error('[userController] checkMyUsername:', error);
        set.status = 500;
        return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
    }
};

export const changeMyUsername = async ({ body, set, user, jwt, request, server }: any) => {
    try {
        const uid = Number(user?.id);
        const next = String(body?.username ?? '').trim();

        const [row] = await core_kon`SELECT username, id_card FROM users WHERE id = ${uid}`;
        if (!row) {
            set.status = 404;
            return { success: false, message: 'ไม่พบผู้ใช้' };
        }
        if (next === row.username) {
            set.status = 400;
            return { success: false, message: 'ชื่อผู้ใช้ใหม่ต้องไม่ซ้ำกับชื่อเดิม' };
        }

        const check = checkUsername(next, { idCard: row.id_card });
        if (!check.ok) {
            set.status = 400;
            return { success: false, message: check.message };
        }

        // เทียบแบบไม่สนตัวพิมพ์ กันสร้างชื่อที่คนอ่านแยกไม่ออกจากของคนอื่น
        const [dup] = await core_kon`
            SELECT id FROM users WHERE LOWER(username) = LOWER(${next}) AND id <> ${uid}`;
        if (dup) {
            set.status = 409;
            return { success: false, message: `ชื่อผู้ใช้ "${next}" ถูกใช้แล้ว กรุณาเลือกชื่ออื่น` };
        }

        await core_kon`UPDATE users SET username = ${next}, updated_at = NOW() WHERE id = ${uid}`;

        const ip = server?.requestIP?.(request)?.address
            ?? request?.headers?.get?.('x-forwarded-for') ?? 'unknown';
        try {
            await core_kon`
                INSERT INTO user_credential_audit
                    (target_user_id, target_username, actor_user_id, actor_username, field, old_value, new_value, client_ip)
                VALUES (${uid}, ${row.username}, ${uid}, ${row.username}, 'username', ${row.username}, ${next}, ${ip})`;
        } catch (e: any) {
            console.error('[userController] เขียน audit ชื่อผู้ใช้ไม่สำเร็จ:', e?.message);
        }

        // token เดิมยังถือ username เก่าและ claim unc=true อยู่ — ต้องออกใบใหม่ ไม่งั้นผู้ใช้ยังติดด่านเดิม
        const token = await jwt.sign({ id: uid, username: next, unc: false });
        return { success: true, data: { username: next }, token, message: 'เปลี่ยนชื่อผู้ใช้เรียบร้อยแล้ว' };
    } catch (error: any) {
        console.error('[userController] changeMyUsername:', error);
        set.status = 500;
        return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
    }
};

export const changePassword = async ({ params, body, set, user }: any) => {
    try {
        const { old_password, new_password } = body;

        const isOwner = user?.id === params.id;

        if (!isOwner) {
            const roleRows = await core_kon`
                SELECT r.role_name
                FROM core_kon.user_m_users_roles mu
                LEFT JOIN core_kon.user_roles r ON r.id = mu.role_id
                WHERE mu.user_id = ${user?.id}
            `;
            const isAdmin = roleRows.some((r: any) => r.role_name?.toLowerCase() === 'admin');
            if (!isAdmin) {
                set.status = 403;
                return { success: false, message: 'Forbidden' };
            }
        }

        const users = await core_kon`
            SELECT id, username, password, id_card, pname, fname, lname FROM users WHERE id = ${params.id}
        `;
        if (users.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }

        // ตรวจความแข็งแรงฝั่ง server — เดิมตรวจแค่ในหน้าเว็บ ซึ่งเลี่ยงได้ด้วยการยิง API ตรง
        const check = checkPassword(new_password, { idCard: users[0].id_card, username: users[0].username });
        if (!check.ok) {
            set.status = 400;
            return { success: false, message: check.message, failed: check.failed };
        }

        if (isOwner) {
            const isMatch = await Bun.password.verify(old_password, users[0].password);
            if (!isMatch) {
                set.status = 400;
                return { success: false, message: 'Old password is incorrect' };
            }
        }

        const hashed = await Bun.password.hash(new_password, { algorithm: 'argon2id' });

        await core_kon`
            UPDATE users SET password = ${hashed}, password_changed_at = NOW(), updated_at = NOW() WHERE id = ${params.id}
        `;

        // ส่งแจ้งเตือนผ่านหมอพร้อม (ไม่ block response หากส่งไม่สำเร็จ)
        if (users[0].id_card) {
            sendChangePasswordAlert(users[0].id_card, new_password).catch((err: any) => {
                console.error('[MOPH Alert Error]', err?.message ?? err);
            });
        }

        return { success: true, message: 'Password changed successfully' };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ปิดการใช้งานผู้ใช้ (Soft Delete)
export const deactivateUser = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            UPDATE users SET is_active = 'N', updated_at = NOW()
            WHERE id = ${params.id}
            RETURNING id
        `;

        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }

        return { success: true, message: 'User deactivated successfully' };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ── เลขที่เงินเดือน (users.salary_id) ของผู้ login — ใช้ในหน้า accounting/salary ──
// identity มาจาก JWT เท่านั้น (ไม่รับ id จาก client) กันตั้งค่าแทนคนอื่น

// ดึง salary_id ของตัวเอง
export const getMySalaryId = async ({ user, set }: any) => {
    try {
        const rows = await core_kon`SELECT salary_id FROM users WHERE id = ${user.id}`;
        if (rows.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }
        return { success: true, data: { salary_id: rows[0].salary_id ?? null } };
    } catch (error: any) {
        console.error('[userController] getMySalaryId:', error);
        set.status = 500;
        return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
    }
};

// บันทึก salary_id ของตัวเอง — ตั้งได้เฉพาะตอนที่ยังไม่มีค่า (แก้ทีหลังต้องให้ HR ทำผ่านทะเบียนบุคลากร)
// กันเลขซ้ำกับผู้ใช้อื่นใน statement เดียว (atomic)
export const setMySalaryId = async ({ user, body, set }: any) => {
    try {
        const salaryId = body.salary_id;
        if (!Number.isInteger(salaryId) || salaryId <= 0) {
            set.status = 400;
            return { success: false, message: 'เลขที่เงินเดือนไม่ถูกต้อง' };
        }
        const updated = await core_kon`
            UPDATE users SET salary_id = ${salaryId}, updated_at = NOW()
            WHERE id = ${user.id}
              AND salary_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM users o WHERE o.salary_id = ${salaryId} AND o.id <> ${user.id})
            RETURNING salary_id
        `;
        if (updated.length > 0) return { success: true, data: { salary_id: updated[0].salary_id } };

        // แยกสาเหตุที่อัปเดตไม่ได้: มีค่าอยู่แล้ว / เลขซ้ำกับคนอื่น
        const me = await core_kon`SELECT salary_id FROM users WHERE id = ${user.id}`;
        if (me.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }
        set.status = 409;
        if (me[0].salary_id != null) {
            return { success: false, message: 'บัญชีของคุณมีเลขที่เงินเดือนอยู่แล้ว หากต้องการแก้ไขกรุณาติดต่องานทรัพยากรบุคคล' };
        }
        return { success: false, message: 'เลขที่เงินเดือนนี้ถูกใช้โดยบุคลากรท่านอื่นแล้ว กรุณาตรวจสอบอีกครั้ง' };
    } catch (error: any) {
        console.error('[userController] setMySalaryId:', error);
        set.status = 500;
        return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
    }
};

// แก้ไขรหัสประจำตัวของตัวเอง (salary_id / attendance_id) — ผู้ใช้เปลี่ยนเองได้จากหน้า account/settings
// salary_id กันเลขซ้ำกับผู้ใช้อื่นใน statement เดียว (atomic); ส่ง null = ล้างค่า
export const updateMyCodes = async ({ user, body, set }: any) => {
    try {
        const hasSalary = 'salary_id' in body;
        const hasAttendance = 'attendance_id' in body;
        if (!hasSalary && !hasAttendance) {
            set.status = 400;
            return { success: false, message: 'ไม่มีข้อมูลให้บันทึก' };
        }
        if (hasSalary && body.salary_id != null && (!Number.isInteger(body.salary_id) || body.salary_id <= 0)) {
            set.status = 400;
            return { success: false, message: 'เลขที่เงินเดือนไม่ถูกต้อง' };
        }
        if (hasAttendance && body.attendance_id != null && (!Number.isInteger(body.attendance_id) || body.attendance_id <= 0)) {
            set.status = 400;
            return { success: false, message: 'รหัสเข้าออกงานไม่ถูกต้อง' };
        }

        if (hasSalary) {
            const salaryId = body.salary_id ?? null;
            const updated = salaryId == null
                ? await core_kon`UPDATE users SET salary_id = NULL, updated_at = NOW() WHERE id = ${user.id} RETURNING id`
                : await core_kon`
                    UPDATE users SET salary_id = ${salaryId}, updated_at = NOW()
                    WHERE id = ${user.id}
                      AND NOT EXISTS (SELECT 1 FROM users o WHERE o.salary_id = ${salaryId} AND o.id <> ${user.id})
                    RETURNING id`;
            if (updated.length === 0) {
                set.status = 409;
                return { success: false, message: 'เลขที่เงินเดือนนี้ถูกใช้โดยบุคลากรท่านอื่นแล้ว กรุณาตรวจสอบอีกครั้ง' };
            }
        }
        if (hasAttendance) {
            await core_kon`UPDATE users SET attendance_id = ${body.attendance_id ?? null}, updated_at = NOW() WHERE id = ${user.id}`;
        }

        const rows = await core_kon`SELECT salary_id, attendance_id FROM users WHERE id = ${user.id}`;
        return { success: true, data: rows[0] };
    } catch (error: any) {
        console.error('[userController] updateMyCodes:', error);
        set.status = 500;
        return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
    }
};

// ดึงรายชื่อเพื่อนร่วมกลุ่มภารกิจของผู้ login — ใช้เลือก "ผู้ปฏิบัติงานแทน" ตอนลา (ให้ผู้ใช้เลือกเองในวงกว้างขึ้น)
export const getMyColleagues = async ({ user, set }: any) => {
    try {
        const me = await core_kon`SELECT mission_id FROM users WHERE id = ${user.id}`;
        if (me.length === 0) { set.status = 404; return { success: false, message: 'User not found' }; }
        const { mission_id } = me[0];

        if (mission_id == null) return { success: true, data: { scope: 'none', colleagues: [] } };

        const rows = await core_kon`
            SELECT id, pname, fname, lname, up.position_name
            FROM users u
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            WHERE u.mission_id = ${mission_id} AND u.id <> ${user.id} AND u.is_active = 'Y'
            ORDER BY u.fname`;
        return { success: true, data: { scope: 'mission', colleagues: rows } };
    } catch (error: any) {
        console.error('[userController] getMyColleagues:', error);
        set.status = 500;
        return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
    }
};
