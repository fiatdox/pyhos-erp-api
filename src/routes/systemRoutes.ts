import { Elysia, t } from 'elysia';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
    getAllMissions,
    getMissionById,
    getAllMajors,
    getMajorById,
    getMajorsByMissionId,
    getAllSubMajors,
    getSubMajorById,
    getSubMajorsByMajorId,
    getAllLevels,
    getLevelById,
    getAllPositions,
    getPositionById,
    getAllUserTypes,
    getUserTypeById,
    getAllUserStatuses,
    getUserStatusById,
} from '../controllers/systemController';

export const systemRoutes = new Elysia({ prefix: '/api/v1/system' })
    .use(authMiddleware)
    // Missions
    .get('/missions', getAllMissions, {
        detail: { tags: ['System'] }
    })
    .get('/missions/:id', getMissionById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['System'] }
    })
    // Majors
    .get('/majors', getAllMajors, {
        detail: { tags: ['System'] }
    })
    .get('/majors/:id', getMajorById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['System'] }
    })
    .get('/missions/:id/majors', getMajorsByMissionId, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['System'] }
    })
    // SubMajors
    .get('/submajors', getAllSubMajors, {
        detail: { tags: ['System'] }
    })
    .get('/submajors/:id', getSubMajorById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['System'] }
    })
    .get('/majors/:id/submajors', getSubMajorsByMajorId, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['System'] }
    })
    // Levels
    .get('/levels', getAllLevels, {
        detail: { tags: ['System'] }
    })
    .get('/levels/:id', getLevelById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['System'] }
    })
    // Positions
    .get('/positions', getAllPositions, {
        detail: { tags: ['System'] }
    })
    .get('/positions/:id', getPositionById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['System'] }
    })
    // User Types
    .get('/user-types', getAllUserTypes, {
        detail: { tags: ['System'] }
    })
    .get('/user-types/:id', getUserTypeById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['System'] }
    })
    // User Statuses
    .get('/user-statuses', getAllUserStatuses, {
        detail: { tags: ['System'] }
    })
    .get('/user-statuses/:id', getUserStatusById, {
        params: t.Object({ id: t.Numeric() }),
        detail: { tags: ['System'] }
    });
