// ── การแจ้งเตือนระบบลาออนไลน์ (MOPH Alert — หมอพร้อมรายคน ตาม users.id_card) ─────────────────
//
// ผู้รับและจังหวะ (ผู้ดูแลระบบตั้งค่าที่ /hr/leave/notify-settings — ค่าตั้งเก็บที่ hr_leave_notify_config):
//   เพื่อนร่วมงาน  ยื่นใบลาแล้วแจ้งคนในหน่วยงานเดียวกัน (ไม่มีหน่วยงาน → กลุ่มงาน) — บอกแค่ชื่อ/วันที่ "ลา"
//                 ไม่บอกประเภท/เหตุผล (ข้อมูลส่วนตัว — กติกาเดียวกับปฏิทินการลา) · ส่งครั้งเดียวถึงทุกคน (cid หลายเลข)
//   ผู้อนุมัติ     ตั้งรายระดับ instant / digest / off — กลุ่มภารกิจตั้งรายภารกิจได้ (ภารกิจคนเยอะให้สรุปเป็นรอบ)
//                 instant: รวมใบที่เข้าคิวของคนเดียวกันภายใน 1 นาทีเป็นข้อความเดียว (กดอนุมัติแบบกลุ่มไม่เตือนรัว)
//                 digest : สรุปยอดรออนุมัติตามเวลาที่ตั้ง (ค่าตั้งต้น 08:00 12:00 16:00) ไม่มีใบรอ = ไม่ส่ง
//   ผู้ลา         แจ้งเมื่อยื่นใบลาเข้าระบบแล้ว (รวมกรณี HR ยื่นแทน) · แจ้งผลอนุมัติ / ไม่อนุมัติ / ยกเลิกสำเร็จ
//
// ปลอดภัยไว้ก่อน: ไม่มีค่าตั้ง / ตารางยังไม่ได้สร้าง / ยังไม่ตั้ง MOPH_ALERT_* = ไม่ส่งอะไรเลย
// การส่งทำหลัง transaction ของใบลาเสร็จ และไม่โยน error กลับ — ส่งไม่สำเร็จต้องไม่ทำให้การลาล้ม
import { core_kon } from '../db/db';
import { parseChain, stepFor, type ApprovalLevel, type ChainStep } from './leaveChain';
import { holidaysBetween } from './leaveDays';
import { bangkokDate } from './leaveRules';

export type NotifyMode = 'instant' | 'digest' | 'off';
export type ApproverLevel = Exclude<ApprovalLevel, 'PROVINCIAL'>;

export interface LeaveNotifyConfig {
    enabled: boolean;
    colleague: { enabled: boolean; scope: 'unit_or_group' | 'unit_only' };
    approver: Record<ApproverLevel, NotifyMode>;
    /** กลุ่มภารกิจที่ตั้งต่างจากค่าระดับ MISSION — key = mission_id */
    mission_overrides: Record<string, NotifyMode>;
    digest_times: string[];
    digest_skip_holidays: boolean;
    applicant_submitted: boolean;
    applicant_result: boolean;
    /** ที่อยู่หน้าเว็บ เช่น https://erp.example.go.th — ใส่แล้วข้อความมีปุ่มเปิดหน้าอนุมัติ/ประวัติ */
    app_url: string | null;
}

export const DEFAULT_CONFIG: LeaveNotifyConfig = {
    enabled: false,
    colleague: { enabled: true, scope: 'unit_or_group' },
    approver: { SUBMAJOR: 'instant', MAJOR: 'instant', MISSION: 'digest', DIRECTOR: 'digest' },
    mission_overrides: {},
    digest_times: ['08:00', '12:00', '16:00'],
    digest_skip_holidays: true,
    applicant_submitted: true,
    applicant_result: true,
    app_url: null,
};

