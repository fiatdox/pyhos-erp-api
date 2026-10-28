// จัดการเลขที่เงินเดือน (user_salary_ids) ของบุคลากรทั้งองค์กร
// สิทธิ์: IT_STAFF · ADMIN · ACCOUNT · FINANCE (เครื่องมือผู้ดูแล — เมนูอยู่ใน sidebar ขวา)
//
// 1 คนมีได้หลายเลข — เจ้าหน้าที่ที่เริ่มเป็นลูกจ้างแล้วได้บรรจุจะได้เลขใหม่
// ต้องผูกครบทุกเลขเพื่อให้ดูสลิปย้อนหลังได้ต่อเนื่อง
import { core_kon, salaryPool } from '../db/db';

export const SALARY_ID_ROLES = ['ADMIN', 'IT_STAFF', 'ACCOUNT', 'FINANCE'];

const err = (set: any, status: number, message: string) => {
    set.status = status;
    return { success: false, message };
};

export async function userRoles(userId: number): Promise<string[]> {
    const rows = await core_kon`
        SELECT r.role_name
        FROM core_kon.user_m_users_roles mu
        LEFT JOIN core_kon.user_roles r ON r.id = mu.role_id
        WHERE mu.user_id = ${userId}`;
    return rows.map((r: any) => String(r.role_name ?? '').toUpperCase());
}

export const hasAccess = (roles: string[]) => roles.some(r => SALARY_ID_ROLES.includes(r));

// ── ตรวจสอบความถูกต้องของการผูก: เทียบชื่อ-สกุลผู้ใช้ในระบบกับชื่อในทะเบียนเงินเดือน (dgpn_payroll) ──
export type PayrollName = { fname: string; lname: string };
export type NameMatch = 'match' | 'mismatch' | 'unknown';
const squash = (v: any) => String(v ?? '').replace(/\s+/g, '');
export function nameMatch(user: { fname?: string | null; lname?: string | null }, pay?: PayrollName | null): NameMatch {
    if (!pay || !squash(pay.fname)) return 'unknown';
    return squash(user.fname) === squash(pay.fname) && squash(user.lname) === squash(pay.lname) ? 'match' : 'mismatch';
}
// ⚠️ dgpn_payroll.id เป็น VARCHAR — ส่ง parameter เป็น string
export async function payrollNamesOf(ids: (string | number)[]): Promise<Map<string, PayrollName>> {
    const out = new Map<string, PayrollName>();
    const uniq = [...new Set(ids.map(String))];
    if (uniq.length === 0) return out;
    const [rows]: any = await salaryPool.query(
        `SELECT id, fname, lname FROM dgpn_payroll WHERE id IN (${uniq.map(() => '?').join(',')})`, uniq);
    for (const r of rows) out.set(String(r.id), { fname: String(r.fname ?? '').trim(), lname: String(r.lname ?? '').trim() });
    return out;
}

// ช่วงงวดเงินเดือนของแต่ละเลข — ให้ผู้ดูแลเห็นว่าเลขไหนครอบคลุมช่วงไหน
// ⚠️ dgpn_payrollmt.id เป็น VARCHAR(13) — ต้องส่ง parameter เป็น string
//    ถ้าส่ง number MySQL จะทิ้ง index แล้ว full scan ~1.6 ล้านแถว
async function periodsOf(salaryIds: number[]): Promise<Map<number, { from: string | null; to: string | null; count: number }>> {
    const out = new Map<number, { from: string | null; to: string | null; count: number }>();
    if (salaryIds.length === 0) return out;
    const ph = salaryIds.map(() => '?').join(',');
    const [rows]: any = await salaryPool.query(
        `SELECT id, MIN(mt) AS f, MAX(mt) AS t, COUNT(DISTINCT mt) AS n
         FROM dgpn_payrollmt WHERE id IN (${ph}) GROUP BY id`, salaryIds.map(String));
    for (const r of rows) out.set(Number(r.id), { from: r.f ?? null, to: r.t ?? null, count: Number(r.n) });
    return out;
}

