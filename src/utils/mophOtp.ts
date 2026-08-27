// ส่งรหัส OTP เข้า Line หมอพร้อมผ่าน MOPH Alert v3.1 (ช่องทางเดียวกับ mophAlert.ts)
// ต่างจากไฟล์อื่นตรงที่ "ต้องรู้ผลส่ง" — MFA ส่งไม่ถึง = ผู้ใช้เข้าระบบไม่ได้
// จึงคืนค่า { ok, status, ms } ให้ผู้เรียกตัดสินใจ แทนการ fire-and-forget
import { MOPH_ALERTING_URL, formatThaiDate } from './mophAlert';

const MOPH_HEADERS = {
    'Content-Type': 'application/json',
    'client-key': process.env.MOPH_ALERT_CLIENT_ID!,
    'secret-key': process.env.MOPH_ALERT_SECRET_ID!,
};

export interface OtpSendResult {
    ok: boolean;
    status: number;
    ms: number;          // เวลาที่ MOPH ตอบกลับ — เก็บลง audit เพื่อวัดความหน่วง
    error?: string;
}

function buildOtpTemplate(otp: string, ttlMinutes: number): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const spaced = otp.split('').join(' ');   // อ่านง่ายขึ้นบนมือถือ

    return {
        message_title: 'รหัสยืนยันการเข้าสู่ระบบ PYHOS-EXP',
        message_html: `<div><p><strong>รหัสยืนยันการเข้าสู่ระบบ</strong></p><p style="font-size:24px;letter-spacing:4px;"><b>${otp}</b></p><p>ใช้ได้ภายใน ${ttlMinutes} นาที (${thaiDate} ${thaiTime} น.)</p><p style="color:#cc0000;">หากคุณไม่ได้เป็นผู้เข้าสู่ระบบ กรุณาเปลี่ยนรหัสผ่านและแจ้งทีม IT ทันที</p></div>`,
        message_text: `รหัสยืนยันเข้าสู่ระบบ PYHOS-EXP: ${otp} (ใช้ได้ ${ttlMinutes} นาที) หากคุณไม่ได้ทำรายการ กรุณาแจ้งทีม IT`,
        message_type: 'HPT',
        messages: [
            {
                type: 'flex',
                altText: `รหัสยืนยันเข้าสู่ระบบ: ${otp}`,
                contents: {
                    type: 'bubble',
                    header: {
                        type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#0d1b2a',
                        contents: [
                            { type: 'text', text: '🔐 PYHOS-EXP', weight: 'bold', size: 'lg', color: '#10b981' },
                            { type: 'text', text: 'Ministry Hospital Portal', size: 'xs', color: '#6b7280', margin: 'xs' },
                        ],
                    },
                    body: {
                        type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#0f172a',
                        contents: [
                            { type: 'text', text: 'รหัสยืนยันการเข้าสู่ระบบ', weight: 'bold', size: 'xl', color: '#f8fafc', wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box', layout: 'vertical', margin: 'lg',
                                backgroundColor: '#1e293b', paddingAll: '16px', cornerRadius: 'md',
                                contents: [
                                    { type: 'text', text: spaced, weight: 'bold', size: 'xxl', color: '#10b981', align: 'center' },
                                ],
                            },
                            {
                                type: 'text', margin: 'lg', size: 'sm', color: '#94a3b8', wrap: true, align: 'center',
                                text: `ใช้ได้ภายใน ${ttlMinutes} นาที`,
                            },
                            {
                                type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm',
                                contents: [
                                    {
                                        type: 'box', layout: 'baseline',
                                        contents: [
                                            { type: 'text', text: 'วันที่', size: 'sm', color: '#6b7280', flex: 2 },
                                            { type: 'text', text: thaiDate, size: 'sm', color: '#cbd5e1', flex: 5 },
                                        ],
                                    },
                                    {
                                        type: 'box', layout: 'baseline',
                                        contents: [
                                            { type: 'text', text: 'เวลา', size: 'sm', color: '#6b7280', flex: 2 },
                                            { type: 'text', text: `${thaiTime} น.`, size: 'sm', color: '#cbd5e1', flex: 5 },
                                        ],
                                    },
                                ],
                            },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'text', margin: 'md', size: 'xs', color: '#f87171', wrap: true,
                                text: 'อย่าเปิดเผยรหัสนี้แก่ผู้อื่น หากคุณไม่ได้เป็นผู้เข้าสู่ระบบ กรุณาเปลี่ยนรหัสผ่านและแจ้งทีม IT ทันที',
                            },
                        ],
                    },
                },
            },
        ],
    };
}

// ส่ง OTP — ไม่ log ตัวรหัสลง console เด็ดขาด (log ได้แค่สถานะ)
export async function sendOtpAlert(idCard: string, otp: string, ttlSeconds: number): Promise<OtpSendResult> {
    const ttlMinutes = Math.max(1, Math.round(ttlSeconds / 60));
    const payload = { cid: [idCard], ...buildOtpTemplate(otp, ttlMinutes) };
    const started = Date.now();
    try {
        const res = await fetch(MOPH_ALERTING_URL, {
            method: 'POST',
            headers: MOPH_HEADERS,
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000),
        });
        const ms = Date.now() - started;
        const bodyText = await res.text().catch(() => '');
        console.log('[MOPH OTP] send:', res.status, `${ms}ms`);
        return res.ok
            ? { ok: true, status: res.status, ms }
            : { ok: false, status: res.status, ms, error: bodyText.slice(0, 300) };
    } catch (e: any) {
        const ms = Date.now() - started;
        console.error('[MOPH OTP] send failed:', e?.message, `${ms}ms`);
        return { ok: false, status: 0, ms, error: String(e?.message ?? e).slice(0, 300) };
    }
}
