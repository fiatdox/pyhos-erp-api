// เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — คำขออนุมัติเดินทางไปราชการและเบิกค่าใช้จ่าย
// ตาราง src/db/hrd_travel_requests.sql · ราคาจากหน้าตั้งค่า (เบี้ยเลี้ยง / ค่าพาหนะ) เก็บ ณ วันยื่นไว้ในคำขอ
//
// ยอดเงินทุกช่องคำนวณ/ตรวจที่นี่ (computeRequest) ไม่เชื่อตัวเลขจากหน้าเว็บ:
//   ๖.๑ เบี้ยเลี้ยง  = Σ อัตราของผู้เดินทางแต่ละคน × จำนวนวัน (≤ วันที่นับได้ตามระเบียบ)
//   ๖.๒ ค่าที่พัก   = ทั้งคณะเลือกรูปแบบเดียว: เหมาจ่าย = Σ อัตราเหมาจ่ายของแต่ละคน × คืน
//                    จ่ายจริง ≤ Σ อัตราห้องเดี่ยว/ห้องคู่ของแต่ละคน × คืน (ระดับสิทธิ์จากหน้าตั้งค่าค่าที่พัก)
//   ๖.๓ ค่าพาหนะ   = รถโดยสาร/เครื่องบิน ≤ เพดานต่อเที่ยว × ๒ (ไป-กลับ) × จำนวนผู้เดินทาง
//   ๖.๕ ค่าน้ำมัน   = ระยะทาง × บาท/กม. ของประเภทรถส่วนตัว (+ ค่าทางด่วนที่กรอก)
// การนับวันเบี้ยเลี้ยง (ระเบียบกระทรวงการคลังว่าด้วยค่าใช้จ่ายในการเดินทางไปราชการ):
//   ๒๔ ชม. = ๑ วัน · เศษเกิน ๑๒ ชม. = ๑ วัน · ไม่พักแรม เศษเกิน ๖ ชม. = ครึ่งวัน
//
// สิทธิ์: ผู้ใช้ทุกคนยื่นได้ · ดูได้ = ผู้ขอ ผู้ร่วมเดินทาง ผู้อนุมัติในสาย ADMIN/HRD
//         แก้ไข = ผู้ขอ ก่อนมีผู้อนุมัติกด · ยกเลิก = ผู้ขอ หรือ ADMIN/HRD
// อนุมัติผ่านระบบพร้อมลายเซ็น (src/db/hrd_travel_approval.sql): หัวหน้ากลุ่มงาน → หัวหน้ากลุ่มภารกิจ ในระบบ
//   → ผอ. ลงนามจริงบนกระดาษ → ADMIN/HRD บันทึกผลคำสั่ง ผอ. · ผู้ขอ/ผู้อนุมัติต้องตั้งลายเซ็นที่ตั้งค่าบัญชีก่อน
// โหมดเดินเอกสาร (ตั้งตามกลุ่ม src/db/hrd_travel_sign_mode.sql): ไม่ลงนามในระบบ พิมพ์ไปเสนอเซ็นจริงทุกช่อง
//   → ADMIN/HRD บันทึกผลตามเอกสาร (ขั้น director ทันทีที่ยื่น)
import { core_kon } from '../db/db';
import { canManage } from './hrdTravelController';
import { lodgingCols, lodgingJoin } from './hrdTravelLodgingController';
import { signModeOf } from './hrdTravelSignModeController';
import { signatureOf } from './userSignatureController';
import { parseChain, resolveApprovalChain, resolveDirectorStep, type ChainStep } from '../services/leaveChain';

const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, ...(field ? { field } : {}) }; };
class Bad extends Error { constructor(public status: number, message: string, public field?: string) { super(message); } }

const MODES = ['gov_car', 'private', 'bus', 'plane', 'other'] as const;
type Mode = typeof MODES[number];
const MAX_TRAVELERS = 50, MAX_MONEY = 1_000_000, MAX_TRIP_DAYS = 60, MAX_KM = 5000;
const TZ_OFFSET_MS = 7 * 3600 * 1000; // วันที่ตามเวลาไทย

const working = (s: any = core_kon) => s`u.is_active = 'Y' AND COALESCE(u.user_status_id, 1) = 1
    AND (u.work_end_date IS NULL OR u.work_end_date >= CURRENT_DATE)`;
const nameOf = (s: any = core_kon) => s`TRIM(CONCAT(u.pname, u.fname, ' ', u.lname))`;
const round2 = (n: number) => Math.round(n * 100) / 100;
/** หักเบี้ยเลี้ยงต่อมื้อที่ผู้จัดเลี้ยง = ๑/๓ ของอัตราต่อวัน (๒๔๐ → ๘๐ · ๒๗๐ → ๙๐) */
export const mealCut = (rate: number) => round2(rate / 3);
/** เบี้ยเลี้ยงรายคน = อัตรา × วัน − มื้อที่ผู้จัดเลี้ยง × (อัตรา ÷ ๓) — ไม่ติดลบ */
export const personAllowance = (rate: number, days: number, meals: number) => Math.max(0, round2(rate * days - meals * mealCut(rate)));
/** สูตรเดียวกันในฝั่ง SQL (t = hrd_travel_request_travelers, r = hrd_travel_requests) */
export const ALLOWANCE_SQL = (s: any) => s`GREATEST(0, ROUND(t.rate * r.allowance_days - r.meals_provided * ROUND(t.rate / 3.0, 2), 2))`;

/** จำนวนวันเบี้ยเลี้ยงตามระเบียบ — ใช้สูตรเดียวกับหน้าเว็บ (travelCalc.ts) */
export const allowanceDays = (startMs: number, endMs: number) => {
    const hours = (endMs - startMs) / 3_600_000;
    const dayKey = (ms: number) => new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10);
    const overnight = dayKey(startMs) !== dayKey(endMs);
    const full = Math.floor(hours / 24);
    const rem = hours - full * 24;
    const extra = rem > 12 ? 1 : !overnight && rem > 6 ? 0.5 : 0;
    return { hours, overnight, days: full + extra };
};
/** จำนวนคืนสูงสุดที่เบิกค่าที่พักได้ = จำนวนวันตามปฏิทิน (เวลาไทย) ที่ข้ามไป — ใช้สูตรเดียวกับหน้าเว็บ (travelCalc.ts) */
export const tripNights = (startMs: number, endMs: number) => {
    const day = (ms: number) => Date.parse(new Date(ms + TZ_OFFSET_MS).toISOString().slice(0, 10));
    return Math.max(0, Math.round((day(endMs) - day(startMs)) / 86_400_000));
};
const LODGING_MODES = ['none', 'lump', 'actual'] as const;
type LodgingMode = typeof LODGING_MODES[number];

const money = (v: unknown, field: string, label: string) => {
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > MAX_MONEY || Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw new Bad(400, `${label}ต้องเป็นจำนวนเงิน 0–${MAX_MONEY.toLocaleString('en-US')} บาท ทศนิยมไม่เกิน 2 ตำแหน่ง`, field);
    return n;
};
const intIn = (v: unknown, field: string, label: string, max: number) => {
    if (v === undefined || v === null || v === '') return 0;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new Bad(400, `${label}ต้องเป็นจำนวนเต็ม 0–${max}`, field);
    return n;
};
const text = (v: unknown, field: string, label: string, max: number, required: boolean) => {
    const t = v == null ? '' : String(v).trim().replace(/\s+/g, ' ');
    if (required && !t) throw new Bad(400, `กรุณาระบุ${label}`, field);
    if (t.length > max) throw new Bad(400, `${label}ไม่เกิน ${max} ตัวอักษร`, field);
    return t || null;
};

// ── ประวัติการไปราชการ (งาน HRD ใช้ประกอบการพิจารณาอนุญาต) ──
/** ปีงบประมาณ พ.ศ. ของเวลาหนึ่ง (ต.ค. ขึ้นปีงบใหม่ · เวลาไทย) */
export const fiscalYearOf = (ms: number) => {
    const d = new Date(ms + TZ_OFFSET_MS);
    return d.getUTCFullYear() + 543 + (d.getUTCMonth() >= 9 ? 1 : 0);
};
/** ช่วงเวลาของปีงบ พ.ศ. — [1 ต.ค. ปีก่อน, 1 ต.ค.) เวลาไทย */
const fyRange = (fy: number) => ({ from: new Date(`${fy - 544}-10-01T00:00:00+07:00`), to: new Date(`${fy - 543}-10-01T00:00:00+07:00`) });
/** จำนวนครั้งที่ไปราชการในปีงบ (คำขอที่ไม่ยกเลิก ทั้งผู้ขอและผู้ร่วมเดินทาง) ของหลายคน — exceptId = ไม่นับคำขอนี้ */
const tripCounts = async (ids: number[], fy: number, exceptId: number | null = null) => {
    if (!ids.length) return new Map<number, number>();
    const { from, to } = fyRange(fy);
    const rows = await core_kon`
        SELECT t.user_id, count(*)::int AS n FROM hrd_travel_request_travelers t JOIN hrd_travel_requests r ON r.id = t.request_id
        WHERE t.user_id IN ${core_kon(ids)} AND r.status = 'submitted' AND r.start_at >= ${from} AND r.start_at < ${to} AND r.id <> ${exceptId ?? 0}
        GROUP BY t.user_id`;
    return new Map(rows.map((r: any) => [Number(r.user_id), r.n]));
};

