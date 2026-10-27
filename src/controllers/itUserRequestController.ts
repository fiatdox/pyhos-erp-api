import { core_kon } from '../db/db';
import { sendCredentialIssuedAlert } from '../utils/mophAlert';
import { mophUserRequestNotify, mophCredentialIssuedNotify } from '../utils/mophNotify';

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

// แปลง ?sort=-request_date → fragment ORDER BY ที่ปลอดภัย (fixed fragments ตาม whitelist)
const buildOrderBy = (sortRaw?: string) => {
    const raw = (sortRaw || '-request_date').trim();
    const desc = raw.startsWith('-');
    const field = raw.replace(/^[-+]/, '');
    switch (field) {
        case 'request_no':
            return desc ? core_kon`ORDER BY r.request_no DESC, r.id DESC` : core_kon`ORDER BY r.request_no ASC, r.id ASC`;
        case 'status':
            return desc ? core_kon`ORDER BY r.status DESC, r.id DESC` : core_kon`ORDER BY r.status ASC, r.id ASC`;
        case 'created_at':
            return desc ? core_kon`ORDER BY r.created_at DESC, r.id DESC` : core_kon`ORDER BY r.created_at ASC, r.id ASC`;
        case 'request_date':
        default:
            return desc ? core_kon`ORDER BY r.request_date DESC, r.id DESC` : core_kon`ORDER BY r.request_date ASC, r.id ASC`;
    }
};

// resolve user id → ชื่อเต็ม (ใช้ตอนสร้างข้อความการ์ดแจ้งเตือน/หมายเหตุ)
// ถ้าไม่ใช่ตัวเลขล้วน หรือหาไม่เจอ คืนค่าเดิม
const resolveUserName = async (idOrName: any): Promise<string> => {
    const v = (idOrName ?? '').toString().trim();
    if (!v || !/^[0-9]+$/.test(v)) return v;
    const [u] = await core_kon`
        SELECT NULLIF(TRIM(CONCAT(pname, fname, ' ', lname)), '') AS full_name
        FROM users WHERE id = ${Number(v)}
    `;
    return u?.full_name || v;
};

// สร้างเลขที่คำร้อง REQ-{YYYYMM}{NNN} (running ต่อเดือน)
const nextRequestNo = async (d = new Date()): Promise<string> => {
    const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
    const [row] = await core_kon`
        SELECT COALESCE(MAX(CAST(RIGHT(request_no, 3) AS INTEGER)), 0) AS max_seq
        FROM it_user_requests
        WHERE request_no LIKE ${'REQ-' + ym + '%'}
    `;
    const seq = (Number(row.max_seq) + 1).toString().padStart(3, '0');
    return `REQ-${ym}${seq}`;
};

// ── เลขที่ใบอนุญาตประกอบวิชาชีพ ─────────────────────────────────────
// ระบบที่ it_user_systems.requires_license = 'Y' (HIS) + ตำแหน่งที่ user_positions.license_type ไม่ว่าง → บังคับกรอก
// ตำแหน่งยึดจาก users ในระบบก่อน (กันผู้ยื่นแก้ position_name เอง) ไม่มี user ค่อยใช้ชื่อตำแหน่งที่ส่งมา
const LICENSE_NO_RE = /^(?=.*\d)[0-9A-Za-z\u0E00-\u0E7F.\-\/ ]{3,30}$/;

const positionLicense = async (userId: number | null, positionName: string | null) => {
    if (userId) {
        const [u] = await core_kon`
            SELECT up.position_name, up.license_type
            FROM users u LEFT JOIN user_positions up ON up.user_position_id = u.user_position_id
            WHERE u.id = ${userId}
        `;
        if (u?.position_name) return { position_name: u.position_name as string, license_type: (u.license_type as string) ?? null };
    }
    if (!positionName) return { position_name: null, license_type: null };
    const [p] = await core_kon`
        SELECT position_name, license_type FROM user_positions WHERE position_name = ${positionName.trim()} LIMIT 1
    `;
    return { position_name: positionName, license_type: (p?.license_type as string) ?? null };
};

const isItStaff = async (userId: number) => {
    const [r] = await core_kon`
        SELECT 1 FROM user_m_users_roles mu JOIN user_roles r ON r.id = mu.role_id
        WHERE mu.user_id = ${userId} AND UPPER(r.role_name) IN ('ADMIN', 'IT_STAFF')
        LIMIT 1
    `;
    return !!r;
};

