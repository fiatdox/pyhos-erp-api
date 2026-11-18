import { core_kon } from '../db/db';
import { loadItAssets } from './itAssetController';

// ── Dashboard ผู้บริหาร: ทะเบียนความเสี่ยง + ทะเบียนทรัพย์สินงาน IT (อ่านอย่างเดียว · ส่งเฉพาะตัวเลขสรุป) ──
// สิทธิ์: ADMIN · หัวหน้ากลุ่มภารกิจดิจิทัล (CHIEF_MISSION_IT) · หัวหน้ากลุ่มงาน IT (CHIEF_GROUP_IT) · เจ้าหน้าที่ IT (IT_STAFF) · ผอ./รักษาการ ผอ. (hr_settings director_id / acting_director_id — ไม่ใช่ role)
// เกณฑ์ระดับ — ทะเบียนความเสี่ยง (ตามแบบฟอร์ม): 12.5 วิกฤติ · 9.5 สูง · 3.5 ปานกลาง · ต่ำกว่านั้นต่ำ
//              ประเมินความเสี่ยงทรัพย์สิน: 15 สูงมาก · 9 สูง · 4 ปานกลาง · ต่ำกว่านั้นต่ำ (ตรงกับ assetShared.ts ฝั่งหน้าเว็บ)

const EXEC_ROLES = ['ADMIN', 'CHIEF_MISSION_IT', 'CHIEF_GROUP_IT', 'IT_STAFF'];

export const canViewExecutive = async (uid: number) => {
    const [r] = await core_kon`
        SELECT EXISTS (SELECT 1 FROM user_m_users_roles mu JOIN user_roles r ON r.id = mu.role_id
                       WHERE mu.user_id = ${uid} AND UPPER(r.role_name) = ANY(${EXEC_ROLES})) AS by_role,
               EXISTS (SELECT 1 FROM hr_settings WHERE name IN ('director_id', 'acting_director_id') AND value = ${String(uid)}) AS director`;
    return !!(r?.by_role || r?.director);
};