/** ข้อมูลบุคลากร + อัตราเบี้ยเลี้ยง + ระดับสิทธิ์ที่พักปัจจุบัน */
const peopleWithRate = (s: any, ids: number[]) => s`
    SELECT u.id, ${nameOf(s)} AS name, up.position_name AS position, mj.name AS unit,
           t.id AS tier_id, t.name AS tier_name, t.amount AS rate, ${working(s)} AS working, ${lodgingCols(s)}
    FROM users u
    LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
    LEFT JOIN majors mj ON mj.major_id = u.major_id
    LEFT JOIN hrd_travel_allowance a ON a.user_id = u.id
    JOIN hrd_travel_allowance_tiers t ON t.id = COALESCE(a.tier_id, (SELECT id FROM hrd_travel_allowance_tiers WHERE is_default))
    ${lodgingJoin(s)}
    WHERE u.id IN ${s(ids)}`;
/** ข้อมูลรายคนที่ส่งให้หน้าเว็บ (อัตราเบี้ยเลี้ยง + เพดานที่พัก) */
const personOut = (r: any) => ({
    id: r.id, name: r.name, position: r.position, unit: r.unit, tier_name: r.tier_name, rate: Number(r.rate), working: r.working,
    lodging_class_id: r.lodging_class_id, lodging_class_name: r.lodging_class_name, lump_sum: r.lump_sum, single_room: r.single_room, double_room: r.double_room,
    flight_class: r.flight_class,
});