const MODES: NotifyMode[] = ['instant', 'digest', 'off'];
const LEVELS: ApproverLevel[] = ['SUBMAJOR', 'MAJOR', 'MISSION', 'DIRECTOR'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** ตรวจ/เติมค่าตั้งให้ครบ — ค่าที่ไม่รู้จักใช้ค่าตั้งต้น */
export const normalizeConfig = (raw: any): LeaveNotifyConfig => {
    const c = raw && typeof raw === 'object' ? raw : {};
    const mode = (v: unknown, d: NotifyMode): NotifyMode => MODES.includes(v as NotifyMode) ? v as NotifyMode : d;
    const overrides: Record<string, NotifyMode> = {};
    for (const [k, v] of Object.entries(c.mission_overrides ?? {})) {
        if (/^\d+$/.test(k) && MODES.includes(v as NotifyMode)) overrides[k] = v as NotifyMode;
    }
    const times = [...new Set((Array.isArray(c.digest_times) ? c.digest_times : DEFAULT_CONFIG.digest_times)
        .map((t: unknown) => String(t)).filter((t: string) => TIME_RE.test(t)))].sort().slice(0, 12) as string[];
    const url = typeof c.app_url === 'string' && /^https?:\/\/[^\s]+$/.test(c.app_url.trim()) ? c.app_url.trim().replace(/\/+$/, '') : null;
    return {
        enabled: c.enabled === true,
        colleague: {
            enabled: c.colleague?.enabled !== false,
            scope: c.colleague?.scope === 'unit_only' ? 'unit_only' : 'unit_or_group',
        },
        approver: Object.fromEntries(LEVELS.map(l => [l, mode(c.approver?.[l], DEFAULT_CONFIG.approver[l])])) as Record<ApproverLevel, NotifyMode>,
        mission_overrides: overrides,
        digest_times: times,
        digest_skip_holidays: c.digest_skip_holidays !== false,
        applicant_submitted: c.applicant_submitted !== false,
        applicant_result: c.applicant_result !== false,
        app_url: url,
    };
};

// ── ค่าตั้ง (แคช 30 วินาที — อ่านทุกครั้งที่มีการยื่น/อนุมัติ) ───────────────────────────
let cache: { at: number; config: LeaveNotifyConfig; ready: boolean } | null = null;
const missingTable = (e: any) => /hr_leave_notify_(config|log)/.test(String(e?.message ?? '')) && /does not exist/.test(String(e?.message ?? ''));

export const loadConfig = async (): Promise<{ config: LeaveNotifyConfig; ready: boolean }> => {
    if (cache && Date.now() - cache.at < 30_000) return cache;
    try {
        const [row] = await core_kon`SELECT config FROM hr_leave_notify_config WHERE id = 1`;
        cache = { at: Date.now(), config: normalizeConfig(row?.config ?? DEFAULT_CONFIG), ready: true };
    } catch (e: any) {
        if (!missingTable(e)) console.error('[leaveNotify] อ่านค่าตั้งไม่สำเร็จ:', e?.message);
        cache = { at: Date.now(), config: { ...DEFAULT_CONFIG }, ready: false };
    }
    return cache;
};

export const saveConfig = async (raw: any, actorId: number | null) => {
    const config = normalizeConfig(raw);
    await core_kon`
        INSERT INTO hr_leave_notify_config (id, config, updated_by) VALUES (1, ${JSON.stringify(config)}::text::jsonb, ${actorId})
        ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now(), updated_by = EXCLUDED.updated_by`;
    cache = null;
    return config;
};

export const mophConfigured = () => !!(process.env.MOPH_ALERT_BASE_URL && process.env.MOPH_ALERT_CLIENT_ID && process.env.MOPH_ALERT_SECRET_ID);

const writeLog = async (kind: string, status: 'SENT' | 'SKIPPED' | 'FAILED', recipients: number, detail: string, requestId: number | null = null) => {
    try {
        await core_kon`
            INSERT INTO hr_leave_notify_log (kind, request_id, recipients, status, detail)
            VALUES (${kind}, ${requestId}, ${recipients}, ${status}, ${detail.slice(0, 2000)})`;
    } catch (e: any) {
        if (!missingTable(e)) console.error('[leaveNotify] บันทึกประวัติไม่สำเร็จ:', e?.message);
    }
};

// ── ข้อความ (Flex card พื้นขาว — แถบสีหัวการ์ดบอกชนิดข้อความ, หัวข้อเด่น, รายละเอียดเป็นตาราง 2 คอลัมน์) ──────
// items = รายการเป็นก้อน (ชื่อตัวหนา แล้วรายละเอียดทีละบรรทัด คั่นด้วยเส้น) — ใช้กับ ผอ. ที่ต้องเห็นครบทุกใบ
interface Message {
    title: string; heading: string; rows: { label: string; value: string }[];
    items?: { title: string; lines: string[] }[];
    accent?: string; link?: { label: string; path: string };
}

const sentAt = () => {
    const d = new Date(Date.now() + 7 * 3_600_000);
    return `${fmtDay(d.toISOString())} ${d.toISOString().slice(11, 16)} น.`;
};

const buildPayload = (m: Message, appUrl: string | null) => {
    const accent = m.accent ?? '#047857';
    const esc = (s: string) => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
    const uri = appUrl && m.link ? `${appUrl}${m.link.path}` : null;
    return {
        message_title: m.title,
        message_html: `<div><p><strong>${esc(m.heading)}</strong></p>${(m.items ?? []).map(it => `<p><b>${esc(it.title)}</b><br>${it.lines.map(esc).join('<br>')}</p><hr>`).join('')}<ul>${m.rows.map(r => `<li><b>${esc(r.label)}:</b> ${esc(r.value)}</li>`).join('')}</ul>${uri ? `<p><a href="${esc(uri)}">${esc(m.link!.label)}</a></p>` : ''}</div>`,
        message_text: `${m.heading} — ${[...(m.items ?? []).map(it => `${it.title} ${it.lines.join(' ')}`), ...m.rows.map(r => `${r.label}: ${r.value}`)].join(' · ')}`,
        message_type: 'HPT',
        messages: [{
            type: 'flex',
            altText: m.heading,
            contents: {
                type: 'bubble', size: 'mega',
                header: {
                    type: 'box', layout: 'vertical', paddingAll: '16px', paddingStart: '20px', backgroundColor: accent,
                    contents: [
                        { type: 'text', text: 'ระบบลาออนไลน์ · PYHOS-EXP', size: 'xxs', color: '#FFFFFFCC' },
                        { type: 'text', text: m.title, weight: 'bold', size: 'md', color: '#FFFFFF', margin: 'xs', wrap: true },
                    ],
                },
                body: {
                    type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#FFFFFF',
                    contents: [
                        { type: 'text', text: m.heading, weight: 'bold', size: 'lg', color: '#111827', wrap: true },
                        { type: 'separator', margin: 'lg', color: '#E5E7EB' },
                        ...(m.items ?? []).flatMap(it => [
                            {
                                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'xs',
                                contents: [
                                    { type: 'text', text: it.title, size: 'md', weight: 'bold', color: '#111827', wrap: true },
                                    ...it.lines.map(l => ({ type: 'text', text: l, size: 'sm', color: '#374151', wrap: true })),
                                ],
                            },
                            { type: 'separator', margin: 'lg', color: '#E5E7EB' },
                        ]),
                        ...(m.rows.length ? [{
                            type: 'box', layout: 'vertical', margin: 'lg', spacing: 'md',
                            contents: m.rows.map(r => ({
                                type: 'box', layout: 'horizontal', spacing: 'md',
                                contents: [
                                    { type: 'text', text: r.label, size: 'sm', color: '#6B7280', flex: 3, wrap: true },
                                    { type: 'text', text: r.value, size: 'sm', color: '#111827', weight: 'bold', flex: 4, wrap: true },
                                ],
                            })),
                        }] : []),
                        { type: 'text', text: `ส่งเมื่อ ${sentAt()}`, size: 'xxs', color: '#9CA3AF', margin: 'xl' },
                    ],
                },
                ...(uri ? {
                    footer: {
                        type: 'box', layout: 'vertical', backgroundColor: '#FFFFFF', paddingAll: '16px', paddingTop: '0px',
                        contents: [{ type: 'button', style: 'primary', color: accent, height: 'sm', action: { type: 'uri', label: m.link!.label, uri } }],
                    },
                } : {}),
                styles: { footer: { separator: false } },
            },
        }],
    };
};

/** ส่งถึงหลายคนในครั้งเดียว (cid หลายเลข) — คืนจำนวนผู้รับที่ส่งได้ */
const CID_RE = /^\d{13}$/;
const send = async (kind: string, cids: (string | null | undefined)[], m: Message, requestId: number | null = null): Promise<number> => {
    const list = [...new Set(cids.map(c => String(c ?? '').trim()).filter(c => CID_RE.test(c)))];
    if (list.length === 0) { await writeLog(kind, 'SKIPPED', 0, `${m.heading} — ไม่มีผู้รับที่มีเลขบัตรประชาชน`, requestId); return 0; }
    if (!mophConfigured()) { await writeLog(kind, 'SKIPPED', list.length, `${m.heading} — ยังไม่ได้ตั้งค่า MOPH_ALERT_* ที่เซิร์ฟเวอร์`, requestId); return 0; }
    const { config } = await loadConfig();
    try {
        const res = await fetch(`${process.env.MOPH_ALERT_BASE_URL}/alert/v3.1/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'client-key': process.env.MOPH_ALERT_CLIENT_ID!, 'secret-key': process.env.MOPH_ALERT_SECRET_ID! },
            body: JSON.stringify({ cid: list, ...buildPayload(m, config.app_url) }),
            signal: AbortSignal.timeout(15_000),
        });
        const text = (await res.text()).slice(0, 300);
        await writeLog(kind, res.ok ? 'SENT' : 'FAILED', list.length, `${m.heading}${res.ok ? '' : ` — HTTP ${res.status} ${text}`}`, requestId);
        return res.ok ? list.length : 0;
    } catch (e: any) {
        await writeLog(kind, 'FAILED', list.length, `${m.heading} — ${String(e?.message ?? e).slice(0, 300)}`, requestId);
        return 0;
    }
};

// ── ข้อมูลใบลา ─────────────────────────────────────────────────────────────────
const fmtDay = (d: string) => {
    const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
    const mon = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][m];
    return `${dd} ${mon} ${y + 543}`;
};
const span = (s: string, e: string) => s === e ? fmtDay(s) : `${fmtDay(s)} – ${fmtDay(e)}`;
const daysText = (n: unknown) => `${Number(n)} วัน`;

const loadRequest = async (id: number) => {
    const [r] = await core_kon`
        SELECT r.id, r.user_id, r.status, r.approval_chain, r.current_step, r.total_days, r.reject_reason, r.reason,
               to_char(r.start_date, 'YYYY-MM-DD') AS start_date, to_char(r.end_date, 'YYYY-MM-DD') AS end_date,
               t.name_th AS leave_type_name, CONCAT(u.pname, u.fname, ' ', u.lname) AS name, u.id_card,
               u.submajor_id, u.major_id, COALESCE(sm.name, mj.name) AS unit_name, mj.name AS major_name
        FROM hr_leave_requests r
        JOIN hr_leave_types t ON t.id = r.leave_type_id
        JOIN users u ON u.id = r.user_id
        LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
        LEFT JOIN majors mj ON mj.major_id = u.major_id
        WHERE r.id = ${id}`;
    return r ?? null;
};

/** โหมดแจ้งของขั้นนี้ — กลุ่มภารกิจดูค่าตั้งรายภารกิจก่อน */
export const modeOfStep = (config: LeaveNotifyConfig, step: ChainStep | null | undefined): NotifyMode => {
    if (!step || step.external || !step.approver_id || step.level === 'PROVINCIAL') return 'off';
    if (step.level === 'MISSION' && step.unit_id != null && config.mission_overrides[String(step.unit_id)]) {
        return config.mission_overrides[String(step.unit_id)];
    }
    return config.approver[step.level as ApproverLevel] ?? 'off';
};

// ── ผู้อนุมัติแบบทันที: รวมคิวของคนเดียวกันภายใน 1 นาที ──────────────────────────────────
const INSTANT_WINDOW_MS = 60_000;
const instantQueue = new Map<number, { ids: Set<number>; timer: ReturnType<typeof setTimeout> }>();

const queueApprover = (approverId: number, requestId: number) => {
    const q = instantQueue.get(approverId);
    if (q) { q.ids.add(requestId); return; }
    const entry = { ids: new Set([requestId]), timer: setTimeout(() => void flushApprover(approverId), INSTANT_WINDOW_MS) };
    instantQueue.set(approverId, entry);
};

/** ข้อความถึงผู้อนุมัติแบบทันที — ใบเดียวแสดงรายละเอียด หลายใบแสดงเป็นรายการ (ชื่อ + วันที่)
 *  group (หัวหน้ากลุ่มภารกิจ — ใบเยอะ) = ก้อนละกลุ่มงาน: ยอดใบ/วัน แยกตามประเภทการลา คั่นด้วยเส้น
 *  full (หัวหน้าหน่วยงาน/ตึก และ ผอ./รักษาการ — ใบไม่เยอะ) = ทุกใบเป็นก้อน: ชื่อ / ประเภท / วันที่ / จำนวนวัน / เหตุผล คั่นด้วยเส้น */
type InstantStyle = 'normal' | 'full' | 'group';
const instantStyleOf = (level: unknown): InstantStyle => level === 'SUBMAJOR' || level === 'DIRECTOR' ? 'full' : level === 'MISSION' ? 'group' : 'normal';
const instantMessage = (rows: any[], style: InstantStyle = 'normal'): Message => {
    const one = rows.length === 1 ? rows[0] : null;
    if (style === 'group') {
        // หัวหน้ากลุ่มภารกิจ — รวมตามกลุ่มงาน แล้วรวมตามประเภทการลา (กลุ่มงานใบมากขึ้นก่อน)
        const groups = new Map<string, { n: number; types: Map<string, { n: number; days: number }> }>();
        for (const r of rows) {
            const g = groups.get(r.major_name || 'ไม่ระบุกลุ่มงาน') ?? { n: 0, types: new Map() };
            const type = `${r.status === 'CANCEL_PENDING' ? 'ขอยกเลิก' : ''}${r.leave_type_name}`;
            const t = g.types.get(type) ?? { n: 0, days: 0 };
            t.n++; t.days += Number(r.total_days) || 0;
            g.types.set(type, t); g.n++;
            groups.set(r.major_name || 'ไม่ระบุกลุ่มงาน', g);
        }
        const sorted = [...groups.entries()].sort((a, z) => z[1].n - a[1].n);
        const max = 12;
        return {
            title: 'ใบลารออนุมัติ',
            heading: `ใบลารอท่านอนุมัติ ${rows.length} ใบ`,
            items: sorted.slice(0, max).map(([name, g]) => ({
                title: `${name} (${g.n} ใบ)`,
                lines: [...g.types.entries()].sort((a, z) => z[1].n - a[1].n)
                    .map(([type, t]) => `${type}: ${t.n} ใบ (${daysText(t.days)})`),
            })),
            rows: sorted.length > max ? [{ label: 'กลุ่มงานอื่น', value: `${sorted.slice(max).reduce((s, [, g]) => s + g.n, 0)} ใบ` }] : [],
            accent: '#B45309',
            link: { label: 'เปิดหน้าอนุมัติการลา', path: '/hr/leave/approval' },
        };
    }
    if (style === 'full') {
        // หัวหน้าหน่วยงาน/ตึก · ผอ. — ทุกใบเป็นก้อน: ชื่อ / ประเภท / วันที่ / จำนวนวัน / เหตุผล คั่นด้วยเส้น
        const max = 12;
        return {
            title: 'ใบลารออนุมัติ',
            heading: `ใบลารอท่านอนุมัติ ${rows.length} ใบ`,
            items: rows.slice(0, max).map((r: any) => ({
                title: r.name,
                lines: [
                    `ประเภท: ${r.status === 'CANCEL_PENDING' ? 'ขอยกเลิก' : ''}${r.leave_type_name}`,
                    `วันที่: ${span(r.start_date, r.end_date)}`,
                    `จำนวน: ${daysText(r.total_days)}`,
                    `เหตุผล: ${String(r.reason ?? '').trim().slice(0, 200) || '-'}`,
                ],
            })),
            rows: rows.length > max ? [{ label: 'และอื่น ๆ', value: `${rows.length - max} ใบ` }] : [],
            accent: '#B45309',
            link: { label: 'เปิดหน้าอนุมัติการลา', path: '/hr/leave/approval' },
        };
    }
    return {
        title: 'ใบลารออนุมัติ',
        heading: one ? `ใบลารอท่านอนุมัติ: ${one.name}` : `ใบลารอท่านอนุมัติ ${rows.length} ใบ`,
        rows: one
            ? [
                { label: 'ผู้ลา', value: `${one.name}${one.unit_name ? ` (${one.unit_name})` : ''}` },
                { label: 'ประเภท', value: one.status === 'CANCEL_PENDING' ? `ขอยกเลิก${one.leave_type_name}` : one.leave_type_name },
                { label: 'วันที่', value: `${span(one.start_date, one.end_date)} (${daysText(one.total_days)})` },
            ]
            : rows.slice(0, 8).map((r: any) => ({ label: r.name, value: `${r.status === 'CANCEL_PENDING' ? 'ขอยกเลิก · ' : ''}${span(r.start_date, r.end_date)}` }))
                .concat(rows.length > 8 ? [{ label: 'และอื่น ๆ', value: `${rows.length - 8} ใบ` }] : []),
        accent: '#B45309',
        link: { label: 'เปิดหน้าอนุมัติการลา', path: '/hr/leave/approval' },
    };
};

const flushApprover = async (approverId: number) => {
    const q = instantQueue.get(approverId);
    instantQueue.delete(approverId);
    if (!q) return;
    try {
        const { config } = await loadConfig();
        if (!config.enabled) return;
        // ยังรอคนนี้อยู่จริงไหม (อาจอนุมัติไปแล้วระหว่างรอ 1 นาที)
        const steps = new Map<number, ChainStep | null>();
        const rows = (await Promise.all([...q.ids].map(loadRequest))).filter((r: any) => {
            if (!r || !['PENDING', 'CANCEL_PENDING'].includes(r.status)) return false;
            const st = stepFor(parseChain(r.approval_chain), Number(r.current_step));
            steps.set(Number(r.id), st ?? null);
            return Number(st?.approver_id) === approverId;
        });
        if (rows.length === 0) return;
        const [me] = await core_kon`SELECT id_card FROM users WHERE id = ${approverId} AND is_active = 'Y'`;
        // รูปแบบตามระดับของขั้นที่รอ — หัวหน้าหน่วยงาน/ตึก และ ผอ. แบบครบทุกใบ (ปนหลายระดับ = แบบปกติ)
        const levels = new Set(rows.map((r: any) => steps.get(Number(r.id))?.level));
        const style = levels.size === 1 ? instantStyleOf([...levels][0]) : 'normal';
        await send('APPROVER', [me?.id_card], instantMessage(rows, style), rows.length === 1 ? Number(rows[0].id) : null);
    } catch (e: any) {
        console.error('[leaveNotify] แจ้งผู้อนุมัติไม่สำเร็จ:', e?.message);
    }
};

// ── เพื่อนร่วมงาน: คนในหน่วยงานเดียวกัน (ไม่มีหน่วยงาน → คนในกลุ่มงานที่ไม่มีหน่วยงานเช่นกัน ถ้าตั้ง unit_or_group) ──
const colleaguesOf = async (r: any, config: LeaveNotifyConfig) => {
    if (r.submajor_id != null) {
        return core_kon`SELECT id_card FROM users WHERE is_active = 'Y' AND submajor_id = ${r.submajor_id} AND id <> ${r.user_id}`;
    }
    if (config.colleague.scope === 'unit_or_group' && r.major_id != null) {
        return core_kon`SELECT id_card FROM users WHERE is_active = 'Y' AND major_id = ${r.major_id} AND submajor_id IS NULL AND id <> ${r.user_id}`;
    }
    return [];
};

/** บอกแค่ชื่อ วันที่ และว่า "ลา" — ไม่บอกประเภท/เหตุผล (ข้อมูลส่วนตัว) */
const colleagueMessage = (r: any): Message => ({
    title: 'เพื่อนร่วมงานแจ้งลา',
    heading: `${r.name} แจ้งลา`,
    rows: [
        { label: 'วันที่', value: `${span(r.start_date, r.end_date)} (${daysText(r.total_days)})` },
        ...(r.unit_name ? [{ label: 'หน่วยงาน', value: r.unit_name }] : []),
        { label: 'สถานะ', value: 'รออนุมัติ' },
    ],
    link: { label: 'ดูปฏิทินการลา', path: '/hr/leave/calendar' },
});

// ── เหตุการณ์จากใบลา (เรียกหลัง transaction เสร็จ — ไม่ต้อง await) ─────────────────────────
export type LeaveEvent = 'SUBMITTED' | 'ACTED' | 'CANCEL_REQUESTED';

export const notifyLeaveEvent = async (requestId: number, event: LeaveEvent): Promise<void> => {
    try {
        const { config, ready } = await loadConfig();
        if (!ready || !config.enabled) return;
        const r = await loadRequest(requestId);
        if (!r) return;
        const chain = parseChain(r.approval_chain);

        // ผู้ลา — ยืนยันว่าใบเข้าระบบแล้ว (รู้ตัวด้วยถ้า HR ยื่นแทน)
        if (event === 'SUBMITTED' && config.applicant_submitted) {
            await send('SUBMITTED', [r.id_card], {
                title: 'ยื่นใบลาแล้ว',
                heading: 'ระบบรับใบลาของท่านแล้ว',
                rows: [
                    { label: 'ประเภท', value: r.leave_type_name },
                    { label: 'วันที่', value: `${span(r.start_date, r.end_date)} (${daysText(r.total_days)})` },
                    { label: 'สถานะ', value: r.status === 'APPROVED' ? 'อนุมัติแล้ว' : 'รออนุมัติ' },
                ],
                link: { label: 'ดูประวัติการลา', path: '/hr/leave/history' },
            }, Number(r.id));
        }

        // เพื่อนร่วมงาน — ตอนยื่นใบลาเท่านั้น
        if (event === 'SUBMITTED' && config.colleague.enabled) {
            const mates = await colleaguesOf(r, config);
            if (mates.length) await send('COLLEAGUE', mates.map((m: any) => m.id_card), colleagueMessage(r), Number(r.id));
        }

        // ผู้อนุมัติขั้นที่ใบกำลังรอ
        if (r.status === 'PENDING' || r.status === 'CANCEL_PENDING') {
            const step = stepFor(chain, Number(r.current_step));
            if (modeOfStep(config, step) === 'instant') queueApprover(Number(step!.approver_id), Number(r.id));
            return;
        }

        // ผลถึงผู้ลา — อนุมัติครบ / ไม่อนุมัติ / ยกเลิกสำเร็จ
        if (event === 'ACTED' && config.applicant_result && ['APPROVED', 'REJECTED', 'CANCELLED'].includes(r.status)) {
            const label = r.status === 'APPROVED' ? 'อนุมัติแล้ว' : r.status === 'REJECTED' ? 'ไม่อนุมัติ' : 'ยกเลิกใบลาแล้ว';
            await send('RESULT', [r.id_card], {
                title: `ผลการลา: ${label}`,
                heading: `ใบลาของท่าน${label}`,
                rows: [
                    { label: 'ประเภท', value: r.leave_type_name },
                    { label: 'วันที่', value: `${span(r.start_date, r.end_date)} (${daysText(r.total_days)})` },
                    ...(r.status === 'REJECTED' && r.reject_reason ? [{ label: 'เหตุผล', value: String(r.reject_reason) }] : []),
                ],
                accent: r.status === 'APPROVED' ? '#047857' : '#B91C1C',
                link: { label: 'ดูประวัติการลา', path: '/hr/leave/history' },
            }, Number(r.id));
        }
    } catch (e: any) {
        console.error(`[leaveNotify] ใบลา #${requestId} (${event}):`, e?.message);
    }
};

// ── สรุปรออนุมัติตามรอบเวลา ────────────────────────────────────────────────────────
/** ใบที่รอแต่ละคน (เฉพาะขั้นที่ตั้งเป็น digest) — ใช้ทั้งรอบจริงและตัวอย่างในหน้าตั้งค่า */
export const digestBuckets = async (config: LeaveNotifyConfig, only?: (step: ChainStep) => boolean) => {
    const rows = await core_kon`
        SELECT r.id, r.status, r.approval_chain, r.current_step, r.created_at, r.updated_at,
               COALESCE(sm.name, mj.name, 'ไม่ระบุหน่วยงาน') AS unit_name
        FROM hr_leave_requests r
        JOIN users u ON u.id = r.user_id
        LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
        LEFT JOIN majors mj ON mj.major_id = u.major_id
        WHERE r.status IN ('PENDING', 'CANCEL_PENDING')`;
    const buckets = new Map<number, { level: string; code: string; count: number; cancel: number; oldest: Date; units: Map<string, number>; ids: number[] }>();
    for (const r of rows as any[]) {
        const step = stepFor(parseChain(r.approval_chain), Number(r.current_step));
        if (modeOfStep(config, step) !== 'digest' || (only && !only(step!))) continue;
        const id = Number(step!.approver_id);
        const b = buckets.get(id) ?? { level: step!.level_name, code: step!.level, count: 0, cancel: 0, oldest: new Date(r.updated_at ?? r.created_at), units: new Map(), ids: [] as number[] };
        b.count++;
        b.ids.push(Number(r.id));
        if (r.status === 'CANCEL_PENDING') b.cancel++;
        const since = new Date(r.updated_at ?? r.created_at);
        if (since < b.oldest) b.oldest = since;
        b.units.set(r.unit_name, (b.units.get(r.unit_name) ?? 0) + 1);
        buckets.set(id, b);
    }
    return buckets;
};

type DigestBucket = Awaited<ReturnType<typeof digestBuckets>> extends Map<number, infer B> ? B : never;

/** ข้อความสรุปรออนุมัติของผู้อนุมัติหนึ่งคน */
const digestMessage = (b: DigestBucket): Message => {
    const waitDays = Math.max(0, Math.floor((Date.now() - b.oldest.getTime()) / 86_400_000));
    const units = [...b.units.entries()].sort((a, z) => z[1] - a[1]);
    return {
        title: 'สรุปใบลารออนุมัติ',
        heading: `ใบลารอท่านอนุมัติ ${b.count} ใบ`,
        rows: [
            { label: 'ในฐานะ', value: b.level },
            ...(b.cancel ? [{ label: 'ขอยกเลิก', value: `${b.cancel} ใบ` }] : []),
            { label: 'รอนานสุด', value: waitDays ? `${waitDays} วัน` : 'วันนี้' },
            ...units.slice(0, 6).map(([u, n]) => ({ label: u, value: `${n} ใบ` })),
            ...(units.length > 6 ? [{ label: 'หน่วยงานอื่น', value: `${units.slice(6).reduce((s, [, n]) => s + n, 0)} ใบ` }] : []),
        ],
        accent: '#B45309',
        link: { label: 'เปิดหน้าอนุมัติการลา', path: '/hr/leave/approval' },
    };
};

/** ข้อความสรุปตามรอบ — หัวหน้าหน่วยงาน/ตึก, ผอ. (รายใบ) และหัวหน้ากลุ่มภารกิจ (รายกลุ่มงาน × ประเภท) ได้รายละเอียดทุกใบแบบเดียวกับแจ้งทันที แทนยอดรายหน่วยงาน */
const digestMessageFor = async (b: DigestBucket): Promise<Message> => {
    const style = instantStyleOf(b.code);
    if (style === 'normal') return digestMessage(b);
    const reqs = (await Promise.all(b.ids.map(loadRequest))).filter(Boolean)
        .sort((a: any, z: any) => a.start_date.localeCompare(z.start_date) || a.id - z.id);
    const full = instantMessage(reqs, style);
    const waitDays = Math.max(0, Math.floor((Date.now() - b.oldest.getTime()) / 86_400_000));
    return {
        ...full,
        title: 'สรุปใบลารออนุมัติ',
        rows: [{ label: 'รอนานสุด', value: waitDays ? `${waitDays} วัน` : 'วันนี้' }, ...full.rows],
    };
};

const bangkokNow = () => {
    const d = new Date(Date.now() + 7 * 3_600_000);
    return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16), dow: d.getUTCDay() };
};

