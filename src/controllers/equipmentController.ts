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
                    a.assetcatid, cat.catdesc AS assetcatname
             FROM   deprecia a
             LEFT OUTER JOIN assetcat cat ON cat.assetcatid = a.assetcatid
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
