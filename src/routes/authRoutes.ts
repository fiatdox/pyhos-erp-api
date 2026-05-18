import { Elysia, t } from 'elysia';
import { jwt } from '@elysiajs/jwt';
import { rateLimit } from 'elysia-rate-limit';
import { loginCOREKON } from '../controllers/authController';

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
            security: []
        }
    })
