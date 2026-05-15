import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getEquipmentTypes, getEquipmentTypeById, getProblemCategories, getProblemCategoryById, getPriorityLevels, getPriorityLevelById } from '../controllers/itController';

export const itRoutes = new Elysia({ prefix: '/api/v1/it' })
    .use(authMiddleware)
    // ดึงรายการประเภทอุปกรณ์ IT ทั้งหมด
    .get('/equipment-types', getEquipmentTypes, {
        detail: { tags: ['IT'], summary: 'ดึงรายการประเภทอุปกรณ์ IT ทั้งหมด', description: 'ดึงข้อมูล id, name จากตาราง it_equipment_types' }
    })
    // ดึงประเภทอุปกรณ์ IT ตาม id
    .get('/equipment-types/:id', getEquipmentTypeById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT'], summary: 'ดึงประเภทอุปกรณ์ IT ตาม id', description: 'ดึงข้อมูล id, name จากตาราง it_equipment_types ตาม id' }
    })
    // ดึงรายการหมวดหมู่ปัญหา IT ทั้งหมด
    .get('/problem-categories', getProblemCategories, {
        detail: { tags: ['IT'], summary: 'ดึงรายการหมวดหมู่ปัญหา IT ทั้งหมด', description: 'ดึงข้อมูล it_problem_category_id, name, desc จากตาราง it_problem_category' }
    })
    // ดึงหมวดหมู่ปัญหา IT ตาม id
    .get('/problem-categories/:id', getProblemCategoryById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT'], summary: 'ดึงหมวดหมู่ปัญหา IT ตาม id', description: 'ดึงข้อมูล it_problem_category_id, name, desc จากตาราง it_problem_category ตาม id' }
    })
    // ดึงรายการระดับความสำคัญ IT ทั้งหมด
    .get('/priority-levels', getPriorityLevels, {
        detail: { tags: ['IT'], summary: 'ดึงรายการระดับความสำคัญ IT ทั้งหมด', description: 'ดึงข้อมูล it_priority_level_id, name, description, response_days, display_order จากตาราง it_priority_levels เฉพาะที่ is_active = Y' }
    })
    // ดึงระดับความสำคัญ IT ตาม id
    .get('/priority-levels/:id', getPriorityLevelById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['IT'], summary: 'ดึงระดับความสำคัญ IT ตาม id', description: 'ดึงข้อมูล it_priority_level_id, name, description, response_days, display_order จากตาราง it_priority_levels ตาม id เฉพาะที่ is_active = Y' }
    });
