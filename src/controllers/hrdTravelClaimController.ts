// เคลียร์ค่าใช้จ่ายเดินทางไปราชการ (เบิกจ่ายจริง) — ตาราง src/db/hrd_travel_claims.sql · คำนวณ src/services/travelClaimCalc.ts
//
// ขั้นตอน: ผู้ขอ (เบิกแทนทั้งคณะ) บันทึก/ส่ง → HRD ตรวจยอดและสิทธิ์ (ส่งกลับ หรือปรับยอดรายรายการพร้อมเหตุผล แล้วส่งการเงิน)
//         → การเงินตรวจ (ยืนยัน หรือตีกลับ HRD — ไม่แก้ยอด) → คืนเงิน/จ่ายเพิ่ม → ปิดเรื่อง
// ทุกยอดปิดที่การเงิน · ไม่ผ่าน HRD ไม่ถึงการเงิน · ส่งเบิกต้องส่งรายงานการเดินทางแล้ว
// การเงินยืนยัน = hrd_travel_requests.actual_amount = ยอดที่ HRD อนุมัติ (งบถูกตัดตามยอดจริง — dashboard เดิมใช้ต่อได้)
// สิทธิ์: ผู้ขอแก้/ส่ง (ร่าง หรือถูกส่งกลับ) — คำขอที่ไปเป็นคณะ ADMIN/HRD เบิกแทนได้ · ผู้ร่วมเดินทางดูได้
//        ADMIN/HRD ตรวจ (ยกเว้นผู้เดินทางในคำขอ และผู้ที่บันทึกส่งแทน) · ADMIN/HRD_FINANCE การเงิน
// kind refund = ยกเลิกการเดินทางหลังยืมเงิน → คืนเงินยืมเต็มจำนวน (สร้างจากการยกเลิกคำขอ ผ่าน HRD → การเงิน)
import { core_kon } from '../db/db';
import { canManage } from './hrdTravelController';
import { ClaimError, CLAIM_CATEGORIES, approvedTotals, computeClaim, round2, settlementOf, type ClaimCategory, type ClaimContext, type ItemCategory } from '../services/travelClaimCalc';

const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, ...(field ? { field } : {}) }; };
class Bad extends Error { constructor(public status: number, message: string, public field?: string) { super(message); } }
/** เจ้าหน้าที่การเงินที่ตรวจงาน HRD — role แยก (src/db/hrd_travel_claims_v2.sql) */
const FINANCE_ROLES = ['ADMIN', 'HRD_FINANCE'];
export const canFinance = async (uid: number) => (await core_kon`
    SELECT 1 FROM user_m_users_roles mu JOIN user_roles r ON r.id = mu.role_id
    WHERE mu.user_id = ${uid} AND UPPER(r.role_name) IN ${core_kon(FINANCE_ROLES)} LIMIT 1`).length > 0;
const oneLine = (v: unknown, max: number) => { const t = v == null ? '' : String(v).trim().replace(/\s+/g, ' '); return t ? t.slice(0, max) : null; };
const multiline = (v: unknown, max: number) => {
    const t = v == null ? '' : String(v).split(/\r\n|\r|\n/).map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 30).join('\n');
    return t ? t.slice(0, max) : null;
};
const money = (v: unknown, field: string, label: string) => {
    const n = Number(v);
    if (v === null || v === undefined || v === '' || !Number.isFinite(n) || n < 0 || n > 1_000_000 || Math.abs(Math.round(n * 100) - n * 100) > 1e-6)
        throw new Bad(400, `${label}ต้องเป็นจำนวนเงิน 0–1,000,000 บาท ทศนิยมไม่เกิน 2 ตำแหน่ง`, field);
    return n;
};
const nameOf = async (sql: any, uid: number) => String((await sql`SELECT CONCAT(pname, fname, ' ', lname) AS n FROM users WHERE id = ${uid}`)[0]?.n ?? '').trim() || '-';
const log = (sql: any, claimId: number, uid: number, name: string, action: string, note: string | null, amount: number | null) =>
    sql`INSERT INTO hrd_travel_claim_log (claim_id, actor_id, actor_name, action, note, amount) VALUES (${claimId}, ${uid}, ${name}, ${action}, ${note}, ${amount})`;

