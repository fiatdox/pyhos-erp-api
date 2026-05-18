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
                    a.fy, a.docno, a.notes, c.companyname,a.perunits
             FROM   deprecia a
             LEFT OUTER JOIN company c ON c.companycode = a.company
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
