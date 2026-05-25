import { Context } from 'elysia';
import { hisPool } from '../db/db';

export const getSessions = async () => {
    const [rows] = await hisPool.query(
        'SELECT onlineid, kskloginname, computername, servername, client_version, department FROM onlineuser'
    );
    return rows;
};

export const deleteSession = async ({ params }: Context) => {
    const { sessionId } = params as { sessionId: string };
    const [result]: any = await hisPool.query(
        'DELETE FROM onlineuser WHERE onlineid = ?',
        [sessionId]
    );
    if (result.affectedRows === 0) {
        return new Response(JSON.stringify({ message: 'Session not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    return { message: 'Session deleted', onlineid: sessionId };
};

export const deleteSessionsBulk = async ({ body }: Context) => {
    const { ids } = body as { ids: (string | number)[] };
    if (!ids || ids.length === 0) {
        return new Response(JSON.stringify({ message: 'ids is required and must not be empty' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }
    const placeholders = ids.map(() => '?').join(', ');
    const [result]: any = await hisPool.query(
        `DELETE FROM onlineuser WHERE onlineid IN (${placeholders})`,
        ids
    );
    return { message: 'Sessions deleted', affectedRows: result.affectedRows };
};
