// ── ปรับสายอนุมัติใบลาให้ตรงผังปัจจุบัน (หน้า /hr/leave/chain-resync — เฉพาะ ADMIN) ───────────
// ตรรกะอยู่ที่ services/leaveChainResync.ts
import { guard } from './hrLeaveNotifyController';
import { applyOne, listChainMismatches, listResyncLog, logTableReady, previewChainResync } from '../services/leaveChainResync';

const fail = (set: any, status: number, message: string) => { set.status = status; return { success: false, message }; };

export const getLeaveChainMismatches = async ({ user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        return { success: true, data: await listChainMismatches() };
    } catch (e: any) {
        console.error('[leaveChainResync] list:', e?.message);
        return fail(set, 500, 'ตรวจสายอนุมัติไม่สำเร็จ');
    }
};

const idOf = (params: any) => { const id = Number(params?.id); return Number.isInteger(id) && id > 0 ? id : null; };

export const previewLeaveChainResync = async ({ params, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const id = idOf(params);
        if (!id) return fail(set, 400, 'เลขที่ใบลาไม่ถูกต้อง');
        const data = await previewChainResync(id);
        return data ? { success: true, data } : fail(set, 404, 'ไม่พบใบลา');
    } catch (e: any) {
        console.error('[leaveChainResync] preview:', e?.message);
        return fail(set, 500, 'ตรวจสายอนุมัติไม่สำเร็จ');
    }
};

export const applyLeaveChainResync = async ({ params, body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const id = idOf(params);
        if (!id) return fail(set, 400, 'เลขที่ใบลาไม่ถูกต้อง');
        if (!(await logTableReady())) return fail(set, 409, 'ยังไม่ได้สร้างตารางประวัติ — รัน src/db/hr_leave_chain_resync.sql ก่อน');
        const note = String(body?.note ?? '').trim().slice(0, 500) || null;
        const result = await applyOne(id, Number(user.id), note);
        return result.ok ? { success: true, data: result } : fail(set, 409, result.message ?? 'ปรับไม่ได้');
    } catch (e: any) {
        console.error('[leaveChainResync] apply:', e?.message);
        return fail(set, 500, 'ปรับสายอนุมัติไม่สำเร็จ');
    }
};

export const getLeaveChainResyncLog = async ({ query, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        if (!(await logTableReady())) return { success: true, data: [] };
        const limit = Math.min(Math.max(Number(query?.limit) || 100, 1), 500);
        return { success: true, data: await listResyncLog(limit) };
    } catch (e: any) {
        console.error('[leaveChainResync] log:', e?.message);
        return fail(set, 500, 'โหลดประวัติไม่สำเร็จ');
    }
};
