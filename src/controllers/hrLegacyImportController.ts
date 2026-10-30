import { core_kon } from '../db/db';
import { legacyConfigured, runLegacyLeaveImport, runLegacyServiceDates, type LeaveImportOptions } from '../services/legacyImport';
import { currentFiscalYear } from '../services/leaveRollover';

// ── งาน HR โอนข้อมูลจากโปรแกรมการลาเดิม (หน้า /hr/leave/legacy-import) ──────────────
//
// กดแล้วรันเบื้องหลัง (โอนทุกคนใช้เวลาหลายนาที) — หน้าเว็บดึงความคืบหน้าจาก hr_legacy_import_runs
// รันได้ทีละงาน · เซิร์ฟเวอร์ถูกรีสตาร์ตระหว่างรัน → งานที่ค้างถูกปิดเป็น FAILED ตอนเปิดดูรายการ
// แต่ละบุคลากรบันทึกใน transaction ของตัวเอง และรันซ้ำได้ (ใบที่โอนแล้วข้าม) จึงสั่งใหม่ได้เลย

const serverError = (set: any, where: string, error: any) => {
    console.error(`[hrLegacyImport] ${where}:`, error);
    set.status = 500;
    return { success: false, message: 'เกิดข้อผิดพลาดภายในระบบ' };
};
const fail = (set: any, status: number, message: string) => {
    set.status = status;
    return { success: false, message };
};

let runningId: number | null = null;
const REPORT_MAX = 2_000_000;   // ตัวอักษร — โอนทุกคนรายงานยาว ตัดท้ายถ้าเกิน

/** งานที่สถานะ RUNNING แต่ไม่ได้รันอยู่จริงใน process นี้ = ค้างจากการรีสตาร์ต */
const closeStaleRuns = () => core_kon`
    UPDATE hr_legacy_import_runs SET status = 'FAILED', error = 'เซิร์ฟเวอร์ถูกรีสตาร์ตระหว่างทำงาน — สั่งใหม่ได้ (ใบที่โอนแล้วจะข้าม)', finished_at = now()
    WHERE status = 'RUNNING' AND id <> ${runningId ?? 0}`;

export const getLegacyImportOptions = async ({ set }: any) => {
    try {
        const missions = await core_kon`SELECT mission_id AS id, name FROM missions ORDER BY mission_id`;
        return {
            success: true,
            data: { configured: legacyConfigured(), current_fiscal_year: currentFiscalYear(), missions, running_id: runningId },
        };
    } catch (error: any) { return serverError(set, 'getLegacyImportOptions', error); }
};

export const listLegacyImportRuns = async ({ set }: any) => {
    try {
        await closeStaleRuns();
        const rows = await core_kon`
            SELECT r.id, r.kind, r.mode, r.params, r.status, r.progress, r.total, r.totals, r.error,
                   r.created_at, r.finished_at, CONCAT(u.fname, ' ', u.lname) AS created_by_name
            FROM hr_legacy_import_runs r LEFT JOIN users u ON u.id = r.created_by
            ORDER BY r.id DESC LIMIT 50`;
        return { success: true, data: rows };
    } catch (error: any) { return serverError(set, 'listLegacyImportRuns', error); }
};

export const getLegacyImportRun = async ({ params, set }: any) => {
    try {
        const [row] = await core_kon`SELECT * FROM hr_legacy_import_runs WHERE id = ${Number(params?.id)}`;
        if (!row) return fail(set, 404, 'ไม่พบงานนี้');
        return { success: true, data: row };
    } catch (error: any) { return serverError(set, 'getLegacyImportRun', error); }
};

