import { formatThaiDate } from './mophAlert';


const IT_MATENANCE_HEADERS = {
    'Content-Type': 'application/json',
    'client-key': process.env.IT_MATENANCE_CLIENT_ID!,
    'secret-key': process.env.IT_MATENANCE_SECRET_ID!,
};

// IT Maintenance Template
export interface ItMaintenanceData {
    requestId: number;
    equipmentNumber: string;
    equipmentName: string;
    location: string;
    problemDescription: string;
    priorityName?: string;
    equipmentTypeName?: string;
    problemCategoryName?: string;
    imageCount?: number;
    reporterName?: string;
    reporterUnit?: string;
}

function buildItMaintenanceTemplate(data: ItMaintenanceData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentNumber, equipmentName,
        location, problemDescription,
        priorityName, equipmentTypeName, problemCategoryName,
        imageCount = 0,
        reporterName, reporterUnit,
    } = data;

    const requestRows = [
        { label: 'เลขคำร้อง', value: `#${requestId}` },
        { label: 'วันที่', value: thaiDate },
        { label: 'เวลา', value: `${thaiTime} น.` },
        ...(priorityName ? [{ label: 'ความเร่งด่วน', value: priorityName }] : []),
        ...(equipmentTypeName ? [{ label: 'ประเภท', value: equipmentTypeName }] : []),
        { label: 'ครุภัณฑ์', value: `${equipmentName} (${equipmentNumber})` },
        { label: 'สถานที่', value: location },
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        { label: 'อาการ', value: problemDescription },
        ...(imageCount > 0 ? [{ label: 'รูปแนบ', value: `📎 ${imageCount} รูป` }] : []),
    ];

    const reporterRows = [
        ...(reporterName ? [{ label: 'ผู้แจ้งซ่อม', value: reporterName }] : []),
        ...(reporterUnit ? [{ label: 'หน่วยงาน', value: reporterUnit }] : []),
    ];

    const toRow = (row: { label: string; value: string }) => ({
        type: 'box',
        layout: 'baseline',
        contents: [
            { type: 'text', text: row.label, size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: row.value, size: 'sm', weight: 'bold', color: '#10b981', flex: 5, wrap: true },
        ],
    });

    return {
        messages: [
            {
                type: 'flex',
                altText: `แจ้งงานซ่อมคอมพิวเตอร์ #${requestId}`,
                contents: {
                    type: 'bubble',
                    size: 'mega',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0d1b2a',
                        contents: [
                            { type: 'text', text: '🛠️ PYHOS-EXP', weight: 'bold', size: 'lg', color: '#10b981' },
                            { type: 'text', text: 'IT Maintenance Notification', size: 'xs', color: '#6b7280', margin: 'xs' },
                        ],
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0f172a',
                        contents: [
                            { type: 'text', text: `แจ้งงานซ่อมคอมพิวเตอร์ #${requestId}`, weight: 'bold', size: 'xl', color: '#f8fafc', wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box',
                                layout: 'vertical',
                                margin: 'lg',
                                spacing: 'sm',
                                contents: requestRows.map(toRow),
                            },
                            ...(reporterRows.length > 0 ? [
                                { type: 'separator', margin: 'lg', color: '#1e293b' },
                                { type: 'text', text: '👤 ผู้แจ้งซ่อม', size: 'sm', color: '#94a3b8', margin: 'lg', weight: 'bold' },
                                {
                                    type: 'box',
                                    layout: 'vertical',
                                    margin: 'sm',
                                    spacing: 'sm',
                                    contents: reporterRows.map(toRow),
                                },
                            ] : []),
                        ],
                    },
                },
            },
        ],
    };
}