/** ยอดประมาณการรายหมวดของคำขอ (alias r) */
const estimateOf = (r: any): Record<ClaimCategory, number> => ({
    allowance: Number(r.allowance_amount), lodging: Number(r.lodging_amount),
    transport: round2(Number(r.fuel_amount) + Number(r.toll_amount) + Number(r.transport_amount) + Number(r.taxi_go_amount) + Number(r.taxi_back_amount) + Number(r.home_station_amount)),
    registration: Number(r.registration_amount), other: Number(r.other_amount),
});
const loadRequest = async (sql: any, id: number, lock = false) => {
    const [r] = await sql`SELECT r.id, r.requester_id, r.requester_name, r.subject, r.purpose, r.location, r.start_at, r.end_at, r.status, r.approval_stage, r.cost_mode,
            r.vehicle_mode, r.vehicle_plate, r.vehicle_name, r.rate_per_km::float8 AS rate_per_km, r.route_max_fare::float8 AS route_max_fare, r.route_text,
            r.allowance_days::float8 AS allowance_days, r.meals_provided, r.lodging_mode, r.lodging_nights,
            r.allowance_amount::float8 AS allowance_amount, r.lodging_amount::float8 AS lodging_amount, r.fuel_amount::float8 AS fuel_amount, r.toll_amount::float8 AS toll_amount,
            r.transport_amount::float8 AS transport_amount, r.taxi_go_amount::float8 AS taxi_go_amount, r.taxi_back_amount::float8 AS taxi_back_amount,
            r.home_station_amount::float8 AS home_station_amount, r.registration_amount::float8 AS registration_amount, r.other_amount::float8 AS other_amount,
            r.total_amount::float8 AS total_amount, r.actual_amount::float8 AS actual_amount, r.budget_name, r.distance_km::float8 AS distance_km
        FROM hrd_travel_requests r WHERE r.id = ${id} ${lock ? sql`FOR UPDATE` : sql``}`;
    return r ?? null;
};
/** ผู้เดินทางของคำขอ + อัตรา ณ วันยื่น + อัตราที่พักตามระดับสิทธิ์ (ชั้นที่บันทึกไว้ในคำขอ ไม่มีใช้ชั้นปัจจุบัน/ค่าตั้งต้น) */
const loadTravelers = (sql: any, requestId: number) => sql`
    SELECT t.user_id, t.name, t.position, t.rate::float8 AS rate, t.is_requester,
           lc.name AS lodging_class_name, lc.lump_sum::float8 AS lump, lc.single_room::float8 AS single, lc.double_room::float8 AS double
    FROM hrd_travel_request_travelers t
    LEFT JOIN hrd_travel_lodging_people lp ON lp.user_id = t.user_id
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN hrd_travel_lodging_levels ll ON ll.user_level_id = u.user_level_id
    JOIN hrd_travel_lodging_classes lc ON lc.id = COALESCE(t.lodging_class_id, lp.class_id, ll.class_id, (SELECT id FROM hrd_travel_lodging_classes WHERE is_default))
    WHERE t.request_id = ${requestId} ORDER BY t.sort_order, t.id`;
const ctxOf = (r: any, travelers: any[]): ClaimContext => ({
    vehicle_mode: r.vehicle_mode, rate_per_km: r.rate_per_km, route_max_fare: r.route_max_fare, estimate: estimateOf(r),
    travelers: travelers.map((t: any) => ({ user_id: Number(t.user_id), name: t.name, rate: Number(t.rate), is_requester: t.is_requester,
        lodging: { lump: Number(t.lump ?? 0), single: Number(t.single ?? 0), double: Number(t.double ?? 0) } })),
});
const CLAIM_COLS = (s: any) => s`c.id, c.request_id, c.mode, c.advance_no, c.advance_amount::float8 AS advance_amount, c.advance_date::text AS advance_date,
    c.actual_start_at, c.actual_end_at, c.meals_provided, c.allowance_days::float8 AS allowance_days, c.lodging_mode, c.lodging_nights,
    c.distance_km::float8 AS distance_km, c.other_desc, c.over_reasons, c.claimed, c.approved, c.claimed_total::float8 AS claimed_total,
    c.approved_total::float8 AS approved_total, c.status, c.finance_returned, c.submitted_at, c.hrd_at, c.finance_at, c.settle_note, c.closed_at, c.updated_at,
    c.kind, c.absent_user_ids, c.person_times, c.submitted_by,
    (SELECT TRIM(CONCAT(u.pname, u.fname, ' ', u.lname)) FROM users u WHERE u.id = c.submitted_by) AS submitted_by_name`;
const loadItems = (sql: any, claimId: number) => sql`
    SELECT id, category, user_id, label, detail, room, claimed_amount::float8 AS claimed_amount, cap_amount::float8 AS cap_amount, computed,
           approved_amount::float8 AS approved_amount, hrd_note, sort_order
    FROM hrd_travel_claim_items WHERE claim_id = ${claimId} ORDER BY sort_order, id`;

