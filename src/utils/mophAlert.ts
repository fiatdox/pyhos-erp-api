const MOPH_ALERTING_URL = `${process.env.MOPH_ALERT_BASE_URL}/alert/v3.1/messages`;

const MOPH_HEADERS = {
    'Content-Type': 'application/json',
    'client-key': process.env.MOPH_ALERT_CLIENT_ID!,
    'secret-key': process.env.MOPH_ALERT_SECRET_ID!,
};

function formatThaiDate(date: Date): { thaiDate: string; thaiTime: string } {
    const months = ['', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
        'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const thaiDate = `${date.getDate()} ${months[date.getMonth() + 1]} ${date.getFullYear() + 543}`;
    const thaiTime = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
    return { thaiDate, thaiTime };
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
                            { type: 'text', text: '🔐 PYHOS-ERP', weight: 'bold', size: 'lg', color: '#10b981' },
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
                                            { type: 'text', text: newPassword, size: 'lg', weight: 'bold', color: '#10b981', wrap: true },
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
