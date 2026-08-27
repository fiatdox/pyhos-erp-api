import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { getMfaConfig, updateMfaConfig, addMfaUser, addAllActiveMfaUsers, removeMfaUser, getMfaAudit } from '../controllers/mfaAdminController';

const TAG = 'MFA';

// ทั้งหมดสงวนไว้สำหรับ ADMIN เท่านั้น — เป็นสวิตช์ควบคุมการเข้าถึงระบบทั้งองค์กร
export const mfaAdminRoutes = new Elysia({ prefix: '/api/v1/mfa' })
    .use(authMiddleware)
    .use(requireRoles('ADMIN'))
    .get('/config', getMfaConfig, {
        detail: { tags: [TAG], summary: 'อ่านค่าตั้ง MFA + รายชื่อผู้ใช้ในขอบเขต' }
    })
    .put('/config', updateMfaConfig, {
        body: t.Object({
            mfa_enabled: t.Optional(t.String()),
            mfa_scope: t.Optional(t.String()),
            mfa_roles: t.Optional(t.String()),
            mfa_otp_ttl_seconds: t.Optional(t.String()),
            mfa_max_attempts: t.Optional(t.String()),
            mfa_resend_cooldown_seconds: t.Optional(t.String()),
            mfa_challenge_ttl_seconds: t.Optional(t.String()),
            password_expiry_enabled: t.Optional(t.String()),
            password_expiry_days: t.Optional(t.String()),
            password_expiry_warn_days: t.Optional(t.String()),
            // นโยบายชื่อผู้ใช้ — ต้องประกาศที่นี่ด้วย ไม่ใช่แค่ ALLOWED_KEYS ใน controller
            // Elysia ตัดคีย์ที่ไม่ได้อยู่ใน schema ทิ้งก่อนถึง handler ค่าที่ส่งมาจะหายเงียบ
            username_policy_mode: t.Optional(t.String()),
            username_policy_scope: t.Optional(t.String()),
            username_policy_pilot: t.Optional(t.String()),
        }),
        detail: { tags: [TAG], summary: 'แก้ค่าตั้ง MFA + นโยบายอายุรหัสผ่าน + นโยบายชื่อผู้ใช้' }
    })
    .post('/users', addMfaUser, {
        body: t.Object({ user_id: t.Numeric() }),
        detail: { tags: [TAG], summary: 'เพิ่มผู้ใช้เข้าขอบเขต MFA (ใช้เมื่อ scope = users)' }
    })
    .post('/users/all-active', addAllActiveMfaUsers, {
        body: t.Object({ dry_run: t.Optional(t.Boolean()) }),
        detail: {
            tags: [TAG],
            summary: 'เพิ่มผู้ปฏิบัติงานทั้งหมดเข้าขอบเขต MFA',
            description: 'ข้ามผู้ที่ไม่มีเลขบัตรประชาชน 13 หลัก (ส่ง OTP ไม่ได้) — ส่ง dry_run=true เพื่อดูจำนวนก่อนโดยไม่เขียนจริง',
        }
    })
    .delete('/users/:id', removeMfaUser, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: [TAG], summary: 'นำผู้ใช้ออกจากขอบเขต MFA' }
    })
    .get('/audit', getMfaAudit, {
        query: t.Object({
            limit: t.Optional(t.Numeric()),
            from: t.Optional(t.String()),
            to: t.Optional(t.String()),
        }),
        detail: {
            tags: [TAG],
            summary: 'ประวัติเหตุการณ์ MFA + สรุปอัตราส่งสำเร็จ/ความหน่วง',
            description: 'กรองด้วย from/to (ISO datetime) — ไม่ระบุ = เฉพาะวันปัจจุบัน สถิติคำนวณตามช่วงเดียวกับตาราง',
        }
    });