export const runDigest = async (slotKey: string | null): Promise<{ approvers: number; sent: number }> => {
    const { config } = await loadConfig();
    const buckets = await digestBuckets(config);
    if (buckets.size === 0) return { approvers: 0, sent: 0 };
    const ids = [...buckets.keys()];
    const people = await core_kon`SELECT id, id_card FROM users WHERE id IN ${core_kon(ids)} AND is_active = 'Y'`;
    const cidOf = new Map((people as any[]).map(p => [Number(p.id), p.id_card]));
    let sent = 0;
    for (const [id, b] of buckets) sent += await send('DIGEST', [cidOf.get(id)], await digestMessageFor(b));
    if (slotKey) await writeLog('DIGEST', 'SENT', sent, `${slotKey} — สรุปถึงผู้อนุมัติ ${buckets.size} คน`);
    return { approvers: buckets.size, sent };
};

/** จองรอบสรุป — หลายเครื่อง/รีสตาร์ทกลางรอบส่งได้ครั้งเดียว (unique slot_key) */
const claimSlot = async (slotKey: string) => {
    try {
        const rows = await core_kon`
            INSERT INTO hr_leave_notify_log (kind, recipients, slot_key, status, detail)
            VALUES ('DIGEST_SLOT', 0, ${slotKey}, 'SENT', 'จองรอบสรุป')
            ON CONFLICT (slot_key) WHERE slot_key IS NOT NULL DO NOTHING
            RETURNING id`;
        return rows.length > 0;
    } catch (e: any) {
        if (!missingTable(e)) console.error('[leaveNotify] จองรอบสรุปไม่สำเร็จ:', e?.message);
        return false;
    }
};

