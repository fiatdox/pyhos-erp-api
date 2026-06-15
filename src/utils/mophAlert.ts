export const MOPH_ALERTING_URL = `${process.env.MOPH_ALERT_BASE_URL}/alert/v3.1/messages`;

const MOPH_HEADERS = {
    'Content-Type': 'application/json',
    'client-key': process.env.MOPH_ALERT_CLIENT_ID!,
    'secret-key': process.env.MOPH_ALERT_SECRET_ID!,
};


export function formatThaiDate(date: Date): { thaiDate: string; thaiTime: string } {
    const months = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const thaiDate = `${date.getDate()} ${months[date.getMonth() + 1]} ${date.getFullYear() + 543}`;
    const thaiTime = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
    return { thaiDate, thaiTime };
}

function maskPassword(password: string): string {
    if (password.length <= 4) return '****';
    const head = password.slice(0, 2);
    const tail = password.slice(-2);
    const dots = '*'.repeat(Math.min(password.length - 4, 6));
    return `${head}${dots}${tail}`;
}

// Change Password Template
function buildChangePasswordTemplate(newPassword: string): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());

    return {
        message_title: 'แจ้งเตือน: มีการเปลี่ยนรหัสผ่าน',
        message_html: `<div><p><strong>แจ้งเตือน: มีการเปลี่ยนรหัสผ่าน</strong></p><ul><li><b>วันที่:</b> ${thaiDate}</li><li><b>เวลา:</b> ${thaiTime} น.</li></ul><p style="color:#cc0000;">หากคุณไม่ได้ดำเนินการด้วยตนเอง กรุณาติดต่อทีม IT ทันที</p></div>`,
        message_text: `แจ้งเตือน: รหัสผ่านถูกเปลี่ยนเมื่อ ${thaiDate} เวลา ${thaiTime} น.`,
        message_type: 'HPT',
        messages: [
            {
                type: 'flex',
                altText: 'แจ้งเตือน: มีการเปลี่ยนรหัสผ่าน',
                contents: {
                    type: 'bubble',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0d1b2a',
                        contents: [
                            { type: 'text', text: '🔐 PYHOS-EXP', weight: 'bold', size: 'lg', color: '#10b981' },
                            { type: 'text', text: 'Ministry Hospital Portal', size: 'xs', color: '#6b7280', margin: 'xs' },
                        ],
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0f172a',
                        contents: [
                            { type: 'text', text: 'แจ้งเตือนเปลี่ยนรหัสผ่าน', weight: 'bold', size: 'xl', color: '#f8fafc' },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
                                contents: [
                                    {
                                        type: 'box', layout: 'baseline',
                                        contents: [
                                            { type: 'text', text: 'วันที่', size: 'sm', color: '#6b7280', flex: 2 },
                                            { type: 'text', text: thaiDate, size: 'md', color: '#10b981', weight: 'bold', flex: 5 },
                                        ],
                                    },
                                    {
                                        type: 'box', layout: 'baseline',
                                        contents: [
                                            { type: 'text', text: 'เวลา', size: 'sm', color: '#6b7280', flex: 2 },
                                            { type: 'text', text: `${thaiTime} น.`, size: 'md', color: '#10b981', weight: 'bold', flex: 5 },
                                        ],
                                    },
                                    {
                                        type: 'box', layout: 'vertical', margin: 'md',
                                        backgroundColor: '#1e293b', paddingAll: '12px', cornerRadius: 'md',
                                        contents: [
                                            { type: 'text', text: 'รหัสผ่านใหม่', size: 'xs', color: '#6b7280' },
                                            { type: 'text', text: maskPassword(newPassword), size: 'lg', weight: 'bold', color: '#10b981', wrap: true },
                                        ],
                                    },
                                ],
                            },
                            {
                                type: 'box', layout: 'vertical', margin: 'lg',
                                backgroundColor: '#1e0a0a', paddingAll: '12px', cornerRadius: 'md',
                                contents: [
                                    { type: 'text', text: 'หากคุณไม่ได้ดำเนินการด้วยตนเอง กรุณาติดต่อทีม IT ทันที', size: 'sm', color: '#f87171', wrap: true, weight: 'bold' },
                                ],
                            },
                        ],
                    },
                },
            },
        ],
    };
}