export async function mophItMatenance(data: ItMaintenanceData): Promise<void> {
    const payload = buildItMaintenanceTemplate(data);
    const url = `${process.env.MOPH_NOTIFY_BASE_URL}/api/notify/send`;
    const res = await fetch(url, {
        method: 'POST',
        headers: IT_MATENANCE_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Notify] IT Maintenance Template:', res.status, await res.text());
}

// Receive Assignment Template
export interface ReceiveAssignmentData {
    requestId: number;
    equipmentNumber: string;
    equipmentName: string;
    location: string;
    problemDescription: string;
    equipmentTypeName?: string;
    problemCategoryName?: string;
    priorityName?: string;
    technicianPriorityName?: string;
    technicianName?: string;
    assignDatetime?: string;
    estimatedDays?: number;
    estimatedCompletionDate?: string;
}

function buildReceiveAssignmentTemplate(data: ReceiveAssignmentData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentNumber, equipmentName,
        location, problemDescription,
        equipmentTypeName, problemCategoryName, priorityName,
        technicianPriorityName,
        technicianName, assignDatetime,
        estimatedDays, estimatedCompletionDate,
    } = data;

    const toRow = (row: { label: string; value: string; color?: string }) => ({
        type: 'box',
        layout: 'baseline',
        contents: [
            { type: 'text', text: row.label, size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: row.value, size: 'sm', weight: 'bold', color: row.color ?? '#38bdf8', flex: 5, wrap: true },
        ],
    });

    // สีตามระดับความเร่งด่วน: ปกติ → เขียว, ปานกลาง → เหลือง, เร่งด่วน → ส้ม, วิกฤต → แดง
    const priorityColor = (name: string): string => {
        if (name.includes('วิกฤต')) return '#ef4444';
        if (name.includes('เร่งด่วน')) return '#f97316';
        if (name.includes('ปานกลาง')) return '#eab308';
        if (name.includes('ปกติ')) return '#22c55e';
        return '#38bdf8';
    };

    const rows = [
        { label: 'เลขคำร้อง', value: `#${requestId}` },
        { label: 'รับงานเมื่อ', value: assignDatetime ?? `${thaiDate} ${thaiTime} น.` },
        ...(priorityName ? [{ label: 'ความเร่งด่วน', value: priorityName, color: priorityColor(priorityName) }] : []),
        ...(equipmentTypeName ? [{ label: 'ประเภท', value: equipmentTypeName }] : []),
        { label: 'ครุภัณฑ์', value: `${equipmentName} (${equipmentNumber})` },
        { label: 'สถานที่', value: location },
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        { label: 'อาการ', value: problemDescription },
    ];

    // ส่วนของช่าง (คั่นด้วยเส้น)
    const techRows = [
        ...(technicianName ? [{ label: 'ช่างผู้รับงาน', value: technicianName }] : []),
        ...(technicianPriorityName ? [{ label: 'ช่างประเมินระดับ', value: technicianPriorityName, color: priorityColor(technicianPriorityName) }] : []),
        ...(estimatedDays != null ? [{ label: 'ประเมินเสร็จใน', value: `${estimatedDays} วัน` }] : []),
        ...(estimatedCompletionDate ? [{ label: 'คาดเสร็จวันที่', value: formatThaiDate(new Date(estimatedCompletionDate)).thaiDate }] : []),
    ];

    return {
        messages: [
            {
                type: 'flex',
                altText: `รับงานซ่อม #${requestId}`,
                contents: {
                    type: 'bubble',
                    size: 'mega',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0d1b2a',
                        contents: [
                            { type: 'text', text: '⚙️ PYHOS-EXP', weight: 'bold', size: 'lg', color: '#38bdf8' },
                            { type: 'text', text: 'IT Repair In Progress', size: 'xs', color: '#6b7280', margin: 'xs' },
                        ],
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0f172a',
                        contents: [
                            {
                                type: 'box',
                                layout: 'vertical',
                                margin: 'lg',
                                spacing: 'sm',
                                contents: [
                                    ...rows.map(toRow),
                                    ...(techRows.length > 0
                                        ? [{ type: 'separator', margin: 'md', color: '#1e293b' }, ...techRows.map(toRow)]
                                        : []),
                                ],
                            },
                        ],
                    },
                },
            },
        ],
    };
}

