import { core_kon } from '../db/db';

// ดึงรายการประเภทอุปกรณ์ IT ทั้งหมด
export const getEquipmentTypes = async ({ set }: any) => {
    try {
        const result = await core_kon`
            SELECT id, name FROM it_equipment_types ORDER BY id ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงประเภทอุปกรณ์ IT ตาม id
export const getEquipmentTypeById = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT id, name FROM it_equipment_types WHERE id = ${params.id}
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Equipment type not found' };
        }
        return { success: true, data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการหมวดหมู่ปัญหา IT ทั้งหมด
export const getProblemCategories = async ({ set }: any) => {
    try {
        const result = await core_kon`
            SELECT it_problem_category_id, name, description FROM it_problem_category ORDER BY it_problem_category_id ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงรายการระดับความสำคัญ IT ทั้งหมด (เฉพาะที่ active)
export const getPriorityLevels = async ({ set }: any) => {
    try {
        const result = await core_kon`
            SELECT it_priority_level_id, name, description, response_days, display_order
            FROM it_priority_levels
            WHERE is_active = 'Y'
            ORDER BY display_order ASC
        `;
        return { success: true, data: result };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงระดับความสำคัญ IT ตาม id (เฉพาะที่ active)
export const getPriorityLevelById = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT it_priority_level_id, name, description, response_days, display_order
            FROM it_priority_levels
            WHERE it_priority_level_id = ${params.id} AND is_active = 'Y' order BY display_order ASC
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Priority level not found' };
        }
        return { success: true, data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงหมวดหมู่ปัญหา IT ตาม id
export const getProblemCategoryById = async ({ params, set }: any) => {
    try {
        const result = await core_kon`
            SELECT it_problem_category_id, name, desc FROM it_problem_category WHERE it_problem_category_id = ${params.id} 
        `;
        if (result.length === 0) {
            set.status = 404;
            return { success: false, message: 'Problem category not found' };
        }
        return { success: true, data: result[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};
