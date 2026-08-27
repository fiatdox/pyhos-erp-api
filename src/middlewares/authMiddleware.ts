import { Elysia } from 'elysia';
import { jwt } from '@elysiajs/jwt';

/**
 * An authentication plugin for Elysia.
 * It verifies the JWT from the Authorization header and adds the user payload to the context.
 */
if (!process.env.JWT_SECRET) {
    throw new Error(
        'JWT_SECRET environment variable is required for authentication. ' +
        'คัดลอก .env.example เป็น .env ที่ root ของโปรเจกต์ แล้วกรอกค่าจริงก่อนรัน (ไฟล์ .env ไม่ได้ติดไปกับ git ตั้งใจ ต้องสร้างเองทุก host)'
    );
}

export const authMiddleware = (app: Elysia) =>
    app.use(
        jwt({
            name: 'jwt',
            secret: process.env.JWT_SECRET!,
            exp: '8h' // กำหนดให้ตรงกัน
        })
    )
    // .derive() adds a new property to the context for this and subsequent handlers.
    // We use it to add a `user` property containing the verified JWT payload.
    .derive(async ({ jwt, headers }) => {
        const auth = headers['authorization'];
        if (!auth || !auth.startsWith('Bearer ')) {
            return { user: null };
        }
        const token = auth.slice(7);
        try {
            // Properly verify JWT with expiration check enabled
            const userPayload = await jwt.verify(token);
            return {
                user: userPayload as { id: number; username: string; unc?: boolean } | null
            };
        } catch {
            // Token is invalid or expired
            return { user: null };
        }
    })
    // .onBeforeHandle is a hook that runs before the main route handler.
    // We use it to protect routes by checking if a user is authenticated.
    .onBeforeHandle(async ({ user, set, path }) => {
        // Check if user is authenticated
        if (!user) {
            set.status = 401;
            return { success: false, message: 'Unauthorized' };
        }

        // ── ด่านบังคับตั้งชื่อผู้ใช้ใหม่ (นโยบาย username_policy_mode = force) ──────
        // claim `unc` ฝังมาตอน login แล้ว — ไม่ต้องคิวรี DB ต่อ request
        // เปิดทางไว้เฉพาะเส้นทางที่จำเป็นต่อการตั้งชื่อใหม่เท่านั้น
        if ((user as any).unc === true && !USERNAME_GATE_ALLOW.has(path)) {
            set.status = 423; // Locked — ยังเข้าสู่ระบบได้ แต่ใช้งานต่อไม่ได้จนกว่าจะตั้งชื่อใหม่
            return {
                success: false,
                code: 'USERNAME_CHANGE_REQUIRED',
                message: 'ชื่อผู้ใช้ของคุณเป็นเลขบัตรประชาชน กรุณาตั้งชื่อผู้ใช้ใหม่ก่อนใช้งานระบบต่อ',
            };
        }
    });

// เส้นทางที่ยังเรียกได้ระหว่างถูกบังคับตั้งชื่อผู้ใช้ใหม่
const USERNAME_GATE_ALLOW = new Set([
    '/api/v1/users/me/username-status',
    '/api/v1/users/me/username-check',
    '/api/v1/users/me/username',
    '/api/v1/users/me/password-status', // แถบเตือนบน Navbar เรียกทุกหน้า
]);