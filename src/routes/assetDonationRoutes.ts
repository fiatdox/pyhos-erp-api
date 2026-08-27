import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
    getDonationMeta, getDonationUserOptions,
    getDonationDepartments, createDonationDepartment, updateDonationDepartment, deleteDonationDepartment,
    getDonationCommitteeMembers, createDonationCommitteeMember, updateDonationCommitteeMember, deleteDonationCommitteeMember,
    getDonationForms, getDonationFormById, createDonationForm, updateDonationForm, deleteDonationForm,
    uploadDonationItemImages, deleteDonationItemImage, getDonationItemImageFile,
    submitDonationForm, submitCommitteeReview, registerDonationForm,
} from '../controllers/assetDonationController';

const DONATION_TAG = 'AssetDonation';

const itemBody = t.Object({
    id: t.Optional(t.Numeric()),
    item_name: t.String(),
    item_brand_model: t.Optional(t.Nullable(t.String())),
    item_qty: t.Numeric(),
    item_unit: t.String(),
    item_est_value: t.Optional(t.Nullable(t.Numeric())),
    item_condition_general: t.Optional(t.Nullable(t.String())),
});

const formBody = t.Object({
    submitted_by_name: t.Optional(t.Nullable(t.String())),
    submitted_by_position: t.Optional(t.Nullable(t.String())),
    submitted_date: t.Optional(t.String()),
    donor_name: t.String(),
    donor_address: t.Optional(t.Nullable(t.String())),
    donor_phone: t.Optional(t.Nullable(t.String())),
    donor_purpose: t.Optional(t.Nullable(t.String())),
    receiving_department: t.Optional(t.Nullable(t.String())),
    major_id: t.Optional(t.Nullable(t.Numeric())),
    submajor_id: t.Optional(t.Nullable(t.Numeric())),
    donation_type: t.String(),
    used_exterior_condition: t.Optional(t.Nullable(t.String())),
    used_tested_working: t.Optional(t.Nullable(t.Boolean())),
    used_estimated_age_years: t.Optional(t.Nullable(t.Numeric())),
    used_condition_notes: t.Optional(t.Nullable(t.String())),
    used_acknowledged_by: t.Optional(t.Nullable(t.String())),
    used_acknowledged_date: t.Optional(t.Nullable(t.String())),
    items: t.Optional(t.Array(itemBody)),
});

const reviewBody = t.Object({
    decision: t.String(),
    comment: t.String(),
});

const registrationItemBody = t.Object({
    id: t.Numeric(),
    asset_registration_no: t.Optional(t.Nullable(t.String())),
    depreciation_start_date: t.Optional(t.Nullable(t.String())),
    useful_life_years: t.Optional(t.Nullable(t.Numeric())),
    custodian_department: t.Optional(t.Nullable(t.String())),
});
const registrationBody = t.Object({ items: t.Array(registrationItemBody) });

const deptBody = t.Object({
    name: t.String(),
    sort: t.Optional(t.Numeric()),
    active: t.Optional(t.Boolean()),
});
const committeeMemberBody = t.Object({
    user_id: t.Numeric(),
    committee_position: t.String(),
    sort: t.Optional(t.Numeric()),
    active: t.Optional(t.Boolean()),
});
const imagesBody = t.Object({ images: t.Union([t.File(), t.Array(t.File())]) });

