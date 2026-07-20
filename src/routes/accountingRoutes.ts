import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getSalarySummary, getSalarySlip } from '../controllers/accountingController';

export const accountingRoutes = new Elysia({ prefix: '/api/v1/accounting' })
    .use(authMiddleware)
    // สรุปเงินเดือนรายเดือนของผู้ login (ใช้ users.salary_id เชื่อม dgpn_payrollmt)
    .get('/salary/summary', getSalarySummary, {
        query: t.Object({ year: t.Optional(t.String({ pattern: '^\\d{4}$' })) }),
        detail: { tags: ['Accounting'], summary: 'สรุปเงินเดือนรายเดือนของตัวเอง', description: 'รวมรายรับ/รายการหัก/สุทธิ ต่องวด (mt = พ.ศ. YYYYMM00) ตามปี พ.ศ. ที่เลือก + ปีที่มีข้อมูล + ข้อมูลบัญชีธนาคาร — 409 no_salary_id ถ้ายังไม่ผูกเลขที่เงินเดือน' }
    })
    // รายละเอียดสลิปงวดเดียว (ดู/พิมพ์ PDF)
    .get('/salary/slip/:mt', getSalarySlip, {
        params: t.Object({ mt: t.String({ pattern: '^\\d{8}$' }) }),
        detail: { tags: ['Accounting'], summary: 'สลิปเงินเดือนงวดเดียวของตัวเอง', description: 'รายการรายรับ (payrolltype=1) / รายการหัก (payrolltype=2) จาก dgpn_payrollmt JOIN cpayroll + ยอดรวมและบัญชีธนาคาร' }
    });
