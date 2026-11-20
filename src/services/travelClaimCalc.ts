// ── คำนวณการเบิกค่าใช้จ่ายเดินทางจริง (เคลียร์ค่าใช้จ่าย) — ฟังก์ชันล้วน ไม่แตะฐานข้อมูล ──
//
// หัวใจคือ "ยอดที่ผู้เดินทางกรอกต้องถูก": ส่วนที่คิดได้จากกติกา ระบบคิดเองทั้งหมด ผู้เดินทางแก้ไม่ได้
//   เบี้ยเลี้ยง   = อัตรารายคน (ณ วันยื่นคำขอ) × วันตามเวลาเดินทางจริง − มื้อที่ผู้จัดเลี้ยง × ⅓ อัตรา
//   ที่พักเหมาจ่าย = อัตราเหมาจ่ายตามระดับสิทธิ์ × คืน
//   ค่าน้ำมันรถส่วนตัว = กม. × อัตราต่อ กม. ของคำขอ
// ส่วนที่ต้องกรอกตามใบเสร็จ มีเพดานกัน: ที่พักจ่ายจริง ≤ อัตราห้องเดี่ยว/คู่ × คืน · ค่าโดยสาร ≤ อัตราสูงสุด × ไป-กลับ × คน
// เกินประมาณการรายหมวด = ต้องให้เหตุผล (HRD พิจารณา) — ตรวจตอนส่ง ไม่บล็อกการบันทึกร่าง
import { allowanceDays, personAllowance, tripNights } from '../controllers/hrdTravelRequestController';

export class ClaimError extends Error { constructor(message: string, public field?: string) { super(message); } }

export const CLAIM_CATEGORIES = ['allowance', 'lodging', 'transport', 'registration', 'other'] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];
export const CATEGORY_LABEL: Record<ClaimCategory, string> = {
    allowance: 'ค่าเบี้ยเลี้ยง', lodging: 'ค่าเช่าที่พัก', transport: 'ค่าพาหนะ', registration: 'ค่าลงทะเบียน', other: 'ค่าใช้จ่ายอื่น',
};
export type ItemCategory = 'allowance' | 'lodging' | 'registration' | 'fuel' | 'toll' | 'fare' | 'taxi' | 'other';
const GROUP_OF: Record<ItemCategory, ClaimCategory> = {
    allowance: 'allowance', lodging: 'lodging', registration: 'registration', fuel: 'transport', toll: 'transport', fare: 'transport', taxi: 'transport', other: 'other',
};
export const groupOf = (c: ItemCategory) => GROUP_OF[c];

export interface ClaimTraveler {
    user_id: number; name: string; rate: number; is_requester: boolean;
    /** อัตราที่พักตามระดับสิทธิ์ (บาท/คืน) */
    lodging: { lump: number; single: number; double: number };
}
/** ข้อมูลจากคำขอที่ ผอ. อนุมัติแล้ว */
export interface ClaimContext {
    vehicle_mode: 'gov_car' | 'private' | 'bus' | 'plane' | 'other';
    rate_per_km: number | null;
    route_max_fare: number | null;
    estimate: Record<ClaimCategory, number>;
    travelers: ClaimTraveler[];
}
export interface ClaimInput {
    actual_start_at: unknown; actual_end_at: unknown; meals_provided?: unknown;
    lodging_mode?: unknown; lodging_nights?: unknown;
    /** absent = ไม่ได้เดินทางจริง (ตัดออก) · actual_start_at/actual_end_at = เวลารายคนที่ต่างจากคณะ (กลับก่อน/ไปไม่ครบวัน) */
    travelers?: { user_id: unknown; room?: unknown; lodging_amount?: unknown; registration_amount?: unknown; absent?: unknown; actual_start_at?: unknown; actual_end_at?: unknown }[];
    distance_km?: unknown; toll_amount?: unknown; fare_amount?: unknown; taxi_amount?: unknown;
    other_amount?: unknown; other_desc?: unknown;
    over_reasons?: unknown;
}
export interface ClaimItem {
    category: ItemCategory; user_id: number | null; label: string; detail: string | null; room: 'single' | 'double' | null;
    claimed_amount: number; cap_amount: number | null; computed: boolean; sort_order: number;
}
export interface ClaimResult {
    actual_start_at: Date; actual_end_at: Date; meals_provided: number; allowance_days: number;
    lodging_mode: 'none' | 'lump' | 'actual'; lodging_nights: number; distance_km: number | null; other_desc: string | null;
    /** ผู้ที่ไม่ได้เดินทาง */
    absent_user_ids: number[];
    /** เวลารายคนที่ต่างจากคณะ (ISO) */
    person_times: Record<string, { start: string; end: string }>;
    items: ClaimItem[];
    claimed: Record<ClaimCategory, number>; claimed_total: number;
    /** หมวดที่เกินประมาณการ */
    over: ClaimCategory[];
    over_reasons: Partial<Record<ClaimCategory, string>>;
    /** หมวดที่เกินแต่ยังไม่ให้เหตุผล (ส่งไม่ได้) */
    missing_reasons: ClaimCategory[];
}

