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
                            { type: 'text', text: '🛠️ PYHOS-ERP', weight: 'bold', size: 'lg', color: '#10b981' },
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
    console.log('[MOPH Notify] URL:', url);
    console.log('[MOPH Notify] client-key:', process.env.IT_MATENANCE_CLIENT_ID);
    console.log('[MOPH Notify] secret-key:', process.env.IT_MATENANCE_SECRET_ID);
    const res = await fetch(url, {
        method: 'POST',
        headers: IT_MATENANCE_HEADERS,
        body: JSON.stringify(payload),
    });
    console.log('[MOPH Notify] IT Maintenance Template:', res.status, await res.text());
}
