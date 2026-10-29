// สถิติการเข้าใช้งานระบบแต่ละหน้า — หน้าเว็บส่งการเปิดหน้ามาบันทึก (ตาราง app_page_views)
// ผู้ดูแลดูสรุปตามช่วงวันที่ที่เลือก (เดือน / ไตรมาส / ปีงบประมาณ / กำหนดเอง — หน้าเว็บแปลงเป็นช่วงวันที่ให้)
// วันที่และชั่วโมงทั้งหมดคิดตามเวลาไทย
import { core_kon } from '../db/db';
import { clientIp } from '../utils/clientIp';

const TZ = 'Asia/Bangkok';
const MAX_RANGE_DAYS = 731;
// ช่วงยาวกว่านี้สรุปเป็นรายเดือน — รายวันทั้งปีงบ 365 แท่งอ่านไม่ออก
const DAILY_MAX_DAYS = 92;

// ── บันทึกการเปิดหน้า ──────────────────────────────────────────────────────────

// เซกเมนต์ที่เป็นเลข / uuid / รหัสยาว → :id ให้หน้ารายละเอียดของแต่ละรายการนับรวมเป็นหน้าเดียว
const ID_SEGMENT = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[A-Za-z0-9_-]{24,})$/i;
const PATH_RE = /^\/[A-Za-z0-9\-_/.:]*$/;