export const startLegacyImportRun = async ({ body, user, set }: any) => {
    try {
        if (!legacyConfigured()) return fail(set, 400, 'ยังไม่ได้ตั้งค่าการเชื่อมต่อฐานข้อมูลโปรแกรมเดิม (DB_LEAVE_*)');
        if (runningId != null) return fail(set, 409, `มีงานโอนข้อมูลกำลังทำอยู่ (งาน #${runningId}) รอให้เสร็จก่อน`);
        const kind = body?.kind === 'SERVICE_DATES' ? 'SERVICE_DATES' : 'LEAVE';
        const mode = ['DRY_RUN', 'COMMIT', 'UNDO'].includes(body?.mode) ? body.mode : 'DRY_RUN';
        if (kind === 'SERVICE_DATES' && mode === 'UNDO') return fail(set, 400, 'การโอนวันเริ่มงานถอนจากหน้านี้ไม่ได้');

        let params: any;
        if (kind === 'LEAVE') {
            const fy = Number(body?.fiscal_year);
            if (!Number.isInteger(fy) || fy < 2560 || fy > currentFiscalYear() + 1) return fail(set, 400, 'ปีงบประมาณไม่ถูกต้อง');
            const scope = ['all', 'mission', 'user'].includes(body?.scope) ? body.scope : null;
            if (!scope) return fail(set, 400, 'กรุณาเลือกขอบเขตการโอน');
            if (scope === 'mission' && !Number.isInteger(Number(body?.mission_id))) return fail(set, 400, 'กรุณาเลือกกลุ่มภารกิจ');
            if (scope === 'user' && !Number.isInteger(Number(body?.user_id))) return fail(set, 400, 'กรุณาเลือกบุคลากร');
            params = { fiscal_year: fy, scope, mission_id: scope === 'mission' ? Number(body.mission_id) : undefined, user_id: scope === 'user' ? Number(body.user_id) : undefined };
            // ป้ายชื่อขอบเขตไว้แสดงในประวัติ
            if (scope === 'mission') params.scope_label = (await core_kon`SELECT name FROM missions WHERE mission_id = ${params.mission_id}`)[0]?.name ?? null;
            if (scope === 'user') params.scope_label = (await core_kon`SELECT CONCAT(pname, fname, ' ', lname) AS n FROM users WHERE id = ${params.user_id}`)[0]?.n ?? null;
        } else {
            params = { fill_hire_date: !!body?.fill_hire_date };
        }

        const [run] = await core_kon`
            INSERT INTO hr_legacy_import_runs (kind, mode, params, created_by)
            VALUES (${kind}, ${mode}, ${JSON.stringify(params)}::text::jsonb, ${Number(user?.id) || null})
            RETURNING id`;
        runningId = Number(run.id);
        void execute(runningId, kind, mode, params);
        return { success: true, data: { id: runningId }, message: 'เริ่มทำงานแล้ว' };
    } catch (error: any) { return serverError(set, 'startLegacyImportRun', error); }
};

const execute = async (id: number, kind: string, mode: string, params: any) => {
    const lines: string[] = [];
    let size = 0;
    const log = (line: string) => { if (size < REPORT_MAX) { lines.push(line); size += line.length + 1; } };
    let last = 0;
    const progress = async (done: number, total: number) => {
        if (Date.now() - last < 1500 && done < total) return;
        last = Date.now();
        await core_kon`UPDATE hr_legacy_import_runs SET progress = ${done}, total = ${total} WHERE id = ${id}`;
    };
    try {
        let totals: any;
        if (kind === 'LEAVE') {
            const opts: LeaveImportOptions = {
                fy: params.fiscal_year, scope: params.scope, missionId: params.mission_id, userId: params.user_id,
                commit: mode !== 'DRY_RUN', undo: mode === 'UNDO',
            };
            totals = await runLegacyLeaveImport(opts, log, progress);
        } else {
            const { filled_ids: _ids, ...rest } = await runLegacyServiceDates({ commit: mode === 'COMMIT', fillHireDate: params.fill_hire_date }, log);
            totals = rest;
        }
        if (size >= REPORT_MAX) lines.push('… (รายงานยาวเกิน ตัดส่วนท้ายออก)');
        await core_kon`
            UPDATE hr_legacy_import_runs
            SET status = 'DONE', totals = ${JSON.stringify(totals)}::text::jsonb, report = ${lines.join('\n')},
                progress = GREATEST(progress, total), finished_at = now()
            WHERE id = ${id}`;
    } catch (error: any) {
        console.error(`[hrLegacyImport] run #${id}:`, error);
        await core_kon`
            UPDATE hr_legacy_import_runs
            SET status = 'FAILED', error = ${String(error?.message ?? error).slice(0, 1000)}, report = ${lines.join('\n')}, finished_at = now()
            WHERE id = ${id}`.catch(() => {});
    } finally {
        runningId = null;
    }
};
