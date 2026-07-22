// Default IT roadmap dataset (ported from the frontend mock) + seeding helper.
// ใช้ทั้งตอน migrate ครั้งแรก และตอนกด "รีเซ็ตเป็นข้อมูลตัวอย่าง"
import type { Sql } from 'postgres';

const iso = (y: number, m: number, d: number) => new Date(y, m, d).toISOString();

// ปีงบประมาณไทย (พ.ศ.) จากวันที่เริ่ม — เริ่มรอบ 1 ต.ค.
export const deriveFiscalYear = (startISO: string): number => {
    const d = new Date(startISO);
    return (d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear()) + 543;
};

interface SeedTask {
    id: number; code?: string; text: string; type: string; parent?: number; mission: string; fiscalYear?: number;
    start: string; end: string; progress?: number; status?: string; priority?: string;
    owner?: string; ownerPosition?: string; department?: string; contact?: string; team?: string[];
    budgetRequested?: number; budgetApproved?: number; budgetSpent?: number; budgetSource?: string;
    kpiCode?: string; kpiName?: string; kpiTarget?: string; description?: string; expectedOutcome?: string;
    vendor?: string; documents?: string[]; riskNote?: string;
    progressLog?: { date: string; progress: number; note: string; reportedBy: string; budgetSpentDelta?: number }[];
}