/** ตรวจ + คำนวณคำขอทั้งใบ — คืนแถวที่พร้อมบันทึก (ใช้ทั้งยื่นใหม่และแก้ไข) */
// keepBudgetId = งบเดิมของคำขอที่กำลังแก้ (ปิดใช้งานแล้วก็ยังแก้คำขอเดิมได้)
const computeRequest = async (s: any, body: any, requesterId: number, keepBudgetId: number | null = null) => {
    const purpose = text(body?.purpose, 'purpose', 'ความประสงค์ (เพื่อ...)', 300, true)!;
    const subject = text(body?.subject, 'subject', 'เรื่อง/วัตถุประสงค์', 1000, true)!;
    const location = text(body?.location, 'location', 'สถานที่ไปราชการ', 300, true)!;

    const startMs = Date.parse(String(body?.start_at ?? '')), endMs = Date.parse(String(body?.end_at ?? ''));
    if (!Number.isFinite(startMs)) throw new Bad(400, 'กรุณาระบุวันเวลาออกเดินทาง', 'start_at');
    if (!Number.isFinite(endMs)) throw new Bad(400, 'กรุณาระบุวันเวลากลับถึง', 'end_at');
    if (endMs <= startMs) throw new Bad(400, 'วันเวลากลับต้องหลังวันเวลาออกเดินทาง', 'end_at');
    if (endMs - startMs > MAX_TRIP_DAYS * 86_400_000) throw new Bad(400, `เดินทางได้ไม่เกิน ${MAX_TRIP_DAYS} วันต่อคำขอ`, 'end_at');
    const calc = allowanceDays(startMs, endMs);

    // ผู้เดินทาง = ผู้ขอ + ผู้ร่วมเดินทาง (ไม่ซ้ำ)
    const companions = [...new Set<number>((Array.isArray(body?.companion_ids) ? body.companion_ids : []).map(Number))]
        .filter(n => Number.isInteger(n) && n > 0 && n !== requesterId);
    if (companions.length + 1 > MAX_TRAVELERS) throw new Bad(400, `ผู้เดินทางได้ไม่เกิน ${MAX_TRAVELERS} คนต่อคำขอ`, 'companion_ids');
    const rows = await peopleWithRate(s, [requesterId, ...companions]);
    const byId = new Map<number, any>(rows.map((r: any) => [Number(r.id), r]));
    const me = byId.get(requesterId);
    if (!me) throw new Bad(400, 'ไม่พบข้อมูลผู้ขอ');
    const notWorking = companions.filter(id => !byId.get(id)?.working);
    if (notWorking.length) throw new Bad(400, 'มีผู้ร่วมเดินทางที่ไม่ได้อยู่ในสถานะปฏิบัติงาน', 'companion_ids');
    const travelers = [requesterId, ...companions].map((id, i) => {
        const p = byId.get(id);
        return {
            user_id: id, name: p.name, position: p.position ?? null, tier_id: p.tier_id, tier_name: p.tier_name, rate: Number(p.rate), is_requester: id === requesterId, sort_order: i,
            lodging_class_id: p.lodging_class_id, lodging_class_name: p.lodging_class_name, lodging_room: null as 'single' | 'double' | null,
            lodging_rate: null as number | null, lodging_cap: 0, flight_class: p.flight_class,
            _lodging: { lump: Number(p.lump_sum), single: Number(p.single_room), double: Number(p.double_room) },
        };
    });

    // ๖.๑ เบี้ยเลี้ยง
    const days = body?.allowance_days === undefined || body?.allowance_days === null || body?.allowance_days === '' ? calc.days : Number(body.allowance_days);
    if (!Number.isFinite(days) || days < 0 || days * 2 !== Math.round(days * 2)) throw new Bad(400, 'จำนวนวันเบี้ยเลี้ยงต้องเป็นทีละครึ่งวัน', 'allowance_days');
    if (days > calc.days) throw new Bad(400, `เบิกเบี้ยเลี้ยงได้ไม่เกิน ${calc.days} วันตามระยะเวลาเดินทาง`, 'allowance_days');
    // มื้อที่ผู้จัดเลี้ยง (ประชุม/อบรม) — หักมื้อละ ๑/๓ ของอัตราต่อวัน ใช้กับผู้เดินทางทุกคน
    const meals = body?.meals_provided === undefined || body?.meals_provided === null || body?.meals_provided === '' ? 0 : Number(body.meals_provided);
    if (!Number.isInteger(meals) || meals < 0) throw new Bad(400, 'จำนวนมื้ออาหารที่ผู้จัดเลี้ยงต้องเป็นจำนวนเต็มตั้งแต่ ๐', 'meals_provided');
    if (meals > Math.floor(days * 3)) throw new Bad(400, `มื้ออาหารที่ผู้จัดเลี้ยงต้องไม่เกิน ${Math.floor(days * 3)} มื้อ (${days} วัน × ๓ มื้อ)`, 'meals_provided');
    const allowance = round2(travelers.reduce((n, t) => n + personAllowance(t.rate, days, meals), 0));

    // ๕. ยานพาหนะ + ๖.๓ / ๖.๕
    const mode = String(body?.vehicle_mode ?? '') as Mode;
    if (!MODES.includes(mode)) throw new Bad(400, 'กรุณาเลือกยานพาหนะที่ใช้เดินทาง', 'vehicle_mode');
    const v: any = { vehicle_mode: mode, vehicle_id: null, vehicle_name: null, vehicle_plate: null, distance_km: null, rate_per_km: null, route_id: null, route_text: null, route_max_fare: null, vehicle_other: null };
    let transport = 0, fuel = 0;
    const toll = money(body?.toll_amount, 'toll_amount', 'ค่าทางด่วน');
    if (toll > 0 && mode !== 'gov_car' && mode !== 'private') throw new Bad(400, 'ค่าทางด่วนเบิกได้เมื่อเดินทางด้วยรถยนต์', 'toll_amount');
    if (mode === 'private') {
        const [veh] = Number(body?.vehicle_id) > 0 ? await s`SELECT id, name, rate_per_km::float8 AS rate FROM hrd_travel_vehicle_rates WHERE id = ${Number(body.vehicle_id)}` : [];
        if (!veh) throw new Bad(400, 'กรุณาเลือกประเภทรถส่วนตัว', 'vehicle_id');
        const km = Number(body?.distance_km);
        if (!Number.isFinite(km) || km <= 0 || km > MAX_KM || km * 10 !== Math.round(km * 10)) throw new Bad(400, `ระยะทางต้องมากกว่า 0 ไม่เกิน ${MAX_KM.toLocaleString('en-US')} กม. ทศนิยม 1 ตำแหน่ง`, 'distance_km');
        Object.assign(v, { vehicle_id: veh.id, vehicle_name: veh.name, distance_km: km, rate_per_km: veh.rate,
            vehicle_plate: text(body?.vehicle_plate, 'vehicle_plate', 'ทะเบียนรถ', 50, true) });
        fuel = round2(km * veh.rate);
    } else if (mode === 'gov_car') {
        v.vehicle_plate = text(body?.vehicle_plate, 'vehicle_plate', 'ทะเบียนรถ', 50, false);
    } else if (mode === 'bus' || mode === 'plane') {
        const [route] = Number(body?.route_id) > 0 ? await s`SELECT id, origin, destination, max_fare FROM hrd_travel_routes WHERE id = ${Number(body.route_id)} AND mode = ${mode} AND is_active` : [];
        if (!route) throw new Bad(400, 'กรุณาเลือกเส้นทางจากที่งานพัฒนาทรัพยากรบุคคลตั้งไว้', 'route_id');
        Object.assign(v, { route_id: route.id, route_text: `${route.origin} ⇄ ${route.destination}`, route_max_fare: route.max_fare });
        transport = money(body?.transport_amount, 'transport_amount', 'ค่าพาหนะ');
        const cap = route.max_fare * 2 * travelers.length;
        if (transport > cap) throw new Bad(400, `ค่าพาหนะเบิกได้ไม่เกิน ${cap.toLocaleString('en-US')} บาท (${route.max_fare.toLocaleString('en-US')} บาท/เที่ยว × ไป-กลับ × ${travelers.length} คน)`, 'transport_amount');
    } else {
        v.vehicle_other = text(body?.vehicle_other, 'vehicle_other', 'ยานพาหนะอื่น', 200, true);
        transport = money(body?.transport_amount, 'transport_amount', 'ค่าพาหนะ');
    }

    // ๖.๒ ค่าเช่าที่พัก — ทั้งคณะเลือกรูปแบบเดียวกัน · อัตราต่อคนต่อคืนตามระดับสิทธิ์ของแต่ละคน
    const lodgingMode = (body?.lodging_mode ?? 'none') as LodgingMode;
    if (!LODGING_MODES.includes(lodgingMode)) throw new Bad(400, 'รูปแบบการเบิกค่าที่พักไม่ถูกต้อง', 'lodging_mode');
    let lodgingNights = 0, lodgingRooms = 0, lodging = 0, lodgingCap = 0, lodgingNote: string | null = null;
    if (lodgingMode === 'none') {
        if (money(body?.lodging_amount, 'lodging_amount', 'ค่าเช่าที่พัก') > 0) throw new Bad(400, 'เลือกรูปแบบการเบิกค่าที่พัก (เหมาจ่าย หรือ จ่ายจริง)', 'lodging_mode');
    } else {
        const maxNights = tripNights(startMs, endMs);
        if (maxNights === 0) throw new Bad(400, 'เดินทางไป-กลับในวันเดียว เบิกค่าเช่าที่พักไม่ได้', 'lodging_mode');
        lodgingNights = intIn(body?.lodging_nights, 'lodging_nights', 'จำนวนคืน', MAX_TRIP_DAYS);
        if (lodgingNights === 0) throw new Bad(400, 'ระบุจำนวนคืนที่พัก', 'lodging_nights');
        if (lodgingNights > maxNights) throw new Bad(400, `พักได้ไม่เกิน ${maxNights} คืนตามวันเดินทาง`, 'lodging_nights');
        const rooms = body?.lodging_rooms_by && typeof body.lodging_rooms_by === 'object' ? body.lodging_rooms_by : {};
        // จ่ายจริง: ไม่ระบุห้อง → ไปคนเดียวพักเดี่ยว ไปเป็นคณะพักคู่
        const defRoom = travelers.length > 1 ? 'double' : 'single';
        for (const t of travelers) {
            if (lodgingMode === 'lump') { t.lodging_rate = t._lodging.lump; }
            else {
                const room = rooms[String(t.user_id)] ?? defRoom;
                if (room !== 'single' && room !== 'double') throw new Bad(400, `ประเภทห้องพักของ ${t.name} ไม่ถูกต้อง`, 'lodging_rooms_by');
                t.lodging_room = room;
                t.lodging_rate = room === 'single' ? t._lodging.single : t._lodging.double;
            }
            t.lodging_cap = t.lodging_rate * lodgingNights;
        }
        lodgingCap = round2(travelers.reduce((n, t) => n + t.lodging_cap, 0));
        if (lodgingMode === 'lump') lodging = lodgingCap;   // เหมาจ่าย = ตามอัตรา ไม่ต้องแนบหลักฐาน
        else {
            lodging = money(body?.lodging_amount, 'lodging_amount', 'ค่าเช่าที่พัก');
            if (lodging <= 0) throw new Bad(400, 'ระบุค่าเช่าที่พักที่ขอเบิก', 'lodging_amount');
            if (lodging > lodgingCap) throw new Bad(400, `ค่าเช่าที่พักจ่ายจริงเบิกได้ไม่เกิน ${lodgingCap.toLocaleString('en-US')} บาท ตามระดับสิทธิ์ของผู้เดินทาง`, 'lodging_amount');
            const singles = travelers.filter(t => t.lodging_room === 'single').length;
            lodgingRooms = singles + Math.ceil((travelers.length - singles) / 2);
            // ไปเป็นคณะให้พักห้องคู่ — พักเดี่ยวต้องมีเหตุผล (เช่น ต่างเพศ ไม่เหมาะสมที่จะพักรวม)
            lodgingNote = text(body?.lodging_note, 'lodging_note', 'เหตุผลที่พักห้องเดี่ยว', 300, travelers.length > 1 && singles > 0);
        }
    }
    if (lodgingMode === 'lump') lodgingRooms = 0;
    const registration = money(body?.registration_amount, 'registration_amount', 'ค่าลงทะเบียน');
    const other = money(body?.other_amount, 'other_amount', 'ค่าใช้จ่ายอื่น');
    const otherDesc = text(body?.other_desc, 'other_desc', 'รายการค่าใช้จ่ายอื่น', 200, other > 0);

    const total = round2(allowance + lodging + transport + registration + fuel + toll + other);

    // งบประมาณ — คำขอเป็นแค่ประมาณการ ไม่ตัดงบและไม่บล็อกเมื่อเกินคงเหลือ (หน้าเว็บเตือน)
    // งบถูกตัดเมื่องาน HRD บันทึกยอดที่การเงินยืนยันแล้วเท่านั้น (recordActual)
    const budgetId = Number(body?.budget_id);
    const [budget] = Number.isInteger(budgetId) && budgetId > 0
        ? await s`SELECT id, budget_type, name, is_active FROM hrd_travel_budgets WHERE id = ${budgetId}` : [];
    if (!budget) throw new Bad(400, 'กรุณาเลือกงบประมาณที่ใช้', 'budget_id');
    if (!budget.is_active && budget.id !== keepBudgetId) throw new Bad(400, `${budget.name} ปิดใช้งานแล้ว เลือกงบอื่น`, 'budget_id');
    return {
        row: {
            requester_id: requesterId, requester_name: me.name, requester_position: me.position ?? null, requester_unit: me.unit ?? null,
            purpose, subject, location, start_at: new Date(startMs), end_at: new Date(endMs), overnight: calc.overnight,
            allowance_max_days: calc.days, allowance_days: days, meals_provided: meals, ...v,
            allowance_amount: allowance, lodging_mode: lodgingMode, lodging_rooms: lodgingRooms, lodging_nights: lodgingNights,
            lodging_amount: lodging, lodging_cap: lodgingCap, lodging_note: lodgingNote,
            transport_amount: transport, registration_amount: registration, fuel_amount: fuel, toll_amount: toll,
            other_amount: other, other_desc: otherDesc, total_amount: total,
            budget_id: budget.id, budget_type: budget.budget_type, budget_name: budget.name,
        },
        travelers: travelers.map(({ _lodging, ...t }) => t),
    };
};