const EDITABLE = ['draft', 'returned'];
/** คำขอที่เบิกได้: ผอ. อนุมัติแล้ว ยังไม่ยกเลิก และเป็นคำขอเบิกค่าใช้จ่าย */
const claimable = (r: any) => r.status === 'submitted' && r.approval_stage === 'approved' && r.cost_mode !== 'no_claim';

// ── GET /claims/request/:id — ข้อมูลหน้าเบิก (ผู้ขอ/ผู้ร่วมเดินทาง/HRD/การเงิน) ──
export const getClaim = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const r = await loadRequest(core_kon, Number(params.id));
        if (!r) return fail(set, 404, 'ไม่พบคำขอ');
        const [travelers, [claim], manager, finance, [report]] = await Promise.all([
            loadTravelers(core_kon, r.id),
            core_kon`SELECT ${CLAIM_COLS(core_kon)} FROM hrd_travel_claims c WHERE c.request_id = ${r.id}`,
            canManage(uid), canFinance(uid),
            core_kon`SELECT status FROM hrd_travel_reports WHERE request_id = ${r.id}`,
        ]);
        const receipts = await core_kon`SELECT f.id, f.original_name, f.mime, f.size_bytes, f.uploaded_at FROM hrd_travel_request_files f WHERE f.request_id = ${r.id} AND f.kind = 'receipt' ORDER BY f.id`;
        const traveler = travelers.some((t: any) => Number(t.user_id) === uid);
        const financeSees = finance && claim && ['finance', 'verified', 'closed'].includes(claim.status);
        if (r.requester_id !== uid && !traveler && !manager && !financeSees) return fail(set, 403, 'ไม่มีสิทธิ์ดูการเบิกของคำขอนี้');
        const [items, history] = claim ? await Promise.all([
            loadItems(core_kon, claim.id),
            core_kon`SELECT actor_name, action, note, amount::float8 AS amount, acted_at FROM hrd_travel_claim_log WHERE claim_id = ${claim.id} ORDER BY acted_at, id`,
        ]) : [[], []];
        const owner = r.requester_id === uid;
        // HRD เบิกแทนได้เมื่อไปเป็นคณะ · ผู้เดินทางในคำขอ/ผู้บันทึกส่งแทน ตรวจเองไม่ได้
        const filer = owner || (manager && travelers.length > 1);
        const hrdOk = manager && !traveler && claim?.submitted_by !== uid && r.requester_id !== uid;
        return {
            success: true,
            data: {
                request: { ...r, estimate: estimateOf(r) },
                travelers: travelers.map((t: any) => ({ user_id: Number(t.user_id), name: t.name, position: t.position, rate: Number(t.rate), is_requester: t.is_requester,
                    lodging_class_name: t.lodging_class_name, lodging: { lump: Number(t.lump), single: Number(t.single), double: Number(t.double) } })),
                claim: claim ? { ...claim, items, history, settlement: settlementOf(claim.mode, claim.advance_amount, Number(claim.approved_total ?? claim.claimed_total)) } : null,
                report_status: report?.status ?? null, receipts,
                can_edit: filer && claimable(r) && (!claim || (EDITABLE.includes(claim.status) && claim.kind === 'claim')),
                filing_for_group: !owner && filer,
                can_hrd: hrdOk && !!claim && claim.status === 'hrd' && (claimable(r) || claim.kind === 'refund'),
                hrd_blocked: manager && !!claim && claim.status === 'hrd' && !hrdOk
                    ? (traveler ? 'ท่านเป็นผู้เดินทางในคำขอนี้ — ให้เจ้าหน้าที่ HRD คนอื่นตรวจ' : 'ท่านเป็นผู้บันทึกการเบิกนี้ — ให้เจ้าหน้าที่ HRD คนอื่นตรวจ') : null,
                can_finance: finance && !!claim && claim.status === 'finance',
                can_close: finance && !!claim && claim.status === 'verified',
                claimable: claimable(r),
            },
        };
    } catch (e: any) {
        console.error('[hrdClaim] get:', e?.message);
        return fail(set, 500, 'โหลดข้อมูลการเบิกไม่สำเร็จ');
    }
};