const rrLevel = (s: number) => s >= 12.5 ? 'critical' : s >= 9.5 ? 'high' : s >= 3.5 ? 'medium' : 'low';
const arLevel = (s: number) => s >= 15 ? 'very_high' : s >= 9 ? 'high' : s >= 4 ? 'medium' : 'low';
const avg = (xs: number[]) => xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 10) / 10 : null;
const count = <T>(xs: T[], key: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { const k = key(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// รอบ 'YYYY-H' (ปีงบ พ.ศ.) → วันสิ้นรอบ: ครั้งที่ 1 = 31 มี.ค. · ครั้งที่ 2 = 30 ก.ย.
const periodEnd = (p: string) => `${Number(p.slice(0, 4)) - 543}-${p.endsWith('-1') ? '03-31' : '09-30'}`;

// ค่าที่ระบบเสนอสำหรับครุภัณฑ์ที่ยังไม่ประเมิน — สูตรเดียวกับ suggestRisk ใน app/information-technology/assets/assetShared.ts (แก้ต้องแก้คู่กัน)
const KIND_IMPACT: Record<string, number> = { server: 5, network: 5, ups: 3, computer: 3, notebook: 3, all_in_one: 3, cctv: 3, printer: 2, scanner: 2, monitor: 2, tablet: 2, other: 1 };
const CRITICAL_DEPT = /ฉุกเฉิน|อุบัติเหตุ|ICU|ไอซียู|วิกฤต|ผ่าตัด|ห้องคลอด|ไตเทียม|สารสนเทศ|คอมพิวเตอร์|ศูนย์ข้อมูล/i;
const suggestScore = (a: any, age: number | null) => {
    let l = 1;
    if (age != null && a.life_years) { if (age >= a.life_years) l++; if (age >= a.life_years * 2) l++; }
    if (a.repairs >= 1) l++;
    if (a.repairs >= 3 || a.status_group === 'repair') l++;
    let i = KIND_IMPACT[a.kind] ?? 1;
    if (a.department && CRITICAL_DEPT.test(a.department)) i++;
    return Math.min(5, l) * Math.min(5, i);
};

const assetSummary = (assets: any[], risks: any[], today: string) => {
    const now = Date.now();
    const age = (a: any) => { if (!a.receive) return null; const t = Date.parse(a.receive); return Number.isNaN(t) ? null : (now - t) / (365.25 * 864e5); };
    const ageState = (a: any) => { const y = age(a); if (y == null || !a.life_years) return 'unknown'; return y >= a.life_years ? 'expired' : a.life_years - y <= 1 ? 'soon' : 'ok'; };
    const held = assets.filter(a => a.status_group !== 'disposed').map(a => ({ ...a, age_state: ageState(a) }));
    const value = (xs: any[]) => Math.round(xs.reduce((n, a) => n + (a.price ?? 0), 0));

    const kinds = [...new Set(held.map(a => a.kind))].map(kind => {
        const xs = held.filter(a => a.kind === kind);
        return { kind, held: xs.length, in_use: xs.filter(a => a.status_group === 'in_use').length, repair: xs.filter(a => a.status_group === 'repair').length,
            expired: xs.filter(a => a.age_state === 'expired').length, soon: xs.filter(a => a.age_state === 'soon').length, value: value(xs) };
    }).sort((a, b) => b.held - a.held);

    // ปีงบประมาณที่ได้รับ (พ.ศ.) จากวันที่ได้รับ — ย้อนหลัง 10 ปีงบ
    const fyOf = (d: string) => { const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)); return (m >= 10 ? y + 1 : y) + 543; };
    const curFy = fyOf(today);
    const byFy = Array.from({ length: 10 }, (_, k) => curFy - 9 + k).map(fy => {
        const xs = held.filter(a => a.receive && fyOf(a.receive) === fy);
        return { fy, count: xs.length, value: value(xs) };
    });

    const depts = Object.entries(count(held, a => a.department ?? 'ไม่ระบุหน่วยงาน'))
        .sort((a, b) => b[1] - a[1]).slice(0, 10)
        .map(([department, n]) => ({ department, held: n, expired: held.filter(a => (a.department ?? 'ไม่ระบุหน่วยงาน') === department && a.age_state === 'expired').length }));

    // ผลประเมินความเสี่ยงล่าสุดของครุภัณฑ์ที่ยังถือครอง
    const heldKeys = new Map(held.map(a => [a.key, a]));
    const cur = risks.filter(r => heldKeys.has(r.asset_key));
    const top = cur.filter(r => r.score >= 9).sort((a, b) => b.score - a.score || String(a.noid).localeCompare(String(b.noid))).slice(0, 10)
        .map(r => ({ noid: r.noid, name: r.asset_name, kind: heldKeys.get(r.asset_key)?.kind ?? r.asset_kind, department: r.department, score: r.score, level: arLevel(r.score),
            treatment: r.treatment, due_date: r.due_date, overdue: !!r.due_date && r.due_date < today && r.treatment !== 'accept' }));

    // ภาพรวมทุกเครื่องที่ถือครอง: ใช้ผลประเมินจริงถ้ามี ไม่งั้นใช้ค่าที่ระบบเสนอ
    const riskByKey = new Map(cur.map(r => [r.asset_key, r]));
    const overall = held.map(a => { const r: any = riskByKey.get(a.key); return { kind: a.kind, assessed: !!r, level: arLevel(r ? r.score : suggestScore(a, age(a))) }; });
    const lvZero = { very_high: 0, high: 0, medium: 0, low: 0 };
    const overallKinds = kinds.map(k => ({ kind: k.kind, levels: { ...lvZero, ...count(overall.filter(o => o.kind === k.kind), o => o.level) } }));

    return {
        totals: {
            held: held.length, value: value(held), disposed: assets.length - held.length,
            in_use: held.filter(a => a.status_group === 'in_use').length, repair: held.filter(a => a.status_group === 'repair').length,
            pending: held.filter(a => a.status_group === 'pending').length,
            expired: held.filter(a => a.age_state === 'expired').length, soon: held.filter(a => a.age_state === 'soon').length,
            unknown_age: held.filter(a => a.age_state === 'unknown').length,
            open_repairs: held.reduce((n, a) => n + (a.open_repairs ?? 0), 0), frequent_repairs: held.filter(a => a.repairs >= 3).length,
        },
        kinds, by_fy: byFy, departments: depts,
        risk: {
            overall: { ...lvZero, ...count(overall, o => o.level) },
            overall_suggested: { ...lvZero, ...count(overall.filter(o => !o.assessed), o => o.level) },
            overall_kinds: overallKinds,
            assessed: cur.length, levels: { very_high: 0, high: 0, medium: 0, low: 0, ...count(cur, r => arLevel(r.score)) },
            treatments: count(cur, r => r.treatment),
            overdue: cur.filter(r => r.due_date && r.due_date < today && r.treatment !== 'accept').length,
            review_due: cur.filter(r => r.next_review && r.next_review < today).length,
            top,
        },
    };
};

const registerSummary = (regs: any[], items: any[], today: string) => {
    const rounds = regs.map(r => {
        const xs = items.filter(i => i.register_id === r.id);
        const ref = periodEnd(r.period) < today ? periodEnd(r.period) : today;
        return {
            id: r.id, period: r.period, items: xs.length, open: xs.filter(i => i.status === 'open').length, closed: xs.filter(i => i.status === 'closed').length,
            avg_score: avg(xs.map(i => i.score)), avg_residual: avg(xs.filter(i => i.residual_score != null).map(i => i.residual_score)),
            avg_progress: avg(xs.map(i => i.progress_pct)),
            levels: { critical: 0, high: 0, medium: 0, low: 0, ...count(xs, i => rrLevel(i.score)) },
            overdue: xs.filter(i => i.status === 'open' && i.due_date && i.due_date < ref && i.progress_pct < 100).length,
        };
    });
    const last = regs[regs.length - 1];
    if (!last) return { rounds, latest: null };
    const xs = items.filter(i => i.register_id === last.id);
    const cells = (pick: (i: any) => [number | null, number | null]) => Object.entries(count(xs.filter(i => pick(i)[0] && pick(i)[1]), i => pick(i).join('-')))
        .map(([k, n]) => { const [l, m] = k.split('-').map(Number); return { likelihood: l, impact: m, n }; });
    return {
        rounds,
        latest: {
            period: last.period, recorder_name: last.recorder_name, meeting_date: last.meeting_date,
            matrix: cells(i => [i.likelihood, i.impact]), residual_matrix: cells(i => [i.residual_likelihood, i.residual_impact]),
            treatments: count(xs, i => i.treatment), categories: count(xs, i => i.category),
            top: xs.filter(i => i.score >= 9.5).sort((a, b) => b.score - a.score || a.id - b.id).map(i => ({
                id: i.id, threat: i.threat, asset_group: i.asset_group, category: i.category, score: i.score, level: rrLevel(i.score), residual_score: i.residual_score,
                owner: i.owner, treatment: i.treatment, progress_pct: i.progress_pct, due_date: i.due_date, status: i.status,
                overdue: i.status === 'open' && !!i.due_date && i.due_date < today && i.progress_pct < 100,
            })),
        },
    };
};

export const getExecutiveDashboard = async ({ set }: any) => {
    const today = ymd(new Date());
    try {
        const [regs, items, risks] = await Promise.all([
            core_kon`SELECT id, period, recorder_name, to_char(meeting_date, 'YYYY-MM-DD') AS meeting_date FROM it_risk_registers ORDER BY period`,
            core_kon`SELECT id, register_id, category, asset_group, threat, likelihood, impact, score, owner, treatment, progress_pct,
                            to_char(due_date, 'YYYY-MM-DD') AS due_date, residual_likelihood, residual_impact, residual_score, status
                     FROM it_risk_register_items`,
            core_kon`SELECT DISTINCT ON (asset_key) asset_key, noid, asset_name, asset_kind, department, score, treatment,
                            to_char(due_date, 'YYYY-MM-DD') AS due_date, to_char(next_review, 'YYYY-MM-DD') AS next_review
                     FROM it_asset_risk_assessments ORDER BY asset_key, assessed_at DESC, id DESC`,
        ]);
        // ทะเบียนครุภัณฑ์อยู่คนละฐาน (MySQL) — ถ้าล่ม ยังแสดงส่วนทะเบียนความเสี่ยงได้
        let assets: ReturnType<typeof assetSummary> | null = null, assetError: string | null = null;
        try { assets = assetSummary(await loadItAssets(), risks as any[], today); }
        catch (e: any) { console.error('[ItExecutive] assets:', e?.message); assetError = 'ดึงข้อมูลทะเบียนครุภัณฑ์ไม่สำเร็จ'; }
        return { success: true, data: { as_of: new Date().toISOString(), today, risk_register: registerSummary(regs as any[], items as any[], today), assets, asset_error: assetError } };
    } catch (e: any) {
        console.error('[ItExecutive] dashboard:', e?.message);
        set.status = 500;
        return { success: false, message: 'โหลด Dashboard ไม่สำเร็จ' };
    }
};