const REQ_COLS = (s: any) => s`r.id, r.requester_id, r.requester_name, r.requester_position, r.requester_unit, r.purpose, r.subject, r.location,
    r.start_at, r.end_at, r.overnight, r.allowance_max_days::float8 AS allowance_max_days, r.allowance_days::float8 AS allowance_days, r.meals_provided,
    r.vehicle_mode, r.vehicle_id, r.vehicle_name, r.vehicle_plate, r.distance_km::float8 AS distance_km, r.rate_per_km::float8 AS rate_per_km,
    r.route_id, r.route_text, r.route_max_fare, r.vehicle_other,
    r.allowance_amount::float8 AS allowance_amount, r.lodging_mode, r.lodging_rooms, r.lodging_nights, r.lodging_amount::float8 AS lodging_amount,
    r.lodging_cap::float8 AS lodging_cap, r.lodging_note,
    r.transport_amount::float8 AS transport_amount, r.registration_amount::float8 AS registration_amount, r.fuel_amount::float8 AS fuel_amount,
    r.toll_amount::float8 AS toll_amount, r.other_amount::float8 AS other_amount, r.other_desc, r.total_amount::float8 AS total_amount,
    r.budget_id, r.budget_type, r.budget_name, r.actual_amount::float8 AS actual_amount, r.actual_note, r.actual_at,
    r.status, r.cancel_reason, r.cancelled_at, r.created_at, r.updated_at,
    r.sign_mode, r.approval_stage, r.approval_chain, r.current_step, r.reject_reason, r.director_result, r.director_note, r.director_at`;

// ── สายอนุมัติในระบบ ──
/** ขั้นที่อนุมัติในระบบ = ช่องความเห็นในบันทึกข้อความ (หัวหน้ากลุ่มงาน · หัวหน้ากลุ่มภารกิจ) — ผอ. ลงนามบนกระดาษ */
const TRAVEL_LEVELS = ['MAJOR', 'MISSION'];
export const travelChainOf = async (uid: number): Promise<ChainStep[]> => {
    const resolved = await resolveApprovalChain(uid).catch(() => null);
    return (resolved?.steps ?? [])
        .filter(s => TRAVEL_LEVELS.includes(s.level) && !s.external && Number(s.approver_id) !== uid)
        .map((s, i) => ({ ...s, step: i + 1 }));
};
const currentStepOf = (r: any): ChainStep | null =>
    r.status === 'submitted' && r.approval_stage === 'chain' ? parseChain(r.approval_chain).find(s => Number(s.step) === Number(r.current_step)) ?? null : null;
const NO_SIGNATURE = 'ยังไม่ได้ตั้งค่าลายเซ็น — ตั้งได้ที่ ตั้งค่าบัญชี > ลายเซ็น';
/** คำขอที่รอผู้ใช้คนนี้อนุมัติ (alias r) */
// inChain = กรองด้วย GIN index (idx_hrd_travel_requests_chain) ก่อน แล้วจึงเช็กขั้นปัจจุบันแบบละเอียด — ไม่ต้องไล่ JSON ทุกแถว
const inChain = (s: any, uid: number) => s`(r.sign_mode = 'esign' AND r.approval_chain @> ${s.json([{ approver_id: uid }])})`;
const pendingFor = (s: any, uid: number) => s`(r.status = 'submitted' AND r.approval_stage = 'chain' AND ${inChain(s, uid)} AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(r.approval_chain) x WHERE (x->>'step')::int = r.current_step AND (x->>'approver_id')::int = ${uid}))`;
/** ผู้ใช้อยู่ในสายอนุมัติในระบบของคำขอ หรือเคยกดแล้ว (alias r) — เดินเอกสารไม่นับ (สายเก็บไว้แค่พิมพ์ชื่อ) */
// r.id = ANY(ARRAY(...)) แทน EXISTS — ให้ planner รวมสองเงื่อนไขเป็น BitmapOr บน index แทนการไล่ทั้งตาราง
const involvedIn = (s: any, uid: number) => s`(${inChain(s, uid)}
    OR r.id = ANY (ARRAY(SELECT a.request_id FROM hrd_travel_request_approvals a WHERE a.approver_id = ${uid})))`;
/** ผู้ขอ หรือร่วมเดินทาง (alias r) — แถวผู้เดินทางมีผู้ขอเสมอ */
const mineIn = (s: any, uid: number) => s`(r.requester_id = ${uid}
    OR r.id = ANY (ARRAY(SELECT t.request_id FROM hrd_travel_request_travelers t WHERE t.user_id = ${uid})))`;

const loadTravelers = (ids: number[]) => ids.length === 0 ? Promise.resolve([]) : core_kon`
    SELECT request_id, user_id, name, position, tier_id, tier_name, rate, is_requester,
           lodging_class_id, lodging_class_name, lodging_room, lodging_rate, lodging_cap::float8 AS lodging_cap, flight_class
    FROM hrd_travel_request_travelers WHERE request_id IN ${core_kon(ids)} ORDER BY request_id, sort_order, id`;

// แก้ได้ก่อนมีผู้อนุมัติกด (current_step = 1) · ยกเลิกได้จนกว่าการเงินยืนยันยอด
// บันทึกยอดยืนยัน = ADMIN/HRD หลัง ผอ. อนุมัติ · อนุมัติ = ผู้อนุมัติของขั้นปัจจุบัน · บันทึกผล ผอ. = ADMIN/HRD
const permsOf = (r: any, uid: number, manager: boolean) => {
    const open = r.status === 'submitted' && r.actual_amount == null;
    const step = currentStepOf(r);
    return {
        can_edit: open && r.requester_id === uid && Number(r.current_step) === 1 && r.approval_stage !== 'approved',
        can_cancel: open && (r.requester_id === uid || manager),
        can_record_actual: manager && r.status === 'submitted' && r.approval_stage === 'approved',
        can_approve: !!step && Number(step.approver_id) === uid && r.requester_id !== uid,
        can_record_director: manager && r.status === 'submitted' && r.approval_stage === 'director',
        waiting_for: step ? { level_name: step.level_name, approver_name: step.approver_name, is_acting: !!step.is_acting } : null,
    };
};

const canView = async (uid: number, r: any) => r.requester_id === uid || await canManage(uid)
    || (r.sign_mode === 'esign' && parseChain(r.approval_chain).some(s => Number(s.approver_id) === uid))
    || (await core_kon`SELECT 1 FROM hrd_travel_request_travelers WHERE request_id = ${r.id} AND user_id = ${uid}
                       UNION ALL SELECT 1 FROM hrd_travel_request_approvals WHERE request_id = ${r.id} AND approver_id = ${uid}`).length > 0;

const positionsOf = async (ids: number[]) => {
    const u = [...new Set(ids.filter(Boolean))];
    if (!u.length) return new Map<number, string | null>();
    const rows = await core_kon`SELECT u.id, up.position_name FROM users u LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id WHERE u.id IN ${core_kon(u)}`;
    return new Map(rows.map((r: any) => [Number(r.id), r.position_name ?? null]));
};
/** การกดในระบบของคำขอ (มีสำเนาลายเซ็น) */
const loadApprovals = (requestId: number) => core_kon`
    SELECT step, level, approver_id, approver_name, approver_position, is_acting, unit_name, action, comment, signature, acted_at
    FROM hrd_travel_request_approvals WHERE request_id = ${requestId} ORDER BY step`;
/**
 * ผู้ลงนามช่องความเห็น — หัวหน้ากลุ่มงาน · หัวหน้ากลุ่มภารกิจ: กดแล้วใช้สำเนา ณ เวลากด (มีลายเซ็น/ผล/ความเห็น)
 * ยังไม่กดใช้ผู้อนุมัติในสายที่เก็บไว้ในคำขอ · ผอ. ใช้ผังปัจจุบัน (ลงนามจริงบนกระดาษ)
 */
const signersOf = async (r: any, approvals: any[]) => {
    const chain = parseChain(r.approval_chain);
    const director = await resolveDirectorStep(1).catch(() => null);
    const pending = TRAVEL_LEVELS.map(l => approvals.some(a => a.level === l) ? null : chain.find(s => s.level === l)).filter(Boolean) as ChainStep[];
    const pos = await positionsOf([...pending.map(s => Number(s.approver_id)), director?.approver_id ?? 0]);
    const of = (level: string) => {
        const a = approvals.find(x => x.level === level);
        if (a) return { name: a.approver_name, position: a.approver_position, is_acting: a.is_acting, unit: a.unit_name, action: a.action, comment: a.comment, acted_at: a.acted_at, signature: a.signature };
        const s = chain.find(x => x.level === level);
        return s ? { name: s.approver_name, position: pos.get(Number(s.approver_id)) ?? null, is_acting: !!s.is_acting, unit: s.unit_name ?? null } : null;
    };
    return {
        major: of('MAJOR'), mission: of('MISSION'),
        director: director ? { name: director.approver_name, position: pos.get(director.approver_id) ?? null, is_acting: director.is_acting, unit: null } : null,
    };
};

// ── API ──────────────────────────────────────────────────────────────────────