// ── PUT /claims/request/:id — ผู้ขอบันทึกร่าง / ส่ง HRD (submit: true) ──
export const saveClaim = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const submit = body?.submit === true;
        const out = await core_kon.begin(async (sql: any) => {
            const r = await loadRequest(sql, Number(params.id), true);
            if (!r) throw new Bad(404, 'ไม่พบคำขอ');
            const travelers = await loadTravelers(sql, r.id);
            if (r.requester_id !== uid && !(travelers.length > 1 && (await canManage(uid))))
                throw new Bad(403, 'เบิกได้เฉพาะผู้ขอ (เบิกแทนทั้งคณะ) — คำขอที่ไปเป็นคณะ เจ้าหน้าที่ HRD เบิกแทนได้');
            if (r.cost_mode === 'no_claim') throw new Bad(409, 'คำขอนี้ไม่เบิกค่าใช้จ่าย');
            if (!claimable(r)) throw new Bad(409, r.status !== 'submitted' ? 'คำขอนี้ไม่ได้รับอนุมัติหรือยกเลิกแล้ว' : 'ผู้อำนวยการยังไม่อนุมัติการเดินทาง — เบิกได้หลัง HRD อัปเดตสถานะว่าเดินทางได้');
            const [cur] = await sql`SELECT id, status, kind FROM hrd_travel_claims WHERE request_id = ${r.id} FOR UPDATE`;
            if (cur && cur.kind === 'refund') throw new Bad(409, 'คำขอนี้ยกเลิกการเดินทางแล้ว — อยู่ระหว่างคืนเงินยืม');
            if (cur && !EDITABLE.includes(cur.status)) throw new Bad(409, 'ส่งเบิกแล้ว แก้ไขไม่ได้ — รอ HRD/การเงินตรวจ');
            const mode = body?.mode === 'reimburse' ? 'reimburse' : body?.mode === 'advance' ? 'advance' : null;
            if (!mode) throw new Bad(400, 'เลือกรูปแบบการเบิก (ล้างเงินยืม / สำรองจ่ายเอง)', 'mode');
            let advanceAmount: number | null = null, advanceNo: string | null = null, advanceDate: string | null = null;
            if (mode === 'advance') {
                advanceAmount = money(body?.advance_amount, 'advance_amount', 'จำนวนเงินยืม');
                if (advanceAmount <= 0) throw new Bad(400, 'ระบุจำนวนเงินยืม', 'advance_amount');
                advanceNo = oneLine(body?.advance_no, 50);
                if (submit && !advanceNo) throw new Bad(400, 'ระบุเลขที่สัญญายืมเงิน', 'advance_no');
                const d = String(body?.advance_date ?? '');
                if (d && (!/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) !== d)) throw new Bad(400, 'วันที่รับเงินยืมไม่ถูกต้อง', 'advance_date');
                advanceDate = d || null;
            }
            let c;
            try { c = computeClaim(body ?? {}, ctxOf(r, travelers)); } catch (e: any) { if (e instanceof ClaimError) throw new Bad(400, e.message, e.field); throw e; }
            if (submit) {
                if (c.actual_end_at.getTime() > Date.now()) throw new Bad(400, 'ยังไม่ถึงวันเวลากลับถึง — ส่งเบิกได้หลังเดินทางกลับ', 'actual_end_at');
                if (c.missing_reasons.length) throw new Bad(400, `เบิกเกินประมาณการ — ระบุเหตุผล (${c.missing_reasons.map(k => ({ allowance: 'เบี้ยเลี้ยง', lodging: 'ที่พัก', transport: 'พาหนะ', registration: 'ลงทะเบียน', other: 'อื่น ๆ' })[k]).join(', ')})`, `over_reasons.${c.missing_reasons[0]}`);
                const [rep] = await sql`SELECT status FROM hrd_travel_reports WHERE request_id = ${r.id}`;
                if (rep?.status !== 'submitted') throw new Bad(400, 'ต้องส่งรายงานการเดินทางก่อน (ส่งคู่กับการเบิก)', 'report');
                // มียอดตามใบเสร็จ (ที่พักจ่ายจริง ลงทะเบียน ทางด่วน ค่าโดยสาร แท็กซี่ อื่น ๆ) ต้องแนบใบเสร็จอย่างน้อย 1 ไฟล์
                if (c.items.some(i => !i.computed && i.claimed_amount > 0)) {
                    const [{ n }] = await sql`SELECT count(*)::int AS n FROM hrd_travel_request_files WHERE request_id = ${r.id} AND kind = 'receipt'`;
                    if (!n) throw new Bad(400, 'แนบใบเสร็จ/หลักฐานการเบิก', 'receipts');
                }
                if (body?.confirmed !== true) throw new Bad(400, 'ยืนยันว่าตรวจยอดตรงกับใบเสร็จทุกใบแล้ว', 'confirmed');
            }
            const row = {
                mode, advance_no: advanceNo, advance_amount: advanceAmount, advance_date: advanceDate,
                actual_start_at: c.actual_start_at, actual_end_at: c.actual_end_at, meals_provided: c.meals_provided, allowance_days: c.allowance_days,
                lodging_mode: c.lodging_mode, lodging_nights: c.lodging_nights, distance_km: c.distance_km, other_desc: c.other_desc,
                absent_user_ids: c.absent_user_ids, person_times: sql.json(c.person_times), kind: 'claim',
                over_reasons: sql.json(c.over_reasons), claimed: sql.json(c.claimed), claimed_total: c.claimed_total,
                approved: null, approved_total: null,
                status: submit ? 'hrd' : (cur?.status ?? 'draft'), ...(submit ? { submitted_at: new Date(), submitted_by: uid } : {}), updated_by: uid, updated_at: new Date(),
            };
            const [saved] = cur
                ? await sql`UPDATE hrd_travel_claims SET ${sql(row)} WHERE id = ${cur.id} RETURNING id, status`
                : await sql`INSERT INTO hrd_travel_claims ${sql({ ...row, request_id: r.id, created_by: uid })} RETURNING id, status`;
            await sql`DELETE FROM hrd_travel_claim_items WHERE claim_id = ${saved.id}`;
            if (c.items.length) await sql`INSERT INTO hrd_travel_claim_items ${sql(c.items.map(i => ({ ...i, claim_id: saved.id })))}`;
            // ผู้ที่ไม่ได้เดินทางจริง — ไม่นับในประวัติ/สถิติการไปราชการ
            await sql`UPDATE hrd_travel_request_travelers SET absent = (user_id = ANY(${c.absent_user_ids}::int[])) WHERE request_id = ${r.id}`;
            if (submit) await log(sql, saved.id, uid, await nameOf(sql, uid), 'submitted', r.requester_id !== uid ? 'HRD บันทึกเบิกแทนคณะ' : null, c.claimed_total);
            return { id: saved.id, status: saved.status, claimed_total: c.claimed_total, over: c.over, missing_reasons: c.missing_reasons };
        });
        return { success: true, data: out, message: submit ? 'ส่งเบิกแล้ว — รอ HRD ตรวจยอดและสิทธิ์' : 'บันทึกร่างแล้ว' };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdClaim] save:', e?.message);
        return fail(set, 500, 'บันทึกการเบิกไม่สำเร็จ');
    }
};

