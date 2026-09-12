import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { searchEquipment, searchEquipmentV2, getDepreciationYearAssets, getDepreciationYearAssetsV2 } from '../controllers/equipmentController';

export const equipmentRoutes = new Elysia({ prefix: '/api/v1/equipment' })
    .use(authMiddleware)
    .get('/search', searchEquipment, {
        query: t.Object({ keyword: t.String({ minLength: 1 }) }),
        detail: {
            tags: ['Equipment'],
            summary: 'ค้นหาครุภัณฑ์',
            description: 'ค้นหาจากตาราง deprecia โดย noid, names, models, locates, fy, docno, notes, companyname (max 200 รายการ)',
        },
        error({ code, set }) {
            if (code === 'VALIDATION') {
                set.status = 400;
                return { success: false, message: 'กรุณาระบุ keyword ในการค้นหา' };
            }
        },
    })
    .get('/depreciation-year', getDepreciationYearAssets, {
        query: t.Object({ fy: t.String({ minLength: 4 }) }),
        detail: {
            tags: ['Equipment'],
            summary: 'ครุภัณฑ์ที่ยังคิดค่าเสื่อมในปีงบที่ระบุ',
            description: 'ข้อมูลดิบสำหรับรายงานสรุปค่าเสื่อมราคาประจำปี — กรองคร่าว ๆ ตามปีงบ (พ.ศ.) แล้วให้ฝั่งหน้าเว็บคำนวณยอดจริง',
        },
        error({ code, set }) {
            if (code === 'VALIDATION') {
                set.status = 400;
                return { success: false, message: 'กรุณาระบุปีงบประมาณ (พ.ศ.)' };
            }
        },
    });

// ทะเบียนครุภัณฑ์ระบบใหม่ (V2) — ฐานข้อมูลคนละเครื่อง
export const equipmentV2Routes = new Elysia({ prefix: '/api/v1/equipment-v2' })
    .use(authMiddleware)
    .get('/search', searchEquipmentV2, {
        query: t.Object({ keyword: t.String({ minLength: 1 }) }),
        detail: {
            tags: ['Equipment'],
            summary: 'ค้นหาครุภัณฑ์ (ระบบ V2)',
            description: 'ค้นหาจากตาราง deprecia บนเครื่อง EQUIPMENT_V2_HOST — โครงสร้างและรหัสหมวดต่างจากระบบเดิม',
        },
        error({ code, set }) {
            if (code === 'VALIDATION') {
                set.status = 400;
                return { success: false, message: 'กรุณาระบุ keyword ในการค้นหา' };
            }
        },
    })
    .get('/depreciation-year', getDepreciationYearAssetsV2, {
        query: t.Object({ fy: t.String({ minLength: 4 }) }),
        detail: {
            tags: ['Equipment'],
            summary: 'ครุภัณฑ์ที่ยังคิดค่าเสื่อมในปีงบที่ระบุ (ระบบ V2)',
            description: 'ข้อมูลดิบสำหรับรายงานสรุปค่าเสื่อมราคาประจำปีของทะเบียน V2',
        },
        error({ code, set }) {
            if (code === 'VALIDATION') {
                set.status = 400;
                return { success: false, message: 'กรุณาระบุปีงบประมาณ (พ.ศ.)' };
            }
        },
    });
