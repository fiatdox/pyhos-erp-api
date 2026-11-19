// เดินทางไปราชการ — รายงานผลการเดินทาง (เสนอผู้บริหารทราบ) · ตาราง src/db/hrd_travel_reports.sql
// เนื้อหาเป็น tiptap JSON — กรองเหลือเฉพาะโครงสร้างที่อนุญาต (ย่อหน้า รายการ ตัวหนา/เอียง/ขีดเส้นใต้ ขนาดตัวอักษร จัดแนว)
// ไม่เก็บ HTML: หน้าเว็บ/PDF วาดจาก JSON เอง จึงไม่มีช่องให้ฝังสคริปต์
// เขียน/แก้ = ผู้ขอ หรือ ADMIN/HRD ขณะคำขอยังไม่ยกเลิก/ไม่ถูกปฏิเสธ · ส่งรายงานได้เมื่อถึงวันออกเดินทางแล้ว
// ดู = ผู้ขอ/ผู้ร่วมเดินทาง · ADMIN/HRD · ผู้อำนวยการ (hr_settings) · หัวหน้าในสายของคำขอ (ทั้งลงนามในระบบและเดินเอกสาร) — ร่างเห็นเฉพาะผู้ขอและ ADMIN/HRD
import { core_kon } from '../db/db';
import { canManage } from './hrdTravelController';
import { REQUESTER_POS } from './hrdTravelRequestController';

const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, ...(field ? { field } : {}) }; };
class Bad extends Error { constructor(public status: number, message: string, public field?: string) { super(message); } }

export const REPORT_FONT_SIZES = ['12pt', '14pt', '16pt', '18pt', '20pt', '24pt'];
const ALIGNS = ['left', 'center', 'right', 'justify'];
const MAX_CHARS = 30_000, MAX_NODES = 5_000, MAX_DEPTH = 8;
const MEMO_NO_RE = /^[0-9๐-๙A-Za-zก-ฮ.\-/ ]+$/;

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[] };
const BLOCKS = new Set(['paragraph', 'bulletList', 'orderedList']);

/** กรอง tiptap JSON ให้เหลือเฉพาะชนิด/คุณสมบัติที่อนุญาต — ชนิดอื่นตอบ 400 (ไม่เดาให้) */
export const cleanDoc = (raw: unknown): { doc: Node; text: string } => {
    const ctx = { nodes: 0, chars: 0 };
    const bad = (m: string) => new Bad(400, m, 'content');
    const marksOf = (ms: unknown): Node['marks'] => {
        if (ms == null) return undefined;
        if (!Array.isArray(ms) || ms.length > 4) throw bad('รูปแบบตัวอักษรไม่ถูกต้อง');
        const out: NonNullable<Node['marks']> = [];
        for (const m of ms as any[]) {
            if (m?.type === 'bold' || m?.type === 'italic' || m?.type === 'underline') out.push({ type: m.type });
            else if (m?.type === 'textStyle') {
                const fs = m.attrs?.fontSize;
                if (fs == null) continue;
                if (!REPORT_FONT_SIZES.includes(String(fs))) throw bad(`ขนาดตัวอักษร ${String(fs).slice(0, 10)} ไม่รองรับ`);
                out.push({ type: 'textStyle', attrs: { fontSize: String(fs) } });
            } else throw bad('รูปแบบตัวอักษรไม่รองรับ');
        }
        return out.length ? out : undefined;
    };
    const inline = (n: any): Node => {
        if (++ctx.nodes > MAX_NODES) throw bad('เนื้อหายาวเกินไป');
        if (n?.type === 'hardBreak') return { type: 'hardBreak' };
        if (n?.type !== 'text' || typeof n.text !== 'string' || !n.text) throw bad('เนื้อหาไม่ถูกต้อง');
        ctx.chars += n.text.length;
        if (ctx.chars > MAX_CHARS) throw bad(`เนื้อหายาวเกิน ${MAX_CHARS.toLocaleString('en-US')} ตัวอักษร`);
        const marks = marksOf(n.marks);
        return { type: 'text', text: n.text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''), ...(marks ? { marks } : {}) };
    };
    const block = (n: any, depth: number): Node => {
        if (++ctx.nodes > MAX_NODES || depth > MAX_DEPTH) throw bad('เนื้อหาซ้อนกันลึกเกินไป');
        if (n?.type === 'paragraph') {
            const align = n.attrs?.textAlign;
            const content = Array.isArray(n.content) ? n.content.map(inline) : [];
            return { type: 'paragraph', ...(ALIGNS.includes(align) && align !== 'left' ? { attrs: { textAlign: align } } : {}), ...(content.length ? { content } : {}) };
        }
        if (n?.type === 'bulletList' || n?.type === 'orderedList') {
            const items = Array.isArray(n.content) ? n.content : [];
            if (!items.length) throw bad('รายการว่าง');
            const start = Number(n.attrs?.start);
            return {
                type: n.type, ...(n.type === 'orderedList' && Number.isInteger(start) && start > 1 && start < 1000 ? { attrs: { start } } : {}),
                content: items.map((li: any) => {
                    if (li?.type !== 'listItem' || !Array.isArray(li.content) || !li.content.length) throw bad('รายการไม่ถูกต้อง');
                    if (++ctx.nodes > MAX_NODES) throw bad('เนื้อหายาวเกินไป');
                    return { type: 'listItem', content: li.content.map((c: any) => block(c, depth + 1)) };
                }),
            };
        }
        throw bad(BLOCKS.has(n?.type) ? 'เนื้อหาไม่ถูกต้อง' : `ไม่รองรับรูปแบบ ${String(n?.type ?? '').slice(0, 20)}`);
    };
    const r = raw as any;
    if (r?.type !== 'doc' || !Array.isArray(r.content)) throw bad('เนื้อหาไม่ถูกต้อง');
    const doc: Node = { type: 'doc', content: r.content.map((c: any) => block(c, 1)) };
    // ข้อความล้วน: ย่อหน้าละบรรทัด
    const lines: string[] = [];
    const walk = (n: Node) => {
        if (n.type === 'paragraph') lines.push((n.content ?? []).map(c => c.type === 'text' ? c.text : '\n').join(''));
        else n.content?.forEach(walk);
    };
    walk(doc);
    return { doc, text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
};