// ── POST /claims/:id/hrd — HRD ตรวจ: { action: pass|return, note, items: [{ id, approved_amount, hrd_note }] } ──
// pass: ยอดอนุมัติรายรายการ (ไม่ส่ง = เท่ายอดขอ) · ต่างจากยอดขอต้องมีเหตุผล · ส่งการเงิน
// return: ส่งกลับผู้เดินทางแก้ (ต้องมีเหตุผล)
export const hrdReviewClaim = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        if (!(await canManage(uid))) return fail(set, 403, 'ตรวจการเบิกได้เฉพาะผู้ดูแลระบบและเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล (HRD)');
        const action = body?.action;
        if (action !== 'pass' && action !== 'return') return fail(set, 400, 'เลือกผลการตรวจ (ส่งการเงิน / ส่งกลับแก้ไข)', 'action');
        const note = multiline(body?.note, 1000);
        if (action === 'return' && !note) return fail(set, 400, 'ระบุสิ่งที่ต้องแก้ไข', 'note');
        const out = await core_kon.begin(async (sql: any) => {
            const [c] = await sql`SELECT c.id, c.status, c.request_id, c.kind, c.submitted_by, r.requester_id, c.mode, c.advance_amount::float8 AS advance_amount,
                    EXISTS (SELECT 1 FROM hrd_travel_request_travelers t WHERE t.request_id = r.id AND t.user_id = ${uid}) AS is_traveler
                FROM hrd_travel_claims c JOIN hrd_travel_requests r ON r.id = c.request_id WHERE c.id = ${Number(params.id)} FOR UPDATE OF c`;
            if (!c) throw new Bad(404, 'ไม่พบการเบิก');
            if (c.status !== 'hrd') throw new Bad(409, c.status === 'returned' ? 'ส่งกลับให้ผู้เดินทางแก้ไขแล้ว — รอส่งใหม่' : 'การเบิกนี้ไม่ได้รอ HRD ตรวจ', 'NOT_PENDING');
            if (c.requester_id === uid || c.is_traveler) throw new Bad(403, 'ท่านเป็นผู้เดินทางในคำขอนี้ ตรวจการเบิกไม่ได้ — ให้เจ้าหน้าที่ HRD คนอื่นตรวจ');
            if (c.submitted_by === uid) throw new Bad(403, 'ท่านเป็นผู้บันทึกการเบิกนี้ ตรวจเองไม่ได้ — ให้เจ้าหน้าที่ HRD คนอื่นตรวจ');
            const name = await nameOf(sql, uid);
            if (action === 'return' && c.kind === 'refund') throw new Bad(400, 'รายการคืนเงินยืม (ยกเลิกการเดินทาง) ส่งกลับไม่ได้ — ตรวจแล้วส่งการเงิน', 'action');
            if (action === 'return') {
                await sql`UPDATE hrd_travel_claims SET status = 'returned', hrd_by = ${uid}, hrd_at = NOW(), updated_by = ${uid}, updated_at = NOW() WHERE id = ${c.id}`;
                await log(sql, c.id, uid, name, 'hrd_returned', note, null);
                return { status: 'returned', message: 'ส่งกลับให้ผู้เดินทางแก้ไขแล้ว' };
            }
            const items = await loadItems(sql, c.id);
            const given = new Map<number, any>((Array.isArray(body?.items) ? body.items : []).map((x: any) => [Number(x?.id), x]));
            for (const k of given.keys()) if (!items.some((i: any) => i.id === k)) throw new Bad(400, 'มีรายการที่ไม่อยู่ในการเบิกนี้', 'items');
            const next = items.map((i: any) => {
                const g = given.get(i.id);
                const amt = g && g.approved_amount !== undefined && g.approved_amount !== null && g.approved_amount !== '' ? money(g.approved_amount, `items.${i.id}.approved_amount`, `ยอดอนุมัติ (${i.label}) `) : i.claimed_amount;
                const hrdNote = oneLine(g?.hrd_note, 300);
                if (Math.abs(amt - i.claimed_amount) > 0.004 && !hrdNote) throw new Bad(400, `ปรับยอด "${i.label}" ต้องระบุเหตุผล`, `items.${i.id}.hrd_note`);
                return { ...i, approved_amount: amt, hrd_note: hrdNote };
            });
            for (const i of next) await sql`UPDATE hrd_travel_claim_items SET approved_amount = ${i.approved_amount}, hrd_note = ${i.hrd_note} WHERE id = ${i.id}`;
            const t = approvedTotals(next as { category: ItemCategory; approved_amount: number }[]);
            await sql`UPDATE hrd_travel_claims SET status = 'finance', finance_returned = FALSE, approved = ${sql.json(t.approved)}, approved_total = ${t.total},
                      hrd_by = ${uid}, hrd_at = NOW(), updated_by = ${uid}, updated_at = NOW() WHERE id = ${c.id}`;
            const adjusted = next.filter((i: any) => Math.abs(i.approved_amount - i.claimed_amount) > 0.004).length;
            await log(sql, c.id, uid, name, 'hrd_passed', note ?? (adjusted ? `ปรับยอด ${adjusted} รายการ` : null), t.total);
            return { status: 'finance', approved_total: t.total, message: `ส่งการเงินแล้ว ยอด ${t.total.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท${adjusted ? ` (ปรับ ${adjusted} รายการ)` : ''}` };
        });
        return { success: true, data: { id: Number(params.id), status: out.status, approved_total: (out as any).approved_total ?? null }, message: out.message };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdClaim] hrd:', e?.message);
        return fail(set, 500, 'บันทึกผลการตรวจไม่สำเร็จ');
    }
};