export async function sendChangePasswordAlert(idCard: string, newPassword: string): Promise<void> {
    const payload = { cid: [idCard], ...buildChangePasswordTemplate(newPassword) };
    const res = await fetch(MOPH_ALERTING_URL, {
        method: 'POST',
        headers: MOPH_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Alert] Change Password Template:', res.status, await res.text());
}

// IT Repair Rejected Template (แจ้งกลับผู้ส่งซ่อม)
export interface RepairRejectedData {
    requestId: number;
    equipmentName?: string;
    equipmentNumber?: string;
    location?: string;
    problemDescription?: string;
    equipmentTypeName?: string;
    problemCategoryName?: string;
    priorityName?: string;
    technicianName?: string;
    rejectReason: string;
    requestedAt?: string;
}

function buildRepairRejectedTemplate(data: RepairRejectedData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentName, equipmentNumber,
        location, problemDescription,
        equipmentTypeName, problemCategoryName, priorityName,
        technicianName, rejectReason, requestedAt,
    } = data;

    const equipmentText = equipmentName
        ? `${equipmentName}${equipmentNumber ? ` (${equipmentNumber})` : ''}`
        : '-';

    const requestedThai = requestedAt ? formatThaiDate(new Date(requestedAt)) : null;

    const rows = [
        { label: 'เลขคำร้อง', value: `#${requestId}` },
        ...(requestedThai ? [{ label: 'วันที่ส่งซ่อม', value: `${requestedThai.thaiDate} ${requestedThai.thaiTime} น.` }] : []),
        { label: 'ปฏิเสธเมื่อ', value: `${thaiDate} ${thaiTime} น.` },
        ...(priorityName ? [{ label: 'ความเร่งด่วน', value: priorityName }] : []),
        ...(equipmentTypeName ? [{ label: 'ประเภท', value: equipmentTypeName }] : []),
        { label: 'ครุภัณฑ์', value: equipmentText },
        ...(location ? [{ label: 'สถานที่', value: location }] : []),
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        ...(problemDescription ? [{ label: 'อาการ', value: problemDescription }] : []),
        ...(technicianName ? [{ label: 'ผู้ปฏิเสธ', value: technicianName }] : []),
    ];

    const toRow = (row: { label: string; value: string }) => ({
        type: 'box', layout: 'baseline',
        contents: [
            { type: 'text', text: row.label, size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: row.value, size: 'sm', weight: 'bold', color: '#f8fafc', flex: 5, wrap: true },
        ],
    });

    return {
        message_title: 'แจ้งผลคำร้องซ่อม: ถูกปฏิเสธ',
        message_html: `<div><p><strong>แจ้งผลคำร้องซ่อม #${requestId}: ถูกปฏิเสธ</strong></p><ul><li><b>วันที่:</b> ${thaiDate} ${thaiTime} น.</li><li><b>ครุภัณฑ์:</b> ${equipmentText}</li>${technicianName ? `<li><b>ผู้ปฏิเสธ:</b> ${technicianName}</li>` : ''}</ul><p><b>เหตุผล:</b> ${rejectReason}</p></div>`,
        message_text: `คำร้องซ่อม #${requestId} ถูกปฏิเสธ เหตุผล: ${rejectReason}`,
        message_type: 'HPT',
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
                                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
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

export async function sendRepairRejectedAlert(idCard: string, data: RepairRejectedData): Promise<void> {
    const payload = { cid: [idCard], ...buildRepairRejectedTemplate(data) };
    const res = await fetch(MOPH_ALERTING_URL, {
        method: 'POST',
        headers: MOPH_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Alert] Repair Rejected Template:', res.status, await res.text());
}

// IT Repair Received Template (แจ้งกลับผู้ส่งซ่อมเมื่อช่างรับงาน)
export interface RepairReceivedData {
    requestId: number;
    equipmentName?: string;
    equipmentNumber?: string;
    location?: string;
    problemDescription?: string;
    equipmentTypeName?: string;
    problemCategoryName?: string;
    priorityName?: string;
    technicianName?: string;
    technicianPriorityName?: string;
    estimatedDays?: number;
    estimatedCompletionDate?: string;
    requestedAt?: string;
}

function buildRepairReceivedTemplate(data: RepairReceivedData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentName, equipmentNumber,
        location, problemDescription,
        equipmentTypeName, problemCategoryName, priorityName,
        technicianName, technicianPriorityName,
        estimatedDays, estimatedCompletionDate, requestedAt,
    } = data;

    const equipmentText = equipmentName
        ? `${equipmentName}${equipmentNumber ? ` (${equipmentNumber})` : ''}`
        : '-';

    const requestedThai = requestedAt ? formatThaiDate(new Date(requestedAt)) : null;

    // สีตามระดับความเร่งด่วน: ปกติ → เขียว, ปานกลาง → เหลือง, เร่งด่วน → ส้ม, วิกฤต → แดง
    const priorityColor = (name: string): string => {
        if (name.includes('วิกฤต')) return '#ef4444';
        if (name.includes('เร่งด่วน')) return '#f97316';
        if (name.includes('ปานกลาง')) return '#eab308';
        if (name.includes('ปกติ')) return '#22c55e';
        return '#38bdf8';
    };

    const toRow = (row: { label: string; value: string; color?: string }) => ({
        type: 'box', layout: 'baseline',
        contents: [
            { type: 'text', text: row.label, size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: row.value, size: 'sm', weight: 'bold', color: row.color ?? '#38bdf8', flex: 5, wrap: true },
        ],
    });

    const rows = [
        { label: 'เลขคำร้อง', value: `#${requestId}` },
        ...(requestedThai ? [{ label: 'วันที่ส่งซ่อม', value: `${requestedThai.thaiDate} ${requestedThai.thaiTime} น.` }] : []),
        { label: 'รับงานเมื่อ', value: `${thaiDate} ${thaiTime} น.` },
        ...(priorityName ? [{ label: 'ความเร่งด่วน', value: priorityName, color: priorityColor(priorityName) }] : []),
        ...(equipmentTypeName ? [{ label: 'ประเภท', value: equipmentTypeName }] : []),
        { label: 'ครุภัณฑ์', value: equipmentText },
        ...(location ? [{ label: 'สถานที่', value: location }] : []),
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        ...(problemDescription ? [{ label: 'อาการ', value: problemDescription }] : []),
    ];

    const techRows = [
        ...(technicianName ? [{ label: 'ช่างผู้รับงาน', value: technicianName }] : []),
        ...(technicianPriorityName ? [{ label: 'ช่างประเมินระดับ', value: technicianPriorityName, color: priorityColor(technicianPriorityName) }] : []),
        ...(estimatedDays != null ? [{ label: 'ประเมินเสร็จใน', value: `${estimatedDays} วัน` }] : []),
        ...(estimatedCompletionDate ? [{ label: 'คาดเสร็จวันที่', value: formatThaiDate(new Date(estimatedCompletionDate)).thaiDate }] : []),
    ];

    return {
        message_title: 'แจ้งผลคำร้องซ่อม: ช่างรับงานแล้ว',
        message_html: `<div><p><strong>คำร้องซ่อม #${requestId}: ช่างรับงานแล้ว กำลังดำเนินการ</strong></p><ul><li><b>รับงานเมื่อ:</b> ${thaiDate} ${thaiTime} น.</li><li><b>ครุภัณฑ์:</b> ${equipmentText}</li>${technicianName ? `<li><b>ช่างผู้รับงาน:</b> ${technicianName}</li>` : ''}</ul></div>`,
        message_text: `คำร้องซ่อม #${requestId} ช่างรับงานแล้ว กำลังดำเนินการ`,
        message_type: 'HPT',
        messages: [
            {
                type: 'flex',
                altText: `คำร้องซ่อม #${requestId} ช่างรับงานแล้ว`,
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
                            { type: 'text', text: `คำร้องซ่อม #${requestId} ช่างรับงานแล้ว`, weight: 'bold', size: 'xl', color: '#38bdf8', wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
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

export async function sendRepairReceivedAlert(idCard: string, data: RepairReceivedData): Promise<void> {
    const payload = { cid: [idCard], ...buildRepairReceivedTemplate(data) };
    const res = await fetch(MOPH_ALERTING_URL, {
        method: 'POST',
        headers: MOPH_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Alert] Repair Received Template:', res.status, await res.text());
}

// IT Repair Extension Template (แจ้งกลับผู้ส่งซ่อมเมื่อช่างขอเวลาเพิ่ม)
export interface RepairExtensionData {
    requestId: number;
    equipmentName?: string;
    equipmentNumber?: string;
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

function buildRepairExtensionTemplate(data: RepairExtensionData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentName, equipmentNumber,
        location, problemDescription,
        equipmentTypeName, problemCategoryName,
        technicianName, requestedAt, previousCompletionDate, newCompletionDate,
        extensionDays, extensionReason,
    } = data;

    const equipmentText = equipmentName
        ? `${equipmentName}${equipmentNumber ? ` (${equipmentNumber})` : ''}`
        : '-';

    const requestedThai = requestedAt ? formatThaiDate(new Date(requestedAt)) : null;
    const newThai = formatThaiDate(new Date(newCompletionDate)).thaiDate;
    const prevThai = previousCompletionDate ? formatThaiDate(new Date(previousCompletionDate)).thaiDate : null;

    const toRow = (row: { label: string; value: string; color?: string }) => ({
        type: 'box', layout: 'baseline',
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
        { label: 'ครุภัณฑ์', value: equipmentText },
        ...(location ? [{ label: 'สถานที่', value: location }] : []),
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        ...(problemDescription ? [{ label: 'อาการ', value: problemDescription }] : []),
        ...(technicianName ? [{ label: 'ช่างผู้ขอเลื่อน', value: technicianName }] : []),
    ];

    const scheduleRows = [
        ...(prevThai ? [{ label: 'กำหนดเดิม', value: prevThai, color: '#94a3b8' }] : []),
        { label: 'กำหนดใหม่', value: newThai },
        ...(extensionDays != null ? [{ label: 'ขอเพิ่ม', value: `${extensionDays} วัน` }] : []),
    ];

    return {
        message_title: 'แจ้งผลคำร้องซ่อม: ช่างขอเวลาเพิ่ม',
        message_html: `<div><p><strong>คำร้องซ่อม #${requestId}: ช่างขอเวลาเพิ่มในการดำเนินการ</strong></p><ul>${requestedThai ? `<li><b>วันที่ส่งซ่อม:</b> ${requestedThai.thaiDate} ${requestedThai.thaiTime} น.</li>` : ''}<li><b>ขอเลื่อนเมื่อ:</b> ${thaiDate} ${thaiTime} น.</li><li><b>ครุภัณฑ์:</b> ${equipmentText}</li><li><b>กำหนดเสร็จใหม่:</b> ${newThai}</li>${technicianName ? `<li><b>ช่างผู้ขอเลื่อน:</b> ${technicianName}</li>` : ''}</ul><p><b>เหตุผล:</b> ${extensionReason}</p></div>`,
        message_text: `คำร้องซ่อม #${requestId} ช่างขอเวลาเพิ่ม กำหนดเสร็จใหม่ ${newThai} เหตุผล: ${extensionReason}`,
        message_type: 'HPT',
        messages: [
            {
                type: 'flex',
                altText: `คำร้องซ่อม #${requestId} ช่างขอเวลาเพิ่ม`,
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
                            { type: 'text', text: `คำร้องซ่อม #${requestId} ช่างขอเวลาเพิ่ม`, weight: 'bold', size: 'xl', color: '#f59e0b', wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
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

export async function sendRepairExtensionAlert(idCard: string, data: RepairExtensionData): Promise<void> {
    const payload = { cid: [idCard], ...buildRepairExtensionTemplate(data) };
    const res = await fetch(MOPH_ALERTING_URL, {
        method: 'POST',
        headers: MOPH_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Alert] Repair Extension Template:', res.status, await res.text());
}

// IT Repair Header Approve Template (แจ้งกลับผู้ส่งซ่อมเมื่อหัวหน้าอนุมัติ/ไม่อนุมัติ)
export interface HeaderApproveAlertData {
    requestId: number;
    equipmentName?: string;
    equipmentNumber?: string;
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

function buildHeaderApproveTemplate(data: HeaderApproveAlertData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentName, equipmentNumber,
        location, problemDescription,
        equipmentTypeName, problemCategoryName,
        technicianName, approverName, requestedAt,
        headerApprove, headerComment,
    } = data;

    const equipmentText = equipmentName
        ? `${equipmentName}${equipmentNumber ? ` (${equipmentNumber})` : ''}`
        : '-';

    const approved = headerApprove === 1;
    const accent = approved ? '#22c55e' : '#f87171';
    const resultText = approved ? 'หัวหน้าอนุมัติแล้ว' : 'หัวหน้าไม่อนุมัติ';
    const requestedThai = requestedAt ? formatThaiDate(new Date(requestedAt)) : null;

    const toRow = (row: { label: string; value: string; color?: string }) => ({
        type: 'box', layout: 'baseline',
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
        { label: 'ครุภัณฑ์', value: equipmentText },
        ...(location ? [{ label: 'สถานที่', value: location }] : []),
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        ...(problemDescription ? [{ label: 'อาการ', value: problemDescription }] : []),
        ...(technicianName ? [{ label: 'ช่างผู้รับงาน', value: technicianName }] : []),
        ...(approverName ? [{ label: 'ผู้พิจารณา', value: approverName }] : []),
    ];

    return {
        message_title: `แจ้งผลคำร้องซ่อม: ${resultText}`,
        message_html: `<div><p><strong>คำร้องซ่อม #${requestId}: ${resultText}</strong></p><ul>${requestedThai ? `<li><b>วันที่ส่งซ่อม:</b> ${requestedThai.thaiDate} ${requestedThai.thaiTime} น.</li>` : ''}<li><b>พิจารณาเมื่อ:</b> ${thaiDate} ${thaiTime} น.</li><li><b>ครุภัณฑ์:</b> ${equipmentText}</li>${approverName ? `<li><b>ผู้พิจารณา:</b> ${approverName}</li>` : ''}</ul>${headerComment ? `<p><b>ความเห็นหัวหน้า:</b> ${headerComment}</p>` : ''}</div>`,
        message_text: `คำร้องซ่อม #${requestId} ${resultText}${headerComment ? ` ความเห็น: ${headerComment}` : ''}`,
        message_type: 'HPT',
        messages: [
            {
                type: 'flex',
                altText: `คำร้องซ่อม #${requestId} ${resultText}`,
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
                            { type: 'text', text: `คำร้องซ่อม #${requestId} ${resultText}`, weight: 'bold', size: 'xl', color: accent, wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
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

export async function sendHeaderApproveAlert(idCard: string, data: HeaderApproveAlertData): Promise<void> {
    const payload = { cid: [idCard], ...buildHeaderApproveTemplate(data) };
    const res = await fetch(MOPH_ALERTING_URL, {
        method: 'POST',
        headers: MOPH_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Alert] Header Approve Template:', res.status, await res.text());
}

// IT Repair Mission Approve Template (แจ้งกลับผู้ส่งซ่อมเมื่อหัวหน้ากลุ่มภารกิจอนุมัติ/ไม่อนุมัติ)
export interface MissionApproveAlertData {
    requestId: number;
    equipmentName?: string;
    equipmentNumber?: string;
    location?: string;
    problemDescription?: string;
    equipmentTypeName?: string;
    problemCategoryName?: string;
    technicianName?: string;
    approverName?: string;
    assessmentName?: string;
    nextStatusName?: string;
    nextStatusId?: number;
    requestedAt?: string;
    missionApprove: number; // 1 = อนุมัติ, 2 = ไม่อนุมัติ
    missionComment?: string;
}

function buildMissionApproveTemplate(data: MissionApproveAlertData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const {
        requestId, equipmentName, equipmentNumber,
        location, problemDescription,
        equipmentTypeName, problemCategoryName,
        technicianName, approverName, assessmentName, nextStatusName, nextStatusId, requestedAt,
        missionApprove, missionComment,
    } = data;

    // อนุมัติให้จัดซื้อ (3 = ออกใบ PR/ซื้ออะไหล่, 11 = อนุมัติซื้อทดแทน) → แจ้งสิ่งที่ผู้แจ้งต้องดำเนินการต่อ
    const showPurchaseAction = missionApprove === 1 && (nextStatusId === 3 || nextStatusId === 11);
    const purchaseActionLines = [
        '1. บันทึกข้อความเสนอผู้อำนวยการ',
        '2. ทะเบียนครุภัณฑ์จากพัสดุ',
        'เพื่อนำมาให้ศูนย์คอมเสนอพร้อมกับ ใบ PR และ ใบเสนอราคา',
    ];

    const equipmentText = equipmentName
        ? `${equipmentName}${equipmentNumber ? ` (${equipmentNumber})` : ''}`
        : '-';

    const approved = missionApprove === 1;
    const accent = approved ? '#22c55e' : '#f87171';
    const resultText = approved ? 'หัวหน้ากลุ่มภารกิจอนุมัติ' : 'หัวหน้ากลุ่มภารกิจไม่อนุมัติ';
    const requestedThai = requestedAt ? formatThaiDate(new Date(requestedAt)) : null;

    const toRow = (row: { label: string; value: string; color?: string }) => ({
        type: 'box', layout: 'baseline',
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
        { label: 'ครุภัณฑ์', value: equipmentText },
        ...(location ? [{ label: 'สถานที่', value: location }] : []),
        ...(problemCategoryName ? [{ label: 'หมวดปัญหา', value: problemCategoryName }] : []),
        ...(problemDescription ? [{ label: 'อาการ', value: problemDescription }] : []),
        ...(technicianName ? [{ label: 'ช่างผู้รับงาน', value: technicianName }] : []),
        ...(approverName ? [{ label: 'ผู้พิจารณา', value: approverName }] : []),
    ];

    return {
        message_title: `แจ้งผลคำร้องซ่อม: ${resultText}`,
        message_html: `<div><p><strong>คำร้องซ่อม #${requestId}: ${resultText}</strong></p><ul>${requestedThai ? `<li><b>วันที่ส่งซ่อม:</b> ${requestedThai.thaiDate} ${requestedThai.thaiTime} น.</li>` : ''}<li><b>พิจารณาเมื่อ:</b> ${thaiDate} ${thaiTime} น.</li><li><b>ครุภัณฑ์:</b> ${equipmentText}</li>${approved && nextStatusName ? `<li><b>ขั้นตอนถัดไป:</b> ${nextStatusName}</li>` : ''}${approverName ? `<li><b>ผู้พิจารณา:</b> ${approverName}</li>` : ''}</ul>${missionComment ? `<p><b>ความเห็นหัวหน้ากลุ่มภารกิจ:</b> ${missionComment}</p>` : ''}${showPurchaseAction ? `<div style="margin-top:8px;"><p><strong>📋 สิ่งที่ท่านต้องดำเนินการต่อ</strong></p><ol><li>บันทึกข้อความเสนอผู้อำนวยการ</li><li>ทะเบียนครุภัณฑ์จากพัสดุ</li></ol><p>เพื่อนำมาให้ศูนย์คอมเสนอพร้อมกับ ใบ PR และ ใบเสนอราคา</p></div>` : ''}</div>`,
        message_text: `คำร้องซ่อม #${requestId} ${resultText}${approved && nextStatusName ? ` ขั้นตอนถัดไป: ${nextStatusName}` : ''}${missionComment ? ` ความเห็น: ${missionComment}` : ''}${showPurchaseAction ? ` | สิ่งที่ท่านต้องดำเนินการต่อ: ${purchaseActionLines.join(' ')}` : ''}`,
        message_type: 'HPT',
        messages: [
            {
                type: 'flex',
                altText: `คำร้องซ่อม #${requestId} ${resultText}`,
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
                            { type: 'text', text: `คำร้องซ่อม #${requestId} ${resultText}`, weight: 'bold', size: 'xl', color: accent, wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
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
                            ...(showPurchaseAction ? [{
                                type: 'box', layout: 'vertical', margin: 'lg',
                                backgroundColor: '#0a1a2a', paddingAll: '12px', cornerRadius: 'md',
                                spacing: 'sm',
                                contents: [
                                    { type: 'text', text: '📋 สิ่งที่ท่านต้องดำเนินการต่อ', size: 'sm', weight: 'bold', color: '#38bdf8' },
                                    ...purchaseActionLines.map((line) => ({
                                        type: 'text', text: line, size: 'sm', color: '#cbd5e1', wrap: true,
                                    })),
                                ],
                            }] : []),
                        ],
                    },
                },
            },
        ],
    };
}

export async function sendMissionApproveAlert(idCard: string, data: MissionApproveAlertData): Promise<void> {
    const payload = { cid: [idCard], ...buildMissionApproveTemplate(data) };
    const res = await fetch(MOPH_ALERTING_URL, {
        method: 'POST',
        headers: MOPH_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Alert] Mission Approve Template:', res.status, await res.text());
}

// IT User Credential Issued Template (ส่ง username/password ให้ผู้ใช้ผ่านหมอพร้อม)
// ข้อควรระวัง: ฟังก์ชันนี้คือ "ช่องทางส่งมอบ credential" เพียงช่องทางเดียว —
//   username/password ต้องไม่ถูกบันทึกลง DB และต้องไม่ถูก log (จึง log แค่ status code)
export interface CredentialIssuedData {
    requestNo: string;
    username: string;
    password: string;
    systemName?: string;
    issuedBy?: string;
    note?: string;
}

function buildCredentialIssuedTemplate(data: CredentialIssuedData): object {
    const { thaiDate, thaiTime } = formatThaiDate(new Date());
    const { requestNo, username, password, systemName, issuedBy, note } = data;

    const toRow = (label: string, value: string, color = '#10b981') => ({
        type: 'box', layout: 'baseline',
        contents: [
            { type: 'text', text: label, size: 'sm', color: '#6b7280', flex: 3 },
            { type: 'text', text: value, size: 'sm', weight: 'bold', color, flex: 5, wrap: true },
        ],
    });

    const rows = [
        toRow('เลขที่คำร้อง', requestNo, '#f8fafc'),
        ...(systemName ? [toRow('ระบบ', systemName, '#f8fafc')] : []),
        toRow('วันที่ออกรหัส', `${thaiDate} ${thaiTime} น.`, '#f8fafc'),
        ...(issuedBy ? [toRow('ออกรหัสโดย', issuedBy, '#f8fafc')] : []),
    ];

    return {
        message_title: 'แจ้งบัญชีเข้าใช้งานระบบโรงพยาบาล',
        message_html: `<div><p><strong>บัญชีเข้าใช้งานระบบ${systemName ? ` ${systemName}` : ''}</strong></p><ul><li><b>เลขที่คำร้อง:</b> ${requestNo}</li><li><b>Username:</b> ${username}</li><li><b>Password:</b> ${password}</li><li><b>วันที่ออกรหัส:</b> ${thaiDate} ${thaiTime} น.</li></ul><p style="color:#cc0000;">กรุณาเปลี่ยนรหัสผ่านเมื่อเข้าใช้งานครั้งแรก และห้ามเปิดเผยรหัสผ่านแก่ผู้อื่น</p></div>`,
        message_text: `บัญชีเข้าใช้งานระบบ${systemName ? ` ${systemName}` : ''} (คำร้อง ${requestNo}) Username: ${username} Password: ${password} กรุณาเปลี่ยนรหัสผ่านเมื่อเข้าใช้ครั้งแรก`,
        message_type: 'HPT',
        messages: [
            {
                type: 'flex',
                altText: `บัญชีเข้าใช้งานระบบ${systemName ? ` ${systemName}` : ''} (${requestNo})`,
                contents: {
                    type: 'bubble',
                    size: 'mega',
                    header: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0d1b2a',
                        contents: [
                            { type: 'text', text: '🔑 PYHOS-EXP', weight: 'bold', size: 'lg', color: '#10b981' },
                            { type: 'text', text: 'IT User Credential', size: 'xs', color: '#6b7280', margin: 'xs' },
                        ],
                    },
                    body: {
                        type: 'box',
                        layout: 'vertical',
                        paddingAll: '20px',
                        backgroundColor: '#0f172a',
                        contents: [
                            { type: 'text', text: 'บัญชีเข้าใช้งานระบบโรงพยาบาล', weight: 'bold', size: 'xl', color: '#f8fafc', wrap: true },
                            { type: 'text', text: 'โรงพยาบาลพะเยา', size: 'xs', color: '#6b7280', margin: 'xs', align: 'center' },
                            { type: 'separator', margin: 'lg', color: '#1e293b' },
                            {
                                type: 'box', layout: 'vertical', margin: 'lg', spacing: 'sm',
                                contents: rows,
                            },
                            {
                                type: 'box', layout: 'vertical', margin: 'lg',
                                backgroundColor: '#0a1a12', paddingAll: '12px', cornerRadius: 'md', spacing: 'sm',
                                contents: [
                                    { type: 'text', text: 'Username', size: 'xs', color: '#6b7280' },
                                    { type: 'text', text: username, size: 'lg', weight: 'bold', color: '#10b981', wrap: true },
                                    { type: 'text', text: 'Password', size: 'xs', color: '#6b7280', margin: 'md' },
                                    { type: 'text', text: password, size: 'lg', weight: 'bold', color: '#10b981', wrap: true },
                                ],
                            },
                            ...(note ? [{
                                type: 'box', layout: 'vertical', margin: 'lg',
                                backgroundColor: '#1e293b', paddingAll: '12px', cornerRadius: 'md',
                                contents: [
                                    { type: 'text', text: 'หมายเหตุ', size: 'xs', color: '#6b7280' },
                                    { type: 'text', text: note, size: 'sm', color: '#cbd5e1', wrap: true },
                                ],
                            }] : []),
                            {
                                type: 'box', layout: 'vertical', margin: 'lg',
                                backgroundColor: '#1e0a0a', paddingAll: '12px', cornerRadius: 'md',
                                contents: [
                                    { type: 'text', text: 'กรุณาเปลี่ยนรหัสผ่านเมื่อเข้าใช้งานครั้งแรก และห้ามเปิดเผยรหัสผ่านแก่ผู้อื่น', size: 'sm', color: '#f87171', wrap: true, weight: 'bold' },
                                ],
                            },
                        ],
                    },
                },
            },
        ],
    };
}

// ส่ง credential ผ่านหมอพร้อม — throw เมื่อส่งไม่สำเร็จ (ให้ controller จับแล้วคืน 502 NOTIFY_FAILED)
export async function sendCredentialIssuedAlert(idCard: string, data: CredentialIssuedData): Promise<void> {
    const payload = { cid: [idCard], ...buildCredentialIssuedTemplate(data) };
    const res = await fetch(MOPH_ALERTING_URL, {
        method: 'POST',
        headers: MOPH_HEADERS,
        body: JSON.stringify(payload),
    });
    // ห้าม log payload/credential — log เฉพาะสถานะ
    console.log('[MOPH Alert] Credential Issued:', res.status);
    if (!res.ok) {
        throw new Error(`MOPH Alert credential delivery failed with status ${res.status}`);
    }
}