/** ผู้อำนวยการ (รักษาการก่อนถ้ามี) — พิมพ์ช่องลงนามรับทราบ */
const directorOf = async () => {
    const rows = await core_kon`SELECT s.name AS k, CONCAT(u.pname, u.fname, ' ', u.lname) AS name FROM hr_settings s JOIN users u ON u.id = NULLIF(s.value, '')::int
        WHERE s.name IN ('director_id', 'acting_director_id') AND s.value ~ '^[0-9]+$'`;
    const acting = rows.find((x: any) => x.k === 'acting_director_id'), dir = rows.find((x: any) => x.k === 'director_id');
    return acting ? { name: acting.name, is_acting: true } : dir ? { name: dir.name, is_acting: false } : null;
};
const directorIds = async () => (await core_kon`SELECT value FROM hr_settings WHERE name IN ('director_id', 'acting_director_id') AND value <> ''`).map((d: any) => Number(d.value));
/** ผู้มีสิทธิ์เห็นรายงานที่ส่งแล้วทุกฉบับ: ADMIN/HRD · ผู้อำนวยการ/รักษาการ */
const seesAll = async (uid: number) => (await canManage(uid)) || (await directorIds()).includes(uid);
/** คำขอที่ผู้ใช้เกี่ยวข้อง (alias r): ผู้ขอ ผู้ร่วมเดินทาง หัวหน้าในสาย (ทุกโหมดการลงนาม) */
const relatedIn = (s: any, uid: number) => s`(r.requester_id = ${uid}
    OR r.id = ANY (ARRAY(SELECT t.request_id FROM hrd_travel_request_travelers t WHERE t.user_id = ${uid}))
    OR r.approval_chain @> ${s.json([{ approver_id: uid }])})`;

const REPORT_COLS = (s: any) => s`p.id, p.request_id, p.memo_no, p.content, p.status, p.submitted_at, p.created_at, p.updated_at,
    CONCAT(u.pname, u.fname, ' ', u.lname) AS updated_by_name`;