// ── แบบยินยอมเงื่อนไขการใช้งาน ───────────────────────────────────────
// clauses เก็บ 1 บรรทัด = 1 ข้อ → ส่งออกเป็น array
const toConsentTerm = (t: any) => t && ({
    id: Number(t.id), version: t.version, title: t.title,
    clauses: String(t.clauses ?? '').split(/\r?\n/).map((x: string) => x.trim()).filter(Boolean),
});

// SELECT มาตรฐานของคำร้อง (JOIN ระบบ + resolve ชื่อผู้บันทึก/ผู้ออกรหัสจาก user id) — ใช้ทั้ง list และ detail
// created_by/updated_by/issued_by เก็บเป็น user id (VARCHAR) → cast ปลอดภัยเฉพาะค่าตัวเลขล้วน
// (เผื่อข้อมูลเก่าที่เคยเก็บเป็น username string จะไม่ join และ *_name = NULL)
const requestSelect = (whereExtra: any) => core_kon`
    SELECT
        r.id, r.request_no, r.request_date::text,
        r.requester_user_id, r.requester_name, r.position_name, r.department, r.phone,
        r.system_id, s.system_code, s.name_th AS system_name,
        r.purpose, r.license_type, r.license_no, r.status,
        r.consent_term_id, ct.version AS consent_version, r.consent_accepted_at, r.consent_method,
        r.issued_by,
        NULLIF(TRIM(CONCAT(ui.pname, ui.fname, ' ', ui.lname)), '') AS issued_by_name,
        r.issued_date::text, r.notified_at, r.note,
        r.is_active,
        r.created_by,
        NULLIF(TRIM(CONCAT(uc.pname, uc.fname, ' ', uc.lname)), '') AS created_by_name,
        r.created_at,
        r.updated_by,
        NULLIF(TRIM(CONCAT(uu.pname, uu.fname, ' ', uu.lname)), '') AS updated_by_name,
        r.updated_at
    FROM it_user_requests r
    JOIN it_user_systems s ON r.system_id = s.id
    LEFT JOIN it_user_consent_terms ct ON ct.id = r.consent_term_id
    LEFT JOIN users uc ON uc.id = CASE WHEN r.created_by ~ '^[0-9]+$' THEN r.created_by::int END
    LEFT JOIN users uu ON uu.id = CASE WHEN r.updated_by ~ '^[0-9]+$' THEN r.updated_by::int END
    LEFT JOIN users ui ON ui.id = CASE WHEN r.issued_by  ~ '^[0-9]+$' THEN r.issued_by::int  END
    WHERE r.is_active = 'Y'
    ${whereExtra}
`;