let digestTimer: ReturnType<typeof setInterval> | null = null;
export const startLeaveNotifyJob = () => {
    if (digestTimer) return;
    const tick = async () => {
        try {
            const { config, ready } = await loadConfig();
            if (!ready || !config.enabled) return;
            const now = bangkokNow();
            if (!config.digest_times.includes(now.hm)) return;
            if (config.digest_skip_holidays) {
                if (now.dow === 0 || now.dow === 6) return;
                if ((await holidaysBetween(now.date, now.date)).size) return;
            }
            const slot = `digest:${now.date} ${now.hm}`;
            if (!(await claimSlot(slot))) return;
            const r = await runDigest(slot);
            if (r.approvers) console.log(`[leaveNotify] ${slot} สรุปถึงผู้อนุมัติ ${r.approvers} คน ส่งได้ ${r.sent}`);
        } catch (e: any) {
            console.error('[leaveNotify] รอบสรุปไม่สำเร็จ:', e?.message);
        }
    };
    digestTimer = setInterval(tick, 20_000);   // ตรวจทุก 20 วินาที — ไม่พลาดนาทีที่ตั้งไว้
};

const LEVEL_TH: Record<ApproverLevel, string> = {
    SUBMAJOR: 'หัวหน้าหน่วยงาน', MAJOR: 'หัวหน้ากลุ่มงาน', MISSION: 'หัวหน้ากลุ่มภารกิจ', DIRECTOR: 'ผู้อำนวยการ',
};