// ── POST /claims/:id/finance — การเงิน: { action: verify|return, note } — ไม่แก้ยอด ──
// verify: ยอดที่ HRD อนุมัติ = ยอดจริงของคำขอ (ตัดงบ) · ไม่มีส่วนต่างต้องคืน/จ่าย (ล้างเงินยืมพอดี) = ปิดเรื่องทันที
// return: ตีกลับ HRD ตรวจใหม่ (ต้องมีเหตุผล)
export const financeReviewClaim = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        if (!(await canFinance(uid))) return fail(set, 403, 'เฉพาะเจ้าหน้าที่การเงินตรวจการเบิก (HRD_FINANCE) หรือผู้ดูแลระบบ');
        const action = body?.action;
        if (action !== 'verify' && action !== 'return') return fail(set, 400, 'เลือกผลการตรวจ (ยืนยันยอด / ตีกลับ HRD)', 'action');
        const note = multiline(body?.note, 1000);
        if (action === 'return' && !note) return fail(set, 400, 'ระบุเหตุผลที่ตีกลับ', 'note');
        const out = await core_kon.begin(async (sql: any) => {
            const [c] = await sql`SELECT id, status, request_id, kind, mode, advance_amount::float8 AS advance_amount, approved_total::float8 AS approved_total FROM hrd_travel_claims WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!c) throw new Bad(404, 'ไม่พบการเบิก');
            if (c.status !== 'finance') throw new Bad(409, 'การเบิกนี้ไม่ได้รอการเงินตรวจ', 'NOT_PENDING');
            const name = await nameOf(sql, uid);
            if (action === 'return') {
                await sql`UPDATE hrd_travel_claims SET status = 'hrd', finance_returned = TRUE, finance_by = ${uid}, finance_at = NOW(), updated_by = ${uid}, updated_at = NOW() WHERE id = ${c.id}`;
                await log(sql, c.id, uid, name, 'finance_returned', note, null);
                return { status: 'hrd', message: 'ตีกลับให้ HRD ตรวจใหม่แล้ว' };
            }
            const total = Number(c.approved_total);
            const s = settlementOf(c.mode, c.advance_amount, total);
            const done = c.mode === 'advance' && s.refund === 0 && s.pay === 0;
            await sql`UPDATE hrd_travel_claims SET status = ${done ? 'closed' : 'verified'}, finance_by = ${uid}, finance_at = NOW(),
                      ${done ? sql`closed_by = ${uid}, closed_at = NOW(), settle_note = 'ล้างเงินยืมพอดี',` : sql``} updated_by = ${uid}, updated_at = NOW() WHERE id = ${c.id}`;
            // คืนเงินยืม (ยกเลิกการเดินทาง) — ไม่มีค่าใช้จ่าย ไม่ตัดงบ คำขอยกเลิกอยู่แล้ว
            if (c.kind === 'claim') await sql`UPDATE hrd_travel_requests SET actual_amount = ${total}, actual_note = ${'ยืนยันจากการเบิกจ่ายจริง'}, actual_by = ${uid}, actual_at = NOW(), updated_by = ${uid}, updated_at = NOW() WHERE id = ${c.request_id}`;
            await log(sql, c.id, uid, name, 'verified', note, total);
            if (done) await log(sql, c.id, uid, name, 'closed', 'ล้างเงินยืมพอดี ไม่มีส่วนต่าง', 0);
            return { status: done ? 'closed' : 'verified', settlement: s,
                message: done ? 'ยืนยันยอดแล้ว — ล้างเงินยืมพอดี ปิดเรื่อง' : s.refund > 0 ? `ยืนยันยอดแล้ว — ผู้ยืมต้องคืนเงิน ${s.refund.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท`
                    : `ยืนยันยอดแล้ว — การเงินจ่าย${c.mode === 'advance' ? 'เพิ่ม' : 'คืน'} ${s.pay.toLocaleString('en-US', { minimumFractionDigits: 2 })} บาท` };
        });
        return { success: true, data: { id: Number(params.id), status: out.status, settlement: (out as any).settlement ?? null }, message: out.message };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdClaim] finance:', e?.message);
        return fail(set, 500, 'บันทึกผลการตรวจไม่สำเร็จ');
    }
};

// ── POST /claims/:id/close — การเงินปิดเรื่องหลังคืนเงิน/จ่ายเงินแล้ว: { note } (เช่น เลขที่ใบเสร็จรับเงินคืน) ──
export const closeClaim = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        if (!(await canFinance(uid))) return fail(set, 403, 'เฉพาะเจ้าหน้าที่การเงินตรวจการเบิก (HRD_FINANCE) หรือผู้ดูแลระบบ');
        const note = oneLine(body?.note, 300);
        if (!note) return fail(set, 400, 'ระบุหลักฐานการคืนเงิน/จ่ายเงิน (เช่น เลขที่ใบเสร็จ)', 'note');
        await core_kon.begin(async (sql: any) => {
            const [c] = await sql`SELECT id, status FROM hrd_travel_claims WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!c) throw new Bad(404, 'ไม่พบการเบิก');
            if (c.status !== 'verified') throw new Bad(409, c.status === 'closed' ? 'ปิดเรื่องแล้ว' : 'ยังไม่ได้ยืนยันยอด', 'NOT_PENDING');
            await sql`UPDATE hrd_travel_claims SET status = 'closed', settle_note = ${note}, closed_by = ${uid}, closed_at = NOW(), updated_by = ${uid}, updated_at = NOW() WHERE id = ${c.id}`;
            await log(sql, c.id, uid, await nameOf(sql, uid), 'closed', note, null);
        });
        return { success: true, data: { id: Number(params.id), status: 'closed' }, message: 'ปิดเรื่องแล้ว' };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdClaim] close:', e?.message);
        return fail(set, 500, 'ปิดเรื่องไม่สำเร็จ');
    }
};