// ────────────────────────────────────────────────────────────────
// 1) GET /systems  — master ระบบที่เปิดให้ขอใช้งาน
// ────────────────────────────────────────────────────────────────
export const getUserSystems = async ({ query, set }: any) => {
    try {
        const activeOnly = query?.active_only !== 'false';
        const rows = await core_kon`
            SELECT id, system_code, name_th AS label, name_en, icon_key, color, sort_order, is_active,
                   requires_license
            FROM it_user_systems
            ${activeOnly ? core_kon`WHERE is_active = 'Y'` : core_kon``}
            ORDER BY sort_order ASC, id ASC
        `;
        return { success: true, data: rows };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 2) GET /  — รายการคำร้อง (filter + pagination)
// ────────────────────────────────────────────────────────────────
export const getUserRequests = async ({ query, set }: any) => {
    try {
        const page = Math.max(1, Number(query?.page) || 1);
        const limit = Math.min(200, Math.max(1, Number(query?.limit) || 50));
        const offset = (page - 1) * limit;

        const status = query?.status || null;
        const systemId = query?.system_id ? Number(query.system_id) : null;
        const dateFrom = query?.date_from || null;
        const dateTo = query?.date_to || null;
        const search = query?.search || null;

        const filter = core_kon`
            ${status ? core_kon`AND r.status = ${status}` : core_kon``}
            ${systemId ? core_kon`AND r.system_id = ${systemId}` : core_kon``}
            ${dateFrom ? core_kon`AND r.request_date >= ${dateFrom}::date` : core_kon``}
            ${dateTo ? core_kon`AND r.request_date <= ${dateTo}::date` : core_kon``}
            ${search ? core_kon`AND (
                r.request_no      ILIKE ${'%' + search + '%'}
                OR r.requester_name ILIKE ${'%' + search + '%'}
                OR r.department    ILIKE ${'%' + search + '%'}
                OR r.purpose       ILIKE ${'%' + search + '%'}
                OR r.license_no    ILIKE ${'%' + search + '%'}
                OR s.name_th       ILIKE ${'%' + search + '%'}
            )` : core_kon``}
        `;

        const rows = await core_kon`
            ${requestSelect(filter)}
            ${buildOrderBy(query?.sort)}
            LIMIT ${limit} OFFSET ${offset}
        `;

        const [countRow] = await core_kon`
            SELECT COUNT(*) AS total
            FROM it_user_requests r
            JOIN it_user_systems s ON r.system_id = s.id
            WHERE r.is_active = 'Y'
            ${filter}
        `;

        const total = Number(countRow.total);
        return {
            success: true,
            data: rows,
            pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 3) POST /  — สร้างคำร้องใหม่ (status=pending, สร้าง request_no อัตโนมัติ)
// ────────────────────────────────────────────────────────────────
export const createUserRequest = async ({ body, user, set }: any) => {
    try {
        const {
            requester_user_id = null,
            requester_name,
            position_name = null,
            department = null,
            phone = null,
            system_id,
            purpose = null,
            note = null,
        } = body;

        // ตรวจว่าระบบที่ขอมีอยู่จริงและเปิดใช้งาน (ไม่มี FK constraint จึงเช็คเอง)
        const [sys] = await core_kon`
            SELECT id, name_th, requires_license FROM it_user_systems WHERE id = ${system_id} AND is_active = 'Y'
        `;
        if (!sys) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'system_id ไม่พบหรือถูกปิดใช้งาน', field: 'system_id' } };
        }

        // ต้องยอมรับข้อตกลงฉบับปัจจุบัน — ฉบับเปลี่ยนระหว่างกรอกฟอร์ม ให้อ่านใหม่
        const [term] = await core_kon`SELECT id FROM it_user_consent_terms WHERE is_active = 'Y'`;
        if (term) {
            if (body.consent_accepted !== true || Number(body.consent_term_id) !== Number(term.id)) {
                set.status = body.consent_accepted === true ? 409 : 400;
                return { success: false, error: { code: 'CONSENT_REQUIRED', message: body.consent_accepted === true ? 'ข้อตกลงการใช้งานมีการปรับปรุง กรุณาอ่านและยอมรับฉบับปัจจุบันอีกครั้ง' : 'กรุณาอ่านและยอมรับข้อตกลงการใช้งานระบบก่อนส่งคำร้อง', field: 'consent_accepted' } };
            }
        }
        // ผู้ขอกดเอง = self, เจ้าหน้าที่บันทึกแทน = staff (ผู้ขอลงนามในแบบพิมพ์)
        const consentTermId: number | null = term ? Number(term.id) : null;
        const consentMethod = !term ? null
            : (requester_user_id != null && Number(user?.id) === Number(requester_user_id) ? 'self' : 'staff');

        // ระบบ HIS + ตำแหน่งวิชาชีพ → ต้องมีเลขใบอนุญาตประกอบวิชาชีพ
        const licenseNoRaw = typeof body.license_no === 'string' ? body.license_no.trim().replace(/\s+/g, ' ') : '';
        let licenseType: string | null = null;
        let licenseNo: string | null = null;
        if (sys.requires_license === 'Y') {
            const pos = await positionLicense(requester_user_id, position_name);
            licenseType = pos.license_type;
            if (licenseType && !licenseNoRaw) {
                set.status = 400;
                return { success: false, error: { code: 'VALIDATION_ERROR', message: `ตำแหน่ง${pos.position_name} ต้องระบุเลขที่ใบอนุญาตประกอบวิชาชีพ (${licenseType}) เพื่อขอรหัส ${sys.name_th}`, field: 'license_no' } };
            }
        }
        if (licenseNoRaw) {
            if (!LICENSE_NO_RE.test(licenseNoRaw)) {
                set.status = 400;
                return { success: false, error: { code: 'VALIDATION_ERROR', message: 'รูปแบบเลขที่ใบอนุญาตไม่ถูกต้อง (3–30 ตัว ต้องมีตัวเลข ใช้ได้เฉพาะตัวอักษร ตัวเลข . - /)', field: 'license_no' } };
            }
            licenseNo = licenseNoRaw;
        }

        const createdBy: string | null = user?.id != null ? String(user.id) : null;

        // retry เผื่อ request_no ชนกัน (unique) ภายใต้ concurrency
        let lastErr: any = null;
        for (let attempt = 0; attempt < 3; attempt++) {
            const requestNo = await nextRequestNo();
            try {
                const [row] = await core_kon`
                    INSERT INTO it_user_requests (
                        request_no, requester_user_id, requester_name, position_name,
                        department, phone, system_id, purpose, note, status, created_by,
                        license_type, license_no,
                        consent_term_id, consent_accepted_at, consent_method
                    ) VALUES (
                        ${requestNo}, ${requester_user_id}, ${requester_name}, ${position_name},
                        ${department}, ${phone}, ${system_id}, ${purpose}, ${note}, 'pending', ${createdBy},
                        ${licenseType}, ${licenseNo},
                        ${consentTermId}, ${consentTermId ? core_kon`NOW()` : null}, ${consentMethod}
                    )
                    RETURNING id, request_no, status, created_at
                `;
                // แจ้งเข้ากลุ่มงาน IT แบบ best-effort — ส่งไม่สำเร็จไม่ทำให้สร้างคำร้องล้ม
                try {
                    await mophUserRequestNotify({
                        requestNo: row.request_no,
                        systemName: sys.name_th,
                        requesterName: requester_name,
                        positionName: position_name ?? undefined,
                        department: department ?? undefined,
                        phone: phone ?? undefined,
                        purpose: purpose ?? undefined,
                        licenseNo: licenseNo ? `${licenseNo}${licenseType ? ` (${licenseType})` : ''}` : undefined,
                    });
                } catch (notifyErr: any) {
                    console.error('[createUserRequest] MOPH notify failed:', notifyErr.message);
                }

                set.status = 201;
                return { success: true, data: row };
            } catch (e: any) {
                lastErr = e;
                if (e.code === '23505') continue; // request_no ชน — สร้างใหม่
                throw e;
            }
        }
        throw lastErr;
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// GET /consent-terms/current | /consent-terms/:id  — ข้อตกลงการใช้งาน (ฉบับปัจจุบัน / ฉบับที่คำร้องยอมรับ)
// ────────────────────────────────────────────────────────────────
export const getConsentTerm = async ({ params, set }: any) => {
    try {
        const [row] = params?.id === 'current' || params?.id == null
            ? await core_kon`SELECT id, version, title, clauses FROM it_user_consent_terms WHERE is_active = 'Y'`
            : await core_kon`SELECT id, version, title, clauses FROM it_user_consent_terms WHERE id = ${Number(params.id)}`;
        if (!row) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบข้อตกลงการใช้งาน' } };
        }
        return { success: true, data: toConsentTerm(row) };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// GET /license-rule?user_id=  — ตำแหน่งต้องใช้ใบอนุญาตหรือไม่ + เลขที่เคยกรอกล่าสุด (ไว้เติมฟอร์ม)
//   ไม่ส่ง user_id = ตัวเอง; ดูของคนอื่นได้เฉพาะ ADMIN / IT_STAFF
// ────────────────────────────────────────────────────────────────
export const getLicenseRule = async ({ query, user, set }: any) => {
    try {
        const selfId = Number(user?.id);
        const targetId = query?.user_id ? Number(query.user_id) : selfId;
        if (!targetId) {
            set.status = 400;
            return { success: false, error: { code: 'VALIDATION_ERROR', message: 'ไม่พบผู้ใช้', field: 'user_id' } };
        }
        if (targetId !== selfId && !(await isItStaff(selfId))) {
            set.status = 403;
            return { success: false, error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ดูข้อมูลผู้ใช้อื่น' } };
        }
        const pos = await positionLicense(targetId, null);
        const [last] = await core_kon`
            SELECT license_no FROM it_user_requests
            WHERE requester_user_id = ${targetId} AND license_no IS NOT NULL AND is_active = 'Y'
            ORDER BY created_at DESC LIMIT 1
        `;
        const systems = await core_kon`SELECT id FROM it_user_systems WHERE requires_license = 'Y' AND is_active = 'Y'`;
        return {
            success: true,
            data: {
                position_name: pos.position_name,
                license_type: pos.license_type,
                last_license_no: last?.license_no ?? null,
                license_system_ids: systems.map((x: any) => Number(x.id)),
            },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 4) GET /:id  — รายละเอียดคำร้อง
// ────────────────────────────────────────────────────────────────
export const getUserRequestById = async ({ params, set }: any) => {
    try {
        const [row] = await core_kon`
            ${requestSelect(core_kon`AND r.id = ${params.id}`)}
        `;
        if (!row) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบคำร้อง', field: 'id' } };
        }
        return { success: true, data: row };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 5) POST /:id/issue  — ออกรหัส + ส่งหมอพร้อม → issued
//    username/password เป็น transient: relay เข้าหมอพร้อมเท่านั้น ไม่ persist/ไม่ log
// ────────────────────────────────────────────────────────────────
export const issueCredential = async ({ params, body, user, set }: any) => {
    const username: string = (body?.username ?? '').trim();
    const password: string = body?.password ?? '';
    const morpromTarget = body?.morprom_target ?? {};
    const issuedBy: string = (body?.issued_by ?? user?.id ?? '').toString().trim();
    const note: string | null = (body?.note ?? '').trim() || null;

    if (!username || !password) {
        set.status = 400;
        return { success: false, error: { code: 'VALIDATION_ERROR', message: 'ต้องระบุ username และ password', field: 'username' } };
    }
    if (!issuedBy) {
        set.status = 400;
        return { success: false, error: { code: 'VALIDATION_ERROR', message: 'ต้องระบุ issued_by', field: 'issued_by' } };
    }

    const citizenId: string | null = morpromTarget?.citizen_id ?? null;
    if (!citizenId) {
        set.status = 400;
        return { success: false, error: { code: 'VALIDATION_ERROR', message: 'ต้องระบุ morprom_target.citizen_id เพื่อส่งแจ้งผ่านหมอพร้อม', field: 'morprom_target' } };
    }

    try {
        // 1) ตรวจสถานะปัจจุบัน — ต้องเป็น pending เท่านั้น
        const [reqInfo] = await core_kon`
            SELECT r.id, r.request_no, r.status, r.requester_name, s.name_th AS system_name
            FROM it_user_requests r
            JOIN it_user_systems s ON r.system_id = s.id
            WHERE r.id = ${params.id} AND r.is_active = 'Y'
        `;
        if (!reqInfo) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบคำร้อง', field: 'id' } };
        }
        if (reqInfo.status !== 'pending') {
            set.status = 409;
            return { success: false, error: { code: 'CONFLICT', message: 'คำร้องนี้ไม่ได้อยู่สถานะรอออกรหัส ไม่สามารถออกรหัสได้', field: 'status' } };
        }

        // resolve id ผู้ออกรหัส → ชื่อเต็ม (ใช้แสดงในการ์ดทั้งของผู้ขอและกลุ่ม IT)
        const issuedByName = await resolveUserName(issuedBy);

        // 2) ส่ง credential ผ่านหมอพร้อม — ถ้าล้มเหลวจะ throw → คงสถานะ pending แล้วคืน 502
        try {
            await sendCredentialIssuedAlert(citizenId, {
                requestNo: reqInfo.request_no,
                username,
                password,
                systemName: reqInfo.system_name ?? undefined,
                issuedBy: issuedByName,
                note: note ?? undefined,
            });
        } catch (notifyErr: any) {
            // ห้าม log credential — log แค่ข้อความ error ของการส่ง
            console.error('[issueCredential] MOPH notify failed:', notifyErr.message);
            set.status = 502;
            return { success: false, error: { code: 'NOTIFY_FAILED', message: 'ส่งแจ้งผ่านหมอพร้อมไม่สำเร็จ กรุณาลองใหม่ (สถานะยังเป็น pending)' } };
        }

        // 3) แจ้งสำเร็จ → อัปเดตสถานะ (บันทึกเฉพาะ metadata ห้ามบันทึก username/password)
        const updated = await core_kon`
            UPDATE it_user_requests
            SET status = 'issued',
                issued_by = ${issuedBy},
                issued_date = CURRENT_DATE,
                notified_at = CURRENT_TIMESTAMP,
                note = COALESCE(${note}, note),
                updated_by = ${issuedBy}
            WHERE id = ${params.id} AND status = 'pending'
            RETURNING id, request_no, status, issued_by, issued_date::text, notified_at
        `;

        if (updated.length === 0) {
            // race: มีคนออกรหัสคู่ขนานไปก่อน
            set.status = 409;
            return { success: false, error: { code: 'CONFLICT', message: 'คำร้องนี้ถูกออกรหัสไปแล้ว', field: 'status' } };
        }

        // 4) แจ้งเข้ากลุ่มงาน IT แบบ best-effort — ไม่แสดง username/password (ปกปิดชื่อผู้ขอบางส่วน)
        try {
            await mophCredentialIssuedNotify({
                requestNo: reqInfo.request_no,
                systemName: reqInfo.system_name ?? '-',
                requesterName: reqInfo.requester_name,
                issuedBy: issuedByName,
            });
        } catch (notifyErr: any) {
            console.error('[issueCredential] MOPH group notify failed:', notifyErr.message);
        }

        return { success: true, data: updated[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

// ────────────────────────────────────────────────────────────────
// 6) POST /:id/reject | /:id/cancel  — เปลี่ยนสถานะจาก pending
// ────────────────────────────────────────────────────────────────
const transitionFromPending = async (
    { params, body, user, set }: any,
    targetStatus: 'rejected' | 'cancelled',
) => {
    const actor: string = (body?.actor ?? user?.id ?? '').toString().trim();
    const reason: string | null = (body?.reason ?? '').trim() || null;

    if (!actor) {
        set.status = 400;
        return { success: false, error: { code: 'VALIDATION_ERROR', message: 'ต้องระบุ actor', field: 'actor' } };
    }

    try {
        const [reqInfo] = await core_kon`
            SELECT id, status FROM it_user_requests
            WHERE id = ${params.id} AND is_active = 'Y'
        `;
        if (!reqInfo) {
            set.status = 404;
            return { success: false, error: { code: 'NOT_FOUND', message: 'ไม่พบคำร้อง', field: 'id' } };
        }
        if (reqInfo.status !== 'pending') {
            set.status = 409;
            return { success: false, error: { code: 'CONFLICT', message: 'เปลี่ยนสถานะได้เฉพาะคำร้องที่รอออกรหัส (pending)', field: 'status' } };
        }

        const label = targetStatus === 'rejected' ? 'ปฏิเสธ' : 'ยกเลิก';
        const actorName = await resolveUserName(actor);
        const noteAppend = `[${label}โดย ${actorName}]${reason ? ` ${reason}` : ''}`;

        const [row] = await core_kon`
            UPDATE it_user_requests
            SET status = ${targetStatus},
                note = TRIM(BOTH E'\n' FROM COALESCE(note || E'\n', '') || ${noteAppend}),
                updated_by = ${actor}
            WHERE id = ${params.id} AND status = 'pending'
            RETURNING id, request_no, status
        `;

        if (!row) {
            set.status = 409;
            return { success: false, error: { code: 'CONFLICT', message: 'คำร้องถูกเปลี่ยนสถานะไปแล้ว', field: 'status' } };
        }

        return { success: true, data: row };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};

export const rejectUserRequest = (ctx: any) => transitionFromPending(ctx, 'rejected');
export const cancelUserRequest = (ctx: any) => transitionFromPending(ctx, 'cancelled');

// ────────────────────────────────────────────────────────────────
// 7) GET /dashboard  — สรุปทุก chart ใน 1 request
// ────────────────────────────────────────────────────────────────
export const getUserRequestDashboard = async ({ query, set }: any) => {
    try {
        const dateFrom = query?.date_from || null;
        const dateTo = query?.date_to || null;

        const dateFilter = core_kon`
            ${dateFrom ? core_kon`AND r.request_date >= ${dateFrom}::date` : core_kon``}
            ${dateTo ? core_kon`AND r.request_date <= ${dateTo}::date` : core_kon``}
        `;

        const [kpiRows, bySystem, byDepartment, byStatus, fiscalRows] = await Promise.all([
            core_kon`
                SELECT
                    COUNT(*)::int                                                  AS total,
                    SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END)::int    AS pending,
                    SUM(CASE WHEN status = 'issued'    THEN 1 ELSE 0 END)::int    AS issued,
                    SUM(CASE WHEN status = 'rejected'  THEN 1 ELSE 0 END)::int    AS rejected,
                    SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)::int    AS cancelled
                FROM it_user_requests r
                WHERE r.is_active = 'Y' ${dateFilter}
            `,
            core_kon`
                SELECT s.system_code, s.name_th AS system_name, COUNT(*)::int AS count
                FROM it_user_requests r
                JOIN it_user_systems s ON r.system_id = s.id
                WHERE r.is_active = 'Y' ${dateFilter}
                GROUP BY s.system_code, s.name_th
                ORDER BY count DESC
            `,
            core_kon`
                SELECT COALESCE(r.department, '(ไม่ระบุ)') AS department, COUNT(*)::int AS count
                FROM it_user_requests r
                WHERE r.is_active = 'Y' ${dateFilter}
                GROUP BY r.department
                ORDER BY count DESC
            `,
            core_kon`
                SELECT r.status, COUNT(*)::int AS count
                FROM it_user_requests r
                WHERE r.is_active = 'Y' ${dateFilter}
                GROUP BY r.status
                ORDER BY CASE r.status WHEN 'pending' THEN 1 WHEN 'issued' THEN 2 WHEN 'rejected' THEN 3 WHEN 'cancelled' THEN 4 END
            `,
            // นับตามปีงบประมาณ (เริ่ม ต.ค.) แยกตามระบบ
            core_kon`
                SELECT
                    s.system_code, s.name_th AS system_name,
                    (CASE WHEN EXTRACT(MONTH FROM r.request_date) >= 10
                          THEN EXTRACT(YEAR FROM r.request_date) + 1
                          ELSE EXTRACT(YEAR FROM r.request_date) END)::int AS fiscal_year,
                    COUNT(*)::int AS count
                FROM it_user_requests r
                JOIN it_user_systems s ON r.system_id = s.id
                WHERE r.is_active = 'Y' ${dateFilter}
                GROUP BY s.system_code, s.name_th, fiscal_year
            `,
        ]);

        const k = kpiRows[0] || ({} as any);
        const total = Number(k.total) || 0;
        const issued = Number(k.issued) || 0;

        // ── pivot ปีงบ: 5 ปีงบล่าสุด (ค.ศ.) → label เป็น พ.ศ. ──
        const now = new Date();
        const curFiscalGreg = now.getMonth() + 1 >= 10 ? now.getFullYear() + 1 : now.getFullYear();
        const fiscalGreg = [4, 3, 2, 1, 0].map((n) => curFiscalGreg - n);
        const fiscalThai = fiscalGreg.map((y) => y + 543);

        const systemMap = new Map<string, { system_code: string; system_name: string; data: number[] }>();
        for (const fr of fiscalRows as any[]) {
            if (!systemMap.has(fr.system_code)) {
                systemMap.set(fr.system_code, { system_code: fr.system_code, system_name: fr.system_name, data: fiscalGreg.map(() => 0) });
            }
            const idx = fiscalGreg.indexOf(Number(fr.fiscal_year));
            if (idx >= 0) systemMap.get(fr.system_code)!.data[idx] += Number(fr.count);
        }
        const fiscalSystems = [...systemMap.values()];
        const totalLine = fiscalGreg.map((_, i) => fiscalSystems.reduce((sum, s) => sum + s.data[i], 0));

        return {
            success: true,
            data: {
                kpi: {
                    total,
                    pending: Number(k.pending) || 0,
                    issued,
                    rejected: Number(k.rejected) || 0,
                    cancelled: Number(k.cancelled) || 0,
                    issued_rate: total > 0 ? Math.round((issued / total) * 1000) / 10 : 0,
                },
                by_system: bySystem,
                by_department: byDepartment,
                by_status: byStatus,
                fiscal_by_system: {
                    fiscal_years: fiscalThai,
                    systems: fiscalSystems,
                    total_line: totalLine,
                },
            },
        };
    } catch (error: any) {
        set.status = 500;
        return { success: false, error: { code: 'INTERNAL_ERROR', message: error.message } };
    }
};