/** ทดสอบส่งถึงผู้ดูแลระบบเอง — ไม่ระบุ level = ข้อความทดสอบทั่วไป
 *  ระบุ level (และ missionId สำหรับกลุ่มภารกิจ) = ส่ง "ข้อความแบบที่ผู้อนุมัติระดับนั้นจะได้รับ" ตามค่าตั้ง (ที่หน้าเว็บกำลังแก้ ถ้าส่งมา)
 *  ใช้ใบที่รออยู่จริงตอนนี้ ไม่มีใบรอ = ใช้ใบล่าสุดเป็นตัวอย่าง */
export const sendTest = async (userId: number, opt: { level?: ApproverLevel; missionId?: number; colleague?: boolean; config?: LeaveNotifyConfig } = {}) => {
    const [me] = await core_kon`SELECT id_card, CONCAT(pname, fname, ' ', lname) AS name FROM users WHERE id = ${userId}`;
    if (!me?.id_card || !CID_RE.test(String(me.id_card))) return { ok: false, message: 'บัญชีของท่านยังไม่มีเลขบัตรประชาชน 13 หลัก' };
    if (!mophConfigured()) return { ok: false, message: 'เซิร์ฟเวอร์ยังไม่ได้ตั้งค่า MOPH_ALERT_*' };
    if (opt.colleague) return sendColleagueTest(me as any, opt.config ?? (await loadConfig()).config);
    if (opt.level) return sendScenarioTest(me as any, opt.level, opt.missionId ?? null, opt.config ?? (await loadConfig()).config);
    const n = await send('TEST', [me.id_card], {
        title: 'ทดสอบการแจ้งเตือนระบบลา',
        heading: 'ทดสอบการแจ้งเตือนระบบลาออนไลน์',
        rows: [{ label: 'ผู้ทดสอบ', value: me.name }, { label: 'วันที่', value: fmtDay(bangkokDate()) }],
        link: { label: 'เปิดหน้าตั้งค่าการแจ้งเตือน', path: '/hr/leave/notify-settings' },
    });
    return n ? { ok: true, message: 'ส่งแล้ว — ตรวจข้อความในหมอพร้อมของท่าน' } : { ok: false, message: 'ส่งไม่สำเร็จ — ดูรายละเอียดในประวัติการส่ง' };
};