// ── GET /claims?queue= — คิวงาน HRD / การเงิน ──
// HRD (ADMIN/HRD): hrd · finance_returned · returned · overdue (ผอ. อนุมัติ กลับมาเกิน OVERDUE_DAYS วันแล้วยังไม่ส่งเบิก) · finance · verified · closed
// การเงิน: finance · verified · closed
const OVERDUE_DAYS = 15;
const QUEUES = ['hrd', 'finance_returned', 'returned', 'overdue', 'finance', 'verified', 'closed'] as const;
type Queue = (typeof QUEUES)[number];
const queueWhere = (s: any, q: Queue) =>
    q === 'hrd' ? s`(c.status = 'hrd' AND NOT c.finance_returned)`
        : q === 'finance_returned' ? s`(c.status = 'hrd' AND c.finance_returned)`
            : q === 'overdue' ? s`(c.id IS NULL OR c.status = 'draft')`
                : s`(c.status = ${q})`;
const BASE_FROM = (s: any, q: Queue) => q === 'overdue'
    ? s`FROM hrd_travel_requests r LEFT JOIN hrd_travel_claims c ON c.request_id = r.id
        WHERE r.status = 'submitted' AND r.approval_stage = 'approved' AND r.cost_mode <> 'no_claim' AND r.actual_amount IS NULL
          AND r.end_at < now() - make_interval(days => ${OVERDUE_DAYS}) AND ${queueWhere(s, q)}`
    : s`FROM hrd_travel_claims c JOIN hrd_travel_requests r ON r.id = c.request_id WHERE ${queueWhere(s, q)}`;
