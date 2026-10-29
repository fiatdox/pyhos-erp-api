import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRoles } from '../middlewares/roleGuard';
import { HR_POST_MANAGER_ROLES, createHrPost, getActiveHrPopups, deleteHrPost, getHrPostFile, getHrPosts, getHrPostsForManage, updateHrPost } from '../controllers/hrPostController';

const TAG = 'HR Posts';

// ช่องจาก multipart form มาเป็น string ทั้งหมด — controller ตรวจและแปลงค่าเอง
const postBody = t.Object({
    kind: t.String(),
    title: t.String({ maxLength: 300 }),
    body: t.Optional(t.String()),
    category: t.Optional(t.String()),
    link_url: t.Optional(t.String()),
    is_pinned: t.Optional(t.String()),
    is_published: t.Optional(t.String()),
    remove_file: t.Optional(t.String()),
    show_from: t.Optional(t.String()),
    show_until: t.Optional(t.String()),
    file: t.Optional(t.File()),
});
const idParams = t.Object({ id: t.Numeric() });

export const hrPostRoutes = new Elysia({ prefix: '/api/v1/hr-posts' })
    .use(authMiddleware)
    // ── อ่าน — ทุกคนที่ล็อกอิน (เฉพาะที่เผยแพร่) ──
    .get('/', getHrPosts, {
        detail: { tags: [TAG], summary: 'ข่าวประชาสัมพันธ์และเอกสารระเบียบงานทรัพยากรบุคคลที่เผยแพร่' }
    })
    .get('/popups/active', getActiveHrPopups, {
        detail: { tags: [TAG], summary: 'ป๊อปอัปที่อยู่ในช่วงแสดงวันนี้ (สูงสุด 5 รายการ)' }
    })
    .get('/:id/file', getHrPostFile, {
        params: idParams,
        detail: { tags: [TAG], summary: 'เปิดไฟล์แนบ' }
    })
    // ── จัดการ — เฉพาะ ADMIN / HR (มีผลกับ route ที่ประกาศหลังบรรทัดนี้) ──
    .use(requireRoles(...HR_POST_MANAGER_ROLES))
    .get('/manage', getHrPostsForManage, {
        detail: { tags: [TAG], summary: 'รายการทั้งหมดสำหรับหน้าจัดการ (รวมที่ไม่เผยแพร่และป๊อปอัป)' }
    })
    .post('/', createHrPost, {
        body: postBody,
        detail: { tags: [TAG], summary: 'เพิ่มข่าว/เอกสาร (multipart, ไฟล์แนบไม่บังคับ ไม่เกิน 20MB)' }
    })
    // POST แทน PUT — proxy multipart ฝั่งหน้าเว็บส่งได้แค่ POST
    .post('/:id', updateHrPost, {
        params: idParams,
        body: postBody,
        detail: { tags: [TAG], summary: 'แก้ไขข่าว/เอกสาร (ส่ง file เพื่อแทนไฟล์เดิม, remove_file=true เพื่อเอาไฟล์ออก)' }
    })
    .delete('/:id', deleteHrPost, {
        params: idParams,
        detail: { tags: [TAG], summary: 'ลบข่าว/เอกสาร (soft delete)' }
    });