// รายชื่อบุคลากร + เลขที่เงินเดือนทั้งหมดของแต่ละคน
// มีเลขที่เงินเดือน = ผูกในตาราง user_salary_ids หรือผู้ใช้กรอกเองที่ users.salary_id (หน้าตั้งค่าบัญชี)
// ต้องนับเหมือนสลิปเงินเดือน (accountingController.getSalaryIdsOf ใช้ UNION ทั้งสองแหล่ง)
const hasSalaryIdFrag = () => core_kon`(EXISTS (SELECT 1 FROM user_salary_ids x WHERE x.user_id = u.id) OR COALESCE(u.salary_id, 0) > 0)`;

export const getSalaryIdList = async ({ query, user, set }: any) => {
    try {
        if (!hasAccess(await userRoles(Number(user?.id)))) return err(set, 403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');

        const search = String(query?.search ?? '').trim();
        const status = String(query?.status ?? 'all');      // all | missing | filled
        const majorId = query?.major_id ? Number(query.major_id) : null;
        const limit = Math.min(Number(query?.limit ?? 50) || 50, 200);
        const offset = Math.max(Number(query?.offset ?? 0) || 0, 0);

        const searchFrag = search
            ? core_kon`AND (CONCAT(u.pname, u.fname, ' ', u.lname) ILIKE ${'%' + search + '%'}
                        OR u.username ILIKE ${'%' + search + '%'}
                        OR CAST(u.salary_id AS TEXT) ILIKE ${'%' + search + '%'}
                        OR EXISTS (SELECT 1 FROM user_salary_ids x WHERE x.user_id = u.id AND CAST(x.salary_id AS TEXT) ILIKE ${'%' + search + '%'}))`
            : core_kon``;
        const statusFrag = status === 'missing'
            ? core_kon`AND NOT ${hasSalaryIdFrag()}`
            : status === 'filled'
                ? core_kon`AND ${hasSalaryIdFrag()}`
                : core_kon``;
        const majorFrag = majorId ? core_kon`AND u.major_id = ${majorId}` : core_kon``;

        const [rows, countRows, statRows] = await Promise.all([
            core_kon`
                SELECT u.id, u.username, u.fname, u.lname,
                       CONCAT(u.pname, u.fname, ' ', u.lname) AS name,
                       up.position_name, mj.name AS major_name, sm.name AS submajor_name,
                       COALESCE(
                           (SELECT json_agg(e ORDER BY (e->>'is_current')::boolean DESC, (e->>'salary_id')::int) FROM (
                                SELECT json_build_object('salary_id', x.salary_id, 'is_current', x.is_current,
                                                         'source', x.source, 'note', x.note) AS e
                                FROM user_salary_ids x WHERE x.user_id = u.id
                                UNION ALL
                                -- เลขที่ผู้ใช้กรอกเอง ที่ยังไม่อยู่ในตารางผูก
                                SELECT json_build_object('salary_id', u.salary_id,
                                       'is_current', NOT EXISTS (SELECT 1 FROM user_salary_ids y WHERE y.user_id = u.id AND y.is_current),
                                       'source', 'self', 'note', NULL)
                                WHERE COALESCE(u.salary_id, 0) > 0
                                  AND NOT EXISTS (SELECT 1 FROM user_salary_ids y WHERE y.user_id = u.id AND y.salary_id = u.salary_id)
                            ) t), '[]'::json) AS salary_ids
                FROM users u
                LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
                LEFT JOIN majors mj    ON mj.major_id = u.major_id
                LEFT JOIN submajors sm ON sm.submajor_id = u.submajor_id
                WHERE u.is_active = 'Y' ${searchFrag} ${statusFrag} ${majorFrag}
                ORDER BY ${hasSalaryIdFrag()}, u.fname, u.lname
                LIMIT ${limit} OFFSET ${offset}`,
            core_kon`
                SELECT COUNT(*)::int AS total FROM users u
                WHERE u.is_active = 'Y' ${searchFrag} ${statusFrag} ${majorFrag}`,
            core_kon`
                SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE ${hasSalaryIdFrag()})::int AS filled,
                       COUNT(*) FILTER (WHERE NOT ${hasSalaryIdFrag()})::int AS missing,
                       COUNT(*) FILTER (WHERE COALESCE(u.salary_id, 0) > 0
                           AND NOT EXISTS (SELECT 1 FROM user_salary_ids x WHERE x.user_id = u.id))::int AS self_only,
                       (SELECT COUNT(*)::int FROM user_salary_ids)                       AS total_links,
                       (SELECT COUNT(*)::int FROM (SELECT user_id FROM user_salary_ids
                            GROUP BY user_id HAVING COUNT(*) > 1) t)                     AS multi_id_users
                FROM users u WHERE u.is_active = 'Y'`,
        ]);

        // ชื่อในทะเบียนเงินเดือนของแต่ละเลขที่ผูก + ผลเทียบกับชื่อผู้ใช้ — ให้ผู้ผูกตรวจว่าผูกถูกคน
        const names = await payrollNamesOf(rows.flatMap((r: any) => (r.salary_ids as any[]).map(x => x.salary_id)));
        const enriched = rows.map((r: any) => ({
            ...r,
            salary_ids: (r.salary_ids as any[]).map(x => {
                const pay = names.get(String(x.salary_id));
                return { ...x, payroll_name: pay ? `${pay.fname} ${pay.lname}`.trim() : null, name_match: nameMatch(r, pay) };
            }),
        }));

        return { success: true, data: { rows: enriched, total: countRows[0].total, limit, offset, stats: statRows[0] } };
    } catch (e: any) {
        console.error('[salaryId] getSalaryIdList:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// รายละเอียดของบุคลากร 1 คน: เลขที่ผูกไว้ (พร้อมช่วงงวด) + เลขที่ระบบค้นเจอแต่ยังไม่ได้ผูก
export const getUserSalaryIds = async ({ params, user, set }: any) => {
    try {
        if (!hasAccess(await userRoles(Number(user?.id)))) return err(set, 403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
        const uid = Number(params.id);

        const [target] = await core_kon`
            SELECT u.id, u.username, u.id_card, CONCAT(u.pname, u.fname, ' ', u.lname) AS name,
                   u.pname, u.fname, u.lname, u.salary_id
            FROM users u WHERE u.id = ${uid}`;
        if (!target) return err(set, 404, 'ไม่พบบุคลากรรายนี้');

        const linked: any[] = [...await core_kon`
            SELECT id, salary_id, is_current, source, note, created_at
            FROM user_salary_ids WHERE user_id = ${uid}
            ORDER BY is_current DESC, salary_id`];
        // เลขที่ผู้ใช้กรอกเอง (users.salary_id) ที่ยังไม่อยู่ในตารางผูก — id = null, ผู้ดูแลกด "ยืนยันผูก" เพื่อย้ายเข้าตาราง
        const selfId = Number(target.salary_id);
        if (selfId > 0 && !linked.some((r: any) => Number(r.salary_id) === selfId)) {
            linked.push({ id: null, salary_id: selfId, is_current: !linked.some((r: any) => r.is_current), source: 'self', note: null, created_at: null });
        }

        const linkedIds = linked.map((r: any) => Number(r.salary_id));
        const periods = await periodsOf(linkedIds);
        const payNames = await payrollNamesOf(linkedIds);
        const linkedWithPeriods = linked.map((r: any) => {
            const pay = payNames.get(String(r.salary_id));
            return {
                ...r, period: periods.get(Number(r.salary_id)) ?? null,
                payroll_name: pay ? `${pay.fname} ${pay.lname}`.trim() : null, name_match: nameMatch(target, pay),
            };
        });

        // ── ค้นเลขที่ยังไม่ได้ผูก ──
        // ทางที่ 1: จับคู่เลขบัตรประชาชน (dgpn_payroll.pid) — แม่นยำ แต่ 40% ของระเบียนไม่มี pid
        // ทางที่ 2: จับคู่ชื่อ-สกุล — ใช้เมื่อ pid ว่าง ต้องให้คนตรวจสอบก่อนผูก
        const suggestions: any[] = [];
        const seen = new Set(linkedIds);

        const idCard = String(target.id_card ?? '').trim();
        if (idCard.length === 13) {
            const [byPid]: any = await salaryPool.query(
                `SELECT id, fname, lname FROM dgpn_payroll WHERE TRIM(pid) = ?`, [idCard]);
            for (const r of byPid) {
                if (seen.has(Number(r.id))) continue;
                seen.add(Number(r.id));
                suggestions.push({ salary_id: Number(r.id), fname: r.fname, lname: r.lname, match: 'id_card', confidence: 'high' });
            }
        }

        const fn = String(target.fname ?? '').trim();
        const ln = String(target.lname ?? '').trim();
        if (fn && ln) {
            const [byName]: any = await salaryPool.query(
                `SELECT id, fname, lname, pid FROM dgpn_payroll
                 WHERE TRIM(fname) = ? AND TRIM(lname) = ?`, [fn, ln]);
            for (const r of byName) {
                if (seen.has(Number(r.id))) continue;
                seen.add(Number(r.id));
                suggestions.push({ salary_id: Number(r.id), fname: r.fname, lname: r.lname, match: 'name', confidence: 'medium' });
            }
        }

        // เลขที่คนอื่นผูกไว้แล้ว = ผูกซ้ำไม่ได้ ต้องบอกให้รู้
        const suggestIds = suggestions.map(s => s.salary_id);
        const taken = suggestIds.length > 0
            ? await core_kon`
                SELECT x.salary_id, CONCAT(u.pname, u.fname, ' ', u.lname) AS owner
                FROM user_salary_ids x LEFT JOIN users u ON u.id = x.user_id
                WHERE x.salary_id = ANY(${suggestIds})`
            : [];
        const takenMap = new Map(taken.map((t: any) => [Number(t.salary_id), t.owner]));

        const sPeriods = await periodsOf(suggestIds);
        const enriched = suggestions.map(s => ({
            ...s,
            period: sPeriods.get(s.salary_id) ?? null,
            taken_by: takenMap.get(s.salary_id) ?? null,
        })).sort((a, b) => (a.period?.from ?? '').localeCompare(b.period?.from ?? ''));

        return { success: true, data: { user: { id: target.id, name: target.name, username: target.username }, linked: linkedWithPeriods, suggestions: enriched } };
    } catch (e: any) {
        console.error('[salaryId] getUserSalaryIds:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// ผูกเลขที่เงินเดือนเพิ่มให้บุคลากร
export const addUserSalaryId = async ({ params, body, user, set }: any) => {
    try {
        const actorId = Number(user?.id);
        if (!hasAccess(await userRoles(actorId))) return err(set, 403, 'ไม่มีสิทธิ์แก้ไขข้อมูลนี้');

        const uid = Number(params.id);
        const salaryId = Number(body?.salary_id);
        if (!Number.isInteger(salaryId) || salaryId <= 0) return err(set, 400, 'เลขที่เงินเดือนต้องเป็นจำนวนเต็มบวก');

        const [target] = await core_kon`SELECT id FROM users WHERE id = ${uid}`;
        if (!target) return err(set, 404, 'ไม่พบบุคลากรรายนี้');

        const [dup] = await core_kon`
            SELECT x.user_id, CONCAT(u.pname, u.fname, ' ', u.lname) AS owner
            FROM user_salary_ids x LEFT JOIN users u ON u.id = x.user_id
            WHERE x.salary_id = ${salaryId}`;
        if (dup) {
            return Number(dup.user_id) === uid
                ? err(set, 409, 'ผูกเลขนี้ให้บุคลากรรายนี้อยู่แล้ว')
                : err(set, 409, `เลขที่เงินเดือน ${salaryId} ถูกผูกกับ ${dup.owner} แล้ว`);
        }
        // ผู้ใช้อื่นกรอกเลขนี้เองไว้ในหน้าตั้งค่าบัญชี
        const [selfDup] = await core_kon`
            SELECT CONCAT(pname, fname, ' ', lname) AS owner FROM users
            WHERE salary_id = ${salaryId} AND id <> ${uid} LIMIT 1`;
        if (selfDup) return err(set, 409, `เลขที่เงินเดือน ${salaryId} ถูกระบุไว้โดย ${selfDup.owner} (กรอกเองในหน้าตั้งค่า) — ตรวจสอบก่อนผูก`);

        const makeCurrent = body?.is_current === true;
        if (makeCurrent) await core_kon`UPDATE user_salary_ids SET is_current = FALSE WHERE user_id = ${uid}`;

        // ยังไม่มีเลขไหนเลย → เลขแรกเป็นเลขปัจจุบันโดยปริยาย
        const [existing] = await core_kon`SELECT COUNT(*)::int AS n FROM user_salary_ids WHERE user_id = ${uid}`;
        const isCurrent = makeCurrent || existing.n === 0;

        const [inserted] = await core_kon`
            INSERT INTO user_salary_ids (user_id, salary_id, is_current, source, note, created_by)
            VALUES (${uid}, ${salaryId}, ${isCurrent}, ${String(body?.source ?? 'manual')}, ${body?.note ?? null}, ${actorId})
            RETURNING id, salary_id, is_current`;

        if (isCurrent) await core_kon`UPDATE users SET salary_id = ${salaryId}, updated_at = NOW() WHERE id = ${uid}`;

        console.log(`[salaryId] user=${actorId} ผูกเลข ${salaryId} ให้ user=${uid} (current=${isCurrent})`);
        set.status = 201;
        return { success: true, data: inserted };
    } catch (e: any) {
        console.error('[salaryId] addUserSalaryId:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// ตั้งเลขปัจจุบัน / แก้หมายเหตุ
export const updateUserSalaryId = async ({ params, body, user, set }: any) => {
    try {
        const actorId = Number(user?.id);
        if (!hasAccess(await userRoles(actorId))) return err(set, 403, 'ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
        const linkId = Number(params.linkId);

        const [link] = await core_kon`SELECT id, user_id, salary_id FROM user_salary_ids WHERE id = ${linkId}`;
        if (!link) return err(set, 404, 'ไม่พบรายการนี้');

        if (body?.is_current === true) {
            await core_kon`UPDATE user_salary_ids SET is_current = FALSE WHERE user_id = ${link.user_id}`;
            await core_kon`UPDATE user_salary_ids SET is_current = TRUE WHERE id = ${linkId}`;
            await core_kon`UPDATE users SET salary_id = ${link.salary_id}, updated_at = NOW() WHERE id = ${link.user_id}`;
        }
        if (body?.note !== undefined) {
            await core_kon`UPDATE user_salary_ids SET note = ${body.note ?? null} WHERE id = ${linkId}`;
        }
        return { success: true };
    } catch (e: any) {
        console.error('[salaryId] updateUserSalaryId:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// ยกเลิกการผูกเลข
export const removeUserSalaryId = async ({ params, user, set }: any) => {
    try {
        const actorId = Number(user?.id);
        if (!hasAccess(await userRoles(actorId))) return err(set, 403, 'ไม่มีสิทธิ์แก้ไขข้อมูลนี้');
        const linkId = Number(params.linkId);

        const [removed] = await core_kon`DELETE FROM user_salary_ids WHERE id = ${linkId} RETURNING user_id, salary_id, is_current`;
        if (!removed) return err(set, 404, 'ไม่พบรายการนี้');

        // ถ้าลบเลขปัจจุบันออก ให้เลื่อนเลขที่เหลือขึ้นมาเป็นปัจจุบันแทน กัน users.salary_id ค้างเลขที่ถูกลบ
        if (removed.is_current) {
            const [next] = await core_kon`
                SELECT id, salary_id FROM user_salary_ids WHERE user_id = ${removed.user_id}
                ORDER BY salary_id DESC LIMIT 1`;
            if (next) {
                await core_kon`UPDATE user_salary_ids SET is_current = TRUE WHERE id = ${next.id}`;
                await core_kon`UPDATE users SET salary_id = ${next.salary_id}, updated_at = NOW() WHERE id = ${removed.user_id}`;
            } else {
                await core_kon`UPDATE users SET salary_id = NULL, updated_at = NOW() WHERE id = ${removed.user_id}`;
            }
        }
        console.log(`[salaryId] user=${actorId} ยกเลิกการผูกเลข ${removed.salary_id} ของ user=${removed.user_id}`);
        return { success: true };
    } catch (e: any) {
        console.error('[salaryId] removeUserSalaryId:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};

// กลุ่มงานสำหรับตัวกรอง
export const getSalaryIdMeta = async ({ user, set }: any) => {
    try {
        if (!hasAccess(await userRoles(Number(user?.id)))) return err(set, 403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลนี้');
        const majors = await core_kon`
            SELECT mj.major_id, mj.name, COUNT(u.id)::int AS staff_count
            FROM majors mj
            LEFT JOIN users u ON u.major_id = mj.major_id AND u.is_active = 'Y'
            WHERE mj.is_active = 'Y'
            GROUP BY mj.major_id, mj.name
            HAVING COUNT(u.id) > 0
            ORDER BY mj.name`;
        return { success: true, data: { majors } };
    } catch (e: any) {
        console.error('[salaryId] getSalaryIdMeta:', e);
        return err(set, 500, 'เกิดข้อผิดพลาดภายในระบบ');
    }
};
