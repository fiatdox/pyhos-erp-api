import { core_kon, equipmentPool, equipmentV2Pool } from '../db/db';

// ── ทะเบียนทรัพย์สินงาน IT (IT Asset Register) ─────────────────────────────
// ดึงครุภัณฑ์หมวด "ครุภัณฑ์คอมพิวเตอร์" จากทะเบียนครุภัณฑ์ทั้งสองระบบ (อ่านอย่างเดียว)
//   v3 = ทะเบียนปัจจุบัน (EQUIPMENT_*)    หมวด assetcatid 6 · สถานะ 1 ส่งซ่อม 2 ขายทอดตลาด 4 อยู่ในหน่วยงาน 6 แจ้งชำรุด 8 รอจำหน่าย
//   v2 = ทะเบียนเดิม  (EQUIPMENT_V2_*) หมวด assetcatid 9 · สถานะ 1 ส่งซ่อม 2 ขายทอดตลาด 4 อยู่ในหน่วยงาน W กำลังดำเนินการ · trans='Y' = ตัดออกแล้ว
// ตรวจกับฐานจริงแล้ว: ครุภัณฑ์คอมพิวเตอร์สองทะเบียนไม่ซ้ำกัน (onidv3 ของรายการที่ยังถือครองว่างทั้งหมด) จึงรวมกันได้ตรง ๆ
// หมวดหาจากชื่อหมวด ไม่เขียนรหัสตายตัว เพราะรหัสหมวดสองทะเบียนเป็นคนละชุด
// ทุกแถวแปลงเป็นรูปแบบเดียวกัน + จัด "ชนิดอุปกรณ์ IT" จากชื่อประเภท/ชื่อครุภัณฑ์ (ชื่อประเภทสองทะเบียนเรียกไม่เหมือนกัน)
// จำนวนครั้งที่แจ้งซ่อม = จับเลขครุภัณฑ์กับ it_repair_requests.equipment_number

const COMPUTER_CAT = '%คอมพิวเตอร์%';

// ชนิดอุปกรณ์ IT — ลำดับสำคัญ: คำเฉพาะ (แม่ข่าย แท็บเล็ต โน้ตบุ๊ก) ต้องมาก่อน "คอมพิวเตอร์"
const KIND_RULES: [string, RegExp][] = [
    ['server', /แม่ข่าย|server/i],
    ['tablet', /แท็?บเล็ต|แท็?ปเล็ต|tablet|ipad/i],
    ['notebook', /โน้?ต\s?บุ๊?ค|โน๊ต\s?บุ๊?ค|โน้ตบุ๊ก|notebook|laptop/i],
    ['all_in_one', /all\s?in\s?one|ออลอินวัน/i],
    ['monitor', /จอภาพ|มอนิเตอร์|monitor|จอ\s?(lcd|led)/i],
    ['ups', /สำรองไฟ|ups/i],
    ['scanner', /สแกน|scanner/i],
    ['printer', /พิมพ์|printer|ตัดสติ๊?กเกอร์/i],
    ['network', /กระจายสัญญาณ|สวิตช์|switch|router|เราเตอร์|access\s?point|firewall|ไฟร์วอลล์/i],
    ['cctv', /กล้องวงจรปิด|cctv/i],
    ['computer', /คอมพิวเตอร์|computer|pc\b/i],
];
// ตรวจทีละกฎกับทั้งชื่อประเภทและชื่อครุภัณฑ์ — โน้ตบุ๊กมักลงประเภท "เครื่องคอมพิวเตอร์" จึงต้องให้ชื่อชนะได้
const kindOf = (type: string | null, name: string | null) => {
    for (const [k, re] of KIND_RULES) if (re.test(type ?? '') || re.test(name ?? '')) return k;
    return 'other';
};

// สถานะ → กลุ่มที่ใช้กรอง: in_use ใช้งาน · repair ส่งซ่อม/แจ้งชำรุด · pending จำหน่าย/ดำเนินการ · disposed ออกจากทะเบียนแล้ว
const STATUS_GROUP: Record<string, Record<string, string>> = {
    v3: { '4': 'in_use', '1': 'repair', '6': 'repair', '8': 'pending', '2': 'disposed' },
    v2: { '4': 'in_use', '1': 'repair', 'W': 'pending', '2': 'disposed' },
};

