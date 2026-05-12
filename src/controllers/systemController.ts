import { core_kon } from '../db/db';

// ดึงข้อมูลภารกิจทั้งหมด
export const getAllMissions = async ({ set }: any) => {
    try {
        const missions = await core_kon`
            SELECT mission_id, "name" as mission_name,supervisor_id,acting_supervisor_id
            FROM missions
            where is_active = 'Y'
            ORDER BY mission_id ASC
        `;
        return { success: true, data: missions };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลภารกิจตาม ID
export const getMissionById = async ({ params, set }: any) => {
    try {
        const missions = await core_kon`
            SELECT mission_id, "name" as mission_name,supervisor_id,acting_supervisor_id
            FROM missions
            WHERE mission_id = ${params.id} AND is_active = 'Y'
        `;
        if (missions.length === 0) {
            set.status = 404;
            return { success: false, message: 'Mission not found' };
        }
        return { success: true, data: missions[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};


//ดึงข้อมูลกลุ่มงานทั้งหมด
export const getAllMajors = async ({ set }: any) => {
    try {
        const majors = await core_kon`
            SELECT major_id, "name" as major_name,mission_id,supervisor_id,acting_supervisor_id,moph_secret_id,moph_client_id
            FROM majors
            where is_active = 'Y'
            ORDER BY major_id ASC, mission_id ASC
        `;
        return { success: true, data: majors };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลกลุ่มงานตาม ID
export const getMajorById = async ({ params, set }: any) => {
    try {
        const majors = await core_kon`
            SELECT major_id, "name" as major_name,mission_id,supervisor_id,acting_supervisor_id,moph_secret_id,moph_client_id
            FROM majors
            WHERE major_id = ${params.id} AND is_active = 'Y'
        `;
        if (majors.length === 0) {
            set.status = 404;
            return { success: false, message: 'Major not found' };
        }
        return { success: true, data: majors[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลกลุ่มงานตามรหัสภารกิจ
export const getMajorsByMissionId = async ({ params, set }: any) => {
    try {
        const majors = await core_kon`
            SELECT major_id, "name" as major_name,mission_id,supervisor_id,acting_supervisor_id,moph_secret_id,moph_client_id
            FROM majors
            WHERE mission_id = ${params.id} AND is_active = 'Y'
            ORDER BY major_id ASC
        `;
        return { success: true, data: majors };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลกลุ่มงานย่อยทั้งหมด
export const getAllSubMajors = async ({ set }: any) => {
    try {
        const submajors = await core_kon`
            SELECT submajor_id, "name" as submajor_name,major_id,supervisor_id,acting_supervisor_id,moph_secret_id,moph_client_id
            FROM submajors
            where is_active = 'Y'
            ORDER BY submajor_id ASC, major_id ASC
        `;
        return { success: true, data: submajors };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลกลุ่มงานย่อยตาม ID
export const getSubMajorById = async ({ params, set }: any) => {
    try {
        const submajors = await core_kon`
            SELECT submajor_id, "name" as submajor_name,major_id,supervisor_id,acting_supervisor_id,moph_secret_id,moph_client_id
            FROM submajors
            WHERE submajor_id = ${params.id} AND is_active = 'Y'
        `;
        if (submajors.length === 0) {
            set.status = 404;
            return { success: false, message: 'SubMajor not found' };
        }
        return { success: true, data: submajors[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลกลุ่มงานย่อยตามรหัสกลุ่มงาน
export const getSubMajorsByMajorId = async ({ params, set }: any) => {
    try {
        const submajors = await core_kon`
            SELECT submajor_id, "name" as submajor_name,major_id,supervisor_id,acting_supervisor_id,moph_secret_id,moph_client_id
            FROM submajors
            WHERE major_id = ${params.id} AND is_active = 'Y'
            ORDER BY submajor_id ASC
        `;
        return { success: true, data: submajors };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลระดับผู้ใช้ทั้งหมด
export const getAllLevels = async ({ set }: any) => {
    try {
        const levels = await core_kon`
            SELECT user_level_id, level_name
            FROM user_levels
            ORDER BY user_level_id ASC
        `;
        return { success: true, data: levels };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลระดับผู้ใช้ตาม ID
export const getLevelById = async ({ params, set }: any) => {
    try {
        const levels = await core_kon`
            SELECT user_level_id, level_name
            FROM user_levels
            WHERE user_level_id = ${params.id}
        `;
        if (levels.length === 0) {
            set.status = 404;
            return { success: false, message: 'Level not found' };
        }
        return { success: true, data: levels[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลตำแหน่งทั้งหมด
export const getAllPositions = async ({ set }: any) => {
    try {
        const positions = await core_kon`
            SELECT user_position_id, position_name
            FROM user_positions
            ORDER BY user_position_id ASC
        `;
        return { success: true, data: positions };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลตำแหน่งตาม ID
export const getPositionById = async ({ params, set }: any) => {
    try {
        const positions = await core_kon`
            SELECT user_position_id, position_name
            FROM user_positions
            WHERE user_position_id = ${params.id}
        `;
        if (positions.length === 0) {
            set.status = 404;
            return { success: false, message: 'Position not found' };
        }
        return { success: true, data: positions[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลประเภทผู้ใช้ทั้งหมด
export const getAllUserTypes = async ({ set }: any) => {
    try {
        const userTypes = await core_kon`
            SELECT user_type_id, type_name as user_type_name
            FROM user_types
            ORDER BY user_type_id ASC
        `;
        return { success: true, data: userTypes };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลประเภทผู้ใช้ตาม ID
export const getUserTypeById = async ({ params, set }: any) => {
    try {
        const userTypes = await core_kon`
            SELECT user_type_id, type_name as user_type_name
            FROM user_types
            WHERE user_type_id = ${params.id}
        `;
        if (userTypes.length === 0) {
            set.status = 404;
            return { success: false, message: 'User type not found' };
        }
        return { success: true, data: userTypes[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลสถานะผู้ใช้ทั้งหมด
export const getAllUserStatuses = async ({ set }: any) => {
    try {
        const userStatuses = await core_kon`
            SELECT user_status_id, name as user_status_name
            FROM user_statuses
            ORDER BY user_status_id ASC
        `;
        return { success: true, data: userStatuses };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};

// ดึงข้อมูลสถานะผู้ใช้ตาม ID
export const getUserStatusById = async ({ params, set }: any) => {
    try {
        const userStatuses = await core_kon`
            SELECT user_status_id, name as user_status_name
            FROM user_statuses
            WHERE user_status_id = ${params.id}
        `;
        if (userStatuses.length === 0) {
            set.status = 404;
            return { success: false, message: 'User status not found' };
        }
        return { success: true, data: userStatuses[0] };
    } catch (error: any) {
        set.status = 500;
        return { success: false, message: error.message };
    }
};