/** ทดสอบข้อความเพื่อนร่วมงาน — ใช้ใบล่าสุด (เน้นใบที่ผู้ลามีหน่วยงาน) บอกด้วยว่าใบนี้จริง ๆ จะส่งถึงกี่คน */
const sendColleagueTest = async (me: { id_card: string; name: string }, config: LeaveNotifyConfig) => {
    if (!config.colleague.enabled) return { ok: false, message: 'ปิดการแจ้งเพื่อนร่วมงานอยู่ — ไม่มีข้อความให้ทดสอบ' };
    const [last] = await core_kon`
        SELECT r.id FROM hr_leave_requests r JOIN users u ON u.id = r.user_id
        ORDER BY (u.submajor_id IS NOT NULL) DESC, r.id DESC LIMIT 1`;
    const r = last ? await loadRequest(Number(last.id)) : null;
    if (!r) return { ok: false, message: 'ยังไม่มีใบลาในระบบให้ใช้เป็นตัวอย่าง' };
    const mates = await colleaguesOf(r, config);
    const m = colleagueMessage(r);
    const n = await send('TEST', [me.id_card], {
        ...m,
        title: `[ทดสอบ] ${m.title}`,
        heading: `[ทดสอบ] ${m.heading}`,
        rows: [...m.rows,
            { label: 'ทดสอบแทน', value: 'เพื่อนร่วมงาน' },
            { label: 'ใบจริงส่งถึง', value: mates.length ? `${mates.length} คน` : 'ไม่มีผู้รับ (ตามขอบเขตที่ตั้ง)' }],
    });
    return n
        ? { ok: true, message: 'ส่งข้อความแบบที่เพื่อนร่วมงานจะได้รับแล้ว — ตรวจในหมอพร้อมของท่าน' }
        : { ok: false, message: 'ส่งไม่สำเร็จ — ดูรายละเอียดในประวัติการส่ง' };
};