const clean = (s: unknown) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim() || null);

const v3Sql = `
    SELECT d.noid, d.names, d.models, d.locates, d.fy, d.docno, d.notes, d.perunits, d.expired, d.iscode,
           DATE_FORMAT(d.receive, '%Y-%m-%d') AS receive,
           t.hsrotypename AS type_name, dp.department, ic.iscodename AS status_name,
           km.kmoneydesc AS money_type, sp.supplier_name AS supplier, NULL AS trans
    FROM   deprecia d
    JOIN   assetcat c ON c.assetcatid = d.assetcatid AND c.catdesc LIKE ?
    -- hsrotype มีรหัสซ้ำ — ยุบเหลือแถวแรกต่อรหัสก่อน join กันแถวซ้ำ
    LEFT JOIN (SELECT h.hsrotypeid, TRIM(h.hsrotypename) AS hsrotypename FROM hsrotype h
               JOIN (SELECT MIN(id) AS id FROM hsrotype GROUP BY hsrotypeid) f ON f.id = h.id) t ON t.hsrotypeid = d.hsrotypeid
    LEFT JOIN (SELECT deprecia_depcode, MIN(department) AS department FROM departments GROUP BY deprecia_depcode) dp ON dp.deprecia_depcode = d.depcode
    LEFT JOIN iscode ic ON ic.iscode = d.iscode
    LEFT JOIN kmoney km ON km.kmoneyid = d.kmoney
    LEFT JOIN stocksupplier sp ON sp.id = d.company`;

const v2Sql = `
    SELECT d.noid, d.names, d.models, d.locates, d.fy, d.docno, d.notes, d.perunits, d.expired, d.iscode,
           DATE_FORMAT(d.receive, '%Y-%m-%d') AS receive,
           st.hsro_sutypename AS type_name, dp.department, ic.iscodename AS status_name,
           km.kmoneydesc AS money_type, sp.supplier_name AS supplier, d.trans
    FROM   deprecia d
    JOIN   assetcat c ON c.assetcatid = d.assetcatid AND c.catdesc LIKE ?
    LEFT JOIN (SELECT hsro_subtype, MIN(hsro_sutypename) AS hsro_sutypename FROM hsro_subtype GROUP BY hsro_subtype) st ON st.hsro_subtype = d.subtypeid
    LEFT JOIN (SELECT depcode, MIN(department) AS department FROM department GROUP BY depcode) dp ON dp.depcode = d.divs
    LEFT JOIN iscode ic ON ic.iscode = d.iscode
    LEFT JOIN kmoney km ON km.kmoneyid = d.kmoney
    LEFT JOIN stock_supplier sp ON sp.supplier_id = d.company`;

// ครุภัณฑ์คอมพิวเตอร์ทั้งสองทะเบียนในรูปแบบเดียว — ใช้ทั้งหน้าทะเบียนและ Dashboard ผู้บริหาร (itExecutiveController)
export const loadItAssets = async () => {
    const [[v3], [v2], repairs] = await Promise.all([
        equipmentPool.execute(v3Sql, [COMPUTER_CAT]) as any,
        equipmentV2Pool.execute(v2Sql, [COMPUTER_CAT]) as any,
        core_kon`
            SELECT TRIM(equipment_number) AS noid, count(*)::int AS repairs,
                   count(*) FILTER (WHERE completed_at IS NULL)::int AS open_repairs,
                   to_char(MAX(created_at) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS last_repair
            FROM it_repair_requests
            WHERE NULLIF(TRIM(equipment_number), '') IS NOT NULL
            GROUP BY 1`,
    ]);
    const rep = new Map(repairs.map((r: any) => [r.noid, r]));
    const shape = (src: 'v3' | 'v2') => (r: any) => {
        const noid = clean(r.noid) ?? '';
        const type = clean(r.type_name);
        const transferred = src === 'v2' && String(r.trans ?? '').toUpperCase() === 'Y';
        const rr: any = rep.get(noid);
        return {
            key: `${src}:${noid}`, source: src, noid,
            name: clean(r.names), model: clean(r.models), type, kind: kindOf(type, clean(r.names)),
            department: clean(r.department), location: clean(r.locates),
            receive: r.receive || null, fy: r.fy ? Number(r.fy) || null : null,
            price: r.perunits == null ? null : Number(r.perunits),
            life_years: Number(r.expired) > 0 ? Number(r.expired) : null,
            status_code: clean(r.iscode), status: transferred ? 'ตัดออกจากทะเบียน' : clean(r.status_name),
            status_group: transferred ? 'disposed' : (STATUS_GROUP[src][String(r.iscode ?? '').trim()] ?? 'other'),
            money_type: clean(r.money_type), supplier: clean(r.supplier), docno: clean(r.docno), notes: clean(r.notes),
            repairs: rr?.repairs ?? 0, open_repairs: rr?.open_repairs ?? 0, last_repair: rr?.last_repair ?? null,
        };
    };
    return [...(v3 as any[]).map(shape('v3')), ...(v2 as any[]).map(shape('v2'))];
};

