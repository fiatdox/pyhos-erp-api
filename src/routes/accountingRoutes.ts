import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getSalarySummary, getSalarySlip } from '../controllers/accountingController';
import { getSalaryIdList, getUserSalaryIds, addUserSalaryId, updateUserSalaryId, removeUserSalaryId, getSalaryIdMeta } from '../controllers/salaryIdController';

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
    })
    // ── จัดการเลขที่เงินเดือนของบุคลากร (FINANCE / IT_STAFF / ADMIN) ─────────
    // เช็คสิทธิ์ใน controller เพื่อไม่ให้ requireRoles กระทบ 2 route ด้านบนที่ทุกคนใช้ได้
    .get('/salary-ids/meta', getSalaryIdMeta, {
        detail: { tags: ['Accounting'], summary: 'กลุ่มงานสำหรับตัวกรองหน้าจัดการเลขที่เงินเดือน' }
    })
    .get('/salary-ids', getSalaryIdList, {
        query: t.Object({
            search: t.Optional(t.String()),
            status: t.Optional(t.String()),
            major_id: t.Optional(t.Numeric()),
            limit: t.Optional(t.Numeric()),
            offset: t.Optional(t.Numeric()),
        }),
        detail: {
            tags: ['Accounting'],
            summary: 'รายชื่อบุคลากร + เลขที่เงินเดือน',
            description: 'ค้นหาจากชื่อ/ชื่อผู้ใช้/เลขที่เงินเดือน · status = all|missing|filled · เรียงผู้ที่ยังไม่มีเลขขึ้นก่อน — เฉพาะ FINANCE, IT_STAFF, ADMIN',
        }
    })
    .get('/salary-ids/:id', getUserSalaryIds, {
        params: t.Object({ id: t.Numeric() }),
        detail: {
            tags: ['Accounting'],
            summary: 'เลขที่เงินเดือนทั้งหมดของบุคลากร 1 คน + เลขที่ระบบค้นเจอ',
            description: 'linked = เลขที่ผูกแล้ว (พร้อมช่วงงวด) · suggestions = เลขที่ยังไม่ผูก ค้นจากเลขบัตร (แม่นยำสูง) และชื่อ-สกุล (ต้องตรวจสอบก่อน)',
        }
    })
    .post('/salary-ids/:id', addUserSalaryId, {
        params: t.Object({ id: t.Numeric() }),
        body: t.Object({
            salary_id: t.Numeric(),
            is_current: t.Optional(t.Boolean()),
            source: t.Optional(t.String()),
            note: t.Optional(t.Nullable(t.String())),
        }),
        detail: { tags: ['Accounting'], summary: 'ผูกเลขที่เงินเดือนเพิ่มให้บุคลากร', description: '409 ถ้าเลขถูกผูกกับคนอื่นแล้ว' }
    })
    .patch('/salary-ids/links/:linkId', updateUserSalaryId, {
        params: t.Object({ linkId: t.Numeric() }),
        body: t.Object({ is_current: t.Optional(t.Boolean()), note: t.Optional(t.Nullable(t.String())) }),
        detail: { tags: ['Accounting'], summary: 'ตั้งเป็นเลขปัจจุบัน / แก้หมายเหตุ' }
    })
    .delete('/salary-ids/links/:linkId', removeUserSalaryId, {
        params: t.Object({ linkId: t.Numeric() }),
        detail: { tags: ['Accounting'], summary: 'ยกเลิกการผูกเลขที่เงินเดือน' }
    });