// ข้อมูลตั้งต้นของแบบฟอร์ม: ผู้ขอ + อัตราของตัวเอง + ประเภทรถ + เส้นทาง
export const getRequestMeta = async ({ user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [[me], vehicles, routes, budgets, manager] = await Promise.all([
            peopleWithRate(core_kon, [uid]),
            core_kon`SELECT id, code, name, rate_per_km::float8 AS rate_per_km FROM hrd_travel_vehicle_rates ORDER BY sort_order, id`,
            core_kon`SELECT id, mode, origin, destination, max_fare, note FROM hrd_travel_routes WHERE is_active ORDER BY mode, origin, destination`,
            // งบที่เลือกได้ · คงเหลือ = วงเงิน − ยอดที่การเงินยืนยันแล้ว · pending = ประมาณการของคำขออื่นที่ยังไม่ยืนยัน (ไว้เตือน)
            core_kon`SELECT b.id, b.fiscal_year, b.budget_type, b.name, b.amount::float8 AS amount, b.is_active,
                       (b.amount - COALESCE(x.spent, 0))::float8 AS remaining, COALESCE(x.pending, 0)::float8 AS pending
                     FROM hrd_travel_budgets b
                     LEFT JOIN LATERAL (SELECT SUM(r.actual_amount) AS spent, SUM(r.total_amount) FILTER (WHERE r.actual_amount IS NULL) AS pending
                                        FROM hrd_travel_requests r WHERE r.budget_id = b.id AND r.status = 'submitted') x ON TRUE
                     ORDER BY b.fiscal_year DESC, b.budget_type, b.name`,
            canManage(uid),
        ]);
        if (!me) return fail(set, 404, 'ไม่พบข้อมูลผู้ใช้');
        const fy = fiscalYearOf(Date.now());
        const [trips, hasSig, chain, sign] = await Promise.all([
            tripCounts([uid], fy).then(m => m.get(uid) ?? 0),
            signatureOf(core_kon, uid).then(Boolean),
            travelChainOf(uid),
            signModeOf(core_kon, uid),
        ]);
        // สายอนุมัติที่คำขอใหม่จะเดิน (แสดงในแบบฟอร์มก่อนยื่น) + โหมดการลงนามตามกลุ่มของผู้ขอ
        const chainOut = chain.map(s => ({ step: s.step, level_name: s.level_name, approver_name: s.approver_name, is_acting: !!s.is_acting, unit_name: s.unit_name }));
        return {
            success: true,
            data: {
                me: { ...personOut(me), fy_trips: trips, has_signature: hasSig }, sign_mode: sign.mode, approval_chain: chainOut,
                fiscal_year: fy, vehicles, routes, budgets, can_manage: manager,
            },
        };
    } catch (e: any) {
        console.error('[hrdRequest] meta:', e?.message);
        return fail(set, 500, 'โหลดข้อมูลแบบฟอร์มไม่สำเร็จ');
    }
};

// ค้นหาผู้ร่วมเดินทาง (บุคลากรที่ปฏิบัติงาน) พร้อมอัตราเบี้ยเลี้ยง
export const searchTravelPeople = async ({ query, set }: any) => {
    try {
        const q = String(query?.search ?? '').trim().slice(0, 100);
        const ids = String(query?.ids ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, MAX_TRAVELERS);
        if (!q && !ids.length) return { success: true, data: [] };
        const like = '%' + q + '%';
        const found = ids.length ? ids : (await core_kon`
            SELECT u.id FROM users u LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            WHERE ${working()} AND (${nameOf()} ILIKE ${like} OR CONCAT(u.fname, ' ', u.lname) ILIKE ${like} OR up.position_name ILIKE ${like})
            ORDER BY u.fname, u.lname LIMIT 20`).map((r: any) => r.id);
        if (!found.length) return { success: true, data: [] };
        const rows = await peopleWithRate(core_kon, found);
        // จำนวนครั้งในปีงบที่กำลังกรอก (ส่ง fiscal_year มา) หรือปีงบปัจจุบัน — ไม่นับคำขอที่กำลังแก้ (except_id)
        const fy = Number(query?.fiscal_year) || fiscalYearOf(Date.now());
        const trips = await tripCounts(rows.map((r: any) => Number(r.id)), fy, Number(query?.except_id) || null);
        return { success: true, data: rows.map((r: any) => ({ ...personOut(r), fy_trips: trips.get(Number(r.id)) ?? 0 })) };
    } catch (e: any) {
        console.error('[hrdRequest] people:', e?.message);
        return fail(set, 500, 'ค้นหารายชื่อไม่สำเร็จ');
    }
};

// ── งานที่ HRD ต้องดำเนินการ (alias r) — ใช้ทั้งการ์ดหน้าแรกและตัวกรอง ?task= ของรายการคำขอ ──
// director = รอบันทึกผลคำสั่ง ผอ. (ลงนามในระบบครบสาย หรือเดินเอกสาร) · actual = ผอ. อนุมัติแล้ว รอบันทึกยอดที่การเงินยืนยัน
// soon = ใกล้ถึง/เลยวันเดินทาง (ภายใน SOON_DAYS วัน) แต่ยังไม่ผ่านสายอนุมัติ — ทั้งสามใช้ index idx_hrd_travel_requests_open
const SOON_DAYS = 7;
const TASK_KEYS = ['director', 'actual', 'soon'] as const;
type TaskKey = (typeof TASK_KEYS)[number];
const taskWhere = (s: any, t: TaskKey) => t === 'director'
    ? s`(r.status = 'submitted' AND r.actual_amount IS NULL AND r.approval_stage = 'director')`
    : t === 'actual'
        ? s`(r.status = 'submitted' AND r.actual_amount IS NULL AND r.approval_stage = 'approved')`
        : s`(r.status = 'submitted' AND r.actual_amount IS NULL AND r.approval_stage = 'chain' AND r.start_at < now() + make_interval(days => ${SOON_DAYS}))`;
/** งานค้างที่ต้องทำก่อนขึ้นก่อน — ผล ผอ./ใกล้เดินทาง เรียงตามวันออกเดินทาง · ยอดการเงิน เรียงตามวันกลับ */
const taskOrder = (s: any, t: TaskKey) => t === 'actual' ? s`r.end_at ASC, r.id ASC` : s`r.start_at ASC, r.id ASC`;

export const getRequests = async ({ query, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        // mine = ยื่นเอง/ร่วมเดินทาง · approve = รอฉันอนุมัติ + ที่ฉันอยู่ในสาย/เคยกด · all = ADMIN/HRD
        const scope = query?.scope === 'all' ? 'all' : query?.scope === 'approve' ? 'approve' : 'mine';
        if (scope === 'all' && !(await canManage(uid))) return fail(set, 403, 'ดูคำขอทั้งหมดได้เฉพาะผู้ดูแลระบบและเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล (HRD)');
        const search = String(query?.search ?? '').trim().slice(0, 100);
        const status = ['submitted', 'rejected', 'cancelled'].includes(query?.status) ? query.status : null;
        const pendingOnly = scope === 'approve' && query?.pending === '1';
        // ?task= ใช้ได้เฉพาะ scope=all (ADMIN/HRD ผ่านการตรวจด้านบนแล้ว)
        const task = scope === 'all' && (TASK_KEYS as readonly string[]).includes(query?.task) ? query.task as TaskKey : null;
        const limit = Math.min(Math.max(Number(query?.limit) || 50, 1), 200);
        const offset = Math.max(Number(query?.offset) || 0, 0);
        const like = '%' + search + '%';
        const where = core_kon`TRUE
            ${scope === 'mine' ? core_kon`AND ${mineIn(core_kon, uid)}` : core_kon``}
            ${scope === 'approve' ? (pendingOnly ? core_kon`AND ${pendingFor(core_kon, uid)}` : core_kon`AND ${involvedIn(core_kon, uid)}`) : core_kon``}
            ${search ? core_kon`AND (r.subject ILIKE ${like} OR r.purpose ILIKE ${like} OR r.location ILIKE ${like} OR r.requester_name ILIKE ${like})` : core_kon``}
            ${status ? core_kon`AND r.status = ${status}` : core_kon``}
            ${task ? core_kon`AND ${taskWhere(core_kon, task)}` : core_kon``}`;
        const [rows, [{ total }]] = await Promise.all([
            // แท็บรออนุมัติ: ที่รอฉันขึ้นก่อน
            core_kon`SELECT ${REQ_COLS(core_kon)}, (SELECT count(*)::int FROM hrd_travel_request_travelers t WHERE t.request_id = r.id) AS traveler_count
                     FROM hrd_travel_requests r WHERE ${where}
                     ORDER BY ${task ? taskOrder(core_kon, task) : core_kon`${scope === 'approve' ? core_kon`${pendingFor(core_kon, uid)} DESC,` : core_kon``} r.start_at DESC, r.id DESC`} LIMIT ${limit} OFFSET ${offset}`,
            core_kon`SELECT count(*)::int AS total FROM hrd_travel_requests r WHERE ${where}`,
        ]);
        const [manager, [{ pending }]] = await Promise.all([
            canManage(uid),
            core_kon`SELECT count(*)::int AS pending FROM hrd_travel_requests r WHERE ${pendingFor(core_kon, uid)}`,
        ]);
        return { success: true, data: { rows: rows.map((r: any) => ({ ...r, ...permsOf(r, uid, manager) })), total, limit, offset, can_manage: manager, pending_approvals: pending } };
    } catch (e: any) {
        console.error('[hrdRequest] list:', e?.message);
        return fail(set, 500, 'โหลดรายการคำขอไม่สำเร็จ');
    }
};

