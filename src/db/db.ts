import postgres from 'postgres';
import mysql from 'mysql2/promise';

export const equipmentPool = mysql.createPool({
    host: process.env.EQUIPMENT_HOST,
    port: Number(process.env.EQUIPMENT_PORT),
    user: process.env.EQUIPMENT_USER,
    password: process.env.EQUIPMENT_PASSWORD,
    database: process.env.EQUIPMENT_DB_NAME,
    waitForConnections: true,
    connectionLimit: 30,
});

export const hisPool = mysql.createPool({
    host: process.env.HIS_HOST,
    port: Number(process.env.HIS_PORT),
    user: process.env.HIS_USER,
    password: process.env.HIS_PASSWORD,
    database: process.env.HIS_DB_NAME,
    waitForConnections: true,
    connectionLimit: 30,
});

export const inventoryPool = mysql.createPool({
    host: process.env.INVENTORY_HOST,
    port: Number(process.env.INVENTORY_PORT),
    user: process.env.INVENTORY_USER,
    password: process.env.INVENTORY_PASSWORD,
    database: process.env.INVENTORY_DB_NAME,
    waitForConnections: true,
    connectionLimit: 30,
});

export const salaryPool = mysql.createPool({
    host: process.env.SALARY_HOST,
    port: Number(process.env.SALARY_PORT),
    user: process.env.SALARY_USER,
    password: process.env.SALARY_PASSWORD,
    database: process.env.SALARY_DB_NAME,
    waitForConnections: true,
    connectionLimit: 30,
});

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