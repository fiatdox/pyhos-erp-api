import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { getPageViewStats, recordPageView } from '../controllers/pageViewController';

const TAG = 'PageViews';
// ดูสถิติได้เฉพาะผู้ดูแลระบบและเจ้าหน้าที่ IT (ตรงกับ IT_STAFF_ROLES ฝั่งหน้าเว็บ)
const STATS_ROLES = ['ADMIN', 'CHIEF_GROUP_IT', 'CHIEF_MISSION_IT', 'IT_STAFF'];

export const pageViewRoutes = new Elysia({ prefix: '/api/v1/page-views' })
    .use(authMiddleware)
    // ── บันทึกการเปิดหน้า — ทุกคนที่ล็อกอิน ──
    .post('/', recordPageView, {
        body: t.Object({ path: t.String({ maxLength: 500 }) }),
        detail: { tags: [TAG], summary: 'บันทึกการเปิดหน้าเว็บ', description: 'คนเดิมเปิดหน้าเดิมซ้ำภายใน 10 วินาทีไม่นับ' }
    })
    // ── สรุปสถิติ — เฉพาะ STATS_ROLES (มีผลกับ route ที่ประกาศหลังบรรทัดนี้) ──
    .use(requireRoles(...STATS_ROLES))
    .get('/stats', getPageViewStats, {
        query: t.Object({
            from: t.String(),
            to: t.String(),
            path: t.Optional(t.String()),
        }),
        detail: { tags: [TAG], summary: 'สรุปการเข้าใช้งานแต่ละหน้าในช่วงวันที่', description: 'from/to เป็น YYYY-MM-DD (รวมทั้งสองวัน) ช่วงเกิน 92 วันสรุปเป็นรายเดือน' }
    });
