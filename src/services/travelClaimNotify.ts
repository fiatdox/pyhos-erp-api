// ── แจ้งเตือนผู้ขอให้เตรียมเอกสารเบิกค่าใช้จ่ายเดินทาง (MOPH Alert — หมอพร้อม ตาม users.id_card) ──
//
// เมื่อไร  08:00–08:59 (เวลาไทย) ของวันถัดจากวันกลับ — ครั้งเดียวต่อคำขอ (hrd_travel_claim_notify_log UNIQUE request_id+kind)
//         เซิร์ฟเวอร์ปิดอยู่ตอน 08:00 = ส่งในช่วง 08:00 ของวันถัดไปที่เปิด (ไม่ส่งเรื่องที่กลับมานานเกิน 7 วัน — กันส่งย้อนหลังทีเดียวทั้งหมด)
// ส่งถึง  ผู้ขอ (เบิกแทนทั้งคณะ) ของคำขอที่ ผอ. อนุมัติ เบิกค่าใช้จ่าย ยังไม่ส่งเบิก
// เปิดใช้  hr_settings name = 'hrd_travel_claim_notify' value = 'on' + ตั้ง MOPH_ALERT_* แล้ว — ไม่ตั้ง = ไม่ส่งอะไร
// ในระบบยังแสดงการ์ด "เตรียมเอกสารเบิก" ในหน้ารายการคำขอเสมอ (ไม่ขึ้นกับการตั้งค่านี้)
import { core_kon } from '../db/db';

const CID_RE = /^\d{13}$/;
const mophConfigured = () => !!(process.env.MOPH_ALERT_BASE_URL && process.env.MOPH_ALERT_CLIENT_ID && process.env.MOPH_ALERT_SECRET_ID);
const bangkokNow = () => {
    const d = new Date(Date.now() + 7 * 3600_000);
    return { hour: d.getUTCHours(), date: d.toISOString().slice(0, 10) };
};
const fmtDate = (iso: Date) => {
    const d = new Date(iso.getTime() + 7 * 3600_000);
    const mon = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][d.getUTCMonth()];
    return `${d.getUTCDate()} ${mon} ${d.getUTCFullYear() + 543}`;
};

/** เอกสารที่ต้องเตรียม (ตรงกับหน้าเว็บ requiredDocs) */
export const claimDocs = (r: { vehicle_mode: string; lodging_mode: string; registration_amount: number; transport_amount: number }) => {
    const docs = ['บันทึกขออนุมัติเดินทางที่ผู้อำนวยการลงนามแล้ว', 'รายงานการเดินทาง (ส่งในระบบคู่กับการเบิก)'];
    if (r.lodging_mode === 'actual') docs.push('ใบเสร็จค่าที่พัก (จ่ายจริง)');
    if (r.vehicle_mode === 'plane') docs.push('ใบเสร็จค่าโดยสาร + กากบัตรโดยสาร (Boarding Pass)');
    if ((r.vehicle_mode === 'bus' || r.vehicle_mode === 'other') && r.transport_amount > 0) docs.push('ใบรับรองแทนใบเสร็จ (บก.๑๑๑) ค่าพาหนะรับจ้าง');
    if (r.registration_amount > 0) docs.push('ใบเสร็จค่าลงทะเบียน');
    docs.push('ใบเสร็จค่าใช้จ่ายที่จ่ายจริงอื่น ๆ (ทางด่วน ฯลฯ) · สัญญายืมเงิน (ถ้ายืม)');
    return docs;
};

const payload = (r: any, docs: string[]) => ({
    messages: [{
        type: 'flex', altText: `เตรียมเอกสารเบิกค่าใช้จ่ายเดินทาง TR-${String(r.id).padStart(6, '0')}`,
        contents: {
            type: 'bubble', size: 'mega',
            header: { type: 'box', layout: 'vertical', backgroundColor: '#4F46E5', paddingAll: '16px',
                contents: [{ type: 'text', text: 'เตรียมเอกสารเบิกค่าใช้จ่ายเดินทาง', color: '#FFFFFF', weight: 'bold', size: 'md', wrap: true }] },
            body: {
                type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
                contents: [
                    { type: 'text', text: `TR-${String(r.id).padStart(6, '0')} · ${r.subject}`, weight: 'bold', size: 'sm', wrap: true, color: '#111827' },
                    { type: 'text', text: `${r.location} · กลับถึง ${fmtDate(new Date(r.end_at))}`, size: 'xs', color: '#6B7280', wrap: true },
                    { type: 'separator', margin: 'md' },
                    ...docs.map((d, i) => ({ type: 'text', text: `${i + 1}. ${d}`, size: 'sm', color: '#111827', wrap: true, margin: i ? 'xs' : 'md' })),
                    { type: 'text', text: 'บันทึกเบิกได้ที่ ระบบเดินทางไปราชการ › รายการคำขอ', size: 'xs', color: '#6B7280', wrap: true, margin: 'lg' },
                ],
            },
        },
    }],
});

