import { core_kon } from '../db/db';
import { sendChangePasswordAlert } from '../utils/mophAlert';

// ดึงรายชื่อผู้ใช้ทั้งหมด (ไม่ดึง password ออกมาเพื่อความปลอดภัย)
export const getAllUsers = async ({ set }: any) => {
    try {
        const users = await core_kon`
            SELECT id, pname, fname, lname, id_card, gender, birthday, hire_date, user_type_id, user_position_id, user_level_id, user_status_id, mission_id, major_id, submajor_id, attendance_id, salary_id, username, is_active, created_at, updated_at, hospital_lc_pid 
            FROM users
            ORDER BY id DESC
        `;
        return { success: true, data: users };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลผู้ใช้รายบุคคล (ไม่ดึง password ออกมา)
export const getUserById = async ({ params, set }: any) => {
    try {
        const users = await core_kon`
            SELECT id, pname, fname, lname, id_card, gender, birthday, hire_date, user_type_id, user_position_id, user_level_id, user_status_id, mission_id, major_id, submajor_id, attendance_id, salary_id, username, is_active, created_at, updated_at, hospital_lc_pid 
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
export const changePassword = async ({ params, body, set }: any) => {
    try {
        const { old_password, new_password } = body;

        const users = await core_kon`
            SELECT id, password, id_card, pname, fname, lname FROM users WHERE id = ${params.id}
        `;
        if (users.length === 0) {
            set.status = 404;
            return { success: false, message: 'User not found' };
        }

        const isMatch = await Bun.password.verify(old_password, users[0].password);
        if (!isMatch) {
            set.status = 400;
            return { success: false, message: 'Old password is incorrect' };
        }

        const hashed = await Bun.password.hash(new_password, { algorithm: 'argon2id' });

        await core_kon`
            UPDATE users SET password = ${hashed}, updated_at = NOW() WHERE id = ${params.id}
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