export const getRequestById = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [r] = await core_kon`SELECT ${REQ_COLS(core_kon)} FROM hrd_travel_requests r WHERE r.id = ${Number(params.id)}`;
        if (!r) return fail(set, 404, 'ไม่พบคำขอ');
        if (!(await canView(uid, r))) return fail(set, 403, 'ไม่มีสิทธิ์ดูคำขอนี้');
        const [travelers, approvals, manager, [sig]] = await Promise.all([
            loadTravelers([r.id]), loadApprovals(r.id), canManage(uid),
            core_kon`SELECT requester_signature FROM hrd_travel_requests WHERE id = ${r.id}`,
        ]);
        const signers = await signersOf(r, approvals);
        // ประวัติในปีงบของวันออกเดินทาง: ไปแล้วก่อนครั้งนี้ (prior_trips) และทั้งปีไม่นับครั้งนี้ (fy_trips)
        const fy = fiscalYearOf(new Date(r.start_at).getTime());
        const { from } = fyRange(fy);
        const ids = travelers.map((t: any) => Number(t.user_id));
        const [fyTrips, prior] = await Promise.all([
            tripCounts(ids, fy, r.id),
            ids.length ? core_kon`SELECT t.user_id, count(*)::int AS n FROM hrd_travel_request_travelers t JOIN hrd_travel_requests x ON x.id = t.request_id
                WHERE t.user_id IN ${core_kon(ids)} AND x.status = 'submitted' AND x.id <> ${r.id} AND x.start_at >= ${from} AND x.start_at < ${r.start_at}
                GROUP BY t.user_id` : Promise.resolve([]),
        ]);
        const priorMap = new Map(prior.map((p: any) => [Number(p.user_id), p.n]));
        const withTrips = travelers.map((t: any) => ({ ...t, fy_trips: fyTrips.get(Number(t.user_id)) ?? 0, prior_trips: priorMap.get(Number(t.user_id)) ?? 0 }));
        return {
            success: true,
            data: {
                ...r, fiscal_year: fy, travelers: withTrips, signers, requester_signature: sig?.requester_signature ?? null,
                approvals: approvals.map((a: any) => ({ ...a, signature: undefined })),   // ภาพลายเซ็นอยู่ใน signers แล้ว
                ...permsOf(r, uid, manager),
            },
        };
    } catch (e: any) {
        console.error('[hrdRequest] get:', e?.message);
        return fail(set, 500, 'โหลดคำขอไม่สำเร็จ');
    }
};

/**
 * เริ่มสายอนุมัติตามโหมดการลงนามของกลุ่มผู้ขอ
 *   esign: ลายเซ็นผู้ขอ (ต้องตั้งก่อน) · ไม่มีขั้นในระบบ (เช่น ผู้ขอเป็นหัวหน้ากลุ่มภารกิจ) = เสนอ ผอ. ทันที
 *   paper: ไม่ใช้ลายเซ็นในระบบ ขั้น director ทันที (HRD บันทึกผลตามเอกสาร) · เก็บสายไว้พิมพ์ชื่อผู้ลงนามในบันทึกข้อความ
 */
const approvalStart = async (sql: any, uid: number) => {
    const [{ mode }, chain] = await Promise.all([signModeOf(sql, uid), travelChainOf(uid)]);
    if (mode === 'paper') return { sign_mode: 'paper', requester_signature: null, approval_chain: sql.json(chain), current_step: 1, approval_stage: 'director' };
    const signature = await signatureOf(sql, uid);
    if (!signature) throw new Bad(400, NO_SIGNATURE, 'signature');
    return { sign_mode: 'esign', requester_signature: signature, approval_chain: sql.json(chain), current_step: 1, approval_stage: chain.length ? 'chain' : 'director' };
};

export const createRequest = async ({ body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const id = await core_kon.begin(async (sql: any) => {
            const { row, travelers } = await computeRequest(sql, body, uid);
            const approval = await approvalStart(sql, uid);
            const [r] = await sql`INSERT INTO hrd_travel_requests ${sql({ ...row, ...approval, updated_by: uid })} RETURNING id`;
            await sql`INSERT INTO hrd_travel_request_travelers ${sql(travelers.map(t => ({ ...t, request_id: r.id })))}`;
            return r.id;
        });
        return { success: true, data: { id } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdRequest] create:', e?.message);
        return fail(set, 500, 'บันทึกคำขอไม่สำเร็จ');
    }
};

export const updateRequest = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT id, requester_id, status, budget_id, actual_amount, current_step, approval_stage FROM hrd_travel_requests WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบคำขอ');
            if (cur.requester_id !== uid) throw new Bad(403, 'แก้ไขได้เฉพาะผู้ขอ');
            if (cur.status !== 'submitted') throw new Bad(409, cur.status === 'rejected' ? 'คำขอนี้ไม่ได้รับอนุมัติ แก้ไขไม่ได้ — ยื่นคำขอใหม่' : 'คำขอนี้ยกเลิกแล้ว แก้ไขไม่ได้');
            if (cur.actual_amount != null) throw new Bad(409, 'การเงินยืนยันยอดเบิกจ่ายแล้ว แก้ไขคำขอไม่ได้');
            if (Number(cur.current_step) !== 1 || cur.approval_stage === 'approved') throw new Bad(409, 'หัวหน้าลงนามอนุมัติแล้ว แก้ไขคำขอไม่ได้ — ยกเลิกแล้วยื่นใหม่');
            const { row, travelers } = await computeRequest(sql, body, uid, cur.budget_id);
            // แก้แล้วลงนามใหม่ด้วยลายเซ็นปัจจุบัน และคิดสายอนุมัติใหม่ตามผังปัจจุบัน
            const approval = await approvalStart(sql, uid);
            await sql`UPDATE hrd_travel_requests SET ${sql({ ...row, ...approval, updated_by: uid, updated_at: new Date() })} WHERE id = ${cur.id}`;
            await sql`DELETE FROM hrd_travel_request_travelers WHERE request_id = ${cur.id}`;
            await sql`INSERT INTO hrd_travel_request_travelers ${sql(travelers.map(t => ({ ...t, request_id: cur.id })))}`;
        });
        return { success: true, data: { id: Number(params.id) } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdRequest] update:', e?.message);
        return fail(set, 500, 'บันทึกคำขอไม่สำเร็จ');
    }
};

// ประวัติการไปราชการของบุคลากรหนึ่งคนในปีงบ — ADMIN/HRD ดูได้ทุกคน · คนอื่นดูได้เฉพาะของตัวเอง
export const getTravelHistory = async ({ query, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const target = Number(query?.user_id) || uid;
        if (target !== uid && !(await canManage(uid))) return fail(set, 403, 'ดูประวัติของผู้อื่นได้เฉพาะผู้ดูแลระบบและเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล (HRD)');
        const fy = Number(query?.fiscal_year) || fiscalYearOf(Date.now());
        const { from, to } = fyRange(fy);
        const [[person], rows] = await Promise.all([
            peopleWithRate(core_kon, [target]),
            core_kon`
                SELECT r.id, r.subject, r.purpose, r.location, r.start_at, r.end_at, r.status, r.requester_name,
                       r.allowance_days::float8 AS allowance_days, ${ALLOWANCE_SQL(core_kon)}::float8 AS allowance,
                       t.is_requester, r.total_amount::float8 AS total_amount, r.actual_amount::float8 AS actual_amount,
                       (SELECT count(*)::int FROM hrd_travel_request_travelers x WHERE x.request_id = r.id) AS traveler_count
                FROM hrd_travel_request_travelers t JOIN hrd_travel_requests r ON r.id = t.request_id
                WHERE t.user_id = ${target} AND r.start_at >= ${from} AND r.start_at < ${to}
                ORDER BY r.start_at DESC, r.id DESC`,
        ]);
        if (!person) return fail(set, 404, 'ไม่พบบุคลากร');
        const active = rows.filter((r: any) => r.status === 'submitted');
        const summary = {
            trips: active.length,
            days: active.reduce((n: number, r: any) => n + r.allowance_days, 0),
            allowance: round2(active.reduce((n: number, r: any) => n + r.allowance, 0)),
            past: active.filter((r: any) => new Date(r.end_at).getTime() < Date.now()).length,
            upcoming: active.filter((r: any) => new Date(r.end_at).getTime() >= Date.now()).length,
            cancelled: rows.filter((r: any) => r.status === 'cancelled').length,
            rejected: rows.filter((r: any) => r.status === 'rejected').length,
        };
        return { success: true, data: { fiscal_year: fy, person: { id: person.id, name: person.name, position: person.position, unit: person.unit }, summary, rows } };
    } catch (e: any) {
        console.error('[hrdRequest] history:', e?.message);
        return fail(set, 500, 'โหลดประวัติไม่สำเร็จ');
    }
};