export async function mophReceiveAssignment(data: ReceiveAssignmentData): Promise<void> {
    const payload = buildReceiveAssignmentTemplate(data);
    const url = `${process.env.MOPH_NOTIFY_BASE_URL}/api/notify/send`;
    const res = await fetch(url, {
        method: 'POST',
        headers: IT_MATENANCE_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Notify] Receive Assignment Template:', res.status, await res.text());
}

// Reject Assignment Template (แจ้งเข้าหน่วยงาน)
export interface RejectAssignmentData {
    requestId: number;
    equipmentNumber: string;
    equipmentName: string;
    location?: string;
    problemDescription?: string;
    equipmentTypeName?: string;
    problemCategoryName?: string;
    priorityName?: string;
    technicianName?: string;
    rejectReason: string;
    requestedAt?: string;
}

function buildRejectAssignmentTemplate(data: RejectAssignmentData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentNumber, equipmentName,
        location, problemDescription,
        equipmentTypeName, problemCategoryName, priorityName,
        technicianName, rejectReason, requestedAt,
    } = data;

    const toRow = (row: { label: string; value: string; color?: string }) => ({
        type: 'box',
        layout: 'baseline',
        contents: [
            { type: 'text', text: row.label, size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: row.value, size: 'sm', weight: 'bold', color: row.color ?? '#f8fafc', flex: 5, wrap: true },
        ],
    });

    const requestedThai = requestedAt ? formatThaiDate(new Date(requestedAt)) : null;

    const rows = [
        { label: 'เลขคำร้อง', value: `#${requestId}` },
        ...(requestedThai ? [{ label: 'วันที่ส่งซ่อม', value: `${requestedThai.thaiDate} ${requestedThai.thaiTime} น.` }] : []),
        { label: 'ปฏิเสธเมื่อ', value: `${thaiDate} ${thaiTime} น.` },
        ...(priorityName ? [{ label: 'ความเร่งด่วน', value: priorityName }] : []),
        ...(equipmentTypeName ? [{ label: 'ประเภท', value: equipmentTypeName }] : []),
        { label: 'ครุภัณฑ์', value: `${equipmentName} (${equipmentNumber})` },
        ...(location ? [{ label: 'สถานที่', value: location }] : []),
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        ...(problemDescription ? [{ label: 'อาการ', value: problemDescription }] : []),
        ...(technicianName ? [{ label: 'ผู้ปฏิเสธ', value: technicianName }] : []),
    ];

    return {
        messages: [
            {
                type: 'flex',
                altText: `คำร้องซ่อม #${requestId} ถูกปฏิเสธ`,
                contents: {
                    type: 'bubble',
                    size: 'mega',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0d1b2a',
                        contents: [
                            { type: 'text', text: '⚙️ PYHOS-EXP', weight: 'bold', size: 'lg', color: '#f87171' },
                            { type: 'text', text: 'IT Repair Rejected', size: 'xs', color: '#6b7280', margin: 'xs' },
                        ],
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0f172a',
                        contents: [
                            { type: 'text', text: `คำร้องซ่อม #${requestId} ถูกปฏิเสธ`, weight: 'bold', size: 'xl', color: '#f87171', wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box',
                                layout: 'vertical',
                                margin: 'lg',
                                spacing: 'sm',
                                contents: rows.map(toRow),
                            },
                            {
                                type: 'box', layout: 'vertical', margin: 'lg',
                                backgroundColor: '#1e0a0a', paddingAll: '12px', cornerRadius: 'md',
                                contents: [
                                    { type: 'text', text: 'เหตุผลการปฏิเสธ', size: 'xs', color: '#6b7280' },
                                    { type: 'text', text: rejectReason, size: 'sm', weight: 'bold', color: '#f87171', wrap: true },
                                ],
                            },
                        ],
                    },
                },
            },
        ],
    };
}