/** รอบเดียว: หาคำขอที่ถึงเวลาแจ้ง แล้วส่ง — คืนจำนวนที่ส่งได้ */
export const runClaimDue = async () => {
    const [cfg] = await core_kon`SELECT value FROM hr_settings WHERE name = 'hrd_travel_claim_notify'`.catch(() => [null]);
    if (String(cfg?.value ?? '').trim().toLowerCase() !== 'on') return 0;
    const due = await core_kon`
        SELECT r.id, r.subject, r.location, r.end_at, r.vehicle_mode, r.lodging_mode, r.registration_amount::float8 AS registration_amount,
               (r.transport_amount + r.taxi_go_amount + r.taxi_back_amount + r.home_station_amount)::float8 AS transport_amount, u.id_card
        FROM hrd_travel_requests r JOIN users u ON u.id = r.requester_id
        LEFT JOIN hrd_travel_claims c ON c.request_id = r.id
        WHERE r.status = 'submitted' AND r.approval_stage = 'approved' AND r.cost_mode <> 'no_claim' AND r.actual_amount IS NULL
          AND (c.id IS NULL OR c.status = 'draft')
          AND ((date_trunc('day', r.end_at AT TIME ZONE 'Asia/Bangkok') + interval '1 day 8 hours') AT TIME ZONE 'Asia/Bangkok') <= now()
          AND r.end_at > now() - interval '8 days'
          AND NOT EXISTS (SELECT 1 FROM hrd_travel_claim_notify_log l WHERE l.request_id = r.id AND l.kind = 'claim_due')
        ORDER BY r.end_at LIMIT 200`;
    let sent = 0;
    for (const r of due) {
        // จองก่อนส่ง (กันส่งซ้ำเมื่อมีหลาย instance)
        const [slot] = await core_kon`INSERT INTO hrd_travel_claim_notify_log (request_id, kind, status, detail) VALUES (${r.id}, 'claim_due', 'SKIPPED', 'กำลังส่ง')
                                      ON CONFLICT (request_id, kind) DO NOTHING RETURNING id`;
        if (!slot) continue;
        const cid = String(r.id_card ?? '').trim();
        const done = (status: string, detail: string) => core_kon`UPDATE hrd_travel_claim_notify_log SET status = ${status}, detail = ${detail.slice(0, 300)}, sent_at = NOW() WHERE id = ${slot.id}`;
        if (!CID_RE.test(cid)) { await done('SKIPPED', 'ผู้ขอไม่มีเลขบัตรประชาชน'); continue; }
        if (!mophConfigured()) { await done('SKIPPED', 'ยังไม่ได้ตั้งค่า MOPH_ALERT_* ที่เซิร์ฟเวอร์'); continue; }
        try {
            const res = await fetch(`${process.env.MOPH_ALERT_BASE_URL}/alert/v3.1/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'client-key': process.env.MOPH_ALERT_CLIENT_ID!, 'secret-key': process.env.MOPH_ALERT_SECRET_ID! },
                body: JSON.stringify({ cid: [cid], ...payload(r, claimDocs(r)) }),
                signal: AbortSignal.timeout(15_000),
            });
            await done(res.ok ? 'SENT' : 'FAILED', res.ok ? 'ส่งแล้ว' : `HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
            if (res.ok) sent++;
        } catch (e: any) {
            await done('FAILED', String(e?.message ?? e));
        }
    }
    return sent;
};

let timer: ReturnType<typeof setInterval> | null = null;
let lastDay = '';
/** ตรวจทุก 1 นาที — ทำงานช่วง 08:00–08:59 เวลาไทย วันละรอบ (รอบถัดไปในวันเดียวกันจะไม่มีคำขอเหลือเพราะบันทึก log แล้ว) */
export const startTravelClaimNotifyJob = () => {
    if (timer) return;
    timer = setInterval(async () => {
        const now = bangkokNow();
        if (now.hour !== 8 || lastDay === now.date) return;
        try {
            const n = await runClaimDue();
            lastDay = now.date;
            if (n) console.log(`[travelClaimNotify] ${now.date} แจ้งเตรียมเอกสารเบิก ${n} คำขอ`);
        } catch (e: any) {
            console.error('[travelClaimNotify] ไม่สำเร็จ:', e?.message);
        }
    }, 60_000);
};