const TASKS: SeedTask[] = [
    { id: 1, code: 'IT-2026-S01', text: 'โครงการเสริมสร้างความปลอดภัยทางไซเบอร์', start: iso(2026, 0, 15), end: iso(2026, 6, 31), progress: 55, type: 'project', mission: 'security', status: 'in_progress', priority: 'high', owner: 'นายชัยพร ไซเบอร์', ownerPosition: 'หัวหน้างานความปลอดภัยทางไซเบอร์', department: 'งานความปลอดภัยทางไซเบอร์', contact: '081-234-5678', team: ['นายชัยพร ไซเบอร์', 'นางสาวอนันต์ ไฟร์วอลล์', 'นายภูมิ Pentest'], budgetRequested: 4500000, budgetApproved: 3800000, budgetSpent: 2090000, budgetSource: 'งบประมาณรายจ่าย 2569', kpiCode: 'IT-003', kpiName: 'จำนวนเหตุการณ์ความปลอดภัยทางไซเบอร์', kpiTarget: '0 ครั้ง', description: 'ปรับปรุงระบบรักษาความปลอดภัยทั้ง Firewall, EDR, SIEM และ Awareness Training ตามแนวทาง พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล', expectedOutcome: 'ผ่านการประเมิน Cybersecurity ของกระทรวง + ลดเหตุการณ์ Phishing ≥ 80%', documents: ['TOR-Security-2026.pdf', 'Risk Assessment.xlsx', 'Pentest Report 2025.pdf'], progressLog: [
        { date: iso(2026, 1, 28), progress: 25, note: 'ติดตั้ง Next-Gen Firewall ที่ Core เสร็จ', reportedBy: 'นายชัยพร', budgetSpentDelta: 1200000 },
        { date: iso(2026, 3, 30), progress: 45, note: 'เปิดใช้ EDR บนเครื่องผู้ใช้ 70%', reportedBy: 'นายชัยพร', budgetSpentDelta: 580000 },
        { date: iso(2026, 4, 30), progress: 55, note: 'อบรม Cyber Awareness รอบ 1 — ผู้เข้าร่วม 320 คน', reportedBy: 'นายชัยพร', budgetSpentDelta: 310000 },
    ] },
    { id: 11, code: 'IT-2026-S01-A1', text: 'จัดซื้อและติดตั้ง Next-Gen Firewall', start: iso(2026, 0, 15), end: iso(2026, 2, 15), progress: 100, type: 'task', parent: 1, mission: 'security', status: 'completed', priority: 'high', owner: 'นางสาวอนันต์ ไฟร์วอลล์', department: 'งานความปลอดภัยทางไซเบอร์', budgetRequested: 1800000, budgetApproved: 1800000, budgetSpent: 1750000, vendor: 'บริษัท SecureNet จำกัด', description: 'ติดตั้ง Fortigate 600F ทดแทนเครื่องเดิม + HA pair', documents: ['Contract-FW.pdf'] },
    { id: 12, code: 'IT-2026-S01-A2', text: 'ติดตั้งระบบ EDR บนเครื่องผู้ใช้ทั้งหมด', start: iso(2026, 2, 1), end: iso(2026, 4, 15), progress: 70, type: 'task', parent: 1, mission: 'security', status: 'in_progress', priority: 'high', owner: 'นายภูมิ Pentest', department: 'งานความปลอดภัยทางไซเบอร์', budgetRequested: 1200000, budgetApproved: 1100000, budgetSpent: 770000, description: 'Deploy CrowdStrike Falcon บนเครื่อง 480 เครื่อง', riskNote: 'เครื่องเก่าบางส่วนสเปคไม่รองรับ — ต้องเปลี่ยนเครื่อง 25 เครื่อง' },
    { id: 13, code: 'IT-2026-S01-A3', text: 'อบรม Cyber Awareness บุคลากร', start: iso(2026, 3, 1), end: iso(2026, 5, 30), progress: 50, type: 'task', parent: 1, mission: 'security', status: 'in_progress', priority: 'medium', owner: 'นายชัยพร ไซเบอร์', department: 'งานความปลอดภัยทางไซเบอร์', budgetRequested: 600000, budgetApproved: 500000, budgetSpent: 240000, description: 'อบรมผ่าน e-learning + Phishing simulation 4 ครั้งต่อปี' },
    { id: 14, code: 'IT-2026-S01-M1', text: 'ผ่านการประเมิน Cybersecurity Audit', start: iso(2026, 6, 31), end: iso(2026, 6, 31), type: 'milestone', parent: 1, mission: 'security', status: 'approved', priority: 'high', owner: 'นายชัยพร ไซเบอร์', department: 'งานความปลอดภัยทางไซเบอร์', description: 'ผ่านการประเมินจากผู้ตรวจประเมินภายนอก' },

    { id: 2, code: 'IT-2026-A01', text: 'อัปเกรดระบบ HIS เฟส 2 + เชื่อม HIE กระทรวง', start: iso(2026, 1, 1), end: iso(2026, 8, 30), progress: 40, type: 'project', mission: 'application', status: 'in_progress', priority: 'high', owner: 'นางสาวบี โปรแกรม', ownerPosition: 'นักวิชาการคอมพิวเตอร์ชำนาญการ', department: 'งานพัฒนาระบบสารสนเทศ', contact: '02-555-1234 ต่อ 1801', team: ['นางสาวบี โปรแกรม', 'นายเอก นักพัฒนา', 'นางสาวเจน ทดสอบระบบ'], budgetRequested: 6500000, budgetApproved: 5800000, budgetSpent: 2320000, budgetSource: 'เงินบำรุง', kpiCode: 'IT-002', kpiName: 'อัตราระบบสารสนเทศหลัก Uptime', kpiTarget: '≥ 99.5%', description: 'อัปเกรด HIS รองรับ FHIR + เชื่อมต่อ HIE ของกระทรวง + Dashboard รายงานผู้บริหาร', expectedOutcome: 'แลกเปลี่ยนข้อมูลผู้ป่วยกับ รพ.เครือข่ายได้แบบ real-time, รายงานผู้บริหารแบบ Self-service', documents: ['Master Plan HIS.pdf', 'API Spec FHIR.pdf'], progressLog: [
        { date: iso(2026, 2, 28), progress: 20, note: 'วิเคราะห์ระบบและออกแบบ schema เสร็จ', reportedBy: 'นางสาวบี', budgetSpentDelta: 850000 },
        { date: iso(2026, 4, 30), progress: 40, note: 'พัฒนา FHIR Adapter เสร็จ 60%', reportedBy: 'นางสาวบี', budgetSpentDelta: 1470000 },
    ] },
    { id: 21, code: 'IT-2026-A01-A1', text: 'ออกแบบและพัฒนา FHIR Adapter', start: iso(2026, 1, 1), end: iso(2026, 4, 30), progress: 65, type: 'task', parent: 2, mission: 'application', status: 'in_progress', priority: 'high', owner: 'นายเอก นักพัฒนา', department: 'งานพัฒนาระบบสารสนเทศ', budgetRequested: 1500000, budgetApproved: 1500000, budgetSpent: 980000 },
    { id: 22, code: 'IT-2026-A01-A2', text: 'เชื่อมต่อ API กับ HIE กระทรวง', start: iso(2026, 5, 1), end: iso(2026, 7, 30), progress: 0, type: 'task', parent: 2, mission: 'application', status: 'approved', priority: 'high', owner: 'นางสาวบี โปรแกรม', department: 'งานพัฒนาระบบสารสนเทศ', budgetRequested: 1200000, budgetApproved: 1100000, budgetSpent: 0, description: 'ผ่าน Sandbox testing ก่อน Production' },
    { id: 23, code: 'IT-2026-A01-A3', text: 'พัฒนา Executive Dashboard', start: iso(2026, 4, 1), end: iso(2026, 7, 15), progress: 25, type: 'task', parent: 2, mission: 'application', status: 'in_progress', priority: 'medium', owner: 'นางสาวเจน ทดสอบระบบ', department: 'งานวิเคราะห์ข้อมูลและรายงาน', budgetRequested: 1800000, budgetApproved: 1500000, budgetSpent: 380000, description: 'Dashboard บน Power BI / Metabase สำหรับผู้บริหาร' },
    { id: 24, code: 'IT-2026-A01-M1', text: 'Go-live HIS เฟส 2 + HIE', start: iso(2026, 8, 30), end: iso(2026, 8, 30), type: 'milestone', parent: 2, mission: 'application', status: 'approved', priority: 'high', owner: 'นางสาวบี โปรแกรม', department: 'งานพัฒนาระบบสารสนเทศ', description: 'เปิดใช้งานเต็มรูปแบบหลัง UAT' },

    { id: 3, code: 'IT-2026-SH01', text: 'ยกระดับ Smart Hospital สู่ระดับเงิน', start: iso(2026, 2, 1), end: iso(2026, 10, 30), progress: 30, type: 'project', mission: 'smart', status: 'in_progress', priority: 'high', owner: 'นพ.สมชาย ดิจิทัล', ownerPosition: 'รองผู้อำนวยการฝ่ายการแพทย์', department: 'กลุ่มงานสารสนเทศทางการแพทย์', contact: '081-789-1234', team: ['นพ.สมชาย', 'นางสาวบี โปรแกรม', 'นายชัยพร ไซเบอร์'], budgetRequested: 5500000, budgetApproved: 4800000, budgetSpent: 1440000, budgetSource: 'เงินบำรุง + งบประมาณ 2569', kpiCode: 'IT-004', kpiName: 'ร้อยละผู้ใช้ที่เข้าถึงระบบ Smart Hospital', kpiTarget: '≥ 80%', description: 'พัฒนาให้ผ่านเกณฑ์ Smart Hospital ระดับเงินครบ 7 ด้านของกระทรวง', expectedOutcome: 'ผ่านการประเมิน Smart Hospital ระดับเงินจากกระทรวงสาธารณสุข ภายในปีงบประมาณ', documents: ['Smart Hospital Master Plan.pdf', 'Self Assessment.xlsx'], riskNote: 'ระบบ Smart Queue ยังขาดเครื่อง Kiosk รุ่นที่กำหนด', progressLog: [
        { date: iso(2026, 3, 30), progress: 18, note: 'Smart Queue เปิด 3 คลินิก', reportedBy: 'นพ.สมชาย', budgetSpentDelta: 760000 },
        { date: iso(2026, 4, 30), progress: 30, note: 'Mobile App OPD รับ feedback กลุ่มทดลอง', reportedBy: 'นพ.สมชาย', budgetSpentDelta: 680000 },
    ] },
    { id: 31, code: 'IT-2026-SH01-A1', text: 'พัฒนา Smart Queue + ตู้ Kiosk', start: iso(2026, 2, 1), end: iso(2026, 5, 30), progress: 55, type: 'task', parent: 3, mission: 'smart', status: 'in_progress', priority: 'medium', owner: 'นายเอก นักพัฒนา', department: 'งานพัฒนาระบบสารสนเทศ', budgetRequested: 1800000, budgetApproved: 1600000, budgetSpent: 880000, description: 'ระบบคิวผ่าน LINE OA + ตู้ Kiosk 8 จุด' },
    { id: 32, code: 'IT-2026-SH01-A2', text: 'พัฒนา Mobile App ผู้ป่วยนอก', start: iso(2026, 3, 15), end: iso(2026, 7, 30), progress: 35, type: 'task', parent: 3, mission: 'smart', status: 'in_progress', priority: 'medium', owner: 'นางสาวบี โปรแกรม', department: 'งานพัฒนาระบบสารสนเทศ', budgetRequested: 1500000, budgetApproved: 1300000, budgetSpent: 380000, description: 'นัดหมาย / ดูผล Lab / ใบสั่งยา ผ่าน Mobile App' },
    { id: 33, code: 'IT-2026-SH01-A3', text: 'ติดตั้ง Tele-medicine Endpoint', start: iso(2026, 6, 1), end: iso(2026, 9, 30), progress: 0, type: 'task', parent: 3, mission: 'smart', status: 'approved', priority: 'medium', owner: 'นายชัยพร ไซเบอร์', department: 'งานเครือข่ายและโครงสร้างพื้นฐาน', budgetRequested: 1200000, budgetApproved: 1100000, budgetSpent: 0, description: 'ติดตั้งจุด Tele-medicine 6 คลินิก' },
    { id: 34, code: 'IT-2026-SH01-M1', text: 'ผ่านประเมิน Smart Hospital ระดับเงิน', start: iso(2026, 10, 30), end: iso(2026, 10, 30), type: 'milestone', parent: 3, mission: 'smart', status: 'approved', priority: 'high', owner: 'นพ.สมชาย ดิจิทัล', department: 'กลุ่มงานสารสนเทศทางการแพทย์', description: 'การประเมินจากกระทรวง' },

    { id: 4, code: 'IT-2026-N01', text: 'ปรับปรุงโครงข่ายและ Datacenter', start: iso(2026, 0, 1), end: iso(2026, 4, 30), progress: 80, type: 'project', mission: 'infra', status: 'in_progress', priority: 'high', owner: 'นายซี เน็ตเวิร์ก', ownerPosition: 'หัวหน้างานเครือข่าย', department: 'งานเครือข่ายและโครงสร้างพื้นฐาน', contact: '02-555-1234 ต่อ 1820', budgetRequested: 3800000, budgetApproved: 3500000, budgetSpent: 2800000, kpiCode: 'IT-002', kpiName: 'อัตราระบบสารสนเทศหลัก Uptime', kpiTarget: '≥ 99.5%', description: 'ปรับปรุง Core Switch + UPS + Backup link', expectedOutcome: 'Uptime ≥ 99.5% ลด downtime ที่ไม่ได้วางแผน', documents: ['Network Topology 2026.pdf'] },
    { id: 41, code: 'IT-2026-N01-A1', text: 'เปลี่ยน Core Switch + Stack', start: iso(2026, 0, 1), end: iso(2026, 1, 28), progress: 100, type: 'task', parent: 4, mission: 'infra', status: 'completed', priority: 'high', owner: 'นายซี เน็ตเวิร์ก', department: 'งานเครือข่ายและโครงสร้างพื้นฐาน', budgetRequested: 1800000, budgetApproved: 1800000, budgetSpent: 1780000, vendor: 'บริษัท CiscoTH จำกัด' },
    { id: 42, code: 'IT-2026-N01-A2', text: 'ติดตั้ง UPS ระบบใหม่ + Generator test', start: iso(2026, 2, 1), end: iso(2026, 3, 30), progress: 70, type: 'task', parent: 4, mission: 'infra', status: 'in_progress', priority: 'high', owner: 'นายซี เน็ตเวิร์ก', department: 'งานเครือข่ายและโครงสร้างพื้นฐาน', budgetRequested: 1200000, budgetApproved: 1100000, budgetSpent: 770000 },
    { id: 43, code: 'IT-2026-N01-A3', text: 'จัดทำเส้น Backup Internet', start: iso(2026, 3, 1), end: iso(2026, 4, 30), progress: 40, type: 'task', parent: 4, mission: 'infra', status: 'in_progress', priority: 'medium', owner: 'นายซี เน็ตเวิร์ก', department: 'งานเครือข่ายและโครงสร้างพื้นฐาน', budgetRequested: 600000, budgetApproved: 500000, budgetSpent: 200000 },
];