export async function mophRejectAssignment(data: RejectAssignmentData): Promise<void> {
    const payload = buildRejectAssignmentTemplate(data);
    const url = `${process.env.MOPH_NOTIFY_BASE_URL}/api/notify/send`;
    const res = await fetch(url, {
        method: 'POST',
        headers: IT_MATENANCE_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Notify] Reject Assignment Template:', res.status, await res.text());
}

// Repair Assessment Template
export interface RepairAssessmentData {
    requestId: number;
    equipmentNumber: string;
    equipmentName: string;
    assessmentName: string;
    assessmentDetail: string;
    processStatusName: string;
    technicianName?: string;
    partsUsed?: string;
    replacementRecommendation?: string;
    externalServiceDetail?: string;
}

function buildRepairAssessmentTemplate(data: RepairAssessmentData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentNumber, equipmentName,
        assessmentName, assessmentDetail, processStatusName,
        technicianName, partsUsed, replacementRecommendation, externalServiceDetail,
    } = data;

    const toRow = (row: { label: string; value: string }) => ({
        type: 'box',
        layout: 'baseline',
        contents: [
            { type: 'text', text: row.label, size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: row.value, size: 'sm', weight: 'bold', color: '#f59e0b', flex: 5, wrap: true },
        ],
    });

    const mainRows = [
        { label: 'เลขคำร้อง', value: `#${requestId}` },
        { label: 'วันที่', value: thaiDate },
        { label: 'เวลา', value: `${thaiTime} น.` },
        { label: 'ครุภัณฑ์', value: `${equipmentName} (${equipmentNumber})` },
        { label: 'ผลการประเมิน', value: assessmentName },
        { label: 'รายละเอียด', value: assessmentDetail },
        ...(partsUsed ? [{ label: 'อะไหล่ที่ใช้', value: partsUsed }] : []),
        ...(replacementRecommendation ? [{ label: 'แนะนำเปลี่ยน', value: replacementRecommendation }] : []),
        ...(externalServiceDetail ? [{ label: 'ส่งซ่อมภายนอก', value: externalServiceDetail }] : []),
        { label: 'สถานะงาน', value: processStatusName },
        ...(technicianName ? [{ label: 'ช่างผู้ดำเนินการ', value: technicianName }] : []),
    ];

    return {
        messages: [
            {
                type: 'flex',
                altText: `ผลการประเมินซ่อม #${requestId}`,
                contents: {
                    type: 'bubble',
                    size: 'mega',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0d1b2a',
                        contents: [
                            { type: 'text', text: '🔧 PYHOS-EXP', weight: 'bold', size: 'lg', color: '#f59e0b' },
                            { type: 'text', text: 'IT Repair Assessment Result', size: 'xs', color: '#6b7280', margin: 'xs' },
                        ],
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0f172a',
                        contents: [
                            { type: 'text', text: `ผลการประเมินซ่อม #${requestId}`, weight: 'bold', size: 'xl', color: '#f8fafc', wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box',
                                layout: 'vertical',
                                margin: 'lg',
                                spacing: 'sm',
                                contents: mainRows.map(toRow),
                            },
                        ],
                    },
                },
            },
        ],
    };
}