export const getItAssets = async ({ set }: any) => {
    try {
        return { success: true, data: await loadItAssets(), as_of: new Date().toISOString() };
    } catch (error: any) {
        console.error('[ItAsset] DB Error:', error?.message, error?.code);
        set.status = 500;
        return { success: false, message: 'ดึงข้อมูลทะเบียนครุภัณฑ์คอมพิวเตอร์ไม่สำเร็จ' };
    }
};

// ── ครุภัณฑ์เป้าหมายสำหรับ BIA (นอกหมวดคอมพิวเตอร์) ─────────────────────────
// BIA ต้องผูกโครงสร้างพื้นฐานที่บริการ IT พึ่งพาได้ด้วย (ไฟฟ้าสำรอง แอร์ห้อง Server โทรศัพท์ ซอฟต์แวร์ เครื่องมือแพทย์ที่เชื่อมระบบ)
// แต่ไม่เอาของที่ไม่เกี่ยว (เก้าอี้ โต๊ะ ตู้ พัดลม ...) — หมวดสำนักงาน/ไฟฟ้ากรองต่อด้วยชื่อประเภทหรือชื่อครุภัณฑ์
// (ทะเบียน V2 ลงชื่อประเภทผิดหลายรายการ เช่น แอร์ลงประเภท "ตู้ปลอดเชื้อ" โต๊ะลงประเภท "เครื่องปรับอากาศ" — จึงกรองจากชื่อครุภัณฑ์)
// หมวดคอมพิวเตอร์ไม่อยู่ในรายการนี้ — หน้าเว็บใช้จาก /api/v1/it/assets เหมือนเดิม (มีผลประเมินความเสี่ยงทรัพย์สิน)
// key ใช้รูปแบบเดียวกับทะเบียนทรัพย์สิน IT (<ทะเบียน>:<เลขครุภัณฑ์>) — ข้อมูล BIA เดิมใช้ต่อได้
type BiaGroup = 'software' | 'power' | 'facility' | 'medical';
const BIA_GROUPS: { group: BiaGroup; label: string; cat: string; match?: RegExp; exclude?: RegExp }[] = [
    { group: 'software', label: 'ซอฟต์แวร์', cat: '%ไม่มีตัวตน%' },
    { group: 'power', label: 'ไฟฟ้าสำรอง/สื่อสาร', cat: '%ไฟฟ้า%', match: /กำเนิดไฟฟ้า|ควบคุมแรงดัน|จ่ายไฟฟ้า|วิทยุ|วิมยุ|หม้อแปลง|สำรองไฟ|\bups\b/i },
    { group: 'facility', label: 'ปรับอากาศ/โทรศัพท์', cat: '%สำนักงาน%', match: /ปรับอากาศ|โทรศัพท์|ไทรศัพท์|โทรศัพย์|โทรสาร|\bfax\b|ลายนิ้วมือ|ตู้สาขา|แม่ข่าย/i, exclude: /พัดลม/ },
    // ราว 5,700 รายการ — ส่งให้เฉพาะตอนค้นหา
    { group: 'medical', label: 'เครื่องมือแพทย์', cat: '%การแพทย์%' },
];
const BIA_KEY_RE = /^(v3|v2):.{1,60}$/;
const BIA_SEARCH_LIMIT = 50;
const BIA_CACHE_MS = 5 * 60_000;
let biaCache: { at: number; rows: any[] } | null = null;
let biaLoading: Promise<any[]> | null = null;

