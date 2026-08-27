import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { rateLimit } from 'elysia-rate-limit';
import { loginCOREKON, verifyOtp, resendOtp } from '../controllers/authController';

export const authRoutes = new Elysia({ prefix: '/api/v1/auth' })
    .use(rateLimit({
        duration: 60000,
        max: 100,
        generator: (req, server) => server?.requestIP(req)?.address ?? req.headers.get('x-forwarded-for') ?? 'unknown',
        errorResponse: new Response(
            JSON.stringify({ success: false, message: 'Too many login attempts. Please try again later.' }),
            { status: 429, headers: { 'Content-Type': 'application/json' } }
        )
    }))
    .use(jwt({
        name: 'jwt',
        secret: process.env.JWT_SECRET || 'your-secret-key',
        exp: '8h' // ปรับอายุ Token เป็น 8 ชั่วโมง
    }))
    .post('/login', loginCOREKON, {
        body: t.Object({
            username: t.String(),
            password: t.String()
        }),
        detail: {
            tags: ['Auth'],
            security: [],
            summary: 'เข้าสู่ระบบ',
            description: 'ถ้า MFA ปิดอยู่ (ค่าเริ่มต้น) หรือผู้ใช้ไม่อยู่ในขอบเขต จะคืน token ทันทีเหมือนเดิม — ถ้าต้องยืนยัน OTP จะคืน mfa_required=true พร้อม challenge_token แทน token',
        }
    })
    .post('/verify-otp', verifyOtp, {
        body: t.Object({
            challenge_token: t.String(),
            otp: t.String({ minLength: 4, maxLength: 10 }),
        }),
        detail: {
            tags: ['Auth'],
            security: [],
            summary: 'ยืนยันรหัส OTP จาก Line หมอพร้อม',
            description: 'ยืนยันสำเร็จจึงจะได้ token — กรอกผิดเกิน mfa_max_attempts จะตัดรอบ ต้อง login ใหม่',
        }
    })
    .post('/resend-otp', resendOtp, {
        body: t.Object({ challenge_token: t.String() }),
        detail: {
            tags: ['Auth'],
            security: [],
            summary: 'ขอรหัส OTP ใหม่',
            description: 'ต้องรอครบ cooldown และขอซ้ำได้ไม่เกิน 3 ครั้งต่อรอบ — ไม่ยืดอายุรวมของ challenge',
        }
    });