export async function mophRepairAssessment(data: RepairAssessmentData): Promise<void> {
    const payload = buildRepairAssessmentTemplate(data);
    const url = `${process.env.MOPH_NOTIFY_BASE_URL}/api/notify/send`;
    const res = await fetch(url, {
        method: 'POST',
        headers: IT_MATENANCE_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Notify] Repair Assessment Template:', res.status, await res.text());
}

// Request Extension Template (แจ้งเข้าหน่วยงาน IT เมื่อช่างขอเวลาเพิ่ม)
export interface RequestExtensionData {
    requestId: number;
    equipmentNumber: string;
    equipmentName: string;
    location?: string;
    problemDescription?: string;
    equipmentTypeName?: string;
    problemCategoryName?: string;
    technicianName?: string;
    requestedAt?: string;
    previousCompletionDate?: string;
    newCompletionDate: string;
    extensionDays?: number;
    extensionReason: string;
}

function buildRequestExtensionTemplate(data: RequestExtensionData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentNumber, equipmentName,
        location, problemDescription,
        equipmentTypeName, problemCategoryName,
        technicianName, requestedAt, previousCompletionDate, newCompletionDate,
        extensionDays, extensionReason,
    } = data;

    const requestedThai = requestedAt ? formatThaiDate(new Date(requestedAt)) : null;

    const toRow = (row: { label: string; value: string; color?: string }) => ({
        type: 'box',
        layout: 'baseline',
        contents: [
            { type: 'text', text: row.label, size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: row.value, size: 'sm', weight: 'bold', color: row.color ?? '#f59e0b', flex: 5, wrap: true },
        ],
    });

    const rows = [
        { label: 'เลขคำร้อง', value: `#${requestId}` },
        ...(requestedThai ? [{ label: 'วันที่ส่งซ่อม', value: `${requestedThai.thaiDate} ${requestedThai.thaiTime} น.` }] : []),
        { label: 'ขอเลื่อนเมื่อ', value: `${thaiDate} ${thaiTime} น.` },
        ...(equipmentTypeName ? [{ label: 'ประเภท', value: equipmentTypeName }] : []),
        { label: 'ครุภัณฑ์', value: `${equipmentName} (${equipmentNumber})` },
        ...(location ? [{ label: 'สถานที่', value: location }] : []),
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        ...(problemDescription ? [{ label: 'อาการ', value: problemDescription }] : []),
        ...(technicianName ? [{ label: 'ช่างผู้ขอเลื่อน', value: technicianName }] : []),
    ];

    const scheduleRows = [
        ...(previousCompletionDate ? [{ label: 'กำหนดเดิม', value: formatThaiDate(new Date(previousCompletionDate)).thaiDate, color: '#94a3b8' }] : []),
        { label: 'กำหนดใหม่', value: formatThaiDate(new Date(newCompletionDate)).thaiDate },
        ...(extensionDays != null ? [{ label: 'ขอเพิ่ม', value: `${extensionDays} วัน` }] : []),
    ];

    return {
        messages: [
            {
                type: 'flex',
                altText: `ช่างขอเวลาเพิ่ม #${requestId}`,
                contents: {
                    type: 'bubble',
                    size: 'mega',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0d1b2a',
                        contents: [
                            { type: 'text', text: '⏳ PYHOS-EXP', weight: 'bold', size: 'lg', color: '#f59e0b' },
                            { type: 'text', text: 'IT Repair Time Extension', size: 'xs', color: '#6b7280', margin: 'xs' },
                        ],
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0f172a',
                        contents: [
                            { type: 'text', text: `ช่างขอเวลาเพิ่ม #${requestId}`, weight: 'bold', size: 'xl', color: '#f59e0b', wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box',
                                layout: 'vertical',
                                margin: 'lg',
                                spacing: 'sm',
                                contents: [
                                    ...rows.map(toRow),
                                    { type: 'separator', margin: 'md', color: '#1e293b' },
                                    ...scheduleRows.map(toRow),
                                ],
                            },
                            {
                                type: 'box', layout: 'vertical', margin: 'lg',
                                backgroundColor: '#1c1407', paddingAll: '12px', cornerRadius: 'md',
                                contents: [
                                    { type: 'text', text: 'เหตุผลที่ขอเวลาเพิ่ม', size: 'xs', color: '#6b7280' },
                                    { type: 'text', text: extensionReason, size: 'sm', weight: 'bold', color: '#f59e0b', wrap: true },
                                ],
                            },
                        ],
                    },
                },
            },
        ],
    };
}