// GET /requests/:id/report
export const getReport = async ({ params, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        // ข้อมูลคำขอที่ใช้พิมพ์บันทึกข้อความรายงาน — ส่งมาพร้อมกัน (ผู้บริหารในสายเดินเอกสาร/ผอ. เปิดหน้าคำขอเองไม่ได้)
        const [r] = await core_kon`SELECT r.id, r.requester_id, r.requester_name, r.requester_unit, r.status, r.start_at, r.end_at, r.purpose, r.subject, r.location,
                r.cost_mode, r.trip_dates::text[] AS trip_dates, r.approval_chain, r.sign_mode,
                ${REQUESTER_POS(core_kon)} AS requester_position
            FROM hrd_travel_requests r
            WHERE r.id = ${Number(params.id)}`;
        if (!r) return fail(set, 404, 'ไม่พบคำขอ');
        const [manager, all, [related]] = await Promise.all([
            canManage(uid), seesAll(uid),
            core_kon`SELECT 1 AS ok FROM hrd_travel_requests r WHERE r.id = ${r.id} AND ${relatedIn(core_kon, uid)}`,
        ]);
        if (!all && !related) return fail(set, 404, 'ไม่พบรายงาน');
        const [p] = await core_kon`SELECT ${REPORT_COLS(core_kon)} FROM hrd_travel_reports p LEFT JOIN users u ON u.id = p.updated_by WHERE p.request_id = ${r.id}`;
        const owner = r.requester_id === uid || manager;
        const [travelers, director] = await Promise.all([
            core_kon`SELECT name, position, is_requester FROM hrd_travel_request_travelers WHERE request_id = ${r.id} ORDER BY sort_order, id`,
            directorOf(),
        ]);
        const chain = (Array.isArray(r.approval_chain) ? r.approval_chain : []).map((x: any) => ({ step: Number(x.step), level_name: x.level_name ?? null, approver_name: x.approver_name ?? null, is_acting: !!x.is_acting }));
        // ร่างเห็นเฉพาะผู้ขอและ ADMIN/HRD
        const report = p && (p.status === 'submitted' || owner) ? p : null;
        return {
            success: true,
            data: {
                request: {
                    id: r.id, requester_name: r.requester_name, requester_position: r.requester_position, requester_unit: r.requester_unit,
                    purpose: r.purpose, subject: r.subject, location: r.location, start_at: r.start_at, end_at: r.end_at,
                    cost_mode: r.cost_mode, trip_dates: r.trip_dates, travelers, chain, director,
                },
                report,
                can_edit: owner && r.status === 'submitted',
                can_submit: owner && r.status === 'submitted' && new Date(r.start_at).getTime() <= Date.now(),
            },
        };
    } catch (e: any) {
        console.error('[hrdReport] get:', e?.message);
        return fail(set, 500, 'โหลดรายงานไม่สำเร็จ');
    }
};

// PUT /requests/:id/report — body { memo_no?, content, submit? }
export const saveReport = async ({ params, body, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const { doc, text } = cleanDoc(body?.content);
        const memo = body?.memo_no == null ? null : String(body.memo_no).trim().replace(/\s+/g, ' ') || null;
        if (memo && (memo.length > 30 || !MEMO_NO_RE.test(memo))) throw new Bad(400, 'เลขที่บันทึกข้อความใช้ได้เฉพาะตัวเลข ตัวอักษร - / และ . ไม่เกิน 30 ตัว', 'memo_no');
        const submit = body?.submit === true;
        if (submit && text.length < 10) throw new Bad(400, 'กรุณาเขียนรายงานผลการเดินทาง', 'content');
        const manager = await canManage(uid);
        const out = await core_kon.begin(async (sql: any) => {
            const [r] = await sql`SELECT id, requester_id, status, start_at FROM hrd_travel_requests WHERE id = ${Number(params.id)} FOR UPDATE`;
            if (!r) throw new Bad(404, 'ไม่พบคำขอ');
            if (r.requester_id !== uid && !manager) throw new Bad(403, 'เขียนรายงานได้เฉพาะผู้ขอ หรือเจ้าหน้าที่งานพัฒนาทรัพยากรบุคคล');
            if (r.status !== 'submitted') throw new Bad(409, 'คำขอนี้ยกเลิกหรือไม่อนุมัติแล้ว เขียนรายงานไม่ได้');
            if (submit && new Date(r.start_at).getTime() > Date.now()) throw new Bad(409, 'ส่งรายงานได้เมื่อถึงวันเดินทางแล้ว (บันทึกร่างไว้ก่อนได้)');
            const [cur] = await sql`SELECT id, status FROM hrd_travel_reports WHERE request_id = ${r.id} FOR UPDATE`;
            // ส่งแล้วยังแก้ได้ (พิมพ์ใหม่) แต่ไม่ย้อนกลับเป็นร่าง
            const status = cur?.status === 'submitted' || submit ? 'submitted' : 'draft';
            if (!cur) {
                const [row] = await sql`INSERT INTO hrd_travel_reports (request_id, memo_no, content, plain_text, status, submitted_at, created_by, updated_by)
                    VALUES (${r.id}, ${memo}, ${sql.json(doc)}, ${text}, ${status}, ${status === 'submitted' ? new Date() : null}, ${uid}, ${uid}) RETURNING id, status`;
                return row;
            }
            const [row] = await sql`UPDATE hrd_travel_reports SET memo_no = ${memo}, content = ${sql.json(doc)}, plain_text = ${text}, status = ${status},
                    submitted_at = COALESCE(submitted_at, ${status === 'submitted' ? new Date() : null}), updated_by = ${uid}, updated_at = NOW()
                WHERE id = ${cur.id} RETURNING id, status`;
            return row;
        });
        return { success: true, data: out };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdReport] save:', e?.message);
        return fail(set, 500, 'บันทึกรายงานไม่สำเร็จ');
    }
};

