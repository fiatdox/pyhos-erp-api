// เดินทางไปราชการ (งานพัฒนาทรัพยากรบุคคล HRD · พรส) — โหมดการลงนามตามกลุ่ม · ตาราง src/db/hrd_travel_sign_mode.sql
//   esign = ลงนามอิเล็กทรอนิกส์ผ่านระบบ (ผอ. เซ็นจริง) · paper = เดินเอกสารให้เซ็นเองทุกช่อง
//   โหมดของผู้ขอ = กลุ่มงาน → กลุ่มภารกิจ → ค่าเริ่มต้น
// สิทธิ์: ADMIN / HRD (แบบฟอร์มขอไปราชการได้โหมดของผู้ขอจาก /requests/meta)
import { core_kon } from '../db/db';
import { guard } from './hrdTravelController';

export const SIGN_MODES = ['esign', 'paper'] as const;
export type SignMode = typeof SIGN_MODES[number];
const UNIT_TYPES = ['default', 'mission', 'major'] as const;
type UnitType = typeof UNIT_TYPES[number];

const fail = (set: any, status: number, message: string, field?: string) => { set.status = status; return { success: false, message, ...(field ? { field } : {}) }; };
class Bad extends Error { constructor(public status: number, message: string, public field?: string) { super(message); } }

const working = (s: any = core_kon) => s`u.is_active = 'Y' AND COALESCE(u.user_status_id, 1) = 1
    AND (u.work_end_date IS NULL OR u.work_end_date >= CURRENT_DATE)`;

/** โหมดการลงนามของบุคลากรหนึ่งคน + ที่มา (major / mission / default) */
export const signModeOf = async (s: any, uid: number): Promise<{ mode: SignMode; source: UnitType }> => {
    const [r] = await s`
        SELECT mj.mode AS major_mode, mi.mode AS mission_mode, d.mode AS default_mode
        FROM users u
        LEFT JOIN majors m ON m.major_id = u.major_id
        LEFT JOIN hrd_travel_sign_modes mj ON mj.unit_type = 'major' AND mj.unit_id = u.major_id
        LEFT JOIN hrd_travel_sign_modes mi ON mi.unit_type = 'mission' AND mi.unit_id = COALESCE(m.mission_id, u.mission_id)
        LEFT JOIN hrd_travel_sign_modes d ON d.unit_type = 'default' AND d.unit_id = 0
        WHERE u.id = ${uid}`;
    if (r?.major_mode) return { mode: r.major_mode, source: 'major' };
    if (r?.mission_mode) return { mode: r.mission_mode, source: 'mission' };
    return { mode: r?.default_mode ?? 'esign', source: 'default' };
};

export const getSignModes = async ({ user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const [modes, missions, majors, [{ no_major }]] = await Promise.all([
            core_kon`SELECT unit_type, unit_id, mode FROM hrd_travel_sign_modes`,
            core_kon`SELECT mission_id AS id, name FROM missions WHERE is_active = 'Y' ORDER BY mission_id`,
            // บุคลากรที่ปฏิบัติงานในแต่ละกลุ่มงาน
            core_kon`SELECT m.major_id AS id, m.name, m.mission_id,
                            (SELECT count(*)::int FROM users u WHERE u.major_id = m.major_id AND ${working()}) AS people
                     FROM majors m WHERE m.is_active = 'Y' ORDER BY m.mission_id NULLS LAST, m.major_id`,
            core_kon`SELECT count(*)::int AS no_major FROM users u WHERE ${working()} AND u.major_id IS NULL`,
        ]);
        const modeOf = (t: UnitType, id: number) => modes.find((x: any) => x.unit_type === t && Number(x.unit_id) === Number(id))?.mode ?? null;
        const missionIds = new Set(missions.map((m: any) => Number(m.id)));
        const majorOut = (m: any) => ({ id: m.id, name: m.name, people: m.people, mode: modeOf('major', m.id) });
        return {
            success: true,
            data: {
                default_mode: modeOf('default', 0) ?? 'esign',
                missions: missions.map((mi: any) => ({
                    id: mi.id, name: mi.name, mode: modeOf('mission', mi.id),
                    majors: majors.filter((m: any) => Number(m.mission_id) === Number(mi.id)).map(majorOut),
                })),
                // กลุ่มงานที่ไม่ได้อยู่ใต้กลุ่มภารกิจที่เปิดใช้ = ตั้งที่กลุ่มงาน หรือใช้ค่าเริ่มต้น
                orphan_majors: majors.filter((m: any) => !missionIds.has(Number(m.mission_id))).map(majorOut),
                no_major,
            },
        };
    } catch (e: any) {
        console.error('[hrdSignMode] get:', e?.message);
        return fail(set, 500, 'โหลดการตั้งค่าโหมดการลงนามไม่สำเร็จ');
    }
};