export async function mophRequestExtension(data: RequestExtensionData): Promise<void> {
    const payload = buildRequestExtensionTemplate(data);
    const url = `${process.env.MOPH_NOTIFY_BASE_URL}/api/notify/send`;
    const res = await fetch(url, {
        method: 'POST',
        headers: IT_MATENANCE_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Notify] Request Extension Template:', res.status, await res.text());
}

// Header Approve Template (แจ้งเข้าหน่วยงาน IT เมื่อหัวหน้าอนุมัติ/ไม่อนุมัติ)
export interface HeaderApproveData {
    requestId: number;
    equipmentNumber: string;
    equipmentName: string;
    location?: string;
    problemDescription?: string;
    equipmentTypeName?: string;
    problemCategoryName?: string;
    technicianName?: string;
    approverName?: string;
    requestedAt?: string;
    headerApprove: number; // 1 = อนุมัติ, 2 = ไม่อนุมัติ
    headerComment?: string;
}

function buildHeaderApproveTemplate(data: HeaderApproveData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentNumber, equipmentName,
        location, problemDescription,
        equipmentTypeName, problemCategoryName,
        technicianName, approverName, requestedAt,
        headerApprove, headerComment,
    } = data;

    const approved = headerApprove === 1;
    const accent = approved ? '#22c55e' : '#f87171';
    const resultText = approved ? 'หัวหน้าอนุมัติแล้ว' : 'หัวหน้าไม่อนุมัติ';
    const requestedThai = requestedAt ? formatThaiDate(new Date(requestedAt)) : null;

    const toRow = (row: { label: string; value: string; color?: string }) => ({
        type: 'box',
        layout: 'baseline',
        contents: [
            { type: 'text', text: row.label, size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: row.value, size: 'sm', weight: 'bold', color: row.color ?? accent, flex: 5, wrap: true },
        ],
    });

    const rows = [
        { label: 'เลขคำร้อง', value: `#${requestId}` },
        ...(requestedThai ? [{ label: 'วันที่ส่งซ่อม', value: `${requestedThai.thaiDate} ${requestedThai.thaiTime} น.` }] : []),
        { label: 'พิจารณาเมื่อ', value: `${thaiDate} ${thaiTime} น.` },
        { label: 'ผลพิจารณา', value: resultText },
        ...(equipmentTypeName ? [{ label: 'ประเภท', value: equipmentTypeName }] : []),
        { label: 'ครุภัณฑ์', value: `${equipmentName} (${equipmentNumber})` },
        ...(location ? [{ label: 'สถานที่', value: location }] : []),
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        ...(problemDescription ? [{ label: 'อาการ', value: problemDescription }] : []),
        ...(technicianName ? [{ label: 'ช่างผู้รับงาน', value: technicianName }] : []),
        ...(approverName ? [{ label: 'ผู้พิจารณา', value: approverName }] : []),
    ];

    return {
        messages: [
            {
                type: 'flex',
                altText: `${resultText} #${requestId}`,
                contents: {
                    type: 'bubble',
                    size: 'mega',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0d1b2a',
                        contents: [
                            { type: 'text', text: `${approved ? '✅' : '🚫'} PYHOS-EXP`, weight: 'bold', size: 'lg', color: accent },
                            { type: 'text', text: 'IT Repair Approval', size: 'xs', color: '#6b7280', margin: 'xs' },
                        ],
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0f172a',
                        contents: [
                            { type: 'text', text: `${resultText} #${requestId}`, weight: 'bold', size: 'xl', color: accent, wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box',
                                layout: 'vertical',
                                margin: 'lg',
                                spacing: 'sm',
                                contents: rows.map(toRow),
                            },
                            ...(headerComment ? [{
                                type: 'box', layout: 'vertical', margin: 'lg',
                                backgroundColor: approved ? '#06140b' : '#1e0a0a', paddingAll: '12px', cornerRadius: 'md',
                                contents: [
                                    { type: 'text', text: 'ความเห็นหัวหน้า', size: 'xs', color: '#6b7280' },
                                    { type: 'text', text: headerComment, size: 'sm', weight: 'bold', color: accent, wrap: true },
                                ],
                            }] : []),
                        ],
                    },
                },
            },
        ],
    };
}