const sendScenarioTest = async (me: { id_card: string; name: string }, level: ApproverLevel, missionId: number | null, config: LeaveNotifyConfig) => {
    const [mission] = level === 'MISSION' && missionId ? await core_kon`SELECT name FROM missions WHERE mission_id = ${missionId}` : [];
    const target = `${LEVEL_TH[level]}${mission?.name ? ` ${mission.name}` : ''}`;
    const mode = modeOfStep(config, { level, approver_id: 1, unit_id: missionId } as unknown as ChainStep);
    if (mode === 'off') return { ok: false, message: `${target} ตั้งเป็น "ปิด" — จะไม่ได้รับข้อความ จึงไม่มีอะไรให้ทดสอบ` };
    const match = (st: ChainStep) => st.level === level && (missionId == null || Number(st.unit_id) === missionId);

    let m: Message;
    let sample: string;
    if (mode === 'digest') {
        // รอบสรุปของผู้อนุมัติที่มีใบรอมากสุดในระดับ/ภารกิจนี้
        const best = [...(await digestBuckets(config, match)).values()].sort((a, z) => z.count - a.count)[0];
        // ไม่มีใบรอ = รอบจริงไม่ส่ง — ทดสอบก็ไม่ส่งเช่นกัน
        if (!best) return { ok: false, message: `${target} ตอนนี้ไม่มีใบลารออนุมัติ — รอบสรุปจริงจะไม่ส่งข้อความ จึงไม่ได้ส่งทดสอบ` };
        m = await digestMessageFor(best);
        sample = 'ใบที่รออยู่จริงตอนนี้';
    } else {
        // ทันที — ใบที่รอขั้นนี้อยู่จริง (สูงสุด 8 ใบ) ไม่มี = ใบล่าสุดของบุคลากรในภารกิจ / ใบล่าสุดของทั้งระบบ
        const pending = await core_kon`
            SELECT id, approval_chain, current_step FROM hr_leave_requests
            WHERE status IN ('PENDING', 'CANCEL_PENDING') ORDER BY id DESC`;
        let ids = (pending as any[]).filter(r => {
            const st = stepFor(parseChain(r.approval_chain), Number(r.current_step));
            return !!st && match(st);
        }).slice(0, 8).map(r => Number(r.id));
        sample = ids.length ? 'ใบที่รออยู่จริงตอนนี้' : 'ใบล่าสุดเป็นตัวอย่าง (ตอนนี้ไม่มีใบรอ)';
        if (!ids.length) {
            const [last] = missionId
                ? await core_kon`SELECT r.id FROM hr_leave_requests r JOIN users u ON u.id = r.user_id WHERE u.mission_id = ${missionId} ORDER BY r.id DESC LIMIT 1`
                : await core_kon`SELECT id FROM hr_leave_requests ORDER BY id DESC LIMIT 1`;
            if (!last) return { ok: false, message: 'ยังไม่มีใบลาในระบบให้ใช้เป็นตัวอย่าง' };
            ids = [Number(last.id)];
        }
        m = instantMessage((await Promise.all(ids.map(loadRequest))).filter(Boolean), instantStyleOf(level));
    }
    const n = await send('TEST', [me.id_card], {
        ...m,
        title: `[ทดสอบ] ${m.title}`,
        heading: `[ทดสอบ] ${m.heading}`,
        rows: [...m.rows, { label: 'ทดสอบแทน', value: `${target} (${mode === 'digest' ? 'สรุปตามรอบ' : 'ทันที'})` }, { label: 'ข้อมูล', value: sample }],
    });
    return n
        ? { ok: true, message: `ส่งข้อความแบบที่${target}จะได้รับแล้ว — ตรวจในหมอพร้อมของท่าน` }
        : { ok: false, message: 'ส่งไม่สำเร็จ — ดูรายละเอียดในประวัติการส่ง' };
};