// body { unit_type: default|mission|major, unit_id, mode: esign|paper|null } · null = ตามระดับบน (ค่าเริ่มต้นต้องมีโหมดเสมอ)
// มีผลกับคำขอที่ยื่น/แก้ไขหลังจากนี้ คำขอเดิมใช้โหมด ณ วันยื่น
export const setSignMode = async ({ body, user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const unitType = UNIT_TYPES.includes(body?.unit_type) ? body.unit_type as UnitType : null;
        if (!unitType) return fail(set, 400, 'ระบุระดับที่ตั้ง (ค่าเริ่มต้น / กลุ่มภารกิจ / กลุ่มงาน)', 'unit_type');
        const unitId = unitType === 'default' ? 0 : Number(body?.unit_id);
        if (unitType !== 'default' && (!Number.isInteger(unitId) || unitId <= 0)) return fail(set, 400, 'ระบุกลุ่ม', 'unit_id');
        const mode = body?.mode === null || body?.mode === undefined ? null : SIGN_MODES.includes(body.mode) ? body.mode as SignMode : undefined;
        if (mode === undefined) return fail(set, 400, 'เลือกโหมดการลงนาม (ลงนามในระบบ / เดินเอกสาร)', 'mode');
        if (unitType === 'default' && mode === null) return fail(set, 400, 'ค่าเริ่มต้นต้องเลือกโหมดการลงนาม', 'mode');
        const actor = Number(user.id);
        const changed = await core_kon.begin(async (sql: any) => {
            const [unit] = unitType === 'default' ? [{ name: 'ค่าเริ่มต้น' }]
                : unitType === 'mission' ? await sql`SELECT name FROM missions WHERE mission_id = ${unitId} AND is_active = 'Y'`
                    : await sql`SELECT name FROM majors WHERE major_id = ${unitId} AND is_active = 'Y'`;
            if (!unit) throw new Bad(404, unitType === 'mission' ? 'ไม่พบกลุ่มภารกิจ' : 'ไม่พบกลุ่มงาน');
            const [cur] = await sql`SELECT mode FROM hrd_travel_sign_modes WHERE unit_type = ${unitType} AND unit_id = ${unitId} FOR UPDATE`;
            if ((cur?.mode ?? null) === mode) return false;
            if (mode === null) await sql`DELETE FROM hrd_travel_sign_modes WHERE unit_type = ${unitType} AND unit_id = ${unitId}`;
            else await sql`INSERT INTO hrd_travel_sign_modes (unit_type, unit_id, mode, updated_by) VALUES (${unitType}, ${unitId}, ${mode}, ${actor})
                ON CONFLICT (unit_type, unit_id) DO UPDATE SET mode = EXCLUDED.mode, updated_by = EXCLUDED.updated_by, updated_at = NOW()`;
            await sql`INSERT INTO hrd_travel_sign_mode_log (unit_type, unit_id, unit_name, before, after, changed_by)
                VALUES (${unitType}, ${unitId}, ${unit.name}, ${cur?.mode ?? null}, ${mode}, ${actor})`;
            return true;
        });
        return { success: true, data: { changed } };
    } catch (e: any) {
        if (e instanceof Bad) return fail(set, e.status, e.message, e.field);
        console.error('[hrdSignMode] set:', e?.message);
        return fail(set, 500, 'บันทึกโหมดการลงนามไม่สำเร็จ');
    }
};

// ประวัติการเปลี่ยนโหมด (ล่าสุด 200)
export const getSignModeLog = async ({ user, set }: any) => {
    try {
        const denied = await guard(user, set); if (denied) return denied;
        const rows = await core_kon`
            SELECT l.id, l.unit_type, l.unit_id, l.unit_name, l.before, l.after, l.changed_at, CONCAT(c.pname, c.fname, ' ', c.lname) AS changed_by_name
            FROM hrd_travel_sign_mode_log l LEFT JOIN users c ON c.id = l.changed_by
            ORDER BY l.changed_at DESC, l.id DESC LIMIT 200`;
        return { success: true, data: rows };
    } catch (e: any) {
        console.error('[hrdSignMode] log:', e?.message);
        return fail(set, 500, 'โหลดประวัติไม่สำเร็จ');
    }
};
