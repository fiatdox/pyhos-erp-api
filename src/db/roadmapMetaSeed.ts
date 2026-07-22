// Master/lookup defaults for the IT roadmap (สถานะ/ลำดับ/กลุ่มงาน/KPI/หน่วยงาน)
// seed แบบไม่ทำลายข้อมูล (ON CONFLICT DO NOTHING) — ปลอดภัยเมื่อรันซ้ำ
import type { Sql } from 'postgres';

export const DEFAULT_MISSIONS = [
    { value: 'infra',       label: 'โครงสร้างพื้นฐาน (Network/Server)', color: '#3b82f6', sort: 1 },
    { value: 'security',    label: 'ความปลอดภัยทางไซเบอร์',             color: '#ef4444', sort: 2 },
    { value: 'application', label: 'พัฒนาระบบงาน / Application',        color: '#a855f7', sort: 3 },
    { value: 'support',     label: 'บริการผู้ใช้ / Helpdesk',            color: '#22c55e', sort: 4 },
    { value: 'smart',       label: 'Smart Hospital',                     color: '#06b6d4', sort: 5 },
];

export const DEFAULT_STATUSES = [
    { value: 'draft',       label: 'ร่าง',           color: 'default',    sort: 1 },
    { value: 'proposed',    label: 'เสนอขออนุมัติ',  color: 'warning',    sort: 2 },
    { value: 'approved',    label: 'อนุมัติแล้ว',    color: 'cyan',       sort: 3 },
    { value: 'in_progress', label: 'กำลังดำเนินการ', color: 'processing', sort: 4 },
    { value: 'on_hold',     label: 'ระงับชั่วคราว',  color: 'orange',     sort: 5 },
    { value: 'completed',   label: 'เสร็จสิ้น',      color: 'success',    sort: 6 },
    { value: 'cancelled',   label: 'ยกเลิก',         color: 'error',      sort: 7 },
];

export const DEFAULT_PRIORITIES = [
    { value: 'high',   label: 'สูง',     color: 'red',   sort: 1 },
    { value: 'medium', label: 'ปานกลาง', color: 'gold',  sort: 2 },
    { value: 'low',    label: 'ต่ำ',     color: 'green', sort: 3 },
];

export const DEFAULT_KPIS = [
    { code: 'IT-001', name: 'ระยะเวลาตอบสนอง Helpdesk เฉลี่ย',              target: '≤ 4 ชม.',  sort: 1 },
    { code: 'IT-002', name: 'อัตราระบบสารสนเทศหลัก Uptime',                 target: '≥ 99.5%',  sort: 2 },
    { code: 'IT-003', name: 'จำนวนเหตุการณ์ความปลอดภัยทางไซเบอร์',          target: '0 ครั้ง',  sort: 3 },
    { code: 'IT-004', name: 'ร้อยละผู้ใช้ที่เข้าถึงระบบ Smart Hospital',     target: '≥ 80%',    sort: 4 },
    { code: 'IT-005', name: 'ระดับความพึงพอใจผู้ใช้บริการ IT',              target: '≥ 85%',    sort: 5 },
    { code: 'IT-006', name: 'ร้อยละ Ticket ปิดงานภายใน SLA',                target: '≥ 90%',    sort: 6 },
    { code: 'IT-007', name: 'ร้อยละบุคลากรผ่านการอบรม Cyber Awareness',     target: '≥ 95%',    sort: 7 },
    { code: 'IT-008', name: 'ร้อยละการสำรองข้อมูลสำเร็จตามแผน',            target: '100%',     sort: 8 },
];

export const DEFAULT_DEPARTMENTS = [
    'งานพัฒนาระบบสารสนเทศ',
    'งานเครือข่ายและโครงสร้างพื้นฐาน',
    'งานความปลอดภัยทางไซเบอร์',
    'งานบริการผู้ใช้ (Helpdesk)',
    'งานวิเคราะห์ข้อมูลและรายงาน',
    'กลุ่มงานสารสนเทศทางการแพทย์',
];

// seed defaults โดยไม่ทับค่าที่แก้ไว้ (idempotent)
export async function seedRoadmapMeta(sql: Sql<any>): Promise<void> {
    for (const m of DEFAULT_MISSIONS)
        await sql`INSERT INTO it_roadmap_mission (value, label, color, sort) VALUES (${m.value}, ${m.label}, ${m.color}, ${m.sort}) ON CONFLICT (value) DO NOTHING`;
    for (const s of DEFAULT_STATUSES)
        await sql`INSERT INTO it_roadmap_status (value, label, color, sort) VALUES (${s.value}, ${s.label}, ${s.color}, ${s.sort}) ON CONFLICT (value) DO NOTHING`;
    for (const p of DEFAULT_PRIORITIES)
        await sql`INSERT INTO it_roadmap_priority (value, label, color, sort) VALUES (${p.value}, ${p.label}, ${p.color}, ${p.sort}) ON CONFLICT (value) DO NOTHING`;
    for (const k of DEFAULT_KPIS)
        await sql`INSERT INTO it_roadmap_kpi (code, name, target, sort) VALUES (${k.code}, ${k.name}, ${k.target}, ${k.sort}) ON CONFLICT (code) DO NOTHING`;
    let i = 1;
    for (const d of DEFAULT_DEPARTMENTS)
        await sql`INSERT INTO it_roadmap_department (name, sort) VALUES (${d}, ${i++}) ON CONFLICT (name) DO NOTHING`;
}