const LINKS: { source: number; target: number; type: number }[] = [
    { source: 11, target: 12, type: 0 }, { source: 12, target: 14, type: 0 }, { source: 13, target: 14, type: 0 },
    { source: 21, target: 22, type: 0 }, { source: 22, target: 24, type: 0 }, { source: 23, target: 24, type: 0 },
    { source: 31, target: 34, type: 0 }, { source: 32, target: 34, type: 0 }, { source: 33, target: 34, type: 0 },
    { source: 41, target: 42, type: 0 }, { source: 42, target: 43, type: 0 },
];

// truncate + reseed default dataset (คงลำดับ parent ก่อน child เพื่อ FK)
export async function seedRoadmap(sql: Sql<any>): Promise<void> {
    await sql`TRUNCATE it_roadmap_progress_logs, it_roadmap_links, it_roadmap_tasks RESTART IDENTITY CASCADE`;
    // ปีงบของโครงการแม่ (ไว้ให้งานย่อย/หมุดหมาย inherit — งานลูกที่คร่อมปีจะได้อยู่ปีเดียวกับโครงการ)
    const projectFY = new Map<number, number>();
    for (const t of TASKS.filter(x => x.parent == null)) {
        projectFY.set(t.id, t.fiscalYear ?? deriveFiscalYear(t.start));
    }
    for (const t of TASKS) {
        const fy = t.fiscalYear ?? (t.parent != null ? projectFY.get(t.parent) : undefined) ?? deriveFiscalYear(t.start);
        await sql`
            INSERT INTO it_roadmap_tasks
                (id, code, text, type, parent_id, mission, fiscal_year, start_date, end_date, progress, status, priority,
                 owner, owner_position, department, contact, team, budget_requested, budget_approved, budget_spent,
                 budget_source, kpi_code, kpi_name, kpi_target, description, expected_outcome, vendor, documents, risk_note)
            VALUES (${t.id}, ${t.code ?? null}, ${t.text}, ${t.type}, ${t.parent ?? null}, ${t.mission},
                    ${fy},
                    ${t.start}, ${t.end}, ${t.progress ?? null}, ${t.status ?? null}, ${t.priority ?? null},
                    ${t.owner ?? null}, ${t.ownerPosition ?? null}, ${t.department ?? null}, ${t.contact ?? null},
                    ${t.team ? sql.json(t.team) : null}, ${t.budgetRequested ?? null}, ${t.budgetApproved ?? null},
                    ${t.budgetSpent ?? null}, ${t.budgetSource ?? null}, ${t.kpiCode ?? null}, ${t.kpiName ?? null},
                    ${t.kpiTarget ?? null}, ${t.description ?? null}, ${t.expectedOutcome ?? null}, ${t.vendor ?? null},
                    ${t.documents ? sql.json(t.documents) : null}, ${t.riskNote ?? null})`;
        for (const p of t.progressLog ?? []) {
            await sql`
                INSERT INTO it_roadmap_progress_logs (task_id, log_date, progress, note, reported_by, budget_spent_delta)
                VALUES (${t.id}, ${p.date}, ${p.progress}, ${p.note}, ${p.reportedBy}, ${p.budgetSpentDelta ?? null})`;
        }
    }
    // ตั้ง sequence ให้ต่อจาก id สูงสุด
    await sql`SELECT setval(pg_get_serial_sequence('it_roadmap_tasks', 'id'), (SELECT COALESCE(MAX(id), 1) FROM it_roadmap_tasks))`;
    for (const l of LINKS) {
        await sql`INSERT INTO it_roadmap_links (source_id, target_id, link_type) VALUES (${l.source}, ${l.target}, ${l.type})`;
    }
}