const MAX_MONEY = 1_000_000, MAX_TRIP_DAYS = 60, MAX_KM = 5000;
export const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v: unknown, field: string, label: string) => {
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY || Math.abs(Math.round(n * 100) - n * 100) > 1e-6)
        throw new ClaimError(`${label}ต้องเป็นจำนวนเงิน 0–${MAX_MONEY.toLocaleString('en-US')} บาท ทศนิยมไม่เกิน 2 ตำแหน่ง`, field);
    return n;
};
const oneLine = (v: unknown, max: number) => { const t = v == null ? '' : String(v).trim().replace(/\s+/g, ' '); return t ? t.slice(0, max) : null; };

/** ตรวจ + คำนวณการเบิกทั้งใบ (ใช้ทั้งบันทึกร่างและส่ง) */
export const computeClaim = (input: ClaimInput, ctx: ClaimContext): ClaimResult => {
    const startMs = Date.parse(String(input.actual_start_at ?? '')), endMs = Date.parse(String(input.actual_end_at ?? ''));
    if (!Number.isFinite(startMs)) throw new ClaimError('กรุณาระบุวันเวลาออกเดินทางจริง', 'actual_start_at');
    if (!Number.isFinite(endMs)) throw new ClaimError('กรุณาระบุวันเวลากลับถึงจริง', 'actual_end_at');
    if (endMs <= startMs) throw new ClaimError('วันเวลากลับต้องหลังวันเวลาออกเดินทาง', 'actual_end_at');
    if (endMs - startMs > MAX_TRIP_DAYS * 86_400_000) throw new ClaimError(`เดินทางได้ไม่เกิน ${MAX_TRIP_DAYS} วัน`, 'actual_end_at');
    const days = allowanceDays(startMs, endMs).days;
    const meals = input.meals_provided === undefined || input.meals_provided === null || input.meals_provided === '' ? 0 : Number(input.meals_provided);
    if (!Number.isInteger(meals) || meals < 0) throw new ClaimError('จำนวนมื้อที่ผู้จัดเลี้ยงต้องเป็นจำนวนเต็มตั้งแต่ 0', 'meals_provided');
    if (meals > Math.floor(days * 3)) throw new ClaimError(`มื้อที่ผู้จัดเลี้ยงต้องไม่เกิน ${Math.floor(days * 3)} มื้อ (${days} วัน × 3 มื้อ)`, 'meals_provided');

    if (!ctx.travelers.length) throw new ClaimError('คำขอนี้ไม่มีผู้เดินทาง');
    const byUser = new Map<number, any>();
    for (const t of Array.isArray(input.travelers) ? input.travelers : []) {
        const uid = Number(t?.user_id);
        if (!ctx.travelers.some(x => x.user_id === uid)) throw new ClaimError('มีผู้เดินทางที่ไม่อยู่ในคำขอที่อนุมัติ — เพิ่มคนไม่ได้ตอนเบิก', 'travelers');
        byUser.set(uid, t);
    }
    // ไม่ได้เดินทาง / เวลารายคน (ต้องอยู่ในช่วงเวลาของคณะ)
    const absent = ctx.travelers.filter(t => byUser.get(t.user_id)?.absent === true).map(t => t.user_id);
    const present = ctx.travelers.filter(t => !absent.includes(t.user_id));
    if (!present.length) throw new ClaimError('ต้องมีผู้เดินทางจริงอย่างน้อย 1 คน — ถ้าไม่ได้เดินทางทั้งคณะ ให้ยกเลิกคำขอ', 'travelers');
    const personTimes: Record<string, { start: string; end: string }> = {};
    const span = new Map<number, { days: number; nights: number }>();
    for (const t of present) {
        const x = byUser.get(t.user_id);
        const ps = x?.actual_start_at ? Date.parse(String(x.actual_start_at)) : startMs, pe = x?.actual_end_at ? Date.parse(String(x.actual_end_at)) : endMs;
        const f = `travelers.${t.user_id}.actual_end_at`;
        if (!Number.isFinite(ps) || !Number.isFinite(pe)) throw new ClaimError(`วันเวลาเดินทางของ ${t.name} ไม่ถูกต้อง`, f);
        if (pe <= ps) throw new ClaimError(`วันเวลากลับของ ${t.name} ต้องหลังวันเวลาออกเดินทาง`, f);
        if (ps < startMs || pe > endMs) throw new ClaimError(`วันเวลาเดินทางของ ${t.name} ต้องอยู่ในช่วงเดินทางของคณะ`, f);
        if (ps !== startMs || pe !== endMs) personTimes[String(t.user_id)] = { start: new Date(ps).toISOString(), end: new Date(pe).toISOString() };
        span.set(t.user_id, { days: allowanceDays(ps, pe).days, nights: tripNights(ps, pe) });
    }
    const items: ClaimItem[] = [];
    let sort = 0;
    const push = (i: Omit<ClaimItem, 'sort_order'>) => items.push({ ...i, sort_order: sort++ });

    // เบี้ยเลี้ยง — ระบบคิด
    for (const t of present) {
        const sp = span.get(t.user_id)!;
        // กลับก่อน/ไปไม่ครบวัน: มื้อที่ผู้จัดเลี้ยงหักไม่เกินวันของคนนั้น
        const pm = Math.min(meals, Math.floor(sp.days * 3));
        push({ category: 'allowance', user_id: t.user_id, label: t.name, room: null, computed: true, cap_amount: null,
            detail: `${fmt(t.rate)} × ${sp.days} วัน${pm ? ` − อาหาร ${pm} มื้อ` : ''}${personTimes[String(t.user_id)] ? ' (เวลาต่างจากคณะ)' : ''}`, claimed_amount: personAllowance(t.rate, sp.days, pm) });
    }

    // ที่พัก
    const lodgingMode = (input.lodging_mode ?? 'none') as ClaimResult['lodging_mode'];
    if (!['none', 'lump', 'actual'].includes(lodgingMode)) throw new ClaimError('รูปแบบการเบิกค่าที่พักไม่ถูกต้อง', 'lodging_mode');
    let nights = 0;
    if (lodgingMode !== 'none') {
        const maxNights = tripNights(startMs, endMs);
        if (maxNights === 0) throw new ClaimError('เดินทางไป-กลับในวันเดียว เบิกค่าเช่าที่พักไม่ได้', 'lodging_mode');
        nights = Number(input.lodging_nights);
        if (!Number.isInteger(nights) || nights < 1) throw new ClaimError('ระบุจำนวนคืนที่พัก', 'lodging_nights');
        if (nights > maxNights) throw new ClaimError(`พักได้ไม่เกิน ${maxNights} คืนตามวันเดินทางจริง`, 'lodging_nights');
        for (const t of present) {
            const pn = Math.min(nights, span.get(t.user_id)!.nights);
            if (pn === 0) continue;   // ไป-กลับวันเดียว (ของคนนั้น) ไม่มีค่าที่พัก
            if (lodgingMode === 'lump') {
                const amt = round2(t.lodging.lump * pn);
                push({ category: 'lodging', user_id: t.user_id, label: t.name, room: null, computed: true, cap_amount: amt,
                    detail: `เหมาจ่าย ${fmt(t.lodging.lump)} × ${pn} คืน`, claimed_amount: amt });
            } else {
                const x = byUser.get(t.user_id);
                const room = (x?.room ?? (present.length > 1 ? 'double' : 'single')) as 'single' | 'double';
                if (room !== 'single' && room !== 'double') throw new ClaimError(`ประเภทห้องพักของ ${t.name} ไม่ถูกต้อง`, `travelers.${t.user_id}.room`);
                const rate = room === 'single' ? t.lodging.single : t.lodging.double;
                const cap = round2(rate * pn);
                const amt = money(x?.lodging_amount, `travelers.${t.user_id}.lodging_amount`, `ค่าที่พักของ ${t.name} `);
                if (amt > cap + 1e-9) throw new ClaimError(`ค่าที่พักของ ${t.name} เกินเพดาน ${fmt(cap)} บาท (${room === 'single' ? 'ห้องเดี่ยว' : 'ห้องคู่'} ${fmt(rate)} × ${pn} คืน)`, `travelers.${t.user_id}.lodging_amount`);
                push({ category: 'lodging', user_id: t.user_id, label: t.name, room, computed: false, cap_amount: cap,
                    detail: `จ่ายจริง ${room === 'single' ? 'ห้องเดี่ยว' : 'ห้องคู่'} ${pn} คืน`, claimed_amount: amt });
            }
        }
    }

    // ค่าลงทะเบียน — ตามใบเสร็จรายคน (ไม่มีก็ไม่สร้างรายการ)
    for (const t of present) {
        const amt = money(byUser.get(t.user_id)?.registration_amount, `travelers.${t.user_id}.registration_amount`, `ค่าลงทะเบียนของ ${t.name} `);
        if (amt > 0) push({ category: 'registration', user_id: t.user_id, label: t.name, room: null, computed: false, cap_amount: null, detail: null, claimed_amount: amt });
    }

    // พาหนะ (รวมคณะ)
    const mode = ctx.vehicle_mode;
    const car = mode === 'gov_car' || mode === 'private', publicMode = mode === 'bus' || mode === 'plane' || mode === 'other';
    let km: number | null = null;
    if (mode === 'private') {
        km = Number(input.distance_km);
        if (!Number.isFinite(km) || km <= 0 || km > MAX_KM || Math.abs(km * 10 - Math.round(km * 10)) > 1e-9) throw new ClaimError(`ระยะทางจริงต้องมากกว่า 0 ไม่เกิน ${MAX_KM.toLocaleString('en-US')} กม. ทศนิยม 1 ตำแหน่ง`, 'distance_km');
        const rate = Number(ctx.rate_per_km ?? 0);
        push({ category: 'fuel', user_id: null, label: 'ค่าน้ำมันเชื้อเพลิง (รถยนต์ส่วนตัว)', room: null, computed: true, cap_amount: null,
            detail: `${km.toLocaleString('en-US')} กม. × ${fmt(rate)} บาท`, claimed_amount: round2(km * rate) });
    }
    const toll = money(input.toll_amount, 'toll_amount', 'ค่าทางด่วน');
    if (toll > 0 && !car) throw new ClaimError('ค่าทางด่วนเบิกได้เมื่อเดินทางด้วยรถยนต์', 'toll_amount');
    if (toll > 0) push({ category: 'toll', user_id: null, label: 'ค่าทางด่วน', room: null, computed: false, cap_amount: null, detail: null, claimed_amount: toll });
    const fare = money(input.fare_amount, 'fare_amount', 'ค่าโดยสาร');
    const taxi = money(input.taxi_amount, 'taxi_amount', 'ค่าแท็กซี่/รถรับจ้าง');
    if ((fare > 0 || taxi > 0) && !publicMode) throw new ClaimError('ค่าโดยสารและค่าแท็กซี่เบิกได้เมื่อเดินทางด้วยรถโดยสาร เครื่องบิน หรืออื่น ๆ', fare > 0 ? 'fare_amount' : 'taxi_amount');
    if (fare > 0) {
        const n = present.length;
        const cap = (mode === 'bus' || mode === 'plane') && ctx.route_max_fare != null ? round2(ctx.route_max_fare * 2 * n) : null;
        if (cap != null && fare > cap + 1e-9) throw new ClaimError(`ค่าโดยสารเบิกได้ไม่เกิน ${fmt(cap)} บาท (${fmt(ctx.route_max_fare!)} × ไป-กลับ × ${n} คน)`, 'fare_amount');
        push({ category: 'fare', user_id: null, label: mode === 'plane' ? 'ค่าโดยสารเครื่องบิน' : mode === 'bus' ? 'ค่าโดยสารรถประจำทาง' : 'ค่าพาหนะ', room: null, computed: false, cap_amount: cap, detail: null, claimed_amount: fare });
    }
    if (taxi > 0) push({ category: 'taxi', user_id: null, label: 'ค่าแท็กซี่/รถรับจ้าง', room: null, computed: false, cap_amount: null, detail: null, claimed_amount: taxi });
    const other = money(input.other_amount, 'other_amount', 'ค่าใช้จ่ายอื่น');
    const otherDesc = oneLine(input.other_desc, 200);
    if (other > 0 && !otherDesc) throw new ClaimError('ระบุรายการค่าใช้จ่ายอื่น', 'other_desc');
    if (other > 0) push({ category: 'other', user_id: null, label: otherDesc!, room: null, computed: false, cap_amount: null, detail: null, claimed_amount: other });

    const claimed = Object.fromEntries(CLAIM_CATEGORIES.map(c => [c, 0])) as Record<ClaimCategory, number>;
    for (const i of items) claimed[GROUP_OF[i.category]] = round2(claimed[GROUP_OF[i.category]] + i.claimed_amount);
    const claimedTotal = round2(CLAIM_CATEGORIES.reduce((s, c) => s + claimed[c], 0));

    const rawReasons = input.over_reasons && typeof input.over_reasons === 'object' ? input.over_reasons as Record<string, unknown> : {};
    const over = CLAIM_CATEGORIES.filter(c => claimed[c] > round2(Number(ctx.estimate[c] ?? 0)) + 0.004);
    const overReasons: Partial<Record<ClaimCategory, string>> = {};
    for (const c of over) { const r = oneLine(rawReasons[c], 300); if (r) overReasons[c] = r; }

    return {
        actual_start_at: new Date(startMs), actual_end_at: new Date(endMs), meals_provided: meals, allowance_days: days,
        lodging_mode: lodgingMode, lodging_nights: nights, distance_km: km, other_desc: other > 0 ? otherDesc : null,
        absent_user_ids: absent, person_times: personTimes,
        items, claimed, claimed_total: claimedTotal, over, over_reasons: overReasons, missing_reasons: over.filter(c => !overReasons[c]),
    };
};

/** ยอดรายหมวดจากยอดรายการที่ HRD อนุมัติ */
export const approvedTotals = (items: { category: ItemCategory; approved_amount: number }[]) => {
    const approved = Object.fromEntries(CLAIM_CATEGORIES.map(c => [c, 0])) as Record<ClaimCategory, number>;
    for (const i of items) approved[GROUP_OF[i.category]] = round2(approved[GROUP_OF[i.category]] + Number(i.approved_amount));
    return { approved, total: round2(CLAIM_CATEGORIES.reduce((s, c) => s + approved[c], 0)) };
};

/** ผลการล้างเงินยืม: refund > 0 = ผู้ยืมคืนเงิน · pay > 0 = การเงินจ่ายเพิ่ม/จ่ายคืน */
export const settlementOf = (mode: 'advance' | 'reimburse', advance: number | null, total: number) => {
    if (mode === 'reimburse') return { refund: 0, pay: round2(total) };
    const d = round2(Number(advance ?? 0) - total);
    return d >= 0 ? { refund: d, pay: 0 } : { refund: 0, pay: round2(-d) };
};
