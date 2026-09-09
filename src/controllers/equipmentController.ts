import { equipmentPool } from '../db/db';

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
                    a.fy, a.docno, a.notes, c.companyname, a.perunits,
                    -- แปลงเป็นสตริงใน SQL เลย: receive เก็บเป็นเที่ยงคืนเวลาไทย
                    -- ถ้าปล่อยเป็น Date แล้วให้ JSON แปลงเอง จะกลายเป็น UTC และวันเพี้ยนไป 1 วัน
                    DATE_FORMAT(a.receive, '%Y-%m-%d') AS receive,
                    -- ใช้คำนวณค่าเสื่อมราคา: expired = อายุการใช้งาน (ปี), deprec = อัตราต่อปี (%)
                    a.expired, a.deprec,
                    -- ประเภทสินทรัพย์ ใช้เทียบกับช่วงอายุตามตารางที่ 1 ของหลักเกณฑ์ภาครัฐ
                    a.assetcatid, cat.catdesc AS assetcatname
             FROM   deprecia a
             LEFT OUTER JOIN company c ON c.companycode = a.company
             LEFT OUTER JOIN assetcat cat ON cat.assetcatid = a.assetcatid
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
