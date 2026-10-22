import { equipmentPool, equipmentV2Pool } from '../db/db';

export const searchEquipment = async ({ query, set }: any) => {
    const keyword = (query?.keyword ?? '').trim();
    if (!keyword) {
        set.status = 400;
        return { success: false, message: 'กรุณาระบุ keyword' };
    }

    const like = `%${keyword}%`;

    try {
        const [rows] = await equipmentPool.execute(
            `SELECT a.noid, a.names, a.models, a.locates,
                    a.fy, a.docno, a.notes, a.perunits,
                    -- ผู้ขาย/ผู้บริจาค: ชื่อกับที่อยู่ ใช้พิมพ์ลงทะเบียนคุมทรัพย์สิน
                    c.companycode, c.companyname, c.address01 AS companyaddress, c.tel AS companytel,
                    -- ประเภทเงิน / วิธีได้มา เก็บเป็นรหัสใน deprecia ต้อง join ตารางคำอธิบาย
                    km.kmoneydesc AS moneytype, tm.tmoneydesc AS acquiremethod,
                    -- แปลงเป็นสตริงใน SQL เลย: receive เก็บเป็นเที่ยงคืนเวลาไทย
                    -- ถ้าปล่อยเป็น Date แล้วให้ JSON แปลงเอง จะกลายเป็น UTC และวันเพี้ยนไป 1 วัน
                    DATE_FORMAT(a.receive, '%Y-%m-%d') AS receive,
                    -- ใช้คำนวณค่าเสื่อมราคา: expired = อายุการใช้งาน (ปี), deprec = อัตราต่อปี (%)
                    a.expired, a.deprec,
                    -- ประเภทสินทรัพย์ ใช้เทียบกับช่วงอายุตามตารางที่ 1 ของหลักเกณฑ์ภาครัฐ
                    a.assetcatid, cat.catdesc AS assetcatname,
                    -- ประเภทครุภัณฑ์ (ระดับย่อยกว่าหมวด) — ระบบเดิมเก็บไว้ในตาราง hsrotype
                    st.hsrotypename AS subtypename
             FROM   deprecia a
             LEFT OUTER JOIN company c ON c.companycode = a.company
             LEFT OUTER JOIN assetcat cat ON cat.assetcatid = a.assetcatid
             LEFT OUTER JOIN kmoney km ON km.kmoneyid = a.kmoney
             LEFT OUTER JOIN tmoney tm ON tm.tmoneyid = a.tmoney
             -- hsrotype มี hsrotypeid ซ้ำอยู่ 5 รหัส ถ้า join ตรง ๆ ครุภัณฑ์จะถูกนับซ้ำ
             -- จึงยุบให้เหลือรหัสละแถวก่อน
             LEFT OUTER JOIN (SELECT hsrotypeid, MIN(hsrotypename) AS hsrotypename
                              FROM hsrotype GROUP BY hsrotypeid) st
                          ON st.hsrotypeid = a.hsrotypeid
             WHERE  a.noid        LIKE ?
                OR  a.names       LIKE ?
                OR  a.models      LIKE ?
                OR  a.locates     LIKE ?
                OR  a.fy          LIKE ?
                OR  a.docno       LIKE ?
                OR  a.notes       LIKE ?
                OR  c.companyname LIKE ?
             LIMIT  1000`,
            [like, like, like, like, like, like, like, like]
        );
        return { success: true, data: rows };
    } catch (error: any) {
        console.error('[Equipment] DB Error:', error.message, error.code);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ── ทะเบียนครุภัณฑ์ระบบใหม่ (V2) ────────────────────────────────────────────
// คนละเครื่อง คนละฐานข้อมูลกับด้านบน (EQUIPMENT_V2_*)
//
// ตาราง deprecia ของ V2 ไม่มีคอลัมน์ ref/docs ที่ระบบเดิมมี และรหัส assetcatid
// เป็นคนละชุดกับระบบเดิม (เทียบได้จากคอลัมน์ assetcatidv2 ในตาราง assetcat ของระบบเดิม)
// จึงต้องแยก endpoint และแยกตารางจับคู่หมวดฝั่งหน้าเว็บ
export const searchEquipmentV2 = async ({ query, set }: any) => {
    const keyword = (query?.keyword ?? '').trim();
    if (!keyword) {
        set.status = 400;
        return { success: false, message: 'กรุณาระบุ keyword' };
    }

    const like = `%${keyword}%`;

    try {
        const [rows] = await equipmentV2Pool.execute(
            `SELECT a.noid, a.names, a.models, a.locates,
                    a.fy, a.docno, a.notes, a.perunits,
                    -- ผู้ขาย/ผู้บริจาค: ชื่อกับที่อยู่ ใช้พิมพ์ลงทะเบียนคุมทรัพย์สิน
                    c.companycode, c.companyname, c.address01 AS companyaddress, c.tel AS companytel,
                    -- ประเภทเงิน / วิธีได้มา เก็บเป็นรหัสใน deprecia ต้อง join ตารางคำอธิบาย
                    km.kmoneydesc AS moneytype, tm.tmoneydesc AS acquiremethod,
                    -- แปลงเป็นสตริงใน SQL เลย: receive เก็บเป็นเที่ยงคืนเวลาไทย
                    -- ถ้าปล่อยเป็น Date แล้วให้ JSON แปลงเอง จะกลายเป็น UTC และวันเพี้ยนไป 1 วัน
                    DATE_FORMAT(a.receive, '%Y-%m-%d') AS receive,
                    -- ใช้คำนวณค่าเสื่อมราคา: expired = อายุการใช้งาน (ปี), deprec = อัตราต่อปี (%)
                    a.expired, a.deprec,
                    a.assetcatid, cat.catdesc AS assetcatname,
                    -- ประเภทครุภัณฑ์ — V2 เก็บไว้ในตาราง hsro_subtype (คนละชื่อตารางกับระบบเดิม)
                    st.hsro_sutypename AS subtypename
             FROM   deprecia a
             LEFT OUTER JOIN company c ON c.companycode = a.company
             LEFT OUTER JOIN assetcat cat ON cat.assetcatid = a.assetcatid
             LEFT OUTER JOIN kmoney km ON km.kmoneyid = a.kmoney
             LEFT OUTER JOIN tmoney tm ON tm.tmoneyid = a.tmoney
             LEFT OUTER JOIN hsro_subtype st ON st.hsro_subtype = a.subtypeid
             WHERE  a.noid        LIKE ?
                OR  a.names       LIKE ?
                OR  a.models      LIKE ?
                OR  a.locates     LIKE ?
                OR  a.fy          LIKE ?
                OR  a.docno       LIKE ?
                OR  a.notes       LIKE ?
                OR  c.companyname LIKE ?
             LIMIT  1000`,
            [like, like, like, like, like, like, like, like]
        );
        return { success: true, data: rows };
    } catch (error: any) {
        console.error('[EquipmentV2] DB Error:', error.message, error.code);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ── ข้อมูลดิบสำหรับรายงานสรุปค่าเสื่อมราคาประจำปี ───────────────────────────
//
// ส่งเฉพาะคอลัมน์ที่ใช้คำนวณ และกรองคร่าว ๆ ให้เหลือเฉพาะครุภัณฑ์ที่ "อาจ" ยัง
// คิดค่าเสื่อมอยู่ในปีงบที่ขอ ส่วนการตัดสินว่าปีนั้นมีค่าเสื่อมจริงเท่าไร ให้ฝั่ง
// หน้าเว็บคำนวณด้วยสูตรชุดเดียวกับหน้าคำนวณรายตัว ผลลัพธ์จะได้ตรงกันเสมอ
//
// เผื่อท้ายไว้ 2 เดือน เพราะเกณฑ์ GFMIS เลื่อนเดือนเริ่ม/จบได้สูงสุด 1 เดือน
// ถ้ากรองพอดีเป๊ะ ครุภัณฑ์ที่เพิ่งหมดอายุจะหลุดจากรายงานทั้งที่ยังมีค่าเสื่อมค้างอยู่
// คอลัมน์ที่บอกว่า "ไม่ต้องคิดค่าเสื่อม" มีไม่เหมือนกันในแต่ละทะเบียน จึงต้องสั่งเป็นรายทะเบียน
//   trans='Y'  = ตัดออกจากระบบแล้ว ไม่ใช่ทรัพย์สินที่ถือครองอยู่ (มีเฉพาะทะเบียน V2)
//   iscode     = สถานะของรายการ รหัสที่ใช้ของแต่ละทะเบียนเป็นคนละชุดกัน
interface DepreciationFilters {
    excludeTransferred?: boolean;
    /** เอาเฉพาะ iscode ที่อยู่ในรายการนี้ (ทะเบียนที่รู้ชุดรหัสแน่นอน ใช้แบบระบุขาว) */
    isCodeIn?: string[];
    /** ตัดเฉพาะ iscode='2' ออก ที่เหลือเอาหมด (ทะเบียนที่ยังมีรหัสอื่นใช้งานอยู่) */
    excludeIsCode2?: boolean;
}

const depreciationYearQuery = async (
    pool: any, query: any, set: any, tag: string,
    filters: DepreciationFilters = {},
) => {
    const fyBE = Number(query?.fy);
    if (!Number.isInteger(fyBE) || fyBE < 2500 || fyBE > 2700) {
        set.status = 400;
        return { success: false, message: 'กรุณาระบุปีงบประมาณ (พ.ศ.) ให้ถูกต้อง' };
    }

    const fyCE = fyBE - 543;
    const fyStart = `${fyCE - 1}-10-01`;
    const fyEnd = `${fyCE}-09-30`;

    // scope=all = ส่งครุภัณฑ์ที่ได้รับมาก่อนสิ้นปีงบทั้งหมด รวมของที่คิดค่าเสื่อมครบไปแล้ว
    // (ใช้กับรายงาน "คิดค่าเสื่อมครบแล้ว เหลือราคาซาก" ซึ่งต้องเห็นของเก่าที่ตัวกรองปกติตัดทิ้ง)
    // ค่าตั้งต้นยังเป็นเฉพาะของที่ยังคิดค่าเสื่อมอยู่ เพราะข้อมูลชุดเต็มใหญ่กว่าหลายเท่า
    const scope = String(query?.scope ?? 'active').toLowerCase();
    const onlyActive = scope !== 'all';

    try {
        const sql =
            `SELECT a.noid, a.names, a.perunits, a.expired,
                    DATE_FORMAT(a.receive, '%Y-%m-%d') AS receive,
                    a.assetcatid, cat.catdesc AS assetcatname,
                    -- ประเภทเงินที่ใช้ซื้อ/ได้มา เก็บเป็นรหัสใน deprecia ต้อง join คำอธิบาย
                    -- (ใช้เป็นตัวกรองในรายงานสรุป เช่น ดูเฉพาะเงินงบประมาณ)
                    a.kmoney AS moneycode, km.kmoneydesc AS moneytype
             FROM   deprecia a
             LEFT OUTER JOIN assetcat cat ON cat.assetcatid = a.assetcatid
             LEFT OUTER JOIN kmoney km ON km.kmoneyid = a.kmoney
             -- ไม่กรองราคา/อายุออกที่นี่ เพราะของที่ข้อมูลไม่ครบก็ยังเป็นทรัพย์สินที่ถือครองอยู่
             -- ต้องเห็นในทะเบียนและในรายการที่ไม่เข้าเงื่อนไข ไม่ใช่หายไปเงียบ ๆ
             -- (หน้าเว็บเป็นคนแยกว่ารายการไหนคิดค่าเสื่อมได้หรือไม่ได้ พร้อมบอกสาเหตุ)
             WHERE  (a.receive IS NULL OR a.receive <= ?)`
            // ค่าปกติของ trans เป็น NULL หรือค่าว่างได้ จึงต้องเทียบแบบเผื่อ NULL ไว้
            + (filters.excludeTransferred ? ` AND (a.trans IS NULL OR a.trans <> 'Y')` : '')
            // แบบระบุขาว: รหัสที่ไม่อยู่ในรายการ (รวมทั้ง NULL) ไม่เข้ารายงาน
            + (filters.isCodeIn?.length
                ? ` AND a.iscode IN (${filters.isCodeIn.map(() => '?').join(', ')})`
                : '')
            + (filters.excludeIsCode2 ? ` AND (a.iscode IS NULL OR a.iscode <> '2')` : '')
            // ชุด active ต้องคิดวันหมดอายุได้ จึงต้องมีวันที่รับกับอายุครบ
            + (onlyActive
                ? ` AND a.receive IS NOT NULL AND a.expired > 0`
                + ` AND DATE_ADD(DATE_ADD(a.receive, INTERVAL a.expired YEAR), INTERVAL 2 MONTH) >= ?`
                : '');
        // ลำดับพารามิเตอร์ต้องตรงกับลำดับของเครื่องหมาย ? ในประโยค SQL ข้างบน
        const params = [fyEnd, ...(filters.isCodeIn ?? []), ...(onlyActive ? [fyStart] : [])];
        const [rows] = await pool.execute(sql, params);
        return {
            success: true, data: rows, fyBE, fyStart, fyEnd,
            scope: onlyActive ? 'active' : 'all',
            filters,
        };
    } catch (error: any) {
        console.error(`[${tag}] Annual summary DB Error:`, error.message, error.code);
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ทะเบียน V3 เป็นฐานใหม่ที่แยกเฉพาะครุภัณฑ์ออกมาจาก V2 โครงสร้างตารางจึงไม่เหมือนกัน
// — ไม่มีคอลัมน์ trans แต่มี iscode เหมือนกัน
// รหัสสถานะที่นับเป็นครุภัณฑ์ของทะเบียน V3 — รหัสอื่น (เช่น '2') ไม่คิดค่าเสื่อม
const V3_ISCODE_IN = ['6', '1', '8', '4'];

export const getDepreciationYearAssets = ({ query, set }: any) =>
    depreciationYearQuery(equipmentPool, query, set, 'Equipment', { isCodeIn: V3_ISCODE_IN });

// ทะเบียน V2 ใช้เงื่อนไขและโครงสร้างคอลัมน์ชุดเดียวกัน ต่างแค่เครื่องปลายทาง
// (รหัสหมวดเป็นคนละชุด แต่รายงานนี้จัดกลุ่มด้วยชื่อหมวดที่ join มา จึงไม่ต้องแปลงรหัส)
export const getDepreciationYearAssetsV2 = ({ query, set }: any) =>
    depreciationYearQuery(equipmentV2Pool, query, set, 'EquipmentV2',
        { excludeTransferred: true, excludeIsCode2: true });

// ── รายงานครุภัณฑ์แยกตามหน่วยงาน (ทะเบียน V2) ──────────────────────────────
// พอร์ตจากรายงาน deprecia_v2_dep ของระบบเดิม และแก้จุดที่ทำให้ช้า/ผิด:
//  - ตารางคำอธิบาย (หมวด ประเภท หน่วยงาน ผู้ขาย ฯลฯ) มีแค่หลักสิบถึงหลักพันแถว
//    ส่งแยกไปครั้งเดียวแทนการ join ซ้ำทุกแถว ข้อความไทยยาว ๆ ไม่ต้องวิ่งซ้ำหมื่นรอบ
//    วัดกับฐานจริง (12,722 รายการ): 5.4 วินาที / 16.4 MB → 0.46 วินาที / 6.6 MB
//  - ตัด GROUP BY noid, code_bps ทิ้ง — noid ไม่ซ้ำในชุดนี้และตารางคำอธิบายไม่มีคีย์ซ้ำ
//    จึงไม่ได้กันแถวซ้ำอะไร แค่บังคับให้ MySQL sort ลง temp table
//  - ไม่ดึงทั้งทะเบียนซ้ำรอบที่สองเพื่อทำหัวรายงาน หน้าเว็บจัดกลุ่มตามหน่วยงานจากชุดเดียวกัน
//  - ตัดเงื่อนไขที่ไม่ได้กรองอะไร: fy IN (2500..2580) ซึ่งพิมพ์ผิดจน fy 2534/2535 หลุด
//    และ assetcatid IN (1..12) ซึ่งครอบทุกหมวดที่มีอยู่แล้ว
//  - ตัวกรองปีงบ/หมวด/หน่วยงานย้ายไปทำที่หน้าเว็บ ข้อมูลทั้งทะเบียนเล็กพอ เปลี่ยนตัวกรองได้ทันที
//    (ของเดิมเช็ค $request->department แต่ใช้ $request->departments จึงไม่เคยกรองหน่วยงานได้จริง)
//  - ค่าจากผู้ใช้ไม่ได้ต่อเข้า SQL ตรง ๆ อีก (ของเดิมเปิดช่อง SQL injection ทุกตัวกรอง)

// สถานะที่นับเป็นครุภัณฑ์ที่ยังถือครองอยู่: 1 ส่งซ่อม, 4 อยู่ในหน่วยงาน, W กำลังดำเนินการ
// (ไม่รวม 2 ขายทอดตลาด, 3 โอนย้าย, 6 ย้ายไป V3)
const DEPT_REPORT_ISCODES = ['1', '4', 'W'];

// สถานีอนามัย 21 แห่ง (202102–202122) ที่แยกออกไปแล้ว — รายงานเดิมตัดทิ้งเสมอ
// รายการเดิมตกจุลภาคระหว่าง '202119' '202120' MySQL เลยต่อเป็นสตริงเดียว สองรหัสนี้จึงไม่ถูกตัด
const DETACHED_HEALTH_STATIONS = Array.from({ length: 21 }, (_, i) => String(202102 + i));

// แปลงแถวของตารางคำอธิบายเป็น { รหัส: ค่า } — คีย์ของ JSON เป็นสตริงเสมอ
// หน้าเว็บจึงเทียบได้ทั้งรหัสที่เก็บเป็นตัวเลขและเป็นข้อความ (เช่น typeid int กับ hsro_typecode varchar)
const toDict = <T>(rows: any[], key: string, value: (r: any) => T): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const r of rows) if (r[key] != null) out[String(r[key])] = value(r);
    return out;
};

export const getAssetsByDepartmentV2 = async ({ set }: any) => {
    try {
        const rowsSql =
            `SELECT d.noid, d.noid_old, d.numbers, d.assetcatid, d.typeid, d.subtypeid, d.code_bps,
                    d.names, d.models,
                    -- receive เป็น timestamp ส่งเป็นสตริงวันที่ กันวันเพี้ยนตอนแปลงเป็น UTC
                    DATE_FORMAT(d.receive, '%Y-%m-%d') AS receive,
                    d.fy, d.locates, d.divs, d.docno, d.company, d.kmoney, d.tmoney,
                    d.perunits, d.deprec, d.expired, d.gf, d.notes, d.iscode
             FROM   deprecia d
             WHERE  d.iscode IN (${DEPT_REPORT_ISCODES.map(() => '?').join(', ')})
               AND  (d.trans IS NULL OR d.trans = '')
               -- เผื่อ NULL ไว้: ครุภัณฑ์ที่ไม่ได้ระบุหน่วยงานต้องยังเห็นในรายงาน ไม่ใช่หายไปเงียบ ๆ
               AND  (d.divs IS NULL OR d.divs NOT IN (${DETACHED_HEALTH_STATIONS.map(() => '?').join(', ')}))
             ORDER BY d.divs, d.assetcatid, d.noid`;

        const [[rows], [cat], [type], [subtype], [kind], [supplier], [kmoney], [tmoney], [iscode], [dept]] =
            await Promise.all([
                equipmentV2Pool.execute(rowsSql, [...DEPT_REPORT_ISCODES, ...DETACHED_HEALTH_STATIONS]),
                equipmentV2Pool.query(`SELECT assetcatid, catdesc FROM assetcat`),
                equipmentV2Pool.query(`SELECT hsro_typecode, hsro_typename FROM hsro_type`),
                equipmentV2Pool.query(`SELECT hsro_subtype, hsro_sutypename FROM hsro_subtype`),
                equipmentV2Pool.query(`SELECT bps_code, hsro_kindname FROM hsro_kind`),
                // ทะเบียน V2 ผูกผู้ขายกับ stock_supplier (ตาราง company จับคู่ได้น้อยกว่าและชื่อไม่ตรงกันหลายพันแถว)
                equipmentV2Pool.query(`SELECT supplier_id, supplier_name, supplier_address1, supplier_phone FROM stock_supplier`),
                equipmentV2Pool.query(`SELECT kmoneyid, kmoneydesc FROM kmoney`),
                equipmentV2Pool.query(`SELECT tmoneyid, tmoneydesc FROM tmoney`),
                equipmentV2Pool.query(`SELECT iscode, iscodename FROM iscode`),
                equipmentV2Pool.query(`SELECT depcode, department FROM department`),
            ]) as any[];

        return {
            success: true,
            data: rows,
            lookups: {
                category: toDict(cat, 'assetcatid', r => r.catdesc),
                type: toDict(type, 'hsro_typecode', r => r.hsro_typename),
                subtype: toDict(subtype, 'hsro_subtype', r => r.hsro_sutypename),
                kind: toDict(kind, 'bps_code', r => r.hsro_kindname),
                supplier: toDict(supplier, 'supplier_id', r => ({
                    name: r.supplier_name, address: r.supplier_address1, phone: r.supplier_phone,
                })),
                moneyType: toDict(kmoney, 'kmoneyid', r => r.kmoneydesc),
                acquireMethod: toDict(tmoney, 'tmoneyid', r => r.tmoneydesc),
                status: toDict(iscode, 'iscode', r => r.iscodename),
                department: toDict(dept, 'depcode', r => r.department),
            },
        };
    } catch (error: any) {
        console.error('[EquipmentV2] By-department DB Error:', error.message, error.code);
        set.status = 500;
        return { success: false, message: 'ดึงข้อมูลทะเบียนครุภัณฑ์ไม่สำเร็จ' };
    }
};

// ── รายงานครุภัณฑ์แยกตามหน่วยงาน (ทะเบียน V3) ──────────────────────────────
// พอร์ตจากรายงาน deprecia_v3_dep ของระบบเดิม ส่งข้อมูลรูปแบบเดียวกับ V2 ทุกฟิลด์
// หน้าเว็บจึงใช้โค้ดชุดเดียวกันได้ — คอลัมน์ของ V3 ที่ชื่อไม่ตรงกับ V2 ตั้งชื่อแทนไว้:
//   divs      ← depcode       (รหัสหน่วยงานที่รายงานเดิมใช้ คอลัมน์ dept เป็นรหัสคนละชุด)
//   typeid    ← groupclassid  (hsrogroupclass — ระดับบนของประเภท)
//   subtypeid ← hsrotypeid    (hsrotype)
// แก้จุดเดียวกับ V2 (ส่งตารางคำอธิบายแยก, ไม่ดึงหัวรายงานซ้ำ, ไม่ต่อค่าผู้ใช้เข้า SQL)
// และเงื่อนไขของรายงานเดิมที่ทำให้ครุภัณฑ์หายจากรายงาน — ตรวจกับฐานจริงแล้ว:
//  - รายชื่อหน่วยงานที่เขียนตายตัวไม่เคยเพิ่มหน่วยงาน 212179–212190 (11 หน่วยงานที่ยังใช้งาน
//    เช่น อายุรกรรม 1–2, ICU4, อำนวยการ) ครุภัณฑ์ 472 รายการจึงไม่เคยขึ้นรายงาน
//    ส่วนหน่วยงานที่ตั้งใจตัดออก (สถานีอนามัยที่ปิดแล้ว ห้อง OR เก่า ฯลฯ) ไม่มีครุภัณฑ์สถานะ 1/4 เหลือ
//    จึงเลิกกรองหน่วยงาน
//  - หมวด IN (1..15) ตกหมวด 16 กีฬา และ 17 สินทรัพย์ไม่มีตัวตน ที่เพิ่มมาทีหลัง (4 รายการ)
//  - ปีงบ IN (2500..2580) พิมพ์ '2554' แทน '2534' ปี 2534 จึงหลุด (1 รายการ)
//  - GROUP BY noid, code_bps มีไว้ยุบแถวซ้ำจากการ join hsrotype (hsrotypeid ซ้ำ 5 รหัส)
//    ตอนนี้ยุบรหัสซ้ำในตารางคำอธิบายก่อนส่ง แถวครุภัณฑ์จึงไม่ซ้ำตั้งแต่ต้น (noid ไม่ซ้ำในชุดนี้)

// สถานะที่รายงานเดิมนับ: 1 ส่งซ่อม, 4 อยู่ในหน่วยงาน
// (ไม่รวม 6 แจ้งชำรุด, 8 รอจำหน่าย, 2 ขายทอดตลาด)
const DEPT_REPORT_ISCODES_V3 = ['1', '4'];

export const getAssetsByDepartment = async ({ set }: any) => {
    try {
        const rowsSql =
            `SELECT d.noid, d.noid_old, d.numbers, d.assetcatid,
                    d.groupclassid AS typeid, d.hsrotypeid AS subtypeid, d.code_bps,
                    d.names, d.models,
                    DATE_FORMAT(d.receive, '%Y-%m-%d') AS receive,
                    d.fy, d.locates, d.depcode AS divs, d.docno, d.company, d.kmoney, d.tmoney,
                    d.perunits, d.deprec, d.expired, d.gf, d.notes, d.iscode
             FROM   deprecia d
             WHERE  d.iscode IN (${DEPT_REPORT_ISCODES_V3.map(() => '?').join(', ')})
             ORDER BY d.depcode, d.assetcatid, d.noid`;

        const [[rows], [cat], [type], [subtype], [kind], [supplier], [kmoney], [tmoney], [iscode], [dept]] =
            await Promise.all([
                equipmentPool.execute(rowsSql, DEPT_REPORT_ISCODES_V3),
                equipmentPool.query(`SELECT assetcatid, catdesc FROM assetcat`),
                // รหัสในสองตารางนี้ไม่ได้เป็นคีย์หลัก — hsrotypeid ซ้ำอยู่ 5 รหัส 4 รหัสต่างกันแค่ \r\n
                // แต่ 6515-030 มีสองชื่อจริง ใช้แถวแรก (id น้อยสุด) ให้ตรงกับที่รายงานเดิมแสดง
                equipmentPool.query(`SELECT g.groupclassid, TRIM(g.groupclassname) AS groupclassname
                                     FROM hsrogroupclass g
                                     JOIN (SELECT MIN(id) AS id FROM hsrogroupclass GROUP BY groupclassid) f ON f.id = g.id`),
                equipmentPool.query(`SELECT h.hsrotypeid, TRIM(h.hsrotypename) AS hsrotypename
                                     FROM hsrotype h
                                     JOIN (SELECT MIN(id) AS id FROM hsrotype GROUP BY hsrotypeid) f ON f.id = h.id`),
                equipmentPool.query(`SELECT code_bps, hsro_desc FROM hsrodescription`),
                // ทะเบียน V3 ผูกผู้ขายกับ stocksupplier.id (ไม่ใช่ตาราง company แบบหน้าค้นหา)
                equipmentPool.query(`SELECT id, supplier_name, supplier_address1, supplier_phone FROM stocksupplier`),
                equipmentPool.query(`SELECT kmoneyid, kmoneydesc FROM kmoney`),
                equipmentPool.query(`SELECT tmoneyid, tmoneydesc FROM tmoney`),
                equipmentPool.query(`SELECT iscode, iscodename FROM iscode`),
                equipmentPool.query(`SELECT deprecia_depcode, department FROM departments`),
            ]) as any[];

        return {
            success: true,
            data: rows,
            lookups: {
                category: toDict(cat, 'assetcatid', r => r.catdesc),
                type: toDict(type, 'groupclassid', r => r.groupclassname),
                subtype: toDict(subtype, 'hsrotypeid', r => r.hsrotypename),
                kind: toDict(kind, 'code_bps', r => r.hsro_desc),
                supplier: toDict(supplier, 'id', r => ({
                    name: r.supplier_name, address: r.supplier_address1, phone: r.supplier_phone,
                })),
                moneyType: toDict(kmoney, 'kmoneyid', r => r.kmoneydesc),
                acquireMethod: toDict(tmoney, 'tmoneyid', r => r.tmoneydesc),
                status: toDict(iscode, 'iscode', r => r.iscodename),
                department: toDict(dept, 'deprecia_depcode', r => r.department),
            },
        };
    } catch (error: any) {
        console.error('[Equipment] By-department DB Error:', error.message, error.code);
        set.status = 500;
        return { success: false, message: 'ดึงข้อมูลทะเบียนครุภัณฑ์ไม่สำเร็จ' };
    }
};
