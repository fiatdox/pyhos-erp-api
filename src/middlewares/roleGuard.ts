import { Elysia } from 'elysia';
import { core_kon } from '../db/db';

/**
 * Role-based access guard.
 * ใช้ต่อจาก authMiddleware เพื่อจำกัดสิทธิ์ให้เฉพาะ role ที่อนุญาตเท่านั้น
 * ดึง role ของผู้ใช้จาก DB (token เก็บแค่ id/username) แล้วเทียบแบบไม่สนตัวพิมพ์เล็ก/ใหญ่
 *
 *   .use(authMiddleware).use(requireRoles('ADMIN', 'CHIEF_GROUP_IT'))
 */
export const requireRoles = (...allowed: string[]) => (app: Elysia) =>
    app.onBeforeHandle(async ({ user, set }: any) => {
        if (!user?.id) {
            set.status = 401;
            return { success: false, message: 'Unauthorized' };
        }

        const rows = await core_kon`
            SELECT r.role_name
            FROM core_kon.user_m_users_roles mu
            LEFT JOIN core_kon.user_roles r ON r.id = mu.role_id
            WHERE mu.user_id = ${user.id}
        `;

        const roles = rows.map((x: any) => String(x.role_name ?? '').toUpperCase());
        const allowedUpper = allowed.map(a => a.toUpperCase());
        const ok = roles.some(role => allowedUpper.includes(role));

        if (!ok) {
            set.status = 403;
            return { success: false, message: 'Forbidden: insufficient role' };
        }
    });