// สรุปรายบุคคลในปีงบ (ADMIN/HRD) — เรียงตามจำนวนครั้งมากสุด
export const getTravelerStats = async ({ query, user, set }: any) => {
    try {
        if (!(await canManage(Number(user?.id)))) return fail(set, 403, 'เฉพาะผู้ดูแลระบบและเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล (HRD)');
        const fy = Number(query?.fiscal_year) || fiscalYearOf(Date.now());
        const { from, to } = fyRange(fy);
        const search = String(query?.search ?? '').trim().slice(0, 100);
        const limit = Math.min(Math.max(Number(query?.limit) || 50, 1), 200);
        const offset = Math.max(Number(query?.offset) || 0, 0);
        const like = '%' + search + '%';
        const base = core_kon`FROM hrd_travel_request_travelers t
            JOIN hrd_travel_requests r ON r.id = t.request_id AND r.status = 'submitted' AND r.start_at >= ${from} AND r.start_at < ${to}
            JOIN users u ON u.id = t.user_id
            LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            LEFT JOIN majors mj ON mj.major_id = u.major_id
            WHERE TRUE ${search ? core_kon`AND (${nameOf()} ILIKE ${like} OR mj.name ILIKE ${like} OR up.position_name ILIKE ${like})` : core_kon``}`;
        const [rows, [{ total, trips }]] = await Promise.all([
            core_kon`SELECT u.id, ${nameOf()} AS name, up.position_name AS position, mj.name AS unit,
                            count(*)::int AS trips, SUM(r.allowance_days)::float8 AS days, SUM(${ALLOWANCE_SQL(core_kon)})::float8 AS allowance,
                            MAX(r.start_at) AS last_start
                     ${base} GROUP BY u.id, u.pname, u.fname, u.lname, up.position_name, mj.name
                     ORDER BY trips DESC, days DESC, u.fname LIMIT ${limit} OFFSET ${offset}`,
            core_kon`SELECT count(DISTINCT u.id)::int AS total, count(*)::int AS trips ${base}`,
        ]);
        return { success: true, data: { fiscal_year: fy, rows, total, trips } };
    } catch (e: any) {
        console.error('[hrdRequest] stats:', e?.message);
        return fail(set, 500, 'โหลดสรุปรายบุคคลไม่สำเร็จ');
    }
};

// บันทึกยอดที่การเงินยืนยันแล้ว (ADMIN/HRD) — ยอดนี้เท่านั้นที่ตัดงบ · actual_amount = null = ล้าง (กลับเป็นประมาณการรอยืนยัน)
// ไม่บล็อกเมื่อเกินวงเงิน (เงินจ่ายไปแล้วจริง) — dashboard แสดงคงเหลือติดลบให้เห็น
export const recordActual = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        if (!(await canManage(uid))) return fail(set, 403, 'บันทึกยอดยืนยันจากการเงินได้เฉพาะผู้ดูแลระบบและเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล (HRD)');
        const clear = body?.actual_amount === null;
        const amount = clear ? null : money(body?.actual_amount, 'actual_amount', 'ยอดที่การเงินยืนยัน');
        if (!clear && (body?.actual_amount === undefined || body?.actual_amount === '')) return fail(set, 400, 'กรุณาระบุยอดที่การเงินยืนยัน', 'actual_amount');
        const note = text(body?.actual_note, 'actual_note', 'หมายเหตุ', 300, false);
        const r = await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT id, status, approval_stage FROM hrd_travel_requests WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบคำขอ');
            if (cur.status !== 'submitted') throw new Bad(409, cur.status === 'rejected' ? 'คำขอนี้ไม่ได้รับอนุมัติ' : 'คำขอนี้ยกเลิกแล้ว');
            if (!clear && cur.approval_stage !== 'approved') throw new Bad(409, 'ยังไม่ได้บันทึกว่าผู้อำนวยการอนุมัติ — บันทึกผลคำสั่ง ผอ. ก่อน');
            await sql`UPDATE hrd_travel_requests SET actual_amount = ${amount}, actual_note = ${clear ? null : note},
                      actual_by = ${clear ? null : uid}, actual_at = ${clear ? null : new Date()}, updated_by = ${uid}, updated_at = NOW()
                      WHERE id = ${cur.id}`;
            return { id: cur.id, actual_amount: amount };
        });
        return { success: true, data: r };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdRequest] actual:', e?.message);
        return fail(set, 500, 'บันทึกยอดยืนยันไม่สำเร็จ');
    }
};

// ── อนุมัติในระบบ (หัวหน้ากลุ่มงาน → หัวหน้ากลุ่มภารกิจ) ──
// ผู้อนุมัติของขั้นปัจจุบันเท่านั้น ต้องตั้งลายเซ็นก่อน · ไม่อนุมัติต้องมีเหตุผล = จบคำขอ (status rejected)
// อนุมัติขั้นสุดท้าย = รอ ผอ. ลงนามบนกระดาษ (approval_stage director)
const actOnRequest = async ({ params, body, user, set }: any, action: 'approved' | 'rejected') => {
    try {
        const uid = Number(user?.id);
        const comment = text(body?.comment, 'comment', action === 'rejected' ? 'เหตุผลที่ไม่อนุมัติ' : 'ความเห็น', 300, action === 'rejected');
        const out = await core_kon.begin(async (sql: any) => {
            const [r] = await sql`SELECT id, requester_id, status, approval_stage, approval_chain, current_step FROM hrd_travel_requests WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!r) throw new Bad(404, 'ไม่พบคำขอ');
            if (r.status !== 'submitted') throw new Bad(409, r.status === 'rejected' ? 'คำขอนี้ไม่ได้รับอนุมัติแล้ว' : 'คำขอนี้ยกเลิกแล้ว');
            if (r.approval_stage !== 'chain') throw new Bad(409, 'คำขอนี้ผ่านการอนุมัติในระบบครบแล้ว', 'NOT_PENDING');
            const chain = parseChain(r.approval_chain);
            const step = chain.find(s => Number(s.step) === Number(r.current_step));
            if (!step) throw new Bad(500, 'สายอนุมัติของคำขอนี้ไม่สมบูรณ์ กรุณาติดต่อผู้ดูแลระบบ');
            if (Number(step.approver_id) !== uid) throw new Bad(403, `ขั้นนี้รอ${step.level_name} (${step.approver_name}) อนุมัติ`);
            if (r.requester_id === uid) throw new Bad(403, 'อนุมัติคำขอของตัวเองไม่ได้');
            const signature = await signatureOf(sql, uid);
            if (!signature) throw new Bad(400, NO_SIGNATURE, 'signature');
            const position = (await positionsOf([uid])).get(uid) ?? null;
            await sql`INSERT INTO hrd_travel_request_approvals ${sql({
                request_id: r.id, step: step.step, level: step.level, approver_id: uid, approver_name: step.approver_name, approver_position: position,
                is_acting: !!step.is_acting, unit_name: step.unit_name ?? null, action, comment, signature,
            })}`;
            if (action === 'rejected') {
                await sql`UPDATE hrd_travel_requests SET status = 'rejected', reject_reason = ${comment}, updated_by = ${uid}, updated_at = NOW() WHERE id = ${r.id}`;
                return { status: 'rejected', message: 'บันทึกการไม่อนุมัติแล้ว' };
            }
            const next = Number(r.current_step) + 1;
            const nextStep = chain.find(s => Number(s.step) === next);
            await sql`UPDATE hrd_travel_requests SET current_step = ${next}, approval_stage = ${nextStep ? 'chain' : 'director'}, updated_by = ${uid}, updated_at = NOW() WHERE id = ${r.id}`;
            return nextStep
                ? { status: 'chain', message: `อนุมัติแล้ว ส่งต่อให้${nextStep.level_name} (${nextStep.approver_name})` }
                : { status: 'director', message: 'อนุมัติแล้ว — รอผู้อำนวยการลงนามในบันทึกข้อความ' };
        });
        return { success: true, data: { id: Number(params.id), status: out.status }, message: out.message };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdRequest] act:', e?.message);
        return fail(set, 500, 'บันทึกการอนุมัติไม่สำเร็จ');
    }
};
export const approveRequest = (ctx: any) => actOnRequest(ctx, 'approved');
export const rejectRequest = (ctx: any) => actOnRequest(ctx, 'rejected');

// บันทึกผลคำสั่ง ผอ. ตามบันทึกข้อความที่ลงนามจริงแล้ว (ADMIN/HRD) — body { result: approved|rejected, note? }
export const recordDirector = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        if (!(await canManage(uid))) return fail(set, 403, 'บันทึกผลคำสั่งผู้อำนวยการได้เฉพาะผู้ดูแลระบบและเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล (HRD)');
        const result = body?.result;
        if (result !== 'approved' && result !== 'rejected') return fail(set, 400, 'เลือกผลคำสั่ง (อนุมัติ / ไม่อนุมัติ)', 'result');
        const note = text(body?.note, 'note', result === 'rejected' ? 'เหตุผลที่ไม่อนุมัติ' : 'หมายเหตุ', 300, result === 'rejected');
        await core_kon.begin(async (sql: any) => {
            const [r] = await sql`SELECT id, status, approval_stage FROM hrd_travel_requests WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!r) throw new Bad(404, 'ไม่พบคำขอ');
            if (r.status !== 'submitted') throw new Bad(409, r.status === 'rejected' ? 'คำขอนี้ไม่ได้รับอนุมัติแล้ว' : 'คำขอนี้ยกเลิกแล้ว');
            if (r.approval_stage !== 'director') throw new Bad(409, r.approval_stage === 'chain' ? 'ยังรอหัวหน้าอนุมัติในระบบ' : 'บันทึกผลคำสั่งผู้อำนวยการไปแล้ว');
            await sql`UPDATE hrd_travel_requests SET director_result = ${result}, director_note = ${note}, director_by = ${uid}, director_at = NOW(),
                      approval_stage = ${result === 'approved' ? 'approved' : 'director'}, status = ${result === 'approved' ? 'submitted' : 'rejected'},
                      reject_reason = ${result === 'rejected' ? note : null}, updated_by = ${uid}, updated_at = NOW()
                      WHERE id = ${r.id}`;
        });
        return { success: true, data: { id: Number(params.id), result } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdRequest] director:', e?.message);
        return fail(set, 500, 'บันทึกผลคำสั่งผู้อำนวยการไม่สำเร็จ');
    }
};

