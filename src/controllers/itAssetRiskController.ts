import { core_kon } from '../db/db';

// ── ประเมินความเสี่ยงทรัพย์สินงาน IT ─────────────────────────────────────────
// ตาราง it_asset_risk_assessments (src/db/it_asset_risk.sql) เพิ่มแถวทุกครั้ง — ผลปัจจุบัน = แถวล่าสุดของ asset_key
// ค่าเสนอของระบบ (โอกาส/ผลกระทบ) คำนวณที่หน้าเว็บจากข้อมูลครุภัณฑ์ แล้วส่งมาเก็บเป็น suggested_* ไว้ตรวจย้อน
// ผู้ประเมิน = ผู้ใช้จาก token เท่านั้น

export const THREAT_KEYS = ['hw_failure', 'power', 'malware', 'unauthorized', 'theft', 'disaster', 'eol_software', 'data_loss', 'network_outage'] as const;
const TREATMENTS = ['accept', 'mitigate', 'replace', 'transfer', 'avoid'] as const;
const KEY_RE = /^(v3|v2):.{1,60}$/;

class Bad extends Error { constructor(public status: number, msg: string, public field?: string) { super(msg); } }
const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, field }; };

const COLS = core_kon`
    a.id, a.asset_key, a.source, a.noid, a.asset_name, a.asset_kind, a.department, a.likelihood, a.impact, a.score,
    a.suggested_likelihood, a.suggested_impact, a.threats, a.controls, a.treatment, a.treatment_plan, a.owner_name,
    to_char(a.due_date, 'YYYY-MM-DD') AS due_date, to_char(a.next_review, 'YYYY-MM-DD') AS next_review, a.notes,
    a.assessed_at, CONCAT(u.pname, u.fname, ' ', u.lname) AS assessed_by_name`;

// ผลปัจจุบันของทุกครุภัณฑ์ที่เคยประเมิน + จำนวนครั้งที่ประเมิน
export const getCurrentAssetRisks = async ({ set }: any) => {
    try {
        const rows = await core_kon`
            SELECT DISTINCT ON (a.asset_key) ${COLS}, count(*) OVER (PARTITION BY a.asset_key)::int AS times
            FROM it_asset_risk_assessments a LEFT JOIN users u ON u.id = a.assessed_by
            ORDER BY a.asset_key, a.assessed_at DESC, a.id DESC`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[ItAssetRisk] list:', e?.message);
        return fail(set, 500, 'โหลดผลประเมินความเสี่ยงไม่สำเร็จ');
    }
};

// ประวัติการประเมินของครุภัณฑ์หนึ่งรายการ (ใหม่ → เก่า)
export const getAssetRiskHistory = async ({ query, set }: any) => {
    const key = String(query?.asset_key ?? '');
    if (!KEY_RE.test(key)) return fail(set, 400, 'asset_key ไม่ถูกต้อง');
    try {
        const rows = await core_kon`
            SELECT ${COLS} FROM it_asset_risk_assessments a LEFT JOIN users u ON u.id = a.assessed_by
            WHERE a.asset_key = ${key} ORDER BY a.assessed_at DESC, a.id DESC LIMIT 50`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[ItAssetRisk] history:', e?.message);
        return fail(set, 500, 'โหลดประวัติการประเมินไม่สำเร็จ');
    }
};

const lvl = (v: unknown, field: string, required = true) => {
    if (!required && (v === null || v === undefined || v === '')) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new Bad(400, 'ระดับต้องเป็นจำนวนเต็ม 1–5', field);
    return n;
};
const txt = (v: unknown, max: number, field: string) => {
    const s = String(v ?? '').trim();
    if (s.length > max) throw new Bad(400, `ข้อความยาวเกิน ${max} ตัวอักษร`, field);
    return s || null;
};
const day = (v: unknown, field: string) => {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new Bad(400, 'วันที่ไม่ถูกต้อง', field);
    return s;
};

export const createAssetRisk = async ({ body, user, set }: any) => {
    try {
        const key = String(body?.asset_key ?? '');
        if (!KEY_RE.test(key)) throw new Bad(400, 'ไม่พบครุภัณฑ์ที่จะประเมิน', 'asset_key');
        const [source, ...rest] = key.split(':');
        const noid = rest.join(':');
        const threats = Array.isArray(body?.threats) ? [...new Set(body.threats.map(String))] : [];
        if (threats.some(t => !(THREAT_KEYS as readonly string[]).includes(t as string))) throw new Bad(400, 'ภัยคุกคามไม่ถูกต้อง', 'threats');
        const treatment = String(body?.treatment ?? '');
        if (!(TREATMENTS as readonly string[]).includes(treatment)) throw new Bad(400, 'กรุณาเลือกแนวทางจัดการความเสี่ยง', 'treatment');
        const row = {
            asset_key: key, source, noid,
            asset_name: txt(body?.asset_name, 255, 'asset_name'), asset_kind: txt(body?.asset_kind, 20, 'asset_kind'), department: txt(body?.department, 255, 'department'),
            likelihood: lvl(body?.likelihood, 'likelihood'), impact: lvl(body?.impact, 'impact'),
            suggested_likelihood: lvl(body?.suggested_likelihood, 'suggested_likelihood', false), suggested_impact: lvl(body?.suggested_impact, 'suggested_impact', false),
            threats, controls: txt(body?.controls, 2000, 'controls'), treatment, treatment_plan: txt(body?.treatment_plan, 2000, 'treatment_plan'),
            owner_name: txt(body?.owner_name, 150, 'owner_name'), due_date: day(body?.due_date, 'due_date'), next_review: day(body?.next_review, 'next_review'),
            notes: txt(body?.notes, 2000, 'notes'), assessed_by: Number(user.id),
        };
        // ความเสี่ยงสูงมาก (15–25) ยอมรับไม่ได้ · ความเสี่ยงที่ไม่ยอมรับต้องมีแผนจัดการ
        if (treatment === 'accept' && row.likelihood! * row.impact! >= 15) throw new Bad(400, 'ความเสี่ยงสูงมากยอมรับไม่ได้ ต้องเลือกแนวทางจัดการ', 'treatment');
        if (treatment !== 'accept' && !row.treatment_plan) throw new Bad(400, 'กรุณาระบุแผนการจัดการความเสี่ยง', 'treatment_plan');
        const [saved] = await core_kon`INSERT INTO it_asset_risk_assessments ${core_kon(row as any)} RETURNING id, score`;
        return { success: true, data: saved };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[ItAssetRisk] create:', e?.message);
        return fail(set, 500, 'บันทึกผลประเมินไม่สำเร็จ');
    }
};