export const assetDonationRoutes = new Elysia({ prefix: '/api/v1/asset-donation' })
    .use(authMiddleware)
    // ── meta / master ──
    .get('/meta', getDonationMeta, { detail: { tags: [DONATION_TAG] } })
    .get('/user-options', getDonationUserOptions, { query: t.Object({ search: t.Optional(t.String()) }), detail: { tags: [DONATION_TAG] } })
    .get('/departments', getDonationDepartments, { detail: { tags: [DONATION_TAG], description: 'admin เท่านั้น' } })
    .post('/departments', createDonationDepartment, { body: deptBody, detail: { tags: [DONATION_TAG], description: 'admin เท่านั้น' } })
    .put('/departments/:id', updateDonationDepartment, { params: t.Object({ id: t.Numeric() }), body: deptBody, detail: { tags: [DONATION_TAG], description: 'admin เท่านั้น' } })
    .delete('/departments/:id', deleteDonationDepartment, { params: t.Object({ id: t.Numeric() }), detail: { tags: [DONATION_TAG], description: 'admin เท่านั้น' } })
    .get('/committee-members', getDonationCommitteeMembers, { detail: { tags: [DONATION_TAG], description: 'admin เท่านั้น' } })
    .post('/committee-members', createDonationCommitteeMember, { body: committeeMemberBody, detail: { tags: [DONATION_TAG], description: 'admin เท่านั้น' } })
    .put('/committee-members/:id', updateDonationCommitteeMember, { params: t.Object({ id: t.Numeric() }), body: committeeMemberBody, detail: { tags: [DONATION_TAG], description: 'admin เท่านั้น' } })
    .delete('/committee-members/:id', deleteDonationCommitteeMember, { params: t.Object({ id: t.Numeric() }), detail: { tags: [DONATION_TAG], description: 'admin เท่านั้น' } })

    // ── Form 1 ──
    .get('/forms', getDonationForms, {
        query: t.Object({ scope: t.Optional(t.String()), status: t.Optional(t.String()) }),
        detail: { tags: [DONATION_TAG], description: 'scope: mine | committee-pending | committee-history | procurement-pending | procurement-history | all' },
    })
    .post('/forms', createDonationForm, { body: formBody, detail: { tags: [DONATION_TAG], description: 'donation_staff สร้าง Form 1 (draft)' } })
    .get('/forms/:id', getDonationFormById, { params: t.Object({ id: t.Numeric() }), detail: { tags: [DONATION_TAG] } })
    .put('/forms/:id', updateDonationForm, { params: t.Object({ id: t.Numeric() }), body: formBody, detail: { tags: [DONATION_TAG], description: 'แก้ไขได้เฉพาะ draft + เจ้าของฟอร์ม' } })
    .delete('/forms/:id', deleteDonationForm, { params: t.Object({ id: t.Numeric() }), detail: { tags: [DONATION_TAG], description: 'ลบได้เฉพาะ draft + เจ้าของฟอร์ม' } })
    .post('/forms/:id/submit', submitDonationForm, { params: t.Object({ id: t.Numeric() }), detail: { tags: [DONATION_TAG], description: 'draft -> pending_approval' } })

    // ── รูปภาพครุภัณฑ์ ──
    .post('/forms/:id/items/:itemId/images', uploadDonationItemImages, {
        params: t.Object({ id: t.Numeric(), itemId: t.Numeric() }),
        body: imagesBody,
        detail: { tags: [DONATION_TAG], description: 'อัปโหลดรูป (multipart/form-data) jpg/png ไม่เกิน 5MB/ไฟล์' },
    })
    .delete('/forms/:id/items/:itemId/images/:imageId', deleteDonationItemImage, {
        params: t.Object({ id: t.Numeric(), itemId: t.Numeric(), imageId: t.Numeric() }),
        detail: { tags: [DONATION_TAG] },
    })
    .get('/images/:imageId/file', getDonationItemImageFile, { params: t.Object({ imageId: t.Numeric() }), detail: { tags: [DONATION_TAG] } })

    // ── กรรมการลงมติ ──
    .post('/forms/:id/committee-review', submitCommitteeReview, {
        params: t.Object({ id: t.Numeric() }), body: reviewBody,
        detail: { tags: [DONATION_TAG], description: 'กรรมการลงมติ + ความเห็น (1 ครั้งต่อฟอร์ม)' },
    })

    // ── ฝ่ายพัสดุ ขึ้นทะเบียน ──
    .post('/forms/:id/registration', registerDonationForm, {
        params: t.Object({ id: t.Numeric() }), body: registrationBody,
        detail: { tags: [DONATION_TAG], description: 'ฝ่ายพัสดุกรอก Form 2, เปลี่ยนสถานะ -> registered' },
    });
