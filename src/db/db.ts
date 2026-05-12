import postgres from 'postgres';

export const core_kon = postgres({
    host: process.env.CORE_KON_HOST,
    port: Number(process.env.CORE_KON_PORT),
    user: process.env.CORE_KON_USER,
    password: process.env.CORE_KON_PASSWORD,
    database: process.env.CORE_KON_DB_NAME,
    connection: { search_path: process.env.CORE_KON_SCHEMA },
    max: 50,
    idle_timeout: 30,
});