export async function mophHeaderApprove(data: HeaderApproveData): Promise<void> {
    const payload = buildHeaderApproveTemplate(data);
    const url = `${process.env.MOPH_NOTIFY_BASE_URL}/api/notify/send`;
    const res = await fetch(url, {
        method: 'POST',
        headers: IT_MATENANCE_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Notify] Header Approve Template:', res.status, await res.text());
}

// Mission Approve Template (แจ้งเข้าหน่วยงาน IT เมื่อหัวหน้ากลุ่มภารกิจอนุมัติ/ไม่อนุมัติ)
export interface MissionApproveData {
    requestId: number;
    equipmentNumber: string;
    equipmentName: string;
    location?: string;
    problemDescription?: string;
    equipmentTypeName?: string;
    problemCategoryName?: string;
    technicianName?: string;
    approverName?: string;
    assessmentName?: string;
    nextStatusName?: string;
    requestedAt?: string;
    missionApprove: number; // 1 = อนุมัติ, 2 = ไม่อนุมัติ
    missionComment?: string;
}

function buildMissionApproveTemplate(data: MissionApproveData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentNumber, equipmentName,
        location, problemDescription,
        equipmentTypeName, problemCategoryName,
        technicianName, approverName, assessmentName, nextStatusName, requestedAt,
        missionApprove, missionComment,
    } = data;

    const approved = missionApprove === 1;
    const accent = approved ? '#22c55e' : '#f87171';
    const resultText = approved ? 'หัวหน้ากลุ่มภารกิจอนุมัติ' : 'หัวหน้ากลุ่มภารกิจไม่อนุมัติ';
    const requestedThai = requestedAt ? formatThaiDate(new Date(requestedAt)) : null;

    const toRow = (row: { label: string; value: string; color?: string }) => ({
        type: 'box',
        layout: 'baseline',
        contents: [
            { type: 'text', text: row.label, size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: row.value, size: 'sm', weight: 'bold', color: row.color ?? accent, flex: 5, wrap: true },
        ],
    });

    const rows = [
        { label: 'เลขคำร้อง', value: `#${requestId}` },
        ...(requestedThai ? [{ label: 'วันที่ส่งซ่อม', value: `${requestedThai.thaiDate} ${requestedThai.thaiTime} น.` }] : []),
        { label: 'พิจารณาเมื่อ', value: `${thaiDate} ${thaiTime} น.` },
        { label: 'ผลพิจารณา', value: resultText },
        ...(assessmentName ? [{ label: 'ผลประเมินช่าง', value: assessmentName }] : []),
        ...(approved && nextStatusName ? [{ label: 'ขั้นตอนถัดไป', value: nextStatusName, color: '#38bdf8' }] : []),
        ...(equipmentTypeName ? [{ label: 'ประเภท', value: equipmentTypeName }] : []),
        { label: 'ครุภัณฑ์', value: `${equipmentName} (${equipmentNumber})` },
        ...(location ? [{ label: 'สถานที่', value: location }] : []),
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        ...(problemDescription ? [{ label: 'อาการ', value: problemDescription }] : []),
        ...(technicianName ? [{ label: 'ช่างผู้รับงาน', value: technicianName }] : []),
        ...(approverName ? [{ label: 'ผู้พิจารณา', value: approverName }] : []),
    ];

    return {
        messages: [
            {
                type: 'flex',
                altText: `${resultText} #${requestId}`,
                contents: {
                    type: 'bubble',
                    size: 'mega',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0d1b2a',
                        contents: [
                            { type: 'text', text: `${approved ? '✅' : '🚫'} PYHOS-EXP`, weight: 'bold', size: 'lg', color: accent },
                            { type: 'text', text: 'IT Repair Mission Approval', size: 'xs', color: '#6b7280', margin: 'xs' },
                        ],
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0f172a',
                        contents: [
                            { type: 'text', text: `${resultText} #${requestId}`, weight: 'bold', size: 'xl', color: accent, wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box',
                                layout: 'vertical',
                                margin: 'lg',
                                spacing: 'sm',
                                contents: rows.map(toRow),
                            },
                            ...(missionComment ? [{
                                type: 'box', layout: 'vertical', margin: 'lg',
                                backgroundColor: approved ? '#06140b' : '#1e0a0a', paddingAll: '12px', cornerRadius: 'md',
                                contents: [
                                    { type: 'text', text: 'ความเห็นหัวหน้ากลุ่มภารกิจ', size: 'xs', color: '#6b7280' },
                                    { type: 'text', text: missionComment, size: 'sm', weight: 'bold', color: accent, wrap: true },
                                ],
                            }] : []),
                        ],
                    },
                },
            },
        ],
    };
}

export async function mophMissionApprove(data: MissionApproveData): Promise<void> {
    const payload = buildMissionApproveTemplate(data);
    const url = `${process.env.MOPH_NOTIFY_BASE_URL}/api/notify/send`;
    const res = await fetch(url, {
        method: 'POST',
        headers: IT_MATENANCE_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Notify] Mission Approve Template:', res.status, await res.text());
}