// GET /reports?fiscal_year=&search=&status=&limit=&offset= — รายงานที่ผู้ใช้เห็นได้ (ผู้บริหารดูภาพรวม)
export const getReports = async ({ query, user, set }: any) => {
    try {
        const uid = Number(user?.id);
        const [all, manager] = await Promise.all([seesAll(uid), canManage(uid)]);
        const fy = Number(query?.fiscal_year);
        const range = Number.isInteger(fy) && fy > 2500 && fy < 2700 ? { from: new Date(`${fy - 544}-10-01T00:00:00+07:00`), to: new Date(`${fy - 543}-10-01T00:00:00+07:00`) } : null;
        const search = String(query?.search ?? '').trim().slice(0, 100);
        const like = `%${search.replace(/[\\%_]/g, c => `\\${c}`)}%`;
        const limit = Math.min(Math.max(Number(query?.limit) || 50, 1), 200), offset = Math.max(Number(query?.offset) || 0, 0);
        // ร่าง: เห็นเฉพาะของตัวเอง (ADMIN/HRD เห็นทุกร่าง)
        const statusOk = manager ? core_kon`TRUE` : core_kon`(p.status = 'submitted' OR r.requester_id = ${uid})`;
        const where = core_kon`${all ? core_kon`TRUE` : relatedIn(core_kon, uid)} AND ${statusOk} AND r.status = 'submitted'
            ${range ? core_kon`AND r.start_at >= ${range.from} AND r.start_at < ${range.to}` : core_kon``}
            ${query?.status === 'draft' || query?.status === 'submitted' ? core_kon`AND p.status = ${query.status}` : core_kon``}
            ${search ? core_kon`AND (r.subject ILIKE ${like} OR r.location ILIKE ${like} OR r.requester_name ILIKE ${like} OR p.plain_text ILIKE ${like})` : core_kon``}`;
        const [rows, [{ n }]] = await Promise.all([
            core_kon`SELECT p.id, p.request_id, p.memo_no, p.status, p.submitted_at, p.updated_at, left(p.plain_text, 240) AS preview,
                       r.subject, r.purpose, r.location, r.start_at, r.end_at, r.cost_mode, r.trip_dates::text[] AS trip_dates,
                       r.requester_name, r.requester_unit, (SELECT count(*)::int FROM hrd_travel_request_travelers t WHERE t.request_id = r.id) AS traveler_count
                     FROM hrd_travel_reports p JOIN hrd_travel_requests r ON r.id = p.request_id
                     WHERE ${where} ORDER BY COALESCE(p.submitted_at, p.updated_at) DESC, p.id DESC LIMIT ${limit} OFFSET ${offset}`,
            core_kon`SELECT count(*)::int AS n FROM hrd_travel_reports p JOIN hrd_travel_requests r ON r.id = p.request_id WHERE ${where}`,
        ]);
        return { success: true, data: { rows, total: n, sees_all: all } };
    } catch (e: any) {
        console.error('[hrdReport] list:', e?.message);
        return fail(set, 500, 'โหลดรายการรายงานไม่สำเร็จ');
    }
};