const loadBiaTargetsFresh = async () => {
    const out: any[] = [];
    for (const g of BIA_GROUPS) {
        const [[v3], [v2]] = await Promise.all([equipmentPool.execute(v3Sql, [g.cat]) as any, equipmentV2Pool.execute(v2Sql, [g.cat]) as any]);
        for (const [src, rows] of [['v3', v3], ['v2', v2]] as const) {
            for (const r of rows as any[]) {
                const noid = clean(r.noid), name = clean(r.names), type = clean(r.type_name);
                // ชื่อครุภัณฑ์เชื่อถือได้กว่าชื่อประเภท — ใช้ชื่อประเภทเฉพาะเมื่อไม่มีชื่อ
                const text = name ?? type ?? '';
                if (!noid || (g.match && !g.match.test(text)) || (g.exclude && g.exclude.test(text))) continue;
                const transferred = src === 'v2' && String(r.trans ?? '').toUpperCase() === 'Y';
                out.push({
                    key: `${src}:${noid}`, source: src, noid, name, model: clean(r.models), type, kind: 'other',
                    group: g.group, group_label: g.label,
                    department: clean(r.department), location: clean(r.locates), receive: r.receive || null,
                    status: transferred ? 'ตัดออกจากทะเบียน' : clean(r.status_name),
                    status_group: transferred ? 'disposed' : (STATUS_GROUP[src][String(r.iscode ?? '').trim()] ?? 'other'),
                });
            }
        }
    }
    return out;
};
const loadBiaTargets = async () => {
    if (biaCache && Date.now() - biaCache.at < BIA_CACHE_MS) return biaCache.rows;
    biaLoading ??= loadBiaTargetsFresh()
        .then(rows => { biaCache = { at: Date.now(), rows }; return rows; })
        .finally(() => { biaLoading = null; });
    return biaLoading;
};

// GET /api/v1/it/bia/assets?search=&keys=
//   ไม่มี search → ครุภัณฑ์เป้าหมายทุกกลุ่มยกเว้นเครื่องมือแพทย์ · มี search (2–60 ตัว) → เครื่องมือแพทย์ที่ตรงคำค้น (ยังถือครอง สูงสุด 50)
//   keys (คั่นด้วย , สูงสุด 200) → รวมรายการตาม key ที่บันทึกไว้แล้วด้วย (ทุกกลุ่ม รวมที่ออกจากทะเบียนแล้ว) ไว้แสดงชื่อ
export const getBiaAssets = async ({ query, set }: any) => {
    const search = typeof query?.search === 'string' ? query.search.trim() : '';
    if (search && (search.length < 2 || search.length > 60)) { set.status = 400; return { success: false, message: 'คำค้นต้องยาว 2–60 ตัวอักษร', field: 'search' }; }
    const keys = typeof query?.keys === 'string' && query.keys ? [...new Set(query.keys.split(',').map((k: string) => k.trim()).filter(Boolean))] as string[] : [];
    if (keys.length > 200 || keys.some(k => !BIA_KEY_RE.test(k))) { set.status = 400; return { success: false, message: 'รายการครุภัณฑ์ไม่ถูกต้อง', field: 'keys' }; }
    try {
        const rows = await loadBiaTargets();
        let base: any[];
        if (search) {
            const words = search.toLowerCase().split(/\s+/);
            base = rows.filter(r => r.group === 'medical' && r.status_group !== 'disposed'
                && words.every(w => [r.noid, r.name, r.model, r.type, r.department].some(v => v && String(v).toLowerCase().includes(w)))).slice(0, BIA_SEARCH_LIMIT);
        } else base = rows.filter(r => r.group !== 'medical');
        const seen = new Set(base.map(r => r.key));
        const want = new Set(keys.filter(k => !seen.has(k)));
        const extra = want.size ? rows.filter(r => want.has(r.key)) : [];
        return { success: true, data: [...base, ...extra], groups: BIA_GROUPS.map(g => ({ group: g.group, label: g.label })) };
    } catch (error: any) {
        console.error('[ItAsset] BIA targets DB Error:', error?.message, error?.code);
        set.status = 500;
        return { success: false, message: 'ดึงข้อมูลครุภัณฑ์จากทะเบียนไม่สำเร็จ' };
    }
};