export const getClaims = async ({ query, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [manager, finance] = await Promise.all([canManage(uid), canFinance(uid)]);
        if (!manager && !finance) return fail(set, 403, 'เฉพาะเจ้าหน้าที่ HRD และการเงิน');
        const allowed: Queue[] = manager ? [...QUEUES] : ['finance', 'verified', 'closed'];
        const queue = (allowed as string[]).includes(query?.queue) ? query.queue as Queue : allowed[0];
        const limit = Math.min(Math.max(Number(query?.limit) || 50, 1), 200);
        const rows = await core_kon`
            SELECT r.id AS request_id, r.subject, r.location, r.start_at, r.end_at, r.requester_name, r.total_amount::float8 AS estimate_total,
                   (SELECT count(*)::int FROM hrd_travel_request_travelers t WHERE t.request_id = r.id) AS traveler_count,
                   c.id, c.kind, c.mode, c.status, c.finance_returned, c.claimed_total::float8 AS claimed_total, c.approved_total::float8 AS approved_total,
                   c.advance_amount::float8 AS advance_amount, c.submitted_at, c.hrd_at, c.finance_at, c.closed_at,
                   (SELECT count(*)::int FROM jsonb_object_keys(c.over_reasons)) AS over_count
            ${BASE_FROM(core_kon, queue)}
            ORDER BY ${queue === 'overdue' ? core_kon`r.end_at` : queue === 'closed' ? core_kon`c.closed_at DESC` : core_kon`COALESCE(c.hrd_at, c.submitted_at)`} NULLS LAST, r.id
            LIMIT ${limit}`;
        const counts: Record<string, number> = {};
        await Promise.all(allowed.map(async q => { counts[q] = (await core_kon`SELECT count(*)::int AS n ${BASE_FROM(core_kon, q)}`)[0].n; }));
        return { success: true, data: { queue, queues: allowed, counts, overdue_days: OVERDUE_DAYS,
            rows: rows.map((x: any) => ({ ...x, settlement: x.id && x.approved_total != null ? settlementOf(x.mode, x.advance_amount, x.approved_total) : null })), can_hrd: manager, can_finance: finance } };
    } catch (e: any) {
        console.error('[hrdClaim] list:', e?.message);
        return fail(set, 500, 'โหลดรายการเบิกไม่สำเร็จ');
    }
};

export { CLAIM_CATEGORIES };
