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