// จำนวนคำขอที่รอผู้ใช้อนุมัติ (ป้ายบนเมนู) + เคยอยู่ในสายอนุมัติไหม (แสดงแท็บรออนุมัติ)
export const getApprovalCount = async ({ user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [{ pending, involved }] = await core_kon`
            SELECT (SELECT count(*)::int FROM hrd_travel_requests r WHERE ${pendingFor(core_kon, uid)}) AS pending,
                   EXISTS (SELECT 1 FROM hrd_travel_requests r WHERE ${involvedIn(core_kon, uid)}) AS involved`;
        return { success: true, data: { pending, involved } };
    } catch (e: any) {
        console.error('[hrdRequest] count:', e?.message);
        return fail(set, 500, 'โหลดจำนวนคำขอที่รออนุมัติไม่สำเร็จ');
    }
};

export const cancelRequest = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const reason = text(body?.reason, 'reason', 'เหตุผลที่ยกเลิก', 300, false);
        await core_kon.begin(async (sql: any) => {
            const [cur] = await sql`SELECT id, requester_id, status, actual_amount FROM hrd_travel_requests WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!cur) throw new Bad(404, 'ไม่พบคำขอ');
            if (cur.requester_id !== uid && !(await canManage(uid))) throw new Bad(403, 'ยกเลิกได้เฉพาะผู้ขอ หรือเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล (HRD)');
            if (cur.status !== 'submitted') throw new Bad(409, 'คำขอนี้ยกเลิกแล้ว');
            if (cur.actual_amount != null) throw new Bad(409, 'การเงินยืนยันยอดเบิกจ่ายแล้ว ยกเลิกไม่ได้ — ล้างยอดยืนยันก่อน');
            await sql`UPDATE hrd_travel_requests SET status = 'cancelled', cancel_reason = ${reason}, cancelled_by = ${uid}, cancelled_at = NOW(), updated_by = ${uid}, updated_at = NOW() WHERE id = ${cur.id}`;
        });
        return { success: true, data: { cancelled: true } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdRequest] cancel:', e?.message);
        return fail(set, 500, 'ยกเลิกคำขอไม่สำเร็จ');
    }
};

// งานที่ต้องดำเนินการของ HRD (หน้าแรกเดินทางไปราชการ) — ADMIN / HRD
// นับ + ตัวอย่างรายการละ 5 ใบ · งบประมาณปีงบปัจจุบันที่เกิน/จะเกินวงเงิน หรือยังไม่มีงบที่เปิดใช้ (บุคลากรยื่นคำขอไม่ได้)
export const getHrdTasks = async ({ user, set }: any) => {
    try {
        if (!(await canManage(Number(user?.id)))) return fail(set, 403, 'เฉพาะผู้ดูแลระบบและเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล (HRD)');
        const fy = fiscalYearOf(Date.now());
        const itemCols = core_kon`r.id, r.requester_name, r.requester_unit, r.subject, r.location, r.start_at, r.end_at, r.sign_mode,
            r.total_amount::float8 AS total_amount, r.current_step, r.approval_chain`;
        const items = (t: TaskKey) => core_kon`SELECT ${itemCols} FROM hrd_travel_requests r WHERE ${taskWhere(core_kon, t)} ORDER BY ${taskOrder(core_kon, t)} LIMIT 5`;
        const [[c], director, actual, soon, budgets] = await Promise.all([
            core_kon`
                SELECT count(*) FILTER (WHERE ${taskWhere(core_kon, 'director')})::int AS director,
                       count(*) FILTER (WHERE ${taskWhere(core_kon, 'director')} AND r.sign_mode = 'paper')::int AS director_paper,
                       count(*) FILTER (WHERE ${taskWhere(core_kon, 'actual')})::int AS actual,
                       count(*) FILTER (WHERE ${taskWhere(core_kon, 'actual')} AND r.end_at < now())::int AS actual_returned,
                       count(*) FILTER (WHERE ${taskWhere(core_kon, 'soon')})::int AS soon,
                       count(*) FILTER (WHERE ${taskWhere(core_kon, 'soon')} AND r.start_at < now())::int AS soon_overdue
                FROM hrd_travel_requests r WHERE r.status = 'submitted' AND r.actual_amount IS NULL`,
            items('director'), items('actual'), items('soon'),
            core_kon`
                SELECT b.id, b.name, b.budget_type, b.is_active, b.amount::float8 AS amount,
                       COALESCE(SUM(r.actual_amount), 0)::float8 AS spent,
                       COALESCE(SUM(r.total_amount) FILTER (WHERE r.actual_amount IS NULL), 0)::float8 AS pending
                FROM hrd_travel_budgets b
                LEFT JOIN hrd_travel_requests r ON r.budget_id = b.id AND r.status = 'submitted'
                WHERE b.fiscal_year = ${fy}
                GROUP BY b.id ORDER BY b.name`,
        ]);
        // คำขอที่ยังอยู่ในสาย — บอกว่ารอใคร (ขั้นปัจจุบัน)
        const waiting = ({ approval_chain, current_step, ...rest }: any) => {
            const step = parseChain(approval_chain).find(x => Number(x.step) === Number(current_step));
            return { ...rest, waiting_for: step ? `${step.level_name} · ${step.approver_name}` : null };
        };
        const strip = ({ approval_chain, current_step, ...rest }: any) => rest;
        const rows = budgets.map((b: any) => ({ ...b, remaining: round2(b.amount - b.spent), projected: round2(b.amount - b.spent - b.pending) }));
        return {
            success: true,
            data: {
                fiscal_year: fy, soon_days: SOON_DAYS,
                director: { count: c.director, paper: c.director_paper, items: director.map(strip) },
                actual: { count: c.actual, returned: c.actual_returned, items: actual.map(strip) },
                soon: { count: c.soon, overdue: c.soon_overdue, items: soon.map(waiting) },
                budgets: {
                    count: rows.length,
                    no_active: !rows.some((b: any) => b.is_active),
                    // คงเหลือติดลบ = เบิกจริงเกินวงเงินแล้ว · ประมาณการติดลบ = ถ้าคำขอที่รอยืนยันเบิกตามประมาณการจะเกิน
                    alerts: rows.filter((b: any) => b.remaining < 0 || b.projected < 0),
                },
            },
        };
    } catch (e: any) {
        console.error('[hrdRequest] tasks:', e?.message);
        return fail(set, 500, 'โหลดงานที่ต้องดำเนินการไม่สำเร็จ');
    }
};