export const normalizePath = (raw: string): string | null => {
    const p = raw.split(/[?#]/)[0].trim();
    if (!p.startsWith('/') || p.length > 200 || !PATH_RE.test(p)) return null;
    const segs = p.split('/').filter(Boolean).map(s => (ID_SEGMENT.test(s) ? ':id' : s.toLowerCase()));
    // หน้า login (/) ไม่นับ — ยังไม่ได้เข้าระบบ
    return segs.length ? `/${segs.join('/')}` : null;
};

// กันนับซ้ำเมื่อ effect รันซ้ำ / กด refresh ติด ๆ กัน (คนเดิม หน้าเดิม ภายใน 10 วินาที)
const DEDUPE_MS = 10_000;
const recent = new Map<string, number>();
let warnedMissingTable = false;

export const recordPageView = async ({ body, user, set, request, server }: any) => {
    if (!user?.id) {
        set.status = 401;
        return { success: false, message: 'Unauthorized' };
    }
    const path = normalizePath(String(body?.path ?? ''));
    if (!path) return { success: true, data: { recorded: false } };

    const key = `${user.id}|${path}`;
    const now = Date.now();
    if (now - (recent.get(key) ?? 0) < DEDUPE_MS) return { success: true, data: { recorded: false } };
    recent.set(key, now);
    if (recent.size > 5000) {
        for (const [k, t] of recent) if (now - t >= DEDUPE_MS) recent.delete(k);
    }

    try {
        await core_kon`
            INSERT INTO app_page_views (user_id, path, client_ip)
            VALUES (${user.id}, ${path}, ${clientIp(request, server)})`;
        return { success: true, data: { recorded: true } };
    } catch (e: any) {
        // บันทึกไม่ได้ไม่ควรกระทบผู้ใช้ — หน้าเว็บไม่สนใจผลอยู่แล้ว
        // ยังไม่ได้สร้างตาราง (42P01) เตือนครั้งเดียว ไม่งั้นขึ้นทุกครั้งที่มีคนเปิดหน้า
        if (e?.code !== '42P01' || !warnedMissingTable) console.error('[page-views] บันทึกไม่สำเร็จ:', e?.message);
        if (e?.code === '42P01') warnedMissingTable = true;
        set.status = 500;
        return { success: false, message: 'บันทึกไม่สำเร็จ' };
    }
};

// ── สรุปสถิติ (ผู้ดูแล) ────────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** 'YYYY-MM-DD' (ค.ศ.) → เที่ยงคืนเวลาไทยของวันนั้น */
const bkkMidnight = (d: string) => new Date(`${d}T00:00:00+07:00`);

export const getPageViewStats = async ({ query, set }: any) => {
    const from = String(query?.from ?? '');
    const to = String(query?.to ?? '');
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
        set.status = 400;
        return { success: false, message: 'ระบุช่วงวันที่ from / to เป็น YYYY-MM-DD' };
    }
    const start = bkkMidnight(from);
    const end = new Date(bkkMidnight(to).getTime() + DAY_MS); // ไม่รวม — ถึงสิ้นวัน to
    const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
    if (Number.isNaN(days) || days < 1 || days > MAX_RANGE_DAYS) {
        set.status = 400;
        return { success: false, message: `ช่วงวันที่ต้องอยู่ระหว่าง 1–${MAX_RANGE_DAYS} วัน` };
    }
    // ช่วงก่อนหน้าที่ยาวเท่ากัน — ใช้เทียบเพิ่ม/ลด
    const prevStart = new Date(start.getTime() - days * DAY_MS);

    const pathFilter = query?.path ? normalizePath(String(query.path)) : null;
    const pathFrag = pathFilter ? core_kon`AND pv.path = ${pathFilter}` : core_kon``;
    const granularity: 'day' | 'month' = days > DAILY_MAX_DAYS ? 'month' : 'day';
    const bucketFmt = granularity === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';

    try {
        const [summary, previous, pages, series, heat, departments] = await Promise.all([
            core_kon`
                SELECT count(*)::int AS views, count(DISTINCT pv.user_id)::int AS users,
                       count(DISTINCT pv.path)::int AS pages,
                       count(DISTINCT (pv.user_id, (pv.viewed_at AT TIME ZONE ${TZ})::date))::int AS user_days
                FROM app_page_views pv
                WHERE pv.viewed_at >= ${start} AND pv.viewed_at < ${end} ${pathFrag}`,
            core_kon`
                SELECT count(*)::int AS views, count(DISTINCT pv.user_id)::int AS users
                FROM app_page_views pv
                WHERE pv.viewed_at >= ${prevStart} AND pv.viewed_at < ${start} ${pathFrag}`,
            // รายการหน้าไม่กรองตามหน้าที่เลือก — ให้กดเลือกหน้าอื่นต่อได้
            core_kon`
                SELECT pv.path, count(*)::int AS views, count(DISTINCT pv.user_id)::int AS users, max(pv.viewed_at) AS last_at
                FROM app_page_views pv
                WHERE pv.viewed_at >= ${start} AND pv.viewed_at < ${end}
                GROUP BY pv.path
                ORDER BY views DESC, pv.path`,
            core_kon`
                SELECT to_char(pv.viewed_at AT TIME ZONE ${TZ}, ${bucketFmt}) AS bucket,
                       count(*)::int AS views, count(DISTINCT pv.user_id)::int AS users
                FROM app_page_views pv
                WHERE pv.viewed_at >= ${start} AND pv.viewed_at < ${end} ${pathFrag}
                GROUP BY bucket`,
            core_kon`
                SELECT EXTRACT(ISODOW FROM pv.viewed_at AT TIME ZONE ${TZ})::int AS dow,
                       EXTRACT(HOUR FROM pv.viewed_at AT TIME ZONE ${TZ})::int AS hour,
                       count(*)::int AS views
                FROM app_page_views pv
                WHERE pv.viewed_at >= ${start} AND pv.viewed_at < ${end} ${pathFrag}
                GROUP BY dow, hour`,
            core_kon`
                SELECT COALESCE(m.name, 'ไม่ระบุกลุ่มงาน') AS name,
                       count(*)::int AS views, count(DISTINCT pv.user_id)::int AS users
                FROM app_page_views pv
                LEFT JOIN users u ON u.id = pv.user_id
                LEFT JOIN majors m ON m.major_id = u.major_id
                WHERE pv.viewed_at >= ${start} AND pv.viewed_at < ${end} ${pathFrag}
                GROUP BY 1
                ORDER BY views DESC
                LIMIT 15`,
        ]);

        // เติมช่วงที่ไม่มีการใช้งานเป็น 0 — กราฟเส้นไม่กระโดดข้ามวัน/เดือนที่ว่าง
        const byBucket = new Map(series.map((r: any) => [r.bucket, r]));
        const buckets: string[] = [];
        const toBkk = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString();
        if (granularity === 'day') {
            for (let t = start.getTime(); t < end.getTime(); t += DAY_MS) buckets.push(toBkk(new Date(t)).slice(0, 10));
        } else {
            const [y0, m0] = from.split('-').map(Number);
            const last = to.slice(0, 7);
            for (let y = y0, m = m0; ; m === 12 ? (y++, m = 1) : m++) {
                const b = `${y}-${String(m).padStart(2, '0')}`;
                buckets.push(b);
                if (b >= last) break;
            }
        }

        return {
            success: true,
            data: {
                from, to, days, granularity, path: pathFilter,
                summary: summary[0],
                previous: previous[0],
                pages,
                series: buckets.map(b => ({ bucket: b, views: (byBucket.get(b) as any)?.views ?? 0, users: (byBucket.get(b) as any)?.users ?? 0 })),
                heat,
                departments,
            },
        };
    } catch (e: any) {
        console.error('[page-views] สรุปสถิติไม่สำเร็จ:', e?.message);
        set.status = 500;
        if (e?.code === '42P01') return { success: false, message: 'ยังไม่ได้สร้างตาราง app_page_views — รันไฟล์ src/db/app_page_views.sql ก่อน' };
        return { success: false, message: 'โหลดสถิติไม่สำเร็จ' };
    }
};
